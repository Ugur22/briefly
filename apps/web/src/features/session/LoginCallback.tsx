import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { completeSignIn } from '../../lib/auth';

export function LoginCallback() {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    completeSignIn().then(
      (target) => navigate(target, { replace: true }),
      // OAuth errors (expired transaction, invalid_grant…) carry no secrets and are the only clue when this fails.
      (err: unknown) => setFailure(err instanceof Error ? err.message : 'unknown error'),
    );
  }, [navigate]);

  if (failure !== null) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <p role="alert" className="alert">
          Sign-in failed: {failure}. <a href="/">Try again</a>
        </p>
      </main>
    );
  }
  return <p className="p-8 text-muted">Signing you in…</p>;
}
