// Playwright runs these files in Node; this is the only Node global they read, so no @types/node for it.
declare const process: { env: Record<string, string | undefined> };
