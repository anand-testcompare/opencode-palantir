# opencode-palantir

[![npm](https://img.shields.io/npm/v/@openontology/opencode-palantir?logo=npm&label=npm)](https://www.npmjs.com/package/@openontology/opencode-palantir)
[![downloads](https://img.shields.io/npm/dm/@openontology/opencode-palantir?logo=npm&label=downloads)](https://www.npmjs.com/package/@openontology/opencode-palantir)
![CI](https://img.shields.io/github/actions/workflow/status/anand-testcompare/opencode-palantir/pr.yml?branch=main&label=CI&logo=github)
![bun](https://img.shields.io/badge/bun-1.3.2-000000?logo=bun&logoColor=white)
![@opencode-ai/plugin](https://img.shields.io/github/package-json/dependency-version/anand-testcompare/opencode-palantir/dev/%40opencode-ai%2Fplugin?label=opencode%20plugin%20api&logo=npm)
![palantir-mcp](https://img.shields.io/npm/v/palantir-mcp?logo=npm&label=palantir-mcp)
![hyparquet](https://img.shields.io/github/package-json/dependency-version/anand-testcompare/opencode-palantir/hyparquet?label=hyparquet&logo=npm)

OpenCode plugin that provides:

- Palantir public documentation tools backed by a local Parquet database
- Foundry MCP bootstrapping helpers (commands, agents, and optional auto-bootstrap)

NPM package: https://www.npmjs.com/package/@openontology/opencode-palantir

## Supported OS

- Supported: macOS, Linux
- Windows: not supported (WSL2 might work, but we don’t debug Windows-specific issues)

## Install (OpenCode)

Add the plugin in your OpenCode config (`opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@openontology/opencode-palantir@^0.1.4"]
}
```

Restart OpenCode.

After enabling the plugin, OpenCode will automatically register:

- Tools: `get_doc_page`, `list_all_docs`
- Commands: `/refresh-docs`, `/refresh-docs-rescrape`, `/setup-palantir-mcp`, `/rescan-palantir-mcp-tools`
- Agents: `foundry-librarian`, `foundry`

### Versions: how to get the latest

Prefer **pinned** or **semver range** installs (like `@^0.1.4`), and update intentionally.

Avoid using `@latest` in config:

- it can make startup slower (npm resolution/install on startup)
- it makes behavior less deterministic
- depending on caching, you may not get the upgrade behavior you expect

To find the newest version and changelog:

- NPM versions: https://www.npmjs.com/package/@openontology/opencode-palantir
- GitHub releases: https://github.com/anand-testcompare/opencode-palantir/releases
- Repo changelog: `CHANGELOG.md`

### (Optional) Install per-project

In your project repo, add the plugin as a dependency inside `.opencode/` (keeps plugin deps separate
from your app deps):

```bash
mkdir -p .opencode

cat > .opencode/package.json <<'EOF'
{
  "dependencies": {
    "@openontology/opencode-palantir": "^0.1.4"
  }
}
EOF

(cd .opencode && bun install)
```

Then create a tiny wrapper file in `.opencode/plugins/`:

```bash
mkdir -p .opencode/plugins

cat > .opencode/plugins/opencode-palantir.js <<'EOF'
import plugin from '@openontology/opencode-palantir';

export default plugin;
EOF
```

OpenCode automatically loads `.js`/`.ts` files from `.opencode/plugins/` at startup.

## Environment variables (Foundry MCP)

This plugin never writes secrets to disk. In `opencode.jsonc`, the token is always referenced as
`{env:FOUNDRY_TOKEN}`.

### Variables

- `FOUNDRY_URL`
  - Foundry base URL (used for auto-bootstrap and can be used as a default for `/setup-palantir-mcp`)
  - Example: `https://YOUR-STACK.palantirfoundry.com`
- `FOUNDRY_TOKEN`
  - Foundry token used by `palantir-mcp` for tool discovery
  - Must be exported (not just set in a shell)

### Recommended setup (zsh, macOS/Linux)

Use your existing shell secrets file. For example, if you already source `~/.shell_secrets` from
`~/.zshrc`, add:

```zsh
export FOUNDRY_URL='https://YOUR-STACK.palantirfoundry.com'
export FOUNDRY_TOKEN='YOUR_TOKEN'
```

Lock it down:

```bash
chmod 600 ~/.shell_secrets
```

Ensure `~/.zshrc` sources it:

```zsh
if [ -f "$HOME/.shell_secrets" ]; then
  source "$HOME/.shell_secrets"
fi
```

If you still see “token not exported” errors, verify `echo $FOUNDRY_TOKEN` prints a value and that
it’s `export`ed in the environment where OpenCode is launched.

## Docs tools (Palantir public docs)

The docs DB is a local file:

- `data/docs.parquet` (in your repo root)

### First run behavior

On startup and tool usage, the plugin automatically ensures `data/docs.parquet` exists by using a
prebuilt snapshot (download/copy). In most repos, docs tools should work without any manual setup.

### Refresh commands

- `/refresh-docs` (recommended)
  - Force refresh from a prebuilt snapshot (no live rescrape)
- `/refresh-docs-rescrape` (unsafe/experimental fallback)
  - Live-rescrapes palantir.com docs and rebuilds `data/docs.parquet`
  - Use only when snapshot download/copy is blocked

### Tools

- `get_doc_page`
  - Retrieve a doc page by URL, or fuzzy match by query
- `list_all_docs`
  - List docs with pagination and optional query/scope filtering

## Foundry MCP helpers

This plugin registers Foundry commands and agents automatically at startup (config-driven).

### Auto-bootstrap (no command required)

If you set both `FOUNDRY_TOKEN` and `FOUNDRY_URL`, the plugin will automatically and idempotently
patch repo-root `opencode.jsonc` to initialize:

- `mcp.palantir-mcp` local server config
- global tool deny: `tools.palantir-mcp_* = false`
- per-agent allow/deny toggles under `foundry-librarian` and `foundry`

### Guided setup and maintenance

- `/setup-palantir-mcp <foundry_api_url>`
  - Creates/patches repo-root `opencode.jsonc`
  - Adds `mcp.palantir-mcp` (if missing) as a local `npx palantir-mcp --foundry-api-url ...` server
  - Enforces global deny: `tools.palantir-mcp_* = false`
  - Creates `foundry-librarian` and `foundry` agents
  - Discovers `palantir-mcp` tools and writes explicit `true/false` toggles under each agent
- `/rescan-palantir-mcp-tools`
  - Re-discovers the `palantir-mcp` tool list and adds missing explicit toggles
  - Never overwrites existing `palantir-mcp_*` toggles

### About palantir-mcp versions (important)

The generated MCP server uses `npx -y palantir-mcp ...` by default.

Notes:

- First run can be slow (npx may need to download/install).
- `@latest` / unpinned installs are less deterministic.

Recommendation: once you’re set up, pin the version in `opencode.jsonc`:

```jsonc
{
  "mcp": {
    "palantir-mcp": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "palantir-mcp@<version>",
        "--foundry-api-url",
        "https://YOUR-STACK.palantirfoundry.com"
      ]
    }
  }
}
```

## Development (this repo)

### Setup

```bash
mise run setup
```

### Common tasks

- Build: `mise run build`
- Test: `mise run test`
- Lint: `mise run lint`
- Typecheck: `mise run typecheck`
- Format: `mise run format`

### Smoke test the built artifact

```bash
mise run smoke
```

### Fetch docs parquet (local dev)

Fetch all Palantir docs into `data/docs.parquet` (~2 minutes, ~17MB file):

```bash
bun run src/docs/fetch-cli.ts
```

### Parquet schema (local dev)

The Parquet file contains a single row group with the following columns:

| Column       | Type    | Description                         |
| ------------ | ------- | ----------------------------------- |
| `url`        | string  | Page URL path (e.g. `/foundry/...`) |
| `title`      | string  | Page title                          |
| `content`    | string  | Full page content (Markdown)        |
| `word_count` | integer | Word count of content               |
| `meta`       | string  | JSON-encoded metadata               |
| `fetched_at` | string  | ISO 8601 timestamp of when fetched  |

Example (Bun):

```typescript
import { parquetReadObjects } from 'hyparquet';

const file = await Bun.file('data/docs.parquet').arrayBuffer();

// List all pages (url + title only)
const pages = await parquetReadObjects({ file, columns: ['url', 'title'] });
console.log(`${pages.length} pages`);
```

## Release notes

For maintainers, see `RELEASING.md`.

## Author

Anand Pant <anand@shpit.dev>
