import { OUTPOST_HANDLE_PATTERN, type HandleProblem, type SuggestHandle } from './outposts.ts';

export const RESERVED_HANDLES: readonly string[] = ['all'];

const HANDLE_MIN = 2;
const HANDLE_MAX = 16;
const FALLBACK_HANDLE = 'chat';

function isUnavailable(handle: string, taken: readonly string[]): boolean {
  return RESERVED_HANDLES.includes(handle) || taken.includes(handle);
}

export const handleProblem: HandleProblem = (handle, taken) => {
  if (handle.length === 0) return 'Enter a handle.';
  if (handle.length < HANDLE_MIN) return `A handle needs at least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX) return `A handle can have at most ${HANDLE_MAX} characters.`;
  if (!/^[a-z]/.test(handle)) return 'A handle starts with a lower-case letter.';
  if (!OUTPOST_HANDLE_PATTERN.test(handle)) {
    return 'A handle can use lower-case letters, numbers and hyphens only.';
  }
  if (RESERVED_HANDLES.includes(handle)) return `@${handle} is reserved. Choose another handle.`;
  if (taken.includes(handle)) return `@${handle} is already used in this outpost.`;
  return null;
};

function withoutTrailingHyphens(text: string): string {
  return text.replace(/-+$/, '');
}

function fitted(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const cut = withoutTrailingHyphens(slug.slice(0, max));
  if (slug[max] === '-') return cut;
  const words = withoutTrailingHyphens(slug.slice(0, slug.lastIndexOf('-', max - 1) + 1));
  return words.length >= HANDLE_MIN ? words : cut;
}

function handleBase(name: string): string {
  const slug = withoutTrailingHyphens(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^[^a-z]+/, ''),
  );
  const base = fitted(slug, HANDLE_MAX);
  return base.length >= HANDLE_MIN ? base : FALLBACK_HANDLE;
}

function numbered(base: string, number: number): string {
  const suffix = String(number);
  return `${fitted(base, HANDLE_MAX - suffix.length)}${suffix}`;
}

export const suggestHandle: SuggestHandle = (name, taken) => {
  const base = handleBase(name);
  if (!isUnavailable(base, taken)) return base;
  let number = 2;
  while (isUnavailable(numbered(base, number), taken)) number += 1;
  return numbered(base, number);
};
