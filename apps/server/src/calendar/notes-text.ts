export interface SplitNotes {
  agenda: string;
  conference: string;
}

const GOOGLE_FENCE = /^\s*-::~[:~]*::-\s*$/;
const UNDERSCORE_FENCE = /^\s*_{20,}\s*$/;
const WEBEX_START = /^\s*-+\s*Do not delete or change any of the following text\.?\s*-+\s*$/i;

const BLOCK_START: readonly RegExp[] = [
  /is inviting you to a scheduled Zoom meeting/i,
  /^Join Zoom Meeting\b/i,
  /^Join with Google Meet\b/i,
  /^Microsoft Teams (meeting|Need help\?)/i,
  /^(Meeting|Webinar) ID\s*:\s*[\d ]{9,15}\s*$/i,
];

const BLOCK_LINE: readonly RegExp[] = [
  ...BLOCK_START,
  /https:\/\/[^\s]*(zoom\.us|zoomgov\.com|meet\.google\.com|tel\.meet|teams\.microsoft\.com|webex\.com|safelinks\.protection\.outlook\.com)/i,
  /^(Meeting|Webinar) ID\s*:/i,
  /^(Passcode|Password|Meeting password|Meeting number|Phone Conference ID|PIN)\b.*:/i,
  /^(Topic|Time)\s*:/i,
  /^One tap mobile\b/i,
  /^Dial by your location\b/i,
  /^Find your local number\b/i,
  /^Join by (SIP|H\.323|Skype|phone|video system)\b/i,
  /^Join instructions\b/i,
  /^Or dial\s*:/i,
  /^More phone numbers\b/i,
  /^Learn more about Meet\b/i,
  /^Please do not edit this section\.?$/i,
  /^Join on your computer/i,
  /^Click here to join the meeting/i,
  /^(Download Teams|Join on the web|Or call in|Find a local number|Learn More|Meeting options)\b/i,
  /^Please download and import the following iCalendar/i,
  /^(Weekly|Daily|Monthly|Every (day|week|month))\b.*\d/i,
  /\.ics\b/i,
  /^-{3,}$/,
  /^[•·]\s*\S/,
  /^\+?[\d][\d\s,#*().-]{5,}(\s+\S.*)?$/,
  /^\d{1,3}(\.\d{1,3}){3}\b/,
  /^\S+@(zoomcrc\.com|lync\.zoom\.us)\b/i,
];

const blank = (line: string) => line.trim() === '';
const startsBlock = (line: string) => BLOCK_START.some((rule) => rule.test(line.trim()));
const inBlock = (line: string) => BLOCK_LINE.some((rule) => rule.test(line.trim()));

function fenced(lines: readonly string[], fence: RegExp, needs?: RegExp): Set<number> {
  const hidden = new Set<number>();
  const fences = lines.flatMap((line, index) => (fence.test(line) ? [index] : []));
  for (let pair = 0; pair + 1 < fences.length; pair += 2) {
    const from = fences[pair]!;
    const to = fences[pair + 1]!;
    const inside = lines.slice(from + 1, to).join('\n');
    if (needs && !needs.test(inside)) continue;
    for (let index = from; index <= to; index += 1) hidden.add(index);
  }
  if (!needs && fences.length % 2 === 1) hidden.add(fences.at(-1)!);
  return hidden;
}

function runs(lines: readonly string[], hidden: Set<number>): void {
  let index = 0;
  while (index < lines.length) {
    if (hidden.has(index) || !startsBlock(lines[index]!)) {
      index += 1;
      continue;
    }
    let end = index;
    for (let next = index; next < lines.length; next += 1) {
      const line = lines[next]!;
      if (hidden.has(next)) break;
      if (blank(line)) continue;
      if (!inBlock(line)) break;
      end = next;
    }
    for (let at = index; at <= end; at += 1) hidden.add(at);
    index = end + 1;
  }
}

function webexTail(lines: readonly string[], hidden: Set<number>): void {
  const start = lines.findIndex((line) => WEBEX_START.test(line));
  if (start === -1) return;
  for (let index = start; index < lines.length; index += 1) hidden.add(index);
}

function tidy(lines: readonly string[]): string {
  return lines
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitNotes(notes: string): SplitNotes {
  const lines = notes.split(/\r?\n/);
  const hidden = fenced(lines, GOOGLE_FENCE);
  for (const index of fenced(lines, UNDERSCORE_FENCE, /Microsoft Teams|teams\.microsoft/i)) {
    hidden.add(index);
  }
  webexTail(lines, hidden);
  runs(lines, hidden);
  const fence = (line: string) =>
    GOOGLE_FENCE.test(line) || UNDERSCORE_FENCE.test(line) || WEBEX_START.test(line);
  return {
    agenda: tidy(lines.filter((_, index) => !hidden.has(index))),
    conference: tidy(lines.filter((line, index) => hidden.has(index) && !fence(line))),
  };
}
