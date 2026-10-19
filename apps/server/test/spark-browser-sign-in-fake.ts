import type { BrowserHostRequest } from '@spark-outpost/contracts';
import type { BrowserHost, BrowserHostError } from '../src/browser/host-client.ts';
import { PLANTED } from './sign-in-support.ts';

export const ORIGIN = 'https://staging.example.com';
export const ECHO = `${PLANTED.username} / ${PLANTED.password}`;
export const FILE_SECRET = 'sk_test_9f8e7d6c5b4a3210';

export class FakeBrowserHost implements BrowserHost {
  readonly requests: BrowserHostRequest[] = [];
  url = `${ORIGIN}/login`;
  failure: BrowserHostError | null = null;
  owner: 'user' | 'agent' = 'user';

  request(request: BrowserHostRequest): Promise<never> {
    this.requests.push(request);
    const fails = request.op === 'sign_in' || request.op === 'act';
    if (this.failure && fails) return Promise.reject(this.failure);
    return Promise.resolve(this.answer(request) as never);
  }

  ops(op: BrowserHostRequest['op']) {
    return this.requests.filter((request) => request.op === op);
  }

  private answer(request: BrowserHostRequest): unknown {
    const facts = {
      tabId: 'tab1',
      url: this.url,
      title: `Welcome ${PLANTED.username}`,
      place: 'external',
      owner: this.owner,
    };
    if (request.op === 'sign_in') {
      this.url = `${ORIGIN}/home?u=${encodeURIComponent(PLANTED.username)}&p=${encodeURIComponent(PLANTED.password)}`;
      return { ...facts, url: this.url, steps: 1 };
    }
    if (request.op === 'tabs') {
      return {
        tabs: [
          {
            id: 'tab1',
            title: facts.title,
            url: this.url,
            owner: 'user',
            active: true,
            place: 'local',
          },
        ],
      };
    }
    if (request.op === 'read') {
      return {
        ...facts,
        place: 'local',
        mode: request.mode,
        text: `- textbox "Email" [ref_1] value="${PLANTED.username}"\n- paragraph "debug ${ECHO}"\n- paragraph "${PLANTED.password.slice(0, 9)}…"`,
        total: 3,
        offset: 0,
        nextOffset: null,
        masked: 1,
      };
    }
    if (request.op === 'logs') {
      return {
        ...facts,
        place: 'local',
        kind: request.kind,
        entries: [
          {
            at: '2026-10-05T10:00:00.000Z',
            level: 'log',
            text: `signing in ${ECHO}`,
            source: null,
            status: null,
            method: null,
          },
          {
            at: '2026-10-05T10:00:01.000Z',
            level: 'log',
            text: 'ready',
            source: null,
            status: null,
            method: null,
          },
        ],
        requests: [
          {
            at: '2026-10-05T10:00:02.000Z',
            method: 'GET',
            url: `${ORIGIN}/api/me?u=${encodeURIComponent(PLANTED.username)}&k=${FILE_SECRET}&offset=5`,
            status: 200,
            type: 'Fetch',
            initiator: null,
            startMs: 0,
            endMs: 40,
            encodedBytes: 10,
            decodedBytes: 20,
            fromCache: false,
            failed: null,
          },
        ],
        dropped: 0,
      };
    }
    return facts;
  }
}
