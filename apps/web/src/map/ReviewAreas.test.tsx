// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVER, WEB, sampleArea } from './map-samples.ts';
import { ReviewAreas, type ReviewItem } from './ReviewAreas.tsx';

vi.mock('../brand/ProviderBlob.tsx', () => ({ ProviderBlob: () => null }));

afterEach(cleanup);

const items: ReviewItem[] = [
  { key: 'p:server', projectName: null, area: sampleArea(SERVER) },
  { key: 'p:web', projectName: null, area: sampleArea(WEB) },
  {
    key: 'p:mine',
    projectName: null,
    area: {
      ...sampleArea({ ...WEB, id: 'm', root: 'apps/mine' }),
      categorySource: 'override',
      category: 'core',
      confidence: 0.4,
    },
  },
];

function renderReview(onCategory = vi.fn()) {
  render(
    <ReviewAreas
      items={items}
      fileCount={9}
      onClose={() => {}}
      onShow={() => {}}
      onCategory={onCategory}
    />,
  );
  return onCategory;
}

describe('ReviewAreas', () => {
  it('lists the least confident first and asks to check unsure Jev labels', () => {
    renderReview();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => within(row).getAllByRole('button')[0]!.textContent)).toEqual([
      'mine',
      'tickets',
      'tickets',
    ]);
    expect(within(rows[0]!).getByText('You')).toBeTruthy();
    expect(within(rows[0]!).queryByText('Check this')).toBeNull();
    expect(within(rows[1]!).getByText('Check this')).toBeTruthy();
    expect(within(rows[2]!).queryByText('Check this')).toBeNull();
  });

  it('saves a new category and puts Jev’s back on request', () => {
    const onCategory = renderReview();
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(within(rows[1]!).getByRole('radio', { name: 'Shared' }));
    expect(onCategory).toHaveBeenCalledWith('p:web', 'shared');
    fireEvent.click(within(rows[1]!).getByRole('radio', { name: 'Feature' }));
    expect(onCategory).toHaveBeenCalledTimes(1);
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Use Jev’s' }));
    expect(onCategory).toHaveBeenLastCalledWith('p:mine', null);
  });
});
