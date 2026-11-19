import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawMiniFloor, drawMiniPlayer, drawMiniWall } from "./art";

/** 缩略图里 7×5 的迷你迷宫：1 = 墙。 */
const MINI: readonly string[] = [
  "1111111",
  "1001001",
  "1011101",
  "1000101",
  "1111111",
];

/** 首页缩略图：80×50 逻辑像素，与游戏画面共用 art.ts 的像素素材。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);

  const cell = 7;
  const cols = MINI[0]?.length ?? 7;
  const rows = MINI.length;
  const board = cols * cell;
  const ox = Math.round((w - board) / 2);
  const oy = Math.round((h - rows * cell) / 2);

  for (let row = 0; row < rows; row += 1) {
    const line = MINI[row] ?? "";
    for (let col = 0; col < cols; col += 1) {
      const x = ox + col * cell;
      const y = oy + row * cell;
      if (line[col] === "1") drawMiniWall(ctx, x, y, cell);
      else drawMiniFloor(ctx, x, y, cell);
    }
  }

  // 三名钥匙的位置是固定的，光点呼吸
  const keys: [number, number][] = [
    [2, 1],
    [5, 3],
    [1, 3],
  ];
  for (let i = 0; i < keys.length; i += 1) {
    const [col, row] = keys[i] as [number, number];
    const pulse = wave(time * 0.9 + i * 0.3, 0.6) > 0.45;
    const cx = ox + col * cell + Math.floor(cell / 2);
    const cy = oy + row * cell + Math.floor(cell / 2);
    if (pulse) sparkle(ctx, cx, cy, 2, P.gold, P.white);
    else rect(ctx, cx - 1, cy - 1, 2, 2, P.amber);
  }

  // 玩家的提灯光圈停在中偏左下
  const px = ox + 2 * cell + Math.floor(cell / 2);
  const py = oy + 2 * cell + Math.floor(cell / 2) + (Math.floor(time * 3) % 2);
  drawMiniPlayer(ctx, px, py, 2);

  // 视野外的迷雾压暗
  ctx.save();
  ctx.globalAlpha = 0.28;
  rect(ctx, ox, oy, board, 3, P.void);
  rect(ctx, ox, oy + board - 3, board, 3, P.void);
  ctx.restore();

  rect(ctx, 0, 0, w, 1, P.line);
  rect(ctx, 0, h - 1, w, 1, P.line);
  rect(ctx, 0, 0, 1, h, P.line);
  rect(ctx, w - 1, 0, 1, h, P.line);
}

export const meta: GameMeta = {
  id: "maze",
  no: 28,
  title: "迷雾迷宫",
  tagline: "摸黑前行，找齐钥匙",
  howto:
    "方向键或虚拟手柄沿走廊走，撞墙不动；视野只有 3 格，走过的格子永久点亮。在迷宫里找齐 3 把钥匙，出口就会亮起，进门即结束，用时越短越好。",
  hint: "方向键 / WASD 移动 · A 标记死路 · <kbd>空格</kbd> 暂停",
  duration: "1–4 分钟",
  tags: ["视野只有 3 格", "找齐 3 把钥匙", "用时越短越好"],
  size: { w: 168, h: 210 },
  pad: {
    dpad: "four",
    a: { action: "primary", label: "标记" },
  },
  scoreMode: "low",
  scoreLabel: "用时（秒）",
  bestLabel: "最快纪录",
  countdown: false,
  hud: [
    { key: "time", label: "用时", kind: "time", minChars: 3, tone: "time" },
    { key: "keys", label: "钥匙", kind: "text", minChars: 3, tone: "gold" },
    { key: "seen", label: "已探索", kind: "number", pad: 3, minChars: 3, tone: "mint" },
  ],
  drawThumb,
};
