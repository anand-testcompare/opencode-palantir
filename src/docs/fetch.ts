import { gunzipSync } from 'node:zlib';
import { decode } from 'cborg';
import { writeParquet } from './write-parquet.ts';
import type { PageRecord } from './db.ts';

export type { PageRecord };

export type PagefindEntry = {
  version: string;
  languages: Record<
    string,
    {
      hash: string;
      wasm: string;
      page_count: number;
    }
  >;
};

export type FetchResult = {
  totalPages: number;
  fetchedPages: number;
  failedUrls: string[];
  dbPath: string;
};

export type FetchProgressEvent =
  | { type: 'discovered'; totalPages: number }
  | { type: 'progress'; processedPages: number; totalPages: number }
  | { type: 'page-failed'; url: string; error: string }
  | { type: 'completed'; totalPages: number; fetchedPages: number; failedPages: number };

export type FetchAllDocsOptions = {
  concurrency?: number;
  progressEvery?: number;
  onProgress?: (event: FetchProgressEvent) => void;
};

export const PAGEFIND_BASE = 'https://www.palantir.com/docs/pagefind';
export const PAGEFIND_HEADER_SIZE = 12;
export const DEFAULT_CONCURRENCY = 15;
export const MAX_RETRIES = 3;

const BASE_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;
const JITTER_RANGE = 0.25;
const BATCH_SIZE = 100;

function formatError(error: unknown): string {
  return error instanceof Error ? error.toString() : String(error);
}

/**
 * Decompress Pagefind data.
 * Format: gzip compressed → 12-byte "pagefind_dcd" header → payload (CBOR or JSON)
 */
export function decompressPagefind(data: Uint8Array): Uint8Array {
  // First: gunzip the raw data
  const decompressed = gunzipSync(Buffer.from(data));

  // Then: strip the 12-byte "pagefind_dcd" header
  if (decompressed.length < PAGEFIND_HEADER_SIZE) {
    throw new Error(
      `Decompressed Pagefind data is ${decompressed.length} bytes, shorter than required ${PAGEFIND_HEADER_SIZE}-byte header`
    );
  }

  return new Uint8Array(decompressed.slice(PAGEFIND_HEADER_SIZE));
}

function isRetryable(status: number): boolean {
  return status >= 500;
}

function computeDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt);
  const jitter = 1 - JITTER_RANGE + Math.random() * JITTER_RANGE * 2;
  return base * jitter;
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, computeDelay(attempt - 1)));
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) continue;
      throw lastError;
    }

    if (response.ok) return response;

    if (!isRetryable(response.status)) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }

    lastError = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    if (attempt === MAX_RETRIES) throw lastError;
  }

  throw lastError ?? new Error(`Failed to fetch ${url} after ${MAX_RETRIES} retries`);
}

export async function fetchEntryPoint(): Promise<PagefindEntry> {
  const url = `${PAGEFIND_BASE}/pagefind-entry.json`;
  const response = await fetchWithRetry(url);
  return (await response.json()) as PagefindEntry;
}

export async function fetchAndParseMeta(langHash: string): Promise<string[]> {
  const url = `${PAGEFIND_BASE}/pagefind.${langHash}.pf_meta`;
  const response = await fetchWithRetry(url);
  const buffer = new Uint8Array(await response.arrayBuffer());
  const decompressed = decompressPagefind(buffer);

  type PagefindMeta = [string, Array<[string, number]>, ...unknown[]];
  let decoded: PagefindMeta;
  try {
    decoded = decode(decompressed) as PagefindMeta;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to decode pf_meta: ${detail}. The Pagefind binary format may have changed.`,
      {
        cause: error,
      }
    );
  }

  if (!Array.isArray(decoded) || !Array.isArray(decoded[1])) {
    throw new Error(
      'Failed to decode pf_meta: unexpected structure. The Pagefind binary format may have changed.'
    );
  }

  return decoded[1].map((page) => page[0]);
}

export async function fetchFragment(hash: string): Promise<PageRecord> {
  const url = `${PAGEFIND_BASE}/fragment/${hash}.pf_fragment`;
  const response = await fetchWithRetry(url);
  const buffer = new Uint8Array(await response.arrayBuffer());
  const decompressed = decompressPagefind(buffer);
  const text = new TextDecoder().decode(decompressed);
  const fragment = JSON.parse(text) as {
    url: string;
    content: string;
    meta: { title: string; [key: string]: unknown };
    word_count: number;
    filters: Record<string, unknown>;
    anchors: unknown[];
  };

  return {
    url: fragment.url,
    title: fragment.meta.title,
    content: fragment.content,
    wordCount: fragment.word_count,
    meta: {
      filters: fragment.filters,
      anchors: fragment.anchors,
      ...Object.fromEntries(Object.entries(fragment.meta).filter(([k]) => k !== 'title')),
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: Error }>> {
  const results: Array<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: Error }> =
    new Array(tasks.length);
  let running = 0;
  let index = 0;
  let completed = 0;

  return new Promise((resolve) => {
    function next(): void {
      if (completed === tasks.length) {
        resolve(results);
        return;
      }

      while (running < limit && index < tasks.length) {
        const taskIndex = index++;
        running++;

        tasks[taskIndex]()
          .then((value) => {
            results[taskIndex] = { status: 'fulfilled', value };
          })
          .catch((error: unknown) => {
            results[taskIndex] = {
              status: 'rejected',
              reason: error instanceof Error ? error : new Error(String(error)),
            };
          })
          .finally(() => {
            running--;
            completed++;
            next();
          });
      }
    }

    next();
  });
}

export async function fetchAllDocs(
  dbPath: string,
  options: FetchAllDocsOptions = {}
): Promise<FetchResult> {
  const entry = await fetchEntryPoint();
  const onProgress = options.onProgress;
  const concurrency =
    typeof options.concurrency === 'number' && options.concurrency > 0
      ? options.concurrency
      : DEFAULT_CONCURRENCY;
  const progressEvery =
    typeof options.progressEvery === 'number' && options.progressEvery > 0
      ? Math.floor(options.progressEvery)
      : BATCH_SIZE;

  const langKey = Object.keys(entry.languages)[0];
  if (!langKey) {
    throw new Error('No languages found in Pagefind entry');
  }

  const langHash = entry.languages[langKey].hash;
  const pageHashes = await fetchAndParseMeta(langHash);

  const totalPages = pageHashes.length;
  onProgress?.({ type: 'discovered', totalPages });
  const fetchedRecords: PageRecord[] = [];
  const failedUrls: string[] = [];
  let processedPages = 0;

  const tasks = pageHashes.map(
    (hash) => () =>
      fetchFragment(hash)
        .catch((error: unknown) => {
          const url = `${PAGEFIND_BASE}/fragment/${hash}.pf_fragment`;
          onProgress?.({
            type: 'page-failed',
            url,
            error: formatError(error),
          });
          throw error;
        })
        .finally(() => {
          processedPages += 1;
          if (processedPages % progressEvery === 0 || processedPages === totalPages) {
            onProgress?.({ type: 'progress', processedPages, totalPages });
          }
        })
  );

  const results = await withConcurrencyLimit(tasks, concurrency);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      fetchedRecords.push(result.value);
    } else {
      const url = `${PAGEFIND_BASE}/fragment/${pageHashes[i]}.pf_fragment`;
      failedUrls.push(url);
    }
  }

  await writeParquet(fetchedRecords, dbPath);
  onProgress?.({
    type: 'completed',
    totalPages,
    fetchedPages: fetchedRecords.length,
    failedPages: failedUrls.length,
  });

  return {
    totalPages,
    fetchedPages: fetchedRecords.length,
    failedUrls,
    dbPath,
  };
}
