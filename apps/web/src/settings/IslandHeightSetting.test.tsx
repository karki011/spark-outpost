// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompanionStatus } from '../desktop/desktop-bridge.ts';
import { IslandHeightSetting } from './IslandHeightSetting.tsx';

vi.mock('../ui/DocLink.tsx', () => ({ DocLink: () => null }));
vi.mock('./setting-focus.ts', () => ({ useSettingFocus: () => undefined }));

const status: CompanionStatus = {
  supported: true,
  enabled: true,
  shortcuts: { quick: 'Alt+Space', sessions: 'Alt+Shift+Space' },
  failed: [],
  islandHeight: 0,
};
afterEach(cleanup);

describe('IslandHeightSetting', () => {
  it('tracks a drag locally and commits once on release, not again on blur', async () => {
    let finish!: (value: CompanionStatus) => void;
    const onChange = vi.fn(
      () =>
        new Promise<CompanionStatus>((resolve) => {
          finish = resolve;
        }),
    );
    render(<IslandHeightSetting status={status} onChange={onChange} />);
    const slider = screen.getByRole('slider', { name: 'Spark Island height' });
    fireEvent.change(slider, { target: { value: '-12' } });
    fireEvent.change(slider, { target: { value: '-20' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('20 px higher');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(-20);
    await act(async () => finish({ ...status, islandHeight: -20 }));
  });

  it('keeps keyboard focus through an in-flight save without overlapping writes', async () => {
    let finish!: (value: CompanionStatus) => void;
    const onChange = vi.fn(
      () =>
        new Promise<CompanionStatus>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<IslandHeightSetting status={status} onChange={onChange} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    slider.focus();
    fireEvent.change(slider, { target: { value: '1' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(slider.disabled).toBe(false);
    expect(document.activeElement).toBe(slider);
    expect(fireEvent.keyDown(slider, { key: 'ArrowRight' })).toBe(false);
    fireEvent.change(slider, { target: { value: '2' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1);
    expect(slider.value).toBe('1');
    await act(async () => finish({ ...status, islandHeight: 1 }));
    view.rerender(
      <IslandHeightSetting status={{ ...status, islandHeight: 1 }} onChange={onChange} />,
    );
    expect(document.activeElement).toBe(slider);
    fireEvent.change(slider, { target: { value: '2' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(2);
    await act(async () => finish({ ...status, islandHeight: 2 }));
  });

  it('commits keyboard adjustments on key release and supports reset', async () => {
    const onChange = vi.fn(async (islandHeight: number) => ({ ...status, islandHeight }));
    const view = render(<IslandHeightSetting status={status} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '8' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(8));
    view.rerender(
      <IslandHeightSetting status={{ ...status, islandHeight: 8 }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset Spark Island height' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(0));
  });

  it('cancels uncommitted pointer changes and saves on blur', async () => {
    const onChange = vi.fn(async (islandHeight: number) => ({ ...status, islandHeight }));
    render(<IslandHeightSetting status={status} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '9' } });
    fireEvent.pointerCancel(slider);
    expect((slider as HTMLInputElement).value).toBe('0');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: '4' } });
    fireEvent.blur(slider);
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith(4));
  });

  it('coalesces live previews and persists even after preview status catches up', async () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onPreview = vi.fn(async (islandHeight: number) => ({ ...status, islandHeight }));
    const onChange = vi.fn(async (islandHeight: number) => ({ ...status, islandHeight }));
    const view = render(
      <IslandHeightSetting status={status} onChange={onChange} onPreview={onPreview} />,
    );
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '5' } });
    fireEvent.change(slider, { target: { value: '10' } });
    await act(async () => frame(0));
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(10);
    view.rerender(
      <IslandHeightSetting
        status={{ ...status, islandHeight: 10 }}
        onChange={onChange}
        onPreview={onPreview}
      />,
    );
    fireEvent.pointerUp(slider);
    await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith(10));
    view.unmount();
    expect(onPreview).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('restores the original position when an unfinished live preview unmounts', async () => {
    let frame!: FrameRequestCallback;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onPreview = vi.fn(async (islandHeight: number) => ({ ...status, islandHeight }));
    const onChange = vi.fn(async (islandHeight: number) => ({ ...status, islandHeight }));
    const view = render(
      <IslandHeightSetting status={status} onChange={onChange} onPreview={onPreview} />,
    );
    fireEvent.change(screen.getByRole('slider'), { target: { value: '-15' } });
    await act(async () => frame(0));
    view.unmount();
    expect(onPreview).toHaveBeenLastCalledWith(0);
    expect(onChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('disables unsupported bridges and restores the persisted height after failure', async () => {
    const view = render(<IslandHeightSetting status={status} />);
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
    const onChange = vi.fn().mockRejectedValue(new Error('offline'));
    view.rerender(<IslandHeightSetting status={status} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
    fireEvent.pointerUp(screen.getByRole('slider'));
    await screen.findByText('Could not save the height. Try again.');
    expect((screen.getByRole('slider') as HTMLInputElement).value).toBe('0');
  });
});
