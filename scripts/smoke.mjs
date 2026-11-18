/**
 * 冒烟测试：用 CDP 驱动无头 Chrome，逐个打开游戏页，
 * 检查控制台错误、画布尺寸、HUD、开始按钮，并截图存档。
 *
 * 用法：
 *   node scripts/smoke.mjs                 # 全部游戏
 *   node scripts/smoke.mjs whack snake     # 指定游戏
 *   BASE_URL=http://localhost:4173 node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "D:\\ruanjian\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error("找不到 Chrome/Edge，请设置 CHROME_PATH");
  process.exit(1);
}

const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const OUT = resolve(process.cwd(), ".artifacts/smoke");
const PROFILE = resolve(process.cwd(), ".artifacts/chrome-profile");
const PORT = Number(process.env.CDP_PORT ?? 9333);

const ALL = [
  "whack",
  "snake",
  "breakout",
  "invaders",
  "blocks",
  "merge",
  "memory",
  "dodge",
  "tiles",
  "mines",
];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  throw new Error("Chrome DevTools 没有启动");
}

function connect(wsUrl) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = new Map();
    let seq = 0;

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message));
        else ok(msg.result);
        return;
      }
      if (msg.method) {
        for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });

    ws.addEventListener("open", () => {
      resolvePromise({
        send(method, params = {}) {
          const id = ++seq;
          return new Promise((ok, fail) => {
            pending.set(id, { resolve: ok, reject: fail });
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
      });
    });
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
    "--force-device-scale-factor=1",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const report = [];

try {
  await waitForDevtools();
  const target = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })
  ).json();
  const client = await connect(target.webSocketDebuggerUrl);

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  const [viewW, viewH] = (process.env.VIEWPORT ?? "390x844").split("x").map(Number);
  const isMobile = (viewW ?? 390) < 600;
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewW ?? 390,
    height: viewH ?? 844,
    deviceScaleFactor: isMobile ? 2 : 1,
    mobile: isMobile,
  });
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: isMobile, maxTouchPoints: 5 });

  const errors = [];
  client.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") {
      errors.push(params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
  });
  client.on("Runtime.exceptionThrown", (params) => {
    errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
  });
  client.on("Log.entryAdded", (params) => {
    if (params.entry.level === "error") errors.push(params.entry.text);
  });

  const shoot = async (name) => {
    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
  };

  // 首页
  errors.length = 0;
  await client.send("Page.navigate", { url: `${BASE}/` });
  await sleep(900);
  const home = await evaluate(
    client,
    `(() => {
      const cards = [...document.querySelectorAll('.game-grid > li')];
      return {
        cards: cards.length,
        open: cards.filter((li) => li.querySelector('.game-card--open')).length,
        soon: cards.filter((li) => li.querySelector('.game-card--soon')).length,
        thumbs: [...document.querySelectorAll('canvas[data-thumb]')].map((c) => ({ id: c.dataset.thumb, w: c.width })),
        count: document.querySelector('#catalogCount')?.textContent,
        title: document.title,
      };
    })()`,
  );
  await shoot("home");
  report.push({ page: "home", ...home, errors: [...errors] });

  for (const id of ids) {
    errors.length = 0;
    await client.send("Page.navigate", { url: `${BASE}/play/?game=${id}` });
    await sleep(1000);

    const ready = await evaluate(
      client,
      `(() => {
        const f = document.querySelector('#field');
        const s = document.querySelector('#screen');
        const fr = f.getBoundingClientRect();
        const sr = s.getBoundingClientRect();
        return {
          title: document.querySelector('#gameTitle')?.textContent ?? '',
          state: document.body.dataset.gameState,
          hasRules: !!document.querySelector('#notes .tag'),
          hud: [...document.querySelectorAll('.stat')].map((st) => ({
            label: st.querySelector('.stat-label')?.textContent?.trim(),
            aria: st.querySelector('canvas')?.getAttribute('aria-label'),
          })),
          timer: document.querySelector('#timerWrap')?.hidden,
          actions: [...document.querySelectorAll('.play-actions .icon-btn')].map((b) => {
            const r = b.getBoundingClientRect();
            return { icon: b.querySelector('canvas')?.dataset.icon, w: Math.round(r.width), x: Math.round(r.x) };
          }),
          screen: { w: Math.round(sr.width), h: Math.round(sr.height) },
          field: {
            w: Math.round(fr.width),
            h: Math.round(fr.height),
            dx: Math.round(fr.left - sr.left),
            dy: Math.round(fr.top - sr.top),
            backing: f.width + 'x' + f.height,
          },
        };
      })()`,
    );

    await shoot(`${id}-ready`);

    const started = await evaluate(
      client,
      `(() => {
        const btn = document.querySelector('[data-action="start"]');
        if (!btn) return { clicked: false };
        btn.click();
        return { clicked: true };
      })()`,
    );

    // 开始后先截一张倒计时（如果这个游戏有壳层倒计时）
    await sleep(500);
    await shoot(`${id}-countdown`);

    // 等倒计时结束（最多 6 秒），游戏真正进入 playing 再截图
    let playing = { state: "unknown", overlayHidden: false, hud: [], hasErrorPanel: false };
    for (let i = 0; i < 20; i += 1) {
      await sleep(300);
      playing = await evaluate(
        client,
        `(() => ({
          state: document.body.dataset.gameState,
          overlayHidden: document.querySelector('#overlay').hidden,
          hud: [...document.querySelectorAll('.stat')].map((st) => st.querySelector('canvas')?.getAttribute('aria-label')),
          hasErrorPanel: !document.querySelector('[data-panel="result"]')?.hidden,
        }))()`,
      );
      if (playing.state === "playing" || playing.state === "over") break;
    }

    await shoot(`${id}-play`);

    // 暂停 / 恢复：验证壳层状态机对每个游戏都成立
    await evaluate(client, `document.querySelector('#pauseBtn').click()`);
    await sleep(350);
    const paused = await evaluate(
      client,
      `(() => ({
        state: document.body.dataset.gameState,
        overlayVisible: !document.querySelector('#overlay').hidden,
        pausePanelVisible: !document.querySelector('[data-panel="pause"]').hidden,
      }))()`,
    );
    await shoot(`${id}-pause`);
    await evaluate(client, `document.querySelector('[data-action="resume"]').click()`);
    await sleep(350);
    const resumed = await evaluate(
      client,
      `(() => ({
        state: document.body.dataset.gameState,
        overlayHidden: document.querySelector('#overlay').hidden,
      }))()`,
    );

    report.push({
      game: id,
      ready,
      started: started.clicked,
      playing,
      paused,
      resumed,
      errors: [...errors],
    });

    console.log(
      `${id.padEnd(9)} state=${ready.state}->${playing.state} pause=${paused.state}/${paused.pausePanelVisible} resume=${resumed.state} canvas=${ready.field.backing} css=${ready.field.w}x${ready.field.h} hud=${ready.hud.map((h) => h.aria).join("|")} errors=${errors.length}`,
    );
  }

  client.close();
} catch (error) {
  console.error("冒烟测试失败：", error);
  process.exitCode = 1;
} finally {
  chrome.kill();
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n截图与报告：${OUT}`);
}
