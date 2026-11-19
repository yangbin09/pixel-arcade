import type { GameMeta } from "@arcade/core";

import { drawThumb } from "./art";

export const meta: GameMeta = {
  id: "sokoban",
  no: 17,
  title: "像素推箱子",
  tagline: "只能推，不能拉",
  howto:
    "走到箱子旁边，把箱子顶到琥珀色目标点上——只能推、不能拉，箱子被顶进墙角就再也动不了。方向键 / WASD 移动，X 键撤销上一步。一共六关，步数越少越好。",
  hint: "方向键 / WASD 走 · 滑动也能走 · <kbd>X</kbd> 撤销 · <kbd>空格</kbd> 暂停",
  duration: "2–5 分钟",
  tags: ["推箱子到位", "可撤销一步", "六关递进"],
  size: { w: 168, h: 168 },
  pad: {
    dpad: "four",
    b: { action: "secondary", label: "撤销" },
  },
  scoreMode: "low",
  scoreLabel: "步数",
  bestLabel: "最少步数",
  countdown: false,
  hud: [
    { key: "moves", label: "步数", kind: "number", pad: 3, minChars: 3, tone: "score" },
    { key: "boxes", label: "就位", kind: "number", pad: 2, minChars: 2, tone: "mint" },
    { key: "level", label: "关数", kind: "number", pad: 2, minChars: 2, tone: "combo" },
  ],
  drawThumb,
};
