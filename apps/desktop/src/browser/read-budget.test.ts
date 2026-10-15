import { describe, expect, it } from 'vitest';
import type { OutlineRow, RowTier } from './outline.ts';
import { budgetPage } from './read-budget.ts';

function row(depth: number, tier: RowTier, body: string, ref: string | null = null): OutlineRow {
  return { text: `${'  '.repeat(depth)}- ${body}${ref ? ` [${ref}]` : ''}`, depth, tier, ref };
}

function longPage(sections: number): OutlineRow[] {
  const rows = [row(0, 'mark', 'RootWebArea "Docs"', 'ref_1')];
  for (let index = 0; index < sections; index += 1) {
    rows.push(row(1, 'mark', `heading "Section ${index}"`, `ref_h${index}`));
    rows.push(row(1, 'prose', `paragraph`, `ref_p${index}`));
    for (let line = 0; line < 4; line += 1) {
      rows.push(
        row(2, 'prose', `StaticText "Words of section ${index}, line ${line}, ${'x'.repeat(40)}"`),
      );
    }
    rows.push(row(1, 'act', `button "Open ${index}"`, `ref_b${index}`));
  }
  return rows;
}

const LEFT_OUT = /^\s*- \[(\d+) lines? left out: read (ref_\w+|mode text)\]$/;

describe('a read within a size budget', () => {
  it('returns the page as before when it fits', () => {
    const rows = longPage(2);
    const page = budgetPage(rows, 0, 12_000);
    expect(page).toMatchObject({ nextOffset: null, leftOut: 0, total: rows.length });
    expect(page.text).toBe(rows.map((each) => each.text).join('\n'));
  });

  it('keeps every button and heading first and marks the prose it left out', () => {
    const rows = longPage(30);
    const page = budgetPage(rows, 0, 2_000);
    expect(page.text.length).toBeLessThanOrEqual(2_000);
    const lines = page.text.split('\n');
    const end = page.nextOffset ?? rows.length;
    for (const kept of rows.slice(0, end).filter((each) => each.tier !== 'prose')) {
      expect(lines).toContain(kept.text);
    }
    expect(page.leftOut).toBeGreaterThan(0);
    const markers = lines.filter((line) => LEFT_OUT.test(line));
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((line) => /read ref_(p\d+|h\d+|1)\]$/.test(line))).toBe(true);
    const shownActs = lines.filter((line) => line.includes('- button')).length;
    const plainActs = budgetPage(
      rows.map((each) => ({ ...each, tier: 'act' as const })),
      0,
      2_000,
    )
      .text.split('\n')
      .filter((line) => line.includes('- button')).length;
    expect(shownActs).toBeGreaterThan(plainActs);
  });

  it('covers every line exactly once across pages, shown or counted in a gap', () => {
    const rows = longPage(40);
    let offset: number | null = 0;
    let shown = 0;
    let counted = 0;
    let pages = 0;
    while (offset !== null) {
      const page = budgetPage(rows, offset, 1_500);
      for (const line of page.text.split('\n')) {
        const gap = LEFT_OUT.exec(line);
        if (gap) counted += Number(gap[1]);
        else shown += 1;
      }
      expect(page.text.length).toBeLessThanOrEqual(1_500);
      offset = page.nextOffset;
      pages += 1;
    }
    expect(shown + counted).toBe(rows.length);
    expect(pages).toBeGreaterThan(1);
  });

  it('keeps the text right beside a control so a row still says what it is for', () => {
    const rows = [
      row(0, 'mark', 'RootWebArea "Fruit"', 'ref_1'),
      ...Array.from({ length: 60 }, (_, index) => [
        row(1, 'prose', 'listitem', `ref_li${index}`),
        row(2, 'prose', `StaticText "Fruit number ${index}"`),
        row(2, 'act', `button "Delete"`, `ref_d${index}`),
        row(2, 'prose', `StaticText "${'note '.repeat(12)}"`),
        row(1, 'prose', `paragraph "${'filler '.repeat(10)}"`, `ref_x${index}`),
      ]).flat(),
    ];
    const page = budgetPage(rows, 0, 2_500);
    expect(page.text).toContain('StaticText "Fruit number 0"');
    const lines = page.text.split('\n');
    const deletes = lines.filter((line) => line.includes('button "Delete"')).length;
    const labels = lines.filter((line) => line.includes('Fruit number')).length;
    expect(labels).toBe(deletes);
  });
});
