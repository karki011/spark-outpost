import { expect, it, vi } from 'vitest';
import { createShutdown } from './shutdown.ts';

function setup() {
  let closeDialog = () => {};
  const effects = {
    stop: vi.fn(() => Promise.resolve()),
    closeWindow: vi.fn(),
    showError: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          closeDialog = resolve;
        }),
    ),
    exit: vi.fn(),
  };
  return { effects, shutdown: createShutdown(effects), closeDialog: () => closeDialog() };
}

it('keeps the error dialog open and exits 1 when closing the window triggers a quit', async () => {
  const { effects, shutdown, closeDialog } = setup();
  effects.closeWindow.mockImplementation(() => shutdown.quit());

  shutdown.fail('Spark Outpost API keeps stopping (last exit 1).', 'tail');
  await vi.waitFor(() => expect(effects.showError).toHaveBeenCalledOnce());
  expect(effects.exit).not.toHaveBeenCalled();

  closeDialog();
  await vi.waitFor(() => expect(effects.exit).toHaveBeenCalledOnce());
  expect(effects.exit).toHaveBeenCalledWith(1);
  expect(effects.stop).toHaveBeenCalledOnce();
});

it('still shows the error when stopping the services fails', async () => {
  const { effects, shutdown, closeDialog } = setup();
  effects.stop.mockRejectedValueOnce(new Error('postgres would not stop'));

  shutdown.fail('Startup failed.', 'detail');
  await vi.waitFor(() =>
    expect(effects.showError).toHaveBeenCalledWith('Startup failed.', 'detail'),
  );
  closeDialog();
  await vi.waitFor(() => expect(effects.exit).toHaveBeenCalledWith(1));
});

it('reports only the first failure', async () => {
  const { effects, shutdown, closeDialog } = setup();

  shutdown.fail('first', '');
  shutdown.fail('second', '');
  await vi.waitFor(() => expect(effects.showError).toHaveBeenCalledOnce());
  closeDialog();
  await vi.waitFor(() => expect(effects.exit).toHaveBeenCalledOnce());
  expect(effects.showError).toHaveBeenCalledWith('first', '');
});

it('exits 0 after stopping everything on a normal quit', async () => {
  const { effects, shutdown } = setup();

  shutdown.quit();
  shutdown.quit();
  await vi.waitFor(() => expect(effects.exit).toHaveBeenCalledTimes(2));
  expect(effects.exit).toHaveBeenCalledWith(0);
  expect(effects.stop).toHaveBeenCalledOnce();
  expect(effects.showError).not.toHaveBeenCalled();
});

it('closes every window once on a normal quit, even when closing quits again', async () => {
  const { effects, shutdown } = setup();
  effects.closeWindow.mockImplementation(() => shutdown.quit());

  shutdown.quit();
  await vi.waitFor(() => expect(effects.exit).toHaveBeenCalledWith(0));
  expect(effects.closeWindow).toHaveBeenCalledOnce();
  expect(effects.stop).toHaveBeenCalledOnce();
});
