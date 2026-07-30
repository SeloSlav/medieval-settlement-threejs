/// <reference types="vite/client" />
/**
 * SpacetimeDB client — connects with server-issued token, subscribes to tables, invokes reducers.
 */

import { DbConnection } from '../generated/index.ts';

const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
const spacetimeUriFromEnv = (import.meta.env.VITE_SPACETIME_URI ?? '').trim();
const dbNameFromEnv = (import.meta.env.VITE_SPACETIME_DB_NAME ?? '').trim();
const SPACETIME_URI = (spacetimeUriFromEnv || (isDev ? 'http://localhost:3000' : 'https://maincloud.spacetimedb.com')).replace(/\/+$/, '');
const DB_NAME = dbNameFromEnv || 'city-builder';

let connection: DbConnection | null = null;
let connectionToken: string | null = null;
let connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let activeConnectionId = 0;

export type Identity = import('spacetimedb').Identity;

type ConnectHandlers = {
  onIdentity?: (identity: Identity) => void;
  onConnectError?: (error: unknown) => void;
  onDisconnect?: () => void;
  onToken?: (token: string) => void;
};

export function connect(token: string | undefined, handlers?: ConnectHandlers): DbConnection {
  const { onIdentity, onConnectError, onDisconnect, onToken } = handlers ?? {};

  if (connection && connectionToken === (token ?? null) && connectionStatus !== 'disconnected') {
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
  connectionToken = token ?? null;
  connectionStatus = 'connecting';

  const builder = DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(DB_NAME)
    .withConfirmedReads(false)
    .onConnect((_conn, identity, serverToken) => {
      if (connectionId !== activeConnectionId) return;
      connectionStatus = 'connected';
      connectionToken = serverToken;
      console.log('[SpacetimeDB] Connected, identity:', identity.toHexString());
      onToken?.(serverToken);
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
    });

  if (token) {
    builder.withToken(token);
  }

  const conn = builder.build();

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

export function createIsolatedConnection(token: string | undefined, handlers?: ConnectHandlers): DbConnection {
  const builder = DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(DB_NAME)
    .withConfirmedReads(false)
    .onConnect((_conn, identity, serverToken) => {
      handlers?.onToken?.(serverToken);
      handlers?.onIdentity?.(identity);
    })
    .onConnectError((_ctx, error) => {
      handlers?.onConnectError?.(error);
    })
    .onDisconnect(() => {
      handlers?.onDisconnect?.();
    });

  if (token) {
    builder.withToken(token);
  }

  return builder.build();
}

export function getSpacetimeConfig(): { uri: string; dbName: string } {
  return { uri: SPACETIME_URI, dbName: DB_NAME };
}
