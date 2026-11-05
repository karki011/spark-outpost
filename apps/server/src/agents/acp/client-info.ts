import type { ClientCapabilities, Implementation } from '@agentclientprotocol/sdk';
import { ASYNC_TASKS_CAPABILITY, SUBAGENT_SESSIONS_CAPABILITY } from './subagent-stream.ts';

export const CLIENT_INFO: Implementation = {
  name: 'spark-outpost',
  title: 'Spark Outpost',
  version: process.env.SPARK_APP_VERSION?.trim() || '0.0.0',
};

export function clientCapabilities(readFiles: boolean, writeFiles = false): ClientCapabilities {
  return {
    fs: { readTextFile: readFiles, writeTextFile: readFiles && writeFiles },
    terminal: false,
    session: { notices: {}, configOptions: { boolean: {} } },
    _meta: { jetbrains: { air: { version: 1, capabilities: ['sessionFailure'] } } },
  };
}

export const CLIENT_CAPABILITIES = clientCapabilities(false);

export function turnCapabilities(readFiles: boolean, writeFiles: boolean): ClientCapabilities {
  const base = clientCapabilities(readFiles, writeFiles);
  return {
    ...base,
    session: { ...base.session, compaction: {} },
    elicitation: { form: {} },
    _meta: {
      jetbrains: {
        air: {
          version: 1,
          capabilities: ['sessionFailure', SUBAGENT_SESSIONS_CAPABILITY, ASYNC_TASKS_CAPABILITY],
        },
      },
    },
  };
}
