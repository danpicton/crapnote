import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';

export interface IsolatedServer {
  readonly baseURL: string;
  readonly databasePath: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not allocate an E2E server port'));
        return;
      }
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitUntilReady(baseURL: string, process: ChildProcess, output: () => string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`isolated server exited during startup (${process.exitCode}):\n${output()}`);
    }
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`isolated server failed to start within 10s:\n${output()}`);
}

export async function startIsolatedServer(): Promise<IsolatedServer> {
  const directory = mkdtempSync(join(tmpdir(), 'crapnote-purge-e2e-'));
  const databasePath = join(directory, 'test.db');
  const port = await availablePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const binary = process.env.SERVER_BIN ?? '../backend/cmd/server/crapnote-server';
  let child: ChildProcess | undefined;
  let disposed = false;

  const isolated: IsolatedServer = {
    baseURL,
    databasePath,
    async start() {
      if (disposed) throw new Error('cannot restart a disposed E2E server');
      if (child !== undefined) throw new Error('isolated E2E server is already running');

      let output = '';
      child = spawn(binary, [], {
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
          PORT: String(port),
          ADMIN_USERNAME: 'admin',
          ADMIN_PASSWORD: 'admin123',
          LOGIN_RATE_PER_MINUTE: '1000',
          LOGIN_RATE_BURST: '1000',
        },
        stdio: 'pipe',
      });
      child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
      await waitUntilReady(baseURL, child, () => output);
    },
    async stop() {
      const running = child;
      child = undefined;
      if (running === undefined || running.exitCode !== null) return;

      const exited = new Promise<void>((resolve) => running.once('exit', () => resolve()));
      running.kill();
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(() => {
          running.kill('SIGKILL');
          resolve();
        }, 5_000)),
      ]);
    },
    async dispose() {
      await isolated.stop();
      disposed = true;
      rmSync(directory, { recursive: true, force: true });
    },
  };

  try {
    await isolated.start();
    return isolated;
  } catch (error) {
    await isolated.dispose();
    throw error;
  }
}

export function expireTrashEntry(databasePath: string, noteID: number) {
  const database = new DatabaseSync(databasePath);
  try {
    const result = database.prepare(`
      UPDATE trash
      SET deleted_at = '2000-01-01 00:00:00'
      WHERE note_id = ?
    `).run(noteID);
    if (Number(result.changes) !== 1) {
      throw new Error(`expected to expire trash entry ${noteID}, changed ${result.changes} rows`);
    }
  } finally {
    database.close();
  }
}
