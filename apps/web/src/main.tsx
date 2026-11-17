import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
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
    </QueryClientProvider>
  </StrictMode>,
);
