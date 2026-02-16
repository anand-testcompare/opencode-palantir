import path from 'node:path';

import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin/tool';
import type { AgentConfig, Config } from '@opencode-ai/sdk';
import {
  createDatabase,
  getPage,
  getAllPages,
  closeDatabase,
  type ParquetStore,
} from './docs/db.ts';
import type { FetchProgressEvent } from './docs/fetch.ts';
import { fetchAllDocs } from './docs/fetch.ts';
import { ensureDocsParquet, type EnsureDocsParquetEvent } from './docs/snapshot.ts';
import {
  autoBootstrapPalantirMcpIfConfigured,
  rescanPalantirMcpTools,
  setupPalantirMcp,
} from './palantir-mcp/commands.ts';

const plugin: Plugin = async (input) => {
  const dbPath = path.join(input.worktree, 'data', 'docs.parquet');
  let dbInstance: ParquetStore | null = null;
  let dbInitPromise: Promise<ParquetStore> | null = null;
  let autoBootstrapMcpStarted: boolean = false;
  let autoBootstrapDocsStarted: boolean = false;

  type CommandOutput = { parts: unknown[] };
  type DocScope = 'foundry' | 'apollo' | 'gotham' | 'all';

  function formatError(err: unknown): string {
    return err instanceof Error ? err.toString() : String(err);
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    const decimals = value >= 10 || index === 0 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[index]}`;
  }

  function ensureCommandDefinitions(cfg: Config): void {
    if (!cfg.command) cfg.command = {};

    if (!cfg.command['refresh-docs']) {
      cfg.command['refresh-docs'] = {
        template: 'Refresh Palantir docs snapshot (recommended).',
        description:
          'Force refresh data/docs.parquet from a prebuilt snapshot (download/copy; no rescrape).',
      };
    }

    if (!cfg.command['refresh-docs-rescrape']) {
      cfg.command['refresh-docs-rescrape'] = {
        template: 'Refresh docs by live rescrape (unsafe/experimental).',
        description:
          'Explicit fallback: rescrape palantir.com docs and rebuild data/docs.parquet. Slower and less reliable than /refresh-docs.',
      };
    }

    if (!cfg.command['setup-palantir-mcp']) {
      cfg.command['setup-palantir-mcp'] = {
        template: 'Set up palantir-mcp for this repo.',
        description:
          'Guided MCP setup for Foundry. Usage: /setup-palantir-mcp <foundry_api_url>. Requires FOUNDRY_TOKEN for tool discovery.',
      };
    }

    if (!cfg.command['rescan-palantir-mcp-tools']) {
      cfg.command['rescan-palantir-mcp-tools'] = {
        template: 'Re-scan palantir-mcp tools and patch tool gating.',
        description:
          'Re-discovers the palantir-mcp tool list and adds missing palantir-mcp_* toggles (does not overwrite existing toggles). Requires FOUNDRY_TOKEN.',
      };
    }
  }

  function ensureAgentDefaults(
    agent: AgentConfig,
    agentName: 'foundry-librarian' | 'foundry'
  ): void {
    const defaultDescription: string =
      agentName === 'foundry-librarian'
        ? 'Foundry exploration and context gathering (parallel-friendly)'
        : 'Foundry execution agent (uses only enabled palantir-mcp tools)';

    if (agent.mode !== 'subagent' && agent.mode !== 'primary' && agent.mode !== 'all') {
      agent.mode = 'subagent';
    }

    if (typeof agent['hidden'] !== 'boolean') agent['hidden'] = false;

    if (typeof agent.description !== 'string') agent.description = defaultDescription;

    if (typeof agent.prompt !== 'string') {
      agent.prompt =
        agentName === 'foundry-librarian'
          ? [
              'You are the Foundry librarian.',
              '',
              '- Focus on exploration and context gathering.',
              '- Split independent exploration tasks and run them in parallel when possible.',
              '- Return compact summaries and cite the tool calls you ran.',
              '- Avoid dumping massive schemas unless explicitly asked.',
            ].join('\n')
          : [
              'You are the Foundry execution agent.',
              '',
              '- Use only enabled palantir-mcp tools.',
              '- Prefer working from summaries produced by @foundry-librarian.',
              '- Keep operations focused and deterministic.',
            ].join('\n');
    }

    if (!agent.tools) agent.tools = {};
    if (agentName === 'foundry-librarian') {
      if (agent.tools.get_doc_page === undefined) agent.tools.get_doc_page = true;
      if (agent.tools.list_all_docs === undefined) agent.tools.list_all_docs = true;
      return;
    }

    if (agent.tools.get_doc_page === undefined) agent.tools.get_doc_page = false;
    if (agent.tools.list_all_docs === undefined) agent.tools.list_all_docs = false;
  }

  function ensureAgentDefinitions(cfg: Config): void {
    if (!cfg.agent) cfg.agent = {};

    const librarian: AgentConfig = cfg.agent['foundry-librarian'] ?? {};
    ensureAgentDefaults(librarian, 'foundry-librarian');
    cfg.agent['foundry-librarian'] = librarian;

    const foundry: AgentConfig = cfg.agent.foundry ?? {};
    ensureAgentDefaults(foundry, 'foundry');
    cfg.agent.foundry = foundry;
  }

  function maybeStartAutoBootstrapMcp(): void {
    if (autoBootstrapMcpStarted) return;

    const token: string | undefined = process.env.FOUNDRY_TOKEN;
    const url: string | undefined = process.env.FOUNDRY_URL;
    if (!token || token.trim().length === 0) return;
    if (!url || url.trim().length === 0) return;

    autoBootstrapMcpStarted = true;
    void autoBootstrapPalantirMcpIfConfigured(input.worktree);
  }

  function maybeStartAutoBootstrapDocs(): void {
    if (autoBootstrapDocsStarted) return;
    autoBootstrapDocsStarted = true;
    void ensureDocsAvailable().catch(() => {
      // Best-effort startup bootstrap only. Tool/command paths provide actionable errors.
    });
  }

  function resetDb(): void {
    if (dbInstance) closeDatabase(dbInstance);
    dbInstance = null;
    dbInitPromise = null;
  }

  async function getDb(): Promise<ParquetStore> {
    if (dbInstance) return dbInstance;
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = createDatabase(dbPath)
      .then((created) => {
        dbInstance = created;
        return created;
      })
      .finally(() => {
        dbInitPromise = null;
      });
    return dbInitPromise;
  }

  function pushText(output: CommandOutput, text: string): void {
    output.parts.push({ type: 'text', text });
  }

  function formatSnapshotFailure(err: unknown): string {
    return [
      '[ERROR] Unable to obtain Palantir docs snapshot.',
      '',
      `Reason: ${formatError(err)}`,
      '',
      'Next steps:',
      '- Retry /refresh-docs (recommended prebuilt snapshot path).',
      '- If snapshot download is blocked, run /refresh-docs-rescrape (unsafe/experimental).',
    ].join('\n');
  }

  function formatSnapshotRefreshEvent(event: EnsureDocsParquetEvent): string | null {
    if (event.type === 'skip-existing')
      return `snapshot_status=already_present bytes=${event.bytes}`;
    if (event.type === 'download-start') return `download_attempt url=${event.url}`;
    if (event.type === 'download-failed')
      return `download_failed url=${event.url} error=${event.error}`;
    if (event.type === 'download-success')
      return `download_succeeded url=${event.url} bytes=${event.bytes}`;
    if (event.type === 'copy-start') return `copy_attempt source=${event.sourcePath}`;
    if (event.type === 'copy-success')
      return `copy_succeeded source=${event.sourcePath} bytes=${event.bytes}`;
    return null;
  }

  async function ensureDocsAvailable(
    options: {
      force?: boolean;
      onEvent?: (event: EnsureDocsParquetEvent) => void;
    } = {}
  ) {
    return ensureDocsParquet({
      dbPath,
      force: options.force === true,
      pluginDirectory: input.directory,
      onEvent: options.onEvent,
    });
  }

  async function ensureDocsReadyForTool(): Promise<string | null> {
    try {
      await ensureDocsAvailable();
      return null;
    } catch (err) {
      return formatSnapshotFailure(err);
    }
  }

  function formatRescrapeFailure(err: unknown): string {
    return [
      '[ERROR] /refresh-docs-rescrape failed.',
      '',
      `Reason: ${formatError(err)}`,
      '',
      'Try /refresh-docs for the recommended prebuilt snapshot flow.',
    ].join('\n');
  }

  function formatRescrapeProgressEvent(
    event: FetchProgressEvent,
    progressLines: string[],
    failureSamples: string[]
  ): void {
    if (event.type === 'discovered') {
      progressLines.push(`discovered_pages=${event.totalPages}`);
      return;
    }

    if (event.type === 'progress') {
      progressLines.push(`processed_pages=${event.processedPages}/${event.totalPages}`);
      return;
    }

    if (event.type === 'page-failed') {
      if (failureSamples.length < 5) {
        failureSamples.push(`url=${event.url} error=${event.error}`);
      }
      return;
    }
  }

  function toPathname(inputUrl: string): string {
    const trimmed: string = inputUrl.trim();
    if (trimmed.length === 0) return '';

    // Handle full URLs like https://www.palantir.com/docs/foundry/... or bare "www....".
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        return new URL(trimmed).pathname;
      } catch {
        // Fall through to basic parsing.
      }
    }
    if (trimmed.startsWith('www.')) {
      try {
        return new URL(`https://${trimmed}`).pathname;
      } catch {
        // Fall through to basic parsing.
      }
    }

    const noQueryOrHash: string = trimmed.split('#')[0].split('?')[0];
    if (noQueryOrHash.startsWith('/')) return noQueryOrHash;
    return `/${noQueryOrHash}`;
  }

  function makeUrlCandidates(inputUrl: string): string[] {
    const raw: string = inputUrl.trim();
    const pathOnly: string = toPathname(raw);
    const candidates: Set<string> = new Set<string>();

    function addVariant(u: string): void {
      const v: string = u.trim();
      if (v.length === 0) return;
      candidates.add(v);
      if (v.endsWith('/') && v.length > 1) candidates.add(v.slice(0, -1));
      else candidates.add(`${v}/`);
    }

    addVariant(raw);
    addVariant(pathOnly);

    // Accept both site styles:
    // - Pagefind index uses "/foundry/..." (current dataset)
    // - Some callers may provide "/docs/foundry/..."
    if (pathOnly.startsWith('/docs/')) {
      addVariant(pathOnly.replace(/^\/docs(?=\/)/, ''));
    } else if (
      pathOnly.startsWith('/foundry/') ||
      pathOnly.startsWith('/apollo/') ||
      pathOnly.startsWith('/gotham/')
    ) {
      addVariant(`/docs${pathOnly}`);
    }

    return Array.from(candidates);
  }

  function parseScope(rawScope: unknown): DocScope | null {
    if (rawScope === undefined) return 'foundry';
    if (
      rawScope === 'foundry' ||
      rawScope === 'apollo' ||
      rawScope === 'gotham' ||
      rawScope === 'all'
    ) {
      return rawScope;
    }
    return null;
  }

  function isInScope(pageUrl: string, scope: DocScope): boolean {
    if (scope === 'all') return true;
    const path: string = toPathname(pageUrl);
    return path.startsWith(`/${scope}/`) || path.startsWith(`/docs/${scope}/`);
  }

  function tokenizeQuery(query: string): string[] {
    const tokens = query
      .toLowerCase()
      .trim()
      .split(/[\s/._-]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    return Array.from(new Set(tokens));
  }

  function scorePageMatch(page: { url: string; title: string }, query: string): number {
    const q: string = query.toLowerCase().trim();
    if (q.length === 0) return 0;

    const path: string = toPathname(page.url).toLowerCase();
    const title: string = page.title.toLowerCase();

    // Strong URL-style matches.
    if (path === q) return 2000;
    if (path === toPathname(q).toLowerCase()) return 2000;
    if (path.includes(q)) return 1200;
    if (title.includes(q)) return 1000;

    const tokens: string[] = tokenizeQuery(q);
    if (tokens.length === 0) return 0;

    let score: number = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 40;
      if (path.includes(t)) score += 30;
    }

    if (path.startsWith(q)) score += 100;
    if (title.startsWith(q)) score += 100;

    return score;
  }

  return {
    config: async (cfg) => {
      ensureCommandDefinitions(cfg);
      ensureAgentDefinitions(cfg);
      maybeStartAutoBootstrapMcp();
      maybeStartAutoBootstrapDocs();
    },

    tool: {
      get_doc_page: tool({
        description:
          'Retrieve a Palantir documentation page. Provide either a URL path (preferred) or a free-text query; the tool will handle common URL variants (full URLs, missing /docs prefix, trailing slashes).',
        args: {
          url: tool.schema
            .string()
            .optional()
            .describe('Doc URL path or full URL, e.g. /foundry/compute-modules/overview/'),
          query: tool.schema
            .string()
            .optional()
            .describe('Free-text query to find the most relevant page, e.g. "compute modules".'),
          scope: tool.schema
            .enum(['foundry', 'apollo', 'gotham', 'all'])
            .optional()
            .describe(
              'Scope to search within when using query or fuzzy matching (default: foundry).'
            ),
        },
        async execute(args) {
          const docsError = await ensureDocsReadyForTool();
          if (docsError) return docsError;

          const scope: DocScope | null = parseScope((args as Record<string, unknown>).scope);
          if (!scope) {
            return [
              '[ERROR] Invalid scope. Must be one of: foundry, apollo, gotham, all.',
              'Example: get_doc_page with { "query": "compute modules", "scope": "foundry" }',
            ].join('\n');
          }

          const rawUrl: unknown = (args as Record<string, unknown>).url;
          const rawQuery: unknown = (args as Record<string, unknown>).query;

          const urlInput: string | null = typeof rawUrl === 'string' ? rawUrl.trim() : null;
          const queryInput: string | null = typeof rawQuery === 'string' ? rawQuery.trim() : null;

          if ((!urlInput || urlInput.length === 0) && (!queryInput || queryInput.length === 0)) {
            return [
              '[ERROR] Missing input. Provide either "url" or "query".',
              'Example: get_doc_page with { "url": "/foundry/compute-modules/overview/" }',
              'Example: get_doc_page with { "query": "compute modules", "scope": "foundry" }',
            ].join('\n');
          }

          const db = await getDb();

          if (urlInput && urlInput.length > 0) {
            const candidates: string[] = makeUrlCandidates(urlInput);
            for (const c of candidates) {
              const page = await getPage(db, c);
              if (page) return page.content;
            }
          }

          const q: string = (queryInput && queryInput.length > 0 ? queryInput : urlInput) ?? '';
          const pages = getAllPages(db);
          const ranked = pages
            .filter((p) => isInScope(p.url, scope))
            .map((p) => ({ page: p, score: scorePageMatch(p, q) }))
            .filter((r) => r.score > 0)
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              return toPathname(a.page.url).localeCompare(toPathname(b.page.url));
            })
            .slice(0, 5);

          if (ranked.length === 0) {
            return `Page not found: ${urlInput ?? q}`;
          }

          const best = ranked[0];
          const bestPage = await getPage(db, best.page.url);
          if (bestPage) {
            // Only auto-return when the match is reasonably strong; otherwise present suggestions.
            const strong: boolean =
              best.score >= 200 ||
              toPathname(best.page.url).toLowerCase() === toPathname(q).toLowerCase() ||
              tokenizeQuery(q).every((t) =>
                (best.page.title + ' ' + toPathname(best.page.url)).toLowerCase().includes(t)
              );
            if (strong) {
              return `Matched: ${best.page.title} (${best.page.url})\n\n${bestPage.content}`;
            }
          }

          const suggestions = ranked.map((r) => `- ${r.page.title} (${r.page.url})`).join('\n');
          return [
            `Page not found: ${urlInput ?? q}`,
            '',
            'Top matches:',
            suggestions,
            '',
            'Tip: call get_doc_page with an exact URL from the list above.',
          ].join('\n');
        },
      }),

      list_all_docs: tool({
        description:
          'List available Palantir documentation pages with their URLs and titles. Supports pagination and optional scope filtering (default: foundry). Use this to discover what documentation is available.',
        args: {
          limit: tool.schema
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe('Max results to return (default: 50, max: 200).'),
          offset: tool.schema
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Zero-based offset into the filtered, deterministic listing (default: 0).'),
          scope: tool.schema
            .enum(['foundry', 'apollo', 'gotham', 'all'])
            .optional()
            .describe('Doc scope filter by URL prefix /<scope>/ (default: foundry).'),
          query: tool.schema
            .string()
            .optional()
            .describe('Optional query to filter/rank results by title/URL (case-insensitive).'),
        },
        async execute(args) {
          const docsError = await ensureDocsReadyForTool();
          if (docsError) return docsError;

          const scope: DocScope | null = parseScope((args as Record<string, unknown>).scope);
          if (!scope) {
            return [
              '[ERROR] Invalid scope. Must be one of: foundry, apollo, gotham, all.',
              'Example: list_all_docs with { "scope": "foundry", "offset": 0, "limit": 50 }',
            ].join('\n');
          }

          const rawLimit: unknown = args.limit;
          const limit: number = rawLimit === undefined ? 50 : (rawLimit as number);
          if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 200) {
            return [
              '[ERROR] Invalid limit. Must be an integer between 1 and 200.',
              'Example: list_all_docs with { "scope": "foundry", "offset": 0, "limit": 50 }',
            ].join('\n');
          }

          const rawOffset: unknown = args.offset;
          const offset: number = rawOffset === undefined ? 0 : (rawOffset as number);
          if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < 0) {
            return [
              '[ERROR] Invalid offset. Must be an integer >= 0.',
              'Example: list_all_docs with { "scope": "foundry", "offset": 0, "limit": 50 }',
            ].join('\n');
          }

          const rawQuery: unknown = (args as Record<string, unknown>).query;
          const query: string | null = typeof rawQuery === 'string' ? rawQuery.trim() : null;
          if (query && query.length > 200) {
            return '[ERROR] Query is too long. Please use 200 characters or fewer.';
          }

          const db = await getDb();
          const pages = getAllPages(db).slice();
          const scoped = pages.filter((p) => isInScope(p.url, scope));

          const filteredWithScores =
            query && query.length > 0
              ? scoped
                  .map((p) => ({ page: p, score: scorePageMatch(p, query) }))
                  .filter((r) => r.score > 0)
                  .sort((a, b) => {
                    if (b.score !== a.score) return b.score - a.score;
                    return toPathname(a.page.url).localeCompare(toPathname(b.page.url));
                  })
              : scoped
                  .map((p) => ({ page: p, score: 0 }))
                  .sort((a, b) => toPathname(a.page.url).localeCompare(toPathname(b.page.url)));

          const total: number = filteredWithScores.length;

          if (offset >= total) {
            const safeOffset: number = Math.max(0, total - limit);
            return [
              `Available Palantir Documentation Pages`,
              `scope=${scope} query=${query ?? ''} total=${total} returned=0 offset=${offset} limit=${limit}`,
              '',
              `Offset ${offset} is beyond total ${total}.`,
              `Try: list_all_docs with { "scope": "${scope}", "offset": ${safeOffset}, "limit": ${limit} }`,
            ].join('\n');
          }

          const page = filteredWithScores.slice(offset, offset + limit).map((r) => r.page);
          const lines = page.map((p) => `- ${p.title} (${p.url})`);

          const returned: number = page.length;
          const nextOffset: number = offset + returned;
          const hasMore: boolean = nextOffset < total;

          const header = [
            `Available Palantir Documentation Pages`,
            `scope=${scope} query=${query ?? ''} total=${total} returned=${returned} offset=${offset} limit=${limit}`,
            '',
          ].join('\n');

          if (!hasMore) {
            return `${header}${lines.join('\n')}`;
          }

          return [
            header + lines.join('\n'),
            '',
            `Next: call list_all_docs with { "scope": "${scope}", "offset": ${nextOffset}, "limit": ${limit} }`,
          ].join('\n');
        },
      }),
    },

    'command.execute.before': async (hookInput, output) => {
      if (hookInput.command === 'refresh-docs') {
        const progressLines: string[] = [];
        try {
          const result = await ensureDocsAvailable({
            force: true,
            onEvent: (event) => {
              const line = formatSnapshotRefreshEvent(event);
              if (line) progressLines.push(line);
            },
          });

          resetDb();
          const db = await getDb();
          const indexedPages = getAllPages(db).length;

          pushText(
            output,
            [
              'refresh-docs complete (recommended snapshot path).',
              '',
              ...progressLines.map((line) => `- ${line}`),
              ...(progressLines.length > 0 ? [''] : []),
              `snapshot_source=${result.source}`,
              result.downloadUrl ? `snapshot_url=${result.downloadUrl}` : null,
              `snapshot_bytes=${result.bytes} (${formatBytes(result.bytes)})`,
              `indexed_pages=${indexedPages}`,
            ]
              .filter((line): line is string => !!line)
              .join('\n')
          );
        } catch (err) {
          pushText(output, formatSnapshotFailure(err));
        }
        return;
      }

      if (hookInput.command === 'refresh-docs-rescrape') {
        const progressLines: string[] = [];
        const failureSamples: string[] = [];
        try {
          const result = await fetchAllDocs(dbPath, {
            progressEvery: 250,
            onProgress: (event) => {
              formatRescrapeProgressEvent(event, progressLines, failureSamples);
            },
          });

          resetDb();
          const db = await getDb();
          const indexedPages = getAllPages(db).length;

          pushText(
            output,
            [
              'refresh-docs-rescrape complete (unsafe/experimental).',
              '',
              'Warning: this command live-scrapes palantir.com and is slower/less reliable than /refresh-docs.',
              '',
              ...progressLines.map((line) => `- ${line}`),
              ...(progressLines.length > 0 ? [''] : []),
              `total_pages=${result.totalPages}`,
              `fetched_pages=${result.fetchedPages}`,
              `failed_pages=${result.failedUrls.length}`,
              `indexed_pages=${indexedPages}`,
              ...(failureSamples.length > 0
                ? ['', 'failure_samples:', ...failureSamples.map((line) => `- ${line}`)]
                : []),
            ].join('\n')
          );
        } catch (err) {
          pushText(output, formatRescrapeFailure(err));
        }
        return;
      }

      if (hookInput.command === 'setup-palantir-mcp') {
        const text = await setupPalantirMcp(input.worktree, hookInput.arguments ?? '');
        pushText(output, text);
        return;
      }

      if (hookInput.command === 'rescan-palantir-mcp-tools') {
        const text = await rescanPalantirMcpTools(input.worktree);
        pushText(output, text);
        return;
      }
    },
  };
};

export default plugin;
