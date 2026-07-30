/**
 * SpacetimeDB uses several messages for the same stale-credential condition
 * across local-server versions. These all permit one safe anonymous reconnect;
 * transport failures must still surface to the player.
 */
export function isUnauthorizedConnectError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('unauthorized')
    || message.includes('401')
    || message.includes('failed to verify token')
    || message.includes('invalid token')
    || message.includes('token expired');
}
