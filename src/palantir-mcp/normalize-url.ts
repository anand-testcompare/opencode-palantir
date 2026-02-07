export type NormalizeFoundryBaseUrlResult = { url: string; warnings: string[] } | { error: string };

export function normalizeFoundryBaseUrl(raw: string): NormalizeFoundryBaseUrlResult {
  const trimmed: string = raw.trim();
  if (!trimmed) return { error: 'Missing Foundry base URL.' };

  const warnings: string[] = [];

  let candidate: string = trimmed;
  if (!candidate.startsWith('http://') && !candidate.startsWith('https://')) {
    candidate = `https://${candidate}`;
    warnings.push('No scheme provided; assuming https://');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { error: `Invalid Foundry URL: ${raw}` };
  }

  if (parsed.protocol !== 'https:') {
    warnings.push(`Non-https scheme (${parsed.protocol}) provided; normalizing to https://`);
  }

  const hasExtraParts: boolean =
    parsed.pathname !== '/' || parsed.search.length > 0 || parsed.hash.length > 0;
  if (hasExtraParts) {
    warnings.push('Ignoring URL path/query/fragment; using origin only');
  }

  const normalized: URL = new URL(`https://${parsed.host}`);
  return { url: normalized.origin, warnings };
}
