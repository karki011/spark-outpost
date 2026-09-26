import { useEffect, useRef } from 'react';
import type { Attachment } from '@spark-outpost/contracts';
import { attachmentUrl } from '../../api/attachments.ts';
import { XIcon } from '../../ui/icons.tsx';

export function ImageLightbox({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label={attachment.name}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <figure>
        <img src={attachmentUrl(attachment.id)} alt={attachment.name} />
        <figcaption>
          <a href={attachmentUrl(attachment.id)} target="_blank" rel="noopener noreferrer">
            {attachment.name}
          </a>
        </figcaption>
      </figure>
      <button
        type="button"
        className="icon-btn lightbox-x"
        aria-label="Close"
        autoFocus
        onClick={() => dialog.current?.close()}
      >
        <XIcon />
      </button>
    </dialog>
  );
}
