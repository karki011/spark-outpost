import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  alreadySharedSchema,
  artifactSharePath,
  artifactShareStatusSchema,
  createdArtifactShareSchema,
  type ArtifactPage,
  type ArtifactShareDays,
  type ArtifactShareStatus,
} from '@spark-outpost/contracts';
import { ApiError, request } from '../../api/client.ts';
import { currentShareTheme } from './share-theme.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { CheckIcon, ExternalLinkIcon } from '../../ui/icons.tsx';
import { ShareConfirmSheet, SharedSheet } from './ShareSheets.tsx';

interface ArtifactShareProps {
  page: ArtifactPage;
  version: number;
}

type Sheet = 'confirm' | 'shared' | null;

const STATUS_STALE_MS = 5 * 60_000;

const MARKDOWN_REASON = 'Markdown artifacts can’t be shared yet. Use Copy or Save as… instead.';

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : 'That didn’t work. Try again.';
}

export function ArtifactShare({ page, version }: ArtifactShareProps) {
  const { remote } = useRemoteClient();
  const client = useQueryClient();
  const reasonId = useId();
  const tip = useTooltip(MARKDOWN_REASON);
  const path = artifactSharePath(page.id, version);
  const queryKey = ['artifact-share', page.id, version];
  const status = useQuery({
    queryKey,
    queryFn: () => request(artifactShareStatusSchema, path),
    enabled: !remote,
    staleTime: STATUS_STALE_MS,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (remote || !status.data?.available) return null;
  const share = status.data.share;
  const entry = page.versions.find((item) => item.version === version);
  const markdown = page.kind === 'markdown';

  const settle = (next: ArtifactShareStatus['share']) =>
    client.setQueryData<ArtifactShareStatus>(queryKey, { available: true, share: next });

  const close = () => {
    setSheet(null);
    setPasscode(null);
    setFailure(null);
    setNotice(null);
    buttonRef.current?.focus();
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  };

  const create = (choice: { expiresInDays: ArtifactShareDays; passcode: boolean }) =>
    run(async () => {
      try {
        const created = await request(createdArtifactShareSchema, path, {
          method: 'POST',
          body: JSON.stringify({ ...choice, theme: currentShareTheme() ?? undefined }),
        });
        settle(created.share);
        setPasscode(created.passcode);
      } catch (error) {
        const already = alreadySharedSchema.safeParse(
          error instanceof ApiError ? error.body : null,
        );
        if (!already.success) throw error;
        settle(already.data.share);
        setPasscode(null);
        setNotice(already.data.error);
      }
      setSheet('shared');
    });

  const stop = () =>
    run(async () => {
      await request(z.null(), path, { method: 'DELETE' });
      settle(null);
      close();
    });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn ghost sm"
        {...(markdown ? tip.triggerProps : {})}
        aria-haspopup="dialog"
        aria-disabled={markdown}
        aria-describedby={markdown ? reasonId : undefined}
        onClick={() => !markdown && setSheet(share ? 'shared' : 'confirm')}
      >
        {share ? <CheckIcon /> : <ExternalLinkIcon />}
        {share ? 'Shared' : 'Share…'}
      </button>
      {markdown && (
        <span id={reasonId} className="sr-only">
          {MARKDOWN_REASON}
        </span>
      )}
      {markdown && tip.tooltip}
      {sheet === 'confirm' && (
        <ShareConfirmSheet
          title={entry?.title ?? page.title}
          version={version}
          bytes={entry?.bytes ?? 0}
          busy={busy}
          failure={failure}
          onCancel={close}
          onCreate={(choice) => void create(choice)}
        />
      )}
      {sheet === 'shared' && share && (
        <SharedSheet
          share={share}
          passcode={passcode}
          notice={notice}
          busy={busy}
          failure={failure}
          onStop={() => void stop()}
          onDone={close}
        />
      )}
    </>
  );
}
