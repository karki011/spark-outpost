import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LINKS_IN,
  browserLinksInSchema,
  type BrowserLinksIn,
} from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';

const LINKS_IN_KEY = ['browser-links-in'] as const;

function parsed(raw: unknown): BrowserLinksIn {
  return browserLinksInSchema.catch(DEFAULT_LINKS_IN).parse(raw);
}

export function useLinksIn(): BrowserLinksIn | null {
  const view = desktopBrowserView();
  const choice = useQuery({
    queryKey: LINKS_IN_KEY,
    queryFn: async () => parsed(await view?.linksIn()),
    enabled: view !== null,
  });
  return view ? (choice.data ?? DEFAULT_LINKS_IN) : null;
}

export function useSetLinksIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (choice: BrowserLinksIn) =>
      parsed(await desktopBrowserView()?.setLinksIn(choice)),
    onSuccess: (choice) => queryClient.setQueryData(LINKS_IN_KEY, choice),
  });
}
