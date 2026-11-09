import './browser-pane.css';
import { useRef, useState } from 'react';
import type { BrowserShot } from '@spark-outpost/contracts';
import { attachmentUrl } from '../api/attachments.ts';
import { ImageLightbox } from '../chat/attachments/ImageLightbox.tsx';
import { shotCaption, thumbSize } from './shot-order.ts';

export function BrowserShots({ shots }: { shots: readonly BrowserShot[] }) {
  const [opened, setOpened] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  if (shots.length === 0) return null;
  const shown = shots.findIndex((shot) => shot.id === opened);
  const images = shots.map((shot) => ({
    name: shot.attachment.name,
    src: attachmentUrl(shot.attachment.id),
    alt: `Screenshot of ${shot.title || shot.page}`,
  }));
  const close = () => {
    setOpened(null);
    opener.current?.focus();
  };
  return (
    <div className="shot-list">
      {shots.map((shot) => {
        const size = thumbSize(shot.width, shot.height);
        const subject = shot.title || shot.page;
        return (
          <figure key={shot.id} className="shot" style={{ width: size.width }}>
            <button
              type="button"
              aria-label={`Open screenshot of ${subject}`}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpened(shot.id);
              }}
            >
              <img
                src={attachmentUrl(shot.attachment.id)}
                alt={`Screenshot of ${subject}`}
                width={size.width}
                height={size.height}
                loading="lazy"
              />
            </button>
            <figcaption title={shot.page}>{shotCaption(shot.page)}</figcaption>
          </figure>
        );
      })}
      {shown >= 0 && (
        <ImageLightbox {...images[shown]!} images={images} index={shown} onClose={close} />
      )}
    </div>
  );
}
