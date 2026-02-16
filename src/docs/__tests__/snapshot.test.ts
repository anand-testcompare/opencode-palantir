import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureDocsParquet } from '../snapshot.ts';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function writeFileSync(filePath: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

describe('ensureDocsParquet', () => {
  let tmpDir: string;
  let dbPath: string;
  let pluginDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-snapshot-test-'));
    dbPath = path.join(tmpDir, 'data', 'docs.parquet');
    pluginDir = path.join(tmpDir, 'plugin');
    delete process.env.OPENCODE_PALANTIR_DOCS_SNAPSHOT_URL;
    delete process.env.OPENCODE_PALANTIR_DOCS_SNAPSHOT_URLS;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns existing snapshot without downloading when force=false', async () => {
    writeFileSync(dbPath, new Uint8Array(256).fill(7));
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await ensureDocsParquet({
      dbPath,
      snapshotUrls: ['https://example.invalid/docs.parquet'],
    });

    expect(result.source).toBe('existing');
    expect(result.changed).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('downloads snapshot when file is missing', async () => {
    const bytes = new Uint8Array(320).fill(5);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(toArrayBuffer(bytes)),
    }) as unknown as typeof fetch;

    const result = await ensureDocsParquet({
      dbPath,
      snapshotUrls: ['https://example.test/docs.parquet'],
    });

    expect(result.source).toBe('download');
    expect(result.changed).toBe(true);
    expect(result.bytes).toBe(320);
    expect(result.downloadUrl).toBe('https://example.test/docs.parquet');
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('falls back to bundled copy when download fails', async () => {
    const bundledPath = path.join(pluginDir, 'data', 'docs.parquet');
    writeFileSync(bundledPath, new Uint8Array(512).fill(9));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }) as unknown as typeof fetch;

    const result = await ensureDocsParquet({
      dbPath,
      pluginDirectory: pluginDir,
      snapshotUrls: ['https://example.test/docs.parquet'],
    });

    expect(result.source).toBe('bundled-copy');
    expect(result.changed).toBe(true);
    expect(result.bytes).toBe(512);
  });

  it('deduplicates concurrent callers to one in-flight download', async () => {
    const bytes = new Uint8Array(384).fill(3);
    let fetchCalls = 0;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        ok: true,
        arrayBuffer: () => Promise.resolve(toArrayBuffer(bytes)),
      };
    }) as unknown as typeof fetch;

    const [a, b, c] = await Promise.all([
      ensureDocsParquet({ dbPath, snapshotUrls: ['https://example.test/docs.parquet'] }),
      ensureDocsParquet({ dbPath, snapshotUrls: ['https://example.test/docs.parquet'] }),
      ensureDocsParquet({ dbPath, snapshotUrls: ['https://example.test/docs.parquet'] }),
    ]);

    expect(fetchCalls).toBe(1);
    expect(a.source).toBe('download');
    expect(b.source).toBe('download');
    expect(c.source).toBe('download');
  });

  it('force=true replaces an existing snapshot', async () => {
    writeFileSync(dbPath, new Uint8Array(256).fill(1));
    const fresh = new Uint8Array(512).fill(2);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(toArrayBuffer(fresh)),
    }) as unknown as typeof fetch;

    const result = await ensureDocsParquet({
      dbPath,
      force: true,
      snapshotUrls: ['https://example.test/docs.parquet'],
    });

    expect(result.source).toBe('download');
    expect(result.changed).toBe(true);
    expect(fs.statSync(dbPath).size).toBe(512);
  });

  it('throws actionable error when no snapshot source succeeds', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('network blocked')) as unknown as typeof fetch;

    await expect(
      ensureDocsParquet({
        dbPath,
        pluginDirectory: pluginDir,
        snapshotUrls: ['https://example.test/docs.parquet'],
      })
    ).rejects.toThrow('/refresh-docs-rescrape');
  });
});
