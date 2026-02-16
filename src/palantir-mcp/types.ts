export type ProfileId =
  | 'compute_modules'
  | 'compute_modules_ts'
  | 'compute_modules_py'
  | 'pipelines_transforms'
  | 'osdk_functions_ts'
  | 'all'
  | 'unknown';

export const PROFILE_IDS: readonly ProfileId[] = [
  'compute_modules',
  'compute_modules_ts',
  'compute_modules_py',
  'pipelines_transforms',
  'osdk_functions_ts',
  'all',
  'unknown',
];

export function parseProfileId(value: unknown): ProfileId | null {
  for (const profileId of PROFILE_IDS) {
    if (value === profileId) return profileId;
  }
  return null;
}
