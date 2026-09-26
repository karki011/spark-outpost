import './attachments.css';
import { useState } from 'react';
import type { Attachment } from '@spark-outpost/contracts';
import { attachmentUrl, formatBytes } from '../../api/attachments.ts';
import { FileIcon } from './attachment-icons.tsx';
import { ImageLightbox } from './ImageLightbox.tsx';

export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <div className="msg-atts" role="group" aria-label="Attachments">
      {attachments.map((attachment) =>
        attachment.kind === 'image' ? (
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
      {viewing && <ImageLightbox attachment={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
