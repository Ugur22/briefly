import { z } from 'zod';

// The CSP has no 'unsafe-eval'; without this, Zod probes new Function() on its first parse and logs a violation.
z.config({ jitless: true });
