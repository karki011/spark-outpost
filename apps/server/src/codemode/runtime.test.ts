import { describe, expect, it, vi } from 'vitest';
import { executeCode } from './runtime.ts';
import { CODE_BYTES, JSON_BYTES, MAX_PENDING } from './protocol.ts';

const unused = async () => null;

describe('isolated Code Mode', () => {
  it('runs async JavaScript with no host globals or module access', async () => {
    expect(
      await executeCode({
        code: 'return [typeof process, typeof require, typeof fetch, typeof WebSocket];',
        invoke: unused,
      }),
    ).toEqual({ value: ['undefined', 'undefined', 'undefined', 'undefined'] });
    expect(
      await executeCode({ code: 'return await import("node:fs");', invoke: unused }),
    ).toHaveProperty('error');
    expect(await executeCode({ code: 'return 2 + 3;', invoke: unused })).toEqual({ value: 5 });
  });

  it('keeps the result envelope intact when guest prototypes change', async () => {
    const poison = 'Object.prototype.toJSON = function() { return {poison:true}; };';
    expect(await executeCode({ code: `${poison} return {ok:true};`, invoke: unused })).toEqual({
      value: { poison: true },
    });
    expect(
      await executeCode({ code: `${poison} throw new Error("failed");`, invoke: unused }),
    ).toEqual({ error: 'Error: failed' });
    expect(await executeCode({ code: 'return {ok:true};', invoke: unused })).toEqual({
      value: { ok: true },
    });
  });

  it('pumps concurrent promises and returns structured tool results', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invoke = vi.fn(async (name: string, args: unknown) => {
      if (name === 'first') await gate;
      else release();
      return { name, args };
    });
    const result = await executeCode({
      code: 'return await Promise.all([tools.call("first", {n:1}), tools.call("second", {n:2})]);',
      invoke,
    });
    expect(result).toEqual({
      value: [
        { name: 'first', args: { n: 1 } },
        { name: 'second', args: { n: 2 } },
      ],
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('allows tool failure recovery and rejects unfinished calls', async () => {
    expect(
      await executeCode({
        code: 'try { await tools.call("fail"); } catch { return "recovered"; }',
        invoke: async () => {
          throw new Error('Unavailable');
        },
      }),
    ).toEqual({ value: 'recovered' });
    const result = await executeCode({
      code: 'tools.call("wait"); return "done";',
      invoke: () => new Promise(() => {}),
    });
    expect(result.error).toContain('unfinished tool calls');
  });

  it('interrupts synchronous loops and endless promise jobs', async () => {
    for (const code of ['while(true) {}', 'while(true) { await Promise.resolve(); }']) {
      expect((await executeCode({ code, invoke: unused })).error).toContain('CPU limit');
    }
  }, 10_000);

  it('excludes host waiting from the continuous CPU allowance', async () => {
    expect(
      await executeCode({
        code: 'return await tools.call("slow");',
        invoke: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          return 'done';
        },
      }),
    ).toEqual({ value: 'done' });
  });

  it('aborts pending invocation and never invokes code after cancellation', async () => {
    const controller = new AbortController();
    let release!: (value: unknown) => void;
    let started!: () => void;
    let callSignal: AbortSignal | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const invoke = vi.fn((_name: string, _args: unknown, signal: AbortSignal) => {
      callSignal = signal;
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const execution = executeCode({
      code: 'await tools.call("wait"); return await tools.call("late");',
      signal: controller.signal,
      invoke,
    });
    await ready;
    controller.abort();
    expect(await execution).toEqual({ error: 'Code execution cancelled.' });
    expect(callSignal?.aborted).toBe(true);
    const serializeLate = vi.fn(() => 'late result');
    release({ toJSON: serializeLate });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(serializeLate).not.toHaveBeenCalled();
  });

  it('rejects cancellation before startup and caps scripts, results and nesting', async () => {
    const invoke = vi.fn(unused);
    expect(
      await executeCode({
        code: 'return await tools.call("x");',
        signal: AbortSignal.abort(),
        invoke,
      }),
    ).toHaveProperty('error', 'Code execution cancelled.');
    expect(invoke).not.toHaveBeenCalled();
    expect(await executeCode({ code: ' '.repeat(CODE_BYTES + 1), invoke })).toHaveProperty(
      'error',
      'Script is too large.',
    );
    expect(
      (await executeCode({ code: `return "x".repeat(${JSON_BYTES + 1});`, invoke })).error,
    ).toContain('too large');
    expect(
      (
        await executeCode({
          code: 'let value = {}; for(let i=0;i<100;i++) value = {value}; return value;',
          invoke,
        })
      ).error,
    ).toContain('nested too deeply');
    expect(await executeCode({ code: 'return 1n;', invoke })).toHaveProperty('error');
  });

  it('stops CPU-bound execution and protects guest memory and serialization', async () => {
    const controller = new AbortController();
    const invoke = async () => {
      setTimeout(() => controller.abort(), 50);
      return null;
    };
    expect(
      await executeCode({
        code: 'await tools.call("ready"); while(true) {}',
        signal: controller.signal,
        invoke,
      }),
    ).toEqual({ error: 'Code execution cancelled.' });
    expect(
      await executeCode({ code: 'return new Uint8Array(100 * 1024 * 1024);', invoke: unused }),
    ).toHaveProperty('error');
    expect(
      (await executeCode({ code: 'return { toJSON() { while(true) {} } };', invoke: unused }))
        .error,
    ).toContain('CPU limit');
    expect(
      await executeCode({
        code: 'return tools.call.constructor("return typeof process")();',
        invoke: unused,
      }),
    ).toEqual({ value: 'undefined' });
  });

  it('rejects deeply nested call arguments before invoking a tool', async () => {
    const invoke = vi.fn(unused);
    expect(
      (
        await executeCode({
          code: 'let args = {}; for(let i=0;i<100;i++) args = {args}; return await tools.call("read", args);',
          invoke,
        })
      ).error,
    ).toContain('nested too deeply');
    expect(invoke).not.toHaveBeenCalled();
    expect(
      (
        await executeCode({
          code: 'return await tools.call("big");',
          invoke: async () => 'x'.repeat(JSON_BYTES + 1),
        })
      ).error,
    ).toContain('too large');
  });

  it('limits simultaneous host allocation without limiting sequential calls', async () => {
    expect(
      (
        await executeCode({
          code: `return await Promise.all(Array.from({length:${MAX_PENDING + 1}}, () => tools.call("wait")));`,
          invoke: () => new Promise(() => {}),
        })
      ).error,
    ).toContain('Too many simultaneous tool calls');
    expect(
      await executeCode({
        code: `for(let i=0;i<${MAX_PENDING + 1};i++) await tools.call("read"); return "done";`,
        invoke: unused,
      }),
    ).toEqual({ value: 'done' });
  });
});
