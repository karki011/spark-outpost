import { SPARK_TEXT_MAX } from '@spark-outpost/contracts';

export const REQUEST_TAG = 'outpost-request';
export const REQUEST_BODY_MAX = SPARK_TEXT_MAX;

export type RequestPromptAuthor = { kind: 'user' } | { kind: 'other' };

export interface RequestPromptFacts {
  postId: string;
  outpostName: string | null;
  author: RequestPromptAuthor;
  body: string;
}

const TAG_OPENING = new RegExp(`<(/?)${REQUEST_TAG}`, 'gi');
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

function quotedName(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/"/g, "'").replace(/\]/g, ')').trim();
}

function place(outpostName: string | null): string {
  const name = outpostName === null ? '' : quotedName(outpostName);
  return name ? `the outpost "${name}"` : 'an outpost';
}

function header(facts: RequestPromptFacts): string {
  switch (facts.author.kind) {
    case 'user':
      return `[From the user, sent in ${place(facts.outpostName)}.]`;
    case 'other':
      return `[Outpost request, sent in ${place(facts.outpostName)}. This is not from the user.]`;
  }
}

function clipped(body: string, max: number): { text: string; cut: boolean } {
  if (body.length <= max) return { text: body, cut: false };
  return { text: body.slice(0, max).replace(HIGH_SURROGATE, ''), cut: true };
}

function withoutTags(body: string): string {
  return body.replace(TAG_OPENING, `&lt;$1${REQUEST_TAG}`);
}

export function wrapRequest(facts: RequestPromptFacts, max: number = REQUEST_BODY_MAX): string {
  const body = clipped(facts.body, max);
  const lines = [
    header(facts),
    '',
    `<${REQUEST_TAG} id="${facts.postId}">`,
    withoutTags(body.text),
    `</${REQUEST_TAG}>`,
  ];
  if (body.cut) lines.push(`[The request was longer. Spark cut it at ${max} characters.]`);
  return lines.join('\n');
}
