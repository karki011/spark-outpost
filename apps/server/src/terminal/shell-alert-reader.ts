const OSC_START = '\x1b]';
const BEL = '\x07';
const ST = '\x1b\\';
const MAX_SEQUENCE = 1024;
const MAX_TEXT = 200;
const CONEMU_COMMAND = /^\d+(?:;|$)/;
const UNSAFE = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

interface KittyPart {
  title: string;
  body: string;
}

function cleanText(text: string): string {
  return text.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
}

export function alertText(title: string, body: string): string | null {
  const shownTitle = cleanText(title);
  const shownBody = cleanText(body);
  const text = shownTitle && shownBody ? `${shownTitle}: ${shownBody}` : shownTitle || shownBody;
  if (!text) return null;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function kittyMeta(meta: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const field of meta.split(':')) {
    const equals = field.indexOf('=');
    if (equals > 0) fields.set(field.slice(0, equals), field.slice(equals + 1));
  }
  return fields;
}

function decodedPayload(payload: string, encoded: boolean): string | null {
  if (!encoded) return payload;
  try {
    return Buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export function shellAlertReader(): (data: string) => string[] {
  let carry = '';
  const kitty = new Map<string, KittyPart>();

  const fromKitty = (rest: string): string | null => {
    const split = rest.indexOf(';');
    if (split < 0) return null;
    const meta = kittyMeta(rest.slice(0, split));
    const purpose = meta.get('p') ?? 'title';
    if (purpose !== 'title' && purpose !== 'body') return null;
    const text = decodedPayload(rest.slice(split + 1), meta.get('e') === '1');
    if (text === null) return null;
    const id = meta.get('i') ?? '';
    const part = kitty.get(id) ?? { title: '', body: '' };
    part[purpose] += text;
    if (meta.get('d') === '0') {
      if (kitty.size < 16 || kitty.has(id)) kitty.set(id, part);
      return null;
    }
    kitty.delete(id);
    return alertText(part.title, part.body);
  };

  const fromSequence = (payload: string): string | null => {
    const split = payload.indexOf(';');
    if (split < 0) return null;
    const code = payload.slice(0, split);
    const rest = payload.slice(split + 1);
    if (code === '9') return CONEMU_COMMAND.test(rest) ? null : alertText('', rest);
    if (code === '777') {
      const [kind, title = '', ...body] = rest.split(';');
      return kind === 'notify' ? alertText(title, body.join(';')) : null;
    }
    if (code === '99') return fromKitty(rest);
    return null;
  };

  return (data) => {
    const text = carry + data;
    carry = '';
    const alerts: string[] = [];
    let from = 0;
    for (;;) {
      const start = text.indexOf(OSC_START, from);
      if (start < 0) {
        if (text.endsWith('\x1b')) carry = '\x1b';
        break;
      }
      const bell = text.indexOf(BEL, start + 2);
      const esc = text.indexOf('\x1b', start + 2);
      const escFirst = esc >= 0 && (bell < 0 || esc < bell);
      const waiting = escFirst ? esc + 1 === text.length : bell < 0;
      if (waiting) {
        if (text.length - start <= MAX_SEQUENCE) carry = text.slice(start);
        break;
      }
      if (escFirst && text[esc + 1] !== '\\') {
        from = esc;
        continue;
      }
      const end = escFirst ? esc : bell;
      if (end - start <= MAX_SEQUENCE) {
        const alert = fromSequence(text.slice(start + 2, end));
        if (alert) alerts.push(alert);
      }
      from = end + (end === bell ? BEL.length : ST.length);
    }
    return alerts;
  };
}
