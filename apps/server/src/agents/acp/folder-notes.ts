import { basename } from 'node:path';
import type { AgentDefinition } from './agents.ts';

export function primaryOnlyNote(definition: AgentDefinition, primary: string): string {
  return `${definition.name} changes only ${basename(primary)} in Do; the other linked repos aren't opened`;
}

export function noFolderAccessNote(definition: AgentDefinition): string {
  return `${definition.name} can't browse project folders; attach files with @ instead`;
}
