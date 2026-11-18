import { P, bevel, rect, strokeRect, type PaletteKey } from "@arcade/core";

import { BLOCK_H, BLOCK_W, H, HIT_Y, LANES, LANE_W, SPAWN_Y } from "./logic";

/** 四条轨道的主题色：奶白 / 琥珀 / 薄荷 / 淡紫。 */
const BASE_KEYS: PaletteKey[] = ["cream", "amber", "mint", "lav"];
const LIGHT_KEYS: PaletteKey[] = ["white", "gold", "cream", "cream"];
const DARK_KEYS: PaletteKey[] = ["amber", "orange", "grassHi", "purple"];

const keyAt = (keys: PaletteKey[], lane: number): string => P[keys[lane % LANES]!];

export const laneBase = (lane: number): string => keyAt(BASE_KEYS, lane);
export const laneLight = (lane: number): string => keyAt(LIGHT_KEYS, lane);
export const laneDark = (lane: number): string => keyAt(DARK_KEYS, lane);

/**
 * 静态轨道：底色、顶部投放槽、底部判定区、落地线。
 * 每帧重画一次也很便宜，不额外建离屏 canvas。
 */
export function paintTrack(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, LANES * LANE_W, H, P.night);

  // 隔一条轨道加深一点，四条轨道一眼能数清。
  for (let lane = 1; lane < LANES; lane += 2) {
    rect(ctx, lane * LANE_W, 0, LANE_W, H, P.panel);
  }

  // 底部判定区：进入这里才允许点。
  rect(ctx, 0, HIT_Y, LANES * LANE_W, H - HIT_Y, P.panel);
  for (let x = 0; x < LANES * LANE_W; x += 6) {
    rect(ctx, x, HIT_Y, 3, 1, P.lineHi);
  }

  // 顶部投放槽与四盏小灯。
  rect(ctx, 0, 0, LANES * LANE_W, SPAWN_Y, P.void);
  rect(ctx, 0, SPAWN_Y - 1, LANES * LANE_W, 1, P.line);
  for (let lane = 0; lane < LANES; lane += 1) {
    rect(ctx, lane * LANE_W + 19, 5, 4, 2, P.lineHi);
  }

  // 轨道分隔线。
  for (let lane = 1; lane < LANES; lane += 1) {
    rect(ctx, lane * LANE_W, 0, 1, H, P.line);
  }

  // 地面线 + 每轨一个刻度，强调「落地就结束」。
  rect(ctx, 0, H - 2, LANES * LANE_W, 2, P.lineHi);
  rect(ctx, 0, H - 1, LANES * LANE_W, 1, P.redDeep);
  for (let lane = 0; lane < LANES; lane += 1) {
    rect(ctx, lane * LANE_W + 18, H - 6, 6, 2, P.lineHi);
  }

  // 两侧收边。
  rect(ctx, 0, 0, 1, H, P.line);
  rect(ctx, LANES * LANE_W - 1, 0, 1, H, P.line);
}

/**
 * 一块下落的方块：键帽造型 + 向下的箭头。
 * hittable 时加白边，提示「现在可以点」。
 */
export function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  lane: number,
  hittable: boolean,
): void {
  const base = laneBase(lane);
  const light = laneLight(lane);
  const dark = laneDark(lane);

  rect(ctx, x, y, BLOCK_W, BLOCK_H, base);
  bevel(ctx, x, y, BLOCK_W, BLOCK_H, light, dark);

  // 中间一个像素箭头，方向朝下。
  const cx = x + BLOCK_W / 2;
  rect(ctx, cx - 4, y + 12, 8, 2, dark);
  rect(ctx, cx - 2, y + 14, 4, 2, dark);
  rect(ctx, cx, y + 16, 2, 2, dark);

  // 四角小铆钉，增加街机面板感。
  rect(ctx, x + 3, y + 3, 2, 2, light);
  rect(ctx, x + BLOCK_W - 5, y + BLOCK_H - 5, 2, 2, dark);

  if (hittable) {
    strokeRect(ctx, x - 1, y - 1, BLOCK_W + 2, BLOCK_H + 2, P.white);
    rect(ctx, x - 1, y + 15, 2, 4, P.white);
    rect(ctx, x + BLOCK_W - 1, y + 15, 2, 4, P.white);
  }
}

/** 首页缩略图用的小方块（约 16×10），1px 高光就够了。 */
export function drawMiniBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  lane: number,
): void {
  rect(ctx, x, y, w, h, laneBase(lane));
  rect(ctx, x, y, w - 1, 1, laneLight(lane));
  rect(ctx, x, y, 1, h - 1, laneLight(lane));
  rect(ctx, x + 1, y + h - 1, w - 1, 1, laneDark(lane));
  rect(ctx, x + w - 1, y + 1, 1, h - 1, laneDark(lane));
  rect(ctx, x + Math.round(w / 2) - 2, y + Math.round(h / 2), 4, 1, laneDark(lane));
}
