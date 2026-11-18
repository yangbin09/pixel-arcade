/**
 * 方块像素画：颜色随数值升级，数字用引擎像素字绘制。
 * 首页缩略图与游戏内共用，保证同一套调色板。
 */

import { P, bevel, drawPixelText, measurePixelText, rect } from "@arcade/core";

/** 方块底色：低数值偏暗紫，8 之后一路升温，128 起金/薄荷交替。 */
export function tileColor(value: number): string {
  switch (value) {
    case 2:
      return P.panel2;
    case 4:
      return P.line;
    case 8:
      return P.amber;
    case 16:
      return P.orange;
    case 32:
      return P.red;
    case 64:
      return P.redDeep;
    default:
      break;
  }
  const exponent = Math.round(Math.log2(Math.max(value, 2)));
  return exponent % 2 === 0 ? P.mint : P.gold;
}

/** 数字颜色：深色方块用米白，亮色方块用近黑。 */
export function tileInk(value: number): string {
  if (value === 2 || value === 4 || value === 64) return P.cream;
  return P.void;
}

/** 斜切高光：暗块用低对比线，亮块用米白。 */
function tileEdge(value: number): { light: string; dark: string } {
  if (value === 2 || value === 4) return { light: P.lineHi, dark: P.void };
  return { light: P.cream, dark: P.void };
}

export interface TileOptions {
  /** 向四周放大的像素数，用于合并/生成时的弹一下。 */
  grow?: number;
  /** 缩略图里格子太小，可以关掉数字。 */
  showText?: boolean;
}

/** 画一个方块（底色 + 斜切高光 + 居中的像素数字）。 */
export function drawTile(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  value: number,
  options: TileOptions = {},
): void {
  const grow = options.grow ?? 0;
  const s = Math.round(size + grow * 2);
  const px = Math.round(x - grow);
  const py = Math.round(y - grow);

  rect(c, px, py, s, s, tileColor(value));
  const edge = tileEdge(value);
  bevel(c, px, py, s, s, edge.light, edge.dark);

  if (options.showText === false) return;

  const text = String(value);
  let fontSize = 3;
  if (text.length === 3) fontSize = 2;
  else if (text.length >= 4) fontSize = 1;

  const width = measurePixelText(text, fontSize);
  const height = 7 * fontSize;
  drawPixelText(
    c,
    text,
    px + Math.round((s - width) / 2),
    py + Math.round((s - height) / 2),
    fontSize,
    tileInk(value),
  );
}
