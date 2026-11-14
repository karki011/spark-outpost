import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CrewFileEntry } from '@spark-outpost/contracts';
import { ChevronIcon, FileIcon, FolderIcon, PenIcon, WarnIcon } from '../ui/icons.tsx';
import { buildTree, treeRows, type TreeRow } from './folder-model.ts';

interface FileTreeProps {
  label: string;
  files: readonly CrewFileEntry[];
  selected: string | null;
  edited: ReadonlySet<string>;
  problems: ReadonlySet<string>;
  onSelect: (path: string) => void;
}

export function FileTree({ label, files, selected, edited, problems, onSelect }: FileTreeProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const rows = useMemo(() => treeRows(buildTree(files), closed), [files, closed]);
  const current =
    rows.find((row) => row.node.path === focused) ??
    rows.find((row) => row.node.path === selected) ??
    rows[0];

  const focusRow = (row: TreeRow | undefined) => {
    if (!row) return;
    setFocused(row.node.path);
    items.current.get(row.node.path)?.focus();
  };
  const toggle = (path: string, open: boolean) => {
    const next = new Set(closed);
    if (open) next.delete(path);
    else next.add(path);
    setClosed(next);
  };
  const activate = (row: TreeRow) => {
    setFocused(row.node.path);
    if (row.node.kind === 'folder') toggle(row.node.path, !row.open);
    else onSelect(row.node.path);
  };
  const parentOf = (row: TreeRow) => {
    const cut = row.node.path.lastIndexOf('/');
    return cut < 0
      ? undefined
      : rows.find((entry) => entry.node.path === row.node.path.slice(0, cut));
  };

  const onKeyDown = (event: KeyboardEvent, row: TreeRow, index: number) => {
    const folder = row.node.kind === 'folder';
    const moves: Record<string, () => void> = {
      ArrowDown: () => focusRow(rows[index + 1]),
      ArrowUp: () => focusRow(rows[index - 1]),
      Home: () => focusRow(rows[0]),
      End: () => focusRow(rows.at(-1)),
      ArrowRight: () => {
        if (folder && !row.open) toggle(row.node.path, true);
        else if (folder) focusRow(rows[index + 1]);
      },
      ArrowLeft: () => {
        if (folder && row.open) toggle(row.node.path, false);
        else focusRow(parentOf(row));
      },
      Enter: () => activate(row),
      ' ': () => activate(row),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  return (
    <ul className="spk-tree" role="tree" aria-label={label}>
      {rows.map((row, index) => {
        const { node } = row;
        const folder = node.kind === 'folder';
        return (
          <li
            key={node.path}
            ref={(element) => {
              if (element) items.current.set(node.path, element);
              else items.current.delete(node.path);
            }}
            role="treeitem"
            className="spk-tree-row"
            style={{ paddingInlineStart: 8 + row.depth * 16 }}
            aria-level={row.depth + 1}
            aria-expanded={folder ? row.open : undefined}
            aria-selected={folder ? undefined : node.path === selected}
            tabIndex={node.path === current?.node.path ? 0 : -1}
            onClick={() => activate(row)}
            onKeyDown={(event) => onKeyDown(event, row, index)}
          >
            <span
              className={row.open ? 'spk-tree-twist open' : 'spk-tree-twist'}
              aria-hidden="true"
            >
              {folder && <ChevronIcon />}
            </span>
            <span className="spk-tree-icon" aria-hidden="true">
              {folder ? <FolderIcon /> : <FileIcon />}
            </span>
            <span className="spk-tree-name">{node.name}</span>
            {problems.has(node.path) && (
              <span className="spk-mark problem">
                <WarnIcon /> Problem
              </span>
            )}
            {edited.has(node.path) && (
              <span className="spk-mark">
                <PenIcon /> Edited
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
