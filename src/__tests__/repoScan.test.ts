import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanRepoForProfile } from '../palantir-mcp/repo-scan.ts';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-scan-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0, tmpDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('scanRepoForProfile', () => {
  it('detects compute_modules_ts for TypeScript compute module repos', async () => {
    const root: string = makeTmpDir();
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          dependencies: {
            '@palantir/compute-module-sdk': '^1.0.0',
            typescript: '^5.0.0',
          },
        },
        null,
        2
      )
    );
    fs.mkdirSync(path.join(root, 'src', 'compute-modules'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src', 'compute-modules', 'index.ts'),
      'export const runComputeModule = () => "compute module";\n'
    );

    const scan = await scanRepoForProfile(root);
    expect(scan.profile).toBe('compute_modules_ts');
    expect(scan.reasons.join('\n')).toContain('compute-module dependency');
  });

  it('detects compute_modules_py for Python compute module repos', async () => {
    const root: string = makeTmpDir();
    fs.writeFileSync(
      path.join(root, 'pyproject.toml'),
      [
        '[project]',
        'name = "compute-modules-python"',
        'dependencies = ["palantir-foundry-compute-modules"]',
      ].join('\n')
    );
    fs.mkdirSync(path.join(root, 'compute_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'compute_modules', 'main.py'),
      'def run_compute_module() -> str:\n    return "ok"\n'
    );

    const scan = await scanRepoForProfile(root);
    expect(scan.profile).toBe('compute_modules_py');
    expect(scan.reasons.join('\n')).toContain('pyproject.toml mentions compute modules');
  });

  it('detects compute_modules for mixed TypeScript and Python signals', async () => {
    const root: string = makeTmpDir();
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          dependencies: {
            '@palantir/compute-module-sdk': '^1.0.0',
            typescript: '^5.0.0',
          },
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(root, 'pyproject.toml'),
      ['[project]', 'name = "hybrid"', 'dependencies = ["foundry-compute-modules"]'].join('\n')
    );
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: {} }, null, 2)
    );

    const scan = await scanRepoForProfile(root);
    expect(scan.profile).toBe('compute_modules');
    expect(scan.reasons.join('\n')).toContain(
      'Detected both TypeScript and Python compute-module signals'
    );
  });

  it('falls back to unknown when confidence is low', async () => {
    const root: string = makeTmpDir();
    fs.writeFileSync(path.join(root, 'README.md'), '# hello\n');

    const scan = await scanRepoForProfile(root);
    expect(scan.profile).toBe('unknown');
  });
});
