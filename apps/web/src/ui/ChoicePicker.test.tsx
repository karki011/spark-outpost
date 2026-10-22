// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChoicePicker } from './ChoicePicker.tsx';

afterEach(cleanup);

const CHOICES = [
  { id: '', label: 'No project' },
  { id: 'web', label: 'web' },
];

function renderPicker(onSelect = vi.fn(), disabled = false) {
  const onChange = vi.fn();
  render(
    <ChoicePicker
      label="Project folder"
      choices={CHOICES}
      value=""
      actions={[
        { id: 'add-folder', label: 'Add folder…', description: 'On this Mac', disabled, onSelect },
      ]}
      onChange={onChange}
    />,
  );
  return { onChange, onSelect };
}

describe('ChoicePicker trailing actions', () => {
  it('reaches the action last with the arrow keys and runs it with focus back on the trigger', () => {
    const { onSelect, onChange } = renderPicker();
    const trigger = screen.getByRole('button', { name: 'Project folder' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Project folder' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'No project' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const action = screen.getByRole('menuitem', { name: /Add folder…/ });
    expect(document.activeElement).toBe(action);
    fireEvent.click(action);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a disabled action visible with its reason', () => {
    renderPicker(vi.fn(), true);
    fireEvent.click(screen.getByRole('button', { name: 'Project folder' }));
    const action = screen.getByRole('menuitem', { name: /Add folder…/ });
    expect(action).toHaveProperty('disabled', true);
    expect(action.textContent).toContain('On this Mac');
  });

  it('shows an error under the trigger', () => {
    render(
      <ChoicePicker
        label="Project folder"
        choices={CHOICES}
        value=""
        error="Choose a project folder, not your whole disk or home folder."
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('not your whole disk');
  });
});
