import { z } from 'zod';
import { browserActKeySchema, browserActKindSchema } from './browser-act.ts';
import { parseBrowserUrl } from './browser.ts';
import { macHelperKeySchema } from './mac-control-helper.ts';
import { isSparkServer, parseMcpTool } from './tool-steps.ts';

export type CalloutKind = 'browser' | 'web' | 'page' | 'mac';

const CALLOUT_TOOLS = {
  spark_browser_open: 'browser',
  spark_browser_read: 'browser',
  spark_browser_act: 'browser',
  spark_browser_screenshot: 'browser',
  spark_browser_logs: 'browser',
  spark_browser_devtools: 'browser',
  spark_browser_sign_in: 'browser',
  spark_artifact: 'page',
  spark_mac_act: 'mac',
  WebFetch: 'web',
  WebSearch: 'web',
} as const satisfies Record<string, CalloutKind>;

export type CalloutTool = keyof typeof CALLOUT_TOOLS;

const SEARCH_TEXT = /^(?:Search ".*"|Web search(?:: .*)?|Searched the web)$/s;
const FETCH_TEXT = /^(?:(?:Fetch|Open page:) https?:\/\/\S+|Fetched \S+)$/;
const TARGET_CHARS = 200;
const MENU_JOIN = ' › ';

function isCalloutTool(name: string): name is CalloutTool {
  return Object.hasOwn(CALLOUT_TOOLS, name);
}

function namedTool(toolName: string): string {
  const mcp = parseMcpTool(toolName);
  if (!mcp) return toolName;
  return isSparkServer(mcp.server) ? mcp.tool : '';
}

function webTool(text: string): CalloutTool | null {
  if (SEARCH_TEXT.test(text)) return 'WebSearch';
  return FETCH_TEXT.test(text) ? 'WebFetch' : null;
}

const INPUT_CALLOUTS: ReadonlySet<CalloutTool> = new Set([
  'spark_browser_open',
  'spark_browser_act',
  'spark_mac_act',
  'spark_artifact',
]);

export function awaitsCalloutInput(toolName: string | null | undefined, input: unknown): boolean {
  const tool = calloutTool(toolName, null);
  return tool !== null && INPUT_CALLOUTS.has(tool) && Object.keys(argsOf(input)).length === 0;
}

export function calloutTool(
  toolName: string | null | undefined,
  text: string | null | undefined,
): CalloutTool | null {
  if (!toolName?.trim()) return webTool(text?.trim() ?? '');
  const name = namedTool(toolName.trim());
  return isCalloutTool(name) ? name : null;
}

export function calloutKind(tool: CalloutTool): CalloutKind {
  return CALLOUT_TOOLS[tool];
}

const shortText = z.string().trim().min(1);

function field(args: Record<string, unknown>, key: string): string | null {
  const parsed = shortText.safeParse(args[key]);
  return parsed.success ? parsed.data : null;
}

function argsOf(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) return {};
  const wrapped = (input as Record<string, unknown>).arguments;
  if (typeof wrapped === 'object' && wrapped !== null) return wrapped as Record<string, unknown>;
  return input as Record<string, unknown>;
}

function hostOf(address: string | null): string | null {
  const url = address ? parseBrowserUrl(address) : null;
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
  return url.hostname || null;
}

function hostInTitle(title: string): string | null {
  return hostOf(/https?:\/\/\S+/.exec(title)?.[0] ?? null);
}

function queryInTitle(title: string): string | null {
  const quoted = /^Search "(.+)"$/s.exec(title)?.[1];
  return quoted ?? /^Web search: (.+)$/s.exec(title)?.[1] ?? null;
}

function words(...parts: (string | null)[]): string | null {
  const shown = parts.filter((part): part is string => Boolean(part));
  return shown.length > 0 ? shown.join(' ') : null;
}

function browserActTarget(args: Record<string, unknown>): string | null {
  const action = browserActKindSchema.safeParse(args.action);
  if (!action.success) return null;
  const key = browserActKeySchema.safeParse(args.key);
  return words(action.data, action.data === 'key' && key.success ? key.data : null);
}

function macActTarget(args: Record<string, unknown>): string | null {
  const action = field(args, 'action');
  const app = field(args, 'app');
  if (!action || !app) return null;
  if (action === 'key') {
    const key = macHelperKeySchema.safeParse(args.key);
    return key.success ? words(action, key.data, app) : words(action, app);
  }
  const menu = z.array(shortText).safeParse(args.menu);
  const path = action === 'menu' && menu.success ? menu.data : [];
  return words(action, [app, ...path].join(MENU_JOIN));
}

function artifactTarget(args: Record<string, unknown>): string | null {
  const action = field(args, 'action');
  if (action === 'read') return action;
  return action ? words(action, field(args, 'title')) : null;
}

function rawTarget(tool: CalloutTool, title: string, args: Record<string, unknown>) {
  if (tool === 'WebFetch') return hostOf(field(args, 'url')) ?? hostInTitle(title);
  if (tool === 'WebSearch') return field(args, 'query') ?? queryInTitle(title);
  if (tool === 'spark_browser_open') return hostOf(field(args, 'url'));
  if (tool === 'spark_browser_act') return browserActTarget(args);
  if (tool === 'spark_mac_act') return macActTarget(args);
  if (tool === 'spark_artifact') return artifactTarget(args);
  return null;
}

export function calloutTarget(
  toolName: string | null | undefined,
  title: string | null | undefined,
  input: unknown,
): string | null {
  const tool = calloutTool(toolName, title);
  if (!tool) return null;
  const target = rawTarget(tool, title?.trim() ?? '', argsOf(input));
  return target ? target.replace(/\s+/g, ' ').slice(0, TARGET_CHARS) : null;
}

export interface CalloutWords {
  verb: string;
  target: string | null;
}

type Tense = [done: string, open: string];

const PLAIN: Partial<Record<CalloutTool, Tense>> = {
  spark_browser_read: ['Read the page', 'Reading the page'],
  spark_browser_screenshot: ['Took a screenshot of the page', 'Taking a screenshot of the page'],
  spark_browser_logs: ['Read the page logs', 'Reading the page logs'],
  spark_browser_devtools: ['Used developer tools on the page', 'Using developer tools on the page'],
  spark_browser_sign_in: ['Signed in on the page', 'Signing in on the page'],
};

const BROWSER_ACTS: Record<string, Tense> = {
  click: ['Clicked on the page', 'Clicking on the page'],
  type: ['Typed into a field', 'Typing into a field'],
  key: ['Pressed', 'Pressing'],
  scroll: ['Scrolled the page', 'Scrolling the page'],
  back: ['Went back', 'Going back'],
  forward: ['Went forward', 'Going forward'],
  reload: ['Reloaded the page', 'Reloading the page'],
};

const MAC_ACTS: Record<string, Tense> = {
  press: ['Pressed a button in', 'Pressing a button in'],
  menu: ['Chose', 'Choosing'],
  key: ['Pressed', 'Pressing'],
  scroll: ['Scrolled in', 'Scrolling in'],
  open: ['Opened', 'Opening'],
};

const ARTIFACT_ACTS: Record<string, Tense> = {
  publish: ['Made a page:', 'Making a page:'],
  update: ['Updated a page:', 'Updating a page:'],
  read: ['Read a page', 'Reading a page'],
};

function tensed([done, open]: Tense, live: boolean): string {
  return live ? open : done;
}

function split(target: string): [action: string, rest: string | null] {
  const space = target.indexOf(' ');
  return space === -1 ? [target, null] : [target.slice(0, space), target.slice(space + 1)];
}

function browserActWords(target: string | null, live: boolean): CalloutWords {
  const [action, key] = target ? split(target) : ['', null];
  const tense = BROWSER_ACTS[action];
  if (!tense) return { verb: live ? 'Acting on the page' : 'Acted on the page', target: null };
  if (action !== 'key') return { verb: tensed(tense, live), target: null };
  return { verb: tensed(tense, live), target: key ?? 'a key' };
}

function macActWords(target: string | null, live: boolean): CalloutWords {
  const [action, rest] = target ? split(target) : ['', null];
  const tense = MAC_ACTS[action];
  if (!tense || !rest) {
    return { verb: live ? 'Acting in a Mac app' : 'Acted in a Mac app', target: null };
  }
  const verb = tensed(tense, live);
  if (action === 'key') {
    const [key, app] = split(rest);
    return app ? { verb: `${verb} ${key} in`, target: app } : { verb, target: key };
  }
  if (action === 'menu') {
    const [app, ...menu] = rest.split(MENU_JOIN);
    if (menu.length === 0) return { verb: `${verb} a menu item in`, target: rest };
    return { verb: `${verb} ${menu.join(MENU_JOIN)} in`, target: app ?? null };
  }
  return { verb, target: rest };
}

function artifactWords(target: string | null, live: boolean): CalloutWords {
  const [action, title] = target ? split(target) : ['', null];
  const tense = ARTIFACT_ACTS[action] ?? ARTIFACT_ACTS.publish!;
  const verb = tensed(tense, live);
  if (action === 'read' || !title) return { verb: verb.replace(/:$/, ''), target: null };
  return { verb, target: title };
}

function addressed(tense: Tense, fallback: Tense, target: string | null, live: boolean) {
  return target
    ? { verb: tensed(tense, live), target }
    : { verb: tensed(fallback, live), target: null };
}

export function calloutWords(
  tool: CalloutTool,
  target: string | null,
  live: boolean,
): CalloutWords {
  const plain = PLAIN[tool];
  if (plain) return { verb: tensed(plain, live), target: null };
  if (tool === 'spark_browser_act') return browserActWords(target, live);
  if (tool === 'spark_mac_act') return macActWords(target, live);
  if (tool === 'spark_artifact') return artifactWords(target, live);
  if (tool === 'WebSearch') {
    const fallback: Tense = ['Searched the web', 'Searching the web'];
    return addressed(['Searched the web for', 'Searching the web for'], fallback, target, live);
  }
  if (tool === 'WebFetch') {
    return addressed(['Fetched', 'Fetching'], ['Fetched a page', 'Fetching a page'], target, live);
  }
  return addressed(['Opened', 'Opening'], ['Opened a page', 'Opening a page'], target, live);
}
