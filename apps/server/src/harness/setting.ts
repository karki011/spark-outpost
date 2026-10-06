import { harnessSettingSchema, type HarnessSetting } from '@spark-outpost/contracts';

export const HARNESS_ENV = 'HARNESS';

export function harnessSetting(env: NodeJS.ProcessEnv = process.env): HarnessSetting {
  return harnessSettingSchema.catch('current').parse(env[HARNESS_ENV]);
}

export function harnessOf(deps: { harness?: HarnessSetting | undefined }): HarnessSetting {
  return deps.harness ?? harnessSetting();
}
