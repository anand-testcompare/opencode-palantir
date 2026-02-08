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

function stableSortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSortJson);
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[k] = stableSortJson(value[k]);
  }
  return out;
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableSortJson(value));
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

function hasPalantirToolToggles(
  data: Record<string, unknown>,
  agentName: 'foundry-librarian' | 'foundry'
): boolean {
  const agents: unknown = data['agent'];
  if (!isRecord(agents)) return false;
  const agent: unknown = agents[agentName];
  if (!isRecord(agent)) return false;
  const tools: unknown = agent['tools'];
  if (!isRecord(tools)) return false;
  return Object.keys(tools).some((k) => k.startsWith('palantir-mcp_'));
}

function isAutoBootstrapAlreadyComplete(data: Record<string, unknown>): boolean {
  const foundryUrl: string | null = extractFoundryApiUrlFromMcpConfig(data);

  const toolsRoot: unknown = data['tools'];
  const hasGlobalDeny: boolean = isRecord(toolsRoot) && toolsRoot['palantir-mcp_*'] === false;

  const hasAgentToggles: boolean =
    hasPalantirToolToggles(data, 'foundry-librarian') && hasPalantirToolToggles(data, 'foundry');

  return !!foundryUrl && hasGlobalDeny && hasAgentToggles;
}

export async function autoBootstrapPalantirMcpIfConfigured(worktree: string): Promise<void> {
  try {
    const tokenRaw: string | undefined = process.env.FOUNDRY_TOKEN;
    const urlRaw: string | undefined = process.env.FOUNDRY_URL;
    if (!tokenRaw || tokenRaw.trim().length === 0) return;
    if (!urlRaw || urlRaw.trim().length === 0) return;

    const normalized = normalizeFoundryBaseUrl(urlRaw);
    if ('error' in normalized) return;

    const readJsonc = await readOpencodeJsonc(worktree);
    if (!readJsonc.ok && !('missing' in readJsonc)) return;

    const readLegacy = await readLegacyOpencodeJson(worktree);
    if (!readLegacy.ok && !('missing' in readLegacy)) return;

    const baseJsoncData: unknown = readJsonc.ok ? readJsonc.data : {};
    const base: Record<string, unknown> = isRecord(baseJsoncData) ? baseJsoncData : {};
    const merged: Record<string, unknown> = readLegacy.ok
      ? mergeLegacyIntoJsonc(readLegacy.data, base)
      : { ...base };

    if (isAutoBootstrapAlreadyComplete(merged)) return;

    const existingMcpUrlRaw: string | null = extractFoundryApiUrlFromMcpConfig(merged);
    const existingMcpUrlNorm = existingMcpUrlRaw
      ? normalizeFoundryBaseUrl(existingMcpUrlRaw)
      : null;

    const { profile } = await resolveProfile(worktree);
    const discoveryUrl: string =
      existingMcpUrlNorm && 'url' in existingMcpUrlNorm ? existingMcpUrlNorm.url : normalized.url;

    const toolNames: string[] = await listPalantirMcpTools(discoveryUrl);
    if (toolNames.length === 0) return;

    const allowlist = computeAllowedTools(profile, toolNames);
    const patch = patchConfigForSetup(merged, {
      foundryApiUrl: normalized.url,
      toolNames,
      profile,
      allowlist,
    });

    const jsoncMissing: boolean = !readJsonc.ok && 'missing' in readJsonc;
    const needsMigration: boolean = jsoncMissing && readLegacy.ok;
    const changed: boolean =
      needsMigration || stableJsonStringify(merged) !== stableJsonStringify(patch.data);

    if (!changed) return;

    const outPath: string = path.join(worktree, OPENCODE_JSONC_FILENAME);
    const text: string = stringifyJsonc(patch.data);
    await writeFileAtomic(outPath, text);

    if (readLegacy.ok) {
      await renameLegacyToBak(worktree);
    }
  } catch {
    // Best-effort; never block startup on bootstrap failures.
    return;
  }
}

export async function setupPalantirMcp(worktree: string, rawArgs: string): Promise<string> {
  const urlFromArgs: string = rawArgs.trim();
  const urlFromEnvRaw: string | undefined = process.env.FOUNDRY_URL;
  const urlFromEnv: string = typeof urlFromEnvRaw === 'string' ? urlFromEnvRaw.trim() : '';
  const urlArg: string = urlFromArgs || urlFromEnv;
  if (!urlArg) {
    return [
      '[ERROR] Missing Foundry base URL.',
      '',
      'Usage:',
      '  /setup-palantir-mcp <foundry_api_url>',
      '',
      'Or set:',
      '  export FOUNDRY_URL=<foundry_api_url>',
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
      '',
      'Tip: if `echo $FOUNDRY_TOKEN` prints a value but this still errors, it is likely ' +
        'not exported.',
      'Run `export FOUNDRY_TOKEN` (or set `export FOUNDRY_TOKEN=...` in your shell ' +
        'secrets) and retry.',
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
      '',
      'Tip: if `echo $FOUNDRY_TOKEN` prints a value but this still errors, it is likely ' +
        'not exported.',
      'Run `export FOUNDRY_TOKEN` (or set `export FOUNDRY_TOKEN=...` in your shell ' +
        'secrets) and retry.',
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
