import { Database } from 'bun:sqlite';

export type PageRecord = {
  url: string;
  title: string;
  content: string;
  wordCount: number;
  meta: Record<string, unknown>;
  fetchedAt: string;
};

type PageRow = {
  id: number;
  url: string;
  title: string;
  content: string;
  word_count: number;
  meta: string;
  fetched_at: string;
};

type PageListing = {
  url: string;
  title: string;
};

const CREATE_PAGES_TABLE = `
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    content TEXT,
    word_count INTEGER,
    meta TEXT,
    fetched_at TEXT
  )
`;

const UPSERT_PAGE = `
  INSERT INTO pages (url, title, content, word_count, meta, fetched_at)
  VALUES ($url, $title, $content, $wordCount, $meta, $fetchedAt)
  ON CONFLICT(url) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    word_count = excluded.word_count,
    meta = excluded.meta,
    fetched_at = excluded.fetched_at
`;

export function createDatabase(path: string): Database {
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(CREATE_PAGES_TABLE);
  return db;
}

export function insertPage(db: Database, page: PageRecord): void {
  db.query(UPSERT_PAGE).run({
    $url: page.url,
    $title: page.title,
    $content: page.content,
    $wordCount: page.wordCount,
    $meta: JSON.stringify(page.meta),
    $fetchedAt: page.fetchedAt,
  });
}

export function insertPages(db: Database, pages: PageRecord[]): void {
  const insert = db.transaction((batch: PageRecord[]) => {
    for (const page of batch) {
      insertPage(db, page);
    }
  });
  insert(pages);
}

export function getPage(db: Database, url: string): PageRecord | null {
  const row = db.query<PageRow, [string]>('SELECT * FROM pages WHERE url = ?').get(url);

  if (!row) {
    return null;
  }

  return {
    url: row.url,
    title: row.title,
    content: row.content,
    wordCount: row.word_count,
    meta: JSON.parse(row.meta) as Record<string, unknown>,
    fetchedAt: row.fetched_at,
  };
}

export function getAllPages(db: Database): PageListing[] {
  return db.query<PageListing, []>('SELECT url, title FROM pages').all();
}

export function closeDatabase(db: Database): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}
