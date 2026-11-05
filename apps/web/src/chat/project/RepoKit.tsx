import './repo-kit.css';
import { useId, useState, type CSSProperties } from 'react';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { Project } from '@spark-outpost/contracts';
import { useReducedMotion } from '../../ui/motion.ts';
import { useOpenFile } from './file-sheet/FileSheet.tsx';
import { kitShelves, type KitKind, type KitShelf } from './repo-kit.ts';
import { SetupList } from './SetupCard.tsx';
import { useAgentConfig } from './use-agent-config.ts';

function KitTile({
  shelf,
  index,
  open,
  panelId,
  onToggle,
}: {
  shelf: KitShelf;
  index: number;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const reduced = useReducedMotion();
  let expression = expressions.idle;
  if (!shelf.on) expression = expressions.sleepy;
  else if (open) expression = expressions.happy;
  return (
    <button
      type="button"
      className="kit-tile"
      data-off={!shelf.on || undefined}
      aria-expanded={open}
      aria-controls={panelId}
      style={{ '--i': index } as CSSProperties}
      onClick={onToggle}
    >
      <span className="kit-blob">
        <Blobatar
          name={`kit:${shelf.kind}`}
          hue={shelf.hue}
          size={38}
          animate={reduced ? 'hover' : 'always'}
          expression={expression}
          aria-hidden="true"
        />
        <b className="kit-count">{shelf.items.length}</b>
      </span>
      <span className="kit-label">{shelf.label}</span>
      {!shelf.on && <small className="kit-off">off</small>}
    </button>
  );
}

export function RepoKit({ project }: { project: Project }) {
  const config = useAgentConfig(project.id);
  const openFile = useOpenFile();
  const [openKind, setOpenKind] = useState<KitKind | null>(null);
  const panelId = useId();
  if (!config.data) return null;
  const shelves = kitShelves(config.data);
  if (shelves.length === 0) return null;
  const shelf = shelves.find((candidate) => candidate.kind === openKind) ?? null;
  const onOpen = openFile ? (path: string) => openFile(project.id, path) : undefined;

  return (
    <section className="kit" aria-label={`What ${project.name} gives the agents`}>
      <p className="kit-lede">Scout unpacked {project.name}</p>
      <div className="kit-tiles">
        {shelves.map((candidate, index) => (
          <KitTile
            key={candidate.kind}
            shelf={candidate}
            index={index}
            open={candidate.kind === openKind}
            panelId={panelId}
            onToggle={() => setOpenKind(candidate.kind === openKind ? null : candidate.kind)}
          />
        ))}
      </div>
      <div id={panelId} className="kit-shelf" hidden={!shelf}>
        {shelf && (
          <>
            {!shelf.on && (
              <p className="kit-note">
                Off for this project. Turn it on from Agent setup, next to the model picker.
              </p>
            )}
            <SetupList
              key={shelf.kind}
              label={shelf.label.toLowerCase()}
              items={shelf.items}
              preview={6}
              onOpen={onOpen}
            />
          </>
        )}
      </div>
    </section>
  );
}
