import { joinLink, type BrowserLinksIn } from '@spark-outpost/contracts';
import { targetsApi } from './api-token.ts';

export type LinkTarget = 'viewer' | 'spark' | 'browser' | 'none';

export type LinkIntent = 'follow' | 'other' | 'outside';

export interface LinkChoice {
  linksIn: BrowserLinksIn;
  intent: LinkIntent;
}

const WEB_LINK = /^https?:\/\//i;
const MAIL_LINK = /^mailto:/i;

function meetingJoin(url: string): boolean {
  return joinLink({ url, location: null, noteLinks: [] }) !== null;
}

export function alwaysDefaultBrowser(url: string, intent: LinkIntent): boolean {
  return intent === 'outside' || MAIL_LINK.test(url) || meetingJoin(url);
}

function flipped(linksIn: BrowserLinksIn): BrowserLinksIn {
  return linksIn === 'spark' ? 'browser' : 'spark';
}

export function linkTarget(url: string, origin: string, choice: LinkChoice): LinkTarget {
  if (targetsApi(url, origin)) return 'viewer';
  if (!WEB_LINK.test(url) && !MAIL_LINK.test(url)) return 'none';
  if (alwaysDefaultBrowser(url, choice.intent)) return 'browser';
  return choice.intent === 'other' ? flipped(choice.linksIn) : choice.linksIn;
}
