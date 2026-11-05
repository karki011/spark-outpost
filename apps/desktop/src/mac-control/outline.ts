import {
  MAC_VALUE_MAX,
  macRoleName,
  redactText,
  type MacNode,
  type MacReadMode,
} from '@spark-outpost/contracts';
import {
  budgetPage,
  type BudgetPage,
  type OutlineRow,
  type RowTier,
} from '../outline/read-budget.ts';

const ACTING = new Set([
  'AXButton',
  'AXCheckBox',
  'AXRadioButton',
  'AXPopUpButton',
  'AXMenuButton',
  'AXMenuBarItem',
  'AXMenuItem',
  'AXTextField',
  'AXTextArea',
  'AXSecureTextField',
  'AXComboBox',
  'AXSearchField',
  'AXSlider',
  'AXIncrementor',
  'AXDisclosureTriangle',
  'AXLink',
  'AXTab',
  'AXCell',
  'AXRow',
]);

const MARKS = new Set([
  'AXWindow',
  'AXSheet',
  'AXDialog',
  'AXToolbar',
  'AXTabGroup',
  'AXHeading',
  'AXMenuBar',
  'AXMenu',
  'AXTable',
  'AXOutline',
  'AXList',
  'AXScrollArea',
  'AXSplitGroup',
]);

const TEXT_ROLES = new Set(['AXStaticText', 'AXHeading']);
const DEPTH_INDENT_MAX = 30;

function tierOf(role: string): RowTier {
  if (ACTING.has(role)) return 'act';
  return MARKS.has(role) ? 'mark' : 'prose';
}

function quoted(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  const clipped = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return `"${clipped.replace(/"/g, '\\"')}"`;
}

function nodeName(node: MacNode): string | null {
  return node.title || node.description || null;
}

function isSecure(node: MacNode): boolean {
  return node.secure || node.subrole === 'AXSecureTextField' || node.role === 'AXSecureTextField';
}

function lineOf(node: MacNode): string {
  const parts = [`- ${macRoleName(node.role, node.subrole)}`];
  const name = nodeName(node);
  if (name) parts.push(quoted(name, 200));
  parts.push(`[${node.ref}]`);
  if (isSecure(node)) parts.push('[masked]');
  else if (node.value !== null && node.value !== '' && node.value !== name) {
    parts.push(`value=${quoted(node.value, MAC_VALUE_MAX)}`);
  }
  if (!node.enabled) parts.push('enabled=false');
  if (node.focused) parts.push('focused');
  const indent = '  '.repeat(Math.min(node.depth, DEPTH_INDENT_MAX));
  return redactText(`${indent}${parts.join(' ')}`);
}

export function macOutlineRows(nodes: readonly MacNode[]): OutlineRow[] {
  return nodes.map((node) => ({
    text: lineOf(node),
    depth: node.depth,
    tier: tierOf(node.role),
    ref: node.ref,
  }));
}

function textLines(nodes: readonly MacNode[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  for (const node of nodes) {
    if (isSecure(node)) continue;
    const text = TEXT_ROLES.has(node.role) ? (node.value ?? node.title) : null;
    if (!text || text.trim() === '') continue;
    rows.push({
      text: redactText(text.replace(/\s+/g, ' ').trim()),
      depth: 0,
      tier: 'act',
      ref: null,
    });
  }
  return rows;
}

export interface MacOutlinePage extends BudgetPage {
  masked: number;
}

export function macOutlinePage(
  nodes: readonly MacNode[],
  mode: MacReadMode,
  offset: number,
  maxChars: number,
): MacOutlinePage {
  const rows = mode === 'tree' ? macOutlineRows(nodes) : textLines(nodes);
  return {
    ...budgetPage(rows, offset, maxChars),
    masked: nodes.filter(isSecure).length,
  };
}
