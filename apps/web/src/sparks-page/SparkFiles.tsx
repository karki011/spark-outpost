import './spark-files.css';
import { useState } from 'react';
import { SPARK_INSTRUCTIONS_FILE } from '@spark-outpost/contracts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { PlusIcon, WarnIcon } from '../ui/icons.tsx';
import { FileEditor } from './FileEditor.tsx';
import { FileTree } from './FileTree.tsx';
import { useEditedPaths } from './file-drafts.ts';
import { parentFolder } from './folder-model.ts';
import { NewFile, NewSkill } from './NewEntry.tsx';
import { useSparkFolder } from './use-crew-files.ts';

interface SparkFilesProps {
  sparkId: string;
  sparkName: string;
}

type Pane = { kind: 'file'; path: string } | { kind: 'new-skill' } | { kind: 'new-file' };

export function SparkFiles({ sparkId, sparkName }: SparkFilesProps) {
  const folder = useSparkFolder(sparkId);
  const edited = useEditedPaths(sparkId);
  const [pane, setPane] = useState<Pane>({ kind: 'file', path: SPARK_INSTRUCTIONS_FILE });
  const [lastPath, setLastPath] = useState(SPARK_INSTRUCTIONS_FILE);
  const open = (path: string) => {
    setLastPath(path);
    setPane({ kind: 'file', path });
  };

  if (folder.isPending) {
    return (
      <Skeleton
        label="Loading the Spark’s folder"
        shape="list"
        rows={4}
        className="spk-code-wait"
      />
    );
  }
  if (folder.isError) {
    return (
      <div className="spk-files-problem" role="alert">
        <p>
          <WarnIcon /> Couldn’t open this Spark’s folder. {folder.error.message}
        </p>
        <button type="button" className="btn line sm" onClick={() => void folder.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const { files, problems } = folder.data;
  const problemAt = (path: string) => problems.find((entry) => entry.path === path)?.text ?? null;
  return (
    <div className="spk-files">
      <div className="spk-files-side">
        <FileTree
          label={`${sparkName}’s folder`}
          files={files}
          selected={pane.kind === 'file' ? pane.path : null}
          edited={edited}
          problems={new Set(problems.map((entry) => entry.path))}
          onSelect={open}
        />
        <div className="spk-files-acts">
          <button
            type="button"
            className="btn line sm"
            onClick={() => setPane({ kind: 'new-skill' })}
          >
            <PlusIcon /> New skill
          </button>
          <button
            type="button"
            className="btn line sm"
            onClick={() => setPane({ kind: 'new-file' })}
          >
            <PlusIcon /> New file
          </button>
        </div>
      </div>
      <div className="spk-files-main">
        {pane.kind === 'new-skill' && (
          <NewSkill
            sparkId={sparkId}
            files={files}
            onCreated={open}
            onCancel={() => open(lastPath)}
          />
        )}
        {pane.kind === 'new-file' && (
          <NewFile
            sparkId={sparkId}
            files={files}
            startFolder={parentFolder(lastPath)}
            onCreated={open}
            onCancel={() => open(lastPath)}
          />
        )}
        {pane.kind === 'file' && (
          <FileEditor
            key={pane.path}
            sparkId={sparkId}
            path={pane.path}
            exists={files.some((file) => file.path === pane.path)}
            files={files}
            folderProblem={problemAt(pane.path)}
            onMoved={open}
            onDeleted={() => open(SPARK_INSTRUCTIONS_FILE)}
          />
        )}
      </div>
    </div>
  );
}
