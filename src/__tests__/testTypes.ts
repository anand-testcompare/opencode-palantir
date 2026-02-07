export type MinimalHooks = Record<string, unknown>;
export type MinimalPlugin = (input: { worktree: string }) => Promise<MinimalHooks>;

export type CommandHookInput = { command: string; sessionID: string; arguments: string };
export type CommandHookOutput = { parts: unknown[] };
export type CommandHook = (input: CommandHookInput, output: CommandHookOutput) => Promise<void>;
