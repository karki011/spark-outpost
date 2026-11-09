// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ImageLightbox, type LightboxImage } from './ImageLightbox.tsx';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

afterEach(cleanup);

const IMAGES: LightboxImage[] = [
  { name: 'one.png', src: '/one.png', alt: 'First shot' },
  { name: 'two.png', src: '/two.png', alt: 'Second shot' },
  { name: 'three.png', src: '/three.png', alt: 'Third shot' },
];

function open(index: number, onClose = () => undefined) {
  render(<ImageLightbox {...IMAGES[index]!} images={IMAGES} index={index} onClose={onClose} />);
  return screen.getByRole('dialog', { hidden: true });
}

const shown = () => screen.getByRole('img', { hidden: true }).getAttribute('alt');
const place = () => screen.queryByText(/ of \d+$/)?.textContent ?? null;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, ...init });

describe('the image lightbox', () => {
  it('moves with the arrow keys and names the current image', () => {
    const dialog = open(1);
    expect(place()).toBe('2 of 3');
    press(dialog, 'ArrowRight');
    expect(shown()).toBe('Third shot');
    expect(place()).toBe('3 of 3');
    expect(dialog.getAttribute('aria-label')).toBe('Third shot');
    expect(screen.getByRole('link', { hidden: true }).textContent).toBe('three.png');
    press(dialog, 'ArrowLeft');
    press(dialog, 'ArrowLeft');
    expect(shown()).toBe('First shot');
    expect(place()).toBe('1 of 3');
  });

  it('stops at both ends without wrapping', () => {
    const dialog = open(0);
    press(dialog, 'ArrowLeft');
    expect(place()).toBe('1 of 3');
    const previous = screen.getByRole('button', { name: 'Previous image', hidden: true });
    expect(previous.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(previous);
    expect(place()).toBe('1 of 3');
    const next = screen.getByRole('button', { name: 'Next image', hidden: true });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(place()).toBe('3 of 3');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    press(dialog, 'ArrowRight');
    expect(shown()).toBe('Third shot');
  });

  it('leaves the size toggle at fit after a move', () => {
    const dialog = open(0);
    const size = screen.getByRole('button', { name: 'Full size', hidden: true });
    fireEvent.click(size);
    expect(size.getAttribute('aria-pressed')).toBe('true');
    press(dialog, 'ArrowRight');
    expect(size.getAttribute('aria-pressed')).toBe('false');
  });

  it('ignores arrows with a modifier or while typing in a field', () => {
    const dialog = open(0);
    press(dialog, 'ArrowRight', { metaKey: true });
    const field = document.createElement('input');
    dialog.append(field);
    press(field, 'ArrowRight');
    expect(place()).toBe('1 of 3');
  });

  it('shows one image as before, with no steps or position', () => {
    const dialog = render(
      <ImageLightbox name="solo.png" src="/solo.png" onClose={() => undefined} />,
    ).getByRole('dialog', { hidden: true });
    expect(place()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next image', hidden: true })).toBeNull();
    press(dialog, 'ArrowRight');
    expect(shown()).toBe('solo.png');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    const dialog = open(1, onClose);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
  });
});
