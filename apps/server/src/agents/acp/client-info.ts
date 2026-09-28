import type { ClientCapabilities, Implementation } from '@agentclientprotocol/sdk';

export const CLIENT_INFO: Implementation = {
  name: 'spark-outpost',
  title: 'Spark Outpost',
  version: '0.0.0',
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
