import { resolve } from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

const WORKER_DIR = resolve(__dirname, "../../../worker");

/**
 * Builds and starts the real apps/worker process for e2e tests that exercise
 * the Postgres-backed job queue (docs/22 Stage 3/7/8 follow-up) — OCR/PDF-text
 * extraction and visit-summary PDF rendering both run there now, not
 * synchronously inside the API request. objectStorageRoot must be the same
 * absolute directory the API test process resolves OBJECT_STORAGE_ROOT to
 * (apps/api/.dev-data/object-storage), so the worker reads the same files.
 */
export async function startWorker(objectStorageRoot: string): Promise<ChildProcessWithoutNullStreams> {
  const build = spawnSync("pnpm", ["--filter", "@medpass/worker", "build"], {
    cwd: resolve(__dirname, "../../.."),
    encoding: "utf8",
  });
  if (build.status !== 0) {
    throw new Error(`worker build failed:\n${build.stdout}\n${build.stderr}`);
  }

  const worker = spawn("node", ["dist/main.js"], {
    cwd: WORKER_DIR,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://medpass:medpass@localhost:5432/medpass",
      OBJECT_STORAGE_ROOT: objectStorageRoot,
    },
  });

  let startupLog = "";
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onData = (chunk: Buffer) => {
      startupLog += chunk.toString();
      if (startupLog.includes("worker started")) {
        worker.stdout.off("data", onData);
        worker.off("error", onError);
        resolvePromise();
      }
    };
    const onError = (err: Error) => rejectPromise(err);
    worker.stdout.on("data", onData);
    worker.stderr.on("data", (chunk: Buffer) => {
      startupLog += chunk.toString();
    });
    worker.once("error", onError);
    worker.once("exit", (code) => rejectPromise(new Error(`worker exited early (code ${code}):\n${startupLog}`)));
  });

  return worker;
}

export function stopWorker(worker: ChildProcessWithoutNullStreams): void {
  worker.kill();
}
