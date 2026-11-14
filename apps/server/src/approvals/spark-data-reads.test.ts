import { describe, expect, it } from 'vitest';
import { sparkDataReadRules } from './spark-data-reads.ts';

const TREE: Record<string, readonly string[]> = {
  '/data': ['api-port.json', 'spark'],
  '/data/spark': ['sparks', 'workflows', 'voice-cache'],
};
const list = (dir: string) => TREE[dir] ?? [];
const nothing = () => [];
const readable = ['/data/spark/sparks', '/data/spark/workflows'];
const denied = (rules: readonly string[]) =>
  rules.filter((rule) => !rule.endsWith('/**)')).map((rule) => rule.slice('Read(/'.length, -1));

describe('sparkDataReadRules', () => {
  it('denies every entry it finds except the path to the Sparks and workflows folders', () => {
    const rules = sparkDataReadRules('/data', readable, list, 'spark');
    expect(denied(rules)).toEqual(
      expect.arrayContaining(['/data/api-port.json', '/data/spark/voice-cache']),
    );
    expect(rules).toContain('Read(//data/spark/voice-cache/**)');
    expect(denied(rules).some((entry) => /sparks|workflows/.test(entry))).toBe(false);
  });

  it('denies the paths Spark creates by name, before they exist', () => {
    expect(denied(sparkDataReadRules('/data', readable, nothing, 'spark'))).toEqual([
      '/data/runtime',
      '/data/logs',
      '/data/spark/chats',
      '/data/spark/terminal-sessions',
      '/data/spark/terminal-workspaces',
      '/data/spark/tmux*',
      '/data/spark/settings.json',
      '/data/spark/.settings-accepted.json',
    ]);
  });

  it('denies the whole channel when the crew folders live elsewhere, and nothing without a folder', () => {
    const rules = sparkDataReadRules('/data', ['/elsewhere/sparks'], nothing, 'spark');
    expect(rules).toContain('Read(//data/spark/**)');
    expect(sparkDataReadRules(null, readable, list, 'spark')).toEqual([]);
  });
});
