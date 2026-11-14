import { describe, expect, it } from 'vitest';
import { sparkDataReadRules } from './spark-data-reads.ts';

const TREE: Record<string, readonly string[]> = {
  '/data': ['runtime', 'logs', 'api-port.json', 'spark'],
  '/data/spark': ['sparks', 'workflows', 'terminal-sessions', 'settings.json'],
};
const list = (dir: string) => TREE[dir] ?? [];
const readable = ['/data/spark/sparks', '/data/spark/workflows'];

describe('sparkDataReadRules', () => {
  it('denies every entry of the data folder except the path to the Sparks and workflows folders', () => {
    expect(sparkDataReadRules('/data', readable, list)).toEqual([
      'Read(//data/runtime)',
      'Read(//data/runtime/**)',
      'Read(//data/logs)',
      'Read(//data/logs/**)',
      'Read(//data/api-port.json)',
      'Read(//data/api-port.json/**)',
      'Read(//data/spark/terminal-sessions)',
      'Read(//data/spark/terminal-sessions/**)',
      'Read(//data/spark/settings.json)',
      'Read(//data/spark/settings.json/**)',
    ]);
  });

  it('denies the whole folder when nothing in it is readable, and nothing without a folder', () => {
    expect(sparkDataReadRules('/data', [], list)).toContain('Read(//data/spark/**)');
    expect(sparkDataReadRules(null, readable, list)).toEqual([]);
  });
});
