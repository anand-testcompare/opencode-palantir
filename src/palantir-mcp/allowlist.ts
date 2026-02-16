import { getProfilePolicy, type AgentToolPolicy } from './profiles/index.ts';
import type { ProfileId } from './types.ts';

export type ComputedAllowlist = {
  librarianAllow: ReadonlySet<string>;
  foundryAllow: ReadonlySet<string>;
  policy: {
    id: ProfileId;
    title: string;
    description: string;
    librarianDefaultAllow: AgentToolPolicy['defaultAllow'];
    foundryDefaultAllow: AgentToolPolicy['defaultAllow'];
    deniedTools: string[];
  };
};

function isReadOnlyTool(toolName: string): boolean {
  const re: RegExp =
    /(?:^|[_-])(get|list|search|query|describe|read|fetch|inspect|schema|metadata|lineage|preview|validate|diff|view)(?:$|[_-])/i;
  return re.test(toolName);
}

function matchesAny(toolName: string, patterns: readonly RegExp[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => p.test(toolName));
}

function matchesExact(toolName: string, names: readonly string[] | undefined): boolean {
  if (!names || names.length === 0) return false;
  return names.includes(toolName);
}

function evaluateAgentPolicy(
  toolNames: string[],
  policy: AgentToolPolicy
): {
  allow: Set<string>;
  deniedByPolicy: Set<string>;
} {
  const allow: Set<string> = new Set();
  const deniedByPolicy: Set<string> = new Set();

  for (const name of toolNames) {
    let enabled: boolean = policy.defaultAllow === 'all' || isReadOnlyTool(name);
    if (!enabled && matchesAny(name, policy.allowPatterns)) {
      enabled = true;
    }

    const denied: boolean =
      matchesExact(name, policy.denyTools) || matchesAny(name, policy.denyPatterns);
    if (denied) {
      enabled = false;
      deniedByPolicy.add(name);
    }

    if (enabled) allow.add(name);
  }

  return { allow, deniedByPolicy };
}

export function computeAllowedTools(profile: ProfileId, toolNames: string[]): ComputedAllowlist {
  const uniqueSortedTools: string[] = Array.from(new Set(toolNames)).sort((a, b) =>
    a.localeCompare(b)
  );
  const policy = getProfilePolicy(profile);

  const librarianEval = evaluateAgentPolicy(uniqueSortedTools, policy.librarian);
  const foundryEval = evaluateAgentPolicy(uniqueSortedTools, policy.foundry);

  const deniedTools: string[] = Array.from(
    new Set([...librarianEval.deniedByPolicy, ...foundryEval.deniedByPolicy])
  ).sort((a, b) => a.localeCompare(b));

  return {
    librarianAllow: librarianEval.allow,
    foundryAllow: foundryEval.allow,
    policy: {
      id: policy.id,
      title: policy.title,
      description: policy.description,
      librarianDefaultAllow: policy.librarian.defaultAllow,
      foundryDefaultAllow: policy.foundry.defaultAllow,
      deniedTools,
    },
  };
}
