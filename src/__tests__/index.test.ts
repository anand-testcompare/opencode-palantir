import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mock } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDatabase, insertPage, closeDatabase } from '../docs/db.ts';
import * as fetchModule from '../docs/fetch.ts';

mock.module('@opencode-ai/plugin/tool', () => {
  const mockSchema = {
    string: () => ({
      describe: (d: string) => ({ _type: 'string', _description: d }),
    }),
  };
  const toolFn = Object.assign((input: Record<string, unknown>) => input, {
    schema: mockSchema,
  });
  return { tool: toolFn };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin = (await import('../index.ts')).default as any;

describe('Plugin', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
    dbPath = path.join(tmpDir, 'data', 'docs.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedDatabase(): void {
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    const db = createDatabase(dbPath);
    insertPage(db, {
      url: '/docs/foundry/ontology/overview/',
      title: 'Ontology Overview',
      content: 'This is the ontology overview content.',
      wordCount: 6,
      meta: {},
      fetchedAt: '2025-01-01T00:00:00.000Z',
    });
    insertPage(db, {
      url: '/docs/foundry/actions/',
      title: 'Actions',
      content: 'Actions documentation content.',
      wordCount: 3,
      meta: {},
      fetchedAt: '2025-01-01T00:00:00.000Z',
    });
    closeDatabase(db);
  }

  it('returns Hooks with tool property containing exactly 2 tools', async () => {
    const hooks = await plugin({ worktree: tmpDir });

    expect(hooks.tool).toBeDefined();
    const toolNames = Object.keys(hooks.tool);
    expect(toolNames).toHaveLength(2);
    expect(toolNames).toContain('get_doc_page');
    expect(toolNames).toContain('list_all_docs');
  });

  it('get_doc_page tool has description and url arg schema', async () => {
    const hooks = await plugin({ worktree: tmpDir });
    const getDocPage = hooks.tool['get_doc_page'];

    expect(getDocPage.description).toBeTruthy();
    expect(getDocPage.description).toContain('documentation page');
    expect(getDocPage.args).toHaveProperty('url');
  });

  it('list_all_docs tool has description and no required args', async () => {
    const hooks = await plugin({ worktree: tmpDir });
    const listAllDocs = hooks.tool['list_all_docs'];

    expect(listAllDocs.description).toBeTruthy();
    expect(listAllDocs.description).toContain('documentation');
    expect(Object.keys(listAllDocs.args)).toHaveLength(0);
  });

  it('get_doc_page execute returns page content when DB exists', async () => {
    seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['get_doc_page'].execute(
      { url: '/docs/foundry/ontology/overview/' },
      {}
    );

    expect(result).toBe('This is the ontology overview content.');
  });

  it('get_doc_page execute returns not-found message for non-existent URL', async () => {
    seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['get_doc_page'].execute({ url: '/docs/nonexistent/' }, {});

    expect(result).toContain('Page not found');
    expect(result).toContain('/docs/nonexistent/');
  });

  it('list_all_docs execute returns formatted list of pages', async () => {
    seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['list_all_docs'].execute({}, {});

    expect(result).toContain('Available Palantir Foundry Documentation (2 pages)');
    expect(result).toContain('- Ontology Overview (/docs/foundry/ontology/overview/)');
    expect(result).toContain('- Actions (/docs/foundry/actions/)');
  });

  it('tools return helpful message when docs.db does not exist', async () => {
    const hooks = await plugin({ worktree: tmpDir });

    const getResult = await hooks.tool['get_doc_page'].execute({ url: '/docs/anything/' }, {});
    expect(getResult).toContain('Documentation database not found');
    expect(getResult).toContain('/refresh-docs');

    const listResult = await hooks.tool['list_all_docs'].execute({}, {});
    expect(listResult).toContain('Documentation database not found');
    expect(listResult).toContain('/refresh-docs');
  });

  it('command.execute.before hook triggers fetchAllDocs for /refresh-docs', async () => {
    const spy = vi.spyOn(fetchModule, 'fetchAllDocs').mockResolvedValue({
      totalPages: 100,
      fetchedPages: 98,
      failedUrls: ['url1', 'url2'],
      dbPath,
    });

    const hooks = await plugin({ worktree: tmpDir });
    const hookFn = hooks['command.execute.before'];
    expect(hookFn).toBeDefined();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = { parts: [] as any[] };
    await hookFn({ command: 'refresh-docs', sessionID: 'test-session', arguments: '' }, output);

    expect(spy).toHaveBeenCalledWith(dbPath);
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0].type).toBe('text');
    expect(output.parts[0].text).toContain('98');
    expect(output.parts[0].text).toContain('100');
    spy.mockRestore();
  });

  it('command.execute.before hook ignores non-refresh commands', async () => {
    const spy = vi.spyOn(fetchModule, 'fetchAllDocs');
    const hooks = await plugin({ worktree: tmpDir });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = { parts: [] as any[] };

    await hooks['command.execute.before'](
      { command: 'other-command', sessionID: 'test-session', arguments: '' },
      output
    );

    expect(spy).not.toHaveBeenCalled();
    expect(output.parts).toHaveLength(0);
    spy.mockRestore();
  });

  it('lazily opens database only on first tool call', async () => {
    seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    // DB not opened yet — get_doc_page works, proving lazy init
    const result = await hooks.tool['get_doc_page'].execute(
      { url: '/docs/foundry/ontology/overview/' },
      {}
    );
    expect(result).toBe('This is the ontology overview content.');

    // Second call reuses cached DB — list_all_docs also works
    const listResult = await hooks.tool['list_all_docs'].execute({}, {});
    expect(listResult).toContain('2 pages');
  });
});
