import fs from 'node:fs/promises';
import path from 'node:path';

import type { ProfileId } from './types.ts';

export type RepoScanResult = {
  profile: ProfileId;
  reasons: string[];
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type ScanContext = {
  packageJson: PackageJson | null;
  packageJsonLoaded: boolean;
  pyprojectText: string | null;
  pyprojectLoaded: boolean;
  requirementsText: string | null;
  requirementsLoaded: boolean;
};

type HardSignature = {
  profile: Exclude<ProfileId, 'default'>;
  reason: string;
  matches: (root: string, context: ScanContext) => Promise<boolean>;
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

async function getPackageJson(root: string, context: ScanContext): Promise<PackageJson | null> {
  if (context.packageJsonLoaded) return context.packageJson;
  context.packageJsonLoaded = true;

  const packageJsonPath: string = path.join(root, 'package.json');
  const text: string | null = await readTextFileBounded(packageJsonPath, 200_000);
  if (!text) {
    context.packageJson = null;
    return null;
  }

  try {
    context.packageJson = JSON.parse(text) as PackageJson;
  } catch {
    context.packageJson = null;
  }
  return context.packageJson;
}

async function getPyprojectText(root: string, context: ScanContext): Promise<string | null> {
  if (context.pyprojectLoaded) return context.pyprojectText;
  context.pyprojectLoaded = true;
  context.pyprojectText = await readTextFileBounded(path.join(root, 'pyproject.toml'), 200_000);
  return context.pyprojectText;
}

async function getRequirementsText(root: string, context: ScanContext): Promise<string | null> {
  if (context.requirementsLoaded) return context.requirementsText;
  context.requirementsLoaded = true;
  context.requirementsText = await readTextFileBounded(
    path.join(root, 'requirements.txt'),
    200_000
  );
  return context.requirementsText;
}

function listDependencyNames(pkg: PackageJson | null): string[] {
  if (!pkg) return [];
  const dependencies: Record<string, string> = pkg.dependencies ?? {};
  const devDependencies: Record<string, string> = pkg.devDependencies ?? {};
  const peerDependencies: Record<string, string> = pkg.peerDependencies ?? {};
  return Object.keys({ ...dependencies, ...devDependencies, ...peerDependencies });
}

const HARD_SIGNATURES: HardSignature[] = [
  {
    profile: 'pipelines_transforms',
    reason: 'Found transforms/ directory.',
    matches: async (root) => pathExists(path.join(root, 'transforms')),
  },
  {
    profile: 'pipelines_transforms',
    reason: 'Found pipelines/ directory.',
    matches: async (root) => pathExists(path.join(root, 'pipelines')),
  },
  {
    profile: 'pipelines_transforms',
    reason: 'Found internal/transforms/ directory.',
    matches: async (root) => pathExists(path.join(root, 'internal', 'transforms')),
  },
  {
    profile: 'pipelines_transforms',
    reason: 'Found internal/pipeline/ directory.',
    matches: async (root) => pathExists(path.join(root, 'internal', 'pipeline')),
  },
  {
    profile: 'pipelines_transforms',
    reason: 'pyproject.toml references transforms.api.',
    matches: async (root, context) => {
      const text: string | null = await getPyprojectText(root, context);
      if (!text) return false;
      return /\btransforms\.api\b/i.test(text);
    },
  },
  {
    profile: 'pipelines_transforms',
    reason: 'requirements.txt references transforms.api.',
    matches: async (root, context) => {
      const text: string | null = await getRequirementsText(root, context);
      if (!text) return false;
      return /\btransforms\.api\b/i.test(text);
    },
  },
  {
    profile: 'osdk_functions_ts',
    reason: 'package.json includes an @osdk/* dependency.',
    matches: async (root, context) => {
      const depNames: string[] = listDependencyNames(await getPackageJson(root, context));
      return depNames.some((name) => name.startsWith('@osdk/'));
    },
  },
];

export async function scanRepoForProfile(root: string): Promise<RepoScanResult> {
  const context: ScanContext = {
    packageJson: null,
    packageJsonLoaded: false,
    pyprojectText: null,
    pyprojectLoaded: false,
    requirementsText: null,
    requirementsLoaded: false,
  };

  for (const signature of HARD_SIGNATURES) {
    if (await signature.matches(root, context)) {
      return {
        profile: signature.profile,
        reasons: [signature.reason],
      };
    }
  }

  return {
    profile: 'default',
    reasons: ['No hard signature matched. Falling back to default profile.'],
  };
}
