const FILLER = new Set(['um', 'uh', 'erm', 'hmm', 'please', 'hey', 'ok', 'okay', 'so', 'like']);

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const LETTER_SOUNDS: Record<string, string> = {
  bee: 'b',
  see: 'c',
  sea: 'c',
  cee: 'c',
  dee: 'd',
  ee: 'e',
  eff: 'f',
  gee: 'g',
  aitch: 'h',
  jay: 'j',
  kay: 'k',
  el: 'l',
  ell: 'l',
  em: 'm',
  en: 'n',
  pee: 'p',
  queue: 'q',
  cue: 'q',
  ar: 'r',
  ess: 's',
  tee: 't',
  tea: 't',
  vee: 'v',
  ex: 'x',
  wye: 'y',
  zed: 'z',
  zee: 'z',
};

const TICKET_KEY = /^([a-z]{1,10})-?(\d{1,7})$/;

function unitOf(token: string): string | null {
  if (/^[a-z0-9]$/.test(token)) return token;
  return DIGIT_WORDS[token] ?? LETTER_SOUNDS[token] ?? (token === 'oh' ? 'oh' : null);
}

function resolveOh(units: string[]): string[] {
  return units.map((unit, index) => {
    if (unit !== 'oh') return unit;
    const nearDigit = /\d/.test(units[index - 1] ?? '') || /\d/.test(units[index + 1] ?? '');
    return nearDigit ? '0' : 'o';
  });
}

function spelledKey(units: string[]): boolean {
  return (
    units.length >= 2 &&
    units.some((unit) => /[a-z]/.test(unit)) &&
    units.some((unit) => /\d/.test(unit))
  );
}

function joinSpelled(list: string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    const units = resolveOh(run.map((token) => unitOf(token)!));
    if (spelledKey(units)) out.push(units.join(''));
    else out.push(...run);
    run = [];
  };
  for (const token of list) {
    if (unitOf(token) !== null) {
      run.push(token);
      continue;
    }
    flush();
    out.push(token);
  }
  flush();
  return out;
}

function joinKeyParts(tokens: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];
    if (/^[a-z]{1,10}$/.test(token) && next && /^\d{1,7}$/.test(next) && token.length <= 4) {
      out.push(`${token}${next}`);
      index += 1;
    } else {
      out.push(token);
    }
  }
  return out;
}

export function tokens(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/([a-z]+)-(\d+)/g, '$1$2')
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !FILLER.has(token));
  return joinKeyParts(joinSpelled(raw));
}

export function dropWakeWord(list: string[]): string[] {
  if (list[0] === 'spark') return list.slice(1);
  return list;
}

export function ticketKey(heard: string): string | null {
  const compact = tokens(heard).join('');
  const match = TICKET_KEY.exec(compact);
  if (!match) return null;
  return `${match[1]!.toUpperCase()}-${match[2]}`;
}

export function keyForm(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}
