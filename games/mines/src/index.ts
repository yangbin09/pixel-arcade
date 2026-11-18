import {
  P,
  clamp,
  defineGame,
  rect,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  drawCorners,
  drawCovered,
  drawFlag,
  drawMine,
  drawNumber,
  drawOpen,
} from "./art";
import { meta } from "./meta";
import {
  CELLS,
  SIZE,
  createBoard,
  isWin,
  placeMines,
  reveal,
  toggleFlag,
  type Board,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 8×8 棋盘：19px 格子 + 1px 缝，从 (8, 8) 起。 */
const CELL = 19;
const GAP = 1;
const STEP = CELL + GAP;
const ORIGIN = 8;
const BOARD = SIZE * STEP - GAP;

/** 长按阈值与允许的抖动半径。 */
const LONG_PRESS_MS = 350;
const SLOP = 8;

type Mode = "ready" | "playing" | "over";

interface Press {
  index: number;
  /** 按下时的计时（毫秒），松手时用它判断长按。 */
  at: number;
  x: number;
  y: number;
}

const cellX = (col: number): number => ORIGIN + col * STEP;
const cellY = (row: number): number => ORIGIN + row * STEP;

/** 逻辑坐标 → 格子序号；落在缝里或棋盘外返回 -1。 */
const cellAt = (x: number, y: number): number => {
  const rx = x - ORIGIN;
  const ry = y - ORIGIN;
  if (rx < 0 || ry < 0) return -1;
  const col = Math.floor(rx / STEP);
  const row = Math.floor(ry / STEP);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
  if (rx - col * STEP >= CELL || ry - row * STEP >= CELL) return -1;
  return row * SIZE + col;
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let board: Board = createBoard();
    let mode: Mode = "ready";
    let elapsed = 0;
    let lastSec = -1;
    let cursor = 27;
    let usingKeys = false;
    let hoverIndex = -1;
    let press: Press | null = null;
    let exploded = -1;
    let won = false;

    /* ---------------- HUD ---------------- */

    const syncBoardHud = (): void => {
      ctx.hud.set("flags", Math.max(0, board.mineCount - board.flags));
      ctx.hud.set("opened", board.openedCount);
    };

    const syncTime = (force = false): void => {
      const seconds = Math.ceil(elapsed / 1000);
      if (!force && seconds === lastSec) return;
      lastSec = seconds;
      ctx.hud.set("time", elapsed);
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      board = createBoard();
      mode = "ready";
      elapsed = 0;
      lastSec = -1;
      cursor = 27;
      usingKeys = false;
      hoverIndex = -1;
      press = null;
      exploded = -1;
      won = false;
      syncBoardHud();
      syncTime(true);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分由壳层按 low 模式写入。 */
    const finish = (cleared: boolean): void => {
      if (mode === "over") return;
      mode = "over";
      won = cleared;
      press = null;
      hoverIndex = -1;

      const seconds = Math.max(1, Math.ceil(elapsed / 1000));
      ctx.hud.set("time", elapsed);
      ctx.timer.hide();
      ctx.hud.urgent(false);

      if (cleared) ctx.audio.win();
      else ctx.audio.lose();

      // 让结算层背后的棋盘也停在同一帧：踩雷亮全雷，通关亮全旗。
      render();

      ctx.end({
        score: seconds,
        title: cleared ? "扫雷完成" : "踩到雷了",
        kicker: cleared ? "CLEAR" : "BOOM",
        stats: [
          { label: "已开格", value: `${board.openedCount}/${CELLS - board.mineCount}` },
          { label: "用时", value: `${seconds} 秒` },
        ],
      });
    };

    const revealAt = (index: number): void => {
      if (mode !== "playing" || ctx.isPaused() || index < 0) return;
      if (board.opened[index] || board.flagged[index]) return;

      // 首点安全：真正翻开之前才布雷，本格与 8 邻域一定不是雷。
      if (!board.placed) placeMines(board, index);

      const result = reveal(board, index);
      if (result.hitMine) {
        exploded = index;
        finish(false);
        return;
      }
      if (result.opened.length === 0) return;

      syncBoardHud();
      if (result.opened.length >= 5) ctx.audio.pop();
      else ctx.audio.blip();

      if (isWin(board)) finish(true);
    };

    const flagAt = (index: number): void => {
      if (mode !== "playing" || ctx.isPaused() || index < 0) return;
      const result = toggleFlag(board, index);
      if (result === "blocked") {
        if (!board.opened[index] && board.flags >= board.mineCount) {
          ctx.toast.show("旗子用完了", { warn: true, duration: 700 });
        }
        return;
      }
      syncBoardHud();
      ctx.hud.flash("flags", "is-bump");
      if (result === "on") ctx.audio.pop();
      else ctx.audio.blip();
    };

    /* ---------------- 绘制 ---------------- */

    const drawCell = (c: CanvasRenderingContext2D, index: number): void => {
      const x = cellX(index % SIZE);
      const y = cellY(Math.floor(index / SIZE));

      if (index === exploded) {
        rect(c, x, y, CELL, CELL, P.redDeep);
        drawMine(c, x + Math.floor(CELL / 2), y + Math.floor(CELL / 2), 4, P.void, P.white);
        return;
      }

      if (board.opened[index]) {
        drawOpen(c, x, y, CELL);
        drawNumber(c, x, y, CELL, board.counts[index]);
        return;
      }

      // 结算后把没被翻开的雷亮出来；插对的旗保持旗子。
      if (mode === "over" && board.mines[index]) {
        drawCovered(c, x, y, CELL);
        if (won || board.flagged[index]) drawFlag(c, x, y, CELL);
        else drawMine(c, x + Math.floor(CELL / 2), y + Math.floor(CELL / 2), 4, P.cream, P.void);
        return;
      }

      const held = press;
      const pressed = held !== null && held.index === index;
      drawCovered(c, x, y, CELL, pressed);

      if (board.flagged[index]) {
        drawFlag(c, x, y, CELL);
        return;
      }

      if (pressed && held !== null && elapsed - held.at >= LONG_PRESS_MS) {
        // 长按到阈值：先半透明预览，松手才真正落旗。
        c.save();
        c.globalAlpha = 0.55;
        drawFlag(c, x, y, CELL);
        c.restore();
      }
    };

    const render = (): void => {
      const c = ctx.ctx;
      rect(c, 0, 0, W, H, P.night);
      rect(c, ORIGIN - 1, ORIGIN - 1, BOARD + 2, BOARD + 2, P.void);
      strokeRect(c, ORIGIN - 1, ORIGIN - 1, BOARD + 2, BOARD + 2, P.line);

      for (let index = 0; index < CELLS; index += 1) drawCell(c, index);

      if (mode !== "playing") return;
      if (usingKeys) {
        drawCorners(c, cellX(cursor % SIZE), cellY(Math.floor(cursor / SIZE)), CELL, P.gold);
      } else if (hoverIndex >= 0) {
        drawCorners(c, cellX(hoverIndex % SIZE), cellY(Math.floor(hoverIndex / SIZE)), CELL, P.lav);
      }
    };

    /* ---------------- 输入 ---------------- */

    const canvasEl = ctx.input.pointer.el;
    const blockMenu = (event: Event): void => {
      event.preventDefault();
    };
    canvasEl.addEventListener("contextmenu", blockMenu);

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing") return;

      const type = info.source.pointerType || "mouse";
      if (type !== "touch") hoverIndex = cellAt(info.x, info.y);

      // 右键直接插旗；其他非左键忽略。
      if (type === "mouse" && info.source.button === 2) {
        flagAt(hoverIndex);
        return;
      }
      if (type === "mouse" && info.source.button !== 0) return;

      usingKeys = false;
      const index = cellAt(info.x, info.y);
      press = index >= 0 ? { index, at: elapsed, x: info.x, y: info.y } : null;
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing") return;

      const type = info.source.pointerType || "mouse";
      if (type !== "touch") hoverIndex = cellAt(info.x, info.y);

      // 拖出 8px 视为滑动，取消这次长按/点击。
      if (press && (Math.abs(info.x - press.x) > SLOP || Math.abs(info.y - press.y) > SLOP)) {
        press = null;
      }
    });

    ctx.input.pointer.on("up", (info) => {
      const held = press;
      press = null;
      if (mode !== "playing" || !held) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      // 长按与点击互斥：以按住时长判定。
      if (elapsed - held.at >= LONG_PRESS_MS) flagAt(held.index);
      else revealAt(held.index);
    });

    ctx.input.pointer.on("cancel", () => {
      press = null;
    });

    ctx.input.pointer.on("leave", (info) => {
      const type = info.source.pointerType || "mouse";
      if (type !== "touch") hoverIndex = -1;
      press = null;
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;

      if (action === "left" || action === "right" || action === "up" || action === "down") {
        usingKeys = true;
        press = null;
        hoverIndex = -1;
        const col = cursor % SIZE;
        const row = Math.floor(cursor / SIZE);
        const nextCol = clamp(col + (action === "right" ? 1 : action === "left" ? -1 : 0), 0, SIZE - 1);
        const nextRow = clamp(row + (action === "down" ? 1 : action === "up" ? -1 : 0), 0, SIZE - 1);
        cursor = nextRow * SIZE + nextCol;
        return;
      }

      if (action === "action" || action === "primary") {
        usingKeys = true;
        hoverIndex = -1;
        revealAt(cursor);
        return;
      }

      if (action === "secondary") {
        usingKeys = true;
        hoverIndex = -1;
        flagAt(cursor);
      }
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        ctx.timer.hide();
        ctx.audio.ui();
        ctx.announce("扫雷开始，第一下是安全的。");
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        elapsed += dt;
        syncTime();
      },

      render,

      pause(): void {
        press = null;
        hoverIndex = -1;
      },

      destroy(): void {
        canvasEl.removeEventListener("contextmenu", blockMenu);
        press = null;
      },
    };
  },
});

export default game;
