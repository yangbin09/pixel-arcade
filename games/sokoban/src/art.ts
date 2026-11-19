import { P, bevel, rect, strokeRect, wave } from "@arcade/core";

import { SIZE } from "./logic";

/** 逻辑分辨率，和 meta.size 保持一致。 */
export const VIEW_W = 168;
export const VIEW_H = 168;

/** 棋盘几何：19px 格子 + 1px 缝，从 (8, 8) 起，整盘 159×159。 */
export const CELL = 19;
export const GAP = 1;
export const STEP = CELL + GAP;
export const ORIGIN = 8;
export const BOARD = SIZE * STEP - GAP;

export const cellX = (col: number): number => ORIGIN + col * STEP;
export const cellY = (row: number): number => ORIGIN + row * STEP;

/** 逻辑坐标 → 格子序号；落在缝里或棋盘外返回 -1。 */
export function cellAt(x: number, y: number): number {
  const rx = x - ORIGIN;
  const ry = y - ORIGIN;
  if (rx < 0 || ry < 0) return -1;
  const col = Math.floor(rx / STEP);
  const row = Math.floor(ry / STEP);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
  if (rx - col * STEP >= CELL || ry - row * STEP >= CELL) return -1;
  return row * SIZE + col;
}

/** 触屏撤销键：贴在右下角那格墙上，有手柄时不用画。 */
export const UNDO_BUTTON = {
  x: cellX(SIZE - 1) + 1,
  y: cellY(SIZE - 1) + 1,
  w: CELL - 2,
  h: CELL - 2,
} as const;

export function insideUndoButton(x: number, y: number): boolean {
  const { x: bx, y: by, w, h } = UNDO_BUTTON;
  return x >= bx && y >= by && x < bx + w && y < by + h;
}

/** 点阵贴图：`#` 是实心像素，其余透明。 */
export function blit(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  color: string,
): void {
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] ?? "";
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === "#") rect(ctx, x + col, y + row, 1, 1, color);
    }
  }
}

/** 静态底：夜色画布 + 棋盘外框，每帧重画也很便宜。 */
export function paintBackdrop(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, VIEW_W, VIEW_H, P.night);
  rect(ctx, 0, 0, VIEW_W, 1, P.line);
  rect(ctx, 0, VIEW_H - 1, VIEW_W, 1, P.line);

  rect(ctx, ORIGIN - 1, ORIGIN - 1, BOARD + 2, BOARD + 2, P.void);
  strokeRect(ctx, ORIGIN - 1, ORIGIN - 1, BOARD + 2, BOARD + 2, P.line);
}

/** 墙：深色砖块，左上高光、右下暗边，中间一道砖缝。 */
export function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  rect(ctx, x, y, size, size, P.panel2);
  bevel(ctx, x, y, size, size, P.lineHi, P.void);
  rect(ctx, x + 3, y + Math.floor(size / 2), size - 6, 1, P.line);
  rect(ctx, x + Math.floor(size / 2), y + 3, 1, Math.floor(size / 2) - 3, P.line);
  rect(ctx, x + 5, y + 3, 1, Math.floor(size / 2) - 3, P.line);
}

/** 地板：棋盘格深浅交替，缝已经由 1px 间隙露出来。 */
export function drawFloor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alt: boolean,
): void {
  rect(ctx, x, y, size, size, alt ? P.panel : P.night);
  rect(ctx, x, y, size, 1, alt ? P.line : P.panel);
}

/** 目标点：琥珀菱形 + 金色芯，底座再压一圈暗槽。 */
export function drawGoal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pulse: boolean,
): void {
  const cx = x + Math.floor(size / 2);
  const cy = y + Math.floor(size / 2);

  rect(ctx, cx - 1, cy - 3, 3, 1, P.amber);
  rect(ctx, cx - 2, cy - 2, 5, 1, P.amber);
  rect(ctx, cx - 3, cy - 1, 7, 3, pulse ? P.orange : P.amber);
  rect(ctx, cx - 2, cy + 2, 5, 1, P.amber);
  rect(ctx, cx - 1, cy + 3, 3, 1, P.amber);

  rect(ctx, cx - 1, cy - 1, 3, 3, P.gold);
  rect(ctx, cx, cy, 1, 1, pulse ? P.white : P.cream);
}

/** 箱子：木箱四边斜切 + 十字板条；推到目标点上换成金色，一眼能数就位数。 */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  onGoal: boolean,
  pulse: boolean,
): void {
  const body = onGoal ? P.gold : P.dirt;
  const light = onGoal ? P.cream : P.dirtHi;
  const dark = onGoal ? P.orange : P.dirtDeep;
  const ink = onGoal ? P.orange : P.dirtDeep;

  rect(ctx, x + 2, y + size - 2, size - 3, 2, P.void);
  rect(ctx, x + 1, y + 1, size - 2, size - 2, dark);
  rect(ctx, x + 2, y + 2, size - 4, size - 4, body);
  bevel(ctx, x + 2, y + 2, size - 4, size - 4, light, dark);

  const mid = Math.floor(size / 2);
  rect(ctx, x + mid, y + 4, 1, size - 8, ink);
  rect(ctx, x + 4, y + mid, size - 8, 1, ink);
  rect(ctx, x + 4, y + 4, 1, 1, light);
  rect(ctx, x + size - 5, y + 4, 1, 1, light);
  rect(ctx, x + 4, y + size - 5, 1, 1, light);

  if (onGoal && pulse) {
    rect(ctx, x + mid - 1, y + mid - 1, 3, 3, P.white);
    rect(ctx, x + mid, y + mid, 1, 1, P.gold);
  }
}

export type Facing = "up" | "down" | "left" | "right";

/** 搬运工：红帽、奶白脸、淡紫工装；bob 是 1px 上下呼吸。 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  facing: Facing,
  bob: number,
): void {
  const top = y + bob;

  // 影子
  rect(ctx, x + 3, y + size - 3, size - 6, 2, P.void);

  // 腿
  rect(ctx, x + 6, top + 13, 3, 3, P.panel2);
  rect(ctx, x + 10, top + 13, 3, 3, P.panel2);

  // 工装
  rect(ctx, x + 5, top + 8, 9, 6, P.lav);
  rect(ctx, x + 6, top + 9, 7, 4, P.purple);
  rect(ctx, x + 5, top + 12, 9, 1, P.lineHi);

  // 头
  rect(ctx, x + 6, top + 4, 7, 5, P.cream);
  rect(ctx, x + 6, top + 8, 7, 1, P.pink);

  // 帽子
  rect(ctx, x + 5, top + 2, 9, 2, P.red);
  rect(ctx, x + 4, top + 3, 11, 1, P.redDeep);
  rect(ctx, x + 6, top + 1, 7, 1, P.redDeep);

  // 眼睛（朝上时看不见脸，朝左右时眼珠偏移）
  if (facing !== "up") {
    const shift = facing === "left" ? -1 : facing === "right" ? 1 : 0;
    rect(ctx, x + 8 + shift, top + 6, 1, 2, P.void);
    rect(ctx, x + 11 + shift, top + 6, 1, 2, P.void);
  }

  // 手：朝左右时伸向那一侧，朝上下时自然垂下
  if (facing === "left") {
    rect(ctx, x + 3, top + 9, 2, 2, P.lav);
  } else if (facing === "right") {
    rect(ctx, x + 14, top + 9, 2, 2, P.lav);
  } else {
    rect(ctx, x + 4, top + 10, 1, 3, P.lav);
    rect(ctx, x + 14, top + 10, 1, 3, P.lav);
  }
}

/** 阻挡反馈：朝被挡住的方向画一根短红箭头。 */
export function drawBump(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  facing: Facing,
): void {
  const cx = x + Math.floor(size / 2);
  const cy = y + Math.floor(size / 2);
  if (facing === "up") {
    rect(ctx, cx, cy - 7, 1, 4, P.red);
    rect(ctx, cx - 1, cy - 6, 1, 2, P.red);
    rect(ctx, cx + 1, cy - 6, 1, 2, P.red);
    return;
  }
  if (facing === "down") {
    rect(ctx, cx, cy + 4, 1, 4, P.red);
    rect(ctx, cx - 1, cy + 5, 1, 2, P.red);
    rect(ctx, cx + 1, cy + 5, 1, 2, P.red);
    return;
  }
  if (facing === "left") {
    rect(ctx, cx - 8, cy, 4, 1, P.red);
    rect(ctx, cx - 7, cy - 1, 2, 1, P.red);
    rect(ctx, cx - 7, cy + 1, 2, 1, P.red);
    return;
  }
  rect(ctx, cx + 4, cy, 4, 1, P.red);
  rect(ctx, cx + 5, cy - 1, 2, 1, P.red);
  rect(ctx, cx + 5, cy + 1, 2, 1, P.red);
}

/** 四角括线：撤销高亮与鼠标悬停共用。 */
export function drawCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  pad = 1,
  arm = 5,
): void {
  const left = x + pad;
  const top = y + pad;
  const right = x + size - pad - 1;
  const bottom = y + size - pad - 1;

  rect(ctx, left, top, arm, 1, color);
  rect(ctx, left, top, 1, arm, color);
  rect(ctx, right - arm + 1, top, arm, 1, color);
  rect(ctx, right, top, 1, arm, color);
  rect(ctx, left, bottom, arm, 1, color);
  rect(ctx, left, bottom - arm + 1, 1, arm, color);
  rect(ctx, right - arm + 1, bottom, arm, 1, color);
  rect(ctx, right, bottom - arm + 1, 1, arm, color);
}

/** 右上角六颗关卡指示灯：已过关薄荷、当前关金色呼吸、未到暗格。 */
export function drawLevelPips(
  ctx: CanvasRenderingContext2D,
  level: number,
  total: number,
  time: number,
): void {
  const pip = 4;
  const gap = 2;
  const width = total * pip + (total - 1) * gap;
  const x0 = Math.round((VIEW_W - width) / 2);
  const y = 1;

  for (let i = 0; i < total; i += 1) {
    const x = x0 + i * (pip + gap);
    if (i < level) {
      rect(ctx, x, y, pip, pip, P.mint);
      rect(ctx, x, y, pip, 1, P.white);
      continue;
    }
    if (i === level) {
      const on = wave(time, 1.2) > 0.5;
      rect(ctx, x, y, pip, pip, on ? P.gold : P.amber);
      rect(ctx, x, y, pip, 1, P.cream);
      continue;
    }
    rect(ctx, x, y, pip, pip, P.panel);
    strokeRect(ctx, x, y, pip, pip, P.line);
  }
}

/** 撤销图标：逆时针回环箭头。 */
const UNDO_ICON: readonly string[] = [
  "....#####...",
  "..##.....#..",
  ".###......#.",
  "#.........#.",
  "#.........#.",
  ".#.......#..",
  "..#.....#...",
  "...#####....",
];

/** 触屏撤销键：暗色小面板 + 回环箭头。 */
export function drawUndoButton(
  ctx: CanvasRenderingContext2D,
  ready: boolean,
  pulse: boolean,
): void {
  const { x, y, w, h } = UNDO_BUTTON;
  rect(ctx, x, y, w, h, ready ? P.panel2 : P.panel);
  bevel(ctx, x, y, w, h, ready ? P.lineHi : P.line, P.void);
  const ink = ready ? (pulse ? P.white : P.cream) : P.purple;
  blit(ctx, UNDO_ICON, x + 3, y + 5, ink);
}

/** 缩略图用的 6×6 迷你残局：一个箱子在目标点上，一个待推，玩家在下方。 */
const MINI: readonly string[] = [
  "######",
  "#    #",
  "# *. #",
  "#  $ #",
  "# @  #",
  "######",
];

/** 首页缩略图：80×50 逻辑像素，和游戏画面共用同一套调色板。 */
export function drawThumb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const cell = 6;
  const gap = 1;
  const board = MINI.length * cell + (MINI.length - 1) * gap;
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - board) / 2);

  rect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.void);
  strokeRect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.line);

  const pulse = wave(time, 0.9) > 0.5;

  for (let row = 0; row < MINI.length; row += 1) {
    const line = MINI[row] ?? "";
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col];
      const x = ox + col * (cell + gap);
      const y = oy + row * (cell + gap);
      const alt = (row + col) % 2 === 0;

      if (ch === "#") {
        rect(ctx, x, y, cell, cell, P.panel2);
        bevel(ctx, x, y, cell, cell, P.lineHi, P.void);
        rect(ctx, x + 1, y + Math.floor(cell / 2), cell - 2, 1, P.line);
        continue;
      }

      rect(ctx, x, y, cell, cell, alt ? P.panel : P.night);

      if (ch === "." || ch === "*") {
        rect(ctx, x + 2, y + 2, 2, 2, pulse && ch === "." ? P.white : P.gold);
      }
      if (ch === "$" || ch === "*") {
        const onGoal = ch === "*";
        rect(ctx, x + 1, y + 1, cell - 2, cell - 2, onGoal ? P.gold : P.dirt);
        bevel(ctx, x + 1, y + 1, cell - 2, cell - 2, onGoal ? P.cream : P.dirtHi, onGoal ? P.orange : P.dirtDeep);
        rect(ctx, x + Math.floor(cell / 2), y + 2, 1, cell - 4, onGoal ? P.orange : P.dirtDeep);
      }
      if (ch === "@") {
        rect(ctx, x + 2, y + 2, 3, 2, P.red);
        rect(ctx, x + 2, y + 4, 3, 2, P.cream);
        rect(ctx, x + 3, y + 6, 1, 1, P.lav);
      }
    }
  }
}
