import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Config } from '@opencode-ai/sdk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin = (await import('../index.ts')).default as any;

describe('plugin config hook', () => {
  let tmpDir: string;
  let priorToken: string | undefined;
  let priorUrl: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-config-test-'));
    priorToken = process.env.FOUNDRY_TOKEN;
    priorUrl = process.env.FOUNDRY_URL;
    delete process.env.FOUNDRY_TOKEN;
    delete process.env.FOUNDRY_URL;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    expect(cfg.command?.['setup-palantir-mcp']?.template).toBeTruthy();
    expect(cfg.command?.['rescan-palantir-mcp-tools']?.template).toBeTruthy();

    expect(cfg.agent?.['foundry-librarian']).toBeTruthy();
    expect(cfg.agent?.foundry).toBeTruthy();
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
