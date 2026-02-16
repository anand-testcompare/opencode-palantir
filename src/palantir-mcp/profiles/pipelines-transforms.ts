import { createBroadProfile } from './shared.ts';

export const pipelinesTransformsPolicy = createBroadProfile(
  'pipelines_transforms',
  'Pipelines & Transforms',
  'Broad defaults for pipeline/transform repos with dataset and ontology workflows.',
  [/pipeline/i, /transform/i, /dataset/i, /ontology/i, /lineage/i]
);
