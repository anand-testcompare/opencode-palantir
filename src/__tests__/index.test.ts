import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { writeParquet } from '../docs/write-parquet.ts';
import * as fetchModule from '../docs/fetch.ts';
import * as snapshotModule from '../docs/snapshot.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin = (await import('../index.ts')).default as any;
type OutputPart = { type: 'text'; text: string };

describe('Plugin', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
    dbPath = path.join(tmpDir, 'data', 'docs.parquet');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function seedDatabase(): Promise<void> {
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    await writeParquet(
      [
        {
          url: '/foundry/ontology/overview/',
          title: 'Ontology Overview',
          content: 'This is the ontology overview content.',
          wordCount: 6,
          meta: {},
          fetchedAt: '2025-01-01T00:00:00.000Z',
        },
        {
          url: '/foundry/actions/',
          title: 'Actions',
          content: 'Actions documentation content.',
          wordCount: 3,
          meta: {},
          fetchedAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      dbPath
    );
  }

  async function seedDatabaseMany(): Promise<void> {
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });

    const rows: Array<{
      url: string;
      title: string;
      content: string;
      wordCount: number;
      meta: Record<string, unknown>;
      fetchedAt: string;
    }> = [];

    // Intentionally unsorted URL insertion to prove deterministic ordering.
    rows.push({
      url: '/apollo/zzz/',
      title: 'Apollo ZZZ',
      content: 'apollo content',
      wordCount: 2,
      meta: {},
      fetchedAt: '2025-01-01T00:00:00.000Z',
    });
    rows.push({
      url: '/foundry/zzz/',
      title: 'Foundry ZZZ',
      content: 'foundry content',
      wordCount: 2,
      meta: {},
      fetchedAt: '2025-01-01T00:00:00.000Z',
    });
    rows.push({
      url: '/gotham/aaa/',
      title: 'Gotham AAA',
      content: 'gotham content',
      wordCount: 2,
      meta: {},
      fetchedAt: '2025-01-01T00:00:00.000Z',
    });

    rows.push({
      url: '/foundry/compute-modules/overview/',
      title: 'Compute modules',
      content: 'Compute modules overview content.',
      wordCount: 4,
      meta: {},
      fetchedAt: '2025-01-01T00:00:00.000Z',
    });

    for (let i = 0; i < 60; i += 1) {
      rows.push({
        url: `/foundry/many/${String(i).padStart(2, '0')}/`,
        title: `Foundry Many ${i}`,
        content: 'foundry many content',
        wordCount: 3,
        meta: {},
        fetchedAt: '2025-01-01T00:00:00.000Z',
      });
    }

    await writeParquet(rows, dbPath);
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
    expect(getDocPage.args).toHaveProperty('query');
    expect(getDocPage.args).toHaveProperty('scope');
  });

  it('list_all_docs tool has description and no required args', async () => {
    const hooks = await plugin({ worktree: tmpDir });
    const listAllDocs = hooks.tool['list_all_docs'];

    expect(listAllDocs.description).toBeTruthy();
    expect(listAllDocs.description).toContain('documentation');
    const keys = Object.keys(listAllDocs.args).sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(['limit', 'offset', 'query', 'scope']);
  });

  it('get_doc_page execute returns page content when DB exists', async () => {
    await seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['get_doc_page'].execute(
      { url: '/foundry/ontology/overview/' },
      {}
    );

    expect(result).toBe('This is the ontology overview content.');
  });

  it('get_doc_page execute returns not-found message for non-existent URL', async () => {
    await seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['get_doc_page'].execute({ url: '/docs/nonexistent/' }, {});

    expect(result).toContain('Page not found');
    expect(result).toContain('/docs/nonexistent/');
  });

  it('list_all_docs execute returns formatted list of pages', async () => {
    await seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['list_all_docs'].execute({}, {});

    expect(result).toContain('Available Palantir Documentation Pages');
    expect(result).toContain('scope=foundry');
    expect(result).toContain('query=');
    expect(result).toContain('total=2');
    expect(result).toContain('- Ontology Overview (/foundry/ontology/overview/)');
    expect(result).toContain('- Actions (/foundry/actions/)');
  });

  it('list_all_docs defaults to bounded results and foundry scope', async () => {
    await seedDatabaseMany();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['list_all_docs'].execute({}, {});

    expect(result).toContain('scope=foundry');
    expect(result).toContain('limit=50');
    expect(result).toContain('Next: call list_all_docs');
    expect(result).not.toContain('/apollo/');
    expect(result).not.toContain('/gotham/');

    const lineCount = (result as string).split('\n').filter((l) => l.startsWith('- ')).length;
    expect(lineCount).toBeLessThanOrEqual(50);
  });

  it('list_all_docs pagination is deterministic (sorted by url)', async () => {
    await seedDatabaseMany();
    const hooks = await plugin({ worktree: tmpDir });

    const first = await hooks.tool['list_all_docs'].execute(
      { scope: 'all', limit: 1, offset: 0 },
      {}
    );
    const second = await hooks.tool['list_all_docs'].execute(
      { scope: 'all', limit: 1, offset: 1 },
      {}
    );

    const getOnlyUrl = (text: string): string => {
      const line = text.split('\n').find((l) => l.startsWith('- ') && l.includes('(/'));
      expect(line).toBeTruthy();
      const match = line?.match(/\((\/[^)]+)\)/);
      expect(match?.[1]).toBeTruthy();
      return match?.[1] as string;
    };

    const url0 = getOnlyUrl(first);
    const url1 = getOnlyUrl(second);
    expect(url0).not.toBe(url1);

    // Because ordering is by URL, /apollo/... sorts before /foundry/... and /gotham/...
    expect(url0).toBe('/apollo/zzz/');
    expect(url1).toBe('/foundry/compute-modules/overview/');
  });

  it('list_all_docs scope=all includes non-foundry URLs', async () => {
    await seedDatabaseMany();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['list_all_docs'].execute(
      { scope: 'all', limit: 5, offset: 0 },
      {}
    );

    expect(result).toContain('scope=all');
    expect(result).toContain('/apollo/zzz/');
  });

  it('list_all_docs query filters and ranks results', async () => {
    await seedDatabaseMany();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['list_all_docs'].execute(
      { query: 'compute modules', scope: 'foundry', limit: 10, offset: 0 },
      {}
    );

    expect(result).toContain('scope=foundry');
    expect(result).toContain('query=compute modules');
    expect(result).toContain('/foundry/compute-modules/overview/');
  });

  it('get_doc_page accepts common URL variants (missing /docs prefix, missing trailing slash)', async () => {
    await seedDatabaseMany();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['get_doc_page'].execute(
      { url: '/docs/foundry/compute-modules/overview' },
      {}
    );

    expect(result).toContain('Compute modules overview content.');
  });

  it('get_doc_page can resolve a page from a free-text query', async () => {
    await seedDatabaseMany();
    const hooks = await plugin({ worktree: tmpDir });

    const result = await hooks.tool['get_doc_page'].execute(
      { query: 'compute modules', scope: 'foundry' },
      {}
    );

    expect(result).toContain('Matched:');
    expect(result).toContain('/foundry/compute-modules/overview/');
    expect(result).toContain('Compute modules overview content.');
  });

  it('list_all_docs invalid args fail safely', async () => {
    await seedDatabaseMany();
    const hooks = await plugin({ worktree: tmpDir });

    const badLimit = await hooks.tool['list_all_docs'].execute({ limit: 0 } as never, {});
    expect(badLimit).toContain('[ERROR]');
    expect(badLimit).toContain('limit');

    const badOffset = await hooks.tool['list_all_docs'].execute({ offset: -1 } as never, {});
    expect(badOffset).toContain('[ERROR]');
    expect(badOffset).toContain('offset');

    const badScope = await hooks.tool['list_all_docs'].execute({ scope: 'nope' } as never, {});
    expect(badScope).toContain('[ERROR]');
  });

  it('auto-bootstrap path makes doc tools work when snapshot is initially missing', async () => {
    vi.spyOn(snapshotModule, 'ensureDocsParquet').mockImplementation(async () => {
      await seedDatabase();
      return {
        dbPath,
        changed: true,
        source: 'download',
        bytes: 4096,
      };
    });

    const hooks = await plugin({ worktree: tmpDir });

    const getResult = await hooks.tool['get_doc_page'].execute(
      { url: '/foundry/ontology/overview/' },
      {}
    );
    expect(getResult).toContain('ontology overview content');

    const listResult = await hooks.tool['list_all_docs'].execute({}, {});
    expect(listResult).toContain('Available Palantir Documentation Pages');
  });

  it('tools surface actionable snapshot errors when bootstrap fails', async () => {
    vi.spyOn(snapshotModule, 'ensureDocsParquet').mockRejectedValue(new Error('network blocked'));

    const hooks = await plugin({ worktree: tmpDir });

    const getResult = await hooks.tool['get_doc_page'].execute({ url: '/docs/anything/' }, {});
    expect(getResult).toContain('Unable to obtain Palantir docs snapshot');
    expect(getResult).toContain('/refresh-docs');
    expect(getResult).toContain('/refresh-docs-rescrape');

    const listResult = await hooks.tool['list_all_docs'].execute({}, {});
    expect(listResult).toContain('Unable to obtain Palantir docs snapshot');
    expect(listResult).toContain('/refresh-docs');
    expect(listResult).toContain('/refresh-docs-rescrape');
  });

  it('command.execute.before hook refreshes snapshot for /refresh-docs', async () => {
    const ensureSpy = vi.spyOn(snapshotModule, 'ensureDocsParquet').mockImplementation(async () => {
      await seedDatabase();
      return {
        dbPath,
        changed: true,
        source: 'download',
        bytes: 2048,
        downloadUrl: 'https://example.test/docs.parquet',
      };
    });

    const hooks = await plugin({ worktree: tmpDir });
    const hookFn = hooks['command.execute.before'];
    expect(hookFn).toBeDefined();

    const output: { parts: OutputPart[] } = { parts: [] };
    await hookFn({ command: 'refresh-docs', sessionID: 'test-session', arguments: '' }, output);

    expect(ensureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        dbPath,
        force: true,
      })
    );
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0].type).toBe('text');
    expect(output.parts[0].text).toContain('snapshot_source=download');
    expect(output.parts[0].text).toContain('indexed_pages=2');
    expect(output.parts[0].text).toContain('snapshot_bytes=2048');
  });

  it('command.execute.before hook runs unsafe rescrape command with warning', async () => {
    await seedDatabase();
    const spy = vi.spyOn(fetchModule, 'fetchAllDocs').mockResolvedValue({
      totalPages: 100,
      fetchedPages: 98,
      failedUrls: ['url1', 'url2'],
      dbPath,
    });

    const hooks = await plugin({ worktree: tmpDir });
    const hookFn = hooks['command.execute.before'];
    expect(hookFn).toBeDefined();

    const output: { parts: OutputPart[] } = { parts: [] };
    await hookFn(
      { command: 'refresh-docs-rescrape', sessionID: 'test-session', arguments: '' },
      output
    );

    expect(spy).toHaveBeenCalled();
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0].type).toBe('text');
    expect(output.parts[0].text).toContain('unsafe/experimental');
    expect(output.parts[0].text).toContain('fetched_pages=98');
    expect(output.parts[0].text).toContain('failed_pages=2');
  });

  it('command.execute.before hook ignores non-refresh commands', async () => {
    const spy = vi.spyOn(fetchModule, 'fetchAllDocs');
    const hooks = await plugin({ worktree: tmpDir });
    const output: { parts: OutputPart[] } = { parts: [] };

    await hooks['command.execute.before'](
      { command: 'other-command', sessionID: 'test-session', arguments: '' },
      output
    );

    expect(spy).not.toHaveBeenCalled();
    expect(output.parts).toHaveLength(0);
    spy.mockRestore();
  });

  it('lazily opens database only on first tool call', async () => {
    await seedDatabase();
    const hooks = await plugin({ worktree: tmpDir });

    // DB not opened yet — get_doc_page works, proving lazy init
    const result = await hooks.tool['get_doc_page'].execute(
      { url: '/docs/foundry/ontology/overview/' },
      {}
    );
    expect(result).toBe('This is the ontology overview content.');

    // Second call reuses cached DB — list_all_docs also works
    const listResult = await hooks.tool['list_all_docs'].execute({}, {});
    expect(listResult).toContain('total=2');
  });
});
