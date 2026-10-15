import { BROWSER_READ_MAX_CHARS } from '@spark-outpost/contracts';
import { refContextOf } from './ref-context.ts';
import type { RefMap } from './ref-map.ts';

export interface AxValue {
  value?: unknown;
}

export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: { name: string; value: AxValue }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

export const MASKED_VALUE = '[masked]';
const NAME_MAX = 160;
const VALUE_MAX = 160;
const DEPTH_MAX = 30;
const TEXT_ROLES = new Set(['StaticText', 'ListMarker']);
const SKIPPED_ROLES = new Set(['InlineTextBox', 'LineBreak']);
const WRAPPER_ROLES = new Set(['generic', 'none', 'presentation', 'GenericContainer', 'group']);
const VALUE_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'slider',
  'TextField',
]);
const TEXT_FIELD_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'TextField']);
const SHOWN_PROPERTIES = new Set([
  'level',
  'checked',
  'selected',
  'expanded',
  'disabled',
  'required',
  'invalid',
  'pressed',
]);
const ACTING_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'listbox',
  'treeitem',
  'TextField',
  'PopUpButton',
  'ToggleButton',
]);
const LANDMARK_ROLES = new Set([
  'RootWebArea',
  'heading',
  'banner',
  'navigation',
  'main',
  'contentinfo',
  'complementary',
  'region',
  'form',
  'search',
  'dialog',
  'alertdialog',
  'alert',
]);
const SENSITIVE_NAME =
  /pass(word|code|phrase)|card.?(number|no)|cc.?(num|number)|cvv|cvc|security code|secret|one.?time code|otp/i;

function text(value: AxValue | undefined): string {
  return typeof value?.value === 'string' || typeof value?.value === 'number'
    ? String(value.value).replace(/\s+/g, ' ').trim()
    : '';
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function quoted(value: string, max: number): string {
  return JSON.stringify(clip(value, max));
}

function roleOf(node: AxNode): string {
  return text(node.role) || 'generic';
}

export interface OutlineOptions {
  refs: RefMap;
  sensitive: ReadonlySet<number>;
  rootBackendId?: number | null;
}

export type RowTier = 'act' | 'mark' | 'prose';

export interface OutlineRow {
  text: string;
  depth: number;
  tier: RowTier;
  ref: string | null;
}

export interface Outline {
  lines: string[];
  rows: OutlineRow[];
  masked: number;
}

interface Walk {
  byId: Map<string, AxNode>;
  options: OutlineOptions;
  rows: OutlineRow[];
  masked: number;
}

function tierOf(role: string): RowTier {
  if (ACTING_ROLES.has(role)) return 'act';
  return LANDMARK_ROLES.has(role) ? 'mark' : 'prose';
}

export function sensitiveByName(role: string, name: string): boolean {
  return VALUE_ROLES.has(role) && SENSITIVE_NAME.test(name);
}

function isSensitive(node: AxNode, name: string, sensitive: ReadonlySet<number>): boolean {
  if (node.backendDOMNodeId !== undefined && sensitive.has(node.backendDOMNodeId)) return true;
  return sensitiveByName(roleOf(node), name);
}

function propertyNotes(node: AxNode): string[] {
  return (node.properties ?? []).flatMap((property) => {
    if (!SHOWN_PROPERTIES.has(property.name)) return [];
    const value = property.value.value;
    if (value === false || value === 'false' || value === undefined) return [];
    return [
      value === true || value === 'true' ? property.name : `${property.name}=${String(value)}`,
    ];
  });
}

function refOf(walk: Walk, node: AxNode, role: string, name: string): string | null {
  if (node.backendDOMNodeId === undefined || TEXT_ROLES.has(role)) return null;
  const context = refContextOf(walk.byId, node);
  return walk.options.refs.refFor(node.backendDOMNodeId, { role, name, context });
}

function describe(walk: Walk, node: AxNode, ref: string | null): string {
  const role = roleOf(node);
  const name = text(node.name);
  const parts = [role];
  if (name) parts.push(quoted(name, NAME_MAX));
  if (ref) parts.push(`[${ref}]`);
  const value = text(node.value);
  if (isSensitive(node, name, walk.options.sensitive)) {
    parts.push(`value=${MASKED_VALUE}`);
    walk.masked += 1;
  } else if (value && value !== name) {
    parts.push(`value=${quoted(value, VALUE_MAX)}`);
  }
  parts.push(...propertyNotes(node));
  return parts.join(' ');
}

function holdsFieldValue(node: AxNode, sensitive: ReadonlySet<number>): boolean {
  if (node.ignored) return false;
  return TEXT_FIELD_ROLES.has(roleOf(node)) || isSensitive(node, text(node.name), sensitive);
}

function isWrapper(node: AxNode): boolean {
  return node.ignored === true || (WRAPPER_ROLES.has(roleOf(node)) && text(node.name) === '');
}

function repeatsParent(node: AxNode, parent: AxNode | null): boolean {
  return roleOf(node) === 'StaticText' && parent !== null && text(parent.name) === text(node.name);
}

function visit(walk: Walk, id: string, depth: number, parent: AxNode | null): void {
  const node = walk.byId.get(id);
  if (!node || depth > DEPTH_MAX) return;
  const role = roleOf(node);
  if (SKIPPED_ROLES.has(role) || repeatsParent(node, parent)) return;
  const shown = !isWrapper(node);
  if (shown) {
    const ref = refOf(walk, node, role, text(node.name));
    const line = `${'  '.repeat(depth)}- ${describe(walk, node, ref)}`;
    walk.rows.push({ text: line, depth, tier: tierOf(role), ref });
  }
  if (holdsFieldValue(node, walk.options.sensitive)) return;
  for (const child of node.childIds ?? []) {
    visit(walk, child, shown ? depth + 1 : depth, shown ? node : parent);
  }
}

function rootOf(nodes: readonly AxNode[], rootBackendId: number | null | undefined): AxNode | null {
  if (rootBackendId !== null && rootBackendId !== undefined) {
    return nodes.find((node) => node.backendDOMNodeId === rootBackendId) ?? null;
  }
  return nodes.find((node) => node.parentId === undefined) ?? nodes[0] ?? null;
}

export function outlineOf(nodes: readonly AxNode[], options: OutlineOptions): Outline | null {
  const root = rootOf(nodes, options.rootBackendId);
  if (!root) return null;
  const walk: Walk = {
    byId: new Map(nodes.map((node) => [node.nodeId, node])),
    options,
    rows: [],
    masked: 0,
  };
  visit(walk, root.nodeId, 0, null);
  return { lines: walk.rows.map((row) => row.text), rows: walk.rows, masked: walk.masked };
}

export function pageTextOf(
  nodes: readonly AxNode[],
  sensitive: ReadonlySet<number> = new Set(),
  rootBackendId?: number | null,
): string[] {
  const root = rootOf(nodes, rootBackendId);
  if (!root) return [];
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const lines: string[] = [];
  let current: { parent: string | undefined; words: string[] } | null = null;
  const flush = () => {
    if (current && current.words.length > 0) lines.push(current.words.join(' '));
    current = null;
  };
  const walk = (id: string, depth: number) => {
    const node = byId.get(id);
    if (!node || depth > DEPTH_MAX * 2) return;
    if (holdsFieldValue(node, sensitive)) return;
    if (!node.ignored && roleOf(node) === 'StaticText') {
      const words = text(node.name);
      if (words === '') return;
      if (current?.parent !== node.parentId) flush();
      current ??= { parent: node.parentId, words: [] };
      current.words.push(words);
      return;
    }
    for (const child of node.childIds ?? []) walk(child, depth + 1);
  };
  walk(root.nodeId, 0);
  flush();
  return lines;
}

export interface TextPage {
  text: string;
  total: number;
  offset: number;
  nextOffset: number | null;
}

export function pageOfLines(
  lines: readonly string[],
  offset: number,
  maxChars = BROWSER_READ_MAX_CHARS,
): TextPage {
  const kept: string[] = [];
  let size = 0;
  let index = Math.min(offset, lines.length);
  while (index < lines.length) {
    const line = clip(lines[index]!, maxChars - 1);
    if (kept.length > 0 && size + line.length + 1 > maxChars) break;
    kept.push(line);
    size += line.length + 1;
    index += 1;
  }
  return {
    text: kept.join('\n'),
    total: lines.length,
    offset: Math.min(offset, lines.length),
    nextOffset: index < lines.length ? index : null,
  };
}
