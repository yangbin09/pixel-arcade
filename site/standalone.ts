import "@styles/standalone-entry.css";

import { PlayShell, ready, type GameMeta, type GameModule } from "@arcade/core";
import { validateMeta } from "@arcade/registry";
import { mountHome, type HomeView } from "./home-view";

/**
 * 离线单文件版：
 * 所有游戏都 eager 导入（构建期会被内联进一个 HTML），用 hash 在首页/游戏之间切换。
 * 双击 index.html 就能玩，file:// 下不需要任何服务器。
 */
const metaModules = import.meta.glob<{ meta: GameMeta }>("../games/*/src/meta.ts", { eager: true });
const gameModules = import.meta.glob<{ default: GameModule }>("../games/*/src/index.ts", { eager: true });

const metas = Object.values(metaModules)
  .map((mod) => mod.meta)
  .filter((meta): meta is GameMeta => !!meta && typeof meta.id === "string");

if (import.meta.env.DEV) {
  for (const meta of metas) {
    for (const problem of validateMeta(meta)) console.warn("[registry]", problem);
  }
}

const homeTitle = document.title;
const homeEl = document.getElementById("homeView");
const shellEl = document.getElementById("shell");

let home: HomeView | null = null;
let shell: PlayShell | null = null;

function destroyShell(): void {
  if (!shell) return;
  shell.destroy();
  shell = null;
}

function showHome(): void {
  destroyShell();
  document.body.className = "page-home";
  delete document.body.dataset.gameState;
  document.title = homeTitle;
  if (shellEl) shellEl.hidden = true;
  if (homeEl) homeEl.hidden = false;
  home?.refreshBest();
  window.scrollTo(0, 0);
}

function showGame(id: string): void {
  const mod = gameModules[`../games/${id}/src/index.ts`];
  if (!mod?.default) {
    location.hash = "#home";
    return;
  }
  destroyShell();
  if (homeEl) homeEl.hidden = true;
  if (shellEl) shellEl.hidden = false;
  document.body.className = "page-play";
  shell = new PlayShell({
    meta: mod.default.meta,
    create: mod.default.create,
    homeHref: "#home",
  });
  window.scrollTo(0, 0);
}

function route(): void {
  const hash = location.hash;
  const match = /^#game=([\w-]+)$/.exec(hash);
  if (match) {
    showGame(match[1]!);
    return;
  }
  if (hash === "#home" || hash === "") {
    showHome();
    return;
  }
  // 其他锚点（跳到列表/画面）不切视图
}

ready(() => {
  if (!homeEl || !shellEl) return;
  home = mountHome({
    metas,
    hrefFor: (id) => `#game=${id}`,
    root: homeEl,
  });

  if (!location.hash) location.hash = "#home";
  route();
  window.addEventListener("hashchange", route);
  window.addEventListener("pagehide", () => destroyShell(), { once: true });
});
