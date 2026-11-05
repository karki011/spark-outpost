import { describe, expect, it } from 'vitest';
import {
  childrenByParent,
  descendantsOf,
  listeningPorts,
  panePids,
  portsByChat,
  postgresPort,
} from './chat-ports.ts';

const CHAT_A = '00000000-0000-4000-8000-00000000000a';
const CHAT_B = '00000000-0000-4000-8000-00000000000b';

describe('the process tree', () => {
  const children = childrenByParent(
    ['  100     1', '  200   100', '  300   200', '  400     1', 'junk', '  500   400', ''].join(
      '\n',
    ),
  );

  it('walks every descendant of a root and keeps the root', () => {
    expect(descendantsOf(100, children).sort()).toEqual([100, 200, 300]);
  });

  it('keeps a root with no children on its own', () => {
    expect(descendantsOf(999, children)).toEqual([999]);
  });

  it('survives a loop in the parent table', () => {
    const looped = childrenByParent('10 20\n20 10\n');
    expect(descendantsOf(10, looped).sort()).toEqual([10, 20]);
  });
});

describe('lsof output', () => {
  it('reads IPv4, IPv6 and wildcard listeners per process and skips other fields', () => {
    const out = [
      'p300',
      'f12',
      'n*:5173',
      'f13',
      'n127.0.0.1:8080',
      'p500',
      'f4',
      'n[::1]:3000',
      'nlocalhost:http',
      'n*:70000',
      '',
    ].join('\n');
    expect(listeningPorts(out)).toEqual(
      new Map([
        [300, [5173, 8080]],
        [500, [3000]],
      ]),
    );
  });

  it('reads nothing from empty output', () => {
    expect(listeningPorts('')).toEqual(new Map());
  });
});

describe('tmux panes', () => {
  it('maps each session to its pane pids', () => {
    expect(panePids('spark-abc 4100\nspark-abc 4200\nother 9\nbad line here\n')).toEqual(
      new Map([
        ['spark-abc', [4100, 4200]],
        ['other', [9]],
      ]),
    );
  });
});

describe('ports by chat', () => {
  const children = childrenByParent('200 100\n300 200\n600 500\n');
  const listening = new Map([
    [300, [5173, 4318]],
    [200, [5173]],
    [600, [9000, 3000]],
  ]);

  it('dedupes and sorts each chat, drops excluded ports and chats with none', () => {
    const roots = [
      { conversationId: CHAT_B, pid: 500 },
      { conversationId: CHAT_A, pid: 100 },
      { conversationId: CHAT_A, pid: 300 },
      { conversationId: '00000000-0000-4000-8000-00000000000c', pid: 700 },
    ];
    expect(portsByChat(roots, children, listening, new Set([4318]))).toEqual({
      [CHAT_A]: [5173],
      [CHAT_B]: [3000, 9000],
    });
  });

  it("skips an agent CLI's own listener but keeps its children's", () => {
    const roots = [{ conversationId: CHAT_A, pid: 200, agentCli: true }];
    expect(portsByChat(roots, children, listening, new Set())).toEqual({
      [CHAT_A]: [4318, 5173],
    });
    const quiet = new Map([[200, [5173]]]);
    expect(portsByChat(roots, children, quiet, new Set())).toEqual({});
  });

  it('is empty with no roots', () => {
    expect(portsByChat([], children, listening, new Set())).toEqual({});
  });
});

describe('the database port', () => {
  it('reads the port, falls back to Postgres default and refuses junk', () => {
    expect(postgresPort('postgres://u:p@127.0.0.1:55432/spark')).toBe(55432);
    expect(postgresPort('postgres://localhost/spark')).toBe(5432);
    expect(postgresPort('not a url')).toBeNull();
  });
});
