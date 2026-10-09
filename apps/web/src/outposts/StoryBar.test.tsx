// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryBar } from './StoryBar.tsx';
import { pull, stackedStory, story, task } from './story-fixtures.ts';
import { API_CHAT, DOCS_CHAT } from './test-fixtures.ts';

afterEach(cleanup);

function renderBar(stories = [stackedStory()]) {
  const handlers = {
    onOpenChat: vi.fn<(id: string) => void>(),
    onFill: vi.fn<(text: string) => void>(),
  };
  render(<StoryBar stories={stories} {...handlers} />);
  return handlers;
}

describe('StoryBar', () => {
  it('renders nothing without a story', () => {
    renderBar([]);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('is one collapsed line per story that opens to its ordered sub-tasks', () => {
    renderBar();
    const bar = screen.getByRole('region', { name: 'Stories' });
    const disclosure = bar.querySelector('details')!;
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelector('summary')?.textContent).toBe(
      'StoryCheckout1 of 2 answered · 2 PRs · 2 warnings',
    );
    const rows = within(screen.getByRole('list', { name: 'Sub-tasks of Checkout' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((row) => row.querySelector('.op-story-handle')?.textContent)).toEqual([
      '@api',
      '@fe',
    ]);
    expect(within(rows[0]!).getByText('Answered')).toBeTruthy();
    expect(within(rows[1]!).getByText('on @api')).toBeTruthy();
    expect(within(rows[1]!).getByText('Waiting for @api')).toBeTruthy();
  });

  it('links each pull request and says what it targets', () => {
    renderBar();
    const link = screen.getByRole('link', { name: 'Pull request #124 into #123, open' });
    expect(link.getAttribute('href')).toBe('https://github.com/acme/shop/pull/124');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('#124 → #123');
    expect(screen.getByRole('link', { name: 'Pull request #123 into main, open' })).toBeTruthy();
  });

  it('marks a merged pull request and never links an address that is not on the web', () => {
    renderBar([
      story([
        task(API_CHAT, 'api', {
          pullRequest: { ...pull(7, 'main', 'merged'), url: 'javascript:alert(1)' },
        }),
      ]),
    ]);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Pull request #7 into main, merged')).toBeTruthy();
    expect(document.querySelector('.op-pr-mark')?.textContent).toBe('merged');
  });

  it('shows warnings as text and offers the message for the ones a merge fixes', () => {
    const { onFill, onOpenChat } = renderBar();
    expect(screen.getByText('@api has commits that @fe does not have')).toBeTruthy();
    expect(screen.getByText("@api's branch is not pushed, so @fe cannot push")).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Update from/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Update from @api' }));
    expect(onFill).toHaveBeenCalledWith(
      '@fe merge spark/api-1 into your branch, fix any conflicts and run the checks.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open @api in chat' }));
    expect(onOpenChat).toHaveBeenCalledWith(API_CHAT);
  });

  it('keeps two stories apart', () => {
    renderBar([
      stackedStory(),
      story([task(DOCS_CHAT, 'docs')], { draftId: null, title: 'Docs sweep' }),
    ]);
    expect(screen.getByRole('list', { name: 'Sub-tasks of Docs sweep' })).toBeTruthy();
    expect(document.querySelectorAll('details')).toHaveLength(2);
  });
});
