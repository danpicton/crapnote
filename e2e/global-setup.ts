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

  // Poll the server's HTTP port rather than watching stderr logs, so that the
  // readiness check is independent of Go's log format and tests actual TCP
  // connectivity rather than just process startup.
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error('Server failed to start within 10s')),
      10_000,
    );
    server.on('error', (err) => { clearTimeout(deadline); reject(err); });

    const poll = () =>
      fetch('http://localhost:4173')
        .then(() => { clearTimeout(deadline); resolve(); })
        .catch(() => setTimeout(poll, 100));

    setTimeout(poll, 100);
  });
}

export async function stopServer() {
  server?.kill();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
}

export default startServer;
