import '../attachments/attachments.css';
import './chat-files.css';
import { useState } from 'react';
import { chatFileContentPath, type ChatFile } from '@spark-outpost/contracts';
import { formatBytes } from '../../api/attachments.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { DownloadIcon } from '../../ui/icons.tsx';
import { FileIcon } from '../attachments/attachment-icons.tsx';
import { ImageLightbox } from '../attachments/ImageLightbox.tsx';

function fileUrl(file: ChatFile, download = false): string {
  return `/api${chatFileContentPath(file.id)}${download ? '?download=1' : ''}`;
}

function FileChip({ file }: { file: ChatFile }) {
  return (
    <span className="chip att-chip chat-file">
      <a className="chat-file-open" href={fileUrl(file)} target="_blank" rel="noopener noreferrer">
        <FileIcon />
        <span className="att-name">{file.name}</span>
        <small>{formatBytes(file.size)}</small>
      </a>
      <a
        className="chat-file-save"
        href={fileUrl(file, true)}
        download={file.name}
        aria-label={`Download ${file.name}`}
        title="Download"
      >
        <DownloadIcon />
      </a>
    </span>
  );
}

function FileText({ file }: { file: ChatFile }) {
  return (
    <span className="chip att-chip chat-file">
      <FileIcon />
      <span className="att-name">{file.name}</span>
      <small>{formatBytes(file.size)}</small>
    </span>
  );
}

export function ChatFiles({ files }: { files: readonly ChatFile[] }) {
  const [viewing, setViewing] = useState<ChatFile | null>(null);
  const { remote } = useRemoteClient();
  if (files.length === 0) return null;
  if (remote) {
    return (
      <div className="chat-files" role="group" aria-label="Files from this turn">
        {files.map((file) => (
          <FileText key={file.id} file={file} />
        ))}
      </div>
    );
  }
  return (
    <div className="chat-files" role="group" aria-label="Files from this turn">
      {files.map((file) =>
        file.kind === 'image' ? (
          <button
            key={file.id}
            type="button"
            className="msg-att-img"
            aria-label={`View ${file.name}`}
            onClick={() => setViewing(file)}
          >
            <img src={fileUrl(file)} alt={file.name} loading="lazy" />
          </button>
        ) : (
          <FileChip key={file.id} file={file} />
        ),
      )}
      {viewing && (
        <ImageLightbox
          name={viewing.name}
          src={fileUrl(viewing)}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
