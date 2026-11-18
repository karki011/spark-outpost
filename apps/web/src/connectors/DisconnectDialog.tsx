import './disconnect-dialog.css';
import { useId } from 'react';
import { ModalFrame } from '../ui/ModalFrame.tsx';

export interface DisconnectCopy {
  title: string;
  text: string;
}

interface DisconnectDialogProps {
  copy: DisconnectCopy;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DisconnectDialog({
  copy,
  confirmLabel = 'Disconnect',
  onCancel,
  onConfirm,
}: DisconnectDialogProps) {
  const titleId = useId();
  const textId = useId();
  return (
    <ModalFrame
      className="cx-confirm"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={textId}
      footClassName="cx-confirm-foot"
      foot={
        <>
          <button type="button" className="btn line sm" data-autofocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn sm cx-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
      onClose={onCancel}
    >
      <h3 id={titleId}>{copy.title}</h3>
      <p id={textId}>{copy.text}</p>
    </ModalFrame>
  );
}
