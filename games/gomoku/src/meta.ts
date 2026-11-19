import type { GameMeta } from "@arcade/core";

import { drawThumb } from "./art";

export const meta: GameMeta = {
  id: "gomoku",
  no: 26,
  title: "十三路五子棋",
  tagline: "十三路连五，三局定输赢",
  howto:
    "你在 13×13 的棋盘上执黑先行，横、竖、两条斜线任意方向连满五子即胜。AI 会堵你的活三，也会自己做四；被它连五就输。三局两胜，平局（棋盘下满）不计分。落错一手可以按 X 悔棋，会连同 AI 的回应一起撤回。",
  hint: "轻点落子 · 方向键移动光标 · <kbd>Enter</kbd> / <kbd>空格</kbd> 落子 · <kbd>X</kbd> 悔棋 · <kbd>P</kbd> 暂停",
  duration: "2–5 分钟",
  tags: ["连五即胜", "AI 会堵活三", "三局两胜"],
  size: { w: 168, h: 168 },
  scoreMode: "high",
  pad: {
    dpad: "four",
    a: { action: "primary", label: "落子" },
    b: { action: "secondary", label: "悔棋" },
  },
  countdown: false,
  spaceAction: "action",
  hud: [
    { key: "score", label: "得分", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "win", label: "胜局", kind: "number", pad: 1, minChars: 1, tone: "mint" },
    { key: "lose", label: "负局", kind: "number", pad: 1, minChars: 1, tone: "red" },
  ],
  drawThumb,
};
