# palantir-opencode-plugin

OpenCode plugin that provides Palantir Foundry documentation to AI agents via local SQLite storage.

## Features

- Fetches all ~3,600 pages from Palantir's public documentation
- Stores in local SQLite for fast offline access
- Exposes `get_doc_page` and `list_all_docs` tools for AI agents

## Setup

```bash
bun install
```

## Fetching Documentation

Fetch all Palantir docs into `data/docs.db`:

```bash
bun run src/docs/fetch-cli.ts
```

This takes ~2 minutes and creates a ~16MB database.

## Querying the Database

The SQLite database stores pages with this schema:

```sql
CREATE TABLE pages (
  url TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  word_count INTEGER,
  meta TEXT,        -- JSON blob
  fetched_at TEXT
);
CREATE INDEX idx_title ON pages(title);
CREATE VIRTUAL TABLE pages_fts USING fts5(url, title, content);
```

### Direct SQLite queries

```bash
# Count pages
sqlite3 data/docs.db "SELECT COUNT(*) FROM pages"

# Search by title
sqlite3 data/docs.db "SELECT url, title FROM pages WHERE title LIKE '%Pipeline%' LIMIT 10"

# Full-text search
sqlite3 data/docs.db "SELECT url, title FROM pages_fts WHERE pages_fts MATCH 'ontology' LIMIT 10"

# Get page content
sqlite3 data/docs.db "SELECT content FROM pages WHERE url = '/foundry/ontology/overview/'"
```

### Using Bun

```typescript
import Database from 'bun:sqlite';

const db = new Database('data/docs.db', { readonly: true });

// List all pages
const pages = db.query('SELECT url, title FROM pages').all();

// Full-text search
const results = db
  .query(
    `
  SELECT url, title, snippet(pages_fts, 2, '**', '**', '...', 30) as excerpt
  FROM pages_fts
  WHERE pages_fts MATCH ?
  LIMIT 10
`
  )
  .all('transforms');

db.close();
```

## OpenCode Tools

When installed as an OpenCode plugin, exposes:

- **`get_doc_page`** - Retrieve a specific doc page by URL
- **`list_all_docs`** - List all available documentation pages

## Development

```bash
mise run build    # Build the plugin
mise run test     # Run tests
mise run lint     # Lint code
mise run format   # Format with Prettier
```

## Author

Anand Pant <anand@shpit.dev>
