import {
  SPARK_ADDRESS_PROBLEMS,
  parseSparkAddress,
  type RemoteSpark,
} from '@spark-outpost/contracts';
import type { DisconnectCopy } from '../connectors/DisconnectDialog.tsx';
import { relativeTime } from '../ui/relative-time.ts';

export const OTHER_SPARKS_TITLE = 'Other Sparks';
export const ADD_SPARK = 'Add a Spark';
export const OTHER_SPARKS_INTRO =
  'This Mac controls another Mac’s Spark as a paired device. What you do there runs on that Mac.';
export const OTHER_SPARKS_UNAVAILABLE = 'Other Sparks open from the Mac app.';
export const OTHER_SPARKS_EMPTY = 'No other Spark is saved yet.';
export const NAME_PROBLEM = 'Give this Spark a name.';

export const SWITCHER_MENU = 'Sparks';
export const ADD_SPARK_ITEM = 'Add a Spark…';
export const MANAGE_SPARKS_ITEM = 'Manage Sparks…';

export function thisComputer(computer: string): string {
  return `This ${computer}`;
}

export function waitingWord(count: number): string {
  return `${count} waiting`;
}

export function waitingTotal(sparks: readonly Pick<RemoteSpark, 'needsYou'>[]): number {
  return sparks.reduce((total, spark) => total + spark.needsYou, 0);
}

export function switcherName(computer: string, total: number): string {
  if (total === 0) return thisComputer(computer);
  const requests = total === 1 ? '1 request' : `${total} requests`;
  return `${thisComputer(computer)}. ${requests} waiting on other Sparks`;
}

export function lastOpenedLine(spark: Pick<RemoteSpark, 'lastOpenedAt'>, now: number): string {
  return spark.lastOpenedAt === null
    ? 'Last opened: Never'
    : `Last opened ${relativeTime(spark.lastOpenedAt, now)}`;
}

export function removeCopy(name: string): DisconnectCopy {
  return {
    title: `Remove ${name}?`,
    text: `This deletes this Mac’s saved sign-in for ${name}. Also revoke this Mac on ${name}: removing it here does not end its access there.`,
  };
}

export function addressProblem(address: string, ownHostname: string | null): string | null {
  const parsed = parseSparkAddress(address, ownHostname);
  return parsed.ok ? null : SPARK_ADDRESS_PROBLEMS[parsed.problem];
}

export function addressHint(address: string, ownHostname: string | null): string | null {
  const parsed = parseSparkAddress(address, ownHostname);
  if (!parsed.ok) return null;
  return parsed.code
    ? `Opens ${parsed.hostname} with its pairing code filled in.`
    : `Opens ${parsed.hostname}. You type the pairing code there.`;
}
