// @effect-diagnostics nodeBuiltinImport:off
import { existsSync, readFileSync } from "node:fs";
import * as NodeOS from "node:os";
import { dirname, join } from "node:path";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveCommandPath } from "@t3tools/shared/shell";
import { expandHomePath } from "../../pathExpansion.ts";

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return path.resolve(homePath.length > 0 ? expandHomePath(homePath) : NodeOS.homedir());
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return baseEnv;
  const resolvedHomePath = yield* resolveClaudeHomePath(config);
  return {
    ...baseEnv,
    HOME: resolvedHomePath,
  };
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (config: Pick<ClaudeSettings, "homePath">): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    return `claude:home:${resolvedHomePath}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    return `${config.binaryPath}\0${resolvedHomePath}`;
  },
);

/**
 * On Windows the npm-installed `claude` resolves to a `claude.cmd` batch
 * wrapper. The Claude Agent SDK uses `child_process.spawn` (no shell), which
 * cannot execute `.cmd` files directly. This function tries to find the real
 * `claude.exe` so the SDK can spawn it without a shell intermediary.
 *
 * Strategy:
 *  1. Resolve the binary name to its full path via PATH lookup.
 *  2. If the result is a `.cmd` file, read it to extract the `.exe` path.
 *  3. Verify the exe exists and return it; otherwise fall back to the original.
 *
 * Non-Windows platforms return `binaryPath` unchanged.
 */
export function resolveClaudeExecutableForSdk(
  binaryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (process.platform !== "win32") return binaryPath;

  const resolvedPath = resolveCommandPath(binaryPath, { platform: "win32", env });
  if (!resolvedPath || !resolvedPath.toLowerCase().endsWith(".cmd")) {
    return resolvedPath ?? binaryPath;
  }

  const cmdDir = dirname(resolvedPath);

  // Read the .cmd wrapper to find the underlying .exe path.
  // npm wrappers typically contain a line like:
  //   "%dp0%\node_modules\@scope\pkg\bin\tool.exe"   %*
  try {
    const cmdContent = readFileSync(resolvedPath, "utf-8");
    const match = cmdContent.match(/"([^"]+\.exe)"\s+%\*/i);
    if (match?.[1]) {
      // %dp0% expands to the .cmd file's directory with a trailing backslash.
      const exePath = match[1].replace(/^%dp0%\\/i, cmdDir + "\\");
      if (existsSync(exePath)) return exePath;
    }
  } catch {
    // ignore — fall through to structural guess
  }

  // Structural fallback: standard npm global package layout
  //   {npm_bin}\node_modules\@anthropic-ai\claude-code\bin\claude.exe
  const structuralExe = join(cmdDir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  if (existsSync(structuralExe)) return structuralExe;

  return resolvedPath;
}
