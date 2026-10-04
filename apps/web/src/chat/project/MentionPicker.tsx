import '../../teammates/spark-mention.css';
import { SPARK_MENTION_HINT, type TeammateView } from '@spark-outpost/contracts';
import { TeammateFace } from '../../teammates/TeammateFace.tsx';
import { FileList } from './FileList.tsx';
import type { FileSearch, RepoFile } from './use-file-search.ts';
import { sparkOptionId } from './use-mention.ts';

interface MentionPickerProps {
  listId: string;
  left: number;
  sparks: readonly TeammateView[];
  active: number;
  showsFiles: boolean;
  search: FileSearch;
  attached: ReadonlySet<string>;
  onActive: (index: number) => void;
  onPick: (file: RepoFile) => void;
  onPickSpark: (spark: TeammateView) => void;
}

const PANEL_WIDTH = 340;

export function MentionPicker({
  listId,
  left,
  sparks,
  active,
  showsFiles,
  search,
  attached,
  onActive,
  onPick,
  onPickSpark,
}: MentionPickerProps) {
  return (
    <div
      className="mpop left filepop mentionpop open"
      style={{ left: `clamp(0px, ${left}px, calc(100% - ${PANEL_WIDTH}px))` }}
    >
      {sparks.length > 0 && (
        <>
          <div className="flist sparklist" role="listbox" aria-label="Sparks">
            {sparks.map((spark, index) => (
              <div
                key={spark.id}
                id={sparkOptionId(listId, index)}
                className="fopt sparkopt"
                role="option"
                aria-selected={index === active}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => {
                  if (index !== active) onActive(index);
                }}
                onClick={() => onPickSpark(spark)}
              >
                <TeammateFace face={spark.face} size={20} state={spark.state} />
                <span className="fname">
                  <b>{spark.name}</b>
                  <small>{spark.role || 'Spark'}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="eff-note spark-hint">{SPARK_MENTION_HINT}</p>
        </>
      )}
      {showsFiles && <FileList id={listId} search={search} attached={attached} onPick={onPick} />}
    </div>
  );
}
