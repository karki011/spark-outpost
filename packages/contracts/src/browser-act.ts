import { z } from 'zod';

export const BROWSER_ACT_TEXT_MAX = 2000;
export const BROWSER_ACT_LINE_MAX = 200;
export const BROWSER_ACT_NAME_MAX = 120;

export const browserActKindSchema = z.enum([
  'click',
  'type',
  'key',
  'scroll',
  'back',
  'forward',
  'reload',
]);
export type BrowserActKind = z.infer<typeof browserActKindSchema>;

export const browserActKeySchema = z.enum([
  'Enter',
  'Tab',
  'Escape',
  'Space',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);
export type BrowserActKey = z.infer<typeof browserActKeySchema>;

export const browserActDirectionSchema = z.enum(['up', 'down', 'left', 'right']);
export type BrowserActDirection = z.infer<typeof browserActDirectionSchema>;

export const browserActTargetSchema = z.object({
  role: z.string().max(80),
  name: z.string().max(BROWSER_ACT_NAME_MAX),
  sensitive: z.boolean(),
});
export type BrowserActTarget = z.infer<typeof browserActTargetSchema>;

export interface BrowserActInput {
  action: BrowserActKind;
  ref?: string | undefined;
  text?: string | undefined;
  key?: BrowserActKey | undefined;
  direction?: BrowserActDirection | undefined;
}

const NEEDS_REF: ReadonlySet<BrowserActKind> = new Set(['click', 'type']);

export function browserActProblem(input: BrowserActInput): string | null {
  if (NEEDS_REF.has(input.action) && !input.ref) {
    return `${input.action} needs ref, a ref_N from spark_browser_read.`;
  }
  if (input.action === 'type' && input.text === undefined) return 'type needs text.';
  if (input.action === 'key' && !input.key) return 'key needs key, for example Enter.';
  return null;
}

export function browserActSends(action: BrowserActKind): boolean {
  return action === 'type';
}

function named(target: BrowserActTarget | null): string {
  if (!target) return 'the page';
  const name = target.name.replace(/\s+/g, ' ').trim();
  return name ? `${target.role} "${name}"` : target.role;
}

export interface BrowserActDone {
  action: BrowserActKind;
  target: BrowserActTarget | null;
  key?: BrowserActKey | undefined;
  direction?: BrowserActDirection | undefined;
}

export function browserActLine(done: BrowserActDone): string {
  const line = ((): string => {
    switch (done.action) {
      case 'click':
        return `Clicked ${named(done.target)}`;
      case 'type':
        return `Typed in ${named(done.target)}`;
      case 'key':
        return done.target
          ? `Pressed ${done.key ?? 'a key'} in ${named(done.target)}`
          : `Pressed ${done.key ?? 'a key'}`;
      case 'scroll':
        return `Scrolled ${done.direction ?? 'down'}`;
      case 'back':
        return 'Went back';
      case 'forward':
        return 'Went forward';
      case 'reload':
        return 'Reloaded the page';
    }
  })();
  return line.slice(0, BROWSER_ACT_LINE_MAX);
}
