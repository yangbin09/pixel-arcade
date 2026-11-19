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
  drawBox,
  drawBump,
  drawCorners,
  drawFloor,
  drawGoal,
  drawLevelPips,
  drawPlayer,
  drawUndoButton,
  drawWall,
  insideUndoButton,
  paintBackdrop,
  type Facing,
} from "./art";
import { meta } from "./meta";
import {
  CELLS,
  LEVELS,
  LEVEL_COUNT,
  SIZE,
  boxesOnGoals,
  canUndo,
  createState,
  dirFromAction,
  move,
  undo,
  type Dir,
  type SokobanState,
} from "./logic";

type Mode = "ready" | "playing" | "over";

/** 过关闪光时长：闪完才进下一关。 */
const CLEAR_FLASH_MS = 620;
/** 按住方向键的首次延迟与连发间隔。 */
const REPEAT_DELAY_MS = 260;
const REPEAT_RATE_MS = 120;
/** 点击判定：位移小于这个值才算「点一下」。 */
const TAP_SLOP = 10;
/** 撤销后的高亮时长。 */
const UNDO_FLASH_MS = 220;
/** 撞墙箭头的显示时长。 */
const BUMP_MS = 160;

/** HUD 数字按栏位宽度夹住，避免 4 位数把布局撑开。 */
const clampHud = (value: number, digits: number): number =>
  clamp(Math.round(value), 0, Math.pow(10, digits) - 1);

const opposite: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let level = 0;
    let state: SokobanState = createState(LEVELS[0] ?? []);
    let mode: Mode = "ready";
    /** 已过关卡的步数之和；加上本关 state.moves 就是 HUD 与最终成绩。 */
    let clearedMoves = 0;
    let clock = 0;
    let clearTimer = 0;
    let bumpTimer = 0;
    let undoFlash = 0;
    let undoFlashCell = -1;
    let facing: Facing = "down";
    let hoverIndex = -1;
    let holdAction: string | null = null;
    let holdTimer = 0;
    /** 上一步是否推动了箱子；按住方向键时用它决定要不要继续连发。 */
    let lastPushed = false;
    let press: { x: number; y: number } | null = null;
    let ended = false;

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("moves", clampHud(clearedMoves + state.moves, 3));
      ctx.hud.set("boxes", clampHud(boxesOnGoals(state), 2));
      ctx.hud.set("level", clampHud(level + 1, 2));
    };

    /* ---------------- 流程 ---------------- */

    /** 发某一关的盘面。 */
    const dealLevel = (next: number): void => {
      level = next;
      state = createState(LEVELS[next] ?? []);
      facing = "down";
      clearTimer = 0;
      bumpTimer = 0;
      undoFlash = 0;
      undoFlashCell = -1;
      hoverIndex = -1;
      holdAction = null;
      syncHud();
    };

    const reset = (): void => {
      mode = "ready";
      ended = false;
      clearedMoves = 0;
      clock = 0;
      press = null;
      dealLevel(0);
      ctx.hud.urgent(false);
      ctx.timer.hide();
    };

    /** 结算只走这里一次；low 模式的最高分由壳层写入。 */
    const finish = (): void => {
      if (ended) return;
      ended = true;
      mode = "over";
      clearTimer = 0;
      holdAction = null;
      press = null;
      ctx.timer.hide();
      ctx.hud.urgent(false);
      syncHud();
      ctx.audio.win();
      render();
      ctx.end({
        score: clearedMoves,
        title: "六关全清",
        kicker: "CLEAR",
        stats: [
          { label: "通关关数", value: `${LEVEL_COUNT}/${LEVEL_COUNT}` },
          { label: "每关平均", value: `${Math.round((clearedMoves / LEVEL_COUNT) * 10) / 10} 步` },
        ],
      });
    };

    /** 过关：步数入账、定格闪光，闪光结束后进下一关或结算。 */
    const clearLevel = (): void => {
      const spent = state.moves;
      clearedMoves += spent;
      // 本关步数已经入账，清零避免 HUD 重复累加；闪光期间输入本来就锁住了。
      state = { ...state, moves: 0 };
      clearTimer = CLEAR_FLASH_MS;
      holdAction = null;
      hoverIndex = -1;
      syncHud();
      ctx.hud.flash("moves", "is-bump");
      ctx.hud.flash("boxes", "is-bump");
      ctx.audio.win();
      ctx.announce(level < LEVEL_COUNT - 1 ? `第 ${level + 1} 关完成` : "六关全部完成");
      if (level < LEVEL_COUNT - 1) {
        ctx.toast.show(`第 ${level + 1} 关 ${spent} 步`, { duration: 900 });
      }
    };

    /** 真正走一步；返回是否移动成功。 */
    const step = (dir: Dir): boolean => {
      if (mode !== "playing" || ended || ctx.isPaused()) return false;
      if (clearTimer > 0) return false;

      const before = boxesOnGoals(state);
      const result = move(state, dir);
      facing = dir;

      if (!result.moved) {
        lastPushed = false;
        bumpTimer = BUMP_MS;
        ctx.audio.error();
        return false;
      }

      lastPushed = result.pushed;
      state = result.state;
      syncHud();

      const after = boxesOnGoals(state);
      if (after > before) {
        ctx.hud.flash("boxes", "is-bump");
        ctx.audio.coin();
      } else if (result.pushed) {
        ctx.audio.slide();
      } else {
        ctx.audio.blip();
      }

      if (result.win) clearLevel();
      return true;
    };

    const undoStep = (): void => {
      if (mode !== "playing" || ended || ctx.isPaused()) return;
      if (clearTimer > 0) return;
      if (!canUndo(state)) {
        ctx.toast.show("没有可以撤销的步骤", { warn: true, duration: 700 });
        ctx.audio.error();
        return;
      }

      state = undo(state);
      facing = opposite[facing];
      holdAction = null;
      undoFlash = UNDO_FLASH_MS;
      // 高亮玩家回到的那一格；这一步如果推过箱子，箱子也一起回到原位。
      undoFlashCell = state.player;
      syncHud();
      ctx.audio.ui();
    };

    /* ---------------- 绘制 ---------------- */

    const renderCell = (c: CanvasRenderingContext2D, index: number): void => {
      const row = Math.floor(index / SIZE);
      const col = index % SIZE;
      const x = cellX(col);
      const y = cellY(row);

      if (state.walls[index]) {
        drawWall(c, x, y, CELL);
        return;
      }

      drawFloor(c, x, y, CELL, (row + col) % 2 === 0);
      const pulse = !ctx.reducedMotion && clock % 1.1 < 0.55;
      if (state.goals[index]) drawGoal(c, x, y, CELL, pulse);
      if (state.boxes[index]) drawBox(c, x, y, CELL, state.goals[index] === true, pulse);
    };

    const render = (): void => {
      const c = ctx.ctx;
      paintBackdrop(c);
      drawLevelPips(c, level, LEVEL_COUNT, clock);

      for (let index = 0; index < CELLS; index += 1) renderCell(c, index);

      const bob = ctx.reducedMotion ? 0 : clock % 1.6 < 0.8 ? 0 : 1;
      const px = cellX(state.player % SIZE);
      const py = cellY(Math.floor(state.player / SIZE));
      drawPlayer(c, px, py, CELL, facing, bob);

      if (bumpTimer > 0) drawBump(c, px, py, CELL, facing);

      if (undoFlash > 0 && undoFlashCell >= 0) {
        const ux = cellX(undoFlashCell % SIZE);
        const uy = cellY(Math.floor(undoFlashCell / SIZE));
        drawCorners(c, ux, uy, CELL, P.mint);
      }

      if (mode === "playing" && hoverIndex >= 0 && hoverIndex !== state.player) {
        const hx = cellX(hoverIndex % SIZE);
        const hy = cellY(Math.floor(hoverIndex / SIZE));
        drawCorners(c, hx, hy, CELL, P.lav);
      }

      // 手柄收起时，画布内给一个撤销键，保证纯触屏也能撤销。
      if (mode === "playing" && !ctx.padVisible()) {
        drawUndoButton(c, canUndo(state), !ctx.reducedMotion && clock % 0.9 < 0.45);
      }

      if (clearTimer > 0) {
        const t = clamp(clearTimer / CLEAR_FLASH_MS, 0, 1);
        c.globalAlpha = ctx.reducedMotion ? 0.16 : 0.55 * t;
        c.fillStyle = P.white;
        c.fillRect(0, 0, VIEW_W, VIEW_H);
        c.globalAlpha = 1;

        if (t > 0.3) {
          let label = level < LEVEL_COUNT - 1 ? `LEVEL ${level + 1} CLEAR` : "ALL CLEAR";
          let textSize = 2;
          if (measurePixelText(label, textSize) > VIEW_W - 24) {
            label = "CLEAR";
            textSize = 2;
          }
          const width = measurePixelText(label, textSize);
          const plateW = width + 12;
          const plateX = Math.round((VIEW_W - plateW) / 2);
          rect(c, plateX, 74, plateW, 24, P.void);
          strokeRect(c, plateX, 74, plateW, 24, P.gold);
          drawPixelText(
            c,
            label,
            Math.round((VIEW_W - width) / 2),
            82,
            textSize,
            level < LEVEL_COUNT - 1 ? P.cream : P.gold,
            null,
          );
        }
      }
    };

    /* ---------------- 输入 ---------------- */

    const canvasEl = ctx.input.pointer.el;
    const blockMenu = (event: Event): void => {
      event.preventDefault();
    };
    canvasEl.addEventListener("contextmenu", blockMenu);

    const tryPress = (dir: Dir): void => {
      lastPushed = false;
      holdAction = dir;
      holdTimer = REPEAT_DELAY_MS;
      if (!step(dir)) holdAction = null;
    };

    ctx.input.pointer.on("down", (info) => {
      ctx.audio.unlock();
      if (mode !== "playing" || ended || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      const type = info.source.pointerType || "mouse";
      const index = cellAt(info.x, info.y);
      if (type !== "touch") hoverIndex = index;

      if (!ctx.padVisible() && insideUndoButton(info.x, info.y)) {
        undoStep();
        return;
      }

      press = { x: info.x, y: info.y };
    });

    ctx.input.pointer.on("move", (info) => {
      if (mode !== "playing") return;
      const type = info.source.pointerType || "mouse";
      if (type === "touch") return;
      hoverIndex = cellAt(info.x, info.y);
    });

    ctx.input.pointer.on("up", (info) => {
      const held = press;
      press = null;
      if (!held || mode !== "playing" || ended || ctx.isPaused()) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      // 位移很小才算「点一下」：点相邻格就朝那边走一步。
      const dx = info.x - held.x;
      const dy = info.y - held.y;
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) return;

      const index = cellAt(info.x, info.y);
      if (index < 0 || index === state.player) return;

      const row = Math.floor(state.player / SIZE);
      const col = state.player % SIZE;
      const tr = Math.floor(index / SIZE);
      const tc = index % SIZE;
      if (Math.abs(tr - row) + Math.abs(tc - col) !== 1) return;

      const dir: Dir = tr < row ? "up" : tr > row ? "down" : tc < col ? "left" : "right";
      step(dir);
    });

    ctx.input.pointer.on("cancel", () => {
      press = null;
    });

    ctx.input.pointer.on("leave", (info) => {
      const type = info.source.pointerType || "mouse";
      if (type !== "touch") hoverIndex = -1;
      press = null;
    });

    ctx.input.swipe.onSwipe(({ direction }) => {
      if (mode !== "playing" || ended) return;
      step(direction);
    });

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || ended || ctx.isPaused()) return;

      const dir = dirFromAction(action);
      if (dir) {
        hoverIndex = -1;
        tryPress(dir);
        return;
      }

      if (action === "secondary" || action === "primary") {
        hoverIndex = -1;
        undoStep();
      }
    });

    ctx.input.keys.onRelease((action) => {
      const dir = dirFromAction(action);
      if (dir && holdAction === dir) holdAction = null;
    });

    reset();

    return {
      start(): void {
        ctx.audio.unlock();
        ctx.audio.ui();
        reset();
        mode = "playing";
        ctx.announce("推箱子开始，六关步数越少越好。");
      },

      update(dt: number): void {
        if (mode !== "playing" || ended) return;
        clock += dt / 1000;

        if (bumpTimer > 0) bumpTimer = Math.max(0, bumpTimer - dt);
        if (undoFlash > 0) undoFlash = Math.max(0, undoFlash - dt);

        if (clearTimer > 0) {
          clearTimer -= dt;
          if (clearTimer > 0) return;
          clearTimer = 0;
          if (level >= LEVEL_COUNT - 1) {
            finish();
            return;
          }
          dealLevel(level + 1);
          ctx.audio.go();
          return;
        }

        // 按住方向键连走：先停一拍，再按固定节奏重复，避免一按到底冲过头。
        if (!holdAction) return;
        const dir = dirFromAction(holdAction);
        if (!dir) return;
        if (!ctx.input.keys.isDown(dir)) {
          holdAction = null;
          return;
        }
        holdTimer -= dt;
        if (holdTimer > 0) return;
        holdTimer = REPEAT_RATE_MS;

        // 连发只用来赶路：上一步推动了箱子就停下，避免按住方向键把箱子顶进死角。
        if (lastPushed) {
          holdAction = null;
          return;
        }
        if (!step(dir)) holdAction = null;
      },

      render,

      pause(): void {
        press = null;
        hoverIndex = -1;
        holdAction = null;
      },

      resume(): void {
        press = null;
        hoverIndex = -1;
        holdAction = null;
      },

      destroy(): void {
        canvasEl.removeEventListener("contextmenu", blockMenu);
        ended = true;
        press = null;
        holdAction = null;
      },
    };
  },
});

export default game;
