import './file-sheet.css';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { projectKeys, projectsApi } from '../../../api/projects.ts';
import { BlobScout } from '../../../brand/BlobScout.tsx';
import { CopyIcon } from '../../../ui/icons.tsx';
import { Segmented } from '../../../ui/Segmented.tsx';
import { slide } from '../../../ui/transitions.tsx';
import { copyButtonText, useCopyFeedback } from '../../../ui/use-copy-feedback.ts';
import { CodeBlock } from '../../markdown/CodeBlock.tsx';
import { Markdown } from '../../markdown/Markdown.tsx';
import { isMarkdown, languageOf, splitFrontMatter } from './front-matter.ts';

interface OpenFile {
  projectId: string;
  path: string;
}

type OpenFileFn = (projectId: string, path: string) => void;

const FileSheetContext = createContext<OpenFileFn | null>(null);

export function useOpenFile(): OpenFileFn | null {
  return use(FileSheetContext);
}

const VIEWS = [
  { id: 'preview', label: 'Preview' },
  { id: 'source', label: 'Source' },
];

function fileName(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/');
  return slash < 0
    ? { name: path, folder: '' }
    : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

function FileBody({ file, view }: { file: OpenFile; view: string }) {
  const content = useQuery({
    queryKey: projectKeys.file(file.projectId, file.path),
    queryFn: () => projectsApi.file(file.projectId, file.path),
  });
  if (content.isPending) {
    return (
      <div className="fs-state" role="status">
        <BlobScout size={40} mood="working" />
        <p>Opening {fileName(file.path).name}…</p>
      </div>
    );
  }
  if (content.isError) {
    return (
      <div className="fs-state" role="alert">
        <BlobScout size={40} mood="sad" />
        <p>{content.error.message}</p>
      </div>
    );
  }
  const text = content.data.text;
  if (view === 'source' || !isMarkdown(file.path)) {
    return (
      <div className="fs-source">
        <CodeBlock code={text} language={languageOf(file.path)} streaming={false} />
      </div>
    );
  }
  const { properties, body } = splitFrontMatter(text);
  return (
    <>
      {properties.length > 0 && (
        <dl className="fs-props">
          {properties.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {body.trim() ? <Markdown text={body} /> : <p className="fs-blank">This file is empty.</p>}
    </>
  );
}

function CopyFile({ file }: { file: OpenFile }) {
  const content = useQuery({
    queryKey: projectKeys.file(file.projectId, file.path),
    queryFn: () => projectsApi.file(file.projectId, file.path),
  });
  const { state, copy } = useCopyFeedback();
  return (
    <button
      type="button"
      className="btn sm line fs-copy"
      disabled={!content.data}
      onClick={() => content.data && copy(content.data.text)}
    >
      <CopyIcon />
      {copyButtonText(state)}
    </button>
  );
}

function Sheet({ file, onClose }: { file: OpenFile; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState('preview');
  const { name, folder } = fileName(file.path);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  return (
    <motion.aside
      ref={panelRef}
      className="fsheet"
      role="dialog"
      aria-label={`${name} preview`}
      tabIndex={-1}
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={slide}
    >
      <header className="fs-head">
        <span className="fs-title">
          <b title={file.path}>{name}</b>
          {folder && <small title={folder}>{folder}</small>}
        </span>
        <button type="button" className="icon-btn" aria-label="Close preview" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      <div className="fs-tools">
        {isMarkdown(file.path) ? (
          <Segmented
            ariaLabel="Show as"
            options={VIEWS}
            value={view}
            onChange={(id) => setView(id)}
          />
        ) : (
          <span />
        )}
        <CopyFile file={file} />
      </div>
      <div className="fs-body">
        <FileBody file={file} view={view} />
      </div>
    </motion.aside>
  );
}

export function FileSheetProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<OpenFile | null>(null);
  const open = useCallback<OpenFileFn>((projectId, path) => setFile({ projectId, path }), []);
  const close = useCallback(() => setFile(null), []);
  return (
    <FileSheetContext value={open}>
      {children}
      {createPortal(
        <AnimatePresence>
          {file && <Sheet key={`${file.projectId}:${file.path}`} file={file} onClose={close} />}
        </AnimatePresence>,
        document.body,
      )}
    </FileSheetContext>
  );
}
