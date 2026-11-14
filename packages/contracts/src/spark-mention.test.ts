import { describe, expect, it } from 'vitest';
import {
  findSparkMentions,
  mainAgentContinues,
  sparksLeadMessage,
  withoutShadowed,
} from './spark-mention.ts';

const sparks = [
  { name: 'Pip' },
  { name: 'Pip Senior' },
  { name: 'Wren' },
  { name: 'Bolt' },
  { name: 'Ada' },
  { name: 'C++ guru' },
];
const named = (text: string) => findSparkMentions(text, sparks).map((found) => found.spark.name);
const continues = (text: string) => mainAgentContinues(text, findSparkMentions(text, sparks));

describe('findSparkMentions', () => {
  it('finds a mention at the start, in the middle and at the end', () => {
    expect(findSparkMentions('@Pip review this', sparks)).toEqual([
      { spark: { name: 'Pip' }, start: 0, end: 4 },
    ]);
    expect(named('Can @wren write the docs?')).toEqual(['Wren']);
    expect(named('Hand this to @PIP')).toEqual(['Pip']);
  });

  it('accepts punctuation after the name and an opening bracket or quote before it', () => {
    expect(named('@Pip, look at this')).toEqual(['Pip']);
    expect(named("What is @Pip's view?")).toEqual(['Pip']);
    expect(named('(@Wren) please')).toEqual(['Wren']);
    expect(named('line one\n@Wren line two')).toEqual(['Wren']);
  });

  it('prefers the longest name that matches', () => {
    expect(named('@Pip Senior take a look')).toEqual(['Pip Senior']);
    expect(named('@Pip Seniority is not a Spark')).toEqual(['Pip']);
  });

  it('matches names that contain symbols', () => {
    expect(named('ask @C++ guru about templates')).toEqual(['C++ guru']);
  });

  it('leaves unknown names, longer words and email addresses as plain text', () => {
    expect(named('@Nobody review this')).toEqual([]);
    expect(named('@Pippa review this')).toEqual([]);
    expect(named('@Pip2 review this')).toEqual([]);
    expect(named('mail pip@pip.dev or me@Wren')).toEqual([]);
    expect(named('Pip review this')).toEqual([]);
    expect(named('@ Pip')).toEqual([]);
  });

  it('lists each Spark once, in message order, up to three', () => {
    expect(named('@Wren and @Pip, then @wren again')).toEqual(['Wren', 'Pip']);
    expect(named('@Pip @Wren @Bolt @Ada go')).toEqual(['Pip', 'Wren', 'Bolt']);
  });

  it('finds nothing without Sparks', () => {
    expect(findSparkMentions('@Pip hi', [])).toEqual([]);
  });
});

describe('mainAgentContinues', () => {
  it('leaves a message that opens with its Sparks to them alone', () => {
    expect(continues('@Pip review this PR')).toBe(false);
    expect(continues('@Pip and @Wren, look at the login change')).toBe(false);
    expect(continues('  @Pip @Wren what do you think?')).toBe(false);
  });

  it('continues with the main agent when the message hands the work back', () => {
    expect(continues('@Pip review this, then fix what it finds')).toBe(true);
    expect(continues('@Pip review this. After that, update the changelog')).toBe(true);
    expect(continues('@Pip check the tests and once it is done open a PR')).toBe(true);
  });

  it('continues with the main agent when the message does not open with the Spark', () => {
    expect(continues('Fix the build and ask @Pip to review')).toBe(true);
    expect(continues('No mention here')).toBe(true);
  });

  it('does not read ordinary words as a hand-back', () => {
    expect(continues('@Pip is this authentication flow safe?')).toBe(false);
    expect(continues('@Wren write docs for the thenable helper')).toBe(false);
  });
});

describe('sparksLeadMessage', () => {
  it('is true only when nothing but joiners comes before the mentions', () => {
    const lead = (text: string) => sparksLeadMessage(text, findSparkMentions(text, sparks));
    expect(lead('@Pip, @Wren review')).toBe(true);
    expect(lead('Hey @Pip review')).toBe(false);
    expect(lead('@Pip review with @Wren')).toBe(false);
  });
});

describe('withoutShadowed', () => {
  const flows = [{ name: 'pip-review' }, { name: 'wren' }];
  const kept = (text: string) =>
    withoutShadowed(findSparkMentions(text, sparks), findSparkMentions(text, flows)).map(
      (found) => found.spark.name,
    );

  it('drops a Spark name that is only the start of a longer workflow id', () => {
    expect(kept('@pip-review go')).toEqual([]);
    expect(kept('@Pip and @pip-review')).toEqual(['Pip']);
  });

  it('keeps a Spark whose name equals a workflow id, and one with no workflow id', () => {
    expect(kept('@Wren look')).toEqual(['Wren']);
    expect(kept('@Pip-ish idea')).toEqual(['Pip']);
  });
});
