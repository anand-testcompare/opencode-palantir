import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin/tool';
import path from 'node:path';
import {
  createDatabase,
  getPage,
  getAllPages,
  closeDatabase,
  type ParquetStore,
} from './docs/db.ts';
import { fetchAllDocs } from './docs/fetch.ts';
import { rescanPalantirMcpTools, setupPalantirMcp } from './palantir-mcp/commands.ts';

const NO_DB_MESSAGE =
  'Documentation database not found. Run /refresh-docs to download Palantir Foundry documentation.';

const plugin: Plugin = async (input) => {
  const dbPath = path.join(input.worktree, 'data', 'docs.parquet');
  let dbInstance: ParquetStore | null = null;

  type CommandOutput = { parts: unknown[] };

  async function getDb(): Promise<ParquetStore> {
    if (!dbInstance) {
      dbInstance = await createDatabase(dbPath);
    }
    return dbInstance;
  }

  async function dbExists(): Promise<boolean> {
    return Bun.file(dbPath).exists();
  }

  function pushText(output: CommandOutput, text: string): void {
    output.parts.push({ type: 'text', text });
  }

  return {
    tool: {
      get_doc_page: tool({
        description:
          'Retrieve a Palantir Foundry documentation page by its URL path. Use this when you need the full content of a specific documentation page.',
        args: {
          url: tool.schema
            .string()
            .describe('The URL path of the doc page, e.g. /docs/foundry/ontology/overview/'),
        },
        async execute(args) {
          if (!(await dbExists())) return NO_DB_MESSAGE;

          const db = await getDb();
          const page = await getPage(db, args.url);
          if (!page) return `Page not found: ${args.url}`;

          return page.content;
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
            .describe('Doc scope filter by URL prefix /docs/<scope>/ (default: foundry).'),
        },
        async execute(args) {
          if (!(await dbExists())) return NO_DB_MESSAGE;

          const rawScope: unknown = (args as Record<string, unknown>).scope;
          let scope: 'foundry' | 'apollo' | 'gotham' | 'all' = 'foundry';
          if (rawScope !== undefined) {
            if (
              rawScope === 'foundry' ||
              rawScope === 'apollo' ||
              rawScope === 'gotham' ||
              rawScope === 'all'
            ) {
              scope = rawScope;
            } else {
              return [
                '[ERROR] Invalid scope. Must be one of: foundry, apollo, gotham, all.',
                'Example: list_all_docs with { "scope": "foundry", "offset": 0, "limit": 50 }',
              ].join('\n');
            }
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

          const db = await getDb();
          const pages = getAllPages(db)
            .slice()
            .sort((a, b) => a.url.localeCompare(b.url));

          const filtered =
            scope === 'all' ? pages : pages.filter((p) => p.url.startsWith(`/docs/${scope}/`));
          const total: number = filtered.length;

          if (offset >= total) {
            const safeOffset: number = Math.max(0, total - limit);
            return [
              `Available Palantir Documentation Pages`,
              `scope=${scope} total=${total} returned=0 offset=${offset} limit=${limit}`,
              '',
              `Offset ${offset} is beyond total ${total}.`,
              `Try: list_all_docs with { "scope": "${scope}", "offset": ${safeOffset}, "limit": ${limit} }`,
            ].join('\n');
          }

          const page = filtered.slice(offset, offset + limit);
          const lines = page.map((p) => `- ${p.title} (${p.url})`);

          const returned: number = page.length;
          const nextOffset: number = offset + returned;
          const hasMore: boolean = nextOffset < total;

          const header = [
            `Available Palantir Documentation Pages`,
            `scope=${scope} total=${total} returned=${returned} offset=${offset} limit=${limit}`,
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
        const result = await fetchAllDocs(dbPath);

        if (dbInstance) {
          closeDatabase(dbInstance);
          dbInstance = null;
        }

        pushText(
          output,
          `Refreshed documentation: ${result.fetchedPages}/${result.totalPages} pages fetched. ${result.failedUrls.length} failures.`
        );
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
