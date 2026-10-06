import { describe, expect, it } from 'vitest';
import { resolveVariables } from './shell-variables.ts';

const WT = '/repo/.spark/worktrees/01a10e7d';

describe('resolveVariables', () => {
  it.each([
    [`R=${WT}; cd $R; sed -n 20,60p apps/a.ts`, `R=${WT}; cd ${WT}; sed -n 20,60p apps/a.ts`],
    [`R="${WT}"; cd "$R/libs" && ls`, `R="${WT}"; cd "${WT}/libs" && ls`],
    [`R='${WT}'\ncd \${R}\nrm -rf \${R}/dist`, `R='${WT}'\ncd ${WT}\nrm -rf ${WT}/dist`],
    [`export R=${WT}; rm -rf $R/dist`, `export R=${WT}; rm -rf ${WT}/dist`],
    [`R=${WT} && P=a.ts && rm "$R/$P"`, `R=${WT} && P=a.ts && rm "${WT}/a.ts"`],
    [`R=${WT}; P=$R/libs/a.ts; cat "$P"`, `R=${WT}; P=${WT}/libs/a.ts; cat "${WT}/libs/a.ts"`],
    [`R=${WT}; echo '$R' "\\$R" $R`, `R=${WT}; echo '$R' "\\$R" ${WT}`],
    [`R=${WT}; cat $R_old $R`, `R=${WT}; cat $R_old ${WT}`],
  ])('resolves %s', (command, resolved) => {
    expect(resolveVariables(command)).toBe(resolved);
  });

  it.each([
    'R=$(pwd)/..; rm -rf $R/x',
    'R=`pwd`; rm -rf $R/x',
    'R=$((1+1)); rm -rf $R',
    'R=$OTHER/x; rm -rf $R',
    'R=$1; rm -rf $R',
    `R=${WT}; R=$OTHER; rm $R/x`,
    `R=${WT}; R=/etc; rm $R/x`,
    `R=/etc; false && R=${WT}; rm -rf $R/x`,
    `R=/etc; true || R=${WT}; rm -rf $R/x`,
    `rm -rf $R/x; R=${WT}`,
    `R=${WT} true; rm -rf $R/x`,
    `(R=${WT}); rm -rf $R/x`,
    `if true; then R=${WT}; fi; rm -rf $R/x`,
    `R=${WT}; read R; rm -rf $R/x`,
    `R=${WT}; unset R; rm -rf $R/x`,
    `R=${WT}; for R in /etc; do rm -rf $R/x; done`,
    `R=${WT}; eval "R=/etc"; rm -rf $R/x`,
    `R=${WT}; source ./env.sh; rm -rf $R/x`,
    `R=${WT}; f() { unset R; }; f; rm -rf $R/x`,
    `R=${WT}; : \${R:=/etc}; rm -rf \${R:-/etc}/x`,
    `R=${WT}; IFS=/; rm -rf $R`,
    `R=${WT} & rm -rf $R/x`,
    `R="${WT} /etc"; rm -rf $R`,
    'R=~/x; rm -rf $R',
    `R='*'; rm -rf $R`,
    `R=${WT}; rm -rf $R:h`,
    `R=${WT}; rm -rf $R[1]`,
    `R=${WT}; rm -rf "$R`,
    `R+=${WT}; rm -rf $R/x`,
    `declare R=${WT}; rm -rf $R/x`,
  ])('leaves %s as written', (command) => {
    expect(resolveVariables(command)).toBe(command);
  });

  it('does not read assignments or uses inside a here-document', () => {
    const command = `R=${WT}; python3 - <<'EOF'\nR=5\nprint("$R don't")\nEOF\ncat $R/a.ts`;
    expect(resolveVariables(command)).toBe(
      `R=${WT}; python3 - <<'EOF'\nR=5\nprint("$R don't")\nEOF\ncat ${WT}/a.ts`,
    );
  });

  it('skips a comment with a stray quote', () => {
    expect(resolveVariables(`R=${WT} # don't\ncat $R/a.ts`)).toBe(
      `R=${WT} # don't\ncat ${WT}/a.ts`,
    );
  });
});
