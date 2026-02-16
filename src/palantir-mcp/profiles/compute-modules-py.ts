import { createBroadProfile } from './shared.ts';

export const computeModulesPyPolicy = createBroadProfile(
  'compute_modules_py',
  'Compute Modules (Python)',
  'Broad operational baseline for Python-first compute module repos.',
  [/compute/i, /module/i, /python/i, /\bpy\b/i, /dev_console/i, /egress/i]
);
