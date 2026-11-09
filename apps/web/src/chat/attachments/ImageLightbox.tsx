import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BackIcon, ForwardIcon, XIcon } from '../../ui/icons.tsx';

export interface LightboxImage {
  name: string;
  src: string;
  alt?: string;
}

interface ImageLightboxProps extends LightboxImage {
  images?: readonly LightboxImage[];
  index?: number;
  onClose: () => void;
}

function typingIn(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function stepFor(event: KeyboardEvent): number {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  if (typingIn(event.target)) return 0;
  if (event.key === 'ArrowLeft') return -1;
  if (event.key === 'ArrowRight') return 1;
  return 0;
}

export function ImageLightbox({ name, src, alt, images, index = 0, onClose }: ImageLightboxProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [full, setFull] = useState(false);
  const [wanted, setWanted] = useState(index);
  const list = images && images.length > 0 ? images : [{ name, src, alt }];
  const at = Math.max(0, Math.min(wanted, list.length - 1));
  const image = list[at]!;
  const label = image.alt ?? image.name;
  const several = list.length > 1;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const close = () => {
    dialog.current?.close();
    onClose();
  };

  const move = (step: number) => {
    const next = at + step;
    if (next < 0 || next >= list.length) return;
    setWanted(next);
    setFull(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    const step = several ? stepFor(event) : 0;
    if (step === 0) return;
    event.preventDefault();
    move(step);
  };

  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label={label}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <figure>
        <div key={at} className={full ? 'lightbox-view full' : 'lightbox-view'}>
          <img src={image.src} alt={label} onClick={() => setFull((current) => !current)} />
        </div>
        <figcaption>
          <a href={image.src} target="_blank" rel="noopener noreferrer">
            {image.name}
          </a>
          {several && (
            <span className="lightbox-steps">
              <button
                type="button"
                className="icon-btn"
                aria-label="Previous image"
                aria-disabled={at === 0}
                onClick={() => move(-1)}
              >
                <BackIcon />
              </button>
              <span className="lightbox-place" aria-live="polite">
                {at + 1} of {list.length}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Next image"
                aria-disabled={at === list.length - 1}
                onClick={() => move(1)}
              >
                <ForwardIcon />
              </button>
            </span>
          )}
          <button
            type="button"
            className="lightbox-size"
            aria-pressed={full}
            onClick={() => setFull((current) => !current)}
          >
            Full size
          </button>
        </figcaption>
      </figure>
      <button
        type="button"
        className="icon-btn lightbox-x"
        aria-label="Close"
        autoFocus
        onClick={close}
      >
        <XIcon />
      </button>
    </dialog>
  );
}
