// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { droppedPathText, followTerminalDrops } from './terminal-drop.ts';

afterEach(() => {
  delete (window as { sparkDesktop?: unknown }).sparkDesktop;
  document.body.replaceChildren();
});

it('inserts multiple original file and folder paths as quoted input without Enter', () => {
  const files = [new File([], 'file'), new File([], 'folder')];
  const paths = ['/tmp/my file.txt', "/tmp/a'b;$()`folder"];
  expect(droppedPathText(files, (file) => paths[files.indexOf(file)] ?? null)).toBe(
    "'/tmp/my file.txt' '/tmp/a'\\''b;$()`folder' ",
  );
});

it('rejects missing native paths and control characters without partial input', () => {
  const files = [new File([], 'file')];
  for (const path of [null, 'file.txt'])
    expect(() => droppedPathText(files, () => path)).toThrow('Mac app');
  for (const character of ['\r', '\n', '\x1b', '\x00', '\x7f'])
    expect(() => droppedPathText(files, () => `/tmp/a${character}b`)).toThrow('control characters');
});

it('consumes terminal file drops before chat attachments and cleans up listeners', () => {
  (window as { sparkDesktop?: unknown }).sparkDesktop = {
    island: { pathForFile: (file: File) => `/tmp/${file.name}` },
  };
  const parent = document.createElement('div');
  const terminal = document.createElement('div');
  parent.append(terminal);
  document.body.append(parent);
  const chatDrop = vi.fn();
  parent.addEventListener('drop', chatDrop);
  const chatLeave = vi.fn();
  parent.addEventListener('dragleave', chatLeave);
  const paste = vi.fn();
  const error = vi.fn();
  const dispose = followTerminalDrops(terminal, paste, error);
  const dataTransfer = {
    types: ['Files'],
    files: [new File([], 'project folder')],
    dropEffect: '',
  };
  fireEvent.dragOver(terminal, { dataTransfer });
  expect(terminal.dataset.fileDrag).toBe('true');
  fireEvent.dragLeave(terminal, { dataTransfer });
  expect(chatLeave).not.toHaveBeenCalled();
  expect(terminal.dataset.fileDrag).toBeUndefined();
  fireEvent.drop(terminal, { dataTransfer });
  expect(paste).toHaveBeenCalledWith("'/tmp/project folder' ");
  expect(chatDrop).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(terminal.dataset.fileDrag).toBeUndefined();
  dispose();
  fireEvent.drop(terminal, { dataTransfer });
  expect(paste).toHaveBeenCalledTimes(1);
  expect(chatDrop).toHaveBeenCalledTimes(1);
});

it('reports an unavailable native path without pasting a filename', () => {
  const terminal = document.createElement('div');
  const paste = vi.fn();
  const error = vi.fn();
  const dispose = followTerminalDrops(terminal, paste, error);
  fireEvent.drop(terminal, { dataTransfer: { types: ['Files'], files: [new File([], 'file')] } });
  expect(paste).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.stringContaining('Mac app'));
  dispose();
});
