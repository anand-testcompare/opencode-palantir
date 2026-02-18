import type { ProfileId } from './types.ts';

export type ComputedAllowlist = {
  librarianAllow: ReadonlySet<string>;
  foundryAllow: ReadonlySet<string>;
};

function matchesAny(toolName: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(toolName));
}

type ProfilePolicy = {
  librarianDeny: RegExp[];
  foundryDeny: RegExp[];
};

const LIBRARIAN_MUTATION_DENY: RegExp[] = [
  /(?:^|[_-])(create|update|delete|remove|set|write|put|post|patch|deploy|publish|commit|run|execute|trigger|start|stop|cancel|schedule|grant|revoke|upload|import|export|connect|convert|install|clone|close|replace|abort)(?:$|[_-])/i,
];

const FOUNDRY_DISCOVERY_DENY: RegExp[] = [
  /documentation/i,
  /(?:^|[_-])search_foundry_(documentation|ontology|functions)(?:$|[_-])/i,
  /(?:^|[_-])list_platform_sdk_apis(?:$|[_-])/i,
  /(?:^|[_-])get_platform_sdk_api_reference(?:$|[_-])/i,
  /(?:^|[_-])get_ontology_sdk_(context|examples)(?:$|[_-])/i,
  /(?:^|[_-])view_osdk_definition(?:$|[_-])/i,
];

const PROFILE_POLICIES: Record<ProfileId, ProfilePolicy> = {
  pipelines_transforms: {
    librarianDeny: [...LIBRARIAN_MUTATION_DENY],
    foundryDeny: [
      ...FOUNDRY_DISCOVERY_DENY,
      /(?:^|[_-])(convert_to_osdk_react|install_sdk_package|generate_new_ontology_sdk_version)(?:$|[_-])/i,
    ],
  },
  osdk_functions_ts: {
    librarianDeny: [...LIBRARIAN_MUTATION_DENY],
    foundryDeny: [
      ...FOUNDRY_DISCOVERY_DENY,
      /(?:^|[_-])(create_python_transforms_code_repository|get_python_transforms_documentation)(?:$|[_-])/i,
    ],
  },
  default: {
    librarianDeny: [...LIBRARIAN_MUTATION_DENY],
    foundryDeny: [...FOUNDRY_DISCOVERY_DENY],
  },
};

export function computeAllowedTools(profile: ProfileId, toolNames: string[]): ComputedAllowlist {
  const uniqueSortedTools: string[] = Array.from(new Set(toolNames)).sort((a, b) =>
    a.localeCompare(b)
  );
  const policy: ProfilePolicy = PROFILE_POLICIES[profile];

  const librarianAllow: Set<string> = new Set();
  const foundryAllow: Set<string> = new Set();

  for (const name of uniqueSortedTools) {
    if (!matchesAny(name, policy.librarianDeny)) {
      librarianAllow.add(name);
    }
    if (!matchesAny(name, policy.foundryDeny)) {
      foundryAllow.add(name);
    }
  }

  return { librarianAllow, foundryAllow };
}
