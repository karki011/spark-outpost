import { useTooltip } from '../ui/Tooltip.tsx';
import { BLOB_LABELS, type BlobKind } from './chat-blob.ts';
import './chat-blob.css';

function Blob({ kind }: { kind: BlobKind }) {
  const label = BLOB_LABELS[kind];
  const tip = useTooltip(label);
  return (
    <>
      <span
        className={`rblob ${kind}`}
        role="img"
        aria-label={label}
        title=""
        data-blob={kind}
        {...tip.triggerProps}
      />
      {tip.tooltip}
    </>
  );
}

export function ChatBlob({ kind }: { kind: BlobKind | null }) {
  return <span className="rblob-slot">{kind && <Blob key={kind} kind={kind} />}</span>;
}
