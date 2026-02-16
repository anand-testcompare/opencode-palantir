import { createBroadProfile } from './shared.ts';

export const computeModulesPolicy = createBroadProfile(
  'compute_modules',
  'Compute Modules',
  'Broad operational baseline for Foundry compute module repos.',
  [/compute/i, /module/i, /dev_console/i, /egress/i]
);
