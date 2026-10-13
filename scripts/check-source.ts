import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { checkSource } from './source-rules.ts';

const HANDWRITTEN = /\.(ts|tsx|js|mjs|css|sql|sh|html)$/;
const EXCLUDED = /^(docs\/design\/|.*node_modules\/|.*dist\/|pnpm-lock\.yaml$)/;

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => HANDWRITTEN.test(file) && !EXCLUDED.test(file) && existsSync(file));

const violations = files.flatMap((file) => checkSource(file, readFileSync(file, 'utf8')));

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} ${violation.message}`);
  }
  console.error(`\n${violations.length} source rule violation(s). See AGENTS.md.`);
  process.exit(1);
}
console.log(`Source rules passed for ${files.length} files.`);
