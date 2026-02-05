# palantir-opencode-plugin

OpenCode plugin that provides Palantir Foundry documentation to AI agents via local Parquet storage.

## Features

- Fetches all ~3,600 pages from Palantir's public documentation
- Stores in local Parquet file for fast offline access (~17MB)
- Exposes `get_doc_page` and `list_all_docs` tools for AI agents

## Setup

```bash
bun install
```

## Fetching Documentation

Fetch all Palantir docs into `data/docs.parquet` (~2 minutes, ~17MB file):

```bash
bun run src/docs/fetch-cli.ts
```

## Querying the Data

### Schema

The Parquet file contains a single row group with the following columns:

| Column       | Type    | Description                         |
| ------------ | ------- | ----------------------------------- |
| `url`        | string  | Page URL path (e.g. `/foundry/...`) |
| `title`      | string  | Page title                          |
| `content`    | string  | Full page content (Markdown)        |
| `word_count` | integer | Word count of content               |
| `meta`       | string  | JSON-encoded metadata               |
| `fetched_at` | string  | ISO 8601 timestamp of when fetched  |

### Bun

```typescript
import { parquetReadObjects } from 'hyparquet';

const file = await Bun.file('data/docs.parquet').arrayBuffer();

// List all pages (url + title only)
const pages = await parquetReadObjects({ file, columns: ['url', 'title'] });
console.log(`${pages.length} pages`);

// Search by title
const matches = pages.filter((p) => p.title.includes('Pipeline'));
console.log(matches.slice(0, 10));

// Get a specific page's content by row index
const urlToRow = new Map(pages.map((p, i) => [p.url, i]));
const rowIndex = urlToRow.get('/foundry/ontology/overview/');
if (rowIndex !== undefined) {
  const [page] = await parquetReadObjects({
    file,
    rowStart: rowIndex,
    rowEnd: rowIndex + 1,
  });
  console.log(page.content);
}
```

## OpenCode Tools

When installed as an OpenCode plugin, exposes:

- **`get_doc_page`** - Retrieve a specific doc page by URL
- **`list_all_docs`** - List all available documentation pages
- **`/refresh-docs`** - Command hook to re-fetch all documentation

### Installing in OpenCode (this project only)

Symlink the built artifact into the project-level auto-discovered plugins directory:

```bash
mkdir -p .opencode/plugins
```

```bash
ln -s ../../dist/index.js .opencode/plugins/palantir.js
```

OpenCode automatically loads any `.js`/`.ts` files in `.opencode/plugins/` at startup.

## Development

Build the plugin:

```bash
mise run build
```

Run tests:

```bash
mise run test
```

Smoke test the built artifact (build + verify tools load from `dist/index.js`):

```bash
mise run smoke
```

Lint code:

```bash
mise run lint
```

Format with Prettier:

```bash
mise run format
```

## Author

Anand Pant <anand@shpit.dev>
