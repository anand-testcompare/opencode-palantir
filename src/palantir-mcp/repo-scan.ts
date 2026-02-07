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

function pickBestProfile(scores: Record<ProfileId, number>): ProfileId {
  const threshold: number = 3;

  const ordered: ProfileId[] = ['all', 'pipelines_transforms', 'osdk_functions_ts', 'unknown'];
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
    '.js',
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

export async function scanRepoForProfile(root: string): Promise<RepoScanResult> {
  const scores: Record<ProfileId, number> = {
    pipelines_transforms: 0,
    osdk_functions_ts: 0,
    all: 0,
    unknown: 0,
  };
  const reasons: string[] = [];

  const candidates: Array<{ p: string; profile: ProfileId; score: number; reason: string }> = [
    { p: 'pnpm-workspace.yaml', profile: 'all', score: 3, reason: 'Found pnpm-workspace.yaml' },
    { p: 'turbo.json', profile: 'all', score: 3, reason: 'Found turbo.json' },
    { p: 'nx.json', profile: 'all', score: 3, reason: 'Found nx.json' },
    { p: 'lerna.json', profile: 'all', score: 3, reason: 'Found lerna.json' },
  ];

  for (const c of candidates) {
    if (await pathExists(path.join(root, c.p))) {
      addScore(scores, reasons, c.profile, c.score, c.reason);
    }
  }

  const packageJsonPath: string = path.join(root, 'package.json');
  const pyprojectPath: string = path.join(root, 'pyproject.toml');
  const requirementsPath: string = path.join(root, 'requirements.txt');

  const hasPackageJson: boolean = await pathExists(packageJsonPath);
  const hasPyproject: boolean = await pathExists(pyprojectPath);
  if (hasPackageJson && hasPyproject) {
    addScore(scores, reasons, 'all', 2, 'Found both package.json and pyproject.toml');
  }

  if (hasPackageJson) {
    const pkg: PackageJson | null = await parsePackageJson(packageJsonPath);
    if (pkg) {
      const depKeys: string[] = getAllDependencyKeys(pkg);

      if (depKeys.some((d) => d.toLowerCase().includes('osdk') || d.startsWith('@osdk/'))) {
        addScore(scores, reasons, 'osdk_functions_ts', 5, 'package.json includes OSDK dependency');
      }

      if (
        depKeys.some(
          (d) => d.toLowerCase().includes('palantir') || d.toLowerCase().includes('foundry')
        )
      ) {
        addScore(
          scores,
          reasons,
          'pipelines_transforms',
          1,
          'package.json references palantir/foundry'
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
    }
  }

  if (await pathExists(requirementsPath)) {
    const text: string | null = await readTextFileBounded(requirementsPath, 200_000);
    if (text) {
      if (/foundry/i.test(text)) {
        addScore(scores, reasons, 'pipelines_transforms', 1, 'requirements.txt mentions foundry');
      }
      if (/transform/i.test(text)) {
        addScore(scores, reasons, 'pipelines_transforms', 1, 'requirements.txt mentions transform');
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

  const sampleFiles: string[] = await collectSampleFiles(root, 50);
  const maxTotalBytes: number = 200_000;
  let consumedBytes: number = 0;

  let pipelinesHits: number = 0;
  let osdkHits: number = 0;

  for (const p of sampleFiles) {
    if (consumedBytes >= maxTotalBytes) break;

    const text: string | null = await readTextFileBounded(p, 8000);
    if (!text) continue;

    consumedBytes += text.length;

    if (/\b(pipeline|pipelines|transform|transforms)\b/i.test(text)) pipelinesHits += 1;
    if (/\bosdk\b/i.test(text)) osdkHits += 1;
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

  const profile: ProfileId = pickBestProfile(scores);

  return { profile, scores, reasons };
}
