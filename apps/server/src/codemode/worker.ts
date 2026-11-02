import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten';
import {
  boundedJson,
  CPU_SLICE_MS,
  ERROR_CHARS,
  JSON_BYTES,
  MAX_PENDING,
  type ExecutionResult,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol.ts';

const port = parentPort!;
const { code } = workerData as { code: string };
const engine = await getQuickJS();
const runtime = engine.newRuntime();
runtime.setMemoryLimit(64 * 1024 * 1024);
runtime.setMaxStackSize(512 * 1024);
let deadline = performance.now() + CPU_SLICE_MS;
let interrupted = false;
runtime.setInterruptHandler(() => {
  interrupted ||= performance.now() > deadline;
  return interrupted;
});
const vm = runtime.newContext();
const pending = new Map<number, QuickJSDeferredPromise>();
let nextId = 0;
let resultHandle: QuickJSHandle | undefined;
let finished = false;
let resourceFailure: string | undefined;

function send(message: WorkerResponse) {
  port.postMessage(message);
}

function finish(result: ExecutionResult) {
  if (finished) return;
  finished = true;
  for (const deferred of pending.values()) deferred.dispose();
  pending.clear();
  resultHandle?.dispose();
  vm.dispose();
  runtime.dispose();
  send({ type: 'result', result });
  port.close();
}

function failure(message: string) {
  finish({ error: interrupted ? 'Script exceeded the continuous CPU limit.' : message });
}

const call = vm.newFunction('call', (nameHandle, jsonHandle) => {
  if (pending.size >= MAX_PENDING) {
    resourceFailure = 'Too many simultaneous tool calls. Completed calls are not rolled back.';
    throw new Error(resourceFailure);
  }
  if (
    !nameHandle ||
    !jsonHandle ||
    vm.typeof(nameHandle) !== 'string' ||
    vm.typeof(jsonHandle) !== 'string'
  ) {
    throw new Error('tools.call requires a name and JSON arguments.');
  }
  const name = vm.getString(nameHandle);
  const json = vm.getString(jsonHandle);
  if (name.length > 200 || Buffer.byteLength(json) > JSON_BYTES) {
    throw new Error('Tool call arguments are too large.');
  }
  boundedJson(JSON.parse(json) as unknown);
  const deferred = vm.newPromise();
  const id = ++nextId;
  pending.set(id, deferred);
  send({ type: 'call', id, name, json });
  return deferred.handle.dup();
});

function pump() {
  while (runtime.hasPendingJob()) {
    const job = runtime.executePendingJobs(1);
    if (job.error) {
      job.error.dispose();
      failure('Script job failed.');
      return;
    }
    if (performance.now() > deadline) {
      interrupted = true;
      failure('Script exceeded the continuous CPU limit.');
      return;
    }
  }
  const state = vm.getPromiseState(resultHandle!);
  if (state.type === 'pending') {
    if (pending.size === 0) failure('Script is waiting on a promise that cannot complete.');
    return;
  }
  if (state.type === 'rejected') {
    state.error.dispose();
    failure('Script failed or returned a value that cannot be serialized as JSON.');
    return;
  }
  const json = vm.getString(state.value);
  state.value.dispose();
  if (interrupted) {
    failure('Script exceeded the continuous CPU limit.');
  } else if (resourceFailure) {
    failure(resourceFailure);
  } else if (pending.size > 0) {
    failure('Script returned with unfinished tool calls. Completed calls are not rolled back.');
  } else if (Buffer.byteLength(json) > JSON_BYTES) {
    failure('Script result is too large.');
  } else {
    try {
      const result: unknown = JSON.parse(json);
      if (
        result === null ||
        typeof result !== 'object' ||
        Array.isArray(result) ||
        Object.keys(result).some((key) => key !== 'value' && key !== 'error') ||
        ('error' in result && (typeof result.error !== 'string' || 'value' in result))
      ) {
        failure('Script returned an invalid result envelope.');
        return;
      }
      boundedJson(result);
      finish('error' in result ? { error: String(result.error).slice(0, ERROR_CHARS) } : result);
    } catch (error) {
      failure(
        error instanceof Error
          ? error.message.slice(0, ERROR_CHARS)
          : 'Script returned invalid JSON.',
      );
    }
  }
}

port.on('message', (reply: WorkerRequest) => {
  if (finished) return;
  const deferred = pending.get(reply.id);
  if (!deferred) return;
  deadline = performance.now() + CPU_SLICE_MS;
  const value = vm.newString(reply.error ?? reply.json ?? 'null');
  if (reply.error !== undefined) deferred.reject(value);
  else deferred.resolve(value);
  value.dispose();
  deferred.dispose();
  pending.delete(reply.id);
  pump();
});

const wrapper = vm.evalCode(`(hostCall => {
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const envelope = (key, value) => stringify({ __proto__: null, [key]: value });
  const tools = Object.freeze({ call: async (name, args = {}) => parse(await hostCall(name, stringify(args))) });
  return (async () => {\n${code}\n})().then(
    value => envelope('value', value),
    error => envelope('error', String(error).slice(0, ${ERROR_CHARS}))
  );
})`);
if (wrapper.error) {
  wrapper.error.dispose();
  call.dispose();
  failure('Script could not be compiled.');
} else {
  const result = vm.callFunction(wrapper.value, vm.undefined, call);
  wrapper.value.dispose();
  call.dispose();
  if (result.error) {
    result.error.dispose();
    failure('Script could not be started.');
  } else {
    resultHandle = result.value;
    pump();
  }
}
