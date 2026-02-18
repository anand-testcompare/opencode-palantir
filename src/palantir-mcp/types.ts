export type ProfileId = 'pipelines_transforms' | 'osdk_functions_ts' | 'default';

export function parseProfileId(value: unknown): ProfileId | null {
  if (value === 'pipelines_transforms') return value;
  if (value === 'osdk_functions_ts') return value;
  if (value === 'default') return value;
  return null;
}
