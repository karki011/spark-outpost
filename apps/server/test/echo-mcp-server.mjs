import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';

const marker = process.argv[2];
if (marker) {
  appendFileSync(marker, `${process.env.ECHO_TOKEN ?? ''}|${process.env.SECRET_TOKEN ?? ''}\n`);
}

const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

const tools = [
  { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object' } },
  { name: 'shout', description: 'Echo it loudly', inputSchema: { type: 'object' } },
];

createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({
      id: message.id,
      result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'echo', version: '1.0.0' },
      },
    });
  } else if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools } });
  } else {
    send({ id: message.id, result: {} });
  }
});
