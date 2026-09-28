import {
  CHECKPOINT_OPTION,
  categorySchema,
  checkpointPayloadSchema,
  clarifyOptionId,
  type Category,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { asksWhenUnsure } from '../advisor/gate.ts';
import type { SystemOneResponse } from '../advisor/intake-questions.ts';
import type { CheckpointCard } from './checkpoint.ts';

export const INTERPRETATION_QUESTION = 'What should change?';
export const MIN_INTERPRETATIONS = 2;
export const MAX_INTERPRETATIONS = 4;
const LIKELY_ENOUGH = 0.1;
const SHORT_REQUEST_WORDS = 10;
export const SPEED_KEY = 'speed';

const INTERPRETATIONS: Partial<Record<Category, string>> = {
  bug_fix: 'Fix what is broken in it',
  debugging: 'Find the cause of a problem in it',
  feature: 'Add new behaviour or features',
  refactor: 'Restructure the code without changing what it does',
  docs: 'Improve its documentation',
  review: 'Review it and suggest improvements, without changing it',
  setup: 'Change its build, tooling or settings',
  research: 'Explain how it works, without changing it',
  question: 'Explain how it works, without changing it',
};

const FALLBACK_INTERPRETATIONS = [INTERPRETATIONS.feature!, INTERPRETATIONS.refactor!];

const VAGUE_GOAL =
  /\b(?:better|improve|improved|nicer|cleaner|clean up|tidy|polish|enhance|optimi[sz]e|modernise|modernize|fix it|sort out)\b/i;

const SPEED_GOAL =
  /\b(?:faster|quicker|speedier|snappier|speed\s+(?:\w+\s+)?up|slow(?:er|ness)?|perf(?:ormance)?|latency|laggy|sluggish)\b/i;

export const SPEED_ANGLES = ['startup', 'page_load', 'tests', 'build', 'queries'] as const;
export type SpeedAngle = (typeof SPEED_ANGLES)[number];

interface AngleText {
  text: string;
  what: string;
  names: RegExp;
}

const ANGLES: Record<SpeedAngle, AngleText> = {
  startup: {
    text: 'Startup: make the app and dev server start faster',
    what: 'How long the app, server or dev server takes to start',
    names: /\b(?:start ?up|starts?|boot\w*|launch\w*|cold start|dev server)\b/i,
  },
  page_load: {
    text: 'Page load: make pages load and render faster',
    what: 'How fast pages or screens load, render or respond in the browser',
    names:
      /\b(?:pages?|screens?|load(?:s|ing)?|render\w*|ui|front ?end|bundle|browser|scroll\w*)\b/i,
  },
  tests: {
    text: 'Tests: make the test suite run faster',
    what: 'How long the tests take to run, locally or in CI',
    names: /\b(?:tests?|specs?|test suite|ci)\b/i,
  },
  build: {
    text: 'Build: make builds and type checks faster',
    what: 'How long builds, bundling, compiling or type checks take',
    names: /\b(?:builds?|compil\w+|type ?checks?|tsc|bundl\w+)\b/i,
  },
  queries: {
    text: 'API and database: make slow requests and queries faster',
    what: 'How long API requests, endpoints or database queries take',
    names: /\b(?:api|quer(?:y|ies)|database|db|sql|requests?|endpoints?)\b/i,
  },
};

const DEFAULT_SPEED_ORDER: readonly SpeedAngle[] = ['startup', 'page_load', 'tests', 'build'];

function words(request: string): number {
  return request.trim().split(/\s+/).filter(Boolean).length;
}

export function asksForSpeed(request: string): boolean {
  return SPEED_GOAL.test(request);
}

function namesSpeedAngle(request: string): boolean {
  return SPEED_ANGLES.some((angle) => ANGLES[angle].names.test(request));
}

export function vagueByRule(request: string, namedFiles: number): boolean {
  if (namedFiles > 0) return false;
  if (words(request) > SHORT_REQUEST_WORDS) return false;
  if (asksForSpeed(request)) return !namesSpeedAngle(request);
  return VAGUE_GOAL.test(request);
}

export const SPEED_QUESTION =
  'The user asked to make something faster without saying what. Which kind of speed is `task` most likely about?';

export function speedQuestion(): Record<string, unknown> {
  return {
    type: 'choice',
    instructions: SPEED_QUESTION,
    criteria: Object.fromEntries(SPEED_ANGLES.map((angle) => [angle, ANGLES[angle].what])),
  };
}

function isSpeedAngle(value: string): value is SpeedAngle {
  return (SPEED_ANGLES as readonly string[]).includes(value);
}

function rankedAngles(response: SystemOneResponse | null): [SpeedAngle, number][] {
  const answer = response?.answers[SPEED_KEY];
  if (answer?.type !== 'choice') return [];
  return Object.entries(answer.probabilities)
    .flatMap(([id, probability]): [SpeedAngle, number][] =>
      isSpeedAngle(id) && Number.isFinite(probability) ? [[id, probability]] : [],
    )
    .sort(([, a], [, b]) => b - a);
}

function angleText(angle: SpeedAngle, checks: readonly string[]): string {
  const command =
    angle === 'tests'
      ? checks.find((check) => /\btest/i.test(check))
      : angle === 'build'
        ? checks.find((check) => /\b(?:build|typecheck|tsc)\b/i.test(check))
        : undefined;
  if (!command) return ANGLES[angle].text;
  return angle === 'tests'
    ? `Tests: make \`${command}\` run faster`
    : `Build: make \`${command}\` faster`;
}

export function speedInterpretations(
  response: SystemOneResponse | null,
  checks: readonly string[] = [],
): string[] {
  const ranked = rankedAngles(response);
  const likely = ranked
    .filter(([, probability], index) => index < MIN_INTERPRETATIONS || probability >= LIKELY_ENOUGH)
    .map(([angle]) => angle);
  const picked = [...likely];
  for (const angle of DEFAULT_SPEED_ORDER) {
    if (picked.length >= MAX_INTERPRETATIONS) break;
    if (ranked.length > 0 && picked.length >= MIN_INTERPRETATIONS) break;
    if (!picked.includes(angle)) picked.push(angle);
  }
  return picked.slice(0, MAX_INTERPRETATIONS).map((angle) => angleText(angle, checks));
}

export type VagueHandling = 'ask' | 'assume';

export function vagueHandling(level: InvolvementLevel): VagueHandling {
  return asksWhenUnsure(level) ? 'ask' : 'assume';
}

function rankedCategories(response: SystemOneResponse | null): [Category, number][] {
  const answer = response?.answers.intent;
  if (answer?.type !== 'choice') return [];
  return Object.entries(answer.probabilities)
    .flatMap(([id, probability]): [Category, number][] => {
      const category = categorySchema.safeParse(id);
      return category.success ? [[category.data, probability]] : [];
    })
    .sort(([, a], [, b]) => b - a);
}

export function interpretations(
  response: SystemOneResponse | null,
  request = '',
  checks: readonly string[] = [],
): string[] {
  if (asksForSpeed(request)) return speedInterpretations(response, checks);
  const ranked = rankedCategories(response).flatMap(([category, probability]) => {
    const text = INTERPRETATIONS[category];
    return text ? [{ text, probability }] : [];
  });
  const unique = [...new Map(ranked.map((entry) => [entry.text, entry])).values()];
  const likely = unique.filter(
    (entry, index) => index < MIN_INTERPRETATIONS || entry.probability >= LIKELY_ENOUGH,
  );
  const texts = likely.slice(0, MAX_INTERPRETATIONS).map((entry) => entry.text);
  for (const fallback of FALLBACK_INTERPRETATIONS) {
    if (texts.length >= MIN_INTERPRETATIONS) break;
    if (!texts.includes(fallback)) texts.push(fallback);
  }
  return texts;
}

export function interpretationCard(choices: readonly string[], reason: string): CheckpointCard {
  const payload = checkpointPayloadSchema.parse({
    kind: 'clarify',
    question: INTERPRETATION_QUESTION,
    reason,
    choices: [...choices],
  });
  return {
    kind: 'clarify',
    title: INTERPRETATION_QUESTION,
    payload,
    options: [
      ...choices.map((choice, index) => ({
        optionId: clarifyOptionId(index),
        name: choice,
        kind: 'allow_once' as const,
      })),
      { optionId: CHECKPOINT_OPTION.answer, name: 'Answer in your own words', kind: 'allow_once' },
      {
        optionId: CHECKPOINT_OPTION.clarifyRules,
        name: 'Go with the most likely',
        kind: 'allow_once',
      },
      { optionId: CHECKPOINT_OPTION.stop, name: 'Stop', kind: 'reject_once' },
    ],
  };
}

export type Interpretation =
  { type: 'chosen'; text: string } | { type: 'assumed'; text: string } | { type: 'stopped' };

export function chosenInterpretation(
  card: CheckpointCard,
  optionId: string,
  note: string | null,
): Interpretation {
  if (optionId === CHECKPOINT_OPTION.stop) return { type: 'stopped' };
  const likely = card.payload.choices?.[0] ?? '';
  if (optionId === CHECKPOINT_OPTION.answer && note?.trim()) {
    return { type: 'chosen', text: note.trim() };
  }
  const index = card.options.findIndex((option) => option.optionId === optionId);
  const picked = card.payload.choices?.[index];
  return picked ? { type: 'chosen', text: picked } : { type: 'assumed', text: likely };
}

export function assumedRequest(request: string, interpretation: string): string {
  return `${request}\n\nThe request was vague, so assume the user means: ${interpretation}`;
}

export function assumptionLine(interpretation: string): string {
  return `Assumed you meant: ${interpretation}. Say so if you meant something else.`;
}
