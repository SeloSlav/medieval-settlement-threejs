import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const windowsInstall = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'SpacetimeDB', 'spacetime.exe')
  : undefined;
const executable = windowsInstall && existsSync(windowsInstall)
  ? windowsInstall
  : 'spacetime';

let child;
let keepAlive;
let stopping = false;

async function hasRunningDatabase() {
  try {
    const response = await fetch('http://127.0.0.1:3000/v1/ping', {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (keepAlive) clearInterval(keepAlive);
  if (child && !child.killed) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

if (await hasRunningDatabase()) {
  console.log('Reusing the SpacetimeDB instance already running at http://127.0.0.1:3000.');
  keepAlive = setInterval(() => {}, 2 ** 30);
} else {
  child = spawn(
    executable,
    ['start', '--listen-addr', '127.0.0.1:3000', '--non-interactive'],
    {
      stdio: 'inherit',
      windowsHide: true,
    },
  );

  child.once('error', (error) => {
    if (error.code === 'ENOENT') {
      console.error(
        'SpacetimeDB CLI was not found. Install it or add the `spacetime` executable to PATH.',
      );
    } else {
      console.error(`Unable to start SpacetimeDB: ${error.message}`);
    }
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    if (!stopping && signal) {
      console.error(`SpacetimeDB stopped after receiving ${signal}.`);
    }
    process.exitCode = code ?? (stopping ? 0 : 1);
  });
}
