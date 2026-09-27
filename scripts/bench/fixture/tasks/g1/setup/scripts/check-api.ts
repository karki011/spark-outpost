import { readFileSync, readdirSync } from 'node:fs';

const EXPORT = /^export\s+(?:async\s+)?(?:function|interface|type|const|class)\s+(\w+)/gm;
const recorded = JSON.parse(readFileSync('api-surface.json', 'utf8')) as Record<string, string[]>;
const problems: string[] = [];

for (const file of readdirSync('src').filter((name) => name.endsWith('.ts'))) {
  const path = `src/${file}`;
  const found = [...readFileSync(path, 'utf8').matchAll(EXPORT)].map((match) => match[1]!).sort();
  const known = [...(recorded[path] ?? [])].sort();
  for (const name of found.filter((name) => !known.includes(name))) {
    problems.push(`${path}: new export ${name} is not recorded in api-surface.json`);
  }
  for (const name of known.filter((name) => !found.includes(name))) {
    problems.push(`${path}: ${name} is recorded in api-surface.json but no longer exported`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error('Update api-surface.json when the public API changes on purpose.');
  process.exit(1);
}
console.log('API surface matches api-surface.json.');
