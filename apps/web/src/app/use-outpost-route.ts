import { useCallback, useState } from 'react';

interface OutpostRoute {
  id: string;
  jumpTo: string | null;
  thread: string | null;
}

export function useOutpostRoute() {
  const [route, setRoute] = useState<OutpostRoute | null>(null);
  const show = useCallback((id: string, postId?: string, thread = false) => {
    const jumpTo = postId ?? null;
    setRoute({ id, jumpTo, thread: thread ? jumpTo : null });
  }, []);
  const close = useCallback(() => setRoute(null), []);
  return { route, show, close };
}
