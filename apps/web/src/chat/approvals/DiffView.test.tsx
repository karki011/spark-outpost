// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDiff } from './diff-model.ts';
import { DiffView } from './DiffView.tsx';

interface DiffJob {
  oldText: string | null;
  newText: string;
}

class FakeWorker {
  static all: FakeWorker[] = [];
  jobs: DiffJob[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor() {
    FakeWorker.all.push(this);
  }

  postMessage(job: DiffJob) {
    this.jobs.push(job);
  }

  terminate() {
    this.terminated = true;
  }

  answer() {
    const job = this.jobs.at(-1)!;
    this.onmessage?.({ data: buildDiff(job.oldText, job.newText) } as MessageEvent);
  }
}

const lines = (count: number, word: string) =>
  Array.from({ length: count }, (_, index) => `${word} ${index + 1}`).join('\n');

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiffView', () => {
  it('shows every line of a long new file when asked for all rows', () => {
    const diff = { path: 'run.sh', oldText: null, newText: lines(700, 'step') };
    render(<DiffView diff={diff} badge="New" allRows />);
    act(() => FakeWorker.all[0]!.answer());
    const body = screen.getByRole('region', { name: 'Changes to run.sh' });
    expect(body.querySelectorAll('.dv-row.add')).toHaveLength(700);
    expect(screen.queryByRole('button', { name: /more lines/ })).toBeNull();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.queryByText('New file')).toBeNull();
  });

  it('diffs a small change right away, without a worker', () => {
    render(<DiffView diff={{ path: 'notes.txt', oldText: 'a\nb\n', newText: 'a\nc\n' }} />);
    expect(screen.getByRole('region', { name: 'Changes to notes.txt' }).textContent).toContain('c');
    expect(FakeWorker.all).toEqual([]);
  });

  it('diffs a large rewrite off the main thread and shows a skeleton meanwhile', () => {
    const diff = { path: 'big.ts', oldText: lines(100, 'old'), newText: lines(100, 'new') };
    render(<DiffView diff={diff} />);
    const body = screen.getByRole('region', { name: 'Changes to big.ts' });
    expect(body.getAttribute('aria-busy')).toBe('true');
    expect(body.querySelectorAll('.dv-row')).toHaveLength(0);
    const [worker] = FakeWorker.all;
    expect(worker!.jobs).toEqual([{ oldText: diff.oldText, newText: diff.newText }]);

    act(() => worker!.answer());
    expect(body.getAttribute('aria-busy')).toBeNull();
    expect(body.querySelectorAll('.dv-row').length).toBeGreaterThan(0);
    expect(screen.getByText('+100')).toBeTruthy();
    expect(worker!.terminated).toBe(true);
  });

  it('stops the worker when the diff goes away before it answers', () => {
    const diff = { path: 'big.ts', oldText: lines(100, 'old'), newText: lines(100, 'new') };
    const { unmount } = render(<DiffView diff={diff} />);
    unmount();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
  });
});
