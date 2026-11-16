import '../../sparks-page/spark-files.css';
import { useMemo, useState, type ReactNode } from 'react';
import { FileTree } from '../../sparks-page/FileTree.tsx';
import { buildTree, treeRows } from '../../sparks-page/folder-model.ts';

export interface ReviewFile {
  path: string;
  badge: string;
  bytes: number;
  view: ReactNode;
}

interface ReviewFilesProps {
  files: readonly ReviewFile[];
  withInstructions?: boolean;
}

function treeOrder(files: readonly ReviewFile[], withInstructions: boolean): string[] {
  const entries = files.map((file) => ({ path: file.path, bytes: file.bytes }));
  const changed = new Set(files.map((file) => file.path));
  return treeRows(buildTree(entries, withInstructions), new Set())
    .map((row) => row.node.path)
    .filter((path) => changed.has(path));
}

export function ReviewFiles({ files, withInstructions = false }: ReviewFilesProps) {
  const [first] = useState(() => treeOrder(files, withInstructions)[0] ?? null);
  const [selected, setSelected] = useState(first);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(first ? [first] : []));
  const entries = useMemo(
    () => files.map((file) => ({ path: file.path, bytes: file.bytes })),
    [files],
  );
  const badges = useMemo(() => new Map(files.map((file) => [file.path, file.badge])), [files]);
  const shown = files.find((file) => file.path === selected) ?? files[0];
  const select = (path: string) => {
    setSelected(path);
    setSeen((before) => new Set(before).add(path));
  };
  return (
    <div className="rvf">
      <div className="rvf-side">
        <p className="rvf-count" role="status">
          {seen.size} of {files.length} {files.length === 1 ? 'file' : 'files'} read
        </p>
        <FileTree
          label="Files in this change"
          files={entries}
          selected={shown?.path ?? null}
          badges={badges}
          seen={seen}
          withInstructions={withInstructions}
          onSelect={select}
        />
      </div>
      <div className="rvf-main">{shown?.view}</div>
    </div>
  );
}
