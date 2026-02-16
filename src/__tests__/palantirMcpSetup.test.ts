import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import * as mcpClient from '../palantir-mcp/mcp-client.ts';

type MinimalHooks = Record<string, unknown>;
type MinimalPlugin = (input: { worktree: string }) => Promise<MinimalHooks>;
type CommandHookInput = { command: string; sessionID: string; arguments: string };
type CommandHookOutput = { parts: unknown[] };
type CommandHook = (input: CommandHookInput, output: CommandHookOutput) => Promise<void>;

type McpServerConfig = {
  type?: string;
  command?: string[];
  environment?: Record<string, unknown>;
};

type AgentConfig = {
  description?: string;
  mode?: string;
  tools?: Record<string, unknown>;
};

type OpencodeConfig = {
  plugin?: unknown;
  tools?: Record<string, unknown>;
  mcp?: Record<string, McpServerConfig>;
  agent?: Record<string, AgentConfig>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getFirstTextPart(output: CommandHookOutput): string {
  expect(output.parts).toHaveLength(1);
  const part: unknown = output.parts[0];
  if (!isRecord(part)) throw new Error('Expected output part to be an object');
  if (part.type !== 'text') throw new Error(`Expected text part, got ${String(part.type)}`);
  if (typeof part.text !== 'string') throw new Error('Expected text to be a string');
  return part.text;
}

const plugin = (await import('../index.ts')).default as unknown as MinimalPlugin;

describe('/setup-palantir-mcp', () => {
  let tmpDir: string;
  let priorToken: string | undefined;
  let priorUrl: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-setup-test-'));
    priorToken = process.env.FOUNDRY_TOKEN;
    priorUrl = process.env.FOUNDRY_URL;
    process.env.FOUNDRY_TOKEN = 'TEST_TOKEN';
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

  async function runSetup(args: string): Promise<{ text: string }> {
    const hooks = await plugin({ worktree: tmpDir });
    const hook = hooks['command.execute.before'];
    if (typeof hook !== 'function') throw new Error('Missing command.execute.before hook');

    const output: CommandHookOutput = { parts: [] };
    await (hook as CommandHook)(
      { command: 'setup-palantir-mcp', sessionID: 'test-session', arguments: args },
      output
    );
    return { text: getFirstTextPart(output) };
  }

  it('prints usage and makes no changes when URL is missing', async () => {
    const spy = vi.spyOn(mcpClient, 'listPalantirMcpTools');
    const result = await runSetup('');

    expect(result.text).toContain('Usage:');
    expect(spy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(tmpDir, 'opencode.jsonc'))).toBe(false);
  });

  it('returns a validation error for an invalid profile override', async () => {
    const result = await runSetup('https://example.palantirfoundry.com --profile nope');

    expect(result.text).toContain('invalid');
    expect(result.text).toContain('Valid values');
    expect(fs.existsSync(path.join(tmpDir, 'opencode.jsonc'))).toBe(false);
  });

  it('normalizes URL and writes mcp server config', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue(['list_datasets']);

    await runSetup('foo.palantirfoundry.com/abc');

    const cfgPath = path.join(tmpDir, 'opencode.jsonc');
    const text = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(text) as OpencodeConfig;

    expect(cfg.mcp).toBeTruthy();
    expect(cfg.mcp?.['palantir-mcp']).toBeTruthy();
    expect(cfg.mcp?.['palantir-mcp']?.command).toContain('--foundry-api-url');
    expect(cfg.mcp?.['palantir-mcp']?.command).toContain('https://foo.palantirfoundry.com');
  });

  it('migrates opencode.json into opencode.jsonc and renames to .bak', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue(['list_datasets']);

    const legacyPath = path.join(tmpDir, 'opencode.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ plugin: ['x'], tools: { other_tool: true } }, null, 2)
    );

    await runSetup('https://example.palantirfoundry.com');

    const cfgPath = path.join(tmpDir, 'opencode.jsonc');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as OpencodeConfig;

    expect(cfg.plugin).toEqual(['x']);
    expect(cfg.tools?.other_tool).toBe(true);

    const bakCandidates = fs.readdirSync(tmpDir).filter((f) => f.startsWith('opencode.json.bak'));
    expect(bakCandidates.length).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'opencode.json'))).toBe(false);
  });

  it('never persists FOUNDRY_TOKEN value to disk', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue(['list_datasets']);

    const prior = process.env.FOUNDRY_TOKEN;
    process.env.FOUNDRY_TOKEN = 'SENTINEL_SECRET';
    try {
      await runSetup('https://example.palantirfoundry.com');
    } finally {
      if (prior === undefined) delete process.env.FOUNDRY_TOKEN;
      else process.env.FOUNDRY_TOKEN = prior;
    }

    const text = fs.readFileSync(path.join(tmpDir, 'opencode.jsonc'), 'utf8');
    expect(text).not.toContain('SENTINEL_SECRET');
    expect(text).toContain('{env:FOUNDRY_TOKEN}');
  });

  it('does not overwrite existing mcp.palantir-mcp config', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue(['list_datasets']);

    const cfgPath = path.join(tmpDir, 'opencode.jsonc');
    const existing = {
      mcp: {
        'palantir-mcp': {
          type: 'local',
          command: ['custom', 'command'],
          environment: { FOUNDRY_TOKEN: '{env:FOUNDRY_TOKEN}' },
        },
      },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(existing, null, 2));

    await runSetup('https://other.palantirfoundry.com');

    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as OpencodeConfig;
    expect(cfg.mcp?.['palantir-mcp']?.command).toEqual(['custom', 'command']);
  });

  it('writes explicit palantir-mcp_* tool toggles for both agents', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue([
      'list_datasets',
      'get_dataset',
      'create_thing',
    ]);

    await runSetup('https://example.palantirfoundry.com');

    const cfg = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'opencode.jsonc'), 'utf8')
    ) as OpencodeConfig;

    expect(cfg.tools?.['palantir-mcp_*']).toBe(false);
    expect((cfg as unknown as Record<string, unknown>)['palantir_mcp']).toBeUndefined();

    expect(cfg.agent?.['foundry-librarian']?.description).toContain(
      'Generated by opencode-palantir /setup-palantir-mcp.'
    );
    expect(cfg.agent?.['foundry-librarian']?.description).toContain('Profile:');
    expect(cfg.agent?.foundry?.description).toContain(
      'Generated by opencode-palantir /setup-palantir-mcp.'
    );
    expect(cfg.agent?.foundry?.description).toContain('Profile:');

    expect(cfg.agent?.['foundry-librarian']?.tools?.get_doc_page).toBe(true);
    expect(cfg.agent?.['foundry-librarian']?.tools?.list_all_docs).toBe(true);
    expect(cfg.agent?.['foundry-librarian']?.mode).toBe('subagent');

    // execution agent defaults to no docs tools
    expect(cfg.agent?.foundry?.tools?.get_doc_page).toBe(false);
    expect(cfg.agent?.foundry?.tools?.list_all_docs).toBe(false);
    expect(cfg.agent?.foundry?.mode).toBe('all');

    expect(cfg.agent?.['foundry-librarian']?.tools?.['palantir-mcp_list_datasets']).toBe(true);
    expect(cfg.agent?.['foundry-librarian']?.tools?.['palantir-mcp_get_dataset']).toBe(true);
    expect(cfg.agent?.['foundry-librarian']?.tools?.['palantir-mcp_create_thing']).toBe(true);

    expect(cfg.agent?.foundry?.tools?.['palantir-mcp_list_datasets']).toBe(true);
    expect(cfg.agent?.foundry?.tools?.['palantir-mcp_get_dataset']).toBe(true);
    expect(cfg.agent?.foundry?.tools?.['palantir-mcp_create_thing']).toBe(true);
  });

  it('preserves explicit foundry mode when already set', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue(['list_datasets']);

    const cfgPath = path.join(tmpDir, 'opencode.jsonc');
    const existing = {
      agent: {
        foundry: {
          mode: 'subagent',
        },
      },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(existing, null, 2));

    await runSetup('https://example.palantirfoundry.com');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as OpencodeConfig;

    expect(cfg.agent?.foundry?.mode).toBe('subagent');
  });

  it('uses profile override when provided and reports detected profile', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue([
      'connect_to_dev_console_app',
      'delete_foundry_object_type',
    ]);

    fs.mkdirSync(path.join(tmpDir, 'transforms'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'transforms', 't.py'), 'def transform():\n  return 1\n');

    const result = await runSetup(
      'https://example.palantirfoundry.com --profile compute_modules_ts'
    );

    expect(result.text).toContain('Selected profile: compute_modules_ts');
    expect(result.text).toContain('Profile source: override (--profile)');
    expect(result.text).toContain('Detected profile: pipelines_transforms');

    const cfg = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'opencode.jsonc'), 'utf8')
    ) as OpencodeConfig;
    expect(cfg.agent?.foundry?.description).toContain('Profile: compute_modules_ts');

    // Broad defaults keep compute click-ops enabled by default.
    expect(cfg.agent?.foundry?.tools?.['palantir-mcp_connect_to_dev_console_app']).toBe(true);
    // Hard destructive deny list still applies.
    expect(cfg.agent?.foundry?.tools?.['palantir-mcp_delete_foundry_object_type']).toBe(false);
  });

  it('is idempotent for repeated runs', async () => {
    vi.spyOn(mcpClient, 'listPalantirMcpTools').mockResolvedValue(['list_datasets', 'get_dataset']);

    await runSetup('https://example.palantirfoundry.com');
    const first = fs.readFileSync(path.join(tmpDir, 'opencode.jsonc'), 'utf8');

    await runSetup('https://example.palantirfoundry.com');
    const second = fs.readFileSync(path.join(tmpDir, 'opencode.jsonc'), 'utf8');

    expect(second).toBe(first);
  });
});
