import { Worker } from 'node:worker_threads';
import {
  boundedJson,
  CODE_BYTES,
  ERROR_CHARS,
  type ExecutionResult,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.ts';

interface ExecuteOptions {
  code: string;
  signal?: AbortSignal;
  invoke(name: string, args: unknown, signal: AbortSignal): Promise<unknown>;
}

export function executeCode({ code, signal, invoke }: ExecuteOptions): Promise<ExecutionResult> {
  if (signal?.aborted) return Promise.resolve({ error: 'Code execution cancelled.' });
  if (Buffer.byteLength(code) > CODE_BYTES) {
    return Promise.resolve({ error: 'Script is too large.' });
  }
  return new Promise((resolve) => {
    const controller = new AbortController();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { code },
      execArgv: [],
    });
    let settled = false;
    const finish = (result: ExecutionResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      controller.abort();
      worker.removeAllListeners('message');
      void worker.terminate().finally(() => resolve(result));
    };
    const cancel = () => finish({ error: 'Code execution cancelled.' });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    worker.on('error', () => finish({ error: 'Code execution worker failed.' }));
    worker.on('exit', () => finish({ error: 'Code execution worker exited unexpectedly.' }));
    worker.on('message', (message: WorkerResponse) => {
      if (settled) return;
      if (message.type === 'result') {
        finish(message.result);
        return;
      }
      const respond = (reply: WorkerRequest) => {
        if (!settled) worker.postMessage(reply);
      };
      void Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted();
          return invoke(message.name, JSON.parse(message.json) as unknown, controller.signal);
        })
        .then((value) => {
          if (!settled) respond({ type: 'reply', id: message.id, json: boundedJson(value) });
        })
        .catch((error: unknown) =>
          respond({
            type: 'reply',
            id: message.id,
            error:
              error instanceof Error ? error.message.slice(0, ERROR_CHARS) : 'Tool call failed.',
          }),
        );
    });
  });
}
