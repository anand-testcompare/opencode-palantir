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
          'List all available Palantir Foundry documentation pages with their URLs and titles. Use this to discover what documentation is available.',
        args: {},
        async execute() {
          if (!(await dbExists())) return NO_DB_MESSAGE;

          const db = await getDb();
          const pages = getAllPages(db);
          const lines = pages.map((p) => `- ${p.title} (${p.url})`);
          return `Available Palantir Foundry Documentation (${pages.length} pages):\n\n${lines.join('\n')}`;
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
