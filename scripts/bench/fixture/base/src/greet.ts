import { titleCase } from './invoice.ts';

export function greeting(name: string): string {
  return `Welcom back, ${titleCase(name)}!`;
}
