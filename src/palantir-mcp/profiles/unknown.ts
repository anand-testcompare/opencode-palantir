import { createBroadProfile } from './shared.ts';

export const unknownProfilePolicy = createBroadProfile(
  'unknown',
  'Unknown',
  'Broad defaults when repo signals are inconclusive; platform authorization remains the guardrail.',
  [/compute/i, /pipeline/i, /transform/i, /osdk/i, /ontology/i]
);
