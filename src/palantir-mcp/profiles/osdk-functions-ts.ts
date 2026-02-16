import { createBroadProfile } from './shared.ts';

export const osdkFunctionsTsPolicy = createBroadProfile(
  'osdk_functions_ts',
  'OSDK Functions (TypeScript)',
  'Broad defaults for OSDK and TypeScript function workflows.',
  [/osdk/i, /function/i, /sdk/i, /typescript/i, /\bts\b/i, /artifact/i]
);
