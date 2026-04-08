import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let server: ChildProcess;
let dbDir: string;

export async function startServer() {
  dbDir = mkdtempSync(join(tmpdir(), 'crapnote-e2e-'));
  const dbPath = join(dbDir, 'test.db');
  const bin = process.env.SERVER_BIN ?? '../backend/cmd/server/crapnote-server';

  server = spawn(bin, [], {
    env: {
      ...process.env,
      DATABASE_PATH: dbPath,
      JWT_SECRET: 'e2e-test-secret',
      PORT: '4173',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'admin123',
    },
    stdio: 'pipe',
  });

  // Wait for the server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server failed to start')), 10_000);
    // Go's log package writes to stderr by default
    server.stderr?.on('data', (data: Buffer) => {
      if (data.toString().includes('listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.on('error', reject);
  });
}

export async function stopServer() {
  server?.kill();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
}

export default startServer;
