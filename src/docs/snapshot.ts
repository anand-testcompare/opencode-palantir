import fs from 'node:fs/promises';
import path from 'node:path';

import type { Stats } from 'node:fs';

export const DEFAULT_DOCS_SNAPSHOT_URLS: string[] = [
  'https://raw.githubusercontent.com/anand-testcompare/opencode-palantir/main/data/docs.parquet',
];

const MIN_SNAPSHOT_BYTES = 64;

export type EnsureDocsSnapshotSource = 'existing' | 'download' | 'bundled-copy';

export type EnsureDocsParquetResult = {
  dbPath: string;
  changed: boolean;
  source: EnsureDocsSnapshotSource;
  bytes: number;
  downloadUrl?: string;
};

export type EnsureDocsParquetEvent =
  | { type: 'start'; force: boolean }
  | { type: 'skip-existing'; bytes: number }
  | { type: 'download-start'; url: string }
  | { type: 'download-failed'; url: string; error: string }
  | { type: 'download-success'; url: string; bytes: number }
  | { type: 'copy-start'; sourcePath: string }
  | { type: 'copy-success'; sourcePath: string; bytes: number }
  | { type: 'done'; result: EnsureDocsParquetResult };

export type EnsureDocsParquetOptions = {
  dbPath: string;
  force?: boolean;
  pluginDirectory?: string;
  snapshotUrls?: string[];
  onEvent?: (event: EnsureDocsParquetEvent) => void;
};

const inFlightByPath = new Map<string, Promise<EnsureDocsParquetResult>>();

function formatError(err: unknown): string {
  return err instanceof Error ? err.toString() : String(err);
}

function emit(onEvent: EnsureDocsParquetOptions['onEvent'], event: EnsureDocsParquetEvent): void {
  if (!onEvent) return;
  onEvent(event);
}

function normalizeSnapshotUrls(customUrls?: string[]): string[] {
  const envSingleRaw = process.env.OPENCODE_PALANTIR_DOCS_SNAPSHOT_URL;
  const envManyRaw = process.env.OPENCODE_PALANTIR_DOCS_SNAPSHOT_URLS;
  const envSingle =
    typeof envSingleRaw === 'string' && envSingleRaw.trim().length > 0 ? [envSingleRaw.trim()] : [];
  const envMany =
    typeof envManyRaw === 'string' && envManyRaw.trim().length > 0
      ? envManyRaw
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x.length > 0)
      : [];

  const resolved = customUrls ?? [...envMany, ...envSingle, ...DEFAULT_DOCS_SNAPSHOT_URLS];
  return Array.from(new Set(resolved));
}

async function ensureDirectoryExists(dbPath: string): Promise<void> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
}

async function statIfExists(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

function assertValidSnapshotSize(bytes: number, source: string): void {
  if (bytes < MIN_SNAPSHOT_BYTES) {
    throw new Error(
      `Snapshot from ${source} is unexpectedly small (${bytes} bytes). Expected at least ${MIN_SNAPSHOT_BYTES} bytes.`
    );
  }
}

function tempPathFor(dbPath: string): string {
  const base = path.basename(dbPath);
  return path.join(path.dirname(dbPath), `.${base}.tmp.${process.pid}.${Date.now()}`);
}

async function writeBufferAtomic(dbPath: string, bytes: Uint8Array): Promise<void> {
  const tmp = tempPathFor(dbPath);
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, dbPath);
}

async function copyFileAtomic(sourcePath: string, dbPath: string): Promise<void> {
  const tmp = tempPathFor(dbPath);
  await fs.copyFile(sourcePath, tmp);
  await fs.rename(tmp, dbPath);
}

function bundledSnapshotCandidates(dbPath: string, pluginDirectory?: string): string[] {
  const candidates: string[] = [];
  if (pluginDirectory && pluginDirectory.trim().length > 0) {
    candidates.push(path.resolve(pluginDirectory, 'data', 'docs.parquet'));
  } else {
    candidates.push(path.resolve(import.meta.dir, '..', '..', 'data', 'docs.parquet'));
  }

  const target = path.resolve(dbPath);
  const deduped = Array.from(new Set(candidates.map((x) => path.resolve(x))));
  return deduped.filter((candidate) => candidate !== target);
}

async function tryDownloadSnapshot(
  dbPath: string,
  urls: string[],
  onEvent: EnsureDocsParquetOptions['onEvent']
): Promise<EnsureDocsParquetResult | null> {
  const errors: string[] = [];

  for (const url of urls) {
    emit(onEvent, { type: 'download-start', url });
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const reason = `HTTP ${response.status} ${response.statusText}`.trim();
        emit(onEvent, { type: 'download-failed', url, error: reason });
        errors.push(`${url}: ${reason}`);
        continue;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      assertValidSnapshotSize(bytes.byteLength, url);
      await writeBufferAtomic(dbPath, bytes);
      emit(onEvent, { type: 'download-success', url, bytes: bytes.byteLength });
      return {
        dbPath,
        changed: true,
        source: 'download',
        bytes: bytes.byteLength,
        downloadUrl: url,
      };
    } catch (err) {
      const reason = formatError(err);
      emit(onEvent, { type: 'download-failed', url, error: reason });
      errors.push(`${url}: ${reason}`);
    }
  }

  if (errors.length === 0) return null;
  throw new Error(
    [
      'Unable to download prebuilt docs snapshot from configured source URLs.',
      ...errors.map((line) => `- ${line}`),
    ].join('\n')
  );
}

async function tryCopyBundledSnapshot(
  dbPath: string,
  pluginDirectory: string | undefined,
  onEvent: EnsureDocsParquetOptions['onEvent']
): Promise<EnsureDocsParquetResult | null> {
  const candidates = bundledSnapshotCandidates(dbPath, pluginDirectory);

  for (const sourcePath of candidates) {
    const stat = await statIfExists(sourcePath);
    if (!stat || !stat.isFile()) continue;

    emit(onEvent, { type: 'copy-start', sourcePath });
    assertValidSnapshotSize(stat.size, sourcePath);
    await copyFileAtomic(sourcePath, dbPath);
    emit(onEvent, { type: 'copy-success', sourcePath, bytes: stat.size });
    return {
      dbPath,
      changed: true,
      source: 'bundled-copy',
      bytes: stat.size,
    };
  }

  return null;
}

async function ensureDocsParquetInternal(
  options: EnsureDocsParquetOptions
): Promise<EnsureDocsParquetResult> {
  const dbPath = path.resolve(options.dbPath);
  const force = options.force === true;
  const onEvent = options.onEvent;

  emit(onEvent, { type: 'start', force });
  await ensureDirectoryExists(dbPath);

  if (!force) {
    const existing = await statIfExists(dbPath);
    if (existing && existing.isFile()) {
      assertValidSnapshotSize(existing.size, dbPath);
      const result: EnsureDocsParquetResult = {
        dbPath,
        changed: false,
        source: 'existing',
        bytes: existing.size,
      };
      emit(onEvent, { type: 'skip-existing', bytes: existing.size });
      emit(onEvent, { type: 'done', result });
      return result;
    }
  }

  const snapshotUrls = normalizeSnapshotUrls(options.snapshotUrls);

  let downloadError: Error | null = null;
  try {
    const downloaded = await tryDownloadSnapshot(dbPath, snapshotUrls, onEvent);
    if (downloaded) {
      emit(onEvent, { type: 'done', result: downloaded });
      return downloaded;
    }
  } catch (err) {
    downloadError = err instanceof Error ? err : new Error(String(err));
  }

  const copied = await tryCopyBundledSnapshot(dbPath, options.pluginDirectory, onEvent);
  if (copied) {
    emit(onEvent, { type: 'done', result: copied });
    return copied;
  }

  const fallbackHint =
    'No bundled snapshot was found. You can run /refresh-docs-rescrape as a fallback.';
  if (downloadError) {
    throw new Error(`${downloadError.message}\n${fallbackHint}`);
  }

  throw new Error(
    `No docs snapshot sources were available. ${fallbackHint} ` +
      `Checked URLs=${snapshotUrls.length}, bundled candidates=${bundledSnapshotCandidates(dbPath, options.pluginDirectory).length}.`
  );
}

export async function ensureDocsParquet(
  options: EnsureDocsParquetOptions
): Promise<EnsureDocsParquetResult> {
  const dbPath = path.resolve(options.dbPath);
  const existing = inFlightByPath.get(dbPath);
  if (existing) return existing;

  let promise: Promise<EnsureDocsParquetResult>;
  promise = ensureDocsParquetInternal({ ...options, dbPath }).finally(() => {
    if (inFlightByPath.get(dbPath) === promise) {
      inFlightByPath.delete(dbPath);
    }
  });

  inFlightByPath.set(dbPath, promise);
  return promise;
}
