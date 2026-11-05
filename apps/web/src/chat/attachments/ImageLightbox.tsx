import { useEffect, useRef, useState } from 'react';
import { XIcon } from '../../ui/icons.tsx';

interface ImageLightboxProps {
  name: string;
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImageLightbox({ name, src, alt, onClose }: ImageLightboxProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  const close = () => {
    dialog.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label={alt ?? name}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <figure>
        <div className={full ? 'lightbox-view full' : 'lightbox-view'}>
          <img src={src} alt={alt ?? name} onClick={() => setFull((current) => !current)} />
        </div>
        <figcaption>
          <a href={src} target="_blank" rel="noopener noreferrer">
            {name}
          </a>
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
