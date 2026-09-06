import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Starts a document worker for a browser spec that needs one — the scan
 * flow waits for the worker to classify the upload, and Playwright's
 * `webServer` only boots the API and the web app. Without this, CI showed
 * "This is taking longer than usual" on every run while the same spec
 * passed on a laptop where a worker happened to be running.
 *
 * The storage root must be the directory the API under test writes to. The
 * API's default is `.dev-data/object-storage` relative to its working
 * directory, which Playwright sets to the repo root, so the same path is
 * the default here; `OBJECT_STORAGE_ROOT` overrides it for a stack started
 * by hand. Set `E2E_NO_WORKER=1` to skip when one is already running.
 */
const REPO = resolve(__dirname, "../../..");
const WORKER_MAIN = resolve(REPO, "apps/worker/dist/main.js");

export async function startWorkerForSpec(): Promise<ChildProcess | undefined> {
  if (process.env.E2E_NO_WORKER) return undefined;
  if (!existsSync(WORKER_MAIN)) throw new Error(`worker is not built: ${WORKER_MAIN} — run pnpm --filter @medpass/worker build`);
  const child = spawn(process.execPath, [WORKER_MAIN], {
    cwd: REPO,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://medpass:medpass@localhost:5432/medpass",
      OBJECT_STORAGE_ROOT: process.env.OBJECT_STORAGE_ROOT ?? resolve(REPO, ".dev-data/object-storage"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`worker did not report started within 60s:\n${log.slice(-2000)}`)), 60_000);
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes("worker started")) {
        clearTimeout(timer);
        done();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`worker exited with ${code} before starting:\n${log.slice(-2000)}`));
    });
  });
  return child;
}

export function stopWorker(child: ChildProcess | undefined): void {
  if (!child || child.exitCode !== null) return;
  child.kill();
}
