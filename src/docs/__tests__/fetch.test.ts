import { describe, it, expect, vi, afterEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encode } from 'cborg';
import {
  PAGEFIND_BASE,
  PAGEFIND_HEADER_SIZE,
  DEFAULT_CONCURRENCY,
  MAX_RETRIES,
  decompressPagefind,
  fetchEntryPoint,
  fetchFragment,
  fetchAndParseMeta,
  fetchAllDocs,
  type PagefindEntry,
} from '../fetch.ts';

function makePagefindBuffer(payload: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode('pagefind_dcd');
  const withHeader = new Uint8Array(header.length + payload.length);
  withHeader.set(header);
  withHeader.set(payload, header.length);
  return new Uint8Array(gzipSync(Buffer.from(withHeader)));
}

function makeMetaBuffer(pages: Array<{ page_hash: string; word_count: number }>): Uint8Array {
  const pagesArray = pages.map((p) => [p.page_hash, p.word_count]);
  const cbor = encode(['1.0.0', pagesArray, [], [], []]);
  return makePagefindBuffer(new Uint8Array(cbor));
}

function makeFragmentBuffer(fragment: Record<string, unknown>): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(fragment));
  return makePagefindBuffer(json);
}

function toArrayBuffer(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function setMockFetch(mock: ReturnType<typeof vi.fn>): void {
  globalThis.fetch = mock as unknown as typeof fetch;
}

describe('Pagefind Fetcher', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constants', () => {
    it('exports expected constants', () => {
      expect(PAGEFIND_BASE).toBe('https://www.palantir.com/docs/pagefind');
      expect(PAGEFIND_HEADER_SIZE).toBe(12);
      expect(DEFAULT_CONCURRENCY).toBe(15);
      expect(MAX_RETRIES).toBe(3);
    });
  });

  describe('decompressPagefind', () => {
    it('strips 12‑byte header and gunzips the remainder', () => {
      const original = new TextEncoder().encode('hello pagefind');
      const buf = makePagefindBuffer(original);

      const result = decompressPagefind(buf);
      expect(new TextDecoder().decode(result)).toBe('hello pagefind');
    });

    it('throws on invalid gzip data', () => {
      const invalid = new Uint8Array(8);
      expect(() => decompressPagefind(invalid)).toThrow(/header check/i);
    });

    it('throws when decompressed data is shorter than header', () => {
      const tooShort = gzipSync(Buffer.from('short'));
      expect(() => decompressPagefind(new Uint8Array(tooShort))).toThrow(/shorter than.*12/i);
    });
  });

  describe('fetchEntryPoint', () => {
    it('returns parsed entry with language hash and page count', async () => {
      const fakeEntry: PagefindEntry = {
        version: '1.0.0',
        languages: {
          en: { hash: 'abc123', wasm: 'wasm_hash', page_count: 3618 },
        },
      };

      setMockFetch(
        vi.fn().mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(fakeEntry),
        })
      );

      const result = await fetchEntryPoint();
      expect(result).toEqual(fakeEntry);
      expect(globalThis.fetch).toHaveBeenCalledWith(`${PAGEFIND_BASE}/pagefind-entry.json`);
    });

    it('throws when response is not ok', async () => {
      setMockFetch(
        vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
      );

      await expect(fetchEntryPoint()).rejects.toThrow(/404/i);
    });
  });

  describe('fetchFragment', () => {
    it('returns parsed page data from mocked response', async () => {
      const fragment = {
        url: '/docs/foundry/getting-started',
        content: 'Welcome to Foundry.',
        meta: { title: 'Getting Started' },
        word_count: 3,
        filters: { section: ['intro'] },
        anchors: [],
      };
      const buf = makeFragmentBuffer(fragment);

      setMockFetch(
        vi.fn().mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(buf)),
        })
      );

      const result = await fetchFragment('somehash');
      expect(result.url).toBe('/docs/foundry/getting-started');
      expect(result.title).toBe('Getting Started');
      expect(result.content).toBe('Welcome to Foundry.');
      expect(result.wordCount).toBe(3);
      expect(result.meta).toEqual(
        expect.objectContaining({ filters: { section: ['intro'] }, anchors: [] })
      );
      expect(result.fetchedAt).toBeDefined();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${PAGEFIND_BASE}/fragment/somehash.pf_fragment`
      );
    });
  });

  describe('fetchAndParseMeta', () => {
    it('fetches, decompresses, CBOR‑decodes, and returns page hashes', async () => {
      const pages = [
        { page_hash: 'hash_a', word_count: 100 },
        { page_hash: 'hash_b', word_count: 200 },
        { page_hash: 'hash_c', word_count: 50 },
      ];
      const buf = makeMetaBuffer(pages);

      setMockFetch(
        vi.fn().mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(toArrayBuffer(buf)),
        })
      );

      const hashes = await fetchAndParseMeta('lang_hash_123');
      expect(hashes).toEqual(['hash_a', 'hash_b', 'hash_c']);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${PAGEFIND_BASE}/pagefind.lang_hash_123.pf_meta`
      );
    });
  });

  describe('concurrency control', () => {
    it('caps parallel requests to DEFAULT_CONCURRENCY', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const entryResponse = {
        version: '1.0.0',
        languages: { en: { hash: 'testhash', wasm: 'w', page_count: 30 } },
      };

      const pages = Array.from({ length: 30 }, (_, i) => ({
        page_hash: `page_${i}`,
        word_count: 10,
      }));
      const metaBuf = makeMetaBuffer(pages);

      const fragment = {
        url: '/docs/test',
        content: 'test',
        meta: { title: 'Test' },
        word_count: 10,
        filters: {},
        anchors: [],
      };
      const fragBuf = makeFragmentBuffer(fragment);

      setMockFetch(
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('pagefind-entry.json')) {
            return { ok: true, json: () => Promise.resolve(entryResponse) };
          }
          if (url.includes('pf_meta')) {
            return { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(metaBuf)) };
          }
          concurrent++;
          if (concurrent > maxConcurrent) maxConcurrent = concurrent;
          await new Promise((r) => setTimeout(r, 20));
          concurrent--;
          return { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(fragBuf)) };
        })
      );

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await fetchAllDocs(':memory:');
      consoleSpy.mockRestore();

      expect(maxConcurrent).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
      expect(maxConcurrent).toBeGreaterThan(1);
    });
  });

  describe('retry with exponential backoff', () => {
    it('retries on 5xx errors with increasing delays', async () => {
      const callTimes: number[] = [];

      const fragment = {
        url: '/docs/retry-test',
        content: 'recovered',
        meta: { title: 'Retry' },
        word_count: 1,
        filters: {},
        anchors: [],
      };
      const fragBuf = makeFragmentBuffer(fragment);

      let callCount = 0;
      setMockFetch(
        vi.fn().mockImplementation(async () => {
          callTimes.push(Date.now());
          callCount++;
          if (callCount <= 2) {
            return { ok: false, status: 503, statusText: 'Service Unavailable' };
          }
          return { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(fragBuf)) };
        })
      );

      const result = await fetchFragment('retry_hash');
      expect(result.url).toBe('/docs/retry-test');
      expect(callCount).toBe(3);

      if (callTimes.length >= 3) {
        const delay1 = callTimes[1] - callTimes[0];
        const delay2 = callTimes[2] - callTimes[1];
        // delay1 ≈ 1000ms (±25% jitter → 750–1250), delay2 ≈ 2000ms (±25% → 1500–2500)
        expect(delay1).toBeGreaterThanOrEqual(700);
        expect(delay2).toBeGreaterThan(delay1 * 0.9);
      }
    }, 15000);

    it('does NOT retry on 404 errors', async () => {
      let callCount = 0;
      setMockFetch(
        vi.fn().mockImplementation(async () => {
          callCount++;
          return { ok: false, status: 404, statusText: 'Not Found' };
        })
      );

      await expect(fetchFragment('missing_hash')).rejects.toThrow(/404/);
      expect(callCount).toBe(1);
    });
  });

  describe('partial failure handling', () => {
    it('failed pages are logged and skipped, not thrown', async () => {
      const entryResponse = {
        version: '1.0.0',
        languages: { en: { hash: 'testhash', wasm: 'w', page_count: 3 } },
      };

      const pages = [
        { page_hash: 'good_1', word_count: 10 },
        { page_hash: 'bad_1', word_count: 10 },
        { page_hash: 'good_2', word_count: 10 },
      ];
      const metaBuf = makeMetaBuffer(pages);

      const fragment = {
        url: '/docs/good',
        content: 'good content',
        meta: { title: 'Good' },
        word_count: 10,
        filters: {},
        anchors: [],
      };
      const fragBuf = makeFragmentBuffer(fragment);

      setMockFetch(
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('pagefind-entry.json')) {
            return { ok: true, json: () => Promise.resolve(entryResponse) };
          }
          if (url.includes('pf_meta')) {
            return { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(metaBuf)) };
          }
          if (url.includes('bad_1')) {
            return { ok: false, status: 404, statusText: 'Not Found' };
          }
          return { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(fragBuf)) };
        })
      );

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await fetchAllDocs(':memory:');
      consoleSpy.mockRestore();

      expect(result.totalPages).toBe(3);
      expect(result.fetchedPages).toBe(2);
      expect(result.failedUrls).toHaveLength(1);
      expect(result.failedUrls[0]).toContain('bad_1');
    });
  });

  describe('fetchAllDocs', () => {
    it('orchestrates full pipeline end‑to‑end with mocked network', async () => {
      const entryResponse = {
        version: '1.0.0',
        languages: { en: { hash: 'lang_abc', wasm: 'w', page_count: 2 } },
      };

      const pages = [
        { page_hash: 'page_x', word_count: 50 },
        { page_hash: 'page_y', word_count: 75 },
      ];
      const metaBuf = makeMetaBuffer(pages);

      const fragments: Record<string, Record<string, unknown>> = {
        page_x: {
          url: '/docs/foundry/alpha',
          content: 'Alpha content',
          meta: { title: 'Alpha' },
          word_count: 50,
          filters: {},
          anchors: [],
        },
        page_y: {
          url: '/docs/foundry/beta',
          content: 'Beta content',
          meta: { title: 'Beta' },
          word_count: 75,
          filters: {},
          anchors: [],
        },
      };

      setMockFetch(
        vi.fn().mockImplementation(async (url: string) => {
          if (url.includes('pagefind-entry.json')) {
            return { ok: true, json: () => Promise.resolve(entryResponse) };
          }
          if (url.includes('pf_meta')) {
            return { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(metaBuf)) };
          }
          const hashMatch = url.match(/fragment\/(.+)\.pf_fragment/);
          if (hashMatch && fragments[hashMatch[1]]) {
            const buf = makeFragmentBuffer(fragments[hashMatch[1]]);
            return { ok: true, arrayBuffer: () => Promise.resolve(toArrayBuffer(buf)) };
          }
          return { ok: false, status: 404, statusText: 'Not Found' };
        })
      );

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await fetchAllDocs(':memory:');
      consoleSpy.mockRestore();

      expect(result.totalPages).toBe(2);
      expect(result.fetchedPages).toBe(2);
      expect(result.failedUrls).toHaveLength(0);
      expect(result.dbPath).toBe(':memory:');
    });
  });
});
