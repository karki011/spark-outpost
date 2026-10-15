export const MOD_SEND_MAX = 200;
const MOD_QUEUE_MAX = 5_000;

export function sparkModTelemetryScript(): string {
  return String.raw`
const SEND_MAX = ${MOD_SEND_MAX};
const QUEUE_MAX = ${MOD_QUEUE_MAX};
const KEPT = 256;

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

export function fromEngine(origin) {
  return !origin || origin.plugin === 'engine';
}

export function telemetry() {
  let prompt = null;
  let spent = null;
  const owners = new Map();
  const turns = new Map();
  const queue = [];
  const push = (item) => {
    queue.push(item);
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
  };
  const ownerOf = (agent) => (agent ? (owners.get(agent) ?? null) : prompt);
  return {
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
      push({ kind: 'turn_start', prompt: owner, agent, turn, at });
    },
    stepped(e, usage, costUsd) {
      const turn = label(e.turnId);
      const owner = turn ? turns.get(turn) : null;
      const model = label(usage && usage.model);
      if (!owner || !model || !Number.isSafeInteger(e.index) || e.index < 0) return;
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
    turnEnded(e, at) {
      const turn = label(e.turnId);
      const owner = turn ? turns.get(turn) : null;
      if (!owner) return;
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
    tool(e, phase, failed, at) {
      const agent = label(e.agentId);
      const owner = ownerOf(agent);
      const id = label(e.tool_use_id);
      const name = label(e.tool);
      if (!owner || !id || !name) return;
      push({ kind: 'tool', prompt: owner, agent, id, name, phase, failed, at });
    },
    take() {
      return queue.splice(0, SEND_MAX);
    },
    putBack(items) {
      queue.unshift(...items);
      if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
    },
  };
}
`;
}
