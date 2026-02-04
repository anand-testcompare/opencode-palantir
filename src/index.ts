import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin/tool';
import path from 'node:path';
import { createDatabase, getPage, getAllPages, closeDatabase } from './docs/db.ts';
import { fetchAllDocs } from './docs/fetch.ts';
import type { Database } from 'bun:sqlite';

const NO_DB_MESSAGE =
  'Documentation database not found. Run /refresh-docs to download Palantir Foundry documentation.';

const plugin: Plugin = async (input) => {
  const dbPath = path.join(input.worktree, 'data', 'docs.db');
  let dbInstance: Database | null = null;

  function getDb(): Database {
    if (!dbInstance) {
      dbInstance = createDatabase(dbPath);
    }
    return dbInstance;
  }

  async function dbExists(): Promise<boolean> {
    return Bun.file(dbPath).exists();
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

          const db = getDb();
          const page = getPage(db, args.url);
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

          const db = getDb();
          const pages = getAllPages(db);
          const lines = pages.map((p) => `- ${p.title} (${p.url})`);
          return `Available Palantir Foundry Documentation (${pages.length} pages):\n\n${lines.join('\n')}`;
        },
      }),
    },

    'command.execute.before': async (hookInput, output) => {
      if (hookInput.command !== 'refresh-docs') return;

      const result = await fetchAllDocs(dbPath);

      if (dbInstance) {
        closeDatabase(dbInstance);
        dbInstance = null;
      }

      output.parts.push({
        type: 'text',
        text: `Refreshed documentation: ${result.fetchedPages}/${result.totalPages} pages fetched. ${result.failedUrls.length} failures.`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    },
  };
};

export default plugin;
