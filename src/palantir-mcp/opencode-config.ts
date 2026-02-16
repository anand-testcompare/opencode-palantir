import fs from 'node:fs/promises';
import path from 'node:path';

import { parse, type ParseError } from 'jsonc-parser';

import type { ComputedAllowlist } from './allowlist.ts';
import type { ProfileId } from './types.ts';

export type ReadConfigResult =
  | { ok: true; path: string; text: string; data: unknown }
  | { ok: false; missing: true }
  | { ok: false; error: string };

export type ReadLegacyResult =
  | { ok: true; path: string; text: string; data: unknown }
  | { ok: false; missing: true }
  | { ok: false; error: string };

export type PatchResult = {
  data: Record<string, unknown>;
  warnings: string[];
  summary: {
    profile: ProfileId;
    toolCount: number;
    librarianEnabled: number;
    foundryEnabled: number;
    preservedExistingToggles: boolean;
  };
};

export const OPENCODE_JSONC_FILENAME = 'opencode.jsonc';
export const OPENCODE_JSON_FILENAME = 'opencode.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.toString() : String(err);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readOpencodeJsonc(worktree: string): Promise<ReadConfigResult> {
  const configPath: string = path.join(worktree, OPENCODE_JSONC_FILENAME);
  if (!(await pathExists(configPath))) return { ok: false, missing: true };

  let text: string;
  try {
    text = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: `[ERROR] Failed reading ${OPENCODE_JSONC_FILENAME}: ${formatError(err)}`,
    };
  }

  const errors: ParseError[] = [];
  const data: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first: ParseError = errors[0];
    return {
      ok: false,
      error: `[ERROR] Failed parsing ${OPENCODE_JSONC_FILENAME}: parse error at offset ${first.offset}`,
    };
  }

  return { ok: true, path: configPath, text, data };
}

export async function readLegacyOpencodeJson(worktree: string): Promise<ReadLegacyResult> {
  const legacyPath: string = path.join(worktree, OPENCODE_JSON_FILENAME);
  if (!(await pathExists(legacyPath))) return { ok: false, missing: true };

  let text: string;
  try {
    text = await fs.readFile(legacyPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: `[ERROR] Failed reading ${OPENCODE_JSON_FILENAME}: ${formatError(err)}`,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (err) {
    return {
      ok: false,
      error: `[ERROR] Failed parsing ${OPENCODE_JSON_FILENAME}: ${formatError(err)}`,
    };
  }

  return { ok: true, path: legacyPath, text, data };
}

function deepMergePreferTarget(target: unknown, source: unknown): unknown {
  if (!isRecord(target) || !isRecord(source)) return target ?? source;

  const out: Record<string, unknown> = { ...source, ...target };
  for (const [k, sourceVal] of Object.entries(source)) {
    const targetVal: unknown = target[k];
    if (targetVal === undefined) {
      out[k] = sourceVal;
      continue;
    }
    if (isRecord(targetVal) && isRecord(sourceVal)) {
      out[k] = deepMergePreferTarget(targetVal, sourceVal);
    } else {
      out[k] = targetVal;
    }
  }
  return out;
}

export function mergeLegacyIntoJsonc(
  legacyData: unknown,
  jsoncData: unknown | null
): Record<string, unknown> {
  const base: Record<string, unknown> = isRecord(jsoncData) ? jsoncData : {};
  const legacy: Record<string, unknown> = isRecord(legacyData) ? legacyData : {};
  return deepMergePreferTarget(base, legacy) as Record<string, unknown>;
}

export async function writeFileAtomic(filePath: string, text: string): Promise<void> {
  const dir: string = path.dirname(filePath);
  const base: string = path.basename(filePath);
  const tmp: string = path.join(dir, `.${base}.tmp.${process.pid}.${Date.now()}`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, filePath);
}

export async function renameLegacyToBak(worktree: string): Promise<string | null> {
  const legacyPath: string = path.join(worktree, OPENCODE_JSON_FILENAME);
  if (!(await pathExists(legacyPath))) return null;

  const baseBak: string = path.join(worktree, `${OPENCODE_JSON_FILENAME}.bak`);
  let bakPath: string = baseBak;
  let i: number = 1;
  while (await pathExists(bakPath)) {
    bakPath = `${baseBak}.${i}`;
    i += 1;
  }

  await fs.rename(legacyPath, bakPath);
  return bakPath;
}

function toolKey(toolName: string): string {
  return `palantir-mcp_${toolName}`;
}

function ensureObject(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing: unknown = parent[key];
  if (isRecord(existing)) return existing;
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

function getString(obj: Record<string, unknown>, key: string): string | null {
  const v: unknown = obj[key];
  return typeof v === 'string' ? v : null;
}

function removeUnsupportedPalantirMeta(data: Record<string, unknown>): void {
  // OpenCode config is schema-validated and rejects unknown top-level keys.
  // Never persist plugin-specific metadata in opencode.jsonc.
  if (data['palantir_mcp'] !== undefined) delete data['palantir_mcp'];
}

function ensureMcpServer(
  data: Record<string, unknown>,
  foundryApiUrl: string
): { created: boolean } {
  const mcp: Record<string, unknown> = ensureObject(data, 'mcp');
  const existing: unknown = mcp['palantir-mcp'];
  if (existing !== undefined) return { created: false };

  mcp['palantir-mcp'] = {
    type: 'local',
    command: ['npx', '-y', 'palantir-mcp', '--foundry-api-url', foundryApiUrl],
    environment: {
      FOUNDRY_TOKEN: '{env:FOUNDRY_TOKEN}',
    },
  };
  return { created: true };
}

export function extractFoundryApiUrlFromMcpConfig(data: Record<string, unknown>): string | null {
  const mcp: unknown = data['mcp'];
  if (!isRecord(mcp)) return null;
  const server: unknown = mcp['palantir-mcp'];
  if (!isRecord(server)) return null;

  const type: string | null = getString(server, 'type');
  if (type !== 'local') return null;

  const command: unknown = server['command'];
  if (!Array.isArray(command)) return null;
  const args: string[] = command.filter((x) => typeof x === 'string') as string[];

  const idx: number = args.indexOf('--foundry-api-url');
  if (idx === -1) return null;
  const next: string | undefined = args[idx + 1];
  if (!next) return null;
  return next;
}

function ensureGlobalDeny(data: Record<string, unknown>): void {
  const tools: Record<string, unknown> = ensureObject(data, 'tools');
  tools['palantir-mcp_*'] = false;
}

function ensureAgentBase(
  data: Record<string, unknown>,
  agentName: 'foundry-librarian' | 'foundry'
): Record<string, unknown> {
  const agents: Record<string, unknown> = ensureObject(data, 'agent');
  const existing: unknown = agents[agentName];
  if (isRecord(existing)) return existing;
  const created: Record<string, unknown> = {};
  agents[agentName] = created;
  return created;
}

function ensureAgentDefaults(
  agent: Record<string, unknown>,
  agentName: 'foundry-librarian' | 'foundry'
): void {
  const defaultDescription: string =
    agentName === 'foundry-librarian'
      ? 'Foundry exploration and context gathering (parallel-friendly)'
      : 'Foundry execution agent (uses only enabled palantir-mcp tools)';

  const mode: unknown = agent['mode'];
  if (typeof mode !== 'string') {
    agent['mode'] = agentName === 'foundry' ? 'all' : 'subagent';
  }

  if (typeof agent['hidden'] !== 'boolean') agent['hidden'] = false;

  if (typeof agent['description'] !== 'string') {
    agent['description'] = defaultDescription;
  }

  if (typeof agent['prompt'] !== 'string') {
    agent['prompt'] =
      agentName === 'foundry-librarian'
        ? [
            'You are the Foundry librarian.',
            '',
            '- Focus on exploration and context gathering.',
            '- Split independent exploration tasks and run them in parallel when possible.',
            '- Return compact summaries and cite the tool calls you ran.',
            '- Avoid dumping massive schemas unless explicitly asked.',
          ].join('\n')
        : [
            'You are the Foundry execution agent.',
            '',
            '- Use only enabled palantir-mcp tools.',
            '- Prefer working from summaries produced by @foundry-librarian.',
            '- Keep operations focused and deterministic.',
          ].join('\n');
  }
}

const GENERATED_NOTE_PREFIX: string = 'Generated by opencode-palantir /setup-palantir-mcp.';

function buildGeneratedNote(profile: ProfileId): string {
  return `${GENERATED_NOTE_PREFIX} Profile: ${profile}. Edit palantir-mcp_* tool flags below to reject tools.`;
}

function stripGeneratedNote(description: string): string {
  const idx: number = description.indexOf(GENERATED_NOTE_PREFIX);
  if (idx === -1) return description.trim();

  const before: string = description.slice(0, idx).trimEnd();
  // Remove common separators we add when appending notes.
  return before.replace(/(?:\s*(?:\||-)\s*)$/, '').trimEnd();
}

function annotateAgentDescription(
  agent: Record<string, unknown>,
  agentName: 'foundry-librarian' | 'foundry',
  profile: ProfileId,
  mode: 'setup' | 'rescan'
): void {
  const defaultDescription: string =
    agentName === 'foundry-librarian'
      ? 'Foundry exploration and context gathering (parallel-friendly)'
      : 'Foundry execution agent (uses only enabled palantir-mcp tools)';

  const raw: unknown = agent['description'];
  const description: string = typeof raw === 'string' ? raw : defaultDescription;

  const shouldAnnotate: boolean =
    mode === 'setup' ||
    description.includes(GENERATED_NOTE_PREFIX) ||
    description.trim() === defaultDescription;

  if (!shouldAnnotate) return;

  const base: string = stripGeneratedNote(description);
  agent['description'] = base
    ? `${base} | ${buildGeneratedNote(profile)}`
    : buildGeneratedNote(profile);
}

function ensureDocsToolDefaults(
  tools: Record<string, unknown>,
  agentName: 'foundry-librarian' | 'foundry'
): void {
  if (agentName === 'foundry-librarian') {
    if (tools['get_doc_page'] === undefined) tools['get_doc_page'] = true;
    if (tools['list_all_docs'] === undefined) tools['list_all_docs'] = true;
    return;
  }

  // Default to disabled for the execution agent, but do not overwrite user choices.
  if (tools['get_doc_page'] === undefined) tools['get_doc_page'] = false;
  if (tools['list_all_docs'] === undefined) tools['list_all_docs'] = false;
}

function hasPalantirToggles(tools: Record<string, unknown>): boolean {
  return Object.keys(tools).some((k) => k.startsWith('palantir-mcp_'));
}

function countEnabledPalantirToggles(tools: Record<string, unknown>, toolKeys: string[]): number {
  let count: number = 0;
  for (const k of toolKeys) {
    if (tools[k] === true) count += 1;
  }
  return count;
}

function applyToolToggles(
  tools: Record<string, unknown>,
  toolNames: string[],
  allow: ReadonlySet<string>,
  mode: 'setup' | 'rescan'
): { preservedExisting: boolean } {
  const toolNamesSorted: string[] = Array.from(new Set(toolNames)).sort((a, b) =>
    a.localeCompare(b)
  );
  const toolKeys: string[] = toolNamesSorted.map(toolKey);

  const preserveExisting: boolean = hasPalantirToggles(tools);
  const preservedExisting: boolean = preserveExisting;

  for (let i = 0; i < toolNamesSorted.length; i += 1) {
    const name: string = toolNamesSorted[i];
    const k: string = toolKeys[i];

    if (mode === 'rescan') {
      if (tools[k] !== undefined) continue;
      tools[k] = allow.has(name);
      continue;
    }

    // setup
    if (preserveExisting && tools[k] !== undefined) continue;
    tools[k] = allow.has(name);
  }

  return { preservedExisting };
}

export function patchConfigForSetup(
  input: Record<string, unknown>,
  opts: {
    foundryApiUrl: string;
    toolNames: string[];
    profile: ProfileId;
    allowlist: ComputedAllowlist;
  }
): PatchResult {
  const warnings: string[] = [];
  const data: Record<string, unknown> = { ...input };

  if (data['$schema'] === undefined) data['$schema'] = 'https://opencode.ai/config.json';

  removeUnsupportedPalantirMeta(data);
  ensureGlobalDeny(data);
  ensureMcpServer(data, opts.foundryApiUrl);

  const librarianAgent: Record<string, unknown> = ensureAgentBase(data, 'foundry-librarian');
  ensureAgentDefaults(librarianAgent, 'foundry-librarian');
  annotateAgentDescription(librarianAgent, 'foundry-librarian', opts.profile, 'setup');
  const librarianTools: Record<string, unknown> = ensureObject(librarianAgent, 'tools');
  ensureDocsToolDefaults(librarianTools, 'foundry-librarian');

  const foundryAgent: Record<string, unknown> = ensureAgentBase(data, 'foundry');
  ensureAgentDefaults(foundryAgent, 'foundry');
  annotateAgentDescription(foundryAgent, 'foundry', opts.profile, 'setup');
  const foundryTools: Record<string, unknown> = ensureObject(foundryAgent, 'tools');
  ensureDocsToolDefaults(foundryTools, 'foundry');

  const libApply = applyToolToggles(
    librarianTools,
    opts.toolNames,
    opts.allowlist.librarianAllow,
    'setup'
  );
  const foundryApply = applyToolToggles(
    foundryTools,
    opts.toolNames,
    opts.allowlist.foundryAllow,
    'setup'
  );
  const preservedExistingToggles: boolean =
    libApply.preservedExisting || foundryApply.preservedExisting;
  if (preservedExistingToggles) {
    warnings.push(
      'Existing palantir-mcp_* tool toggles were preserved; delete them under the Foundry agents to fully regenerate.'
    );
  }

  const toolNamesSorted: string[] = Array.from(new Set(opts.toolNames)).sort((a, b) =>
    a.localeCompare(b)
  );
  const toolKeys: string[] = toolNamesSorted.map(toolKey);

  const summary = {
    profile: opts.profile,
    toolCount: toolNamesSorted.length,
    librarianEnabled: countEnabledPalantirToggles(librarianTools, toolKeys),
    foundryEnabled: countEnabledPalantirToggles(foundryTools, toolKeys),
    preservedExistingToggles,
  };

  return { data, warnings, summary };
}

export function patchConfigForRescan(
  input: Record<string, unknown>,
  opts: {
    toolNames: string[];
    profile: ProfileId;
    allowlist: ComputedAllowlist;
  }
): PatchResult {
  const warnings: string[] = [];
  const data: Record<string, unknown> = { ...input };

  if (data['$schema'] === undefined) data['$schema'] = 'https://opencode.ai/config.json';

  removeUnsupportedPalantirMeta(data);
  ensureGlobalDeny(data);

  const librarianAgent: Record<string, unknown> = ensureAgentBase(data, 'foundry-librarian');
  ensureAgentDefaults(librarianAgent, 'foundry-librarian');
  annotateAgentDescription(librarianAgent, 'foundry-librarian', opts.profile, 'rescan');
  const librarianTools: Record<string, unknown> = ensureObject(librarianAgent, 'tools');
  ensureDocsToolDefaults(librarianTools, 'foundry-librarian');

  const foundryAgent: Record<string, unknown> = ensureAgentBase(data, 'foundry');
  ensureAgentDefaults(foundryAgent, 'foundry');
  annotateAgentDescription(foundryAgent, 'foundry', opts.profile, 'rescan');
  const foundryTools: Record<string, unknown> = ensureObject(foundryAgent, 'tools');
  ensureDocsToolDefaults(foundryTools, 'foundry');

  const libApply = applyToolToggles(
    librarianTools,
    opts.toolNames,
    opts.allowlist.librarianAllow,
    'rescan'
  );
  const foundryApply = applyToolToggles(
    foundryTools,
    opts.toolNames,
    opts.allowlist.foundryAllow,
    'rescan'
  );
  const preservedExistingToggles: boolean =
    libApply.preservedExisting || foundryApply.preservedExisting;
  if (preservedExistingToggles) {
    warnings.push(
      'Existing palantir-mcp_* tool toggles were preserved (not overwritten). Delete them under the Foundry agents to fully regenerate.'
    );
  }

  const toolNamesSorted: string[] = Array.from(new Set(opts.toolNames)).sort((a, b) =>
    a.localeCompare(b)
  );
  const toolKeys: string[] = toolNamesSorted.map(toolKey);

  const summary = {
    profile: opts.profile,
    toolCount: toolNamesSorted.length,
    librarianEnabled: countEnabledPalantirToggles(librarianTools, toolKeys),
    foundryEnabled: countEnabledPalantirToggles(foundryTools, toolKeys),
    preservedExistingToggles,
  };

  return { data, warnings, summary };
}

export function stringifyJsonc(data: Record<string, unknown>): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
