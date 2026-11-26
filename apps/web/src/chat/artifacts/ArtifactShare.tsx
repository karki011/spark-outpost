import { useEffect, useId, useRef, useState } from 'react';
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
import { openCloudflareCard } from '../../cloudflare/cloudflare-open.ts';
import { ShareConfirmSheet, ShareConnectSheet, SharedSheet } from './ShareSheets.tsx';

interface ArtifactShareProps {
  page: ArtifactPage;
  version: number;
}

type Sheet = 'confirm' | 'connect' | 'shared' | null;

const STATUS_STALE_MS = 5 * 60_000;

async function copiedToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const MARKDOWN_REASON = 'Markdown artifacts can’t be shared yet. Use Copy or Save as… instead.';

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : 'That didn’t work. Try again.';
}

export function ArtifactShare({ page, version: shown }: ArtifactShareProps) {
  const { remote } = useRemoteClient();
  const client = useQueryClient();
  const reasonId = useId();
  const tip = useTooltip(MARKDOWN_REASON);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pinned, setPinned] = useState(shown);
  const version = sheet === null ? shown : pinned;
  const path = artifactSharePath(page.id, version);
  const queryKey = ['artifact-share', page.id, version];
  const status = useQuery({
    queryKey,
    queryFn: () => request(artifactShareStatusSchema, path),
    enabled: !remote,
    staleTime: STATUS_STALE_MS,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const focusOwed = useRef(false);
  const current = (remote ? undefined : status.data) ?? null;
  const visible = current !== null;
  useEffect(() => {
    if (sheet !== null || !visible || !focusOwed.current) return;
    focusOwed.current = false;
    buttonRef.current?.focus();
  }, [sheet, visible]);

  if (!current) return null;
  const { available, share } = current;
  const entry = page.versions.find((item) => item.version === version);
  const markdown = page.kind === 'markdown';

  const settle = async (next: ArtifactShareStatus['share']) => {
    await client.cancelQueries({ queryKey });
    client.setQueryData<ArtifactShareStatus>(queryKey, { ...current, share: next });
  };

  const open = () => {
    setPinned(shown);
    setSheet(share ? 'shared' : available ? 'confirm' : 'connect');
  };

  const close = () => {
    setSheet(null);
    setLinkCopied(false);
    setPasscode(null);
    setFailure(null);
    setNotice(null);
    focusOwed.current = true;
  };

  const connect = () => {
    close();
    focusOwed.current = false;
    openCloudflareCard();
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
          body: JSON.stringify({
            ...choice,
            service: current.service ?? undefined,
            host: current.host ?? undefined,
            theme: currentShareTheme() ?? undefined,
          }),
        });
        await settle(created.share);
        setPasscode(created.passcode);
        setLinkCopied(await copiedToClipboard(created.share.url));
      } catch (error) {
        const already = alreadySharedSchema.safeParse(
          error instanceof ApiError ? error.body : null,
        );
        if (!already.success) {
          void client.invalidateQueries({ queryKey });
          throw error;
        }
        await settle(already.data.share);
        setPasscode(null);
        setNotice(already.data.error);
      }
      setSheet('shared');
    });

  const stop = () =>
    run(async () => {
      await request(z.null(), path, { method: 'DELETE' });
      await settle(null);
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
        onClick={() => !markdown && open()}
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
      {sheet === 'confirm' && available && (
        <ShareConfirmSheet
          title={entry?.title ?? page.title}
          version={version}
          bytes={entry?.bytes ?? 0}
          service={current.service}
          host={current.host}
          days={current.days}
          busy={busy}
          failure={failure}
          onCancel={close}
          onConnect={connect}
          onCreate={(choice) => void create(choice)}
        />
      )}
      {(sheet === 'connect' || sheet === 'confirm') && !available && !share && (
        <ShareConnectSheet onCancel={close} onConnect={connect} />
      )}
      {sheet === 'shared' && share && (
        <SharedSheet
          share={share}
          passcode={passcode}
          linkCopied={linkCopied}
          notice={notice}
          canShareAgain={available}
          busy={busy}
          failure={failure}
          onStop={() => void stop()}
          onDone={close}
        />
      )}
    </>
  );
}
