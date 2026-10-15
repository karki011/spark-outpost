import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setupApi, setupKey } from '../api/setup.ts';
import { usePanelAnchor } from '../app/connection/use-panel-anchor.ts';
import { useSparkPaused } from '../app/pause/use-spark-pause.ts';
import { XIcon } from '../ui/icons.tsx';
import './default-level-notice.css';

export function DefaultLevelNotice({ onSettings }: { onSettings: () => void }) {
  const queryClient = useQueryClient();
  const setup = useQuery({ queryKey: setupKey, queryFn: setupApi.get, retry: false });
  const dismiss = useMutation({
    mutationFn: () => setupApi.updateProfile({ defaultLevelNotice: false }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });
  const anchor = usePanelAnchor();
  const sparkPaused = useSparkPaused();
  if (!setup.data?.profile.defaultLevelNotice || dismiss.isPending || sparkPaused) return null;
  return (
    <aside className="level-notice" aria-label="Default for new chats changed" style={anchor}>
      <p>
        New chats now use Full auto → PR: Spark opens a pull request when the work is done.{' '}
        <button
          type="button"
          className="level-notice-link"
          onClick={() => {
            dismiss.mutate();
            onSettings();
          }}
        >
          Change the default in Settings
        </button>
        .
      </p>
      <button
        type="button"
        className="level-notice-close"
        aria-label="Dismiss"
        onClick={() => dismiss.mutate()}
      >
        <XIcon />
      </button>
    </aside>
  );
}
