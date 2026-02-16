import fs from 'node:fs/promises';
import path from 'node:path';

import type { Dirent } from 'node:fs';

import type { ProfileId } from './types.ts';

export type RepoScanResult = {
  profile: ProfileId;
  scores: Record<ProfileId, number>;
  reasons: string[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readTextFileBounded(p: string, maxBytes: number): Promise<string | null> {
  try {
    const file = await fs.open(p, 'r');
    try {
      const buf: Buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await file.read(buf, 0, maxBytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

function addScore(
  scores: Record<ProfileId, number>,
  reasons: string[],
  profile: ProfileId,
  delta: number,
  reason: string
): void {
  scores[profile] += delta;
  reasons.push(reason);
}

function hasComputeModuleSignal(text: string): boolean {
  return (
    /compute[\s._-]*modules?/i.test(text) ||
    /foundry[\s._-]*compute/i.test(text) ||
    /dev[\s._-]*console/i.test(text) ||
    /network[\s._-]*egress/i.test(text)
  );
}

function pickBestProfile(scores: Record<ProfileId, number>): ProfileId {
  const threshold: number = 3;

  const tsScore: number = scores.compute_modules_ts;
  const pyScore: number = scores.compute_modules_py;
  const specificThreshold: number = 4;
  if (tsScore >= specificThreshold && pyScore < specificThreshold) return 'compute_modules_ts';
  if (pyScore >= specificThreshold && tsScore < specificThreshold) return 'compute_modules_py';
  if (tsScore >= specificThreshold && pyScore >= specificThreshold) return 'compute_modules';

  const ordered: ProfileId[] = [
    'compute_modules_ts',
    'compute_modules_py',
    'compute_modules',
    'all',
    'pipelines_transforms',
    'osdk_functions_ts',
    'unknown',
  ];

  let best: ProfileId = 'unknown';
  let bestScore: number = -1;

  for (const p of ordered) {
    const s: number = scores[p];
    if (s > bestScore) {
      best = p;
      bestScore = s;
    }
  }

  if (bestScore < threshold) return 'unknown';
  return best;
}

async function parsePackageJson(p: string): Promise<PackageJson | null> {
  const text: string | null = await readTextFileBounded(p, 200_000);
  if (!text) return null;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

function getAllDependencyKeys(pkg: PackageJson): string[] {
  const deps: Record<string, string> = pkg.dependencies ?? {};
  const dev: Record<string, string> = pkg.devDependencies ?? {};
  const peer: Record<string, string> = pkg.peerDependencies ?? {};
  return Object.keys({ ...deps, ...dev, ...peer });
}

async function collectSampleFiles(root: string, limit: number): Promise<string[]> {
  const ignoreDirs: Set<string> = new Set([
    '.git',
    'node_modules',
    'dist',
    '.opencode',
    'data',
    '.memory',
    '.sisyphus',
    '.zed',
    '.mise',
    'coverage',
    'build',
  ]);

  const allowedExts: Set<string> = new Set([
    '.md',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.yaml',
    '.yml',
    '.toml',
    '.json',
  ]);

  const results: string[] = [];
  const queue: string[] = [root];
  const maxDirs: number = 1500;
  let visitedDirs: number = 0;

  while (queue.length > 0 && results.length < limit && visitedDirs < maxDirs) {
    const dir: string = queue.shift() ?? '';
    if (!dir) continue;
    visitedDirs += 1;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (results.length >= limit) break;

      const full: string = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ignoreDirs.has(ent.name)) continue;
        queue.push(full);
        continue;
      }

      if (!ent.isFile()) continue;
      const ext: string = path.extname(ent.name);
      if (!allowedExts.has(ext)) continue;
      results.push(full);
    }
  }

  return results;
}

function addComputeModuleSignalsFromPath(
  scores: Record<ProfileId, number>,
  reasons: string[],
  root: string,
  relPath: string
): Promise<void> {
  const fullPath: string = path.join(root, relPath);
  return pathExists(fullPath).then((exists) => {
    if (!exists) return;
    addScore(scores, reasons, 'compute_modules', 3, `Found ${relPath} directory`);
  });
}

export async function scanRepoForProfile(root: string): Promise<RepoScanResult> {
  const scores: Record<ProfileId, number> = {
    compute_modules: 0,
    compute_modules_ts: 0,
    compute_modules_py: 0,
    pipelines_transforms: 0,
    osdk_functions_ts: 0,
    all: 0,
    unknown: 0,
  };
  const reasons: string[] = [];

  const monorepoCandidates: Array<{ p: string; score: number; reason: string }> = [
    { p: 'pnpm-workspace.yaml', score: 3, reason: 'Found pnpm-workspace.yaml' },
    { p: 'turbo.json', score: 3, reason: 'Found turbo.json' },
    { p: 'nx.json', score: 3, reason: 'Found nx.json' },
    { p: 'lerna.json', score: 3, reason: 'Found lerna.json' },
  ];

  for (const c of monorepoCandidates) {
    if (await pathExists(path.join(root, c.p))) {
      addScore(scores, reasons, 'all', c.score, c.reason);
    }
  }

  const packageJsonPath: string = path.join(root, 'package.json');
  const pyprojectPath: string = path.join(root, 'pyproject.toml');
  const requirementsPath: string = path.join(root, 'requirements.txt');
  const tsconfigPath: string = path.join(root, 'tsconfig.json');

  const hasPackageJson: boolean = await pathExists(packageJsonPath);
  const hasPyproject: boolean = await pathExists(pyprojectPath);
  const hasRequirements: boolean = await pathExists(requirementsPath);
  const hasTsconfig: boolean = await pathExists(tsconfigPath);

  if (hasPackageJson && hasPyproject) {
    addScore(scores, reasons, 'all', 2, 'Found both package.json and pyproject.toml');
  }

  if (hasPackageJson) {
    const pkg: PackageJson | null = await parsePackageJson(packageJsonPath);
    if (pkg) {
      const depKeys: string[] = getAllDependencyKeys(pkg);
      const depKeysLower: string[] = depKeys.map((d) => d.toLowerCase());

      if (depKeysLower.some((d) => d.includes('osdk') || d.startsWith('@osdk/'))) {
        addScore(scores, reasons, 'osdk_functions_ts', 5, 'package.json includes OSDK dependency');
      }

      if (depKeysLower.some((d) => d.includes('palantir') || d.includes('foundry'))) {
        addScore(
          scores,
          reasons,
          'pipelines_transforms',
          1,
          'package.json references palantir/foundry'
        );
      }

      const hasComputeDep: boolean = depKeysLower.some(
        (d) =>
          d.includes('compute-module') ||
          d.includes('compute_module') ||
          d.includes('compute.module') ||
          (d.includes('compute') && d.includes('module'))
      );
      if (hasComputeDep) {
        addScore(
          scores,
          reasons,
          'compute_modules',
          5,
          'package.json includes compute-module dependency'
        );
      }

      const hasTypeScriptSignal: boolean = depKeysLower.some(
        (d) => d === 'typescript' || d === 'tsx' || d === 'ts-node' || d.includes('typescript')
      );
      if (hasComputeDep && hasTypeScriptSignal) {
        addScore(
          scores,
          reasons,
          'compute_modules_ts',
          4,
          'package.json indicates TypeScript compute-module setup'
        );
      }

      const scriptText: string = Object.values(pkg.scripts ?? {})
        .filter((v) => typeof v === 'string')
        .join('\n');
      if (hasComputeModuleSignal(scriptText)) {
        addScore(
          scores,
          reasons,
          'compute_modules',
          2,
          'package.json scripts mention compute-module workflow'
        );
      }
    }
  }

  if (hasPyproject) {
    const text: string | null = await readTextFileBounded(pyprojectPath, 200_000);
    if (text) {
      if (/foundry/i.test(text)) {
        addScore(scores, reasons, 'pipelines_transforms', 1, 'pyproject.toml mentions foundry');
      }
      if (/transform/i.test(text)) {
        addScore(scores, reasons, 'pipelines_transforms', 1, 'pyproject.toml mentions transform');
      }
      if (hasComputeModuleSignal(text)) {
        addScore(
          scores,
          reasons,
          'compute_modules_py',
          5,
          'pyproject.toml mentions compute modules'
        );
        addScore(
          scores,
          reasons,
          'compute_modules',
          2,
          'pyproject.toml includes compute-module signals'
        );
      }
    }
  }

  if (hasRequirements) {
    const text: string | null = await readTextFileBounded(requirementsPath, 200_000);
    if (text) {
      if (/foundry/i.test(text)) {
        addScore(scores, reasons, 'pipelines_transforms', 1, 'requirements.txt mentions foundry');
      }
      if (/transform/i.test(text)) {
        addScore(scores, reasons, 'pipelines_transforms', 1, 'requirements.txt mentions transform');
      }
      if (hasComputeModuleSignal(text)) {
        addScore(
          scores,
          reasons,
          'compute_modules_py',
          4,
          'requirements.txt mentions compute modules'
        );
        addScore(
          scores,
          reasons,
          'compute_modules',
          2,
          'requirements.txt includes compute-module signals'
        );
      }
    }
  }

  if (await pathExists(path.join(root, 'pipelines'))) {
    addScore(scores, reasons, 'pipelines_transforms', 3, 'Found pipelines/ directory');
  }
  if (await pathExists(path.join(root, 'transforms'))) {
    addScore(scores, reasons, 'pipelines_transforms', 3, 'Found transforms/ directory');
  }
  if (await pathExists(path.join(root, 'internal', 'pipeline'))) {
    addScore(scores, reasons, 'pipelines_transforms', 3, 'Found internal/pipeline/ directory');
  }
  if (await pathExists(path.join(root, 'internal', 'transforms'))) {
    addScore(scores, reasons, 'pipelines_transforms', 3, 'Found internal/transforms/ directory');
  }
  if (await pathExists(path.join(root, 'functions'))) {
    addScore(scores, reasons, 'osdk_functions_ts', 2, 'Found functions/ directory');
  }
  if (await pathExists(path.join(root, 'src', 'functions'))) {
    addScore(scores, reasons, 'osdk_functions_ts', 2, 'Found src/functions/ directory');
  }

  const computeDirs: string[] = [
    'compute-modules',
    'compute_modules',
    'compute',
    path.join('src', 'compute-modules'),
    path.join('src', 'compute_modules'),
    path.join('src', 'compute'),
    path.join('modules', 'compute'),
    path.join('internal', 'compute-modules'),
    path.join('internal', 'compute_modules'),
  ];
  for (const rel of computeDirs) {
    await addComputeModuleSignalsFromPath(scores, reasons, root, rel);
  }

  const computeConfigFiles: string[] = [
    'compute-module.yaml',
    'compute-module.yml',
    'compute_module.yaml',
    'compute_module.yml',
    'foundry-compute-module.yaml',
    'foundry-compute-module.yml',
  ];
  for (const rel of computeConfigFiles) {
    if (await pathExists(path.join(root, rel))) {
      addScore(scores, reasons, 'compute_modules', 4, `Found ${rel}`);
    }
  }

  if (hasTsconfig && scores.compute_modules > 0) {
    addScore(
      scores,
      reasons,
      'compute_modules_ts',
      2,
      'Found tsconfig.json with compute-module signals'
    );
  }
  if ((hasPyproject || hasRequirements) && scores.compute_modules > 0) {
    addScore(
      scores,
      reasons,
      'compute_modules_py',
      2,
      'Found Python packaging files with compute-module signals'
    );
  }

  const sampleFiles: string[] = await collectSampleFiles(root, 75);
  const maxTotalBytes: number = 220_000;
  let consumedBytes: number = 0;

  let pipelinesHits: number = 0;
  let osdkHits: number = 0;
  let computeHits: number = 0;
  let computeTsHits: number = 0;
  let computePyHits: number = 0;

  for (const p of sampleFiles) {
    if (consumedBytes >= maxTotalBytes) break;

    const text: string | null = await readTextFileBounded(p, 8000);
    if (!text) continue;
    consumedBytes += text.length;

    if (/\b(pipeline|pipelines|transform|transforms)\b/i.test(text)) pipelinesHits += 1;
    if (/\bosdk\b/i.test(text)) osdkHits += 1;

    const relLower: string = path.relative(root, p).toLowerCase();
    const ext: string = path.extname(relLower);
    const hasComputeText: boolean = hasComputeModuleSignal(text);
    const hasComputePath: boolean =
      relLower.includes('compute-module') || relLower.includes('compute_module');

    if (hasComputeText || hasComputePath) {
      computeHits += 1;
      if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
        computeTsHits += 1;
      }
      if (ext === '.py') {
        computePyHits += 1;
      }
    }
  }

  if (pipelinesHits >= 3) {
    addScore(
      scores,
      reasons,
      'pipelines_transforms',
      2,
      `Keyword sample hits pipelines/transforms (${pipelinesHits})`
    );
  }

  if (osdkHits >= 2) {
    addScore(scores, reasons, 'osdk_functions_ts', 2, `Keyword sample hits osdk (${osdkHits})`);
  }

  if (computeHits >= 2) {
    addScore(
      scores,
      reasons,
      'compute_modules',
      3,
      `Keyword sample hits compute-module workflows (${computeHits})`
    );
  }

  if (computeTsHits >= 2) {
    addScore(
      scores,
      reasons,
      'compute_modules_ts',
      3,
      `Keyword sample hits TypeScript compute-module files (${computeTsHits})`
    );
  }

  if (computePyHits >= 2) {
    addScore(
      scores,
      reasons,
      'compute_modules_py',
      3,
      `Keyword sample hits Python compute-module files (${computePyHits})`
    );
  }

  if (scores.compute_modules_ts >= 3 && scores.compute_modules_py >= 3) {
    addScore(
      scores,
      reasons,
      'compute_modules',
      3,
      'Detected both TypeScript and Python compute-module signals'
    );
  }

  const profile: ProfileId = pickBestProfile(scores);
  return { profile, scores, reasons };
}
