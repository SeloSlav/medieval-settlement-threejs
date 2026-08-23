import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DbConnection } from '../../src/generated/index.ts';
import { DbConnection as GeneratedDbConnection } from '../../src/generated/index.ts';

export const DEFAULT_SPACETIME_URI = 'http://127.0.0.1:3000';

export type ReducerPayload = Record<string, unknown>;

export type CommandResult = {
  command: string;
  exitCode: number;
};

export async function assertSpacetimeServerAvailable(
  uri = DEFAULT_SPACETIME_URI,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${uri.replace(/\/$/, '')}/v1/ping`, {
      signal: AbortSignal.timeout(2_500),
    });
  } catch (error) {
    throw new Error(
      `SpacetimeDB is not reachable at ${uri}. Start it with npm run dev:db before running this integration test.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(`SpacetimeDB ping at ${uri} returned HTTP ${response.status}.`);
  }
}

export function resolveSpacetimeExecutable(): string {
  const installed = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'SpacetimeDB', 'spacetime.exe')
    : undefined;
  return installed && existsSync(installed) ? installed : 'spacetime';
}

export async function runCommand(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    quiet?: boolean;
  },
): Promise<CommandResult> {
  const command = [executable, ...args].map(formatCommandPart).join(' ');
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stderr = '';
    if (options.quiet && child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} stopped after signal ${signal}.`));
        return;
      }
      if (code !== 0 && stderr.trim()) {
        reject(new Error(`${command} failed with exit code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`${command} failed with exit code ${exitCode}.`);
  }
  return { command, exitCode };
}

export async function connectAndSubscribe(
  databaseName: string,
  subscriptions: readonly string[],
  uri = DEFAULT_SPACETIME_URI,
): Promise<DbConnection> {
  const connection = await new Promise<DbConnection>((resolve, reject) => {
    GeneratedDbConnection.builder()
      .withUri(uri)
      .withDatabaseName(databaseName)
      .withConfirmedReads(false)
      .onConnect((connected) => resolve(connected))
      .onConnectError((_context, error) => reject(error))
      .build();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      connection.subscriptionBuilder()
        .onApplied(() => resolve())
        .onError((context) => reject(new Error(String(context.event))))
        .subscribe(subscriptions.map(normalizeSubscription));
    });
  } catch (error) {
    connection.disconnect();
    throw error;
  }
  return connection;
}

export async function callReducer(
  connection: DbConnection,
  camelName: string,
  snakeName: string,
  payload: ReducerPayload,
): Promise<void> {
  const reducers = connection.reducers as unknown as Record<
    string,
    ((args: ReducerPayload) => Promise<void>) | undefined
  >;
  const reducer = reducers[camelName] ?? reducers[snakeName];
  if (!reducer) {
    throw new Error(`Generated bindings do not expose reducer ${camelName}/${snakeName}.`);
  }
  await reducer(payload);
}

export async function waitUntil(
  predicate: () => boolean,
  label: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    describe?: () => string;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastPredicateError: unknown;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
      lastPredicateError = undefined;
    } catch (error) {
      lastPredicateError = error;
    }
    await wait(pollMs);
  }
  const detail = options.describe?.();
  const suffix = detail ? ` (${detail})` : '';
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}${suffix}.`, {
    cause: lastPredicateError,
  });
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeSubscription(subscription: string): string {
  const trimmed = subscription.trim();
  return /^select\s/i.test(trimmed) ? trimmed : `SELECT * FROM ${trimmed}`;
}

function formatCommandPart(part: string): string {
  return /\s/.test(part) ? JSON.stringify(part) : part;
}
