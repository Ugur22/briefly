// Postgres/PostgREST codes for "this token isn't accepted here". Node already verified the token, so reaching
// one means Node and the database disagree about trust (e.g. a changed client id): refuse, don't 500.
const REFUSED = new Set(['42501', 'PGRST301', 'PGRST302', 'PGRST303']);

// The message goes to the client, so it names nothing internal; op and code are kept for the error log.
export class DbError extends Error {
  readonly statusCode: number;
  constructor(
    readonly op: string,
    readonly code: string | undefined,
  ) {
    const refused = code !== undefined && REFUSED.has(code);
    super(refused ? 'forbidden' : 'database request failed');
    this.statusCode = refused ? 403 : 500;
  }
}
