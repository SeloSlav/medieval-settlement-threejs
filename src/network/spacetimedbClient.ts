/// <reference types="vite/client" />
/**
 * SpacetimeDB client — connects with anonymous/local token, subscribes to tables, invokes reducers.
 */

import { DbConnection } from '../generated/index.ts';

const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
const spacetimeUriFromEnv = (import.meta.env.VITE_SPACETIME_URI ?? '').trim();
const dbNameFromEnv = (import.meta.env.VITE_SPACETIME_DB_NAME ?? '').trim();
const SPACETIME_URI = (spacetimeUriFromEnv || (isDev ? 'http://localhost:3000' : 'https://maincloud.spacetimedb.com')).replace(/\/+$/, '');
const DB_NAME = dbNameFromEnv || (isDev ? 'medieval-road-system-local' : 'medieval-road-system');

let connection: DbConnection | null = null;
let connectionToken: string | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let activeConnectionId = 0;

export type Identity = import('spacetimedb').Identity;

type ConnectHandlers = {
  onIdentity?: (identity: Identity) => void;
  onConnectError?: (error: unknown) => void;
  onDisconnect?: () => void;
};

export function connect(
  token: string,
  onIdentity?: (identity: Identity) => void,
  onConnectError?: (error: unknown) => void,
  onDisconnect?: () => void,
): DbConnection {
  if (connection && connectionToken === token && connectionStatus !== 'disconnected') {
    const conn = connection as { identity?: Identity };
    if (conn.identity && onIdentity) onIdentity(conn.identity);
    return connection;
  }

  if (connection) {
    try {
      connection.disconnect();
    } catch {
      // Ignore disconnect errors while replacing a stale connection.
    }
    connection = null;
    connectionToken = null;
    connectionStatus = 'disconnected';
  }

  const connectionId = ++activeConnectionId;
  connectionToken = token;
  connectionStatus = 'connecting';

  const conn = DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .withConfirmedReads(false)
    .onConnect((_conn, identity) => {
      if (connectionId !== activeConnectionId) return;
      connectionStatus = 'connected';
      console.log('[SpacetimeDB] Connected, identity:', identity.toHexString());
      onIdentity?.(identity);
    })
    .onConnectError((_ctx, error) => {
      if (connectionId !== activeConnectionId) return;
      connectionStatus = 'disconnected';
      connection = null;
      connectionToken = null;
      console.error('[SpacetimeDB] Connection failed:', error);
      onConnectError?.(error);
    })
    .onDisconnect(() => {
      if (connectionId !== activeConnectionId) return;
      connectionStatus = 'disconnected';
      connection = null;
      connectionToken = null;
      console.log('[SpacetimeDB] Disconnected');
      onDisconnect?.();
    })
    .build();

  connection = conn;
  return conn;
}

export function disconnect(): void {
  activeConnectionId++;
  if (connection) {
    connection.disconnect();
    connection = null;
    connectionToken = null;
    connectionStatus = 'disconnected';
  }
}

export function getConnection(): DbConnection | null {
  return connection;
}

export function isConnected(): boolean {
  return connection !== null && connectionStatus === 'connected';
}

export function getConnectionToken(): string | null {
  return connectionToken;
}

export function createIsolatedConnection(token: string, handlers?: ConnectHandlers): DbConnection {
  return DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .withConfirmedReads(false)
    .onConnect((_conn, identity) => {
      handlers?.onIdentity?.(identity);
    })
    .onConnectError((_ctx, error) => {
      handlers?.onConnectError?.(error);
    })
    .onDisconnect(() => {
      handlers?.onDisconnect?.();
    })
    .build();
}

export function getSpacetimeConfig(): { uri: string; dbName: string } {
  return { uri: SPACETIME_URI, dbName: DB_NAME };
}
