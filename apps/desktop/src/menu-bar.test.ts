import { describe, expect, it, vi } from 'vitest';
import { menuBarItem } from './menu-bar.ts';

function fakeTrays() {
  const made: { setMenu: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  const create = vi.fn(() => {
    const tray = { setMenu: vi.fn(), destroy: vi.fn() };
    made.push(tray);
    return tray;
  });
  return { made, create };
}

const MENU = [{ label: 'Open Spark Outpost' }];

describe('menu bar item', () => {
  it('makes no tray while the switch is off', () => {
    const { create } = fakeTrays();
    const item = menuBarItem(create);
    item.update(false, MENU);
    item.dispose();
    expect(create).not.toHaveBeenCalled();
  });

  it('makes one tray when turned on and refreshes its menu on later changes', () => {
    const { made, create } = fakeTrays();
    const item = menuBarItem(create);
    item.update(true, MENU);
    item.update(true, [{ label: 'Quit Spark Outpost' }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(made[0]!.setMenu).toHaveBeenLastCalledWith([{ label: 'Quit Spark Outpost' }]);
  });

  it('removes the tray when turned off and makes a new one when turned on again', () => {
    const { made, create } = fakeTrays();
    const item = menuBarItem(create);
    item.update(true, MENU);
    item.update(false, MENU);
    expect(made[0]!.destroy).toHaveBeenCalledTimes(1);
    item.update(false, MENU);
    expect(made[0]!.destroy).toHaveBeenCalledTimes(1);
    item.update(true, MENU);
    expect(create).toHaveBeenCalledTimes(2);
    expect(made[1]!.setMenu).toHaveBeenCalledWith(MENU);
  });

  it('removes a shown tray once on dispose', () => {
    const { made, create } = fakeTrays();
    const item = menuBarItem(create);
    item.update(true, MENU);
    item.dispose();
    item.dispose();
    expect(made[0]!.destroy).toHaveBeenCalledTimes(1);
  });
});
