import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'dynaura';
import { BrowserRouter } from 'react-router';
// Self-hosted, Latin only: Dutch and English briefs, no external font server.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/newsreader/latin-400.css';
import 'dynaura/styles-no-font.css';
import './index.css';
import { App } from './App';
import { configureApi } from './lib/api';
import { oktaAuth, sessionKey, useAuthState } from './lib/auth';

function SessionApp({ identity }: { identity: string | undefined }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
  }));
  useLayoutEffect(() => {
    configureApi({
      getSessionSnapshot: () => {
        const { accessToken } = oktaAuth.tokenManager.getTokensSync();
        // Another tab can change storage before this tab receives the SDK event and unmounts its forms.
        if ((accessToken && !identity) || sessionKey(accessToken) !== identity) {
          throw new DOMException('Session changed', 'AbortError');
        }
        return { accessToken: accessToken?.accessToken, sessionKey: identity };
      },
      onUnauthorized: () => oktaAuth.tokenManager.clear(),
    });
    return () => client.clear();
  }, [client, identity]);
  return <QueryClientProvider client={client}><App /></QueryClientProvider>;
}

function SessionBoundary() {
  const state = useAuthState();
  // Remount protected views and their cache together, including any unsaved local form state.
  const identity = state?.isAuthenticated ? sessionKey(state.accessToken) : undefined;
  return <SessionApp key={identity} identity={identity} />;
}

oktaAuth.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionBoundary />
    </BrowserRouter>
    {/* A dark island at the bottom edge, in the system's colours. Desktop tool: no vibration. */}
    <Toaster
      position="bottom"
      offset={24}
      haptics={false}
      theme={{ background: '#171717', foreground: '#fafafa', muted: '#a1a1a6', success: '#4cc38a', error: '#e5484d', info: '#7d9be6', loading: '#a1a1a6' }}
    />
  </StrictMode>,
);
