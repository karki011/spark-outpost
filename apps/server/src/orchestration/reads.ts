import type { ProviderOutput } from '../providers/provider.ts';

const READ_TITLE = /^(?:Read|View|Open)\b/i;
const READ_COMMAND = /^(?:Run\s+)?`?(?:cat|head|tail|less|nl|bat|sed\s+-n)\s/;

export interface Counted {
  value: number;
  tools: string[];
  reads: string[];
}

export function counted(): Counted {
  return { value: 0, tools: [], reads: [] };
}

export function isFileRead(name: string, toolKind: string | undefined): boolean {
  if (toolKind === 'read') return true;
  if (toolKind && toolKind !== 'execute' && toolKind !== 'other') return false;
  return READ_TITLE.test(name) || READ_COMMAND.test(name);
}

export function readTarget(name: string): string {
  const quoted = /`([^`]+)`/.exec(name)?.[1];
  const target = quoted ?? name.replace(READ_TITLE, '').trim();
  return target.split(/\s+/).at(-1)?.split('/').at(-1) ?? target;
}

export function countOutput(total: Counted, output: ProviderOutput): boolean {
  if (output.kind !== 'step_started' || !output.tool) return false;
  total.value += 1;
  total.tools.push(output.name);
  if (isFileRead(output.name, output.toolKind)) total.reads.push(readTarget(output.name));
  return true;
}
