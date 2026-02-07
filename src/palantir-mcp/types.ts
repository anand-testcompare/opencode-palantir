export type ProfileId = 'pipelines_transforms' | 'osdk_functions_ts' | 'all' | 'unknown';

export function parseProfileId(value: unknown): ProfileId | null {
  if (value === 'pipelines_transforms') return value;
  if (value === 'osdk_functions_ts') return value;
  if (value === 'all') return value;
  if (value === 'unknown') return value;
  return null;
}
