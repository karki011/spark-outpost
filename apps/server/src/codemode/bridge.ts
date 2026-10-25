import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { codeModeEnabled } from '../persistence/code-mode-settings.ts';
import { sparkAvailability, type SparkAvailability } from '../spark-mcp/availability.ts';
import type { SparkScope, SparkToolDeps } from '../spark-mcp/deps.ts';
import { SparkToolError, type SparkTool, type SparkToolContext } from '../spark-mcp/tool.ts';
import { codeModeOffered, codeModeTools, describeCodeModeTools } from './catalog.ts';
import { codeModeResult } from './results.ts';

export interface CodeModeAccess {
  toolsFor(scope: SparkScope, available: SparkAvailability): readonly SparkTool[];
  callTool(tool: SparkTool, args: unknown, context: SparkToolContext): Promise<CallToolResult>;
  availabilityOf?: typeof sparkAvailability;
}

interface CallReceipt {
  name: string;
  callId: string;
  outcome: 'started' | 'completed' | 'failed' | 'cancelled';
}

const RETAINED_RECEIPTS = 50;
const CONCURRENT_CALLS = 4;

function scopedDeps(deps: SparkToolDeps, signal: AbortSignal): SparkToolDeps {
  return {
    ...deps,
    fetch: (input, init) => {
      signal.throwIfAborted();
      const prior = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      return deps.fetch(input, {
        ...init,
        signal: prior ? AbortSignal.any([signal, prior]) : signal,
      });
    },
    github: {
      ...deps.github,
      locateGh: async () => null,
      runCommand: async () => {
        throw new SparkToolError(
          'Code Mode requires a saved GitHub connection; use direct tools for gh CLI access.',
        );
      },
    },
  };
}

export function createCodeModeBridge(context: SparkToolContext, access: CodeModeAccess) {
  if (!codeModeOffered(context.scope))
    throw new SparkToolError('Code Mode is unavailable in this session.');
  const signals = [context.signal, context.scope.actions?.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, ...signals]);
  signal.throwIfAborted();
  let sequence = 0;
  const receipts: CallReceipt[] = [];
  let active = 0;
  const waiting: Array<() => void> = [];

  async function acquire(callSignal: AbortSignal): Promise<() => void> {
    callSignal.throwIfAborted();
    if (active >= CONCURRENT_CALLS) {
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          callSignal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          const index = waiting.indexOf(resume);
          if (index >= 0) waiting.splice(index, 1);
          reject(callSignal.reason);
        };
        waiting.push(resume);
        callSignal.addEventListener('abort', abort, { once: true });
      });
    } else active += 1;
    return () => {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    };
  }

  async function available(callSignal = signal) {
    callSignal.throwIfAborted();
    if (!codeModeOffered(context.scope))
      throw new SparkToolError('Code Mode is unavailable in this session.');
    if (!(await codeModeEnabled(context.deps.db, context.scope.workspaceId)))
      throw new SparkToolError('Code Mode is turned off in Settings.');
    callSignal.throwIfAborted();
    await context.scope.beforeToolCall?.();
    callSignal.throwIfAborted();
    const availability = await (access.availabilityOf ?? sparkAvailability)(
      scopedDeps(context.deps, callSignal),
      context.scope,
    );
    callSignal.throwIfAborted();
    return codeModeTools(access.toolsFor(context.scope, availability));
  }

  return {
    signal,
    close: () => {
      controller.abort();
      for (const receipt of receipts) {
        if (receipt.outcome === 'started') receipt.outcome = 'cancelled';
      }
    },
    receipts: () => receipts.map((receipt) => ({ ...receipt })),
    receiptCounts: () => ({ totalCalls: sequence, omittedCalls: sequence - receipts.length }),
    async discover(query?: string) {
      return describeCodeModeTools(await available(), query);
    },
    async invoke(name: string, args: unknown, guestSignal: AbortSignal) {
      const callSignal = AbortSignal.any([signal, guestSignal]);
      const id = `${context.callId ?? 'execute'}:${++sequence}`;
      const receipt: CallReceipt = { name: name.slice(0, 200), callId: id, outcome: 'started' };
      receipts.push(receipt);
      if (receipts.length > RETAINED_RECEIPTS) receipts.shift();
      const audit = (outcome: CallReceipt['outcome']) => {
        receipt.outcome = outcome;
        context.scope.actions?.audit?.message('harness', {
          method: 'spark/code_mode_call',
          params: { name: receipt.name, callId: id, outcome },
        });
      };
      audit('started');
      let release: (() => void) | undefined;
      try {
        release = await acquire(callSignal);
        const tools = await available(callSignal);
        callSignal.throwIfAborted();
        const tool = tools.find((candidate) => candidate.name === name);
        if (!tool)
          throw new SparkToolError(
            'That tool is not available in Code Mode. Discover the allowed tools first.',
          );
        const result = await access.callTool(tool, args, {
          ...context,
          deps: scopedDeps(context.deps, callSignal),
          signal: callSignal,
          callId: id,
        });
        callSignal.throwIfAborted();
        audit(result.isError ? 'failed' : 'completed');
        return codeModeResult(result);
      } catch (error) {
        audit(callSignal.aborted ? 'cancelled' : 'failed');
        throw error;
      } finally {
        release?.();
      }
    },
  };
}
