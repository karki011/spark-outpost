import './attachments.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Attachment } from '@spark-outpost/contracts';
import { attachmentUrl, formatBytes } from '../../api/attachments.ts';
import { groupPicks, pickLabel, type PickPair } from '../../browser/pick-files.ts';
import { FileIcon } from './attachment-icons.tsx';
import { ImageLightbox } from './ImageLightbox.tsx';
import { PickChip } from './PickChip.tsx';

async function attachmentText(id: string): Promise<string> {
  const response = await fetch(attachmentUrl(id));
  if (!response.ok) throw new Error(`The server responded with ${response.status}.`);
  return response.text();
}

function SentPick({ pick }: { pick: PickPair<Attachment> }) {
  const note = useQuery({
    queryKey: ['attachment-text', pick.text.id],
    queryFn: () => attachmentText(pick.text.id),
    staleTime: Infinity,
  });
  const label = note.data === undefined ? null : pickLabel(note.data);
  return (
    <PickChip
      label={label ?? (note.isPending ? 'Selected on the page' : pick.text.name)}
      picture={pick.image ? attachmentUrl(pick.image.id) : null}
      text={note.data ?? (note.isError ? 'The note could not be loaded.' : null)}
    />
  );
}

export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <div className="msg-atts" role="group" aria-label="Attachments">
      {groupPicks(attachments).map((attachment) =>
        'text' in attachment ? (
          <SentPick key={attachment.text.id} pick={attachment} />
        ) : attachment.kind === 'image' ? (
          <button
            key={attachment.id}
            type="button"
            className="msg-att-img"
            aria-label={`View ${attachment.name}`}
            onClick={() => setViewing(attachment)}
          >
            <img src={attachmentUrl(attachment.id)} alt={attachment.name} loading="lazy" />
          </button>
        ) : (
          <a
            key={attachment.id}
            className="chip att-chip msg-att-file"
            href={attachmentUrl(attachment.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileIcon />
            <span className="att-name">{attachment.name}</span>
            <small>{formatBytes(attachment.size)}</small>
          </a>
        ),
      )}
      {viewing && (
        <ImageLightbox
          name={viewing.name}
          src={attachmentUrl(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
