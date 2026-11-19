import type { GameMeta } from "@arcade/core";

import { drawThumb } from "./art";

export const meta: GameMeta = {
  id: "simon",
  no: 15,
  title: "记忆节拍",
  tagline: "记住顺序，一拍不错",
  howto:
    "四块颜色键会按顺序依次亮起、各响一个音，记住这一整串顺序，再按同样顺序点回去。每过一轮序列多一步，亮灯间隔也越来越短；按错一下立刻结束，复现越长的序列分数越高。",
  hint: "点四象限复现 · 方向键 / WASD 复现 · <kbd>Z</kbd> 重听一轮 · <kbd>空格</kbd> 暂停",
  duration: "30–90 秒",
  tags: ["每轮 +1 步", "回放越来越快", "按错即结束"],
  size: { w: 168, h: 168 },
  pad: {
    dpad: "four",
    a: { action: "primary", label: "确认" },
  },
  scoreMode: "high",
  countdown: false,
  hud: [
    { key: "round", label: "轮次", kind: "number", pad: 2, minChars: 2, tone: "combo" },
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "best", label: "最高", kind: "number", pad: 5, minChars: 5, tone: "time" },
  ],
  drawThumb,
};
