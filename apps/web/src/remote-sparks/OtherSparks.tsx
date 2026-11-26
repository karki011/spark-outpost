import './remote-sparks.css';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteSpark } from '@spark-outpost/contracts';
import { DisconnectDialog } from '../connectors/DisconnectDialog.tsx';
import { PhoneSection } from '../phone/PhoneSection.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { usePageHidden } from '../ui/use-page-hidden.ts';
import { PlusIcon } from '../ui/icons.tsx';
import { AddSparkDialog } from './AddSparkDialog.tsx';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import {
  ADD_SPARK,
  OTHER_SPARKS_EMPTY,
  OTHER_SPARKS_INTRO,
  OTHER_SPARKS_TITLE,
  OTHER_SPARKS_UNAVAILABLE,
  removeCopy,
} from './remote-sparks-copy.ts';
import { SparkRow } from './SparkRow.tsx';

const POLL_MS = 5000;

interface Removal {
  spark: RemoteSpark;
  from: HTMLButtonElement;
}

export function OtherSparks({ ownHostname }: { ownHostname: string | null }) {
  const queryClient = useQueryClient();
  const hidden = usePageHidden();
  const now = useMinuteClock();
  const addButton = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const list = useQuery({
    queryKey: remoteSparkKeys.all,
    queryFn: remoteSparksApi.list,
    refetchInterval: hidden ? false : POLL_MS,
  });
  const remove = useMutation({
    mutationFn: (id: string) => remoteSparksApi.remove(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all }),
  });
  const focusAdd = () => requestAnimationFrame(() => addButton.current?.focus());
  const closeAdd = () => {
    setAdding(false);
    focusAdd();
  };
  const cancelRemove = () => {
    removal?.from.focus();
    setRemoval(null);
  };
  const confirmRemove = () => {
    if (!removal) return;
    remove.mutate(removal.spark.id);
    setRemoval(null);
    focusAdd();
  };
  const sparks = list.data?.sparks ?? [];
  const available = list.data?.available ?? false;

  return (
    <PhoneSection
      id="other-sparks"
      title={OTHER_SPARKS_TITLE}
      count={available ? sparks.length : undefined}
      actions={
        available && (
          <button
            ref={addButton}
            type="button"
            className="btn line sm"
            onClick={() => setAdding(true)}
          >
            <PlusIcon />
            {ADD_SPARK}
          </button>
        )
      }
      className="rs-card"
    >
      <p className="ph-note">{OTHER_SPARKS_INTRO}</p>
      {!list.data && (
        <QueryWait query={list} what="other Sparks">
          <Skeleton label="Loading other Sparks" shape="list" rows={1} />
        </QueryWait>
      )}
      {list.data && !available && <p className="ph-empty">{OTHER_SPARKS_UNAVAILABLE}</p>}
      {list.data && available && (
        <>
          {sparks.length === 0 ? (
            <p className="ph-empty">{OTHER_SPARKS_EMPTY}</p>
          ) : (
            <ul className="ph-devices rs-list">
              {sparks.map((spark) => (
                <SparkRow
                  key={spark.id}
                  spark={spark}
                  now={now}
                  onRemove={(target, from) => setRemoval({ spark: target, from })}
                />
              ))}
            </ul>
          )}
        </>
      )}
      {remove.error && (
        <p className="ph-error" role="alert">
          {remove.error.message}
        </p>
      )}
      {adding && <AddSparkDialog ownHostname={ownHostname} onClose={closeAdd} />}
      {removal && (
        <DisconnectDialog
          copy={removeCopy(removal.spark.name)}
          confirmLabel="Remove"
          onCancel={cancelRemove}
          onConfirm={confirmRemove}
        />
      )}
    </PhoneSection>
  );
}
