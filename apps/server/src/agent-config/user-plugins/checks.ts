import type { PluginFinding, PluginScanStatus } from '@spark-outpost/contracts';
import { parseFrontmatter } from '../frontmatter.ts';
import type { PluginFile, PluginFiles } from './files.ts';
import { INLINE_SHELL, type ParsedPlugin } from './parse.ts';

interface LineRule {
  rule: string;
  title: string;
  severity: PluginFinding['severity'];
  reason: string;
  patterns: RegExp[];
}

const SHELL = String.raw`(?:sudo\s+)?(?:ba|z|da)?sh\b`;
const DECODE = String.raw`(?:base64\s+(?:-d|--decode|-D)|xxd\s+-r)`;
const HOME = String.raw`(?:~|\$HOME|\$\{HOME\})`;

const LINE_RULES: readonly LineRule[] = [
  {
    rule: 'network-shell',
    title: 'Downloads and runs code',
    severity: 'flagged',
    reason: 'Downloads a script and runs it in a shell.',
    patterns: [
      new RegExp(String.raw`\b(?:curl|wget)\b[^\n|]*\|\s*${SHELL}`),
      new RegExp(String.raw`\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b`),
      /\beval\s+"?\$\(\s*(?:curl|wget)\b/,
    ],
  },
  {
    rule: 'decode-exec',
    title: 'Runs hidden, decoded code',
    severity: 'flagged',
    reason: 'Decodes hidden text and runs it.',
    patterns: [
      new RegExp(String.raw`${DECODE}[^\n]*\|\s*${SHELL}`),
      new RegExp(String.raw`\beval\s+"?\$\([^\n]*${DECODE}`),
      /\b(?:exec|eval)\s*\(\s*(?:base64\.b64decode|atob|Buffer\.from)\s*\(/,
    ],
  },
  {
    rule: 'secret-read',
    title: 'Reads SSH or cloud keys and other secrets',
    severity: 'flagged',
    reason: 'Reads keys, tokens or other secrets.',
    patterns: [
      new RegExp(
        String.raw`${HOME}\/\.(?:ssh|aws|gnupg|netrc|git-credentials|npmrc|pypirc|docker\/config\.json|config\/gh\/hosts\.yml)\b`,
      ),
      /\.aws\/credentials\b/,
      /\bsecurity\s+(?:find-generic-password|find-internet-password|dump-keychain)\b/,
      /(?:\b(?:cat|source|cp|scp|head|tail)|<)\s+\S*\.env\b/,
    ],
  },
  {
    rule: 'write-outside',
    title: 'Changes files outside the plugin',
    severity: 'flagged',
    reason: 'Writes outside the plugin, to shell startup files, schedules or Claude settings.',
    patterns: [
      new RegExp(
        String.raw`>>?\s*${HOME}\/\.(?:bashrc|zshrc|profile|bash_profile|zprofile|zshenv|ssh|claude)\b`,
      ),
      /\bcrontab\b/,
      /\bLaunchAgents\b/,
      new RegExp(String.raw`\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(?:${HOME}|\/)(?:\s|$)`),
    ],
  },
  {
    rule: 'redirect',
    title: 'Changes where your model traffic goes',
    severity: 'flagged',
    reason: 'Changes where model traffic or keys go.',
    patterns: [
      /\b(?:ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|apiKeyHelper|(?:HTTPS?|ALL)_PROXY|(?:https?|all)_proxy)\b/,
    ],
  },
  {
    rule: 'approval-bypass',
    title: 'Tells the agent to skip approvals',
    severity: 'flagged',
    reason: 'Tells the agent to get around approvals or hide what it does.',
    patterns: [
      /\b(?:ignore|bypass|skip|disable|circumvent|override)\s+(?:(?:the|any|all|every|user'?s?|spark'?s?|claude'?s?)\s+){0,3}(?:approvals?|permission (?:prompts?|checks?)|safety (?:rules|checks)|confirmations?)\b/i,
      /--dangerously-skip-permissions\b|\bbypassPermissions\b/,
      /\b(?:do not|don't|never)\s+(?:tell|inform|show|mention|reveal)\s+(?:this\s+|it\s+)?(?:to\s+)?the\s+user\b/i,
      /\bhide\s+(?:this|these|your|the)\s+(?:actions?|commands?|changes?)\b/i,
    ],
  },
];

const BLOB_RULE: LineRule = {
  rule: 'encoded-blob',
  title: 'Holds a long encoded blob',
  severity: 'review',
  reason: 'Holds a long encoded blob that could hide content.',
  patterns: [/[A-Za-z0-9+/]{400,}={0,2}/, /\b(?:[0-9a-fA-F]{2}){200,}\b/],
};

const SCRIPT_FILE = /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|php|ps1|exe|bin|so|dylib)$/;

function firstLine(text: string, patterns: readonly RegExp[]): number | null {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => patterns.some((pattern) => pattern.test(line)));
  return index === -1 ? null : index + 1;
}

function lineFindings(file: PluginFile): PluginFinding[] {
  if (file.text === null) return [];
  const rules = file.path.endsWith('.svg') ? LINE_RULES : [...LINE_RULES, BLOB_RULE];
  return rules.flatMap((rule) => {
    const line = firstLine(file.text!, rule.patterns);
    if (line === null) return [];
    const { severity, title, reason } = rule;
    return [{ source: 'check', severity, rule: rule.rule, title, file: file.path, line, reason }];
  });
}

const INLINE_SHELL_REASON = 'Runs a shell command without asking when it loads.';

function inlineShellLines(text: string): number[] {
  return text.split('\n').flatMap((line, index) => (INLINE_SHELL.test(line) ? [index + 1] : []));
}

const LISTED_TITLES = {
  executable: 'Scripts and programs it runs',
  hook: 'Runs commands on Claude events',
  'mcp-server': 'Starts an MCP server',
  'inline-shell': 'Runs shell commands when it loads',
  'frontmatter-hooks': 'Starts its own hooks or MCP servers',
  symlink: 'Links to other files',
  unscanned: "Has a file Spark can't read",
} as const;

function review(
  rule: keyof typeof LISTED_TITLES,
  file: string,
  line: number | null,
  reason: string,
): PluginFinding {
  return {
    source: 'check',
    severity: 'review',
    rule,
    title: LISTED_TITLES[rule],
    file,
    line,
    reason,
  };
}

function definesHooksOrServers(text: string): boolean {
  const { fields } = parseFrontmatter(text);
  return 'hooks' in fields || 'mcpServers' in fields;
}

const ROOT_PREFIX = /^(?:\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT)\/|^\.\//;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function referencedNames(byPath: Map<string, PluginFile>, parsed: ParsedPlugin): Set<string> {
  const texts = [
    ...parsed.hooks.map((hook) => hook.command),
    ...parsed.mcpServers.flatMap((server) => [server.command ?? '', ...server.args]),
    ...parsed.definitionFiles.map((path) => byPath.get(path)?.text ?? ''),
  ];
  const names = new Set<string>();
  for (const token of texts.join('\n').split(/[\s"'`()<>|;&,=[\]]+/)) {
    const path = token.replace(ROOT_PREFIX, '').replace(/[.:]+$/, '');
    if (path === '') continue;
    names.add(path);
    names.add(baseName(path));
  }
  return names;
}

function runnableScripts(found: PluginFiles, parsed: ParsedPlugin): PluginFile[] {
  const byPath = new Map(found.files.map((file) => [file.path, file]));
  const referenced = referencedNames(byPath, parsed);
  return found.files.filter(
    (file) =>
      (file.executable || SCRIPT_FILE.test(file.path)) &&
      (referenced.has(file.path) || referenced.has(baseName(file.path))),
  );
}

function listedItems(found: PluginFiles, parsed: ParsedPlugin): PluginFinding[] {
  const byPath = new Map(found.files.map((file) => [file.path, file]));
  return [
    ...runnableScripts(found, parsed).map((file) =>
      review('executable', file.path, null, 'A script or program the plugin runs.'),
    ),
    ...parsed.hooks.map((hook) =>
      review('hook', hook.source, null, `Hook on ${hook.event}: ${hook.command}`),
    ),
    ...parsed.mcpServers.map((server) =>
      review(
        'mcp-server',
        '.mcp.json',
        null,
        `MCP server ${server.name}: ${server.url ?? [server.command, ...server.args].join(' ')}`,
      ),
    ),
    ...parsed.definitionFiles.flatMap((path) =>
      inlineShellLines(byPath.get(path)?.text ?? '').map((line) =>
        review('inline-shell', path, line, INLINE_SHELL_REASON),
      ),
    ),
    ...parsed.definitionFiles
      .filter((path) => definesHooksOrServers(byPath.get(path)?.text ?? ''))
      .map((path) =>
        review('frontmatter-hooks', path, null, 'Starts its own hooks or MCP servers when used.'),
      ),
    ...found.symlinks.map((path) =>
      review('symlink', path, null, "A link to another file. Spark doesn't copy it."),
    ),
    ...parsed.definitionFiles
      .filter((path) => byPath.get(path)?.text === null)
      .map((path) =>
        review(
          'unscanned',
          path,
          null,
          "Too large or not text, so Spark's checks and the agent review can't read it, but Claude loads it.",
        ),
      ),
  ];
}

export function checkPlugin(found: PluginFiles, parsed: ParsedPlugin): PluginFinding[] {
  return [...found.files.flatMap(lineFindings), ...listedItems(found, parsed)];
}

export function scanStatus(findings: readonly PluginFinding[]): PluginScanStatus {
  if (findings.some((finding) => finding.severity === 'flagged')) return 'flagged';
  return findings.length > 0 ? 'review' : 'clean';
}
