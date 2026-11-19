import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  rect,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  CELL,
  VIEW_H,
  VIEW_W,
  cellAt,
  cellX,
  cellY,
  drawCorners,
  drawLamp,
  drawLevelPips,
  paintBackdrop,
} from "./art";
import { meta } from "./meta";
import {
  CELLS,
  LEVELS,
  SIZE,
  START_CURSOR,
  createBoard,
  cursorStep,
  isSolved,
  litCount,
  scramble,
  toggle,
  type Board,
} from "./logic";

type Mode = "ready" | "playing" | "over";

/** 过关闪光时长：闪完才进下一关。 */
const CLEAR_FLASH_MS = 700;

/** HUD 数字按栏位宽度夹住，避免 4 位数把布局撑开。 */
const clampHud = (value: number, digits: number): number =>
  clamp(Math.round(value), 0, Math.pow(10, digits) - 1);

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let board: Board = createBoard();
    let mode: Mode = "ready";
    let level = 1;
    /** 本关已走步数。 */
    let levelMoves = 0;
    /** 已过关卡累计步数 = 本局低分成绩。 */
    let totalMoves = 0;
    let cursor = START_CURSOR;
    let usingKeys = false;
    let hoverIndex = -1;
    /** > 0 表示正在播放过关闪光，输入与关卡推进都暂停。 */
    let clearTimer = 0;
    let clock = 0;
    let ended = false;

    /* ---------------- HUD ---------------- */

    const syncHud = (bump = false): void => {
      ctx.hud.set("moves", clampHud(totalMoves + levelMoves, 3));
      ctx.hud.set("left", clampHud(litCount(board), 2));
      ctx.hud.set("level", clampHud(level, 2));
      if (bump) ctx.hud.flash("moves", "is-bump");
    };

    const render = (): void => {
      const c = ctx.ctx;
      paintBackdrop(c);
      drawLevelPips(c, level, LEVELS, clock);

      const pulse = ctx.reducedMotion ? 0 : clock % 1.1 < 0.55 ? 1 : 0;
      for (let index = 0; index < CELLS; index += 1) {
        const row = Math.floor(index / SIZE);
        const col = index % SIZE;
        drawLamp(c, cellX(col), cellY(row), CELL, board[index] === true, pulse);
      }

      if (mode === "playing" && clearTimer <= 0) {
        const focus = usingKeys ? cursor : hoverIndex;
        if (focus >= 0) {
          const row = Math.floor(focus / SIZE);
          const col = focus % SIZE;
          drawCorners(c, cellX(col), cellY(row), CELL, usingKeys ? P.gold : P.lav);
        }
      }

      // 过关闪光：整盘泛白一下，再压一块暗色牌子写结果。
      if (clearTimer > 0) {
        const t = clamp(clearTimer / CLEAR_FLASH_MS, 0, 1);
        c.globalAlpha = ctx.reducedMotion ? 0.16 : 0.55 * t;
        c.fillStyle = P.white;
        c.fillRect(0, 0, VIEW_W, VIEW_H);
        c.globalAlpha = 1;

        if (t > 0.3) {
          // 牌子宽度跟着文字走；太长就退成短标，保证不超出 168 逻辑像素。
          let label = level < LEVELS ? `LEVEL ${level} CLEAR` : "ALL CLEAR";
          if (measurePixelText(label, 2) > VIEW_W - 16) {
            label = level < LEVELS ? `LEVEL ${level}` : "CLEAR";
          }
          const width = measurePixelText(label, 2);
          const plateW = width + 12;
          const plateX = Math.round((VIEW_W - plateW) / 2);
          rect(c, plateX, 74, plateW, 24, P.void);
          strokeRect(c, plateX, 74, plateW, 24, P.gold);
          drawPixelText(
            c,
            label,
            Math.round((VIEW_W - width) / 2),
            82,
            2,
            level < LEVELS ? P.cream : P.gold,
            null,
          );
        }
      }
    };

    /* ---------------- 流程 ---------------- */

    /** 发第 level 关的盘面，并清空本关步数。 */
    const dealLevel = (next: number): void => {
      level = next;
      levelMoves = 0;
      board = scramble(level).board;
      cursor = START_CURSOR;
      hoverIndex = -1;
      clearTimer = 0;
      syncHud();
    };

    const reset = (): void => {
      mode = "ready";
      ended = false;
      totalMoves = 0;
      levelMoves = 0;
      usingKeys = false;
      clock = 0;
      dealLevel(1);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；low 模式的最高分由壳层写入。 */
    const finish = (): void => {
      if (ended) return;
      ended = true;
      mode = "over";
      clearTimer = 0;
      hoverIndex = -1;
      ctx.timer.hide();
      ctx.hud.urgent(false);
      ctx.audio.win();
      render();
      ctx.end({
        score: totalMoves,
        title: "全部熄灭",
        kicker: "CLEAR",
        stats: [
          { label: "通关关数", value: `${LEVELS}/${LEVELS}` },
          { label: "平均每关", value: `${Math.round((totalMoves / LEVELS) * 10) / 10} 步` },
        ],
      });
    };

    /** 过关：定格、闪光，700ms 后进下一关或结算。 */
    const clearLevel = (): void => {
      const spent = levelMoves;
      totalMoves += levelMoves;
      levelMoves = 0;
      clearTimer = CLEAR_FLASH_MS;
      hoverIndex = -1;
      ctx.hud.set("moves", clampHud(totalMoves, 3));
      ctx.hud.set("left", 0);
      ctx.hud.flash("moves", "is-bump");
      ctx.audio.win();
      ctx.announce(level < LEVELS ? `第 ${level} 关完成` : "五关全部完成");
      if (level < LEVELS) {
        ctx.toast.show(`第 ${level} 关 ${spent} 步`, { duration: 900 });
      }
    };

    const pressLamp = (index: number): void => {
      if (mode !== "playing" || ended || ctx.isPaused()) return;
      if (clearTimer > 0) return;
      if (index < 0 || index >= CELLS) return;

      toggle(board, index);
      levelMoves += 1;
      cursor = index;
      syncHud(true);

      if (isSolved(board)) {
        clearLevel();
        return;
      }
      ctx.audio.blip();
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || clearTimer > 0) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      const index = cellAt(info.x, info.y);
      if (index < 0) return;
      usingKeys = false;
      // 触屏没有「悬停」，不记住位置，免得手指离开后还留着括线。
      if ((info.source.pointerType || "mouse") !== "touch") hoverIndex = index;
      pressLamp(index);
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing") return;
      const type = info.source.pointerType || "mouse";
      if (type === "touch") return;
      hoverIndex = cellAt(info.x, info.y);
    });

    ctx.input.pointer.on("leave", () => {
      hoverIndex = -1;
    });

    ctx.input.pointer.on("cancel", () => {
      hoverIndex = -1;
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;

      if (action === "left" || action === "right" || action === "up" || action === "down") {
        usingKeys = true;
        hoverIndex = -1;
        cursor = cursorStep(cursor, action, SIZE);
        return;
      }

      if (action === "action" || action === "primary") {
        usingKeys = true;
        hoverIndex = -1;
        pressLamp(cursor);
      }
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        reset();
        mode = "playing";
        ctx.announce("关掉全部灯，五关总步数越少越好。");
      },

      update(dt: number): void {
        if (mode !== "playing" || ended) return;
        clock += dt / 1000;

        if (clearTimer <= 0) return;
        clearTimer -= dt;
        if (clearTimer > 0) return;

        clearTimer = 0;
        if (level >= LEVELS) {
          finish();
          return;
        }
        dealLevel(level + 1);
        ctx.audio.go();
      },

      render,

      pause(): void {
        hoverIndex = -1;
      },

      resume(): void {
        hoverIndex = -1;
      },

      destroy(): void {
        ended = true;
      },
    };
  },
});

export default game;
