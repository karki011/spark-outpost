import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SEARCH_ENGINE,
  browserSearchEngineSchema,
  type BrowserSearchEngine,
} from '@spark-outpost/contracts';
import { desktopBrowserView } from '../desktop/desktop-bridge.ts';

const SEARCH_ENGINE_KEY = ['browser-search-engine'] as const;

function parsed(raw: unknown): BrowserSearchEngine {
  return browserSearchEngineSchema.catch(DEFAULT_SEARCH_ENGINE).parse(raw);
}

export function useSearchEngine(): BrowserSearchEngine | null {
  const view = desktopBrowserView();
  const engine = useQuery({
    queryKey: SEARCH_ENGINE_KEY,
    queryFn: async () => parsed(await view?.searchEngine()),
    enabled: view !== null,
  });
  return view ? (engine.data ?? DEFAULT_SEARCH_ENGINE) : null;
}

export function useSetSearchEngine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (engine: BrowserSearchEngine) =>
      parsed(await desktopBrowserView()?.setSearchEngine(engine)),
    onSuccess: (engine) => queryClient.setQueryData(SEARCH_ENGINE_KEY, engine),
  });
}
