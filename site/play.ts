import "@styles/play-entry.css";

import { PlayShell, ready, type GameModule } from "@arcade/core";
import { SLOTS } from "@arcade/registry";

/**
 * 播放壳入口：一个页面跑 10 个游戏，靠 ?game=id 决定加载哪个模块。
 * 每个游戏是独立包，Vite 会把它拆成独立 chunk，只有进这个游戏才下载。
 */
const loaders = import.meta.glob<{ default: GameModule }>("../games/*/src/index.ts");

function showNotFound(id: string): void {
  const overlay = document.querySelector<HTMLElement>("#overlay");
  const title = document.querySelector<HTMLElement>("#gameTitle");
  if (title) title.textContent = "没有这个游戏";
  if (!overlay) return;
  overlay.hidden = false;
  overlay.innerHTML = `
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="nfTitle">
      <p class="dialog-kicker">404 / NOT FOUND</p>
      <h2 id="nfTitle">机位空着</h2>
      <p class="dialog-lead">没有找到「${id.replace(/[<>&"]/g, "")}」这个游戏，可能还没上线。</p>
      <div class="dialog-actions">
        <a class="btn btn-primary" href="../index.html">回到街机厅</a>
      </div>
    </section>`;
}

function boot(): void {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("game") ?? "whack";
  const slot = SLOTS.find((item) => item.id === id);

  if (!slot) {
    showNotFound(id);
    return;
  }

  const loader = loaders[`../games/${id}/src/index.ts`];
  if (!loader) {
    showNotFound(id);
    return;
  }

  loader()
    .then((mod) => {
      const game = mod.default;
      if (!game?.meta || typeof game.create !== "function") {
        showNotFound(id);
        return;
      }
      const shell = new PlayShell({ meta: game.meta, create: game.create });
      window.addEventListener("pagehide", () => shell.destroy(), { once: true });
    })
    .catch((error: unknown) => {
      console.error("[pixel-arcade] 游戏加载失败", error);
      showNotFound(id);
    });
}

ready(boot);
