import { buildStyleRank, BUILD_STYLES, type BuildStyle } from '@spark-outpost/contracts';

export const BUILD_STYLE_QUESTION = 'How lean should the code written for `task` be?';

const STYLE_CRITERIA: Record<BuildStyle, string> = {
  lean: 'Lean: build the smallest thing that fully meets `task`; it leaves room in how much to build',
  lite: 'Lite: `task` explicitly asks for a complete, full-featured or polished version; build all of it',
  off: 'Normal: `task` is not about writing code, or it asks for broad, thorough work that trimming would go against',
};

export function allowedStyles(project: BuildStyle): BuildStyle[] {
  return BUILD_STYLES.filter((style) => buildStyleRank(style) <= buildStyleRank(project));
}

export function buildStyleQuestion(project: BuildStyle) {
  const criteria = Object.fromEntries(
    allowedStyles(project).map((style) => [style, STYLE_CRITERIA[style]]),
  );
  return { type: 'choice', instructions: BUILD_STYLE_QUESTION, criteria };
}
