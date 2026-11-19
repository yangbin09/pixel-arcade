import type { GameMeta } from "@arcade/core";

import { drawThumb } from "./art";

export const meta: GameMeta = {
  id: "othello",
  no: 12,
  title: "像素黑白棋",
  tagline: "八乘八翻转，三局定输赢",
  howto:
    "你执黑先行，在 8×8 棋盘上落子，把夹住的对手棋子翻成自己的颜色。八方向都能翻，一手能翻多子。没有合法手就自动弃手，双方都无子可下时本局结束；下满三局，赢 +100 分、平 +30 分，再加我方子数差。",
  hint: "轻点落子 · 方向键移动光标 · <kbd>Enter</kbd> / <kbd>空格</kbd> 落子 · <kbd>X</kbd> 提示合法手 · <kbd>P</kbd> 暂停",
  duration: "2–5 分钟",
  tags: ["一手可翻多子", "三局两胜", "无子可下即弃手"],
  size: { w: 168, h: 168 },
  scoreMode: "high",
  pad: {
    dpad: "four",
    a: { action: "primary", label: "落子" },
    b: { action: "secondary", label: "提示" },
  },
  countdown: false,
  spaceAction: "action",
  hud: [
    { key: "score", label: "总分", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "discs", label: "我方", kind: "number", pad: 2, minChars: 2, tone: "mint" },
    { key: "ai", label: "对手", kind: "number", pad: 2, minChars: 2, tone: "red" },
  ],
  drawThumb,
};
