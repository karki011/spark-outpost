import path from 'node:path';

export interface FailedOutput {
  failures: readonly string[];
  shape: string;
}

export interface FailedCheck extends FailedOutput {
  output: string;
}

export interface BaseEvidence extends FailedOutput {
  outcome: 'passed' | 'failed' | 'timed_out' | 'unavailable';
  trusted: boolean;
}

export interface Verdict {
  cause: 'change' | 'baseline' | 'unknown';
  blamed: string[];
  shared: string[];
  added: string[];
}

const SOURCE_SUFFIX = /(?:\.(?:test|spec))?\.[cm]?[jt]sx?$/;
const TEST_FOLDER = /(?:^|\/)(?:__tests__|tests?)\//;

function fileOf(id: string): string | null {
  const [kind, file] = id.split(' ');
  return kind === 'task' || !file ? null : file;
}

function taskOf(id: string): string | null {
  if (!id.startsWith('task ')) return null;
  const name = id.slice(5).split(/[:#]/)[0] ?? '';
  return name.replace(/^@[^/]+\//, '') || null;
}

function samePath(changed: string, named: string): boolean {
  return changed === named || changed.endsWith(`/${named}`) || named.endsWith(`/${changed}`);
}

function subjectOf(file: string): string {
  return file.replace(SOURCE_SUFFIX, '').replace(TEST_FOLDER, '/').replace(/^\//, '');
}

function touchesFile(changed: readonly string[], named: string, isTest: boolean): boolean {
  if (changed.some((file) => samePath(file, named))) return true;
  if (!isTest) return false;
  const subject = subjectOf(named);
  return changed.some((file) => samePath(subjectOf(file), subject));
}

function touchesTask(changed: readonly string[], task: string): boolean {
  return changed.some((file) => path.dirname(file).split('/').includes(task));
}

export function touchedFailures(failures: readonly string[], changed: readonly string[]): string[] {
  const namesFiles = failures.some((id) => fileOf(id) !== null);
  return failures.filter((id) => {
    const file = fileOf(id);
    if (file) return touchesFile(changed, file, id.startsWith('test '));
    const task = taskOf(id);
    return !namesFiles && task !== null && touchesTask(changed, task);
  });
}

const PATH_EDGE = '[\\s\'"`()\\[\\]:,]';

function namesChangedFile(output: string, changed: readonly string[]): boolean {
  return changed.some((file) => {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|/|${PATH_EDGE})${escaped}(?:$|${PATH_EDGE})`, 'm').test(output);
  });
}

function unnamed(failed: FailedCheck, changed: readonly string[]): Verdict['cause'] {
  return namesChangedFile(failed.output, changed) ? 'change' : 'unknown';
}

function withoutBase(failed: FailedCheck, changed: readonly string[]): Verdict {
  if (failed.failures.length === 0) {
    return { cause: unnamed(failed, changed), blamed: [], shared: [], added: [] };
  }
  const blamed = touchedFailures(failed.failures, changed);
  return { cause: blamed.length > 0 ? 'change' : 'unknown', blamed, shared: [], added: [] };
}

export function attributeFailure(
  failed: FailedCheck,
  changed: readonly string[],
  base: BaseEvidence | null,
): Verdict {
  if (!base || base.outcome === 'timed_out' || base.outcome === 'unavailable') {
    return withoutBase(failed, changed);
  }
  if (base.outcome === 'passed') {
    if (!base.trusted) return withoutBase(failed, changed);
    return { cause: 'change', blamed: [...failed.failures], shared: [], added: [] };
  }
  const before = new Set(base.failures);
  const shared = failed.failures.filter((id) => before.has(id));
  const added = failed.failures.filter((id) => !before.has(id));
  if (failed.failures.length === 0) {
    const cause = failed.shape === base.shape ? 'baseline' : unnamed(failed, changed);
    return { cause, blamed: [], shared, added };
  }
  if (added.length === 0) return { cause: 'baseline', blamed: [], shared, added };
  const comparable = base.trusted && base.failures.length > 0;
  const blamed = comparable ? added : touchedFailures(added, changed);
  return { cause: blamed.length > 0 ? 'change' : 'unknown', blamed, shared, added };
}
