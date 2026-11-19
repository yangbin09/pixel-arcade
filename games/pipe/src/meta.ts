import type { GameMeta } from "@arcade/core";

import { drawThumb } from "./art";

export const meta: GameMeta = {
  id: "pipe",
  no: 30,
  title: "接水管",
  tagline: "转直管道，把水送到头",
  howto:
    "7×9 格的管道盘面，水源在左上、出口在右下。先点一格选中，再点方向键把它顺时针转一步，把每格管道接成一条从左上通到右下的水路。注水会自动沿着接好的管道推进；一旦水从棋盘侧边漏出去就立即失败，步数超过 80 也算输。转的步数越少成绩越好。",
  hint: "轻点选格 · <kbd>↑↓←→</kbd> 选格 · <kbd>Enter</kbd> / <kbd>空格</kbd> 旋转 · <kbd>X</kbd> 提示 · <kbd>P</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["每转一次 +1 步", "中途漏水即失败", "步数越少越好"],
  size: { w: 168, h: 210 },
  pad: {
    dpad: "four",
    a: { action: "primary", label: "旋转" },
    b: { action: "secondary", label: "提示" },
  },
  scoreMode: "low",
  scoreLabel: "步数",
  bestLabel: "最少步数",
  countdown: false,
  spaceAction: "action",
  hud: [
    { key: "moves", label: "步数", kind: "number", pad: 3, minChars: 3, tone: "time" },
    { key: "fill", label: "注水", kind: "number", pad: 3, minChars: 3, tone: "mint" },
    { key: "leaks", label: "漏水", kind: "number", pad: 1, minChars: 1, tone: "red" },
  ],
  drawThumb,
};
