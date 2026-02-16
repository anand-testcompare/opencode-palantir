import type { ProfileId } from '../types.ts';
import type { AgentToolPolicy, ProfilePolicy } from './policy-types.ts';

const DESTRUCTIVE_DENY_PATTERNS: readonly RegExp[] = [
  /(?:^|[_-])(delete|destroy|purge|wipe|drop)(?:$|[_-])/i,
  /permanently[_-]?delete/i,
];

function buildBroadAgentPolicy(extraAllowPatterns: readonly RegExp[] = []): AgentToolPolicy {
  return {
    defaultAllow: 'all',
    allowPatterns: extraAllowPatterns,
    denyPatterns: DESTRUCTIVE_DENY_PATTERNS,
  };
}

export function createBroadProfile(
  id: ProfileId,
  title: string,
  description: string,
  extraAllowPatterns: readonly RegExp[] = []
): ProfilePolicy {
  return {
    id,
    title,
    description,
    librarian: buildBroadAgentPolicy(extraAllowPatterns),
    foundry: buildBroadAgentPolicy(extraAllowPatterns),
  };
}
