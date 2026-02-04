import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import {
  createDatabase,
  insertPage,
  insertPages,
  getPage,
  getAllPages,
  closeDatabase,
  type PageRecord,
} from '../db.ts';

describe('SQLite Database Layer', () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe('createDatabase', () => {
    it('returns a Database instance with pages table', () => {
      expect(db).toBeInstanceOf(Database);

      const tables = db
        .query<
          { name: string },
          []
        >("SELECT name FROM sqlite_master WHERE type='table' AND name='pages'")
        .all();
      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe('pages');
    });

    it('has correct schema columns', () => {
      const columns = db
        .query<{ name: string; type: string }, []>('PRAGMA table_info(pages)')
        .all();
      const columnNames = columns.map((c) => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('url');
      expect(columnNames).toContain('title');
      expect(columnNames).toContain('content');
      expect(columnNames).toContain('word_count');
      expect(columnNames).toContain('meta');
      expect(columnNames).toContain('fetched_at');
    });
  });

  describe('insertPage', () => {
    it('stores a page retrievable by URL', () => {
      const page: PageRecord = {
        url: 'https://example.com/docs/getting-started',
        title: 'Getting Started',
        content: 'Welcome to the docs.',
        wordCount: 4,
        meta: { section: 'intro' },
        fetchedAt: new Date().toISOString(),
      };

      insertPage(db, page);

      const result = getPage(db, page.url);
      expect(result).not.toBeNull();
      expect(result!.url).toBe(page.url);
      expect(result!.title).toBe(page.title);
      expect(result!.content).toBe(page.content);
      expect(result!.wordCount).toBe(page.wordCount);
      expect(result!.meta).toEqual({ section: 'intro' });
      expect(result!.fetchedAt).toBe(page.fetchedAt);
    });
  });

  describe('insertPages', () => {
    it('bulk inserts multiple pages within a transaction', () => {
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

      insertPages(db, pages);

      const all = getAllPages(db);
      expect(all).toHaveLength(3);
    });
  });

  describe('getPage', () => {
    it('returns full page record for existing URL', () => {
      const page: PageRecord = {
        url: 'https://example.com/docs/api',
        title: 'API Reference',
        content: 'Full API documentation content here.',
        wordCount: 5,
        meta: { version: '2.0' },
        fetchedAt: '2025-01-15T10:30:00.000Z',
      };

      insertPage(db, page);
      const result = getPage(db, page.url);

      expect(result).toEqual(page);
    });

    it('returns null for non-existent URL', () => {
      const result = getPage(db, 'https://example.com/does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('getAllPages', () => {
    it('returns all pages with url and title only', () => {
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

      insertPages(db, pages);
      const all = getAllPages(db);

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
  });

  describe('upsert behavior', () => {
    it('duplicate URL insert updates existing record', () => {
      const original: PageRecord = {
        url: 'https://example.com/docs/upsert-test',
        title: 'Original Title',
        content: 'Original content.',
        wordCount: 2,
        meta: { version: '1' },
        fetchedAt: '2025-01-01T00:00:00.000Z',
      };

      const updated: PageRecord = {
        url: 'https://example.com/docs/upsert-test',
        title: 'Updated Title',
        content: 'Updated content with more words.',
        wordCount: 5,
        meta: { version: '2' },
        fetchedAt: '2025-02-01T00:00:00.000Z',
      };

      insertPage(db, original);
      insertPage(db, updated);

      const count = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM pages').get();
      expect(count!.count).toBe(1);

      const result = getPage(db, updated.url);
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Updated Title');
      expect(result!.content).toBe('Updated content with more words.');
      expect(result!.wordCount).toBe(5);
      expect(result!.meta).toEqual({ version: '2' });
      expect(result!.fetchedAt).toBe('2025-02-01T00:00:00.000Z');
    });
  });

  describe('closeDatabase', () => {
    it('closes database cleanly', () => {
      const tempDb = createDatabase(':memory:');
      expect(() => closeDatabase(tempDb)).not.toThrow();
    });
  });
});
