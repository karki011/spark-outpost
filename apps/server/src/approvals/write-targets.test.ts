import { describe, expect, it } from 'vitest';
import { writeTargets } from './write-targets.ts';

const at = (command: string) => writeTargets(command, '/repo', '/home');

describe('writeTargets', () => {
  it('names redirect targets but not descriptor copies or /dev/null', () => {
    expect(at('echo hi > out.txt && cat a >> logs/b.txt 2>&1 >/dev/null')).toEqual([
      '/repo/out.txt',
      '/repo/logs/b.txt',
    ]);
  });

  it('ignores a > inside quotes', () => {
    expect(at(`echo "a > b" 'c>d'`)).toEqual([]);
  });

  it('names files changed in place and by file commands', () => {
    expect(at('sed -i s/a/b/ src/x.ts')).toEqual(['/repo/src/x.ts']);
    expect(at('sed -e s/a/b/ -i src/y.ts')).toEqual(['/repo/src/y.ts']);
    expect(at('sed s/a/b/ src/z.ts')).toEqual([]);
    expect(at('cp a.ts b.ts')).toEqual(['/repo/b.ts']);
    expect(at('mv a.ts b.ts')).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(at('touch n.ts && tee -a t.ts < in.txt')).toEqual(['/repo/n.ts', '/repo/t.ts']);
  });

  it('looks inside shell -c scripts', () => {
    expect(at('bash -c "echo 1 > inner.ts"')).toEqual(['/repo/inner.ts']);
  });

  it('names heredoc files but reads nothing inside the heredoc text', () => {
    const command = [
      "cat > src/budgets.ts <<'EOF'",
      'export const ok = (a: number) => a >= 2 ? a : null;',
      '  | { amount: number } > 0',
      'EOF',
      'cat > test/b.test.ts <<EOF',
      'assert.ok(migrate(db).length >= 2);',
      'EOF',
      'node --test test/b.test.ts',
    ].join('\n');
    expect(at(command)).toEqual(['/repo/src/budgets.ts', '/repo/test/b.test.ts']);
  });

  it('gives up on a heredoc fed to a shell', () => {
    expect(at("bash <<'EOF'\necho x > a.ts\nEOF")).toBeNull();
  });

  it('gives up on words it cannot resolve', () => {
    expect(at('echo x > $OUT')).toBeNull();
    expect(at('bash -c "$(cat script)"')).toBeNull();
  });
});
