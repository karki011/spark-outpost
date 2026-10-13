// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  SelectionToolbar,
  ToolbarButton,
  ToolbarNote,
  ToolbarSeparator,
} from './SelectionToolbar.tsx';

afterEach(cleanup);

function buttons(onClick = () => undefined) {
  return (
    <SelectionToolbar ref={() => undefined} commenting={false}>
      <ToolbarButton icon={null} label="First" title="First (⌘⇧A)" onClick={onClick} />
      <ToolbarButton icon={null} label="Second" title="Second" onClick={onClick} />
      <ToolbarSeparator />
      <ToolbarButton icon={null} label="Copied" title="Copy" live onClick={onClick} />
    </SelectionToolbar>
  );
}

it('is a labelled toolbar whose buttons keep the selection when pressed', () => {
  const onClick = vi.fn();
  render(buttons(onClick));
  const first = screen.getByRole('button', { name: 'First' });
  expect(screen.getByRole('toolbar', { name: 'Selected text' }).contains(first)).toBe(true);
  expect(first.getAttribute('title')).toBe('First (⌘⇧A)');
  expect(fireEvent.mouseDown(first)).toBe(false);
  fireEvent.click(first);
  expect(onClick).toHaveBeenCalledOnce();
});

it('announces only the label marked live', () => {
  render(buttons());
  expect(screen.getByText('Copied').getAttribute('aria-live')).toBe('polite');
  expect(screen.getByText('First').getAttribute('aria-live')).toBeNull();
});

it('moves focus with the arrow keys, Home and End, wrapping at the ends', () => {
  render(buttons());
  const [first, second, last] = screen.getAllByRole('button');
  first!.focus();
  fireEvent.keyDown(first!, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last!, { key: 'Home' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second!, { key: 'End' });
  expect(document.activeElement).toBe(last);
});

it('takes a note, lets the pointer into its input and reports submit and cancel', () => {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <SelectionToolbar ref={() => undefined} commenting>
      <ToolbarNote
        label="Comment on the selected text"
        submitLabel="Save"
        value="so far"
        onChange={onChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </SelectionToolbar>,
  );
  const input = screen.getByRole('textbox', { name: 'Comment on the selected text' });
  expect(document.activeElement).toBe(input);
  expect(fireEvent.mouseDown(input)).toBe(true);
  fireEvent.keyDown(input, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'so far, so good' } });
  expect(onChange).toHaveBeenCalledWith('so far, so good');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).toHaveBeenCalledOnce();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledOnce();
});
