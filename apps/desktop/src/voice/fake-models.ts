import { createHash } from 'node:crypto';
import { VOICE_MODELS, type VoiceModel } from '@spark-outpost/contracts';
import type { FetchModel } from './model.ts';

const CHUNKS = 20;

function bodyFor(model: VoiceModel): Buffer {
  return Buffer.from(`fake ${model.id} weights `.repeat(CHUNKS * 64));
}

export function fakeVoiceModels(chunkMs = 100): { models: VoiceModel[]; fetch: FetchModel } {
  const bodies = new Map(VOICE_MODELS.map((model) => [model.url, bodyFor(model)]));
  const models = VOICE_MODELS.map((model) => {
    const body = bodies.get(model.url)!;
    return {
      ...model,
      size: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  });
  const fetch: FetchModel = async (url, { signal }) => {
    const body = bodies.get(url);
    if (!body) return new Response('not found', { status: 404 });
    const step = Math.ceil(body.length / CHUNKS);
    let sent = 0;
    let timer: NodeJS.Timeout | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => {
          if (signal.aborted) {
            clearInterval(timer);
            controller.error(signal.reason);
            return;
          }
          controller.enqueue(body.subarray(sent, sent + step));
          sent += step;
          if (sent >= body.length) {
            clearInterval(timer);
            controller.close();
          }
        }, chunkMs);
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(stream);
  };
  return { models, fetch };
}
