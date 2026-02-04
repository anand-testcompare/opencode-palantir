import { gunzipSync } from 'node:zlib';
import { decode } from 'cborg';
import { createDatabase, insertPages, closeDatabase, type PageRecord } from './db.ts';

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

export const PAGEFIND_BASE = 'https://www.palantir.com/docs/pagefind';
export const PAGEFIND_HEADER_SIZE = 12;
export const DEFAULT_CONCURRENCY = 15;
export const MAX_RETRIES = 3;

const BASE_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;
const JITTER_RANGE = 0.25;
const BATCH_SIZE = 100;

export function decompressPagefind(data: Uint8Array): Uint8Array {
  if (data.length < PAGEFIND_HEADER_SIZE) {
    throw new Error(
      `Pagefind buffer is ${data.length} bytes, shorter than required ${PAGEFIND_HEADER_SIZE}-byte header`
    );
  }
  const compressed = data.slice(PAGEFIND_HEADER_SIZE);
  return new Uint8Array(gunzipSync(Buffer.from(compressed)));
}

function isRetryable(status: number): boolean {
  return status >= 500;
}

function computeDelay(attempt: number): number {
  const base = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt);
  const jitter = 1 - JITTER_RANGE + Math.random() * JITTER_RANGE * 2;
  return base * jitter;
}

// eslint-disable-next-line no-unused-vars
async function fetchWithRetry(url: string, _options?: { parseJson?: boolean }): Promise<Response> {
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

  let decoded: { pages?: Array<{ page_hash: string }> };
  try {
    decoded = decode(decompressed) as typeof decoded;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to decode pf_meta: ${detail}. The Pagefind binary format may have changed.`
    );
  }

  if (!decoded.pages || !Array.isArray(decoded.pages)) {
    throw new Error(
      'Failed to decode pf_meta: missing pages array. The Pagefind binary format may have changed.'
    );
  }

  return decoded.pages.map((p) => p.page_hash);
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
    [];
  let running = 0;
  let index = 0;

  return new Promise((resolve) => {
    function next(): void {
      if (results.length === tasks.length) {
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
            next();
          });
      }
    }

    next();
  });
}

export async function fetchAllDocs(dbPath: string): Promise<FetchResult> {
  const entry = await fetchEntryPoint();

  const langKey = Object.keys(entry.languages)[0];
  if (!langKey) {
    throw new Error('No languages found in Pagefind entry');
  }

  const langHash = entry.languages[langKey].hash;
  const pageHashes = await fetchAndParseMeta(langHash);

  const totalPages = pageHashes.length;
  const fetchedRecords: PageRecord[] = [];
  const failedUrls: string[] = [];
  let done = 0;

  const tasks = pageHashes.map(
    (hash) => () =>
      fetchFragment(hash).then((record) => {
        done++;
        if (done % BATCH_SIZE === 0 || done === totalPages) {
          // eslint-disable-next-line no-console
          console.log(`Fetched ${done}/${totalPages} pages...`);
        }
        return record;
      })
  );

  const results = await withConcurrencyLimit(tasks, DEFAULT_CONCURRENCY);

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      fetchedRecords.push(result.value);
    } else {
      const url = `${PAGEFIND_BASE}/fragment/${pageHashes[i]}.pf_fragment`;
      failedUrls.push(url);
      // eslint-disable-next-line no-console
      console.log(`[ERROR] Failed to fetch ${url}: ${result.reason.message}`);
    }
  }

  const db = createDatabase(dbPath);
  try {
    for (let i = 0; i < fetchedRecords.length; i += BATCH_SIZE) {
      const batch = fetchedRecords.slice(i, i + BATCH_SIZE);
      insertPages(db, batch);
    }
  } finally {
    closeDatabase(db);
  }

  return {
    totalPages,
    fetchedPages: fetchedRecords.length,
    failedUrls,
    dbPath,
  };
}
