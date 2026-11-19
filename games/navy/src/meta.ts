import type { GameMeta } from "@arcade/core";

import { drawThumb } from "./art";

export const meta: GameMeta = {
  id: "navy",
  no: 27,
  title: "像素海战棋",
  tagline: "布好舰队，交替炮击",
  howto:
    "双方各一张 8×8 棋盘，五艘舰队（5/4/3/3/2，共 17 格）随机布好，舰与舰之间至少隔一格。你先行：轻点敌方格子开炮，命中得 1 分并再打一次，打空就换手。击沉一艘额外 +10，把对方 17 格全部打光 +100 并直接获胜。对手会追着命中点打四邻、也会按概率网格算最可疑的格子 —— 但它们有 30% 概率乱打，抓住机会抢先全歼它。",
  hint: "轻点开炮 · 方向键移光标 · <kbd>Enter</kbd> / <kbd>Z</kbd> 开炮 · <kbd>X</kbd> 随机一炮 · <kbd>P</kbd> 暂停",
  duration: "2–5 分钟",
  tags: ["五艘舰队", "命中再打一次", "AI 会追残舰"],
  size: { w: 168, h: 168 },
  scoreMode: "high",
  countdown: false,
  spaceAction: "action",
  pad: {
    dpad: "four",
    a: { action: "primary", label: "炮击" },
    b: { action: "secondary", label: "随机" },
  },
  hud: [
    { key: "score", label: "得分", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "hits", label: "命中数", kind: "number", pad: 2, minChars: 2, tone: "mint" },
    { key: "left", label: "敌剩余格", kind: "number", pad: 2, minChars: 2, tone: "red" },
  ],
  drawThumb,
};
