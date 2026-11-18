import {
  P,
  bevel,
  clamp,
  defineGame,
  easeOutCubic,
  lerp,
  rect,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import { drawTile } from "./art";
import { meta } from "./meta";
import {
  SIZE,
  canMove,
  cloneGrid,
  emptyGrid,
  maxTile,
  slide,
  spawnTile,
  type Direction,
  type Grid,
  type Merge,
  type Slide,
  type Spawn,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/* 4×4 棋盘：37 的格 + 3 的缝，居中后左右各留 5–6 像素边。 */
const CELL = 37;
const GAP = 3;
const BOARD = SIZE * CELL + (SIZE - 1) * GAP;
const ORIGIN_X = Math.floor((W - BOARD) / 2);
const ORIGIN_Y = Math.floor((H - BOARD) / 2);

/** 位移动画时长；合并/生成的新块再弹一下。 */
const MOVE_MS = 120;
const POP_MS = 110;

interface MoveAnim {
  born: number;
  slides: Slide[];
  merges: Merge[];
  spawn: Spawn | null;
}

interface Pop {
  row: number;
  col: number;
  born: number;
}

interface Snapshot {
  grid: Grid;
  score: number;
  moves: number;
}

type Mode = "ready" | "playing" | "over";

const cellX = (col: number): number => ORIGIN_X + col * (CELL + GAP);
const cellY = (row: number): number => ORIGIN_Y + row * (CELL + GAP);

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let grid: Grid = emptyGrid();
    let score = 0;
    let moves = 0;
    let mode: Mode = "ready";
    let clock = 0;
    let lastBest = 0;

    let anim: MoveAnim | null = null;
    let pops: Pop[] = [];
    /** 只保留一步快照，撤销后清空。 */
    let history: Snapshot | null = null;

    /* ---------------- HUD ---------------- */

    const syncHud = (bump: boolean): void => {
      const best = maxTile(grid);
      ctx.hud.set("score", score);
      ctx.hud.set("moves", moves);
      ctx.hud.set("bestTile", best);
      if (bump) ctx.hud.flash("score", "is-bump");
      if (best > lastBest) ctx.hud.flash("bestTile", "is-bump");
      lastBest = best;
    };

    /* ---------------- 流程 ---------------- */

    const reset = (): void => {
      grid = emptyGrid();
      grid = spawnTile(grid).grid;
      grid = spawnTile(grid).grid;
      score = 0;
      moves = 0;
      clock = 0;
      anim = null;
      pops = [];
      history = null;
      lastBest = maxTile(grid);
      mode = "ready";
      syncHud(false);
    };

    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";
      anim = null;
      pops = [];
      ctx.audio.lose();
      ctx.end({
        score,
        title: "没有空格了",
        kicker: "GAME OVER",
        stats: [
          { label: "最大方块", value: maxTile(grid) },
          { label: "步数", value: moves },
        ],
      });
    };

    /** 落子：纯函数算出新棋盘，再更新 HUD / 动画 / 结算判定。 */
    const applyMove = (direction: Direction): void => {
      if (mode !== "playing" || ctx.isPaused()) return;

      const result = slide(grid, direction);
      if (!result.moved) return;

      // 上一段动画直接收尾，逻辑永远以棋盘数据为准。
      anim = null;
      pops = [];

      history = { grid: cloneGrid(grid), score, moves };
      grid = result.grid;
      score += result.gained;
      moves += 1;

      const spawned = spawnTile(grid);
      grid = spawned.grid;

      anim = {
        born: clock,
        slides: result.slides,
        merges: result.merges,
        spawn: spawned.spawn,
      };
      if (ctx.reducedMotion) anim = null;

      syncHud(result.gained > 0);
      ctx.audio.slide();
      if (result.merges.length > 0) ctx.audio.pop();

      // 生成新块之后再判断，确保「棋盘满且无法合并」才结束。
      if (!canMove(grid)) finish();
    };

    /** 一步撤销：恢复上一步的棋盘与分数，之后不再生成新块。 */
    const undo = (): void => {
      if (mode !== "playing" || ctx.isPaused() || !history) return;

      grid = history.grid;
      score = history.score;
      moves = history.moves;
      history = null;
      anim = null;
      pops = [];
      syncHud(false);
      ctx.audio.ui();
      ctx.toast.show("已撤销上一步", { duration: 700 });
    };

    /* ---------------- 绘制 ---------------- */

    const drawBoardBase = (): void => {
      const c = ctx.ctx;
      rect(c, 0, 0, W, H, P.night);
      rect(c, 2, 2, W - 4, H - 4, P.panel);
      strokeRect(c, 2, 2, W - 4, H - 4, P.line);

      // 四角小铆钉，让底板像一块街机面板。
      rect(c, 3, 3, 2, 2, P.lineHi);
      rect(c, W - 5, 3, 2, 2, P.lineHi);
      rect(c, 3, H - 5, 2, 2, P.lineHi);
      rect(c, W - 5, H - 5, 2, 2, P.lineHi);

      for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
          const x = cellX(col);
          const y = cellY(row);
          rect(c, x, y, CELL, CELL, P.night);
          bevel(c, x, y, CELL, CELL, P.line, P.void);
        }
      }
    };

    const drawGrid = (): void => {
      for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
          const value = grid[row]?.[col] ?? 0;
          if (value === 0) continue;

          let grow = 0;
          for (const pop of pops) {
            if (pop.row !== row || pop.col !== col) continue;
            const age = clock - pop.born;
            if (age < 45) grow = 2;
            else if (age < 90) grow = 1;
          }

          drawTile(ctx.ctx, cellX(col), cellY(row), CELL, value, { grow });
        }
      }
    };

    const drawMoveAnim = (): void => {
      if (!anim) return;
      const t = clamp((clock - anim.born) / MOVE_MS, 0, 1);
      const k = easeOutCubic(t);

      for (const slide of anim.slides) {
        const x = lerp(cellX(slide.fromCol), cellX(slide.toCol), k);
        const y = lerp(cellY(slide.fromRow), cellY(slide.toRow), k);
        drawTile(ctx.ctx, x, y, CELL, slide.value);
      }
    };

    const render = (): void => {
      drawBoardBase();
      if (anim) drawMoveAnim();
      else drawGrid();
    };

    /* ---------------- 输入 ---------------- */

    ctx.input.swipe.onSwipe(({ direction }) => applyMove(direction));

    ctx.input.keys.onPress((action) => {
      if (action === "left" || action === "right" || action === "up" || action === "down") {
        applyMove(action);
      } else if (action === "secondary") {
        undo();
      }
    });

    ctx.timer.hide();
    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        reset();
        mode = "playing";
        ctx.hud.urgent(false);
        ctx.timer.hide();
        syncHud(false);
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;

        if (anim && clock - anim.born >= MOVE_MS) {
          const finished = anim;
          anim = null;

          if (!ctx.reducedMotion) {
            for (const merge of finished.merges) {
              pops.push({ row: merge.row, col: merge.col, born: clock });
            }
            if (finished.spawn) {
              pops.push({ row: finished.spawn.row, col: finished.spawn.col, born: clock });
            }
          }
        }

        if (pops.length > 0) {
          pops = pops.filter((pop) => clock - pop.born < POP_MS);
        }
      },

      render,

      pause(): void {
        // 逻辑已经落定，暂停只是停住动画时钟；回来继续播。
      },
    };
  },
});

export default game;
