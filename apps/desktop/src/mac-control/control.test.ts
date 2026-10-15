import { describe, expect, it } from 'vitest';
import type { MacIndicator, MacNode, MacRunningApp, MacStatus } from '@spark-outpost/contracts';
import { createMacControl, MacOpError } from './control.ts';
import { MacHelperError, type MacHelper, type MacHelperCall } from './helper-process.ts';

const CHAT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const NEXT_RUN = '33333333-3333-4333-8333-333333333333';
const signal = new AbortController().signal;

const apple = { valid: true, apple: true, teamId: null };

const CALCULATOR: MacRunningApp = {
  pid: 700,
  name: 'Calculator',
  bundleId: 'com.apple.calculator',
  path: '/System/Applications/Calculator.app',
  frontmost: false,
  signature: apple,
  windows: [{ index: 0, title: 'Calculator' }],
};

const SETTINGS: MacRunningApp = {
  ...CALCULATOR,
  pid: 701,
  name: 'System Settings',
  bundleId: 'com.apple.systempreferences',
};

const FAKE_NOTES: MacRunningApp = {
  ...CALCULATOR,
  pid: 702,
  name: 'Notes',
  bundleId: 'com.apple.Notes',
  signature: { valid: true, apple: false, teamId: 'EVIL000001' },
};

function node(
  ref: string,
  role: string,
  title: string | null,
  depth: number,
  more: Partial<MacNode> = {},
): MacNode {
  return {
    ref,
    depth,
    role,
    subrole: null,
    title,
    description: null,
    identifier: null,
    value: null,
    enabled: true,
    focused: false,
    secure: false,
    actions: [],
    ...more,
  };
}

const SEVEN = { role: 'AXButton', subrole: null, title: '7', description: null, identifier: null };

class FakeHelper implements MacHelper {
  status: MacStatus = {
    trusted: true,
    locked: false,
    secureInput: false,
    idleSeconds: 100,
    frontmostPid: null,
  };
  apps: MacRunningApp[] = [CALCULATOR, SETTINGS, FAKE_NOTES];
  calls: MacHelperCall[] = [];
  killed = 0;
  pid = 9000;

  async call(request: MacHelperCall): Promise<never> {
    this.calls.push(request);
    const answer = this.answer(request);
    return answer as never;
  }

  answer(request: MacHelperCall): unknown {
    if (request.op === 'status') return this.status;
    if (request.op === 'apps') return { apps: this.apps };
    if (request.op === 'read') {
      return {
        window: { index: 0, title: 'Calculator' },
        scope: 'window',
        rootRef: 'ax_1',
        truncated: false,
        nodes: [
          node('ax_1', 'AXWindow', 'Calculator', 0),
          node('ax_2', 'AXStaticText', null, 1, { value: '42' }),
          node('ax_3', 'AXButton', '7', 1),
          node('ax_4', 'AXTextField', 'Password', 1, {
            secure: true,
            subrole: 'AXSecureTextField',
          }),
        ],
      };
    }
    if (request.op === 'open') return { pid: 700 };
    if (request.op === 'press' || request.op === 'key' || request.op === 'scroll')
      return { done: true };
    throw new MacHelperError('not_found', 'not faked');
  }

  kill() {
    this.killed += 1;
  }
}

function setup() {
  const helper = new FakeHelper();
  const shown: (MacIndicator | null)[] = [];
  let clock = 1_000_000;
  const control = createMacControl({
    helper,
    sparkPids: () => new Set([4242]),
    indicator: (state) => shown.push(state),
    now: () => clock,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { helper, control, shown, advance };
}

const read = (pid: number, runId = RUN) =>
  ({ op: 'read', chatId: CHAT, runId, pid, mode: 'tree', offset: 0, maxChars: 12_000 }) as const;

const press = (runId = RUN) =>
  ({
    op: 'act',
    chatId: CHAT,
    runId,
    pid: 700,
    app: 'Calculator',
    action: 'press',
    ref: 'ax_3',
    expect: SEVEN,
    did: 'Pressed button "7"',
  }) as const;

async function failure(promise: Promise<unknown>): Promise<MacOpError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MacOpError);
  return error as MacOpError;
}

describe('Mac control in the shell', () => {
  it('reads an app as an outline with refs, values and masked secure fields', async () => {
    const { control, shown } = setup();
    const result = (await control.run(read(700), signal)) as { text: string; masked: number };
    expect(result.text).toContain('- window "Calculator" [ax_1]');
    expect(result.text).toContain('  - static text [ax_2] value="42"');
    expect(result.text).toContain('  - button "7" [ax_3]');
    expect(result.text).toContain('  - text field "Password" [ax_4] [masked]');
    expect(result.masked).toBe(1);
    expect(shown.at(-1)).toMatchObject({ app: 'Calculator', paused: false });
  });

  it('lists apps with the hard limits marked, Spark itself included by process', async () => {
    const { control, helper } = setup();
    helper.apps = [
      ...helper.apps,
      { ...CALCULATOR, pid: 4242, name: 'Electron', bundleId: 'com.github.Electron' },
    ];
    const { apps } = (await control.run({ op: 'apps', chatId: CHAT, runId: RUN }, signal)) as {
      apps: { name: string; refused: string | null }[];
    };
    expect(apps.map((app) => [app.name, app.refused])).toEqual([
      ['Calculator', null],
      ['System Settings', 'system_settings'],
      ['Notes', 'impostor'],
      ['Electron', 'spark'],
    ]);
  });

  it('refuses System Settings and an impostor before reading anything', async () => {
    const { control, helper } = setup();
    expect((await failure(control.run(read(701), signal))).code).toBe('refused');
    expect((await failure(control.run(read(702), signal))).message).toContain('code signature');
    expect(helper.calls.some((call) => call.op === 'read')).toBe(false);
  });

  it('refuses to open a refused app before launching it', async () => {
    const { control, helper } = setup();
    const error = await failure(
      control.run({ op: 'open', chatId: CHAT, runId: RUN, bundleId: 'com.google.Chrome' }, signal),
    );
    expect(error.message).toContain('Browser pane');
    expect(helper.calls.some((call) => call.op === 'open')).toBe(false);
  });

  it('never acts while the screen is locked or without the permission', async () => {
    const { control, helper } = setup();
    helper.status = { ...helper.status, locked: true };
    expect((await failure(control.run(press(), signal))).code).toBe('screen_locked');
    helper.status = { ...helper.status, locked: false, trusted: false };
    expect((await failure(control.run(press(), signal))).code).toBe('not_trusted');
    expect(helper.calls.some((call) => call.op === 'press')).toBe(false);
  });

  it('pauses when the user moves the mouse in the controlled app, until Resume', async () => {
    const { control, helper, advance, shown } = setup();
    await control.run(press(), signal);
    advance(5_000);
    helper.status = { ...helper.status, frontmostPid: 700, idleSeconds: 1 };
    expect((await failure(control.run(press(), signal))).code).toBe('paused_by_user');
    expect(shown.at(-1)).toMatchObject({ paused: true });
    expect((await failure(control.run(press(), signal))).code).toBe('paused_by_user');
    control.resume();
    await control.run(press(), signal);
    expect(helper.calls.filter((call) => call.op === 'press')).toHaveLength(2);
  });

  it('does not pause for input in another app, and a new turn resumes', async () => {
    const { control, helper, advance } = setup();
    await control.run(press(), signal);
    advance(5_000);
    helper.status = { ...helper.status, frontmostPid: 4242, idleSeconds: 0 };
    await control.run(press(), signal);
    advance(5_000);
    helper.status = { ...helper.status, frontmostPid: 700, idleSeconds: 0 };
    expect((await failure(control.run(press(), signal))).code).toBe('paused_by_user');
    await control.run(press(NEXT_RUN), signal);
  });

  it('Stop kills the helper, hides the indicator and refuses the rest of the turn', async () => {
    const { control, helper, shown } = setup();
    await control.run(press(), signal);
    control.stop();
    expect(helper.killed).toBe(1);
    expect(shown.at(-1)).toBeNull();
    expect((await failure(control.run(press(), signal))).code).toBe('stopped');
    await control.run({ op: 'end_run', chatId: CHAT, runId: RUN }, signal);
    await control.run(press(), signal);
  });

  it('ends the indicator with the turn', async () => {
    const { control, shown } = setup();
    await control.run(press(), signal);
    expect(await control.run({ op: 'end_run', chatId: CHAT, runId: RUN }, signal)).toEqual({
      ended: true,
    });
    expect(shown.at(-1)).toBeNull();
  });

  it('resolves an app by name or bundle id, and a bundle id that is not running', async () => {
    const { control } = setup();
    const byName = (await control.run(
      { op: 'resolve', chatId: CHAT, runId: RUN, app: 'calculator' },
      signal,
    )) as {
      app: { pid: number };
    };
    expect(byName.app.pid).toBe(700);
    const closed = (await control.run(
      { op: 'resolve', chatId: CHAT, runId: RUN, app: 'com.apple.TextEdit' },
      signal,
    )) as {
      app: { pid: number | null; refused: string | null };
    };
    expect(closed.app).toMatchObject({ pid: null, refused: null });
    const settings = (await control.run(
      { op: 'resolve', chatId: CHAT, runId: RUN, app: 'Keychain Access' },
      signal,
    )) as { app: { pid: number | null; refused: string | null } };
    expect(settings.app).toMatchObject({ pid: null, refused: 'passwords' });
    expect(
      (
        await failure(
          control.run({ op: 'resolve', chatId: CHAT, runId: RUN, app: 'Not Here' }, signal),
        )
      ).code,
    ).toBe('no_app');
  });
});
