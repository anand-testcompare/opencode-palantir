# opencode-palantir

OpenCode plugin that provides **Palantir Foundry documentation** to AI agents via a local Parquet
database.

## Features

- Fetches all ~3,600 pages from Palantir's public documentation
- Stores in a local Parquet file for fast offline access (~17MB)
- Exposes `get_doc_page` and `list_all_docs` tools for AI agents

## Quick start (OpenCode users)

### 1) Enable the plugin in `opencode.json` / `opencode.jsonc`

Add the plugin to your OpenCode config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openontology/opencode-palantir@^0.1.1"]
}
```

Restart OpenCode.

### 2) (Optional) Install per-project

In your project repo, add the plugin as a dependency inside `.opencode/` (keeps plugin deps separate
from your app deps):

```bash
mkdir -p .opencode

cat > .opencode/package.json <<'EOF'
{
  "dependencies": {
    "@openontology/opencode-palantir": "^0.1.1"
  }
}
EOF

(cd .opencode && bun install)
```

Then create a tiny wrapper file in `.opencode/plugins/`:

Create a tiny wrapper file in `.opencode/plugins/`:

```bash
mkdir -p .opencode/plugins

cat > .opencode/plugins/opencode-palantir.js <<'EOF'
import plugin from '@openontology/opencode-palantir';

export default plugin;
EOF
```

OpenCode automatically loads `.js`/`.ts` files from `.opencode/plugins/` at startup.

> If your OpenCode setup uses an `opencode.json` / `opencode.jsonc` that restricts plugin loading,
> make sure `.opencode/plugins/` (or the specific plugin file) is included.

### 3) Get `docs.parquet`

This package does **not** ship with docs bundled. You have two options:

#### Option A (recommended): fetch inside OpenCode

In OpenCode, run:

- `/refresh-docs`

This downloads the docs and writes them to `data/docs.parquet` in your project root.

#### Option B: download a prebuilt Parquet file

Download `data/docs.parquet` from this GitHub repo and place it at:

- `<your-project>/data/docs.parquet`

## Using the tools

When installed, this plugin exposes:

- **`get_doc_page`** - Retrieve a specific doc page by URL
- **`list_all_docs`** - List all available documentation pages

If `data/docs.parquet` is missing, both tools will instruct you to run `/refresh-docs`.

## Foundry MCP setup helpers

This plugin also provides two OpenCode commands to set up `palantir-mcp` with project-scoped tool
gating and Foundry sub-agents:

- **`/setup-palantir-mcp <foundry_api_url>`**
  - Creates/patches repo-root `opencode.jsonc`
  - Adds `mcp.palantir-mcp` (if missing) as a local `npx palantir-mcp --foundry-api-url ...` server
  - Enforces global deny: `tools.palantir-mcp_* = false`
  - Creates `foundry-librarian` and `foundry` agents
  - Dynamically discovers the current `palantir-mcp` tool list and writes explicit `true/false`
    per-tool toggles under each Foundry agent
- **`/rescan-palantir-mcp-tools`**
  - Re-discovers the `palantir-mcp` tool list and adds any missing explicit toggles
  - Never overwrites existing `palantir-mcp_*` toggles

Auth is always env-only. The token is referenced as `{env:FOUNDRY_TOKEN}` and is never written to
disk.

## Setup (this repo)

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

### Installing in OpenCode (this repo only)

For local development against `dist/`, you can point the wrapper at the built artifact:

```bash
mkdir -p .opencode/plugins

cat > .opencode/plugins/opencode-palantir.js <<'EOF'
import plugin from '../../dist/index.js';

export default plugin;
EOF
```

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

## Release notes

For maintainers, see `RELEASING.md`.

## Author

Anand Pant <anand@shpit.dev>
