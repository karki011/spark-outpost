import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ignoreAnimationIterationListeners } from './app/animation-events.ts';
import { App } from './app/App.tsx';
import { markConnectionRestored, reportRequestError } from './app/connection/connection-store.ts';
import { configureLiveQueries } from './app/live/use-app-events.ts';
import { markScrollbarStyle } from './app/scrollbars.ts';
import { startTouchViewport } from './app/touch-viewport.ts';
import { warmTerminalFont } from './terminal/terminal-font.ts';
import { syncThemeColor } from './theme/theme.ts';
import { AppMotion } from './ui/transitions.tsx';
import 'blobatar/motion.css';
import './brand/blob-motion.css';
import './app/base.css';
import './app/reduced-motion.css';
import './app/idle-motion.css';
import './ui/touch.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportRequestError, onSuccess: markConnectionRestored }),
  mutationCache: new MutationCache({ onError: reportRequestError }),
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});
configureLiveQueries(queryClient);

markScrollbarStyle();
syncThemeColor();
warmTerminalFont();
startTouchViewport();
ignoreAnimationIterationListeners(EventTarget.prototype);

const IslandApp = lazy(() =>
  import('./island/IslandApp.tsx').then((module) => ({ default: module.IslandApp })),
);
const island = window.location.pathname === '/island';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppMotion>
        {island ? (
          <Suspense fallback={null}>
            <IslandApp />
          </Suspense>
        ) : (
          <App />
        )}
      </AppMotion>
    </QueryClientProvider>
  </StrictMode>,
);
