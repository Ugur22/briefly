// Postgres/PostgREST codes for "not allowed": a policy or column grant refused the write, the workflow trigger
// refused a role (42501), or Node and the database disagree about the token (PGRST30x). Refuse, don't 500.
const REFUSED = new Set(['42501', 'PGRST301', 'PGRST302', 'PGRST303']);

// The workflow trigger's own SQLSTATEs (migration 20261118200000): the database explains why, the API passes
// the reason on, so routes don't need to re-implement the rules to give a useful answer.
const WORKFLOW: Record<string, { statusCode: number; message: string }> = {
  BRF01: { statusCode: 409, message: 'locked' },
  BRF02: { statusCode: 403, message: 'self_approval' },
  BRF03: { statusCode: 409, message: 'no_current_review' },
  BRF04: { statusCode: 409, message: 'invalid_transition' },
  BRF05: { statusCode: 422, message: 'comment_required' },
};

// The message goes to the client, so it names nothing internal; op and code are kept for the error log.
export class DbError extends Error {
  readonly statusCode: number;
  constructor(
    readonly op: string,
    readonly code: string | undefined,
  ) {
    const workflow = code === undefined ? undefined : WORKFLOW[code];
    const refused = code !== undefined && REFUSED.has(code);
    super(workflow?.message ?? (refused ? 'forbidden' : 'database request failed'));
    this.statusCode = workflow?.statusCode ?? (refused ? 403 : 500);
  }
}
