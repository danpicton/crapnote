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
      // The production login rate limit (5/min/IP) is far too tight for an
      // E2E suite that logs in once per test from a single loopback address.
      // Loosen it here without touching production defaults.
      LOGIN_RATE_PER_MINUTE: '1000',
      LOGIN_RATE_BURST: '1000',
    },
    stdio: 'pipe',
  });

  // Drain stdout/stderr so the OS pipe buffer never fills.  The logging
  // middleware writes one line per request; once the 64 KB pipe buffer is
  // full every handler goroutine blocks after sending its response.  That
  // stalls keep-alive connections and causes subsequent page loads to hang
  // until Playwright times out with ERR_ABORTED.
  server.stdout?.pipe(process.stdout);
  server.stderr?.pipe(process.stderr);

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
