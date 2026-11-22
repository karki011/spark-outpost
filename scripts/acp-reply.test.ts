import { describe, expect, it } from 'vitest';
import { completeReply } from './acp-reply.ts';

const reply = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}';

describe('completeReply', () => {
  it('waits while a reply is split right after its id', () => {
    expect(completeReply('{"jsonrpc":"2.0","id":1,', 1)).toBeNull();
    expect(completeReply(`${reply}\n`, 1)).toBe(reply);
  });

  it('skips notifications and other ids before the reply', () => {
    const notice = '{"jsonrpc":"2.0","method":"note"}';
    const other = '{"jsonrpc":"2.0","id":2,"result":{}}';
    expect(completeReply(`${notice}\n${other}\n${reply}\n`, 1)).toBe(reply);
  });

  it('ignores lines that are not JSON', () => {
    expect(completeReply('starting adapter\n', 1)).toBeNull();
  });
});
