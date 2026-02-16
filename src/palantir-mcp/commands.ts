import path from 'node:path';

import { computeAllowedTools, type ComputedAllowlist } from './allowlist.ts';
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
import { PROFILE_IDS, parseProfileId, type ProfileId } from './types.ts';

const PROFILE_OVERRIDE_ENV_KEYS: readonly string[] = [
  'PALANTIR_MCP_PROFILE',
  'OPENCODE_PALANTIR_PROFILE',
];

type ParsedSetupArgs =
  | { ok: true; foundryUrlArg: string; profileOverrideArg: string | null }
  | { ok: false; error: string };

type ParsedRescanArgs =
  | { ok: true; profileOverrideArg: string | null }
  | { ok: false; error: string };

type ProfileOverride = {
  profile: ProfileId;
  sourceLabel: string;
};

type ProfileOverrideResolution = {
  override: ProfileOverride | null;
  warnings: string[];
  error: string | null;
};

type ProfileResolution = {
  profile: ProfileId;
  profileSource: 'detected' | 'override';
  detectedProfile: ProfileId;
  detectionReasons: string[];
  override: ProfileOverride | null;
};

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

function formatProfileChoices(): string {
  return PROFILE_IDS.join(', ');
}

function setupUsageText(): string {
  return [
    'Usage:',
    '  /setup-palantir-mcp <foundry_api_url> [--profile <profile_id>]',
    '',
    'Or set:',
    '  export FOUNDRY_URL=<foundry_api_url>',
    '',
    `Valid profile IDs: ${formatProfileChoices()}`,
    '',
    'Example:',
    '  /setup-palantir-mcp https://totally-not-skynet.palantirfoundry.com --profile compute_modules_ts',
  ].join('\n');
}

function rescanUsageText(): string {
  return [
    'Usage:',
    '  /rescan-palantir-mcp-tools [--profile <profile_id>]',
    '',
    `Valid profile IDs: ${formatProfileChoices()}`,
    '',
    'Example:',
    '  /rescan-palantir-mcp-tools --profile compute_modules',
  ].join('\n');
}

function tokenizeArgs(rawArgs: string): string[] {
  return rawArgs
    .trim()
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function parseSetupArgs(rawArgs: string): ParsedSetupArgs {
  const tokens: string[] = tokenizeArgs(rawArgs);
  let foundryUrlArg: string = '';
  let profileOverrideArg: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token: string = tokens[i];
    if (token === '--profile') {
      const next: string | undefined = tokens[i + 1];
      if (!next || next.startsWith('--')) {
        return { ok: false, error: 'Missing value for --profile.' };
      }
      profileOverrideArg = next;
      i += 1;
      continue;
    }

    if (token.startsWith('--profile=')) {
      const value: string = token.slice('--profile='.length).trim();
      if (!value) return { ok: false, error: 'Missing value for --profile.' };
      profileOverrideArg = value;
      continue;
    }

    if (token.startsWith('--')) {
      return { ok: false, error: `Unknown option: ${token}` };
    }

    if (foundryUrlArg) {
      return {
        ok: false,
        error:
          'Unexpected extra positional argument. Expected only one Foundry URL positional argument.',
      };
    }
    foundryUrlArg = token;
  }

  return { ok: true, foundryUrlArg, profileOverrideArg };
}

function parseRescanArgs(rawArgs: string): ParsedRescanArgs {
  const tokens: string[] = tokenizeArgs(rawArgs);
  let profileOverrideArg: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token: string = tokens[i];
    if (token === '--profile') {
      const next: string | undefined = tokens[i + 1];
      if (!next || next.startsWith('--')) {
        return { ok: false, error: 'Missing value for --profile.' };
      }
      profileOverrideArg = next;
      i += 1;
      continue;
    }

    if (token.startsWith('--profile=')) {
      const value: string = token.slice('--profile='.length).trim();
      if (!value) return { ok: false, error: 'Missing value for --profile.' };
      profileOverrideArg = value;
      continue;
    }

    if (token.startsWith('--')) {
      return { ok: false, error: `Unknown option: ${token}` };
    }

    return {
      ok: false,
      error: `Unexpected positional argument: ${token}. This command only accepts --profile.`,
    };
  }

  return { ok: true, profileOverrideArg };
}

function parseProfileFromRaw(
  raw: string,
  sourceLabel: string
): { profile: ProfileId | null; error: string | null } {
  const parsed: ProfileId | null = parseProfileId(raw);
  if (!parsed) {
    return {
      profile: null,
      error: `${sourceLabel} profile "${raw}" is invalid. Valid values: ${formatProfileChoices()}.`,
    };
  }
  return { profile: parsed, error: null };
}

function firstEnvProfileOverrideRaw(): { raw: string | null; key: string | null } {
  for (const key of PROFILE_OVERRIDE_ENV_KEYS) {
    const raw: string | undefined = process.env[key];
    if (typeof raw !== 'string') continue;
    const trimmed: string = raw.trim();
    if (!trimmed) continue;
    return { raw: trimmed, key };
  }
  return { raw: null, key: null };
}

function resolveProfileOverride(
  profileOverrideArg: string | null,
  opts: { strictEnvValidation: boolean }
): ProfileOverrideResolution {
  const warnings: string[] = [];
  const envOverride = firstEnvProfileOverrideRaw();

  if (profileOverrideArg) {
    const parsedArg = parseProfileFromRaw(profileOverrideArg, '--profile');
    if (parsedArg.error || !parsedArg.profile) {
      return { override: null, warnings, error: parsedArg.error ?? 'Invalid --profile value.' };
    }

    if (envOverride.raw && envOverride.key) {
      const parsedEnv = parseProfileFromRaw(envOverride.raw, envOverride.key);
      if (parsedEnv.error) {
        warnings.push(
          `${envOverride.key}="${envOverride.raw}" is invalid and was ignored because --profile was provided.`
        );
      } else if (parsedEnv.profile !== parsedArg.profile) {
        warnings.push(
          `--profile ${parsedArg.profile} overrides ${envOverride.key}=${parsedEnv.profile}.`
        );
      }
    }

    return {
      override: { profile: parsedArg.profile, sourceLabel: '--profile' },
      warnings,
      error: null,
    };
  }

  if (!envOverride.raw || !envOverride.key) {
    return { override: null, warnings, error: null };
  }

  const parsedEnv = parseProfileFromRaw(envOverride.raw, envOverride.key);
  if (parsedEnv.error || !parsedEnv.profile) {
    if (opts.strictEnvValidation) {
      return { override: null, warnings, error: parsedEnv.error ?? 'Invalid environment profile.' };
    }

    warnings.push(`${envOverride.key}="${envOverride.raw}" is invalid and was ignored.`);
    return { override: null, warnings, error: null };
  }

  return {
    override: { profile: parsedEnv.profile, sourceLabel: envOverride.key },
    warnings,
    error: null,
  };
}

function formatPatchSummary(
  patch: PatchResult,
  profileResolution: ProfileResolution,
  allowlist: ComputedAllowlist
): string {
  const s = patch.summary;
  const lines: string[] = [];

  lines.push(`Selected profile: ${profileResolution.profile}`);
  if (profileResolution.profileSource === 'override' && profileResolution.override) {
    lines.push(`Profile source: override (${profileResolution.override.sourceLabel})`);
    lines.push(`Detected profile: ${profileResolution.detectedProfile}`);
  } else {
    lines.push('Profile source: detected');
  }

  if (profileResolution.detectionReasons.length > 0) {
    lines.push(`Profile signals: ${profileResolution.detectionReasons.slice(0, 3).join('; ')}`);
  }

  lines.push(`Policy: ${allowlist.policy.title} (${allowlist.policy.id})`);
  lines.push(
    `Policy defaults: foundry-librarian=${allowlist.policy.librarianDefaultAllow}, foundry=${allowlist.policy.foundryDefaultAllow}`
  );
  lines.push(`Policy-denied tools: ${allowlist.policy.deniedTools.length}/${s.toolCount}`);
  if (allowlist.policy.deniedTools.length > 0) {
    const preview: string = allowlist.policy.deniedTools.slice(0, 6).join(', ');
    const suffix: string = allowlist.policy.deniedTools.length > 6 ? ', ...' : '';
    lines.push(`Policy deny preview: ${preview}${suffix}`);
  }

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

async function resolveProfile(
  worktree: string,
  override: ProfileOverride | null
): Promise<ProfileResolution> {
  let detectedProfile: ProfileId = 'unknown';
  let detectionReasons: string[] = [];

  try {
    const scan = await scanRepoForProfile(worktree);
    detectedProfile = scan.profile;
    detectionReasons = scan.reasons;
  } catch (err) {
    detectedProfile = 'unknown';
    detectionReasons = [`Repo scan failed; falling back to unknown: ${formatError(err)}`];
  }

  if (override) {
    return {
      profile: override.profile,
      profileSource: 'override',
      detectedProfile,
      detectionReasons,
      override,
    };
  }

  return {
    profile: detectedProfile,
    profileSource: 'detected',
    detectedProfile,
    detectionReasons,
    override: null,
  };
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

    const overrideResolution = resolveProfileOverride(null, { strictEnvValidation: false });
    const profileResolution = await resolveProfile(worktree, overrideResolution.override);
    const discoveryUrl: string =
      existingMcpUrlNorm && 'url' in existingMcpUrlNorm ? existingMcpUrlNorm.url : normalized.url;

    const toolNames: string[] = await listPalantirMcpTools(discoveryUrl);
    if (toolNames.length === 0) return;

    const allowlist = computeAllowedTools(profileResolution.profile, toolNames);
    const patch = patchConfigForSetup(merged, {
      foundryApiUrl: normalized.url,
      toolNames,
      profile: profileResolution.profile,
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
  } catch (err) {
    // Best-effort; never block startup on bootstrap failures.
    // Intentionally no logging here (no-console; avoid polluting TUI). Use /setup-palantir-mcp
    // for explicit, user-visible error output.
    void err;
    return;
  }
}

export async function setupPalantirMcp(worktree: string, rawArgs: string): Promise<string> {
  const parsedArgs = parseSetupArgs(rawArgs);
  if (!parsedArgs.ok) {
    return [`[ERROR] ${parsedArgs.error}`, '', setupUsageText()].join('\n');
  }

  const overrideResolution = resolveProfileOverride(parsedArgs.profileOverrideArg, {
    strictEnvValidation: true,
  });
  if (overrideResolution.error) {
    return `[ERROR] ${overrideResolution.error}`;
  }

  const urlFromEnvRaw: string | undefined = process.env.FOUNDRY_URL;
  const urlFromEnv: string = typeof urlFromEnvRaw === 'string' ? urlFromEnvRaw.trim() : '';
  const urlArg: string = parsedArgs.foundryUrlArg || urlFromEnv;
  if (!urlArg) {
    return ['[ERROR] Missing Foundry base URL.', '', setupUsageText()].join('\n');
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

  const profileResolution = await resolveProfile(worktree, overrideResolution.override);
  const discoveryUrl: string =
    existingMcpUrlNorm && 'url' in existingMcpUrlNorm ? existingMcpUrlNorm.url : normalized.url;
  let toolNames: string[];
  try {
    toolNames = await listPalantirMcpTools(discoveryUrl);
  } catch (err) {
    return `[ERROR] ${formatError(err)}`;
  }
  if (toolNames.length === 0) return '[ERROR] palantir-mcp tool discovery returned no tools.';

  const allowlist = computeAllowedTools(profileResolution.profile, toolNames);
  const patch = patchConfigForSetup(merged, {
    foundryApiUrl: normalized.url,
    toolNames,
    profile: profileResolution.profile,
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

  const warnings: string[] = [
    ...overrideResolution.warnings,
    ...normalized.warnings,
    ...patch.warnings,
  ];
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
    formatPatchSummary(patch, profileResolution, allowlist),
    bakInfo,
    formatWarnings(warnings),
  ]
    .filter((x) => x.trim().length > 0)
    .join('\n');
}

export async function rescanPalantirMcpTools(worktree: string, rawArgs: string): Promise<string> {
  const parsedArgs = parseRescanArgs(rawArgs);
  if (!parsedArgs.ok) {
    return [`[ERROR] ${parsedArgs.error}`, '', rescanUsageText()].join('\n');
  }

  const overrideResolution = resolveProfileOverride(parsedArgs.profileOverrideArg, {
    strictEnvValidation: true,
  });
  if (overrideResolution.error) return `[ERROR] ${overrideResolution.error}`;

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

  const profileResolution = await resolveProfile(worktree, overrideResolution.override);
  let toolNames: string[];
  try {
    toolNames = await listPalantirMcpTools(normalized.url);
  } catch (err) {
    return `[ERROR] ${formatError(err)}`;
  }
  if (toolNames.length === 0) return '[ERROR] palantir-mcp tool discovery returned no tools.';

  const allowlist = computeAllowedTools(profileResolution.profile, toolNames);
  const patch = patchConfigForRescan(baseData, {
    toolNames,
    profile: profileResolution.profile,
    allowlist,
  });

  const outPath: string = path.join(worktree, OPENCODE_JSONC_FILENAME);
  const text: string = stringifyJsonc(patch.data);

  try {
    await writeFileAtomic(outPath, text);
  } catch (err) {
    return `[ERROR] Failed writing ${OPENCODE_JSONC_FILENAME}: ${formatError(err)}`;
  }

  const warnings: string[] = [
    ...overrideResolution.warnings,
    ...normalized.warnings,
    ...patch.warnings,
  ];

  return [
    'palantir-mcp tools rescan complete.',
    '',
    formatPatchSummary(patch, profileResolution, allowlist),
    formatWarnings(warnings),
  ]
    .filter((x) => x.trim().length > 0)
    .join('\n');
}
