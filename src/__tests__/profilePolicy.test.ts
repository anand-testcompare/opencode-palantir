import { describe, expect, it } from 'vitest';

import { computeAllowedTools } from '../palantir-mcp/allowlist.ts';

describe('profile policy allowlists', () => {
  it('uses broad defaults for compute profiles and only denies hard-destructive tools', () => {
    const allowlist = computeAllowedTools('compute_modules', [
      'connect_to_dev_console_app',
      'create_foundry_branch',
      'delete_foundry_object_type',
    ]);

    expect(allowlist.policy.id).toBe('compute_modules');
    expect(allowlist.policy.librarianDefaultAllow).toBe('all');
    expect(allowlist.policy.foundryDefaultAllow).toBe('all');

    expect(allowlist.librarianAllow.has('connect_to_dev_console_app')).toBe(true);
    expect(allowlist.foundryAllow.has('connect_to_dev_console_app')).toBe(true);

    expect(allowlist.librarianAllow.has('create_foundry_branch')).toBe(true);
    expect(allowlist.foundryAllow.has('create_foundry_branch')).toBe(true);

    expect(allowlist.librarianAllow.has('delete_foundry_object_type')).toBe(false);
    expect(allowlist.foundryAllow.has('delete_foundry_object_type')).toBe(false);
    expect(allowlist.policy.deniedTools).toContain('delete_foundry_object_type');
  });

  it('keeps unknown profile broad by default to optimize usability', () => {
    const allowlist = computeAllowedTools('unknown', ['create_foundry_branch']);

    expect(allowlist.policy.id).toBe('unknown');
    expect(allowlist.librarianAllow.has('create_foundry_branch')).toBe(true);
    expect(allowlist.foundryAllow.has('create_foundry_branch')).toBe(true);
  });
});
