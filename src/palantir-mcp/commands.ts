import path from 'node:path';

import { computeAllowedTools } from './allowlist.ts';
import { listPalantirMcpTools } from './mcp-client.ts';
import { normalizeFoundryBaseUrl } from './normalize-url.ts';
import {
  OPENCODE_JSONC_FILENAME,
  extractFoundryApiUrlFromMcpConfig,
  mergeLegacyIntoJsonc,
  patchConfigForRescan,
  patchConfigForSetup,
  readLegacyOpencodeJson,
  readOpencodeJsonc,
  renameLegacyToBak,
  stringifyJsonc,
  writeFileAtomic,
  type PatchResult,
} from './opencode-config.ts';
import { scanRepoForProfile } from './repo-scan.ts';
import type { ProfileId } from './types.ts';

function formatError(err: unknown): string {
  return err instanceof Error ? err.toString() : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';
  return `\n\nWarnings:\n${warnings.map((w) => `- ${w}`).join('\n')}`;
}

function formatPatchSummary(patch: PatchResult): string {
  const s = patch.summary;
  const lines: string[] = [];
  lines.push(`Profile: ${s.profile}`);
  lines.push(`Discovered palantir-mcp tools: ${s.toolCount}`);
  lines.push(`Enabled (foundry-librarian): ${s.librarianEnabled}`);
  lines.push(`Enabled (foundry): ${s.foundryEnabled}`);
  if (s.preservedExistingToggles) {
    lines.push(
      'Note: existing palantir-mcp_* tool toggles were preserved; delete them under the Foundry agents to fully regenerate.'
    );
  }
  return lines.join('\n');
}

async function resolveProfile(worktree: string): Promise<{
  profile: ProfileId;
  reasons: string[];
}> {
  try {
    const scan = await scanRepoForProfile(worktree);
    return { profile: scan.profile, reasons: scan.reasons };
  } catch (err) {
    return {
      profile: 'unknown',
      reasons: [`Repo scan failed; falling back to unknown: ${formatError(err)}`],
    };
  }
}

export async function setupPalantirMcp(worktree: string, rawArgs: string): Promise<string> {
  const urlArg: string = rawArgs.trim();
  if (!urlArg) {
    return [
      '[ERROR] Missing Foundry base URL.',
      '',
      'Usage:',
      '  /setup-palantir-mcp <foundry_api_url>',
      '',
      'Example:',
      '  /setup-palantir-mcp https://23dimethyl.usw-3.palantirfoundry.com',
    ].join('\n');
  }

  const normalized = normalizeFoundryBaseUrl(urlArg);
  if ('error' in normalized) return `[ERROR] ${normalized.error}`;

  if (!process.env.FOUNDRY_TOKEN) {
    return [
      '[ERROR] FOUNDRY_TOKEN is not set in your environment.',
      '',
      'palantir-mcp tool discovery requires a token. Export FOUNDRY_TOKEN and retry.',
    ].join('\n');
  }

  const readJsonc = await readOpencodeJsonc(worktree);
  if (!readJsonc.ok && 'error' in readJsonc) return readJsonc.error;

  const readLegacy = await readLegacyOpencodeJson(worktree);
  if (!readLegacy.ok && 'error' in readLegacy) return readLegacy.error;

  const baseJsoncData: unknown = readJsonc.ok ? readJsonc.data : {};
  const base: Record<string, unknown> = isRecord(baseJsoncData) ? baseJsoncData : {};
  const merged: Record<string, unknown> = readLegacy.ok
    ? mergeLegacyIntoJsonc(readLegacy.data, base)
    : { ...base };

  const existingMcpUrlRaw: string | null = extractFoundryApiUrlFromMcpConfig(merged);
  const existingMcpUrlNorm = existingMcpUrlRaw ? normalizeFoundryBaseUrl(existingMcpUrlRaw) : null;

  const { profile } = await resolveProfile(worktree);
  const discoveryUrl: string =
    existingMcpUrlNorm && 'url' in existingMcpUrlNorm ? existingMcpUrlNorm.url : normalized.url;
  let toolNames: string[];
  try {
    toolNames = await listPalantirMcpTools(discoveryUrl);
  } catch (err) {
    return `[ERROR] ${formatError(err)}`;
  }
  if (toolNames.length === 0) return '[ERROR] palantir-mcp tool discovery returned no tools.';

  const allowlist = computeAllowedTools(profile, toolNames);
  const patch = patchConfigForSetup(merged, {
    foundryApiUrl: normalized.url,
    toolNames,
    profile,
    allowlist,
  });

  const outPath: string = path.join(worktree, OPENCODE_JSONC_FILENAME);
  const text: string = stringifyJsonc(patch.data);

  try {
    await writeFileAtomic(outPath, text);
  } catch (err) {
    return `[ERROR] Failed writing ${OPENCODE_JSONC_FILENAME}: ${formatError(err)}`;
  }

  let bakInfo: string = '';
  if (readLegacy.ok) {
    try {
      const bakPath: string | null = await renameLegacyToBak(worktree);
      if (bakPath) bakInfo = `\nMigrated legacy ${readLegacy.path} -> ${bakPath}`;
    } catch (err) {
      bakInfo = `\n[ERROR] Wrote ${OPENCODE_JSONC_FILENAME}, but failed to rename legacy ${readLegacy.path}: ${formatError(err)}`;
    }
  }

  const warnings: string[] = [...normalized.warnings, ...patch.warnings];
  if (
    existingMcpUrlNorm &&
    'url' in existingMcpUrlNorm &&
    existingMcpUrlNorm.url !== normalized.url
  ) {
    warnings.push(
      `mcp.palantir-mcp already exists and points to ${existingMcpUrlNorm.url}; it was left unchanged.`
    );
  }

  return [
    'palantir-mcp setup complete.',
    '',
    formatPatchSummary(patch),
    bakInfo,
    formatWarnings(warnings),
  ]
    .filter((x) => x.trim().length > 0)
    .join('\n');
}

export async function rescanPalantirMcpTools(worktree: string): Promise<string> {
  if (!process.env.FOUNDRY_TOKEN) {
    return [
      '[ERROR] FOUNDRY_TOKEN is not set in your environment.',
      '',
      'palantir-mcp tool discovery requires a token. Export FOUNDRY_TOKEN and retry.',
    ].join('\n');
  }

  const readJsonc = await readOpencodeJsonc(worktree);
  if (!readJsonc.ok) {
    if ('missing' in readJsonc) {
      return `[ERROR] Missing ${OPENCODE_JSONC_FILENAME}. Run /setup-palantir-mcp <foundry_api_url> first.`;
    }
    return readJsonc.error;
  }

  const baseData: unknown = readJsonc.data;
  if (!isRecord(baseData))
    return `[ERROR] ${OPENCODE_JSONC_FILENAME} must contain a JSON object at the root.`;

  const foundryUrlRaw: string | null = extractFoundryApiUrlFromMcpConfig(baseData);
  if (!foundryUrlRaw) {
    return [
      '[ERROR] Could not find mcp.palantir-mcp local server with --foundry-api-url in config.',
      'Run /setup-palantir-mcp <foundry_api_url> first.',
    ].join('\n');
  }

  const normalized = normalizeFoundryBaseUrl(foundryUrlRaw);
  if ('error' in normalized) return `[ERROR] Invalid Foundry URL in config: ${normalized.error}`;

  const { profile } = await resolveProfile(worktree);
  let toolNames: string[];
  try {
    toolNames = await listPalantirMcpTools(normalized.url);
  } catch (err) {
    return `[ERROR] ${formatError(err)}`;
  }
  if (toolNames.length === 0) return '[ERROR] palantir-mcp tool discovery returned no tools.';

  const allowlist = computeAllowedTools(profile, toolNames);
  const patch = patchConfigForRescan(baseData, { toolNames, profile, allowlist });

  const outPath: string = path.join(worktree, OPENCODE_JSONC_FILENAME);
  const text: string = stringifyJsonc(patch.data);

  try {
    await writeFileAtomic(outPath, text);
  } catch (err) {
    return `[ERROR] Failed writing ${OPENCODE_JSONC_FILENAME}: ${formatError(err)}`;
  }

  const warnings: string[] = [...normalized.warnings, ...patch.warnings];

  return [
    'palantir-mcp tools rescan complete.',
    '',
    formatPatchSummary(patch),
    formatWarnings(warnings),
  ]
    .filter((x) => x.trim().length > 0)
    .join('\n');
}
