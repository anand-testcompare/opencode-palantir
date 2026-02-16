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
  if (value === 'compute_modules') return value;
  if (value === 'compute_modules_ts') return value;
  if (value === 'compute_modules_py') return value;
  if (value === 'pipelines_transforms') return value;
  if (value === 'osdk_functions_ts') return value;
  if (value === 'all') return value;
  if (value === 'unknown') return value;
  return null;
}
