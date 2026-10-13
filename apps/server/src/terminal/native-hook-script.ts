export function nativeHookScript(): string {
  return String.raw`
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
async function bridgeMain() {
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 1_048_576) return;
      chunks.push(chunk);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const payload = {};
    const fields = {
      hook_event_name: 100,
      session_id: 200,
      turn_id: 200,
      prompt_id: 200,
      permission_mode: 100,
      tool_name: 200,
      notification_type: 100,
      reason: 100,
      transcript_path: 4096,
    };
    if (raw.hook_event_name === 'UserPromptSubmit') fields.prompt = 100_000;
    for (const [field, max] of Object.entries(fields)) {
      if (raw[field] === undefined) continue;
      if (typeof raw[field] !== 'string' || raw[field].length > max) return;
      payload[field] = raw[field];
    }
    for (const field of ['tool_use_id', 'agent_id', 'model']) {
      if (typeof raw[field] === 'string' && raw[field].length <= 200) payload[field] = raw[field];
    }
    const body = JSON.stringify({
        sessionId: config.sessionId,
        provider: config.provider,
        eventId: randomUUID(),
        payload,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
          body,
          signal: AbortSignal.timeout(1000),
        });
        if (response.status < 500) return;
      } catch {
        if (attempt === 1) return;
      }
    }
  } catch {
    return;
  }
}
await bridgeMain();
`;
}
