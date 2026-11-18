export const CODE_LENGTH = 6;

export function normalizeCode(raw: string): string {
  return raw.replace(/[^0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isFullCode(code: string): boolean {
  return code.length === CODE_LENGTH;
}

export function retrySeconds(retryAt: number | null, now: number): number {
  if (retryAt === null) return 0;
  return Math.max(0, Math.ceil((retryAt - now) / 1000));
}

export function codeChangeProblem(next: string, again: string): string | null {
  if (!isFullCode(next)) return `Enter all ${CODE_LENGTH} digits.`;
  if (next !== again) return 'The codes don’t match.';
  return null;
}
