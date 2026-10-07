import { describe, expect, it } from 'vitest';
import type { LawFinding } from './finding.ts';
import { distinctFindings, lawItems, lawsNote, outsidePlanFiles } from './review.ts';

const claim = (text: string): LawFinding => ({ law: 'goodhart', kind: 'claim', path: null, text });
const scope = (path: string): LawFinding => ({
  law: 'goodhart',
  kind: 'scope',
  path,
  text: `Changed \`${path}\`, outside the request and plan.`,
});

const session = (findings: LawFinding[]) => ({
  laws: { findings: distinctFindings(findings), removalsBy: 'rules' as const },
});

describe('worth a look', () => {
  it('keeps one copy of a finding repeated across rounds', () => {
    const said = "Bolt said the checks pass, but Spark's own run failed: `pnpm run test` exited 1.";
    const found = distinctFindings([claim(said), claim(`${said} `), claim(said.toUpperCase())]);
    expect(found.map((finding) => finding.text)).toEqual([said]);
  });

  it('keeps findings that differ', () => {
    const found = distinctFindings([claim('Bolt said A.'), claim('Nova said A.')]);
    expect(found).toHaveLength(2);
  });

  it('lists files outside the plan apart from the items', () => {
    const s = session([claim('Bolt said A.'), scope('a.ts'), scope('b.ts')]);
    expect(lawItems(s)).toEqual(['Bolt said A.']);
    expect(outsidePlanFiles(s)).toEqual(['a.ts', 'b.ts']);
  });

  it('writes files outside the plan as one line of the note', () => {
    const s = session([claim('Bolt said A.'), scope('a.ts'), scope('b.ts')]);
    expect(lawsNote(s)).toBe(
      'Worth a look:\n- Bolt said A.\n- 2 files outside the plan: `a.ts`, `b.ts`',
    );
    expect(lawsNote(session([scope('a.ts')]))).toBe(
      'Worth a look:\n- 1 file outside the plan: `a.ts`',
    );
  });

  it('has no note without findings', () => {
    expect(lawsNote(session([]))).toBeNull();
    expect(lawsNote({ laws: null })).toBeNull();
  });
});
