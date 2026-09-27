import {
  buildStyleRank,
  SHORTCUTS_MAX,
  type BuildStyle,
  type RunMode,
  type Shortcut,
} from '@spark-outpost/contracts';

const SAFETY_FLOOR =
  'Never trim input validation at trust boundaries, error handling that prevents data loss, security measures, accessibility basics, or anything the request asks for. If the user asks for the full version, build it.';

const MARKER_RULE =
  'When you take a deliberate shortcut with a known limit, mark it with a comment such as `// lean: in-memory only; upgrade: move to Redis when there are several servers`, naming the limit and when to revisit it.';

const BUILDER_TEXT: Record<Exclude<BuildStyle, 'off'>, string> = {
  lean: [
    'Read the request and the code it touches first, and trace the real flow end to end. Then build the least code that fully does what was asked. Stop at the first of these that works:',
    '1. Does it need to exist? Skip speculative parts and say so in one line.',
    '2. Is it already in this codebase? Reuse the helper, type or pattern that is here.',
    "3. Does the language's standard library do it?",
    '4. Does the platform do it natively, such as an HTML input type, CSS, or a database constraint?',
    '5. Does a dependency the project already has do it? Do not add a new dependency for a few lines.',
    '6. Can it be one line?',
    '7. Only then write the minimum code that works.',
    'Fix a bug at its root: find every caller of the function you change and fix the shared code once instead of guarding each caller.',
    SAFETY_FLOOR,
    MARKER_RULE,
    'Leave one runnable check, such as one small test, for non-trivial logic (a branch, a loop, a parser, a money or security path). Trivial changes need none.',
    'End your reply with at most three short lines: what you skipped and when to add it.',
  ].join('\n'),
  lite: [
    'Build what the request asks, completely. Where a clearly smaller option exists (reuse from this codebase, the standard library, a native platform feature), name it in one line of your reply, but do not switch to it.',
    SAFETY_FLOOR,
    MARKER_RULE,
  ].join('\n'),
};

const CRITIC_TEXT = [
  'In the same findings list, also look for needless complexity and tag each such finding with one of: "delete:" (dead or speculative code), "stdlib:" (hand-written code the standard library covers; name the function), "native:" (code or a dependency doing what the platform does; name the feature), "yagni:" (an abstraction with one use, or config nobody sets) or "shrink:" (the same logic in fewer lines; show the shorter form). Give the file and line.',
  'One small test or self-check is not complexity. Never call validation at trust boundaries, data-loss error handling, security or accessibility complexity.',
  'Complexity findings alone do not make the verdict concerns; keep concerns for correctness, safety or missing requested behaviour.',
  'Before the verdict line, write one line "net: -N lines possible", or "net: 0" when the change is lean already.',
].join('\n');

function titled(style: BuildStyle, body: string): string {
  return `## Build style: ${style}\n${body}`;
}

export function builderStyle(style: BuildStyle): string | null {
  return style === 'off' ? null : titled(style, BUILDER_TEXT[style]);
}

export function criticStyle(style: BuildStyle): string | null {
  return style === 'off' ? null : `## Complexity (same review)\n${CRITIC_TEXT}`;
}

export interface StyleRule {
  style: BuildStyle;
  reason: string;
}

const FULL_VERSION =
  /\b(?:full[- ]featured|feature[- ]complete|fully[- ]fledged|production[- ](?:ready|grade|quality)|complete (?:version|implementation|solution|feature)|comprehensive|polished|robust)\b/i;

export function lowerOf(a: BuildStyle, b: BuildStyle): BuildStyle {
  return buildStyleRank(a) <= buildStyleRank(b) ? a : b;
}

export type StyleSource = 'project setting' | 'default';

export interface ProjectStyle {
  style: BuildStyle;
  source: StyleSource;
}

export function ruleBuildStyle(
  project: BuildStyle,
  mode: RunMode | null,
  request: string,
  source: StyleSource = 'project setting',
): StyleRule {
  if (project === 'off') return { style: 'off', reason: source };
  if (mode !== 'do') return { style: 'off', reason: 'not a code-changing turn' };
  if (FULL_VERSION.test(request)) {
    return { style: lowerOf(project, 'lite'), reason: 'asks for a complete version' };
  }
  return { style: project, reason: source };
}

const COMMENT_MARKER = /(?:\/\/|\/\*+|#|<!--|--|;|%)\s*lean:\s*(.*?)\s*(?:\*+\/|-->)?[\s)}]*$/i;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const EXPLICIT_UPGRADE = /^(.*?)[\s;,.–—-]*\bupgrade\s*:\s*(.+)$/i;

function tidy(text: string): string {
  return text.trim().replace(/[\s.;,]+$/, '');
}

export function splitMarker(text: string): Pick<Shortcut, 'ceiling' | 'upgrade'> {
  const explicit = EXPLICIT_UPGRADE.exec(text);
  if (explicit) return { ceiling: tidy(explicit[1] ?? ''), upgrade: tidy(explicit[2] ?? '') };
  const cut = text.search(/[;,]\s/);
  if (cut === -1) return { ceiling: tidy(text), upgrade: null };
  const upgrade = tidy(text.slice(cut + 1));
  return { ceiling: tidy(text.slice(0, cut)), upgrade: upgrade || null };
}

function newPath(header: string): string | null {
  const target = header.slice(4).trim();
  if (target === '/dev/null') return null;
  return target.replace(/^b\//, '');
}

export function harvestShortcuts(patch: string): Shortcut[] {
  const found: Shortcut[] = [];
  let path: string | null = null;
  let line = 0;
  let inHunk = false;
  for (const text of patch.split('\n')) {
    if (text.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (!inHunk && text.startsWith('+++ ')) {
      path = newPath(text);
      continue;
    }
    const hunk = HUNK.exec(text);
    if (hunk) {
      inHunk = true;
      line = Number(hunk[1]);
      continue;
    }
    if (!inHunk) continue;
    if (text.startsWith('+')) {
      const marker = COMMENT_MARKER.exec(text.slice(1));
      if (marker && path && found.length < SHORTCUTS_MAX) {
        found.push({ path, line, ...splitMarker(marker[1] ?? '') });
      }
      line += 1;
    } else if (!text.startsWith('-') && !text.startsWith('\\')) {
      line += 1;
    }
  }
  return found.filter((entry) => entry.ceiling.length > 0);
}

const NET_LINE = /^[\s*_>-]*net\s*:[\s*_]*[-−]?\s*(\d+)/im;

export function reviewNet(text: string): number | null {
  const match = NET_LINE.exec(text);
  if (!match) return null;
  const lines = Number(match[1]);
  return lines === 0 ? 0 : -lines;
}
