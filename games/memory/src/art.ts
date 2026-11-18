import { P, drawPixelText, rect } from "@arcade/core";

/**
 * 记忆翻牌专属像素素材：
 * - 8 个 16×16 图案（星星、心、蘑菇、剑、盾、药水、钥匙、炸弹）
 * - 36×36 的牌面（背面问号 / 正面图案）
 *
 * 图案用字符网格描述，颜色全部取自 P 调色板，绘制时逐像素铺矩形。
 */

export const CARD_SIZE = 36;

export const ICON_IDS = [
  "star",
  "heart",
  "mushroom",
  "sword",
  "shield",
  "potion",
  "key",
  "bomb",
] as const;

export type IconId = (typeof ICON_IDS)[number];

interface IconSpec {
  /** 16 行 × 16 列；"." 为透明。 */
  rows: readonly string[];
  /** 字符 → 调色板颜色。 */
  colors: Readonly<Record<string, string>>;
}

const ICONS: Record<IconId, IconSpec> = {
  star: {
    rows: [
      ".......oo.......",
      "......o++o......",
      "......o##o......",
      ".....o#++#o.....",
      ".ooooo#++#ooooo.",
      "o##############o",
      "o##############o",
      ".o####++++####o.",
      "..o###++++###o..",
      "...o########o...",
      "...o########o...",
      "..o###o..o###o..",
      ".o###o....o###o.",
      ".o##o......o##o.",
      ".o#o........o#o.",
      "..o..........o..",
    ],
    colors: { o: P.orange, "#": P.gold, "+": P.white },
  },

  heart: {
    rows: [
      "................",
      "................",
      ".....oo..oo.....",
      "...oo##oo##oo...",
      "..o##++##++##o..",
      ".o##+++##+++##o.",
      ".o##++++++++##o.",
      ".o###++++++###o.",
      "..o##++++++##o..",
      "...o##++++##o...",
      "....o######o....",
      ".....o####o.....",
      "......o##o......",
      ".......oo.......",
      "................",
      "................",
    ],
    colors: { o: P.redDeep, "#": P.red, "+": P.pink },
  },

  mushroom: {
    rows: [
      "....oooooooo....",
      "..oo########oo..",
      ".o####++##++##o.",
      "o##++####++####o",
      "o##++####++####o",
      "o###++###++####o",
      ".o############o.",
      "..oo########oo..",
      "....oooooooo....",
      ".....x====x.....",
      "....x==--==x....",
      "....x==--==x....",
      "....x==--==x....",
      "....x==--==x....",
      "....xx====xx....",
      ".....xxxxxx.....",
    ],
    colors: {
      o: P.redDeep,
      "#": P.red,
      "+": P.cream,
      x: P.dirtDeep,
      "=": P.cream,
      "-": P.dirtHi,
    },
  },

  sword: {
    rows: [
      ".......oo.......",
      "......o++o......",
      "......o++o......",
      "......o++o......",
      "......o++o......",
      "......o++o......",
      "......o++o......",
      "......o++o......",
      "......o++o......",
      "......o++o......",
      "..o##########o..",
      "..o##########o..",
      "..o----------o..",
      "......x==x......",
      "......x==x......",
      "......o##o......",
    ],
    colors: {
      o: P.purple,
      "+": P.white,
      "#": P.gold,
      "-": P.orange,
      x: P.dirtDeep,
      "=": P.dirt,
    },
  },

  shield: {
    rows: [
      "..oooooooooooo..",
      ".o############o.",
      "o#####====#####o",
      "o#####====#####o",
      "o#####====#####o",
      "o##==========##o",
      "o##==========##o",
      ".o####====####o.",
      ".o####====####o.",
      "..o###====###o..",
      "...o##====##o...",
      "....o#====#o....",
      ".....o====o.....",
      "......o==o......",
      ".......oo.......",
      "................",
    ],
    colors: { o: P.grassDeep, "#": P.mint, "=": P.gold },
  },

  potion: {
    rows: [
      "......oooo......",
      "......o==o......",
      "......o==o......",
      ".....oo==oo.....",
      ".....o####o.....",
      "....o######o....",
      "...o########o...",
      "..o##++++++##o..",
      "..o#++++++++#o..",
      "..o#++++++++#o..",
      "..o#++++++++#o..",
      "..o##++++++##o..",
      "...o########o...",
      "....o######o....",
      ".....oooooo.....",
      "................",
    ],
    colors: { o: P.purple, "#": P.lav, "+": P.pink, "=": P.dirtHi },
  },

  key: {
    rows: [
      "................",
      "....o######o....",
      "...o#+oooo+#o...",
      "...o#o....o#o...",
      "...o#+oooo+#o...",
      "....o######o....",
      ".....o####o.....",
      "......o##o......",
      "......o##o......",
      "......o##o......",
      "......o##o##o...",
      "......o##o##o...",
      "......o##ooo....",
      "......o##o......",
      "......oooo......",
      "................",
    ],
    colors: { o: P.amber, "#": P.gold, "+": P.white },
  },

  bomb: {
    rows: [
      "...........*w*..",
      "...........==...",
      "..........==....",
      ".........==.....",
      "........==......",
      ".....oooooo.....",
      "...oo######oo...",
      "..o##+++++###o..",
      ".o###+++++####o.",
      ".o##++++++####o.",
      ".o############o.",
      ".o############o.",
      "..o##########o..",
      "...oo######oo...",
      ".....oooooo.....",
      "................",
    ],
    colors: {
      o: P.void,
      "#": P.panel2,
      "+": P.purple,
      "=": P.dirt,
      "*": P.gold,
      w: P.white,
    },
  },
};

/** 单元测试用：拿到某个图案的 16 行字符网格。 */
export function iconRows(id: IconId): readonly string[] {
  return ICONS[id].rows;
}

/** 按 scale 倍逐像素绘制一个 16×16 图案。 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  x: number,
  y: number,
  scale = 1,
): void {
  const spec = ICONS[id];
  for (let row = 0; row < 16; row += 1) {
    const line = spec.rows[row] ?? "";
    for (let col = 0; col < 16; col += 1) {
      const ch = line[col];
      if (!ch || ch === ".") continue;
      const color = spec.colors[ch];
      if (color) rect(ctx, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
}

/** 36×36 牌背：深色面板 + 像素问号。 */
export function drawCardBack(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const s = CARD_SIZE;
  rect(ctx, x, y, s, s, P.panel);
  rect(ctx, x, y, s, 2, P.lineHi);
  rect(ctx, x, y, 2, s, P.lineHi);
  rect(ctx, x, y + s - 2, s, 2, P.void);
  rect(ctx, x + s - 2, y, 2, s, P.void);

  rect(ctx, x + 4, y + 4, s - 8, s - 8, P.panel2);
  rect(ctx, x + 4, y + 4, s - 8, 1, P.line);
  rect(ctx, x + 4, y + 4, 1, s - 8, P.line);
  rect(ctx, x + 4, y + s - 5, s - 8, 1, P.void);
  rect(ctx, x + s - 5, y + 4, 1, s - 8, P.void);

  rect(ctx, x + 3, y + 3, 1, 1, P.lav);
  rect(ctx, x + s - 4, y + 3, 1, 1, P.lav);
  rect(ctx, x + 3, y + s - 4, 1, 1, P.lav);
  rect(ctx, x + s - 4, y + s - 4, 1, 1, P.lav);

  drawPixelText(ctx, "?", x + 13, y + 11, 2, P.lav, P.purple);
}

/** 36×36 牌面：奶油底 + 32×32 图案；配对成功后描边变薄荷色。 */
export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  icon: IconId,
  x: number,
  y: number,
  matched = false,
): void {
  const s = CARD_SIZE;
  if (matched) {
    rect(ctx, x, y, s, s, P.grassDeep);
    rect(ctx, x, y, s - 2, s - 2, P.mint);
  } else {
    rect(ctx, x, y, s, s, P.orange);
    rect(ctx, x, y, s - 2, s - 2, P.amber);
  }
  rect(ctx, x + 2, y + 2, s - 4, s - 4, P.cream);
  drawIcon(ctx, icon, x + 2, y + 2, 2);
}
