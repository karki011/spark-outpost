export const MOD_SEND_MAX = 200;
export const MOD_SEND_BYTES = 400_000;
export const MOD_INPUT_CHARS = 20_000;
export const MOD_OUTPUT_CHARS = 16_000;
export const MOD_REPLY_CHARS = 100_000;
const MOD_QUEUE_MAX = 5_000;
const MOD_QUEUE_CHARS = 20_000_000;
const MOD_CLIPPED_FIELD_CHARS = 2_000;

export const MOD_SIDE_INDEX = 1_000_000;

export function sparkModTelemetryScript(): string {
  return String.raw`
const SIDE_INDEX = ${MOD_SIDE_INDEX};
const SEND_MAX = ${MOD_SEND_MAX};
const SEND_BYTES = ${MOD_SEND_BYTES};
const INPUT_CHARS = ${MOD_INPUT_CHARS};
const OUTPUT_CHARS = ${MOD_OUTPUT_CHARS};
const REPLY_CHARS = ${MOD_REPLY_CHARS};
const QUEUE_MAX = ${MOD_QUEUE_MAX};
const QUEUE_CHARS = ${MOD_QUEUE_CHARS};
const CLIPPED_FIELD_CHARS = ${MOD_CLIPPED_FIELD_CHARS};
const KEPT = 256;
const NOT_ARGUMENTS = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']);

export function utf8Bytes(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function sized(item) {
  return { item, size: utf8Bytes(JSON.stringify(item)) + 1 };
}

function label(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function remember(map, key, value) {
  map.set(key, value);
  if (map.size > KEPT) map.delete(map.keys().next().value);
}

function clip(text, max) {
  return typeof text === 'string' ? text.slice(0, max) : '';
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}

export function toolArguments(e) {
  const found = {};
  for (const [key, value] of Object.entries(e)) if (!NOT_ARGUMENTS.has(key)) found[key] = value;
  return found;
}

function boundedInput(input) {
  if (JSON.stringify(input).length <= INPUT_CHARS) return input;
  const clipped = {};
  for (const [key, value] of Object.entries(input))
    clipped[key] = typeof value === 'string' ? value.slice(0, CLIPPED_FIELD_CHARS) : value;
  return JSON.stringify(clipped).length <= INPUT_CHARS ? clipped : null;
}

export function fromEngine(origin) {
  return !origin || origin.plugin === 'engine';
}

export function telemetry() {
  let prompt = null;
  let spent = null;
  let recording = false;
  let working = false;
  let lastMain = null;
  const owners = new Map();
  const turns = new Map();
  const flying = new Map();
  const queue = [];
  let queued = 0;
  const trim = () => {
    while (queue.length > QUEUE_MAX || (queue.length > 1 && queued > QUEUE_CHARS))
      queued -= queue.shift().size;
  };
  const push = (item) => {
    const entry = sized(item);
    queue.push(entry);
    queued += entry.size;
    trim();
  };
  const ownerOf = (agent) => (agent ? (owners.get(agent) ?? null) : prompt);
  return {
    record(on) {
      recording = on === true;
    },
    recording: () => recording,
    prompted(promptId) {
      prompt = label(promptId) ?? prompt;
    },
    cost(usd) {
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return null;
      const before = spent;
      spent = usd;
      if (before === null) return null;
      return Math.round((usd >= before ? usd - before : usd) * 1e6) / 1e6;
    },
    turnStarted(e, at) {
      const agent = label(e.agentId);
      if (agent && !owners.has(agent) && prompt) remember(owners, agent, prompt);
      const owner = ownerOf(agent);
      const turn = label(e.turnId);
      if (!owner || !turn) return;
      remember(turns, turn, owner);
      if (!agent) {
        working = true;
        lastMain = { prompt: owner, turn, model: lastMain ? lastMain.model : null, side: 0 };
      }
      const fact = { kind: 'turn_start', prompt: owner, agent, turn, at };
      push(recording && !agent ? { ...fact, record: true } : fact);
    },
    stepped(e, usage, costUsd) {
      const turn = label(e.turnId);
      const owner = turn ? turns.get(turn) : null;
      const model = label(usage && usage.model);
      if (!owner || !model || !Number.isSafeInteger(e.index) || e.index < 0) return;
      if (lastMain && !label(e.agentId) && lastMain.turn === turn) lastMain.model = model;
      push({
        kind: 'request',
        prompt: owner,
        agent: label(e.agentId),
        turn,
        index: e.index,
        model,
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
        cacheRead: count(usage.cache_read_input_tokens),
        cacheWrite: count(usage.cache_creation_input_tokens),
        costUsd,
      });
    },
    answered(e, text) {
      const turn = label(e.turnId);
      const owner = turn ? turns.get(turn) : null;
      if (!recording || !owner || label(e.agentId) || typeof text !== 'string' || !text) return;
      push({
        kind: 'reply',
        prompt: owner,
        agent: null,
        turn,
        index: e.index,
        text: clip(text, REPLY_CHARS),
      });
    },
    turnEnded(e, at) {
      const turn = label(e.turnId);
      const owner = turn ? turns.get(turn) : null;
      if (!owner) return;
      if (!label(e.agentId)) working = false;
      push({
        kind: 'turn_end',
        prompt: owner,
        agent: label(e.agentId),
        turn,
        at,
        durationMs: count(Math.round(e.durationMs)),
        aborted: e.isAborted === true,
      });
    },
    toolStarted(e, at) {
      const agent = label(e.agentId);
      const owner = ownerOf(agent);
      const id = label(e.tool_use_id);
      const name = label(e.tool);
      if (!owner || !id || !name) return;
      const fact = { kind: 'tool', prompt: owner, agent, id, name, phase: 'start', failed: false, at };
      if (!recording) return push(fact);
      const input = toolArguments(e);
      remember(flying, id, { name, key: stable(input), asked: false });
      push({ ...fact, input: boundedInput(input) });
    },
    asked(name, input) {
      const key = stable(input ?? {});
      for (const call of flying.values())
        if (!call.asked && call.name === name && call.key === key) return void (call.asked = true);
    },
    toolEnded(e, result, at) {
      const agent = label(e.agentId);
      const owner = ownerOf(agent);
      const id = label(e.tool_use_id);
      const name = label(e.tool);
      if (!owner || !id || !name) return;
      const failed = Boolean(result && (result.isError || result.deny));
      const fact = { kind: 'tool', prompt: owner, agent, id, name, phase: 'end', failed, at };
      const call = flying.get(id);
      flying.delete(id);
      if (!recording) return push(fact);
      const text = result && typeof result.text === 'string' ? result.text : result && result.deny;
      push({ ...fact, output: clip(text, OUTPUT_CHARS), asked: call ? call.asked : false });
    },
    stepping(e) {
      const model = label(e.model);
      if (lastMain && !label(e.agentId) && e.turnId === lastMain.turn && model) lastMain.model = model;
    },
    idle: () => !working && lastMain !== null && lastMain.model !== null,
    between(costUsd) {
      if (!lastMain || typeof costUsd !== 'number' || costUsd <= 0) return;
      push({
        kind: 'request',
        prompt: lastMain.prompt,
        agent: null,
        turn: lastMain.turn,
        index: SIDE_INDEX + lastMain.side++,
        model: lastMain.model,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd,
      });
    },
    take(most = SEND_MAX) {
      let chars = 0;
      let taken = 0;
      while (taken < queue.length && taken < most) {
        const size = queue[taken].size;
        if (taken > 0 && chars + size > SEND_BYTES) break;
        chars += size;
        taken += 1;
      }
      queued -= chars;
      return queue.splice(0, taken).map((entry) => entry.item);
    },
    putBack(items) {
      const entries = items.map(sized);
      queue.unshift(...entries);
      for (const entry of entries) queued += entry.size;
      trim();
    },
  };
}
`;
}
