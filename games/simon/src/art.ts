import {
  P,
  bevel,
  drawPixelText,
  fillCircle,
  measurePixelText,
  rect,
  strokeRect,
} from "@arcade/core";

import type { SimonColor } from "./logic";

/** 逻辑分辨率，和 meta.size 保持一致。 */
export const VIEW_W = 168;
export const VIEW_H = 168;

/**
 * 4 象限布局：68px 方块 + 6px 十字缝，四周留 13。
 * 2*68 + 6 = 142，左右各 13 正好铺满 168；上下 8 起，止于 150。
 */
export const PAD_SIZE = 68;
export const PAD_GAP = 6;
export const PAD_MARGIN_X = 13;
export const PAD_TOP = 8;
export const PAD_BOTTOM = PAD_TOP + PAD_SIZE * 2 + PAD_GAP;

export interface Quad {
  color: SimonColor;
  x: number;
  y: number;
}

/** 四象限顺序固定：上 / 右 / 下 / 左，和 dpad 一一对应。 */
export const QUADS: readonly Quad[] = [
  { color: "up", x: PAD_MARGIN_X, y: PAD_TOP },
  { color: "right", x: PAD_MARGIN_X + PAD_SIZE + PAD_GAP, y: PAD_TOP },
  {
    color: "down",
    x: PAD_MARGIN_X + PAD_SIZE + PAD_GAP,
    y: PAD_TOP + PAD_SIZE + PAD_GAP,
  },
  { color: "left", x: PAD_MARGIN_X, y: PAD_TOP + PAD_SIZE + PAD_GAP },
];

/** 中央圆盘：正好压住四块之间的十字缝。 */
export const HUB_CX = Math.round(VIEW_W / 2);
export const HUB_CY = PAD_TOP + PAD_SIZE + Math.floor(PAD_GAP / 2);
export const HUB_R = 12;

/** 底部状态条：面板下沿 157 之后的一条 10px 凹槽。 */
const STATUS_BAR_Y = 157;
const STATUS_BAR_H = 10;
const STATUS_TEXT_Y = 158;

/** 四色 → 亮起时的面色 / 高光色 / 灭灯时的暗箭头色（全部来自 P）。 */
export const TONES: Record<SimonColor, { lit: string; hot: string; ink: string }> = {
  up: { lit: P.amber, hot: P.gold, ink: P.orange },
  right: { lit: P.mint, hot: P.white, ink: P.grassHi },
  down: { lit: P.lav, hot: P.cream, ink: P.purple },
  left: { lit: P.pink, hot: P.white, ink: P.red },
};

export function quadOf(color: SimonColor): Quad {
  for (const quad of QUADS) {
    if (quad.color === color) return quad;
  }
  return QUADS[0] as Quad;
}

/** 逻辑坐标 → 颜色；落在十字缝里或面板外返回 null。 */
export function padAt(x: number, y: number): SimonColor | null {
  for (const quad of QUADS) {
    if (x >= quad.x && x < quad.x + PAD_SIZE && y >= quad.y && y < quad.y + PAD_SIZE) {
      return quad.color;
    }
  }
  return null;
}

/* ---------------- 方向箭头 ---------------- */

/** 5×5 箭头点阵：尖端在上、竖杆在下，旋转后就是右下左三个方向。 */
const ARROW_UP: readonly string[] = [
  "00100",
  "01110",
  "11111",
  "00100",
  "00100",
];

/** 顺时针转 90°：新行 = 原列自下往上。 */
function rotateOnce(grid: readonly string[]): string[] {
  const out: string[] = [];
  for (let row = 0; row < 5; row += 1) {
    let line = "";
    for (let col = 0; col < 5; col += 1) line += grid[4 - col]?.[row] ?? "0";
    out.push(line);
  }
  return out;
}

const ARROWS: Record<SimonColor, readonly string[]> = (() => {
  const right = rotateOnce(ARROW_UP);
  const down = rotateOnce(right);
  const left = rotateOnce(down);
  return { up: ARROW_UP, right, down, left };
})();

/** 在 (cx, cy) 中心画方向箭头，unit 是一个点阵像素占多少逻辑像素。 */
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: SimonColor,
  color: string,
  unit: number,
): void {
  const u = Math.max(1, Math.round(unit));
  const grid = ARROWS[dir];
  const ox = cx - Math.floor((5 * u) / 2);
  const oy = cy - Math.floor((5 * u) / 2);
  for (let row = 0; row < 5; row += 1) {
    const line = grid[row] ?? "";
    for (let col = 0; col < 5; col += 1) {
      if (line[col] === "1") rect(ctx, ox + col * u, oy + row * u, u, u, color);
    }
  }
}

/* ---------------- 按键 ---------------- */

/** 一块颜色键的三种状态：灭着 / 亮起 / 按错时的告警红。 */
export type PadState = "idle" | "lit" | "fail";

/**
 * 一块颜色键。
 * 灭：下沉的暗槽 + 半透明同色箭头；亮：整块上色 + 高光箭头 + 高光斜切；
 * fail：整块换成告警红，只用来标记按错的那一下。
 */
export function drawPad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: SimonColor,
  state: PadState,
): void {
  const tone = TONES[color];
  const unit = size >= 40 ? 4 : 2;
  const inset = size >= 24 ? 3 : 1;
  const cx = x + Math.floor(size / 2);
  const cy = y + Math.floor(size / 2);

  if (state === "fail") {
    rect(ctx, x, y, size, size, P.redDeep);
    bevel(ctx, x, y, size, size, P.red, P.void);
    rect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, P.redDeep);
    drawArrow(ctx, cx, cy, color, P.white, unit);
    strokeRect(ctx, x, y, size, size, P.red);
    return;
  }

  if (state === "lit") {
    rect(ctx, x, y, size, size, tone.lit);
    bevel(ctx, x, y, size, size, tone.hot, P.void);
    rect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, tone.lit);
    drawArrow(ctx, cx, cy, color, tone.hot, unit);
    strokeRect(ctx, x, y, size, size, tone.hot);
    return;
  }

  rect(ctx, x, y, size, size, P.panel2);
  bevel(ctx, x, y, size, size, P.lineHi, P.void);
  rect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, P.hole);
  ctx.save();
  ctx.globalAlpha = 0.6;
  drawArrow(ctx, cx, cy, color, tone.ink, unit);
  ctx.restore();
  strokeRect(ctx, x, y, size, size, P.line);
}

/* ---------------- 场景 ---------------- */

/** 机台底：夜色 + 一块下沉面板 + 底部状态条凹槽。 */
export function paintBackdrop(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, VIEW_W, VIEW_H, P.night);
  rect(ctx, 0, 0, VIEW_W, 1, P.line);
  rect(ctx, 0, VIEW_H - 1, VIEW_W, 1, P.line);

  rect(ctx, 8, 3, 152, 152, P.void);
  strokeRect(ctx, 8, 3, 152, 152, P.line);
  rect(ctx, 10, 5, 148, 148, P.panel);

  rect(ctx, PAD_MARGIN_X - 4, STATUS_BAR_Y, VIEW_W - (PAD_MARGIN_X - 4) * 2, STATUS_BAR_H, P.panel2);
  strokeRect(
    ctx,
    PAD_MARGIN_X - 4,
    STATUS_BAR_Y,
    VIEW_W - (PAD_MARGIN_X - 4) * 2,
    STATUS_BAR_H,
    P.line,
  );
}

/** 中央圆盘：中间写本轮的步数，亮起时外圈跟着染色。 */
export function drawHub(
  ctx: CanvasRenderingContext2D,
  round: number,
  active: SimonColor | null,
): void {
  fillCircle(ctx, HUB_CX, HUB_CY, HUB_R, P.void);
  if (active) {
    fillCircle(ctx, HUB_CX, HUB_CY, HUB_R - 1, TONES[active].lit);
    fillCircle(ctx, HUB_CX, HUB_CY, HUB_R - 4, P.panel);
  } else {
    fillCircle(ctx, HUB_CX, HUB_CY, HUB_R - 1, P.line);
    fillCircle(ctx, HUB_CX, HUB_CY, HUB_R - 3, P.panel);
  }

  const label = String(Math.max(0, Math.min(99, Math.round(round))));
  const width = measurePixelText(label, 1);
  drawPixelText(
    ctx,
    label,
    HUB_CX - Math.ceil(width / 2),
    HUB_CY - 3,
    1,
    active ? TONES[active].hot : P.cream,
    null,
  );
}

/** 底部状态条：左边一条阶段词，右边一条进度（都只用像素字字符集）。 */
export function drawStatus(
  ctx: CanvasRenderingContext2D,
  label: string,
  progress: string,
  color: string,
): void {
  const left = PAD_MARGIN_X - 4 + 4;
  const right = VIEW_W - (PAD_MARGIN_X - 4) - 4;
  drawPixelText(ctx, label, left, STATUS_TEXT_Y, 1, color, null);
  const width = measurePixelText(progress, 1);
  drawPixelText(ctx, progress, right - width, STATUS_TEXT_Y, 1, P.cream, null);
}

/* ---------------- 缩略图 ---------------- */

/** 首页缩略图：80×50，四色键 + 中央圆盘，两块轮流亮示意回放。 */
export function drawThumb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
): void {
  rect(ctx, 0, 0, w, h, P.night);
  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);

  const pad = 20;
  const gap = 2;
  const board = pad * 2 + gap;
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - board) / 2);

  rect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.void);
  strokeRect(ctx, ox - 2, oy - 2, board + 4, board + 4, P.line);
  rect(ctx, ox - 1, oy - 1, board + 2, board + 2, P.panel);

  // 三拍循环：上 → 右 → 下，然后全灭一拍再重来。
  const cycle = time % 2.8;
  const litUp = cycle < 0.7;
  const litRight = cycle >= 0.7 && cycle < 1.4;
  const litDown = cycle >= 1.4 && cycle < 2.1;

  const quads: Quad[] = [
    { color: "up", x: ox, y: oy },
    { color: "right", x: ox + pad + gap, y: oy },
    { color: "down", x: ox + pad + gap, y: oy + pad + gap },
    { color: "left", x: ox, y: oy + pad + gap },
  ];

  for (const quad of quads) {
    const lit =
      (quad.color === "up" && litUp) ||
      (quad.color === "right" && litRight) ||
      (quad.color === "down" && litDown);
    drawPad(ctx, quad.x, quad.y, pad, quad.color, lit ? "lit" : "idle");
  }

  const cx = ox + Math.floor(board / 2);
  const cy = oy + Math.floor(board / 2);
  fillCircle(ctx, cx, cy, 4, P.void);
  fillCircle(
    ctx,
    cx,
    cy,
    3,
    litUp ? TONES.up.lit : litRight ? TONES.right.lit : litDown ? TONES.down.lit : P.line,
  );
  fillCircle(ctx, cx, cy, 1, litUp || litRight || litDown ? P.cream : P.panel);
}
