import {
  P,
  defineGame,
  drawPixelText,
  isCoarsePointer,
  rect,
  strokeRect,
  type GameContext,
  type GameInstance,
} from "@arcade/core";

import {
  BOARD_W,
  BOARD_X,
  BOARD_Y,
  CELL,
  drawBlock,
  drawGhostCell,
  drawMiniBlock,
  drawTouchIcon,
  paintBoard,
  type TouchIcon,
} from "./art";
import { meta } from "./meta";
import {
  COLS,
  KIND_BY_ID,
  ROWS,
  SHAPES,
  clearRows,
  collides,
  collidesAt,
  dropDistance,
  emptyBoard,
  fullRows,
  gravityFor,
  levelFor,
  lineScore,
  makePiece,
  moved,
  pieceHeight,
  pieceWidth,
  rotated,
  shuffledBag,
  stamp,
  type Board,
  type Piece,
  type PieceKind,
} from "./logic";

const W = meta.size.w;
const H = meta.size.h;

/** 落地后还能操作 500ms，超时才锁定。 */
const LOCK_MS = 500;
/** 消行闪烁总时长。 */
const FLASH_MS = 120;
/** 按住下键时每格 20ms。 */
const SOFT_MS = 20;
/** 横移长按：首次 170ms，之后每 45ms 一格。 */
const REPEAT_DELAY = 170;
const REPEAT_RATE = 45;
/** 按钮按下高亮时长。 */
const PRESS_MS = 90;

/** 底部触屏按键区：4 个 46×44 的按钮，放在棋盘下方、贴底。 */
const BTN_Y = 340;
const BTN_H = 44;
const BTN_W = 46;
const BTN_GAP = 2;
const BTN_X0 = 5;
const TOUCH_IDS: readonly TouchIcon[] = ["left", "right", "rotate", "drop"];

/** 右侧独立预览栏：不和棋盘、落块重叠。 */
const NEXT_X = 166;
const NEXT_Y = 8;
const NEXT_W = 32;
const NEXT_H = 40;

type Mode = "ready" | "playing" | "over";

const game = defineGame({
  meta,
  create(ctx: GameContext): GameInstance {
    let board: Board = emptyBoard();
    let current: Piece | null = null;
    let nextKind: PieceKind = "T";
    let bag: PieceKind[] = [];
    let score = 0;
    let lines = 0;
    let level = 1;
    let clock = 0;
    let dropAccum = 0;
    let lockMs = 0;
    /** 正在闪烁的行；非 null 时冻结输入与重力。 */
    let clearing: number[] | null = null;
    let clearAt = 0;
    let mode: Mode = "ready";

    let repeatDir = 0;
    let repeatAt = 0;
    let touchHold = 0;
    let pressedBtn: TouchIcon | null = null;
    let pressedAt = 0;
    let touchUi = false;

    let bgLayer: HTMLCanvasElement | null = null;

    /* ---------------- 静态底板 ---------------- */

    const buildBackground = (): void => {
      const layer = document.createElement("canvas");
      layer.width = W;
      layer.height = H;
      const g = layer.getContext("2d");
      if (g) {
        g.imageSmoothingEnabled = false;
        paintBoard(g, W, H);
      }
      bgLayer = layer;
    };

    /* ---------------- 7-bag ---------------- */

    const drawKind = (): PieceKind => {
      if (bag.length === 0) bag = shuffledBag();
      return bag.pop() as PieceKind;
    };

    /* ---------------- HUD ---------------- */

    const syncHud = (): void => {
      ctx.hud.set("score", score);
      ctx.hud.set("lines", lines);
      ctx.hud.set("level", level);
    };

    /* ---------------- 流程 ---------------- */

    const finish = (): void => {
      if (mode === "over") return;
      mode = "over";
      current = null;
      clearing = null;
      touchHold = 0;
      pressedBtn = null;
      ctx.audio.lose();
      ctx.end({
        score,
        title: "堆到顶了",
        kicker: "GAME OVER",
        stats: [
          { label: "消行", value: lines },
          { label: "等级", value: level },
        ],
      });
    };

    /** 把 current 写进棋盘；有消行就进入 120ms 闪烁，否则直接出下一块。 */
    const lockActive = (): void => {
      const piece = current;
      if (!piece) return;

      board = stamp(board, piece);
      current = null;
      dropAccum = 0;
      lockMs = 0;
      repeatDir = 0;
      repeatAt = 0;
      touchHold = 0;

      const rows = fullRows(board);
      if (rows.length === 0) {
        ctx.audio.pop();
        spawnNext();
        return;
      }

      clearing = rows;
      clearAt = clock;
      ctx.audio.coin();

      const oldLevel = level;
      score += lineScore(rows.length, level);
      lines += rows.length;
      level = levelFor(lines);
      syncHud();
      ctx.hud.flash("score", "is-bump");
      ctx.hud.flash("lines", "is-bump");

      if (level > oldLevel) {
        ctx.hud.flash("level", "is-bump");
        ctx.audio.tier();
        ctx.toast.show(`等级 ${level}`, { duration: 900 });
      }
      if (rows.length === 4) {
        ctx.audio.tier();
        ctx.toast.show("四行消除！", { duration: 800 });
      }
    };

    const spawnNext = (): void => {
      const piece = makePiece(nextKind);
      nextKind = drawKind();
      if (collides(board, piece)) {
        current = null;
        finish();
        return;
      }
      current = piece;
      dropAccum = 0;
      lockMs = 0;
    };

    const resetRun = (): void => {
      board = emptyBoard();
      current = null;
      clearing = null;
      clearAt = 0;
      bag = [];
      nextKind = drawKind();
      score = 0;
      lines = 0;
      level = 1;
      clock = 0;
      dropAccum = 0;
      lockMs = 0;
      repeatDir = 0;
      repeatAt = 0;
      touchHold = 0;
      pressedBtn = null;
      pressedAt = 0;
      mode = "ready";
      spawnNext();
      syncHud();
    };

    /* ---------------- 操作 ---------------- */

    const isGrounded = (piece: Piece): boolean =>
      collidesAt(board, piece.kind, piece.rotation, piece.x, piece.y + 1);

    const shift = (dx: number): void => {
      const piece = current;
      if (!piece) return;
      const next = moved(board, piece, dx, 0);
      if (!next) return;
      current = next;
      if (isGrounded(next)) lockMs = 0;
      ctx.audio.blip();
    };

    const rotateActive = (): void => {
      const piece = current;
      if (!piece) return;
      const next = rotated(board, piece);
      if (!next) return;
      current = next;
      if (isGrounded(next)) lockMs = 0;
      ctx.audio.blip();
    };

    const hardDrop = (): void => {
      const piece = current;
      if (!piece) return;
      const dist = dropDistance(board, piece);
      if (dist > 0) {
        current = { kind: piece.kind, rotation: piece.rotation, x: piece.x, y: piece.y + dist };
        score += dist * 2;
        syncHud();
        ctx.hud.flash("score", "is-bump");
      }
      ctx.audio.slide();
      lockActive();
    };

    const heldDirection = (): number => {
      if (touchHold !== 0) return touchHold;
      let dir = 0;
      if (ctx.input.keys.isDown("left")) dir -= 1;
      if (ctx.input.keys.isDown("right")) dir += 1;
      return dir;
    };

    /** 横移长按重复：按下即动一格，保持 170ms 后开始连发。 */
    const updateShift = (): void => {
      const dir = heldDirection();
      if (dir === 0) {
        repeatDir = 0;
        repeatAt = 0;
      } else if (dir !== repeatDir) {
        repeatDir = dir;
        repeatAt = clock + REPEAT_DELAY;
        shift(dir);
      } else if (clock >= repeatAt) {
        repeatAt = clock + REPEAT_RATE;
        shift(dir);
      }
    };

    /** 重力与锁延迟。 */
    const updateFall = (dt: number): void => {
      if (!current) return;

      if (isGrounded(current)) {
        dropAccum = 0;
        lockMs += dt;
        if (lockMs >= LOCK_MS) lockActive();
        return;
      }

      lockMs = 0;
      const soft = ctx.input.keys.isDown("down");
      const interval = soft ? SOFT_MS : gravityFor(level);
      dropAccum += dt;

      let rows = 0;
      while (dropAccum >= interval) {
        dropAccum -= interval;
        const active = current;
        if (!active) break;
        const next = moved(board, active, 0, 1);
        if (!next) break;
        current = next;
        rows += 1;
        if (isGrounded(next)) break;
      }

      if (rows > 0) {
        if (soft) {
          score += rows;
          ctx.hud.set("score", score);
        }
        if (current && isGrounded(current)) {
          dropAccum = 0;
          lockMs = 0;
        }
      }
    };

    /* ---------------- 绘制 ---------------- */

    const drawStack = (): void => {
      const c = ctx.ctx;
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const id = board[row * COLS + col];
          if (!id) continue;
          const kind = KIND_BY_ID[id];
          if (!kind) continue;
          drawBlock(c, BOARD_X + col * CELL, BOARD_Y + row * CELL, kind);
        }
      }
    };

    const drawPiece = (piece: Piece): void => {
      const c = ctx.ctx;
      const shape = SHAPES[piece.kind][piece.rotation];
      for (const [dx, dy] of shape) {
        drawBlock(
          c,
          BOARD_X + (piece.x + dx) * CELL,
          BOARD_Y + (piece.y + dy) * CELL,
          piece.kind,
        );
      }
    };

    const drawGhost = (piece: Piece): void => {
      const dist = dropDistance(board, piece);
      if (dist <= 0) return;
      const c = ctx.ctx;
      const shape = SHAPES[piece.kind][piece.rotation];
      for (const [dx, dy] of shape) {
        drawGhostCell(
          c,
          BOARD_X + (piece.x + dx) * CELL,
          BOARD_Y + (piece.y + dy + dist) * CELL,
          piece.kind,
        );
      }
    };

    const drawFlash = (rows: readonly number[]): void => {
      // 120ms 里闪两次：白 → 正常 → 白 → 移除
      if (Math.floor((clock - clearAt) / (FLASH_MS / 3)) % 2 !== 0) return;
      for (const row of rows) {
        rect(ctx.ctx, BOARD_X, BOARD_Y + row * CELL, BOARD_W, CELL, P.white);
      }
    };

    const drawNext = (): void => {
      const c = ctx.ctx;
      rect(c, NEXT_X + 1, NEXT_Y + 1, NEXT_W, NEXT_H, P.void);
      rect(c, NEXT_X, NEXT_Y, NEXT_W, NEXT_H, P.panel);
      strokeRect(c, NEXT_X, NEXT_Y, NEXT_W, NEXT_H, P.lineHi);
      drawPixelText(c, "NEXT", NEXT_X + 2, NEXT_Y + 4, 1, P.lav, P.void);

      const mini = 6;
      const gx = NEXT_X + 4;
      const gy = NEXT_Y + 13;
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          rect(c, gx + col * mini, gy + row * mini, mini - 1, mini - 1, P.night);
        }
      }

      const w = pieceWidth(nextKind, 0);
      const h = pieceHeight(nextKind, 0);
      const ox = Math.floor((4 - w) / 2);
      const oy = Math.floor((4 - h) / 2);
      for (const [dx, dy] of SHAPES[nextKind][0]) {
        drawMiniBlock(c, gx + (dx + ox) * mini, gy + (dy + oy) * mini, mini - 1, nextKind);
      }
    };

    const buttonX = (index: number): number => BTN_X0 + index * (BTN_W + BTN_GAP);

    const buttonAt = (x: number, y: number): TouchIcon | null => {
      if (y < BTN_Y || y >= BTN_Y + BTN_H) return null;
      for (let i = 0; i < TOUCH_IDS.length; i += 1) {
        const left = buttonX(i);
        if (x >= left && x < left + BTN_W) return TOUCH_IDS[i];
      }
      return null;
    };

    const drawTouchBar = (): void => {
      const c = ctx.ctx;
      for (let i = 0; i < TOUCH_IDS.length; i += 1) {
        const id = TOUCH_IDS[i];
        const x = buttonX(i);
        const active = pressedBtn === id && clock - pressedAt < PRESS_MS;

        // 按钮在棋盘下方，独立一条控制栏
        rect(c, x, BTN_Y, BTN_W, BTN_H, active ? P.panel2 : P.panel);
        strokeRect(c, x, BTN_Y, BTN_W, BTN_H, active ? P.amber : P.lineHi);
        rect(c, x + 1, BTN_Y + 1, BTN_W - 2, 1, P.line);
        drawTouchIcon(c, id, x, BTN_Y, BTN_W, BTN_H, active ? P.gold : P.cream);
      }
    };

    const render = (): void => {
      const c = ctx.ctx;
      if (bgLayer) c.drawImage(bgLayer, 0, 0);
      else paintBoard(c, W, H);

      if (current && !clearing) drawGhost(current);
      drawStack();
      if (clearing) drawFlash(clearing);
      if (current && !clearing) drawPiece(current);

      drawNext();
      if (touchUi) drawTouchBar();
    };

    /* ---------------- 输入 ---------------- */

    const releaseTouch = (): void => {
      touchHold = 0;
      repeatDir = 0;
      repeatAt = 0;
      pressedBtn = null;
    };

    ctx.input.keys.onPress((action) => {
      if (mode !== "playing" || clearing) return;
      if (action === "up" || action === "secondary") {
        rotateActive();
      } else if (action === "action") {
        hardDrop();
      }
    });

    ctx.input.pointer.on("down", (info) => {
      if (info.source.pointerType === "touch" || info.source.pointerType === "pen") {
        touchUi = true;
      }
      if (!touchUi) return;
      if (mode !== "playing" || clearing) return;
      if (info.source.pointerType === "mouse" && info.source.button !== 0) return;

      const id = buttonAt(info.x, info.y);
      if (!id) return;

      ctx.audio.unlock();
      pressedBtn = id;
      pressedAt = clock;

      if (id === "left" || id === "right") {
        touchHold = id === "left" ? -1 : 1;
        repeatDir = touchHold;
        repeatAt = clock + REPEAT_DELAY;
        shift(touchHold);
      } else if (id === "rotate") {
        rotateActive();
      } else {
        hardDrop();
      }
    });

    ctx.input.pointer.on("up", releaseTouch);
    ctx.input.pointer.on("cancel", releaseTouch);
    ctx.input.pointer.on("leave", releaseTouch);

    /* ---------------- 初始化 ---------------- */

    buildBackground();
    resetRun();
    touchUi = isCoarsePointer();
    ctx.timer.hide();

    return {
      start(): void {
        ctx.audio.unlock();
        resetRun();
        mode = "playing";
        ctx.hud.urgent(false);
        ctx.timer.hide();
      },

      update(dt: number): void {
        if (mode !== "playing") return;
        clock += dt;

        if (clearing) {
          if (clock - clearAt >= FLASH_MS) {
            const rows = clearing;
            clearing = null;
            board = clearRows(board, rows);
            spawnNext();
          }
          return;
        }

        if (!current) return;
        updateShift();
        updateFall(dt);
      },

      render,

      pause(): void {
        // 暂停时清掉按住状态，回来不会自己继续横移
        releaseTouch();
      },
    };
  },
});

export default game;
