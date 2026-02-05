import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeParquet } from '../write-parquet.ts';
import { createDatabase, getPage, getAllPages, closeDatabase, type PageRecord } from '../db.ts';

describe('Parquet Database Layer', () => {
  let tmpDir: string;
  let parquetPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
    parquetPath = path.join(tmpDir, 'test.parquet');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createDatabase', () => {
    it('loads Parquet file and returns a ParquetStore with index', async () => {
      const pages: PageRecord[] = [
        {
          url: 'https://example.com/docs/getting-started',
          title: 'Getting Started',
          content: 'Welcome to the docs.',
          wordCount: 4,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
      ];

      await writeParquet(pages, parquetPath);
      const store = await createDatabase(parquetPath);

      expect(store).toBeDefined();
      expect(store.file).toBeInstanceOf(ArrayBuffer);
      expect(store.index).toHaveLength(1);
      expect(store.index[0].url).toBe('https://example.com/docs/getting-started');
      expect(store.index[0].title).toBe('Getting Started');
      expect(store.urlToRow.size).toBe(1);
    });

    it('builds correct url-to-row index for multiple pages', async () => {
      const pages: PageRecord[] = [
        {
          url: 'https://example.com/a',
          title: 'Page A',
          content: 'Content A',
          wordCount: 2,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
        {
          url: 'https://example.com/b',
          title: 'Page B',
          content: 'Content B',
          wordCount: 2,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
      ];

      await writeParquet(pages, parquetPath);
      const store = await createDatabase(parquetPath);

      expect(store.urlToRow.get('https://example.com/a')).toBe(0);
      expect(store.urlToRow.get('https://example.com/b')).toBe(1);
    });
  });

  describe('getPage', () => {
    it('returns full page record for existing URL', async () => {
      const page: PageRecord = {
        url: 'https://example.com/docs/api',
        title: 'API Reference',
        content: 'Full API documentation content here.',
        wordCount: 5,
        meta: { version: '2.0' },
        fetchedAt: '2025-01-15T10:30:00.000Z',
      };

      await writeParquet([page], parquetPath);
      const store = await createDatabase(parquetPath);
      const result = await getPage(store, page.url);

      expect(result).not.toBeNull();
      expect(result!.url).toBe(page.url);
      expect(result!.title).toBe(page.title);
      expect(result!.content).toBe(page.content);
      expect(result!.wordCount).toBe(page.wordCount);
      expect(result!.meta).toEqual({ version: '2.0' });
      expect(result!.fetchedAt).toBe(page.fetchedAt);
    });

    it('returns null for non-existent URL', async () => {
      const pages: PageRecord[] = [
        {
          url: 'https://example.com/exists',
          title: 'Exists',
          content: 'Content',
          wordCount: 1,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
      ];

      await writeParquet(pages, parquetPath);
      const store = await createDatabase(parquetPath);
      const result = await getPage(store, 'https://example.com/does-not-exist');

      expect(result).toBeNull();
    });
  });

  describe('getAllPages', () => {
    it('returns all pages with url and title only', async () => {
      const pages: PageRecord[] = [
        {
          url: 'https://example.com/a',
          title: 'Page A',
          content: 'Long content A that should not appear in listing.',
          wordCount: 9,
          meta: { heavy: 'data' },
          fetchedAt: new Date().toISOString(),
        },
        {
          url: 'https://example.com/b',
          title: 'Page B',
          content: 'Long content B that should not appear in listing.',
          wordCount: 9,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
      ];

      await writeParquet(pages, parquetPath);
      const store = await createDatabase(parquetPath);
      const all = getAllPages(store);

      expect(all).toHaveLength(2);
      for (const entry of all) {
        expect(entry).toHaveProperty('url');
        expect(entry).toHaveProperty('title');
        expect(entry).not.toHaveProperty('content');
        expect(entry).not.toHaveProperty('wordCount');
        expect(entry).not.toHaveProperty('meta');
        expect(entry).not.toHaveProperty('fetchedAt');
      }
    });

    it('returns empty array for empty Parquet file', async () => {
      await writeParquet([], parquetPath);
      const store = await createDatabase(parquetPath);
      const all = getAllPages(store);

      expect(all).toHaveLength(0);
    });
  });

  describe('closeDatabase', () => {
    it('clears store data without error', async () => {
      const pages: PageRecord[] = [
        {
          url: 'https://example.com/close-test',
          title: 'Close Test',
          content: 'Content',
          wordCount: 1,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
      ];

      await writeParquet(pages, parquetPath);
      const store = await createDatabase(parquetPath);

      expect(() => closeDatabase(store)).not.toThrow();
      expect(store.index).toHaveLength(0);
      expect(store.urlToRow.size).toBe(0);
    });
  });

  describe('full round-trip', () => {
    it('writes pages to Parquet and reads them back correctly', async () => {
      const pages: PageRecord[] = [
        {
          url: 'https://example.com/docs/page-1',
          title: 'Page 1',
          content: 'Content one.',
          wordCount: 2,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
        {
          url: 'https://example.com/docs/page-2',
          title: 'Page 2',
          content: 'Content two.',
          wordCount: 2,
          meta: { tag: 'test' },
          fetchedAt: new Date().toISOString(),
        },
        {
          url: 'https://example.com/docs/page-3',
          title: 'Page 3',
          content: 'Content three.',
          wordCount: 2,
          meta: {},
          fetchedAt: new Date().toISOString(),
        },
      ];

      await writeParquet(pages, parquetPath);
      const store = await createDatabase(parquetPath);

      const all = getAllPages(store);
      expect(all).toHaveLength(3);

      const page1 = await getPage(store, 'https://example.com/docs/page-1');
      expect(page1).not.toBeNull();
      expect(page1!.title).toBe('Page 1');
      expect(page1!.content).toBe('Content one.');

      const page2 = await getPage(store, 'https://example.com/docs/page-2');
      expect(page2).not.toBeNull();
      expect(page2!.meta).toEqual({ tag: 'test' });

      const missing = await getPage(store, 'https://example.com/docs/page-99');
      expect(missing).toBeNull();

      closeDatabase(store);
      expect(store.index).toHaveLength(0);
    });
  });
});
