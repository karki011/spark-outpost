import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { remoteSparkKeys, remoteSparksApi } from './remote-sparks-api.ts';
import { SPARK_ICON_ACCEPT, sparkIconPng } from './spark-icon-image.ts';

interface SparkIconControls {
  field: ReactNode;
  problem: string | null;
  choose: () => void;
  remove: () => void;
}

export function useSparkIcon(id: string, name: string): SparkIconControls {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: remoteSparkKeys.all });
  const set = useMutation({
    mutationFn: async (file: File) => remoteSparksApi.setIcon(id, await sparkIconPng(file)),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => remoteSparksApi.removeIcon(id),
    onSuccess: refresh,
  });
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    remove.reset();
    set.mutate(file);
  };
  return {
    field: (
      <input
        ref={input}
        type="file"
        hidden
        accept={SPARK_ICON_ACCEPT}
        aria-label={`Icon for ${name}`}
        onChange={onChange}
      />
    ),
    problem: set.error?.message ?? remove.error?.message ?? null,
    choose: () => input.current?.click(),
    remove: () => {
      set.reset();
      remove.mutate();
    },
  };
}
