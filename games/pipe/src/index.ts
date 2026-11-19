import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  measurePixelText,
  rect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  drawCorners,
  drawInlet,
  drawLeak,
  drawOutlet,
  drawPipe,
  drawSlot,
} from "./art";
import { meta } from "./meta";
import {
  CELL,
  CELLS,
  COLS,
  DOWN,
  END_INDEX,
  LEFT,
  MAX_MOVES,
  ORIGIN,
  RIGHT,
  ROWS,
  START_INDEX,
  UP,
  filledPercent,
  flowFrom,
  generateLevel,
  leakCells,
  rotate,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;
/** 棋盘实际尺寸：7×20 = 140，9×20 = 180。 */
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;

type Mode = "ready" | "playing" | "over";

/** 逻辑坐标 → 格子序号；落在棋盘外返回 -1。 */
const cellAt = (x: number, y: number): number => {
  const col = Math.floor((x - ORIGIN.x) / CELL);
  const row = Math.floor((y - ORIGIN.y) / CELL);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
  return row * COLS + col;
};

/** 格子序号 → 左上角像素坐标。 */
const cellX = (index: number): number => ORIGIN.x + (index % COLS) * CELL;
const cellY = (index: number): number => ORIGIN.y + Math.floor(index / COLS) * CELL;

const game = defineGame({
  meta,

  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";

    /** 当前盘面（每格 4 位方向掩码）。 */
    let grid: number[] = [];
    /** 白盒解：每格还要顺时针转几次才朝向正确。 */
    let solution: number[] = [];
    /** 本局每格已经转了几次（顺时针，可能超过 4）。 */
    let turns: number[] = [];

    let moves = 0;
    let filled: number[] = [];
    let leaks = 0;

    let cursor = START_INDEX;
    let usingKeys = false;
    let hoverIndex = -1;
    /** 提示高亮的格子；-1 表示没有。 */
    let hintIndex = -1;
    /** 漏水后定格在哪个格，结算前标红。 */
    let leakAt = -1;
    /** 秒表（秒），只喂给呼吸 / 水流动画。 */
    let clock = 0;
    /** 本局随机种子；`logic.ts` 自己不碰 Math.random。 */
    let seed = 0x2f6e2b1;
    /** 已经重开过几局，用来变化种子。 */
    let round = 0;

    /** 可复现随机源（LCG）。 */
    const nextRandom = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("moves", clamp(moves, 0, 999));
      ctx.hud.set("fill", clamp(filledPercent(filled, CELLS), 0, 100));
      ctx.hud.set("leaks", clamp(leaks, 0, 9));
    };

    /* ---------------- 流程 ---------------- */

    /**
     * 重算注水结果：漏水 > 0 立即失败，注满全盘则通关。
     * 返回 true 表示已经结算（调用方应停止后续处理）。
     */
    const settle = (): boolean => {
      filled = flowFrom(START_INDEX, grid);
      const wet = leakCells(grid, filled);
      leaks = wet.length;
      leakAt = wet.length > 0 ? (wet[0] as number) : -1;
      syncHud();
      if (leaks > 0) {
        finish(false);
        return true;
      }
      if (filled.length === CELLS) {
        finish(true);
        return true;
      }
      return false;
    };

    const reset = (): void => {
      mode = "ready";
      // 每局换一条随机序列；同一个种子仍然得到同一关（单测钉死这一点）。
      round += 1;
      seed = (0x2f6e2b1 + round * 2654435761) >>> 0;
      const level = generateLevel(COLS, ROWS, nextRandom);
      grid = level.grid;
      solution = level.solution;
      turns = new Array(CELLS).fill(0);
      moves = 0;
      filled = flowFrom(START_INDEX, grid);
      leaks = leakCells(grid, filled).length;
      leakAt = -1;
      cursor = START_INDEX;
      usingKeys = false;
      hoverIndex = -1;
      hintIndex = -1;
      clock = 0;
      syncHud();
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；最高分由壳层按 low 模式写入。 */
    const finish = (cleared: boolean): void => {
      if (mode === "over") return;
      mode = "over";
      hoverIndex = -1;
      hintIndex = -1;
      ctx.timer.hide();
      ctx.hud.urgent(false);

      if (cleared) ctx.audio.win();
      else ctx.audio.lose();

      // 结算层背后的盘面要停在同一帧。
      render();

      ctx.end({
        score: Math.max(1, moves),
        title: cleared ? "水路接通" : leaks > 0 ? "水漏出去了" : "步数用完了",
        kicker: cleared ? "FLOW" : leaks > 0 ? "LEAK" : "OUT",
        stats: [
          { label: "本局步数", value: `${moves} 步` },
          { label: "注水进度", value: `${filledPercent(filled, CELLS)}%` },
        ],
      });
    };

    /** 把某格顺时针转一格；这是唯一产生步数的操作。 */
    const turnCell = (index: number): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (index < 0 || index >= CELLS) return;
      if (moves >= MAX_MOVES) return;

      grid[index] = rotate(grid[index] ?? 0);
      turns[index] = (turns[index] ?? 0) + 1;
      moves += 1;
      hintIndex = -1;
      ctx.audio.blip();

      if (settle()) return;
      ctx.hud.flash("moves", "is-bump");
      if (moves >= MAX_MOVES) finish(false);
    };

    /** 提示：指出一个还需要转的格子，不消耗步数。 */
    const showHint = (): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      for (let index = 0; index < CELLS; index += 1) {
        const need = ((solution[index] ?? 0) - (turns[index] ?? 0) + 4) % 4;
        if (need === 0) continue;
        hintIndex = index;
        cursor = index;
        usingKeys = true;
        hoverIndex = -1;
        ctx.audio.tick(2);
        ctx.toast.show(`这一格还要转 ${need} 步`, { duration: 900 });
        return;
      }
      ctx.toast.show("水路已经接通了", { duration: 800 });
    };

    /* ---------------- 绘制 ---------------- */

    const render = (): void => {
      const c = ctx.ctx;
      rect(c, 0, 0, W, H, P.night);
      rect(c, 0, 0, W, 1, P.line);

      // 棋盘外框 + 每格暗底
      rect(c, ORIGIN.x - 2, ORIGIN.y - 2, BOARD_W + 4, BOARD_H + 4, P.void);
      for (let index = 0; index < CELLS; index += 1) {
        drawSlot(c, cellX(index), cellY(index), CELL);
      }

      // 水源 / 出口
      const tail = ORIGIN.y + (ROWS - 1) * CELL + Math.floor(CELL / 2);
      drawInlet(c, ORIGIN.x - 8, ORIGIN.y + Math.floor(CELL / 2), clock);
      drawOutlet(c, ORIGIN.x + BOARD_W, tail, filled.length === CELLS);

      // 管道本体：通水的段亮一档
      const wet = new Set(filled);
      for (let index = 0; index < CELLS; index += 1) {
        drawPipe(c, cellX(index), cellY(index), CELL, grid[index] ?? 0, wet.has(index));
      }

      // 终点提示：没通水时给一点微光，让目标位置可见
      if (filled.length < CELLS) {
        const pulse = (Math.sin(clock * 3) + 1) / 2;
        drawCorners(c, cellX(END_INDEX), cellY(END_INDEX), CELL, pulse > 0.5 ? P.gold : P.amber);
      }

      // 漏水：喷出去的水花 + 该格红框
      if (leakAt >= 0) {
        const mask = grid[leakAt] ?? 0;
        const dir =
          (mask & UP) !== 0 ? UP : (mask & DOWN) !== 0 ? DOWN : (mask & LEFT) !== 0 ? LEFT : RIGHT;
        const inside = leakAt === START_INDEX || leakAt === END_INDEX;
        if (!inside) {
          drawLeak(
            c,
            cellX(leakAt) + Math.floor(CELL / 2),
            cellY(leakAt) + Math.floor(CELL / 2),
            dir,
            clock,
          );
        }
        drawCorners(c, cellX(leakAt), cellY(leakAt), CELL, P.red);
      }

      // 提示高亮
      if (hintIndex >= 0) {
        drawCorners(c, cellX(hintIndex), cellY(hintIndex), CELL, P.gold, 1, 7);
        if (Math.sin(clock * 8) > 0) {
          rect(c, cellX(hintIndex) + 2, cellY(hintIndex) + 2, CELL - 4, 2, P.gold);
        }
      }

      if (mode === "over") return;

      // 光标：键盘 / 触屏两套观感
      if (usingKeys) {
        drawCorners(c, cellX(cursor), cellY(cursor), CELL, P.cream);
      } else if (hoverIndex >= 0) {
        drawCorners(c, cellX(hoverIndex), cellY(hoverIndex), CELL, P.lav);
      }

      // 剩余步数警戒
      if (mode === "playing" && moves >= MAX_MOVES - 10) {
        const label = String(Math.max(0, MAX_MOVES - moves));
        const width = measurePixelText(label, 1);
        drawPixelText(c, label, Math.round((W - width) / 2), H - 8, 1, P.red);
      }
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused()) return;

      const index = cellAt(info.x, info.y);
      if (index < 0) return;

      // 触屏 / 鼠标：点哪转哪，一次点击 = 一格（唯一的触屏通路）。
      usingKeys = false;
      hoverIndex = index;
      cursor = index;
      turnCell(index);
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing") return;
      const type = info.source.pointerType || "mouse";
      hoverIndex = type === "touch" ? -1 : cellAt(info.x, info.y);
    });

    ctx.input.pointer.on("leave", () => {
      hoverIndex = -1;
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;

      if (action === "left" || action === "right" || action === "up" || action === "down") {
        usingKeys = true;
        hoverIndex = -1;
        const col = cursor % COLS;
        const row = Math.floor(cursor / COLS);
        const nextCol = clamp(
          col + (action === "right" ? 1 : action === "left" ? -1 : 0),
          0,
          COLS - 1,
        );
        const nextRow = clamp(row + (action === "down" ? 1 : action === "up" ? -1 : 0), 0, ROWS - 1);
        cursor = nextRow * COLS + nextCol;
        return;
      }

      if (action === "action" || action === "primary") {
        usingKeys = true;
        hoverIndex = -1;
        turnCell(cursor);
        return;
      }

      if (action === "secondary") {
        usingKeys = true;
        showHint();
      }
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        ctx.timer.hide();
        ctx.audio.go();
        ctx.announce("接水管开始，把水从左上角送到右下角。");
      },

      update(dt: number): void {
        if (mode === "ready") return;
        // dt 是毫秒：只用于动画相位，先换算成秒。
        clock += dt / 1000;
      },

      render,

      pause(): void {
        hoverIndex = -1;
      },

      destroy(): void {
        hoverIndex = -1;
        hintIndex = -1;
      },
    };
  },
});

export default game;
