export type Description = string | Record<string, unknown> | unknown[];

export type NoulCriteria = {
  true: Description;
  false: Description;
};

export type NoulQuestion = {
  type: 'noul';
  instructions: Description;
  criteria: NoulCriteria;
};

export function noulQuestion(instructions: Description, criteria: NoulCriteria): NoulQuestion {
  return { type: 'noul', instructions, criteria: { true: criteria.true, false: criteria.false } };
}

export function capped(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[cut at ${limit} characters]` : text;
}
