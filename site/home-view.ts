import {
  paintAllIcons,
  prefersReducedMotion,
  qsa,
  Store,
  type GameMeta,
} from "@arcade/core";
import { orderMetas, SLOTS } from "@arcade/registry";
import { createCard } from "@arcade/ui";
import { drawSoonThumb } from "./soon-thumb";

const LOGICAL_W = 80;
const LOGICAL_H = 50;

export interface HomeViewOptions {
  root?: ParentNode;
  metas: GameMeta[];
  /** 卡片链接：多页版是 ./play/?game=id，单文件版是 #game=id */
  hrefFor: (id: string) => string;
  /** 是否给第一张可玩卡片做待机动画，默认 true。 */
  animate?: boolean;
}

export interface HomeView {
  render(): void;
  refreshBest(): void;
  destroy(): void;
}

/** 首页视图：多页版与单文件离线版共用同一套卡片逻辑。 */
export function mountHome(options: HomeViewOptions): HomeView {
  const root = options.root ?? document;
  const metas = orderMetas(options.metas.slice());
  const byId = new Map(metas.map((meta) => [meta.id, meta]));
  const animate = options.animate ?? true;

  let idleTimer = 0;
  let idleCanvas: HTMLCanvasElement | null = null;
  let onVisibility: (() => void) | null = null;
  let onResize: (() => void) | null = null;

  const thumbContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / LOGICAL_W, 0, 0, canvas.height / LOGICAL_H, 0, 0);
    ctx.imageSmoothingEnabled = false;
    return ctx;
  };

  const paintThumb = (canvas: HTMLCanvasElement, time: number): void => {
    const ctx = thumbContext(canvas);
    if (!ctx) return;
    const name = canvas.dataset.thumb ?? "";
    const meta = byId.get(name);
    if (meta) meta.drawThumb(ctx, LOGICAL_W, LOGICAL_H, time);
    else drawSoonThumb(ctx, LOGICAL_W, LOGICAL_H, Number(canvas.dataset.seed) || 2);
  };

  const startIdle = (): void => {
    if (!animate || !idleCanvas || idleTimer || prefersReducedMotion()) return;
    idleTimer = window.setInterval(() => {
      if (idleCanvas) paintThumb(idleCanvas, performance.now() / 1000);
    }, 110);
  };

  const stopIdle = (): void => {
    if (!idleTimer) return;
    window.clearInterval(idleTimer);
    idleTimer = 0;
  };

  const render = (): void => {
    const grid = root.querySelector<HTMLElement>("#gameGrid");
    if (!grid) return;
    grid.innerHTML = "";
    stopIdle();

    let openCount = 0;

    SLOTS.forEach((slot, index) => {
      const meta = byId.get(slot.id);
      if (meta) openCount += 1;
      const best = meta ? Store.best(meta.id, meta.scoreMode ?? "high") : null;
      grid.append(
        createCard(
          {
            id: slot.id,
            no: slot.no,
            title: meta?.title ?? "敬请期待",
            tagline: meta?.tagline ?? "空机位 · 正在打磨像素",
            duration: meta?.duration ?? "",
            open: !!meta,
            best,
            bestLabel: meta?.bestLabel ?? "最高分",
            scoreMode: meta?.scoreMode ?? "high",
          },
          index,
          options.hrefFor(slot.id),
        ),
      );
    });

    for (const canvas of qsa<HTMLCanvasElement>("canvas[data-thumb]", grid)) {
      paintThumb(canvas, 0);
    }

    idleCanvas = grid.querySelector<HTMLCanvasElement>("canvas[data-thumb]:not([data-thumb='soon'])");

    const total = SLOTS.length;
    const soonCount = total - openCount;
    const statOpen = root.querySelector("#statOpen");
    const statSoon = root.querySelector("#statSoon");
    const count = root.querySelector("#catalogCount");
    if (statOpen) statOpen.textContent = String(openCount).padStart(2, "0");
    if (statSoon) statSoon.textContent = String(soonCount).padStart(2, "0");
    if (count) {
      count.textContent = `${String(openCount).padStart(2, "0")} / ${total} OPEN`;
      count.setAttribute("aria-label", `${total} 个位置，${openCount} 个已开放`);
    }
    const statRound = root.querySelector("#statRound");
    if (statRound) {
      const hasMinutes = metas.some((meta) => /分钟|min/i.test(meta.duration));
      statRound.innerHTML = hasMinutes ? '30<span>s+</span>' : '30<span>s</span>';
    }

    startIdle();
  };

  const refreshBest = (): void => {
    for (const node of qsa<HTMLElement>("[data-best]", root)) {
      const id = node.dataset.best ?? "";
      const meta = byId.get(id);
      if (!meta) continue;
      const best = Store.best(id, meta.scoreMode ?? "high");
      node.textContent =
        best === null ? "—" : meta.scoreMode === "low" ? String(best) : String(best).padStart(5, "0");
      const card = node.closest(".game-card");
      if (card) {
        card.setAttribute(
          "aria-label",
          `${meta.title}，${meta.tagline}，${meta.bestLabel ?? "最高分"} ${best ?? "暂无"}，开始游戏`,
        );
      }
    }
  };

  onVisibility = () => {
    if (document.hidden) stopIdle();
    else {
      refreshBest();
      startIdle();
    }
  };
  onResize = () => {
    paintAllIcons(root);
    for (const canvas of qsa<HTMLCanvasElement>("canvas[data-thumb]", root)) paintThumb(canvas, 0);
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);
  window.addEventListener("pageshow", refreshBest);

  paintAllIcons(root);
  render();
  refreshBest();

  return {
    render,
    refreshBest,
    destroy() {
      stopIdle();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      if (onResize) window.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", refreshBest);
    },
  };
}
