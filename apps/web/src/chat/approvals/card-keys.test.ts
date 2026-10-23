import { describe, expect, it } from 'vitest';
import { cardKeyAction, type CardKey } from './card-keys.ts';

const press = (key: string, change: Partial<CardKey> = {}): CardKey => ({
  key,
  modifier: false,
  shift: false,
  composing: false,
  handled: false,
  target: 'card',
  holds: false,
  ...change,
});

describe('cardKeyAction', () => {
  it('allows on Enter only from the card itself', () => {
    expect(cardKeyAction(press('Enter'))).toBe('allow');
    expect(cardKeyAction(press('Enter', { target: 'control' }))).toBeNull();
    expect(cardKeyAction(press('Enter', { target: 'field' }))).toBeNull();
  });

  it('never allows a hold-to-confirm card with Enter, and still denies it with Esc', () => {
    expect(cardKeyAction(press('Enter', { holds: true }))).toBeNull();
    expect(cardKeyAction(press('Escape', { holds: true }))).toBe('deny');
  });

  it('denies on Esc from the card or a button, never from a text field', () => {
    expect(cardKeyAction(press('Escape'))).toBe('deny');
    expect(cardKeyAction(press('Escape', { target: 'control' }))).toBe('deny');
    expect(cardKeyAction(press('Escape', { target: 'field' }))).toBeNull();
  });

  it('leaves a key that something else already handled, or one with a modifier', () => {
    expect(cardKeyAction(press('Escape', { handled: true }))).toBeNull();
    expect(cardKeyAction(press('Enter', { modifier: true }))).toBeNull();
    expect(cardKeyAction(press('Enter', { shift: true }))).toBeNull();
    expect(cardKeyAction(press('Enter', { composing: true }))).toBeNull();
    expect(cardKeyAction(press('a'))).toBeNull();
  });
});
