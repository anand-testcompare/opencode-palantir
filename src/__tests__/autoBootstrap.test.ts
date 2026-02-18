import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as mcpClient from '../palantir-mcp/mcp-client.ts';
import { autoBootstrapPalantirMcpIfConfigured } from '../palantir-mcp/commands.ts';

type McpServerConfig = {
  type?: string;
  command?: string[];
  environment?: Record<string, unknown>;
};

type AgentConfig = {
  mode?: string;
  tools?: Record<string, unknown>;
};

type OpencodeConfig = {
  tools?: Record<string, unknown>;
  mcp?: Record<string, McpServerConfig>;
  agent?: Record<string, AgentConfig>;
};

describe('autoBootstrapPalantirMcpIfConfigured', () => {
  let tmpDir: string;
  let priorToken: string | undefined;
  let priorUrl: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-auto-bootstrap-test-'));
    priorToken = process.env.FOUNDRY_TOKEN;
    priorUrl = process.env.FOUNDRY_URL;
    delete process.env.FOUNDRY_TOKEN;
    delete process.env.FOUNDRY_URL;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (priorToken === undefined) delete process.env.FOUNDRY_TOKEN;
    else process.env.FOUNDRY_TOKEN = priorToken;
    if (priorUrl === undefined) delete process.env.FOUNDRY_URL;
    else process.env.FOUNDRY_URL = priorUrl;
  });

  it('does nothing when env is missing', async () => {
    await autoBootstrapPalantirMcpIfConfigured(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'opencode.jsonc'))).toBe(false);
  });

  it('writes schema-valid config and never persists FOUNDRY_TOKEN', async () => {
    process.env.FOUNDRY_TOKEN = 'SENTINEL_SECRET';
    process.env.FOUNDRY_URL = 'https://example.palantirfoundry.com';

    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue([
      'list_datasets',
      'get_dataset',
      'create_thing',
    ]);

    await autoBootstrapPalantirMcpIfConfigured(tmpDir);

    const cfgPath: string = path.join(tmpDir, 'opencode.jsonc');
    expect(fs.existsSync(cfgPath)).toBe(true);

    const text: string = fs.readFileSync(cfgPath, 'utf8');
    expect(text).not.toContain('SENTINEL_SECRET');
    expect(text).toContain('{env:FOUNDRY_TOKEN}');

    const cfg = JSON.parse(text) as OpencodeConfig;

    expect(cfg.mcp?.['palantir-mcp']?.type).toBe('local');
    expect(cfg.mcp?.['palantir-mcp']?.command).toContain('--foundry-api-url');
    expect(cfg.mcp?.['palantir-mcp']?.command).toContain('https://example.palantirfoundry.com');

    expect(cfg.tools?.['palantir-mcp_*']).toBe(false);

    expect(cfg.agent?.['foundry-librarian']).toBeTruthy();
    expect(cfg.agent?.foundry).toBeTruthy();
    expect(cfg.agent?.['foundry-librarian']?.mode).toBe('subagent');
    expect(cfg.agent?.foundry?.mode).toBe('all');

    expect(cfg.agent?.['foundry-librarian']?.tools?.['palantir-mcp_list_datasets']).toBe(true);
    expect(cfg.agent?.['foundry-librarian']?.tools?.['palantir-mcp_get_dataset']).toBe(true);
    expect(cfg.agent?.['foundry-librarian']?.tools?.['palantir-mcp_create_thing']).toBe(false);
    expect(cfg.agent?.foundry?.tools?.['palantir-mcp_create_thing']).toBe(true);
  });

  it('is idempotent for repeated runs', async () => {
    process.env.FOUNDRY_TOKEN = 'TEST_TOKEN';
    process.env.FOUNDRY_URL = 'https://example.palantirfoundry.com';

    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue(['list_datasets', 'get_dataset']);

    await autoBootstrapPalantirMcpIfConfigured(tmpDir);
    const first: string = fs.readFileSync(path.join(tmpDir, 'opencode.jsonc'), 'utf8');

    await autoBootstrapPalantirMcpIfConfigured(tmpDir);
    const second: string = fs.readFileSync(path.join(tmpDir, 'opencode.jsonc'), 'utf8');

    expect(second).toBe(first);
  });

  it('skips tool discovery when config is already complete', async () => {
    process.env.FOUNDRY_TOKEN = 'TEST_TOKEN';
    process.env.FOUNDRY_URL = 'https://example.palantirfoundry.com';

    const cfgPath: string = path.join(tmpDir, 'opencode.jsonc');
    const existing: OpencodeConfig = {
      tools: { 'palantir-mcp_*': false },
      mcp: {
        'palantir-mcp': {
          type: 'local',
          command: [
            'npx',
            '-y',
            'palantir-mcp',
            '--foundry-api-url',
            'https://example.palantirfoundry.com',
          ],
          environment: { FOUNDRY_TOKEN: '{env:FOUNDRY_TOKEN}' },
        },
      },
      agent: {
        'foundry-librarian': { tools: { 'palantir-mcp_list_datasets': true } },
        foundry: { tools: { 'palantir-mcp_list_datasets': true } },
      },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(existing, null, 2));

    const spy = vi.spyOn(mcpClient, 'listPalantirMcpTools');
    await autoBootstrapPalantirMcpIfConfigured(tmpDir);
    expect(spy).not.toHaveBeenCalled();
  });
});
