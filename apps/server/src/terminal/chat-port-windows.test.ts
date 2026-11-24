import { describe, expect, it } from 'vitest';
import { childrenFromRows, netstatListeners } from './chat-port-windows.ts';

const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012',
  '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242',
  '  TCP    127.0.0.1:5173         127.0.0.1:61234        ESTABLISHED     4242',
  '  TCP    127.0.0.1:61234        127.0.0.1:5173         ESTABLISHED     5151',
  '  TCP    0.0.0.0:3000           0.0.0.0:0              ABHÖREN         5151',
  '  TCP    [::]:3000              [::]:0                 ABHÖREN         5151',
  '  TCP    [::1]:9229             [::]:0                 LISTENING       6060',
  '  UDP    0.0.0.0:5353           *:*                                    4242',
  '  TCP    0.0.0.0:99999          0.0.0.0:0              LISTENING       4242',
].join('\r\n');

describe('reading the ports Windows processes listen on', () => {
  it('keeps the TCP listeners of the asked processes, whatever language Windows names the state in', () => {
    expect(netstatListeners(NETSTAT, [4242, 5151, 7777])).toEqual(
      new Map([
        [4242, [5173]],
        [5151, [3000]],
      ]),
    );
  });

  it('finds nothing for processes that listen on nothing', () => {
    expect(netstatListeners(NETSTAT, [])).toEqual(new Map());
    expect(netstatListeners('', [4242])).toEqual(new Map());
  });
});

describe('the Windows process tree', () => {
  it('groups processes by their parent and ignores a process listed as its own parent', () => {
    expect(
      childrenFromRows([
        { pid: 10, ppid: 1 },
        { pid: 11, ppid: 10 },
        { pid: 12, ppid: 10 },
        { pid: 0, ppid: 0 },
      ]),
    ).toEqual(
      new Map([
        [1, [10]],
        [10, [11, 12]],
      ]),
    );
  });
});
