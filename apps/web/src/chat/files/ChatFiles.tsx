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

function FileOpen({ file, onView }: { file: ChatFile; onView: (file: ChatFile) => void }) {
  if (file.kind === 'image') {
    return (
      <button
        type="button"
        className="chat-file-open"
        aria-label={`View ${file.name}, ${formatBytes(file.size)}`}
        onClick={() => onView(file)}
      >
        <img className="chat-file-thumb" src={fileUrl(file)} alt="" loading="lazy" />
        <span className="att-name">{file.name}</span>
        <small>{formatBytes(file.size)}</small>
      </button>
    );
  }
  return (
    <a className="chat-file-open" href={fileUrl(file)} target="_blank" rel="noopener noreferrer">
      <FileIcon />
      <span className="att-name">{file.name}</span>
      <small>{formatBytes(file.size)}</small>
    </a>
  );
}

function FileChip({ file, onView }: { file: ChatFile; onView: (file: ChatFile) => void }) {
  return (
    <span className="chip att-chip chat-file">
      <FileOpen file={file} onView={onView} />
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
  const [viewing, setViewing] = useState<number | null>(null);
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
  const pictures = files.filter((file) => file.kind === 'image');
  const images = pictures.map((file) => ({ name: file.name, src: fileUrl(file) }));
  return (
    <div className="chat-files" role="group" aria-label="Files from this turn">
      {files.map((file) => (
        <FileChip
          key={file.id}
          file={file}
          onView={(picked) => setViewing(pictures.indexOf(picked))}
        />
      ))}
      {viewing !== null && (
        <ImageLightbox
          {...images[viewing]!}
          images={images}
          index={viewing}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
