import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { completeSignIn } from '../../lib/auth';
import { Waiting } from './RequireSession';

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
      <Waiting>
        <div className="grid justify-items-center gap-3">
          <p role="alert" className="alert">Sign-in failed: {failure}.</p>
          <a href="/" className="btn hover:no-underline">
            Try again
          </a>
        </div>
      </Waiting>
    );
  }
  return <Waiting>Signing you in…</Waiting>;
}
