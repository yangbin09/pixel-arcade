/**
 * 线上站点功能验证（CDP + 无头 Chrome）：
 * 首页 10 张卡片、10 款游戏都能进入 playing、控制台与资源请求无错误。
 *
 * 用法：
 *   BASE_URL=https://pixel-arcade.appwrite.network node scripts/ci/verify-live.mjs
 *   SHOTS=1 BASE_URL=... node scripts/ci/verify-live.mjs   # 额外存截图
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findChrome, ciChromeArgs } from "../lib/find-chrome.mjs";

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("缺少 BASE_URL，例如 BASE_URL=https://pixel-arcade.appwrite.network");
  process.exit(1);
}

const GAMES = ["whack", "snake", "breakout", "invaders", "blocks", "merge", "memory", "dodge", "tiles", "mines"];
const PORT = Number(process.env.CDP_PORT ?? 9361);
const OUT = resolve(process.cwd(), ".artifacts/verify-live");
const PROFILE = resolve(process.cwd(), ".artifacts/chrome-profile-verify");
const SHOTS = process.env.SHOTS === "1";
const VIEWPORT = (process.env.VIEWPORT ?? "390x844").split("x").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = findChrome();
if (!CHROME) {
  console.error("找不到 Chrome/Chromium，请设置 CHROME_PATH");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--disable-extensions",
    "--mute-audio",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--force-device-scale-factor=1",
    ...ciChromeArgs(),
    "about:blank",
  ],
  { stdio: "ignore" },
);

function connect(wsUrl) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Map();
    const errors = [];
    let seq = 0;

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { ok, fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else ok(message.result);
        return;
      }
      if (message.method) {
        for (const fn of listeners.get(message.method) ?? []) fn(message.params);
      }
    });

    ws.addEventListener("open", () =>
      resolvePromise({
        errors,
        send(method, params = {}) {
          const id = ++seq;
          return new Promise((ok, fail) => {
            pending.set(id, { ok, fail });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        on(method, fn) {
          const list = listeners.get(method) ?? [];
          list.push(fn);
          listeners.set(method, list);
        },
        close() {
          ws.close();
        },
      }),
    );
    ws.addEventListener("error", reject);
  });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "evaluate 失败");
  }
  return result.result.value;
}

async function waitFor(client, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) return true;
    } catch {
      /* 页面还在加载 */
    }
    await sleep(200);
  }
  return false;
}

const results = [];
let exitCode = 0;

try {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) break;
    } catch {
      /* 等 Chrome */
    }
    await sleep(150);
  }

  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })
  ).json();
  const client = await connect(target.webSocketDebuggerUrl);

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT[0] ?? 390,
    height: VIEWPORT[1] ?? 844,
    deviceScaleFactor: 2,
    mobile: (VIEWPORT[0] ?? 390) < 600,
  });
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  client.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") {
      client.errors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
  });
  client.on("Runtime.exceptionThrown", (params) => {
    client.errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
  });
  client.on("Log.entryAdded", (params) => {
    if (params.entry.level === "error") client.errors.push(params.entry.text);
  });
  client.on("Network.responseReceived", (params) => {
    const { status, url } = params.response;
    if (status >= 400 && url.startsWith(BASE) && !/favicon/i.test(url)) {
      client.errors.push(`HTTP ${status} ${url}`);
    }
  });

  // ---------------- 首页 ----------------
  await client.send("Page.navigate", { url: `${BASE}/` });
  const homeOk = await waitFor(client, `document.querySelectorAll('.game-grid > li').length >= 10`, 20_000);
  const home = await evaluate(
    client,
    `(() => ({
      cards: document.querySelectorAll('.game-grid > li').length,
      thumbs: document.querySelectorAll('canvas[data-thumb]').length,
      title: document.title,
    }))()`,
  );
  results.push({ page: "home", ok: homeOk, ...home, errors: [...client.errors] });
  console.log(
    `home      cards=${home.cards} thumbs=${home.thumbs} title=${JSON.stringify(home.title)} errors=${client.errors.length}`,
  );
  if (!homeOk || home.cards < 10 || home.thumbs < 10) exitCode = 1;
  client.errors.length = 0;

  if (SHOTS) {
    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(OUT, "home.png"), Buffer.from(shot.data, "base64"));
  }

  // ---------------- 10 款游戏 ----------------
  for (const id of GAMES) {
    client.errors.length = 0;
    await client.send("Page.navigate", { url: `${BASE}/play/?game=${id}` });

    // 等壳层挂载：开始按钮出现，且画布已按 DPR 放大（避免 CDN 冷启动假失败）
    const shellReady = await waitFor(
      client,
      `(() => {
        const btn = document.querySelector('[data-action="start"]');
        const field = document.querySelector('#field');
        return !!btn && !!field && field.width > 168;
      })()`,
      20_000,
    );

    const ready = await evaluate(
      client,
      `(() => {
        const field = document.querySelector('#field');
        return {
          canvas: field ? field.width + 'x' + field.height : '',
          state: document.body.dataset.gameState,
          title: document.querySelector('#gameTitle')?.textContent ?? '',
        };
      })()`,
    );

    const clicked = await evaluate(
      client,
      `(() => {
        const btn = document.querySelector('[data-action="start"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`,
    );

    const started = await waitFor(
      client,
      `['playing','over'].includes(document.body.dataset.gameState)`,
      15_000,
    );
    const finalState = await evaluate(client, `document.body.dataset.gameState`);

    results.push({
      game: id,
      shellReady,
      clicked,
      started,
      state: finalState,
      canvas: ready.canvas,
      title: ready.title,
      errors: [...client.errors],
    });
    const ok = shellReady && clicked && started && client.errors.length === 0;
    if (!ok) exitCode = 1;
    console.log(
      `${id.padEnd(9)} shell=${shellReady} click=${clicked} start=${started} state=${finalState} canvas=${ready.canvas} title=${ready.title} errors=${client.errors.length}`,
    );

    if (SHOTS) {
      const shot = await client.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(resolve(OUT, `${id}.png`), Buffer.from(shot.data, "base64"));
    }
  }

  client.close();
} catch (error) {
  console.error("线上验证失败：", error?.message ?? error);
  exitCode = 1;
} finally {
  chrome.kill();
  const failed = results.filter(
    (entry) => entry.page === "home" ? !entry.ok : !(entry.shellReady && entry.clicked && entry.started) || entry.errors.length > 0,
  );
  const summary = {
    base: BASE,
    home: results.find((entry) => entry.page === "home") ?? null,
    gamesOk: results.filter((entry) => entry.game && entry.shellReady && entry.started).length,
    totalGames: GAMES.length,
    failed,
    errors: results.flatMap((entry) => entry.errors),
  };
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        base: BASE,
        gamesOk: summary.gamesOk,
        totalGames: summary.totalGames,
        failedCount: failed.length,
        consoleErrors: summary.errors.length,
      },
      null,
      2,
    ),
  );
  if (failed.length) console.log("FAILED:", JSON.stringify(failed, null, 2));
}

process.exit(exitCode);
