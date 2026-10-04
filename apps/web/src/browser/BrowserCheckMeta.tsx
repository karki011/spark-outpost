import './browser-pane.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ConversationDetail, Run } from '@spark-outpost/contracts';
import { attachmentUrl } from '../api/attachments.ts';
import { ImageLightbox } from '../chat/attachments/ImageLightbox.tsx';
import { diffApi, diffKeys } from '../diff/diff-api.ts';
import { browserCheckOf, keptChanges, turnRequest, turnShots } from './browser-check.ts';
import { browserAvailable } from './browser-store.ts';

interface BrowserCheckMetaProps {
  detail: ConversationDetail;
  run: Run;
  taskId: string | null;
  runIds: readonly string[];
}

export function BrowserCheckMeta({ detail, run, taskId, runIds }: BrowserCheckMetaProps) {
  const [open, setOpen] = useState(false);
  const shots = turnShots(detail, run.id);
  const paneAvailable = browserAvailable();
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId ?? ''),
    enabled: taskId !== null && shots.length === 0 && paneAvailable,
  });
  const check = browserCheckOf({
    shots,
    request: turnRequest(detail, run),
    changed: keptChanges(summary.data, runIds),
    paneAvailable,
  });
  if (!check) return null;
  if (check.state === 'not_checked') {
    return (
      <div className="run-meta browser-check">
        <span>Not checked in browser</span>
      </div>
    );
  }
  const { shot } = check;
  return (
    <div className="run-meta browser-check">
      <button
        type="button"
        className="browser-check-shot"
        aria-label={`Checked in browser. Open the screenshot of ${shot.title || shot.page}`}
        onClick={() => setOpen(true)}
      >
        <img src={attachmentUrl(shot.attachment.id)} alt="" loading="lazy" />
        <span>Checked in browser</span>
      </button>
      {open && <ImageLightbox attachment={shot.attachment} onClose={() => setOpen(false)} />}
    </div>
  );
}
