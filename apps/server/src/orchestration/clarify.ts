import { wordCount } from './risk-rules.ts';

const SHORT_REQUEST_WORDS = 10;

const VAGUE_GOAL =
  /\b(?:better|improve|improved|nicer|cleaner|clean up|tidy|polish|enhance|optimi[sz]e|modernise|modernize|fix it|sort out)\b/i;

export const NO_TARGET =
  /^\s*(?:(?:please|pls|can you|could you|just)\s+)*(?:(?:fix|do|handle|sort)\s+the\s+(?:thing|stuff|issue|problem|mess)s?|(?:clean|tidy)\s+(?:it|this|that|things)\s+up|sort\s+(?:it|this|that|things)\s+out)\b[\s.!?]*$/i;

const SPEED_GOAL =
  /\b(?:faster|quicker|speedier|snappier|speed\s+(?:\w+\s+)?up|slow(?:er|ness)?|perf(?:ormance)?|latency|laggy|sluggish)\b/i;

const SPEED_ANGLES = ['startup', 'page_load', 'tests', 'build', 'queries'] as const;
type SpeedAngle = (typeof SPEED_ANGLES)[number];

interface AngleText {
  text: string;
  names: RegExp;
}

const ANGLES: Record<SpeedAngle, AngleText> = {
  startup: {
    text: 'Startup: make the app and dev server start faster',
    names: /\b(?:start ?up|starts?|boot\w*|launch\w*|cold start|dev server)\b/i,
  },
  page_load: {
    text: 'Page load: make pages load and render faster',
    names:
      /\b(?:pages?|screens?|load(?:s|ing)?|render\w*|ui|front ?end|bundle|browser|scroll\w*)\b/i,
  },
  tests: {
    text: 'Tests: make the test suite run faster',
    names: /\b(?:tests?|specs?|test suite|ci)\b/i,
  },
  build: {
    text: 'Build: make builds and type checks faster',
    names: /\b(?:builds?|compil\w+|type ?checks?|tsc|bundl\w+)\b/i,
  },
  queries: {
    text: 'API and database: make slow requests and queries faster',
    names: /\b(?:api|quer(?:y|ies)|database|db|sql|requests?|endpoints?)\b/i,
  },
};

function asksForSpeed(request: string): boolean {
  return SPEED_GOAL.test(request);
}

function namesSpeedAngle(request: string): boolean {
  return SPEED_ANGLES.some((angle) => ANGLES[angle].names.test(request));
}

export function vagueByRule(request: string, namedFiles: number): boolean {
  if (namedFiles > 0) return false;
  if (wordCount(request) > SHORT_REQUEST_WORDS) return false;
  if (asksForSpeed(request)) return !namesSpeedAngle(request);
  return VAGUE_GOAL.test(request) || NO_TARGET.test(request);
}
