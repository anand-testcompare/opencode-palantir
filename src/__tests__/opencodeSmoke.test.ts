import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import type { CommandHook, CommandHookOutput, MinimalPlugin } from './testTypes.ts';
import {
  readOpencodeJsonc,
  stringifyJsonc,
  writeFileAtomic,
} from '../palantir-mcp/opencode-config.ts';

function resolveOpencodeBin(): string {
  const fromEnv: string | undefined = process.env.OPENCODE_BIN;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  // Prefer the opencode-managed install if present (common when multiple installs exist).
  const preferred: string = '/home/anandpant/.opencode/bin/opencode';
  if (fs.existsSync(preferred)) return preferred;

  return 'opencode';
}

function readDotEnvValue(envPath: string, key: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return null;
  }

  for (const line of text.split('\n')) {
    const trimmed: string = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith(`${key}=`)) continue;

    const raw: string = trimmed.slice(key.length + 1);
    let val: string = raw.trim();
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1);
    }
    if (!val) return null;
    return val;
  }

  return null;
}

async function runCommand(
  cmd: string[],
  opts: { cwd: string }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });

  const stdout: string = await new Response(proc.stdout).text();
  const stderr: string = await new Response(proc.stderr).text();
  const exitCode: number = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function runCommandWithRetries(
  cmd: string[],
  opts: { cwd: string; attempts: number; delayMs: number }
): Promise<{ exitCode: number; stdout: string; stderr: string; attempt: number }> {
  let last: { exitCode: number; stdout: string; stderr: string } | null = null;
  for (let attempt = 1; attempt <= opts.attempts; attempt += 1) {
    const res = await runCommand(cmd, { cwd: opts.cwd });
    last = res;
    if (res.exitCode === 0) return { ...res, attempt };
    await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return { ...(last ?? { exitCode: 1, stdout: '', stderr: '' }), attempt: opts.attempts };
}

function safeWriteBackupIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const ts: string = new Date().toISOString().replace(/[:.]/g, '-');
  const backup: string = `${filePath}.smoke.bak.${ts}`;
  fs.copyFileSync(filePath, backup);
}

const canRunSmoke: boolean = !!process.env.OPENCODE_SMOKE_REPO;

const describeSmoke = canRunSmoke ? describe : describe.skip;

describeSmoke('opencode smoke: setup-palantir-mcp -> opencode debug', () => {
  it('writes schema-valid config (no palantir_mcp) and opencode debug loads agents', async () => {
    const repo: string = path.resolve(process.env.OPENCODE_SMOKE_REPO ?? '');
    const opencodeBin: string = resolveOpencodeBin();

    const urlFromEnv: string | undefined = process.env.OPENCODE_SMOKE_FOUNDRY_URL;
    const urlFromDotEnv: string | null = readDotEnvValue(path.join(repo, '.env'), 'FOUNDRY_URL');
    const foundryUrl: string | null = (urlFromEnv && urlFromEnv.trim()) || urlFromDotEnv;

    expect(fs.existsSync(repo)).toBe(true);

    const cfgPath: string = path.join(repo, 'opencode.jsonc');
    safeWriteBackupIfExists(cfgPath);

    const hasToken: boolean =
      typeof process.env.FOUNDRY_TOKEN === 'string' && process.env.FOUNDRY_TOKEN.length > 0;

    if (!fs.existsSync(cfgPath)) {
      // If no config exists, only /setup can create it, which requires URL + token.
      expect(foundryUrl).toBeTruthy();
      expect(hasToken).toBe(true);

      const plugin = (await import('../index.ts')).default as unknown as MinimalPlugin;
      const hooks = await plugin({ worktree: repo });
      const hook = hooks['command.execute.before'];
      expect(typeof hook).toBe('function');

      const output: CommandHookOutput = { parts: [] };
      await (hook as CommandHook)(
        {
          command: 'setup-palantir-mcp',
          sessionID: 'smoke-session',
          arguments: String(foundryUrl),
        },
        output
      );
    } else {
      // If config exists (even if invalid), fix it without requiring Foundry access.
      const read = await readOpencodeJsonc(repo);
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error('unreachable');

      const data: unknown = read.data;
      expect(!!data && typeof data === 'object' && !Array.isArray(data)).toBe(true);
      const root = data as Record<string, unknown>;

      if (root.palantir_mcp !== undefined) {
        delete root.palantir_mcp;
        await writeFileAtomic(cfgPath, stringifyJsonc(root));
      }
    }

    expect(fs.existsSync(cfgPath)).toBe(true);

    const cfgText: string = fs.readFileSync(cfgPath, 'utf8');
    expect(cfgText).not.toContain('"palantir_mcp"');

    const debugConfig = await runCommandWithRetries(
      [opencodeBin, 'debug', 'config', '--log-level', 'ERROR'],
      { cwd: repo, attempts: 3, delayMs: 750 }
    );
    if (debugConfig.exitCode !== 0) {
      throw new Error(
        `opencode debug config failed (attempt ${debugConfig.attempt})\\n` +
          `stderr:\\n${debugConfig.stderr.slice(-4000)}\\n` +
          `stdout:\\n${debugConfig.stdout.slice(-4000)}`
      );
    }
    expect(debugConfig.stderr).not.toContain('Unrecognized key');

    const debugLibrarian = await runCommandWithRetries(
      [opencodeBin, 'debug', 'agent', 'foundry-librarian', '--log-level', 'ERROR'],
      { cwd: repo, attempts: 3, delayMs: 750 }
    );
    if (debugLibrarian.exitCode !== 0) {
      throw new Error(
        `opencode debug agent foundry-librarian failed (attempt ${debugLibrarian.attempt})\\n` +
          `stderr:\\n${debugLibrarian.stderr.slice(-4000)}\\n` +
          `stdout:\\n${debugLibrarian.stdout.slice(-4000)}`
      );
    }
    expect(debugLibrarian.stdout).toContain('foundry-librarian');
    expect(debugLibrarian.stdout).toContain('palantir-mcp_');

    const debugFoundry = await runCommandWithRetries(
      [opencodeBin, 'debug', 'agent', 'foundry', '--log-level', 'ERROR'],
      {
        cwd: repo,
        attempts: 3,
        delayMs: 750,
      }
    );
    if (debugFoundry.exitCode !== 0) {
      throw new Error(
        `opencode debug agent foundry failed (attempt ${debugFoundry.attempt})\\n` +
          `stderr:\\n${debugFoundry.stderr.slice(-4000)}\\n` +
          `stdout:\\n${debugFoundry.stdout.slice(-4000)}`
      );
    }
    expect(debugFoundry.stdout).toContain('foundry');
  }, 60_000);
});
