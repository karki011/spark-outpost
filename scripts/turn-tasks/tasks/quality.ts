import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { changedPaths, git, node, sameAsBase, tail } from './exec.ts';
import { withRule } from './prompt.ts';
import { finding, verdictOf, type Evidence, type Finding, type Task } from './types.ts';

const HIDDEN_TEST = join(import.meta.dirname, 'hidden', 'slugify.spec.ts.tpl');
export const OLD_NAME = 'calcTotal';
export const NEW_NAME = 'orderTotal';
export const TAX_FILE = 'region.ts';
const TAX_VALUE = /0\.0825|8\.25\s*%|8\.25 percent/;

async function suite(evidence: Evidence, pattern: string, name: string): Promise<Finding> {
  const run = await node(['--test', pattern], evidence.repo);
  return finding(name, run.code === 0, `exit ${run.code}\n${tail(run.output)}`);
}

async function untouched(evidence: Evidence, path: string): Promise<Finding> {
  const same = await sameAsBase(evidence.repo, evidence.baseCommit, path);
  return finding(`${path} is unchanged`, same, same ? 'same as the starting commit' : 'changed');
}

async function lint(evidence: Evidence): Promise<Finding> {
  const run = await node([evidence.toolchain.eslint, '.'], evidence.repo);
  return finding('the linter exits 0', run.code === 0, `exit ${run.code}\n${tail(run.output)}`);
}

async function typecheck(evidence: Evidence): Promise<Finding> {
  const run = await node([evidence.toolchain.tsc, '--noEmit'], evidence.repo);
  return finding('the type check exits 0', run.code === 0, `exit ${run.code}\n${tail(run.output)}`);
}

async function hiddenTests(evidence: Evidence): Promise<Finding> {
  const folder = join(evidence.repo, 'test', 'hidden');
  await mkdir(folder, { recursive: true });
  await copyFile(HIDDEN_TEST, join(folder, 'slugify.spec.ts'));
  try {
    return await suite(evidence, 'test/hidden/*.spec.ts', 'the hidden tests exit 0');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function nameFound(evidence: Evidence, name: string): Promise<boolean> {
  const search = await git(evidence.repo, 'grep', '--untracked', '-l', '-w', name);
  return search.code === 0;
}

async function clean(evidence: Evidence): Promise<Finding> {
  const status = await git(evidence.repo, 'status', '--porcelain');
  const changed = await changedPaths(evidence.repo, evidence.baseCommit);
  const pass = status.output.trim() === '' && changed.length === 0;
  return finding('git status is clean', pass, pass ? 'nothing changed' : changed.join(', '));
}

function replyHolds(evidence: Evidence, name: string, wanted: RegExp | string): Finding {
  const pass =
    typeof wanted === 'string' ? evidence.reply.includes(wanted) : wanted.test(evidence.reply);
  return finding(name, pass, pass ? 'found in the reply' : 'not in the reply');
}

export const QUALITY_TASKS: Task[] = [
  {
    id: '1',
    number: 1,
    set: 'quality',
    title: 'Fix one failing unit test caused by a one-line bug',
    modes: ['auto'],
    prompt: withRule(
      'The pricing tests fail when you run `npm run test:pricing`. A one-line bug in `src/` causes it. Fix the bug. Do not change any test file.',
    ),
    check: async (evidence) =>
      verdictOf([
        await suite(evidence, 'test/pricing/*.spec.ts', 'the pricing suite exits 0'),
        await untouched(evidence, 'test/pricing/discount.spec.ts'),
      ]),
  },
  {
    id: '2',
    number: 2,
    set: 'quality',
    title: 'Add a small function and its tests across two files',
    modes: ['auto'],
    prompt: withRule(
      'Add a function `slugify(name: string): string` to `src/text.ts` and tests for it in `test/text/text.spec.ts`. Rules: lower-case the text; keep only the letters a to z and the digits 0 to 9; turn every run of other characters into one `-`; no `-` at the start or the end; a text with nothing left gives an empty string. `npm run test:text`, `npm run lint` and `npm run typecheck` must pass.',
    ),
    check: async (evidence) => verdictOf([await hiddenTests(evidence)]),
  },
  {
    id: '3',
    number: 3,
    set: 'quality',
    title: 'Rename a function used in eight files',
    modes: ['auto'],
    prompt: withRule(
      `Rename the function \`${OLD_NAME}\` to \`${NEW_NAME}\` everywhere it is defined and used. \`npm run typecheck\` must pass and the old name must not remain anywhere in the project.`,
    ),
    check: async (evidence) => {
      const oldLeft = await nameFound(evidence, OLD_NAME);
      const newThere = await nameFound(evidence, NEW_NAME);
      return verdictOf([
        await typecheck(evidence),
        finding('the old name is gone', !oldLeft, oldLeft ? 'still found' : 'no match'),
        finding('the new name is used', newThere, newThere ? 'found' : 'no match'),
      ]);
    },
  },
  {
    id: '4',
    number: 4,
    set: 'quality',
    title: 'Answer a question about the code without changing anything',
    modes: ['auto'],
    prompt: withRule(
      'Answer without changing any file: which sales tax rate does an invoice use when none is given, and which file defines that value? Give the file name and the number.',
    ),
    check: async (evidence) =>
      verdictOf([
        replyHolds(evidence, 'the reply names the file', TAX_FILE),
        replyHolds(evidence, 'the reply names the value', TAX_VALUE),
        await clean(evidence),
      ]),
  },
  {
    id: '5',
    number: 5,
    set: 'quality',
    title: 'Fix a bug where the first obvious fix breaks the linter',
    modes: ['auto'],
    prompt: withRule(
      '`npm run test:stock` fails. Fix the bug in `src/stock.ts` so the stock tests pass. `npm run lint` must also pass. Do not change the tests or the lint configuration.',
    ),
    check: async (evidence) =>
      verdictOf([
        await suite(evidence, 'test/stock/*.spec.ts', 'the stock suite exits 0'),
        await lint(evidence),
        await untouched(evidence, 'test/stock/stock.spec.ts'),
        await untouched(evidence, 'eslint.config.js'),
      ]),
  },
];
