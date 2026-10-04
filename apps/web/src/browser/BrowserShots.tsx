import { useState } from 'react';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { attachmentUrl } from '../api/attachments.ts';
import { ImageLightbox } from '../chat/attachments/ImageLightbox.tsx';

export function BrowserShots({ detail, runId }: { detail: ConversationDetail; runId: string }) {
  const shots = (detail.browserShots ?? []).filter((shot) => shot.turnRunId === runId);
  const [opened, setOpened] = useState<string | null>(null);
  if (shots.length === 0) return null;
  const shown = shots.find((shot) => shot.id === opened);
  return (
    <div className="shot-list">
      {shots.map((shot) => (
        <figure key={shot.id} className="shot">
          <button
            type="button"
            aria-label={`Open screenshot of ${shot.title || shot.page}`}
            onClick={() => setOpened(shot.id)}
          >
            <img
              src={attachmentUrl(shot.attachment.id)}
              alt={`Screenshot of ${shot.title || shot.page}`}
              loading="lazy"
            />
          </button>
          <figcaption>Screenshot · {shot.page}</figcaption>
        </figure>
      ))}
      {shown && <ImageLightbox attachment={shown.attachment} onClose={() => setOpened(null)} />}
    </div>
  );
}
