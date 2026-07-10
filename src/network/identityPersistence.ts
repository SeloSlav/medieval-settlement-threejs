/**
 * Anonymous SpacetimeDB identity for local dev.
 *
 * SpacetimeDB maps `.withToken(token)` to a stable Identity — no login required.
 * We persist the token in localStorage so refresh keeps the same player, stockpile,
 * buildings, and roads.
 *
 * Migration path: replace `getOrCreateAnonymousToken()` with an OAuth/OpenAuth token
 * from a real auth provider (see selo-empire AuthContext + SpacetimeDBContext).
 * The connection layer stays the same; only the token source changes.
 */

const STORAGE_KEY = 'medieval-road-system:spacetime-token';

export function getOrCreateAnonymousToken(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) return existing;
  } catch {
    // Private browsing or blocked storage — fall through to ephemeral token.
  }

  const token = crypto.randomUUID();
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Session-only if storage unavailable.
  }
  return token;
}

export function clearAnonymousToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
