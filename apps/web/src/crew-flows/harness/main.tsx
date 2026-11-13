import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'blobatar/motion.css';
import '../../app/base.css';
import '../../ui/controls.css';
import '../../ui/mac-targets.css';
import '../../ui/touch.css';
import { followAppearance } from '../../theme/appearance.ts';
import { WorkflowsPanel } from '../WorkflowsPanel.tsx';

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: false, networkMode: 'always' } },
});
followAppearance();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <div className="app">
        <main className="main" aria-label="Workflows">
          <WorkflowsPanel />
        </main>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
