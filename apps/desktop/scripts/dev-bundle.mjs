import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { join } from "node:path";

import { desktopDir } from "./electron-launcher.mjs";

const watchedPaths = [
  join(desktopDir, "src"),
  join(desktopDir, "tsdown.config.ts"),
  join(desktopDir, "tsconfig.json"),
];

const rebuildDebounceMs = 120;
let shuttingDown = false;
let rebuildTimer = null;
let runningBuild = null;
let rebuildQueued = false;
const watchers = [];

function runBuild() {
  if (runningBuild) {
    rebuildQueued = true;
    return runningBuild;
  }

  runningBuild = new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", "build"], {
      cwd: desktopDir,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", (error) => {
      runningBuild = null;
      reject(error);
    });

    child.once("exit", (code, signal) => {
      runningBuild = null;
      if (signal !== null || code !== 0) {
        reject(
          new Error(
            `desktop bundle build failed${signal !== null ? ` with signal ${signal}` : ` with exit code ${code}`}`,
          ),
        );
        return;
      }

      resolve();
    });
  }).finally(() => {
    if (shuttingDown) {
      return;
    }

    if (rebuildQueued) {
      rebuildQueued = false;
      scheduleRebuild();
    }
  });

  return runningBuild;
}

function scheduleRebuild() {
  if (shuttingDown) {
    return;
  }

  if (rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
  }

  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void runBuild().catch((error) => {
      console.error("[dev-bundle] rebuild failed", error);
    });
  }, rebuildDebounceMs);
}

function startWatchers() {
  const sourceWatcher = watch(
    join(desktopDir, "src"),
    { persistent: true, recursive: true },
    () => {
      scheduleRebuild();
    },
  );
  watchers.push(sourceWatcher);

  for (const pathToWatch of watchedPaths.slice(1)) {
    const watcher = watch(pathToWatch, { persistent: true }, () => {
      scheduleRebuild();
    });
    watchers.push(watcher);
  }
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (rebuildTimer !== null) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  process.exit(exitCode);
}

await runBuild();
startWatchers();

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});

await new Promise(() => {});
