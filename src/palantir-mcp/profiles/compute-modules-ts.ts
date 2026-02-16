import { createBroadProfile } from './shared.ts';

export const computeModulesTsPolicy = createBroadProfile(
  'compute_modules_ts',
  'Compute Modules (TypeScript)',
  'Broad operational baseline for TypeScript-first compute module repos.',
  [/compute/i, /module/i, /typescript/i, /\bts\b/i, /dev_console/i, /egress/i]
);
