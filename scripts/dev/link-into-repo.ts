import fs from 'node:fs/promises';
import path from 'node:path';

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
    '  bun run scripts/dev/link-into-repo.ts --target <repoPath> [--source dist|src]',
    '',
    'Example:',
    '  bun run scripts/dev/link-into-repo.ts --target ../palantir-compute-module-pipeline-search --source dist',
  ].join('\n');
}

async function main(): Promise<void> {
  const targetArg: string | null = getArg('--target');
  const sourceArg: string = (getArg('--source') ?? 'dist').trim();

  if (!targetArg) {
    // eslint-disable-next-line no-console
    console.error(getUsage());
    process.exit(2);
  }

  if (sourceArg !== 'dist' && sourceArg !== 'src') {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] Invalid --source: ${sourceArg}\n\n${getUsage()}`);
    process.exit(2);
  }

  const pluginRepoRoot: string = path.resolve(import.meta.dirname, '../..');
  const pluginEntry: string =
    sourceArg === 'dist'
      ? path.join(pluginRepoRoot, 'dist', 'index.js')
      : path.join(pluginRepoRoot, 'src', 'index.ts');

  const targetRepoRoot: string = path.resolve(process.cwd(), targetArg);
  const opencodeDir: string = path.join(targetRepoRoot, '.opencode');
  const pluginsDir: string = path.join(opencodeDir, 'plugins');

  await fs.mkdir(pluginsDir, { recursive: true });

  const wrapperPath: string = path.join(pluginsDir, 'opencode-palantir.js');
  const relImport: string = path.relative(pluginsDir, pluginEntry).replaceAll(path.sep, '/');
  const wrapperText: string = [
    '// Local dev wrapper to load the opencode-palantir plugin from this workspace.',
    '// OpenCode auto-loads .js/.ts files from .opencode/plugins/ at startup.',
    `import plugin from '${relImport.startsWith('.') ? relImport : `./${relImport}`}';`,
    '',
    'export default plugin;',
    '',
  ].join('\n');

  await fs.writeFile(wrapperPath, wrapperText, 'utf8');

  const opencodeGitignorePath: string = path.join(opencodeDir, '.gitignore');
  try {
    await fs.access(opencodeGitignorePath);
  } catch {
    await fs.writeFile(opencodeGitignorePath, 'node_modules/\nbun.lock\n', 'utf8');
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote ${wrapperPath}`);
  // eslint-disable-next-line no-console
  console.log('Next: restart OpenCode in the target repo.');
}

try {
  await main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${formatError(err)}`);
  process.exit(1);
}

