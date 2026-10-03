const TEST_FILE =
  /(?:\.(?:test|spec)\.[^/]+$|(?:^|\/)__tests__\/|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py)$|_spec\.rb$|Tests?\.(?:java|cs|kt)$)/;
const TEST_MARKERS = /(?:\.(?:test|spec|db\.test|live\.test)$|^test_|_test$|_spec$|Tests?$)/;
const GENERIC_STEMS = new Set(['index', 'main', 'mod', 'lib', 'utils', 'types', '__init__']);

export function isTestFile(path: string): boolean {
  return TEST_FILE.test(path);
}

function stemOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

function subjectOf(testPath: string): string {
  let stem = stemOf(testPath);
  for (let previous = ''; previous !== stem;) {
    previous = stem;
    stem = stem.replace(TEST_MARKERS, '');
  }
  return stem.toLowerCase();
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut).replace(/\/__tests__$/, '');
}

function key(scope: string, stem: string): string {
  return `${scope}\u0000${stem}`;
}

export function pairTests(
  paths: readonly string[],
  packageOf: (path: string) => string,
): Set<string> {
  const byDirectory = new Set<string>();
  const byPackage = new Set<string>();
  const subjects = new Set<string>();
  const sources: string[] = [];
  for (const path of paths) {
    if (!isTestFile(path)) {
      sources.push(path);
      continue;
    }
    const subject = subjectOf(path);
    subjects.add(subject);
    byDirectory.add(key(directoryOf(path), subject));
    byPackage.add(key(packageOf(path), subject));
  }
  const tested = new Set<string>();
  for (const path of sources) {
    const stem = stemOf(path).toLowerCase();
    if (!subjects.has(stem)) continue;
    const near = byDirectory.has(key(directoryOf(path), stem));
    const inPackage = !GENERIC_STEMS.has(stem) && byPackage.has(key(packageOf(path), stem));
    if (near || inPackage) tested.add(path);
  }
  return tested;
}
