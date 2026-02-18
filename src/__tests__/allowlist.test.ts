import { describe, expect, it } from 'vitest';

import { computeAllowedTools } from '../palantir-mcp/allowlist.ts';

describe('computeAllowedTools', () => {
  it('uses default-enable with explicit deny rules and role separation', () => {
    const result = computeAllowedTools('default', [
      'list_datasets',
      'create_thing',
      'search_foundry_documentation',
      'custom_probe',
    ]);

    expect(result.librarianAllow.has('list_datasets')).toBe(true);
    expect(result.librarianAllow.has('search_foundry_documentation')).toBe(true);
    expect(result.librarianAllow.has('custom_probe')).toBe(true);
    expect(result.librarianAllow.has('create_thing')).toBe(false);

    expect(result.foundryAllow.has('list_datasets')).toBe(true);
    expect(result.foundryAllow.has('custom_probe')).toBe(true);
    expect(result.foundryAllow.has('create_thing')).toBe(true);
    expect(result.foundryAllow.has('search_foundry_documentation')).toBe(false);
  });
});
