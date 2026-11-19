import type { GameMeta } from "@arcade/core";

import { drawThumb } from "./art";

export const meta: GameMeta = {
  id: "lights",
  no: 13,
  title: "关灯谜题",
  tagline: "点一盏，翻转上下左右",
  howto:
    "轻点一盏灯，它和上下左右的邻灯会一起翻转；把 25 盏灯全部熄灭就能过关。一共五关，越往后要按的次数越多，每关步数单独累计，五关加起来越少越好。方向键移动光标、Enter 翻转，也可以直接点灯。",
  hint: "轻点灯面翻转 · 方向键移动光标 · <kbd>Enter</kbd> 翻转 · <kbd>空格</kbd> 暂停",
  duration: "1–3 分钟",
  tags: ["步数越少越好", "五关递进", "必定有解"],
  size: { w: 168, h: 168 },
  pad: {
    dpad: "four",
    a: { action: "primary", label: "翻转" },
  },
  scoreMode: "low",
  scoreLabel: "步数",
  bestLabel: "最少步数",
  countdown: false,
  hud: [
    { key: "moves", label: "步数", kind: "number", pad: 3, minChars: 3, tone: "score" },
    { key: "left", label: "亮灯", kind: "number", pad: 2, minChars: 2, tone: "red" },
    { key: "level", label: "关数", kind: "number", pad: 2, minChars: 2, tone: "mint" },
  ],
  drawThumb,
};
