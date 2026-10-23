type Values = (field: string) => string;

const OPERATORS = [
  ['ISNOTEMPTY', (value: string) => value !== ''],
  ['ISEMPTY', (value: string) => value === ''],
] as const;

function term(text: string, values: Values): boolean {
  for (const [operator, test] of OPERATORS) {
    if (text.endsWith(operator)) return test(values(text.slice(0, -operator.length)));
  }
  const match = /^([a-z_.]+?)(!=|=|IN|LIKE|STARTSWITH)(.*)$/.exec(text);
  if (!match) throw new Error(`The fake can't read the query term ${text}`);
  const [, field = '', operator, expected = ''] = match;
  const value = values(field);
  if (operator === '=') return value === expected;
  if (operator === '!=') return value !== expected;
  if (operator === 'IN') return expected.split(',').includes(value);
  if (operator === 'LIKE') return value.toLowerCase().includes(expected.toLowerCase());
  return value.startsWith(expected);
}

function group(text: string, values: Values): boolean {
  const terms = text.split('^').filter((part) => part && !part.startsWith('ORDERBY'));
  const clauses: string[][] = [];
  for (const part of terms) {
    if (part.startsWith('OR') && clauses.length > 0) clauses.at(-1)!.push(part.slice(2));
    else clauses.push([part]);
  }
  return clauses.every((clause) => clause.some((part) => term(part, values)));
}

export function matchesQuery(query: string, values: Values): boolean {
  if (!query) return true;
  return query.split('^NQ').some((part) => group(part, values));
}
