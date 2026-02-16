import type { ProfileId } from '../types.ts';
import { allProfilePolicy } from './all.ts';
import { computeModulesPolicy } from './compute-modules.ts';
import { computeModulesPyPolicy } from './compute-modules-py.ts';
import { computeModulesTsPolicy } from './compute-modules-ts.ts';
import { osdkFunctionsTsPolicy } from './osdk-functions-ts.ts';
import type { ProfilePolicy } from './policy-types.ts';
import { pipelinesTransformsPolicy } from './pipelines-transforms.ts';
import { unknownProfilePolicy } from './unknown.ts';

const POLICIES: Record<ProfileId, ProfilePolicy> = {
  compute_modules: computeModulesPolicy,
  compute_modules_ts: computeModulesTsPolicy,
  compute_modules_py: computeModulesPyPolicy,
  pipelines_transforms: pipelinesTransformsPolicy,
  osdk_functions_ts: osdkFunctionsTsPolicy,
  all: allProfilePolicy,
  unknown: unknownProfilePolicy,
};

export function getProfilePolicy(profile: ProfileId): ProfilePolicy {
  return POLICIES[profile] ?? unknownProfilePolicy;
}

export type { AgentToolPolicy, ProfilePolicy } from './policy-types.ts';
