import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Config } from '@opencode-ai/sdk';
import * as snapshotModule from '../docs/snapshot.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin = (await import('../index.ts')).default as any;

describe('plugin config hook', () => {
  let tmpDir: string;
  let priorToken: string | undefined;
  let priorUrl: string | undefined;
  let ensureDocsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-config-test-'));
    priorToken = process.env.FOUNDRY_TOKEN;
    priorUrl = process.env.FOUNDRY_URL;
    delete process.env.FOUNDRY_TOKEN;
    delete process.env.FOUNDRY_URL;

    ensureDocsSpy = vi.spyOn(snapshotModule, 'ensureDocsParquet').mockResolvedValue({
      dbPath: path.join(tmpDir, 'data', 'docs.parquet'),
      changed: false,
      source: 'existing',
      bytes: 4096,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (priorToken === undefined) delete process.env.FOUNDRY_TOKEN;
    else process.env.FOUNDRY_TOKEN = priorToken;
    if (priorUrl === undefined) delete process.env.FOUNDRY_URL;
    else process.env.FOUNDRY_URL = priorUrl;
  });

  it('injects commands and agents', async () => {
    const hooks = await plugin({ worktree: tmpDir });
    expect(typeof hooks.config).toBe('function');

    const cfg: Config = {};
    await hooks.config(cfg);

    expect(cfg.command?.['refresh-docs']?.template).toBeTruthy();
    expect(cfg.command?.['refresh-docs-rescrape']?.template).toBeTruthy();
    expect(cfg.command?.['setup-palantir-mcp']?.template).toBeTruthy();
    expect(cfg.command?.['rescan-palantir-mcp-tools']?.template).toBeTruthy();
    expect(cfg.command?.['setup-palantir-mcp']?.description).toContain(
      'Missing env: FOUNDRY_URL, FOUNDRY_TOKEN'
    );
    expect(cfg.command?.['rescan-palantir-mcp-tools']?.description).toContain(
      'Missing env: FOUNDRY_TOKEN'
    );

    expect(cfg.agent?.['foundry-librarian']).toBeTruthy();
    expect(cfg.agent?.foundry).toBeTruthy();
    expect(cfg.agent?.['foundry-librarian']?.mode).toBe('subagent');
    expect(cfg.agent?.foundry?.mode).toBe('all');
    expect(ensureDocsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        dbPath: path.join(tmpDir, 'data', 'docs.parquet'),
        force: false,
      })
    );
  });

  it('does not overwrite existing definitions', async () => {
    const hooks = await plugin({ worktree: tmpDir });
    expect(typeof hooks.config).toBe('function');

    const cfg: Config = {
      command: {
        'refresh-docs': {
          template: 'CUSTOM_TEMPLATE',
          description: 'CUSTOM_DESCRIPTION',
        },
      },
      agent: {
        foundry: {
          prompt: 'CUSTOM_PROMPT',
          tools: {
            get_doc_page: true,
          },
        },
      },
    };

    await hooks.config(cfg);

    expect(cfg.command?.['refresh-docs']?.template).toBe('CUSTOM_TEMPLATE');
    expect(cfg.command?.['refresh-docs']?.description).toBe('CUSTOM_DESCRIPTION');

    expect(cfg.agent?.foundry?.prompt).toBe('CUSTOM_PROMPT');
    expect(cfg.agent?.foundry?.tools?.get_doc_page).toBe(true);
    // Additive defaults are allowed.
    expect(cfg.agent?.foundry?.tools?.list_all_docs).toBe(false);
  });
});
