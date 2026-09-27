import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App.tsx';
import { markConnectionRestored, reportRequestError } from './app/connection/connection-store.ts';
import { configureLiveQueries } from './app/live/use-app-events.ts';
import { markScrollbarStyle } from './app/scrollbars.ts';
import { AppMotion } from './ui/transitions.tsx';
import { trackInputModality } from './ui/input-modality.ts';
import 'blobatar/motion.css';
import './app/base.css';
import './app/reduced-motion.css';

trackInputModality();

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: reportRequestError, onSuccess: markConnectionRestored }),
  mutationCache: new MutationCache({ onError: reportRequestError }),
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});
configureLiveQueries(queryClient);

markScrollbarStyle();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppMotion>
        <App />
      </AppMotion>
    </QueryClientProvider>
  </StrictMode>,
);
