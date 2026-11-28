import {
  SPARK_ADDRESS_PROBLEMS,
  parseSparkAddress,
  type RemoteSpark,
} from '@spark-outpost/contracts';
import type { DisconnectCopy } from '../connectors/DisconnectDialog.tsx';
import { relativeTime } from '../ui/relative-time.ts';

export const OTHER_SPARKS_TITLE = 'Other computers';
export const ADD_SPARK = 'Add a computer';
export const OTHER_SPARKS_INTRO =
  'This computer controls another computer’s Spark as a paired device. What you do there runs on that computer.';
export const OTHER_SPARKS_UNAVAILABLE = 'Other computers open from the Spark Outpost app.';
export const OTHER_SPARKS_EMPTY = 'No other computer is saved yet.';
export const NAME_PROBLEM = 'Give this computer a name.';

export const CHANGE_ICON_ITEM = 'Change icon…';
export const REMOVE_ICON_ITEM = 'Remove icon';
export const USE_COMPUTER_NAME_ITEM = 'Use computer name';
export const ICON_PROBLEM = 'That image could not be used. Pick a PNG, JPEG, WebP or GIF.';

export const LOCAL_SPARK_NOTE =
  'The other computer sees this name when this one pairs. Icons stay on this computer.';

export const SWITCHER_MENU = 'Computers';
export const ADD_SPARK_ITEM = 'Add a computer…';
export const MANAGE_SPARKS_ITEM = 'Manage computers…';

export const THIS_COMPUTER = 'This computer';
export const SWITCHER_LABEL = 'Computers';

export function waitingWord(count: number): string {
  return `${count} waiting`;
}

export function waitingTotal(sparks: readonly Pick<RemoteSpark, 'needsYou'>[]): number {
  return sparks.reduce((total, spark) => total + spark.needsYou, 0);
}

export function switcherName(name: string, total: number): string {
  if (total === 0) return name;
  const requests = total === 1 ? '1 request' : `${total} requests`;
  return `${name}. ${requests} waiting on other computers`;
}

export function lastOpenedLine(spark: Pick<RemoteSpark, 'lastOpenedAt'>, now: number): string {
  return spark.lastOpenedAt === null
    ? 'Last opened: Never'
    : `Last opened ${relativeTime(spark.lastOpenedAt, now)}`;
}

export const UNTRUSTED_LEAD = "This isn't a Tailscale address.";
export const UNTRUSTED_TEXT =
  "Spark can't check who runs it. Its page opens in a window of its own and can't reach this computer, but only add an address you trust, and never type a password into that window.";
export const TRUST_LABEL = 'I trust this address';
export const NOT_CHECKED = 'Not checked by Spark';

export function summaryLine(
  spark: Pick<RemoteSpark, 'hostname' | 'reach' | 'lastOpenedAt'>,
  now: number,
): string {
  const detail = spark.reach === 'custom' ? NOT_CHECKED : lastOpenedLine(spark, now);
  return `${spark.hostname} · ${detail}`;
}

export function removeCopy(name: string): DisconnectCopy {
  return {
    title: `Remove ${name}?`,
    text: `Removing deletes this computer’s saved sign-in for ${name}. Spark also asks ${name} to end this computer’s access. If that computer is asleep or offline, revoke this computer there.`,
  };
}

export function addressProblem(address: string, ownHostname: string | null): string | null {
  const parsed = parseSparkAddress(address, ownHostname);
  return parsed.ok ? null : SPARK_ADDRESS_PROBLEMS[parsed.problem];
}

export function needsTrust(address: string, ownHostname: string | null): boolean {
  const parsed = parseSparkAddress(address, ownHostname);
  return parsed.ok && parsed.reach === 'custom';
}

export function addressHint(address: string, ownHostname: string | null): string | null {
  const parsed = parseSparkAddress(address, ownHostname);
  if (!parsed.ok) return null;
  return parsed.code
    ? `Opens ${parsed.hostname} with its pairing code filled in.`
    : `Opens ${parsed.hostname}. You type the pairing code there.`;
}
