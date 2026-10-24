import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_SCRIPT,
  adminManagedWrite,
  adminScriptArgs,
  CANCELLED_PROMPT,
  managedWriteFor,
} from './managed-writer.ts';
import { MANAGED_RULES_FILE } from './rules-store.ts';

const TARGET = "/Library/Application Support/Spark's Outpost/managed-settings.json";

describe('the macOS admin prompt for the company file', () => {
  it('passes the paths as arguments, never inside the script', () => {
    const args = adminScriptArgs('/tmp/x/managed-settings.json', TARGET);
    const script = args.filter((_, index) => args[index - 1] === '-e').join('\n');
    expect(script).toBe(ADMIN_SCRIPT.join('\n'));
    expect(script).not.toContain("Spark's Outpost");
    expect(script).toContain('with administrator privileges');
    expect(script).toContain('quoted form of target');
    const rest = args.slice(ADMIN_SCRIPT.length * 2);
    expect(rest.slice(0, 2)).toEqual(['/tmp/x/managed-settings.json', TARGET]);
    expect(rest[2]).toMatch(
      /^\/Library\/Application Support\/Spark's Outpost\/\.managed-settings\./,
    );
    expect(rest[3]).toBe("/Library/Application Support/Spark's Outpost");
  });

  it.runIf(process.platform === 'darwin')(
    'hands the new text to the prompt in a temp file',
    async () => {
      let staged = '';
      const write = adminManagedWrite(async (args) => {
        const source = args[ADMIN_SCRIPT.length * 2]!;
        staged = await readFile(source, 'utf8');
      });
      await write(TARGET, '{"permissions":{}}\n');
      expect(staged).toBe('{"permissions":{}}\n');
    },
  );

  it.runIf(process.platform === 'darwin')(
    'says nothing changed when the user cancels',
    async () => {
      const write = adminManagedWrite(() =>
        Promise.reject(new Error('execution error: User canceled. (-128)')),
      );
      await expect(write(TARGET, '{}')).rejects.toThrow(CANCELLED_PROMPT);
    },
  );

  it('uses the admin prompt only for the real company file', () => {
    expect(managedWriteFor('/tmp/elsewhere.json').name).toBe('plainWrite');
    expect(managedWriteFor(MANAGED_RULES_FILE).name).not.toBe('plainWrite');
  });
});
