import './map-empty.css';
import { useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectKeys, projectsApi } from '../api/projects.ts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { FolderDialog } from '../chat/project/FolderDialog.tsx';
import { useVoice } from '../spark/use-voice.ts';
import { mapIntro } from '../spark/voice.ts';
import { PlusIcon } from '../ui/icons.tsx';
import { InfoTip } from '../ui/InfoTip.tsx';
import { SkyDoodle } from './SkyDoodle.tsx';

interface Feature {
  title: string;
  text: string;
  blob: ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: 'See the shape of a repo',
    text: 'Each area of your code becomes a constellation of its files.',
    blob: <BlobScout size={30} />,
  },
  {
    title: 'Know what’s Core',
    text: 'Jev labels areas like auth, data and payments. You can correct it.',
    blob: <ProviderBlob providerId="jev" size={32} />,
  },
  {
    title: 'See what a chat changed',
    text: 'Files a chat touched light up, plus the files that depend on them.',
    blob: <ProviderBlob providerId="claude" size={32} />,
  },
  {
    title: 'Link frontend and backend',
    text: 'Pick two repos to see where API calls meet their routes.',
    blob: (
      <span className="mh-pair">
        <ProviderBlob providerId="codex" size={26} />
        <ProviderBlob providerId="zai" size={26} />
      </span>
    ),
  },
];

const PRIVACY =
  'To name areas, Jev may read a few files from each one. Secret files such as .env files and keys, and anything in .sparkignore, are never sent.';

export type ProjectListView = 'map' | 'empty' | 'unreachable';

export function projectListView(list: {
  status: 'pending' | 'error' | 'success';
  data: readonly unknown[] | undefined;
}): ProjectListView {
  if (list.data && list.data.length > 0) return 'map';
  if (list.status === 'error') return 'unreachable';
  if (list.status === 'success') return 'empty';
  return 'map';
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="page map" aria-label="Project map">
      <div className="map-hello">
        <div className="mh">{children}</div>
      </div>
    </main>
  );
}

export function MapEmpty() {
  const voice = useVoice();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const addProject = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: async () => {
      setAdding(false);
      await client.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
  return (
    <Shell>
      <SkyDoodle />
      <h1 className="mh-title">Your code, as a night sky</h1>
      <p className="mh-lede">{mapIntro(voice)}</p>
      <ul className="mh-cards">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="mh-card">
            <span className="mh-card-blob" aria-hidden="true">
              {feature.blob}
            </span>
            <h2>{feature.title}</h2>
            <p>{feature.text}</p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn primary mh-add"
        onClick={() => {
          addProject.reset();
          setAdding(true);
        }}
      >
        <PlusIcon />
        Add a project
      </button>
      <p className="mh-note">
        Maps build in the background and never slow down chats. Jev may read file contents to label
        areas, never secret files.
        <InfoTip
          topic="what Jev reads"
          text={PRIVACY}
          doc={{ page: 'privacy-and-secrets', heading: 'sparkignore' }}
        />
      </p>
      <AnimatePresence>
        {adding && (
          <FolderDialog
            key="map-add-project"
            linking={addProject.isPending}
            error={addProject.isError ? addProject.error.message : null}
            onUse={(rootPath) => addProject.mutate(rootPath)}
            onClose={() => setAdding(false)}
          />
        )}
      </AnimatePresence>
    </Shell>
  );
}

export function MapUnreachable({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <Shell>
      <span className="mh-lost" aria-hidden="true">
        <BlobScout size={56} mood="sad" />
      </span>
      <h1 className="mh-title">Spark can’t reach its server</h1>
      <p className="mh-lede" role="status">
        {retrying
          ? 'Trying again…'
          : 'It may be restarting. Your projects are safe, and Spark keeps trying every few seconds.'}
      </p>
      <button
        type="button"
        className="btn primary mh-add"
        aria-disabled={retrying || undefined}
        onClick={() => {
          if (!retrying) onRetry();
        }}
      >
        Try again
      </button>
    </Shell>
  );
}
