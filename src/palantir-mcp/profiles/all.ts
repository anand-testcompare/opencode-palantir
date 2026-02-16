import { createBroadProfile } from './shared.ts';

export const allProfilePolicy = createBroadProfile(
  'all',
  'Mixed / Monorepo',
  'Broad defaults for mixed repos that combine multiple Foundry surfaces.',
  [/compute/i, /pipeline/i, /transform/i, /osdk/i, /ontology/i]
);
