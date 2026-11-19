import {
  P,
  clamp,
  defineGame,
  drawPixelText,
  mulberry32,
  rect,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  drawDoor,
  drawFloor,
  drawFogEdge,
  drawKey,
  drawMark,
  drawPlayer,
  drawWall,
} from "./art";
import { meta } from "./meta";
import {
  CELL,
  COLS,
  EXIT_INDEX,
  KEYS,
  ORIGIN,
  ROWS,
  START_INDEX,
  cellCenter,
  cellToIndex,
  dirFromAction,
  exploredPercent,
  generateMaze,
  indexToCell,
  isWall,
  placeKeys,
  visibleCells,
  walkableIndices,
  type Dir,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 一格走完的时长（毫秒）：按住方向键就每 180ms 走一格。 */
const STEP_MS = 180;

type Mode = "ready" | "playing" | "over";

interface Walk {
  from: number;
  to: number;
  /** 已经走了多少毫秒。 */
  acc: number;
}

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let mode: Mode = "ready";
    let maze: Uint8Array = generateMaze(COLS, ROWS, mulberry32(1));
    let keys: number[] = [];
    let found = 0;
    let explored = new Set<number>();
    let marks = new Set<number>();
    let pos = START_INDEX;
    let walk: Walk | null = null;
    let facing: Dir = "down";
    let elapsed = 0;
    let lastSec = -1;
    let clock = 0;
    let exitActive = false;

    /* ---------------- HUD ---------------- */

    const syncSeen = (): void => {
      const percent = exploredPercent(explored, walkableIndices(maze).length);
      ctx.hud.set("seen", clamp(percent, 0, 100));
    };

    const syncKeys = (): void => {
      ctx.hud.set("keys", `${found}/${KEYS}`);
    };

    const syncTime = (force = false): void => {
      const seconds = Math.ceil(elapsed / 1000);
      if (!force && seconds === lastSec) return;
      lastSec = seconds;
      ctx.hud.set("time", elapsed);
    };

    /* ---------------- 迷雾 ---------------- */

    /** 当前可见集合：站着不动只有脚下，移动中取起点与终点的并集。 */
    const currentVisible = (): Set<number> => {
      const from = indexToCell(walk ? walk.from : pos);
      const seen = new Set<number>(visibleCells(maze, from));
      if (walk) {
        const to = indexToCell(walk.to);
        for (const index of visibleCells(maze, to)) seen.add(index);
      }
      return seen;
    };

    const markExplored = (): void => {
      for (const index of currentVisible()) explored.add(index);
      syncSeen();
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const rng = mulberry32(seed);
      maze = generateMaze(COLS, ROWS, rng);
      keys = placeKeys(maze, rng, KEYS);
      found = 0;
      explored = new Set<number>();
      marks = new Set<number>();
      pos = START_INDEX;
      walk = null;
      facing = "down";
      elapsed = 0;
      lastSec = -1;
      clock = 0;
      exitActive = false;

      ctx.hud.urgent(false);
      ctx.timer.hide();
      syncKeys();
      syncTime(true);
      markExplored();
    };

    /** 结算只走这里一次；最高分由壳层按 low 模式写入。 */
    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";
      walk = null;

      const seconds = Math.max(1, Math.ceil(elapsed / 1000));
      ctx.timer.hide();
      ctx.hud.urgent(false);
      ctx.audio.win();
      render();

      ctx.end({
        score: seconds,
        title: "走出迷宫",
        kicker: "CLEAR",
        stats: [
          { label: "找到钥匙", value: `${found}/${KEYS}` },
          { label: "已探索", value: `${exploredPercent(explored, walkableIndices(maze).length)}%` },
        ],
      });
    };

    const collectAt = (index: number): void => {
      const at = keys.indexOf(index);
      if (at < 0) return;
      keys.splice(at, 1);
      found += 1;
      syncKeys();
      ctx.hud.flash("keys", "is-bump");
      ctx.audio.coin();
      if (found >= KEYS) {
        exitActive = true;
        ctx.audio.tier();
        ctx.toast.show("出口亮了！");
        ctx.announce("三把钥匙找齐，出口已经亮起。");
      } else {
        ctx.toast.show(`找到钥匙 ${found}/${KEYS}`);
      }
    };

    /** 起步走向 dir；撞墙或已经在走就返回 false。 */
    const step = (dir: Dir): boolean => {
      if (mode !== "playing" || ctx.isPaused() || walk) return false;
      const { col, row } = indexToCell(pos);
      const dc = dir === "left" ? -1 : dir === "right" ? 1 : 0;
      const dr = dir === "up" ? -1 : dir === "down" ? 1 : 0;
      if (isWall(maze, col + dc, row + dr)) {
        facing = dir;
        return false;
      }
      facing = dir;
      walk = { from: pos, to: cellToIndex(col + dc, row + dr), acc: 0 };
      markExplored();
      return true;
    };

    /** 走完一格：判定钥匙 / 出口，并把新视野并入已探索。 */
    const arrive = (): void => {
      if (!walk) return;
      const target = walk.to;
      walk = null;
      pos = target;
      markExplored();
      collectAt(pos);
      if (pos === EXIT_INDEX && exitActive) finish();
    };

    const markHere = (): void => {
      if (mode !== "playing" || ctx.isPaused()) return;
      if (marks.has(pos)) {
        marks.delete(pos);
        ctx.audio.blip();
      } else {
        marks.add(pos);
        ctx.audio.pop();
      }
    };

    /* ---------------- 绘制 ---------------- */

    const cellX = (col: number): number => ORIGIN.x + col * CELL;
    const cellY = (row: number): number => ORIGIN.y + row * CELL;

    const render = (): void => {
      const c = ctx.ctx;
      rect(c, 0, 0, W, H, P.void);

      // 机台边框
      strokeRect(c, ORIGIN.x - 2, ORIGIN.y - 2, COLS * CELL + 4, ROWS * CELL + 4, P.line);

      const visible = currentVisible();

      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const index = cellToIndex(col, row);
          const x = cellX(col);
          const y = cellY(row);
          const lit = visible.has(index);
          const known = explored.has(index);

          if (!lit && !known) {
            rect(c, x, y, CELL, CELL, P.void);
            continue;
          }

          if (isWall(maze, col, row)) {
            drawWall(c, x, y, CELL);
            if (!lit) {
              c.save();
              c.globalAlpha = 0.45;
              rect(c, x, y, CELL, CELL, P.void);
              c.restore();
            }
            continue;
          }

          drawFloor(c, x, y, CELL, true);
          if (!lit) {
            c.save();
            c.globalAlpha = 0.5;
            rect(c, x, y, CELL, CELL, P.void);
            c.restore();
          }
          if (!lit) drawFogEdge(c, x, y, CELL);
        }
      }

      // 钥匙：探索过就一直记着位置
      for (const index of keys) {
        if (!explored.has(index) && !visible.has(index)) continue;
        const { x, y } = cellCenter(index);
        drawKey(c, x, y, clock / 1000, 3);
      }

      // 出口
      if (explored.has(EXIT_INDEX) || visible.has(EXIT_INDEX)) {
        const { col, row } = indexToCell(EXIT_INDEX);
        drawDoor(c, cellX(col), cellY(row), exitActive, clock / 1000, CELL);
      }

      // 标记
      for (const index of marks) {
        if (!explored.has(index)) continue;
        const { x, y } = cellCenter(index);
        drawMark(c, x, y);
      }

      // 玩家：格点之间按 180ms 插值
      const fromCell = indexToCell(walk ? walk.from : pos);
      const toCell = indexToCell(walk ? walk.to : pos);
      const t = walk ? clamp(walk.acc / STEP_MS, 0, 1) : 0;
      const ax = cellX(fromCell.col) + (cellX(toCell.col) - cellX(fromCell.col)) * t;
      const ay = cellY(fromCell.row) + (cellY(toCell.row) - cellY(fromCell.row)) * t;
      drawPlayer(
        c,
        ax + Math.floor(CELL / 2),
        ay + Math.floor(CELL / 2),
        facing,
        clock / 1000,
      );

      // 顶部提示
      const hint = exitActive ? "EXIT OPEN" : `KEYS ${found}/${KEYS}`;
      const width = hint.length * 6 - 1;
      rect(c, Math.round((W - width) / 2) - 3, 1, width + 6, 9, P.night);
      drawPixelText(c, hint, Math.round((W - width) / 2), 2, 1, exitActive ? P.mint : P.cream);
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ctx.isPaused()) return;
      const dir = dirFromAction(action);
      if (dir) {
        step(dir);
        return;
      }
      if (action === "primary" || action === "secondary" || action === "action") markHere();
    });

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ctx.isPaused() || walk) return;

      const col = Math.floor((info.x - ORIGIN.x) / CELL);
      const row = Math.floor((info.y - ORIGIN.y) / CELL);
      const here = indexToCell(pos);
      const dc = col - here.col;
      const dr = row - here.row;
      if (Math.abs(dc) + Math.abs(dr) !== 1) return;
      step(dirFromDelta(dc, dr));
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        ctx.audio.go();
        ctx.announce("迷宫开始，视野只有三格，找齐三把钥匙再找出口。");
      },

      update(dt: number): void {
        clock += dt;
        if (mode !== "playing" || ctx.isPaused()) return;

        elapsed += dt;
        syncTime();

        if (walk) {
          walk.acc += dt;
          if (walk.acc >= STEP_MS) arrive();
          return;
        }

        // 按住方向键连续走：每格 180ms
        for (const dir of ["up", "down", "left", "right"] as Dir[]) {
          if (!ctx.input.keys.isDown(dir)) continue;
          step(dir);
          break;
        }
      },

      render,

      pause(): void {
        /* 按住的方向键在恢复后会继续生效，这里不动 walk，保持插值连续 */
      },

      destroy(): void {
        walk = null;
      },
    };
  },
});

/** 相邻位移 → 方向名；非相邻返回 "down"（调用方已判过距离）。 */
function dirFromDelta(dc: number, dr: number): Dir {
  if (dc < 0) return "left";
  if (dc > 0) return "right";
  return dr < 0 ? "up" : "down";
}

export default game;
