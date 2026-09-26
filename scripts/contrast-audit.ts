import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { auditTokens, type HueResult, type PairResult } from './contrast/audit.ts';
import { ALLOWLIST, HUE_PAIRS, PAIRS } from './contrast/pairs.ts';
import { THEMES, themeTokens, type ThemeId } from './contrast/theme.ts';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    json: { type: 'string' },
    quiet: { type: 'boolean', default: false },
  },
});

type ThemeReport = { theme: ThemeId; pairs: PairResult[]; hues: HueResult[] };

const MARK = { pass: 'ok  ', fail: 'FAIL', exempt: 'exmp' } as const;

function printTheme({ theme, pairs, hues }: ThemeReport): void {
  const failures =
    pairs.filter((p) => p.status === 'fail').length +
    hues.filter((h) => h.status === 'fail').length;
  console.log(`\n## ${theme} — ${failures === 0 ? 'pass' : `${failures} failing`}`);
  const rows = values.quiet ? pairs.filter((p) => p.status !== 'pass') : pairs;
  for (const p of rows) {
    const ratio = p.ratio.toFixed(2).padStart(5);
    const need = p.required ? `${p.required}:1` : '—';
    console.log(
      `${MARK[p.status]} ${ratio}  ≥${need.padEnd(5)} ${p.fg} on ${p.bg}  ${p.group} · ${p.label}`,
    );
  }
  for (const h of hues) {
    console.log(
      `${MARK[h.status]} ${h.degrees.toFixed(0).padStart(4)}°  ≥${h.required}°   ${h.label}`,
    );
  }
}

const reports: ThemeReport[] = THEMES.map((theme) => ({
  theme,
  ...auditTokens(themeTokens(theme, values.root)),
}));

reports.forEach(printTheme);

const exempt = reports.flatMap((r) => r.pairs).filter((p) => p.status === 'exempt');
console.log('\nAllowlisted (recorded, not enforced):');
for (const [id, reason] of Object.entries(ALLOWLIST)) {
  const count = exempt.filter((p) => p.id === id).length;
  console.log(`- ${id} (${count} themes): ${reason}`);
}

if (values.json) writeFileSync(values.json, JSON.stringify(reports, null, 2));

const failing = reports.flatMap((r) =>
  [...r.pairs, ...r.hues].filter((p) => p.status === 'fail').map((p) => `${r.theme}: ${p.id}`),
);
console.log(
  `\n${reports.length} themes, ${PAIRS.length + HUE_PAIRS.length} checks each, ${failing.length} failing.`,
);
if (failing.length > 0) process.exitCode = 1;
