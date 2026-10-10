import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withRule } from './prompt.ts';
import { finding, verdictOf, type Evidence, type Task } from './types.ts';

export const GUIDE_PAGE = 'sparkignore.md';
export const GUIDE_SENTENCE = 'A listed file can still show as a dot on the Map.';
export const NOTE_FILE = 'notes/sparkignore.md';

function squeezed(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function noteHoldsSentence(evidence: Evidence) {
  const note = await readFile(join(evidence.repo, NOTE_FILE), 'utf8').catch(() => null);
  if (note === null)
    return finding(`${NOTE_FILE} holds the sentence`, false, 'the file is missing');
  const pass = squeezed(note).includes(GUIDE_SENTENCE);
  return finding(`${NOTE_FILE} holds the sentence`, pass, pass ? 'found' : 'not in the file');
}

export const SPARK_TOOL_TASKS: Task[] = [
  {
    id: '9',
    number: 9,
    set: 'quality',
    title: 'Use a Spark tool: look something up with spark_docs and write it into a file',
    modes: ['auto'],
    prompt: withRule(
      `Use the Spark tool \`spark_docs\` to read the guide page about \`.sparkignore\`. Find the sentence that says how a listed file can still appear on the Map. Write that sentence, copied exactly, into a new file \`${NOTE_FILE}\`. \`spark_docs\` is a local Spark tool and the only tool besides file tools to use here.`,
    ),
    check: async (evidence) => verdictOf([await noteHoldsSentence(evidence)]),
  },
];
