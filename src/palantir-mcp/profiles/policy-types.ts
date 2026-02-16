import type { ProfileId } from '../types.ts';

export type AgentToolPolicy = {
  defaultAllow: 'all' | 'read_only';
  allowPatterns?: readonly RegExp[];
  denyPatterns?: readonly RegExp[];
  denyTools?: readonly string[];
};

export type ProfilePolicy = {
  id: ProfileId;
  title: string;
  description: string;
  librarian: AgentToolPolicy;
  foundry: AgentToolPolicy;
};
