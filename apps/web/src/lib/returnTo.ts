// Where to land after sign-in. Only same-origin paths: '//evil.example' and '/\evil.example' are other origins to a browser.
export function safeReturnPath(uri: string | undefined): string {
  if (!uri || !uri.startsWith('/') || uri.startsWith('//') || uri.startsWith('/\\')) return '/';
  return uri;
}
