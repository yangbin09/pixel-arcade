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
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findChrome, ciChromeArgs } from "./lib/find-chrome.mjs";

const CHROME = findChrome();
if (!CHROME) {
  console.error("找不到 Chrome/Edge，请设置 CHROME_PATH");
  process.exit(1);
}

// CI 下把「游戏没进 playing / 有控制台错误」当作真实失败；本地默认只记录。
const STRICT = process.env.SMOKE_STRICT === "1" || process.env.CI === "true" || process.env.CI === "1";

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
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    "--force-device-scale-factor=1",
    ...ciChromeArgs(),
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
  await client.send("Page.bringToFront");

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
          pad: {
            visible: !document.querySelector('#pad').classList.contains('is-collapsed'),
            buttons: [...document.querySelectorAll('#pad button')].map((b) => b.getAttribute('aria-label')),
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
          bodyClass: document.body.className,
          nativeFs: !!document.fullscreenElement,
          shellClass: document.querySelector('#shell').className,
          topbarH: Math.round(document.querySelector('#topbar').getBoundingClientRect().height),
          screen: (() => { const r = document.querySelector('#screen').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
          field: (() => { const r = document.querySelector('#field').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
          frame: (() => { const r = document.querySelector('#screenFrame').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
        }))()`,
      );
      if (playing.state === "playing" || playing.state === "over") break;
    }

    // 先暂停：把游戏冻结住，布局截图不会被 snake 撞墙 / 白块落地干扰。
    await evaluate(client, `document.querySelector('#pauseBtn').click()`);
    await sleep(250);
    const paused = await evaluate(
      client,
      `(() => ({
        state: document.body.dataset.gameState,
        overlayVisible: !document.querySelector('#overlay').hidden,
        pausePanelVisible: !document.querySelector('[data-panel="pause"]').hidden,
      }))()`,
    );
    await shoot(`${id}-pause`);

    // 隐藏暂停面板，截一张稳定的布局图。
    await evaluate(client, `document.querySelector('#overlay').hidden = true`);
    await sleep(320);
    const finalLayout = await evaluate(
      client,
      `(() => {
        const s = document.querySelector('#screen').getBoundingClientRect();
        const f = document.querySelector('#field').getBoundingClientRect();
        const fr = document.querySelector('#screenFrame').getBoundingClientRect();
        return {
          topbarH: Math.round(document.querySelector('#topbar').getBoundingClientRect().height),
          hudH: Math.round(document.querySelector('#hud').getBoundingClientRect().height),
          padH: Math.round(document.querySelector('#pad').getBoundingClientRect().height),
          cabinetH: Math.round(document.querySelector('#cabinet').getBoundingClientRect().height),
          screen: [Math.round(s.width), Math.round(s.height)],
          field: [Math.round(f.width), Math.round(f.height)],
          frame: [Math.round(fr.width), Math.round(fr.height)],
        };
      })()`,
    );
    await shoot(`${id}-play`);

    // 恢复暂停面板并继续
    await evaluate(
      client,
      `document.querySelector('#overlay').hidden = false;
       document.querySelector('[data-action="resume"]').click()`,
    );
    await sleep(350);
    const resumed = await evaluate(
      client,
      `(() => ({
        state: document.body.dataset.gameState,
        overlayHidden: document.querySelector('#overlay').hidden,
      }))()`,
    );

    // 真事件：点一下画布中心、按一次方向键、再拖一下，抓运行时错误
    const box = await evaluate(
      client,
      `(() => {
        const f = document.querySelector('#field');
        const r = f.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width) };
      })()`,
    );
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: box.x,
      y: box.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: box.x,
      y: box.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowLeft",
      code: "ArrowLeft",
      windowsVirtualKeyCode: 37,
      nativeVirtualKeyCode: 37,
    });
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "ArrowLeft",
      code: "ArrowLeft",
      windowsVirtualKeyCode: 37,
      nativeVirtualKeyCode: 37,
    });
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 4; i += 1) {
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: box.x + (box.w / 6) * i,
        y: box.y,
        button: "left",
        buttons: 1,
      });
    }
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: box.x + box.w / 2,
      y: box.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(600);
    const afterInput = await evaluate(
      client,
      `(() => ({
        state: document.body.dataset.gameState,
        hud: [...document.querySelectorAll('.stat')].map((st) => st.querySelector('canvas')?.getAttribute('aria-label')),
        resultVisible: !document.querySelector('[data-panel="result"]')?.hidden,
      }))()`,
    );
    await shoot(`${id}-after-input`);

    // 机台开关：PAD / CRT 收起再打开，确认状态和 aria 同步
    const toggles = await evaluate(
      client,
      `(() => {
        const pad = document.querySelector('#pad');
        const padBtn = document.querySelector('#padToggle');
        const crtBtn = document.querySelector('#crtToggle');
        const before = { pad: !pad.classList.contains('is-collapsed'), crt: document.body.classList.contains('is-crt') };
        padBtn.click();
        const padOff = {
          collapsed: pad.classList.contains('is-collapsed'),
          controlsHidden: document.querySelector('.pad-controls')?.hidden,
          checked: padBtn.getAttribute('aria-checked'),
        };
        padBtn.click();
        crtBtn.click();
        const crtOff = { crt: document.body.classList.contains('is-crt'), checked: crtBtn.getAttribute('aria-checked') };
        crtBtn.click();
        return {
          before,
          padOff,
          crtOff,
          after: { pad: !pad.classList.contains('is-collapsed'), crt: document.body.classList.contains('is-crt') },
        };
      })()`,
    );

    // 收起手柄的最终布局：屏幕应该吃掉拉手让出的高度
    await evaluate(client, `document.querySelector('#padToggle').click()`);
    await sleep(260);
    const collapsedLayout = await evaluate(
      client,
      `(() => {
        const s = document.querySelector('#screen').getBoundingClientRect();
        const f = document.querySelector('#field').getBoundingClientRect();
        return {
          collapsed: document.querySelector('#pad').classList.contains('is-collapsed'),
          handleH: Math.round(document.querySelector('.pad-handle').getBoundingClientRect().height),
          screen: [Math.round(s.width), Math.round(s.height)],
          field: [Math.round(f.width), Math.round(f.height)],
        };
      })()`,
    );
    await shoot(`${id}-pad-collapsed`);
    await evaluate(client, `document.querySelector('#padToggle').click()`);
    await sleep(120);

    report.push({
      game: id,
      ready,
      started: started.clicked,
      playing,
      finalLayout,
      paused,
      resumed,
      afterInput,
      toggles,
      collapsedLayout,
      errors: [...errors],
    });

    console.log(
      `${id.padEnd(9)} state=${ready.state}->${playing.state} pause=${paused.state} resume=${resumed.state} input=${afterInput.state}${afterInput.resultVisible ? "/result" : ""} canvas=${ready.field.backing} errors=${errors.length}`,
    );
  }

  // CI 校验：首页卡片齐全、每局都能点开始并进入 playing、控制台无错误。
  const failures = [];
  const homeReport = report.find((entry) => entry.page === "home");
  if (!homeReport || homeReport.cards < 10) {
    failures.push(`首页游戏卡片不足：${homeReport?.cards ?? 0}/10`);
  }
  for (const entry of report) {
    if (!entry.game) continue;
    if (!entry.started) failures.push(`${entry.game}: 没有找到开始按钮`);
    if (!["playing", "over"].includes(entry.playing.state)) {
      failures.push(`${entry.game}: 点开始后状态是 ${entry.playing.state}`);
    }
    if (entry.errors.length) failures.push(`${entry.game}: 控制台错误 ${entry.errors.join(" | ")}`);
  }
  if (failures.length) {
    console.error(`\n冒烟测试未通过：\n - ${failures.join("\n - ")}`);
    if (STRICT) process.exitCode = 1;
  } else {
    console.log(
      `\n冒烟测试通过：${ids.length} 个游戏全部进入 playing，首页 ${homeReport.cards} 张卡片，0 控制台错误`,
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
