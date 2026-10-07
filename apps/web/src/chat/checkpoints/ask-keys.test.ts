import { describe, expect, it } from 'vitest';
import { askKeyAction, type AskKey } from './ask-keys.ts';

const press = (key: string, change: Partial<AskKey> = {}): AskKey => ({
  key,
  shift: false,
  modifier: false,
  composing: false,
  target: 'option',
  caretAtStart: false,
  ...change,
});

describe('askKeyAction', () => {
  it('continues on Enter from an option or a question answer, and sends from the own-words box', () => {
    expect(askKeyAction(press('Enter'))).toEqual({ kind: 'onward' });
    expect(askKeyAction(press('Enter', { target: 'answer' }))).toEqual({ kind: 'onward' });
    expect(askKeyAction(press('Enter', { target: 'own-words' }))).toEqual({ kind: 'send' });
  });

  it('leaves Enter to the button it is pressed on, and Shift+Enter to the text field', () => {
    expect(askKeyAction(press('Enter', { target: 'other' }))).toBeNull();
    expect(askKeyAction(press('Enter', { target: 'answer', shift: true }))).toBeNull();
  });

  it('sends from anywhere with a modifier and Enter', () => {
    expect(askKeyAction(press('Enter', { target: 'other', modifier: true }))).toEqual({
      kind: 'send',
    });
  });

  it('ignores keys while an input method is composing', () => {
    expect(askKeyAction(press('Enter', { target: 'answer', composing: true }))).toBeNull();
  });

  it('moves between options with the arrows and leaves a text field only from its start', () => {
    expect(askKeyAction(press('ArrowDown'))).toEqual({ kind: 'move', by: 1 });
    expect(askKeyAction(press('ArrowUp'))).toEqual({ kind: 'move', by: -1 });
    expect(askKeyAction(press('ArrowUp', { target: 'answer' }))).toBeNull();
    expect(askKeyAction(press('ArrowUp', { target: 'answer', caretAtStart: true }))).toEqual({
      kind: 'move',
      by: -1,
    });
    expect(askKeyAction(press('ArrowDown', { target: 'answer', caretAtStart: true }))).toBeNull();
    expect(askKeyAction(press('ArrowUp', { target: 'own-words', caretAtStart: true }))).toBeNull();
  });

  it('picks by number outside text fields only', () => {
    expect(askKeyAction(press('2'))).toEqual({ kind: 'pick', index: 1 });
    expect(askKeyAction(press('2', { target: 'other' }))).toEqual({ kind: 'pick', index: 1 });
    expect(askKeyAction(press('2', { target: 'answer' }))).toBeNull();
    expect(askKeyAction(press('2', { modifier: true }))).toBeNull();
    expect(askKeyAction(press('0'))).toBeNull();
  });
});
