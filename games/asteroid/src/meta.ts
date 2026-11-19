import { P, rect, sparkle, wave, type GameMeta } from "@arcade/core";

import { drawAsteroid, drawBullet, drawShip, drawStar } from "./art";

/** 缩略图里的一圈陨石：坐标手工摆好，避免每帧抖动。 */
const THUMB_ROCKS: readonly { x: number; y: number; r: number; kind: "large" | "medium" | "small" }[] = [
  { x: 14, y: 12, r: 7, kind: "large" },
  { x: 47, y: 8, r: 5, kind: "medium" },
  { x: 69, y: 17, r: 4, kind: "small" },
  { x: 24, y: 39, r: 5, kind: "medium" },
  { x: 62, y: 41, r: 6, kind: "large" },
];

/** 首页缩略图：80×50 逻辑像素，环形陨石带里漂着一艘惯性飞船。 */
function drawThumb(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  rect(ctx, 0, 0, w, h, P.void);
  rect(ctx, 0, 0, w, 1, P.night);
  rect(ctx, 0, h - 1, w, 1, P.night);

  // 静态星点：位置用整数公式排开，不引入随机。
  for (let i = 0; i < 22; i += 1) {
    const x = (i * 31 + 7) % w;
    const y = (i * 17 + 5) % h;
    drawStar(ctx, x, y, i % 5 === 0);
  }

  for (let i = 0; i < THUMB_ROCKS.length; i += 1) {
    const rock = THUMB_ROCKS[i]!;
    drawAsteroid(ctx, rock.x, rock.y, rock.r, rock.kind, i);
  }

  // 中间那艘飞船：朝向缓慢摆动，看起来像在惯性漂移。
  const angle = -Math.PI / 2 + Math.sin(time * 1.6) * 0.45;
  drawShip(ctx, 40, 26, angle, wave(time, 1.4) > 0.5, time * 1000);

  // 两发子弹沿飞船朝向飞出。
  for (let i = 1; i <= 2; i += 1) {
    const travel = 10 + i * 9;
    const bx = 40 + Math.cos(angle) * travel + Math.sin(time * 3) * 1.5;
    const by = 26 + Math.sin(angle) * travel;
    drawBullet(ctx, bx, by, Math.cos(angle), Math.sin(angle));
  }

  const pulse = wave(time, 0.6);
  sparkle(ctx, 9, 26, pulse > 0.6 ? 2 : 1, P.gold, P.white);
  sparkle(ctx, 71, 30, 1, P.mint, P.cream);
}

export const meta: GameMeta = {
  id: "asteroid",
  no: 24,
  title: "环形陨石带",
  tagline: "惯性漂流，转着打",
  howto:
    "飞船没有摩擦：按住推进键加速后松手，它会一直漂下去，只有撞到边界才会从对面穿回来。左右键旋转机身，A 键沿机头方向开火。大陨石打碎成两颗中陨石，中陨石再碎成两颗小陨石，越碎越值钱。每波 6+波次 颗，清完进下一波；三条命，被撞掉一条后有 1.2 秒无敌。",
  hint: "拖动 / <kbd>←</kbd> <kbd>→</kbd> 转向 · <kbd>↑</kbd> / <kbd>X</kbd> 推进 · <kbd>Enter</kbd> / <kbd>Z</kbd> 开火 · <kbd>空格</kbd> 暂停",
  duration: "2–4 分钟",
  tags: ["陨石会分裂", "无摩擦惯性", "屏幕环绕"],
  size: { w: 168, h: 210 },
  pad: {
    dpad: "lr",
    a: { action: "action", label: "开火" },
    b: { action: "secondary", label: "推进" },
  },
  scoreMode: "high",
  hud: [
    { key: "score", label: "分数", kind: "number", pad: 5, minChars: 5, tone: "score" },
    { key: "lives", label: "生命", kind: "number", pad: 1, minChars: 1, tone: "red" },
    { key: "wave", label: "波次", kind: "number", pad: 2, minChars: 2, tone: "mint" },
  ],
  drawThumb,
};
