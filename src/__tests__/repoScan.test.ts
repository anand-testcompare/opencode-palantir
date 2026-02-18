import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scanRepoForProfile } from '../palantir-mcp/repo-scan.ts';

describe('scanRepoForProfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-scan-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies pipelines_transforms from hard directory signature', async () => {
    fs.mkdirSync(path.join(tmpDir, 'transforms'));

    const result = await scanRepoForProfile(tmpDir);
    expect(result.profile).toBe('pipelines_transforms');
    expect(result.reasons[0]).toContain('transforms/');
  });

  it('classifies osdk_functions_ts from @osdk dependency signature', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          name: 'sample',
          dependencies: {
            '@osdk/client': '^1.0.0',
          },
        },
        null,
        2
      )
    );

    const result = await scanRepoForProfile(tmpDir);
    expect(result.profile).toBe('osdk_functions_ts');
    expect(result.reasons[0]).toContain('@osdk/');
  });

  it('falls back to default when no hard signature is present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[project]\nname = "foundry-transform-app"\ndescription = "transform utilities"\n'
    );
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'foundry transform osdk');

    const result = await scanRepoForProfile(tmpDir);
    expect(result.profile).toBe('default');
    expect(result.reasons[0]).toContain('No hard signature matched');
  });
});
