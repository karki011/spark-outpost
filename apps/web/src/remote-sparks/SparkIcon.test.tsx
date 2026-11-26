// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SparkIcon } from './SparkIcon.tsx';

afterEach(cleanup);

describe('SparkIcon', () => {
  it('shows the saved image at a fixed size with no name of its own', () => {
    const { container } = render(<SparkIcon icon="/api/remote-sparks/local/icon?v=3" size={28} />);
    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('/api/remote-sparks/local/icon?v=3');
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('width')).toBe('28');
    expect(image.getAttribute('height')).toBe('28');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows the laptop in the same box when there is no image', () => {
    const { container } = render(<SparkIcon icon={null} size={28} />);
    const box = container.querySelector<HTMLElement>('.rs-icon')!;
    expect(box.style.width).toBe('28px');
    expect(box.style.height).toBe('28px');
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(box.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});
