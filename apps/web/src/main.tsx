import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
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
import { oktaAuth } from './lib/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

configureApi({
  getAccessToken: () => oktaAuth.getAccessToken(),
  // The API refused the token: drop everything cached for this user and fall back to the sign-in screen.
  onUnauthorized: () => {
    queryClient.clear();
    oktaAuth.tokenManager.clear();
  },
});

oktaAuth.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      {/* A dark island at the bottom edge, in the system's colours. Desktop tool: no vibration. */}
      <Toaster
        position="bottom"
        offset={24}
        haptics={false}
        theme={{ background: '#171717', foreground: '#fafafa', muted: '#a1a1a6', success: '#4cc38a', error: '#e5484d', info: '#7d9be6', loading: '#a1a1a6' }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
