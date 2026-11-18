/**
 * CI 冒烟入口：本地起 vite preview 伺服 dist，再跑 scripts/smoke.mjs。
 * 单独拆出来是为了让 workflow 只需要一行命令，且不依赖 shell 的后台进程管理。
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const BASE_PORT = Number(process.env.PREVIEW_PORT ?? 4173);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 BASE_PORT 起找一个空闲端口，避免本地残留服务干扰（CI 上是空环境）。 */
async function findFreePort() {
  for (let port = BASE_PORT; port < BASE_PORT + 20; port += 1) {
    const available = await new Promise((resolvePort) => {
      const server = createServer();
      server.once("error", () => resolvePort(false));
      server.once("listening", () => server.close(() => resolvePort(true)));
      server.listen(port, "127.0.0.1");
    });
    if (available) return port;
  }
  throw new Error(`找不到空闲端口（${BASE_PORT}–${BASE_PORT + 19}）`);
}

const PORT = await findFreePort();
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`preview: ${BASE}`);

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* 还没就绪 */
    }
    await sleep(250);
  }
  return false;
}

function startPreview() {
  const isWindows = process.platform === "win32";
  return spawn(
    isWindows ? "npx.cmd" : "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort"],
    {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
      shell: isWindows,
      detached: !isWindows,
    },
  );
}

function stopPreview(preview) {
  if (!preview.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(preview.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-preview.pid, "SIGTERM");
    }
  } catch {
    /* 进程可能已经退出 */
  }
}

const preview = startPreview();
let exitCode = 1;

try {
  if (!(await waitForServer(`${BASE}/`))) {
    console.error(`vite preview 没有在 ${PORT} 端口就绪`);
  } else {
    exitCode = await new Promise((resolveCode) => {
      const child = spawn(process.execPath, ["scripts/smoke.mjs"], {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          BASE_URL: BASE,
          SMOKE_STRICT: "1",
          CI: process.env.CI ?? "true",
        },
      });
      child.on("exit", (code) => resolveCode(code ?? 1));
    });
  }
} finally {
  stopPreview(preview);
}

process.exit(exitCode);
