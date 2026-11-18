import { describe, expect, it } from 'vitest';
import { heldNavigation, type NavigationKind } from './held-navigation.ts';

function setup(locked = false) {
  const scene = { locked, announced: [] as NavigationKind[] };
  const navigation = heldNavigation({
    locked: () => scene.locked,
    announce: (kind) => scene.announced.push(kind),
  });
  return { scene, navigation };
}

const chat = (id: string) => ({ id, runId: null });

describe('opening a chat or settings from outside the page', () => {
  it('tells the page at once while unlocked, and hands each request over once', () => {
    const { scene, navigation } = setup();
    navigation.openChat(chat('a'));
    navigation.openSettings('island');
    expect(scene.announced).toEqual(['chat', 'settings']);
    expect(navigation.takeChat()).toEqual(chat('a'));
    expect(navigation.takeChat()).toBeNull();
    expect(navigation.takeSettings()).toBe('island');
    expect(navigation.takeSettings()).toBeNull();
  });

  it('tells the page nothing and hands nothing over while locked', () => {
    const { scene, navigation } = setup(true);
    navigation.openChat(chat('a'));
    navigation.openSettings('island');
    expect(scene.announced).toEqual([]);
    expect(navigation.takeChat()).toBeNull();
    expect(navigation.takeSettings()).toBeNull();
  });

  it('delivers only the latest request once on unlock', () => {
    const { scene, navigation } = setup(true);
    navigation.openSettings('island');
    navigation.openChat(chat('a'));
    navigation.openChat(chat('b'));
    scene.locked = false;
    navigation.unlocked();
    expect(scene.announced).toEqual(['chat']);
    expect(navigation.takeChat()).toEqual(chat('b'));
    expect(navigation.takeSettings()).toBeNull();
    navigation.unlocked();
    expect(scene.announced).toEqual(['chat']);
  });

  it('keeps a held settings request when it came last', () => {
    const { scene, navigation } = setup(true);
    navigation.openChat(chat('a'));
    navigation.openSettings('sparks');
    scene.locked = false;
    navigation.unlocked();
    expect(scene.announced).toEqual(['settings']);
    expect(navigation.takeSettings()).toBe('sparks');
    expect(navigation.takeChat()).toBeNull();
  });

  it('announces nothing on unlock when nothing was asked', () => {
    const { scene, navigation } = setup(true);
    scene.locked = false;
    navigation.unlocked();
    expect(scene.announced).toEqual([]);
  });

  it('holds a request the page had not taken yet when the lock came', () => {
    const { scene, navigation } = setup();
    navigation.openChat(chat('a'));
    scene.locked = true;
    expect(navigation.takeChat()).toBeNull();
    scene.locked = false;
    navigation.unlocked();
    expect(navigation.takeChat()).toEqual(chat('a'));
  });
});
