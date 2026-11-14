import { isAbsolute, join, resolve } from 'node:path';
import { sparkDataDir } from '../config.ts';
import { sparkChannel } from '../spark-rules/rules-store.ts';

export const SPARKS_FOLDER = 'sparks';
export const WORKFLOWS_FOLDER = 'workflows';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function override(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function channelFolder(env: NodeJS.ProcessEnv, name: string): string {
  return join(sparkDataDir({ SPARK_DATA_DIR: env.SPARK_DATA_DIR }), sparkChannel(env), name);
}

export function crewSparksDir(env: NodeJS.ProcessEnv = process.env): string {
  return override(env.SPARK_CREW_DIR) ?? channelFolder(env, SPARKS_FOLDER);
}

export function crewWorkflowsDir(env: NodeJS.ProcessEnv = process.env): string {
  return override(env.SPARK_WORKFLOWS_DIR) ?? channelFolder(env, WORKFLOWS_FOLDER);
}

export function crewFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  return [crewSparksDir(env), crewWorkflowsDir(env)];
}

export function sparkFolderPath(sparksDir: string, sparkId: string): string {
  if (!UUID.test(sparkId)) throw new Error('A Spark folder needs a Spark id.');
  return join(sparksDir, sparkId.toLowerCase());
}
