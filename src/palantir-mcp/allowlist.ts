import type { ProfileId } from './types.ts';

export type ComputedAllowlist = {
  librarianAllow: ReadonlySet<string>;
  foundryAllow: ReadonlySet<string>;
};

function isMutatingTool(toolName: string): boolean {
  // Conservative. Err on the side of disabling anything that sounds like it changes state.
  const re: RegExp =
    /(?:^|[_-])(create|update|delete|remove|set|write|put|post|patch|deploy|publish|commit|run|execute|trigger|start|stop|cancel|schedule|grant|revoke|upload|import|export)(?:$|[_-])/i;
  return re.test(toolName);
}

function isReadOnlyTool(toolName: string): boolean {
  const re: RegExp =
    /(?:^|[_-])(get|list|search|query|describe|read|fetch|inspect|schema|metadata|lineage|preview|validate|diff)(?:$|[_-])/i;
  return re.test(toolName);
}

function matchesAny(toolName: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(toolName));
}

export function computeAllowedTools(profile: ProfileId, toolNames: string[]): ComputedAllowlist {
  const uniqueSortedTools: string[] = Array.from(new Set(toolNames)).sort((a, b) =>
    a.localeCompare(b)
  );

  const librarianAllow: Set<string> = new Set();

  const pipelinesBoost: RegExp[] = [
    /pipeline/i,
    /transform/i,
    /job/i,
    /dataset/i,
    /ontology/i,
    /object/i,
    /action/i,
    /lineage/i,
    /schema/i,
    /preview/i,
  ];

  const osdkBoost: RegExp[] = [
    /osdk/i,
    /function/i,
    /artifact/i,
    /package/i,
    /release/i,
    /deploy/i,
  ];

  for (const name of uniqueSortedTools) {
    if (isMutatingTool(name)) continue;

    if (profile === 'all') {
      librarianAllow.add(name);
      continue;
    }

    if (isReadOnlyTool(name)) {
      librarianAllow.add(name);
      continue;
    }

    if (profile === 'pipelines_transforms' && matchesAny(name, pipelinesBoost)) {
      librarianAllow.add(name);
      continue;
    }

    if (profile === 'osdk_functions_ts' && matchesAny(name, osdkBoost)) {
      librarianAllow.add(name);
      continue;
    }
  }

  // v1: keep foundry agent conservative as well; it can be expanded later.
  const foundryAllow: Set<string> = new Set(librarianAllow);

  return { librarianAllow, foundryAllow };
}
