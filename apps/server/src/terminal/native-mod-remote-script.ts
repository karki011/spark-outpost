export function sparkModRemoteScript(): string {
  return String.raw`
import { stable, toolArguments } from './telemetry.js';

const KEPT = 256;
const LATE_MS = 60_000;
const ONE_SHOT = /^(\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) \*$/;

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function text(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2000 ? value : null;
}

export function readInbox(body) {
  const inbox = JSON.parse(body);
  if (!inbox || typeof inbox !== 'object')
    return { messages: [], notices: [], status: null, record: null, abort: null, askNotice: null };
  return {
    messages: strings(inbox.messages),
    notices: strings(inbox.notices),
    status: typeof inbox.status === 'string' ? inbox.status : null,
    record: typeof inbox.record === 'boolean' ? inbox.record : null,
    abort: text(inbox.abort),
    askNotice: text(inbox.askNotice),
  };
}

export function wakesAt(crons, now) {
  let soonest = null;
  for (const cron of Array.isArray(crons) ? crons : []) {
    const schedule = cron && cron.recurring === false ? text(cron.schedule) : null;
    const fields = schedule ? ONE_SHOT.exec(schedule.trim()) : null;
    if (!fields) continue;
    const [minute, hour, day, month] = fields.slice(1).map(Number);
    const year = new Date(now).getFullYear();
    let at = new Date(year, month - 1, day, hour, minute).getTime();
    if (at < now - LATE_MS) at = new Date(year + 1, month - 1, day, hour, minute).getTime();
    if (Number.isFinite(at) && (soonest === null || at < soonest)) soonest = at;
  }
  return soonest;
}

export function statusLine(queued, wakes) {
  const parts = [];
  if (queued === 1) parts.push('1 message from Spark queued');
  if (queued > 1) parts.push(queued + ' messages from Spark queued');
  if (wakes !== null)
    parts.push(
      'sleeping until ' +
        new Date(wakes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    );
  return parts.length ? 'Spark · ' + parts.join(' · ') : undefined;
}

function callKey(name, input) {
  return String(name) + ' ' + stable(input ?? {});
}

export function control() {
  let prompt = null;
  let main = null;
  let queued = 0;
  let wakes = null;
  let shown;
  let askNotice = null;
  const calls = new Map();
  return {
    prompted(id) {
      prompt = text(id);
    },
    turnStarted(e) {
      if (e.agentId || !text(e.turnId)) return;
      main = { turnId: e.turnId, prompt };
      wakes = null;
    },
    turnEnded(e) {
      if (!e.agentId && main && main.turnId === e.turnId) main = null;
    },
    stopped(e, now) {
      wakes = wakesAt(e && e.session_crons, now);
    },
    opened(e) {
      const id = text(e.tool_use_id);
      if (!id) return;
      calls.set(id, callKey(e.tool, toolArguments(e)));
      if (calls.size > KEPT) calls.delete(calls.keys().next().value);
    },
    closed(e) {
      calls.delete(e.tool_use_id);
    },
    asking(name, input) {
      const key = callKey(name, input);
      let found = null;
      for (const [id, open] of calls) if (open === key) found = id;
      return found;
    },
    told(inbox) {
      askNotice = inbox.askNotice;
    },
    askNotice: () => askNotice,
    queuing(change) {
      queued = Math.max(0, queued + change);
    },
    abortable(wanted) {
      return main && main.prompt === wanted ? main.turnId : null;
    },
    statusChange() {
      const next = statusLine(queued, wakes);
      if (next === shown) return null;
      shown = next;
      return { text: next };
    },
  };
}
`;
}
