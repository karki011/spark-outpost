import { replace } from './solution-edits.ts';
import type { BenchTaskId } from './tasks.ts';

type Solution = (repo: string) => Promise<void>;

export const LEAN_SOLUTIONS: Record<Extract<BenchTaskId, 'L1' | 'L2'>, Solution> = {
  async L1(repo) {
    await replace(
      repo,
      'src/signup.ts',
      '  email: string;\n}',
      '  email: string;\n  birthDate?: string;\n}',
    );
    await replace(
      repo,
      'src/signup.ts',
      '  const { name, email } = input as Record<string, unknown>;',
      '  const { name, email, birthDate } = input as Record<string, unknown>;',
    );
    await replace(
      repo,
      'src/signup.ts',
      '  return { name: name.trim(), email: email.trim() };',
      [
        '  if (birthDate === undefined) return { name: name.trim(), email: email.trim() };',
        "  const valid = typeof birthDate === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(birthDate);",
        "  if (!valid || Number.isNaN(Date.parse(birthDate))) throw new Error('Date of birth is invalid.');",
        '  return { name: name.trim(), email: email.trim(), birthDate };',
      ].join('\n'),
    );
    await replace(
      repo,
      'src/SignupForm.tsx',
      '      {error &&',
      '      <label htmlFor="signup-birth">Date of birth</label>\n      <input id="signup-birth" name="birthDate" type="date" required />\n      {error &&',
    );
  },
  async L2(repo) {
    await replace(
      repo,
      'src/rates.ts',
      'export async function fetchRates(fetcher: Fetcher, base: string): Promise<Rates> {',
      'const cache = new Map<string, Rates>();\n\nexport async function fetchRates(fetcher: Fetcher, base: string): Promise<Rates> {\n  const cached = cache.get(base);\n  if (cached) return cached;',
    );
    await replace(
      repo,
      'src/rates.ts',
      '  return (await response.json()) as Rates;',
      '  const rates = (await response.json()) as Rates;\n  cache.set(base, rates);\n  return rates;',
    );
  },
};
