import { useId, useState } from 'react';
import type { FolderEntry } from '@spark-outpost/contracts';
import { typedFolderPath } from './folder-path.ts';

interface FolderPlacesProps {
  places: readonly FolderEntry[];
  current: string | null;
  onOpen: (path: string) => void;
}

const TYPED_PROBLEM = 'Type a full path, like /Volumes/Work or ~/Code.';

export function FolderPlaces({ places, current, onOpen }: FolderPlacesProps) {
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const home = places.find((place) => place.name === 'Home')?.path ?? null;

  const go = () => {
    const target = typedFolderPath(typed, home);
    if (!target) {
      setProblem(TYPED_PROBLEM);
      return;
    }
    setProblem(null);
    setTyped('');
    onOpen(target);
  };

  return (
    <div className="fdlg-places">
      {places.length > 0 && (
        <nav aria-label="Places">
          {places.map((place) => (
            <button
              key={place.path}
              type="button"
              className="fdlg-place"
              aria-current={place.path === current ? 'location' : undefined}
              title={place.path}
              onClick={() => onOpen(place.path)}
            >
              {place.name}
            </button>
          ))}
        </nav>
      )}
      <form
        className="fdlg-goto"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <input
          className="inp"
          aria-label="Go to folder"
          aria-describedby={problem ? `${ids}problem` : undefined}
          aria-invalid={problem ? true : undefined}
          placeholder="Go to a path, like ~/Code"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setProblem(null);
          }}
        />
      </form>
      {problem && (
        <p className="fdlg-note bad" id={`${ids}problem`} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
