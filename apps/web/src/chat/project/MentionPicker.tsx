import { FileList } from './FileList.tsx';
import type { FileSearch, RepoFile } from './use-file-search.ts';

interface MentionPickerProps {
  listId: string;
  left: number;
  search: FileSearch;
  attached: ReadonlySet<string>;
  onPick: (file: RepoFile) => void;
}

const PANEL_WIDTH = 340;

export function MentionPicker({ listId, left, search, attached, onPick }: MentionPickerProps) {
  return (
    <div
      className="mpop left filepop mentionpop open"
      style={{ left: `clamp(0px, ${left}px, calc(100% - ${PANEL_WIDTH}px))` }}
    >
      <FileList id={listId} search={search} attached={attached} onPick={onPick} />
    </div>
  );
}
