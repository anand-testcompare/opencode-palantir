import path from 'node:path';
import fs from 'node:fs/promises';

function formatError(err: unknown): string {
  return err instanceof Error ? err.toString() : String(err);
}

function getArg(flag: string): string | null {
  const idx: number = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value: string | undefined = process.argv[idx + 1];
  if (!value) return null;
  return value;
}

function getUsage(): string {
  return [
    'Usage:',
    '  bun run scripts/dev/run-opencode-command.ts --repo <repoPath> --command <name> [--args <string>]',
    '',
    'Examples:',
    '  bun run scripts/dev/run-opencode-command.ts --repo ../palantir-compute-module-pipeline-search --command setup-palantir-mcp --args \"https://23dimethyl.usw-3.palantirfoundry.com\"',
    '  bun run scripts/dev/run-opencode-command.ts --repo ../palantir-compute-module-pipeline-search --command rescan-palantir-mcp-tools',
  ].join('\n');
}

async function tryReadDotEnvValue(envPath: string, key: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(envPath, 'utf8');
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

async function main(): Promise<void> {
  const repoArg: string | null = getArg('--repo');
  const commandArg: string | null = getArg('--command');
  let argsArg: string = (getArg('--args') ?? '').toString();

  if (!repoArg || !commandArg) {
    // eslint-disable-next-line no-console
    console.error(getUsage());
    process.exit(2);
  }

  const repoRoot: string = path.resolve(process.cwd(), repoArg);

  if (commandArg === 'setup-palantir-mcp' && !argsArg.trim()) {
    const foundryUrl: string | null = await tryReadDotEnvValue(path.join(repoRoot, '.env'), 'FOUNDRY_URL');
    if (foundryUrl) argsArg = foundryUrl;
  }

  const pluginRepoRoot: string = path.resolve(import.meta.dirname, '../..');
  const pluginPath: string = path.join(pluginRepoRoot, 'dist', 'index.js');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const plugin = (await import(pluginPath)).default as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hooks = (await plugin({ worktree: repoRoot } as any)) as any;
  if (typeof hooks['command.execute.before'] !== 'function') {
    throw new Error('Plugin missing command.execute.before hook');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = { parts: [] as any[] };
  await hooks['command.execute.before'](
    { command: commandArg, sessionID: 'dev-session', arguments: argsArg },
    output
  );

  const textParts = output.parts
    .filter((p: unknown) => !!p && typeof p === 'object' && (p as any).type === 'text')
    .map((p: any) => p.text as string);

  // eslint-disable-next-line no-console
  console.log(textParts.join('\n\n'));
}

try {
  await main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${formatError(err)}`);
  process.exit(1);
}
