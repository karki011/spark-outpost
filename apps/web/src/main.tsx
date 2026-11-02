import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ignoreAnimationIterationListeners } from './app/animation-events.ts';
import { reportCspViolationsInDev } from './app/csp-violations.ts';
import { markConnectionRestored, reportRequestError } from './app/connection/connection-store.ts';
import { configureLiveQueries } from './app/live/use-app-events.ts';
import { configureChatRetention } from './app/chat-retention.ts';
import { markScrollbarStyle } from './app/scrollbars.ts';
import { startTouchViewport } from './app/touch-viewport.ts';
import { warmTerminalFont } from './terminal/terminal-font.ts';
import { followAppearance } from './theme/appearance.ts';
import { AppMotion } from './ui/transitions.tsx';
import 'blobatar/motion.css';
import './brand/blob-motion.css';
import './app/base.css';
import './app/reduced-motion.css';
import './app/idle-motion.css';
import './ui/mac-targets.css';
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

reportCspViolationsInDev();
markScrollbarStyle();
followAppearance();
warmTerminalFont();
startTouchViewport();
ignoreAnimationIterationListeners(EventTarget.prototype);

const IslandApp = lazy(() =>
  import('./island/IslandApp.tsx').then((module) => ({ default: module.IslandApp })),
);
const MacIndicatorApp = lazy(() =>
  import('./mac-control/MacIndicatorApp.tsx').then((module) => ({
    default: module.MacIndicatorApp,
  })),
);
const MeetingAlertApp = lazy(() =>
  import('./calendar/alert/MeetingAlertApp.tsx').then((module) => ({
    default: module.MeetingAlertApp,
  })),
);
const SettingsWindowApp = lazy(() =>
  import('./settings/SettingsWindowApp.tsx').then((module) => ({
    default: module.SettingsWindowApp,
  })),
);
const island = window.location.pathname === '/island';
const settingsWindow = window.location.pathname === '/settings' && 'sparkDesktop' in window;
const meetingAlert = window.location.pathname === '/meeting-alert';
const macIndicator = window.location.pathname === '/mac-indicator';
const mainWindow = !island && !settingsWindow && !meetingAlert && !macIndicator;
const loadApp = () => import('./app/App.tsx').then((module) => ({ default: module.App }));
const appLoading = mainWindow ? loadApp() : null;
if (mainWindow) configureChatRetention(queryClient);
const App = lazy(() => appLoading ?? loadApp());

function Root() {
  if (island) {
    return (
      <Suspense fallback={null}>
        <IslandApp />
      </Suspense>
    );
  }
  if (meetingAlert) {
    return (
      <Suspense fallback={null}>
        <MeetingAlertApp />
      </Suspense>
    );
  }
  if (settingsWindow) {
    return (
      <Suspense fallback={null}>
        <SettingsWindowApp />
      </Suspense>
    );
  }
  if (macIndicator) {
    return (
      <Suspense fallback={null}>
        <MacIndicatorApp />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<div className="app" aria-hidden="true" />}>
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppMotion>
        <Root />
      </AppMotion>
    </QueryClientProvider>
  </StrictMode>,
);
