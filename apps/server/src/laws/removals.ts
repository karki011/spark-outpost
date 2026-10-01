import { LAW_REMOVED_BLOCK_LINES } from '../advisor/policy.ts';
import { TEST_FILE } from '../orchestration/critic-rule.ts';
import { code, type LawFacts, type LawFinding, type LawKind } from './finding.ts';
import { baseName, mentions, parsePatch, SNAPSHOT_FILE, type PatchFile } from './patch.ts';

const DECLARATIONS: readonly RegExp[] = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*export\s+(?:declare\s+)?(?:const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?fn\s+([A-Za-z_]\w*)/,
];

const TEST_CASE = /^\s*(?:it|test|describe)(?:\.\w+)?\s*\(\s*(['"`])(.+?)\1/;
const PY_TEST = /^\s*(?:async\s+)?def\s+(test_\w+)/;

const GUARD =
  /\b(require(?:Auth|Role|User|Admin|Login|Permission)\w*|authenticate\w*|authori[sz]e\w*|isAuthenticated|isAuthorized|isAdmin|checkPermission\w*|hasPermission\w*|verify\w*Token\w*|csrf\w*|rateLimit\w*|validate\w*|sanitize\w*|safeParse|assert\w*)\b/i;

const REMOVAL_WORDS =
  /\b(?:remov\w*|delet\w*|drop\w*|get rid|clean(?:ed|s|ing)? ?up|strip\w*|prun\w*|deprecat\w*|unused|no longer|replac\w*|mov(?:e|ed|es|ing)|inlin\w*|merg\w*|consolidat\w*|dead code|obsolete|redundant|superseded)\b/i;

const BROAD_REMOVAL =
  /\b(?:dead code|unused (?:code|exports?|functions?|files?|helpers?|imports?)|remove (?:the )?(?:legacy|old|deprecated)\b)/i;

interface Removal {
  kind: LawKind;
  path: string;
  name: string | null;
  text: string;
}

function declaredNames(lines: readonly string[]): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    for (const pattern of DECLARATIONS) {
      const name = pattern.exec(line)?.[1];
      if (name) {
        names.add(name);
        break;
      }
    }
  }
  return [...names];
}

function testNames(lines: readonly string[]): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    const name = TEST_CASE.exec(line)?.[2] ?? PY_TEST.exec(line)?.[1];
    if (name) names.add(name);
  }
  return [...names];
}

function guardWords(lines: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of lines) {
    const word = GUARD.exec(line)?.[1];
    if (word && !found.has(word.toLowerCase())) found.set(word.toLowerCase(), line.trim());
  }
  return found;
}

function movedElsewhere(file: PatchFile, files: readonly PatchFile[]): boolean {
  const name = file.path.split('/').at(-1);
  return files.some(
    (other) => other !== file && other.created && other.path.split('/').at(-1) === name,
  );
}

function fileRemovals(file: PatchFile, files: readonly PatchFile[]): Removal[] {
  if (movedElsewhere(file, files) || SNAPSHOT_FILE.test(file.path)) return [];
  const test = TEST_FILE.test(file.path);
  const what = test ? 'test file ' : '';
  return [
    {
      kind: test ? 'test' : 'file',
      path: file.path,
      name: baseName(file.path),
      text: `Removed ${what}${code(file.path)} — why?`,
    },
  ];
}

function symbolRemovals(file: PatchFile, addedEverywhere: string): Removal[] {
  const gone = (name: string) => !mentions(addedEverywhere, name);
  const tests = TEST_FILE.test(file.path) ? testNames(file.removed).filter(gone) : [];
  const testSet = new Set(tests);
  const symbols = declaredNames(file.removed).filter((name) => !testSet.has(name) && gone(name));
  return [
    ...tests.map((name) => ({
      kind: 'test' as const,
      path: file.path,
      name,
      text: `Removed test ${code(name)} from ${code(file.path)} — why?`,
    })),
    ...symbols.map((name) => ({
      kind: 'symbol' as const,
      path: file.path,
      name,
      text: `Removed ${code(name)} from ${code(file.path)} — why?`,
    })),
  ];
}

function guardRemovals(file: PatchFile): Removal[] {
  const kept = guardWords(file.added);
  return [...guardWords(file.removed)]
    .filter(([word]) => !kept.has(word))
    .map(([word, line]) => ({
      kind: 'guard' as const,
      path: file.path,
      name: word,
      text: `Removed a check in ${code(file.path)}: ${code(line.slice(0, 80))} — why?`,
    }));
}

function blockRemovals(file: PatchFile): Removal[] {
  return file.hunks
    .filter((hunk) => hunk.removed - hunk.added >= LAW_REMOVED_BLOCK_LINES)
    .slice(0, 1)
    .map((hunk) => ({
      kind: 'block' as const,
      path: file.path,
      name: null,
      text: `Removed ${hunk.removed - hunk.added} lines from ${code(file.path)} around line ${hunk.oldStart} — why?`,
    }));
}

export function findRemovals(patch: string): Removal[] {
  const files = parsePatch(patch);
  const addedEverywhere = files.flatMap((file) => file.added).join('\n');
  return files.flatMap((file) => {
    if (file.deleted) return fileRemovals(file, files);
    if (SNAPSHOT_FILE.test(file.path)) return [];
    const named = [...symbolRemovals(file, addedEverywhere), ...guardRemovals(file)];
    return named.length > 0 ? named : blockRemovals(file);
  });
}

function namesIt(text: string, removal: Removal): boolean {
  return (
    (removal.name !== null && mentions(text, removal.name)) ||
    text.includes(removal.path) ||
    mentions(text, removal.path.split('/').at(-1) ?? removal.path)
  );
}

function sentencesNaming(text: string, removal: Removal): string[] {
  return text.split(/(?<=[.!?\n])\s+/).filter((sentence) => namesIt(sentence, removal));
}

export function explained(removal: Removal, facts: LawFacts): boolean {
  if (BROAD_REMOVAL.test(facts.request)) return true;
  const asked = sentencesNaming(facts.request, removal);
  if (asked.some((sentence) => REMOVAL_WORDS.test(sentence))) return true;
  return facts.replies.some((reply) =>
    sentencesNaming(reply, removal).some((sentence) => REMOVAL_WORDS.test(sentence)),
  );
}

export function removalFindings(patch: string, facts: LawFacts): LawFinding[] {
  return findRemovals(patch)
    .filter((removal) => !explained(removal, facts))
    .map((removal) => ({
      law: 'chesterton' as const,
      kind: removal.kind,
      path: removal.path,
      text: removal.text,
    }));
}
