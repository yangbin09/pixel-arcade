import { describe, expect, it } from "vitest";

import {
  BALL_R,
  BRICK_COLS,
  BRICK_H,
  BRICK_ORIGIN_X,
  BRICK_ROWS,
  BRICK_W,
  DRAG_SENSITIVITY,
  FIELD_H,
  FIELD_W,
  MAX_BOUNCE_ANGLE,
  MAX_SPEED,
  PADDLE_MARGIN,
  PADDLE_W,
  PADDLE_WIDE,
  PADDLE_Y,
  TOTAL_LEVELS,
  ballBox,
  bounceFromPaddle,
  brickPoints,
  brickRect,
  clampPaddleX,
  countAlive,
  createBricks,
  levelLayout,
  overlap,
  paddleMaxX,
  speedForLevel,
  substepsFor,
  touchDragAnchor,
  touchDragTarget,
  type Rect,
} from "../src/logic";
import { meta } from "../src/meta";

const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

const countTrue = (layout: boolean[][]): number =>
  layout.reduce((total, row) => total + row.filter(Boolean).length, 0);

describe("场地与砖块几何", () => {
  it("画布是 168×210", () => {
    expect(FIELD_W).toBe(168);
    expect(FIELD_H).toBe(210);
  });

  it("砖块 18×8、间距 2，8 列 5 行都落在画布内", () => {
    expect(BRICK_W).toBe(18);
    expect(BRICK_H).toBe(8);
    expect(BRICK_COLS).toBe(8);
    expect(BRICK_ROWS).toBe(5);

    const first = brickRect(0, 0);
    const last = brickRect(BRICK_ROWS - 1, BRICK_COLS - 1);

    expect(first).toEqual({ x: BRICK_ORIGIN_X, y: 20, w: 18, h: 8 });
    expect(last.x + last.w).toBeLessThanOrEqual(FIELD_W);
    expect(last.y + last.h).toBeLessThanOrEqual(FIELD_H);
    expect(last.x + last.w).toBe(163);
    expect(last.y + last.h).toBe(68);
  });

  it("砖区在画布中居中，左右留白一致", () => {
    expect(BRICK_ORIGIN_X).toBe(5);
    const rightGap = FIELD_W - (brickRect(0, BRICK_COLS - 1).x + BRICK_W);
    expect(rightGap).toBe(BRICK_ORIGIN_X);
  });

  it("分值按行：顶行 30、中间 20、底行 10", () => {
    expect(brickPoints(0)).toBe(30);
    expect(brickPoints(1)).toBe(20);
    expect(brickPoints(2)).toBe(20);
    expect(brickPoints(3)).toBe(20);
    expect(brickPoints(4)).toBe(10);
  });
});

describe("关卡图案", () => {
  it("第一关满盘 40 块", () => {
    expect(countTrue(levelLayout(1))).toBe(40);
  });

  it("第二关棋盘 20 块", () => {
    const layout = levelLayout(2);
    expect(countTrue(layout)).toBe(20);
    expect(layout[0]?.[0]).toBe(true);
    expect(layout[0]?.[1]).toBe(false);
    expect(layout[1]?.[0]).toBe(false);
    expect(layout[1]?.[1]).toBe(true);
  });

  it("第三关金字塔 28 块，逐行加宽且居中", () => {
    const layout = levelLayout(3);
    expect(countTrue(layout)).toBe(28);
    expect(layout[0]).toEqual([false, false, false, true, true, false, false, false]);
    expect(layout[1]).toEqual([false, false, true, true, true, true, false, false]);
    expect(layout[2]).toEqual([false, true, true, true, true, true, true, false]);
    expect(layout[3]?.every(Boolean)).toBe(true);
    expect(layout[4]?.every(Boolean)).toBe(true);
  });

  it("关卡编号超出范围时夹到 1..3", () => {
    expect(levelLayout(0)).toEqual(levelLayout(1));
    expect(levelLayout(99)).toEqual(levelLayout(TOTAL_LEVELS));
  });

  it("createBricks 只生成图案里存在的砖", () => {
    const bricks = createBricks(2);
    expect(bricks).toHaveLength(20);
    expect(countAlive(bricks)).toBe(20);

    const first = bricks[0];
    if (first) first.alive = false;
    expect(countAlive(bricks)).toBe(19);
  });
});

describe("挡板反弹角", () => {
  it("击中中心时笔直向上，速度大小不变", () => {
    const v = bounceFromPaddle(0, 120);
    expect(v.vx).toBeCloseTo(0, 6);
    expect(v.vy).toBeCloseTo(-120, 6);
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(120, 6);
  });

  it("击中右边缘是 +60°，左边缘是 -60°", () => {
    const right = bounceFromPaddle(1, 100);
    // 角度从竖直向上方向量起
    expect(Math.atan2(right.vx, -right.vy)).toBeCloseTo(MAX_BOUNCE_ANGLE, 6);
    expect(Math.hypot(right.vx, right.vy)).toBeCloseTo(100, 6);

    const left = bounceFromPaddle(-1, 100);
    expect(Math.atan2(left.vx, -left.vy)).toBeCloseTo(-MAX_BOUNCE_ANGLE, 6);
    expect(Math.hypot(left.vx, left.vy)).toBeCloseTo(100, 6);
  });

  it("偏移超出 ±1 时会被夹住", () => {
    expect(bounceFromPaddle(2, 100)).toEqual(bounceFromPaddle(1, 100));
    expect(bounceFromPaddle(-3, 100)).toEqual(bounceFromPaddle(-1, 100));
  });

  it("挡板 x 范围是 6..162-width", () => {
    expect(clampPaddleX(-100, PADDLE_W)).toBe(PADDLE_MARGIN);
    expect(clampPaddleX(999, PADDLE_W)).toBe(134);
    expect(clampPaddleX(60, PADDLE_W)).toBe(60);
    expect(paddleMaxX(PADDLE_W)).toBe(162 - PADDLE_W);
    expect(paddleMaxX(PADDLE_WIDE)).toBe(162 - PADDLE_WIDE);
  });

  it("挡板固定在 y=196", () => {
    expect(PADDLE_Y).toBe(196);
  });
});

describe("AABB 碰撞", () => {
  it("相交时命中", () => {
    expect(overlap(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(overlap(box(0, 0, 10, 10), box(2, 9, 5, 5))).toBe(true);
  });

  it("分开或仅贴边时不算命中", () => {
    expect(overlap(box(0, 0, 10, 10), box(10, 0, 5, 5))).toBe(false);
    expect(overlap(box(0, 0, 10, 10), box(11, 0, 5, 5))).toBe(false);
    expect(overlap(box(0, 0, 10, 10), box(0, 10, 5, 5))).toBe(false);
  });

  it("球按 3×3 的 AABB 处理", () => {
    expect(ballBox(10, 20)).toEqual({ x: 10 - BALL_R, y: 20 - BALL_R, w: 3, h: 3 });
    expect(ballBox(10, 20).w).toBe(BALL_R * 2);
  });
});

describe("子步进", () => {
  it("每步最多 4px", () => {
    expect(substepsFor(0)).toBe(1);
    expect(substepsFor(-3)).toBe(1);
    expect(substepsFor(4)).toBe(1);
    expect(substepsFor(4.01)).toBe(2);
    expect(substepsFor(12)).toBe(3);
    expect(substepsFor(240 * 0.05)).toBe(3);
  });
});

describe("球速", () => {
  it("初速 120，每关 +12%", () => {
    expect(speedForLevel(1)).toBe(120);
    expect(speedForLevel(2)).toBeCloseTo(134.4, 5);
    expect(speedForLevel(3)).toBeCloseTo(150.528, 4);
  });

  it("上限 240，不会因为关卡很大而超速", () => {
    expect(speedForLevel(99)).toBe(MAX_SPEED);
    expect(speedForLevel(0)).toBe(120);
  });
});

describe("挡板 · 触摸相对拖动", () => {
  it("灵敏度为 1.35", () => {
    expect(DRAG_SENSITIVITY).toBeCloseTo(1.35);
  });

  it("正向拖动按灵敏度放大位移", () => {
    const anchor = touchDragAnchor(50, 60);
    expect(touchDragTarget(anchor, 70, PADDLE_W)).toBeCloseTo(60 + 20 * 1.35);
  });

  it("反向拖动同样按灵敏度放大", () => {
    const anchor = touchDragAnchor(50, 60);
    expect(touchDragTarget(anchor, 30, PADDLE_W)).toBeCloseTo(60 - 20 * 1.35);
  });

  it("拖出场地时按当前挡板宽度夹住", () => {
    const anchor = touchDragAnchor(84, 60);
    expect(touchDragTarget(anchor, -500, PADDLE_W)).toBe(PADDLE_MARGIN);
    expect(touchDragTarget(anchor, 500, PADDLE_W)).toBe(paddleMaxX(PADDLE_W));
    // 加长状态下右边界的可用范围更小。
    expect(touchDragTarget(anchor, 500, PADDLE_WIDE)).toBe(paddleMaxX(PADDLE_WIDE));
  });

  it("手指离挡板很远按下时不会瞬移，零位移保持原位", () => {
    const anchor = touchDragAnchor(150, 60);
    expect(touchDragTarget(anchor, 150, PADDLE_W)).toBe(60);
    // 灵敏度可以显式覆盖。
    expect(touchDragTarget(anchor, 160, PADDLE_W, 2)).toBeCloseTo(60 + 10 * 2);
  });
});

describe("meta 与规格一致", () => {
  it("id / 机位 / 尺寸 / 模式", () => {
    expect(meta.id).toBe("breakout");
    expect(meta.no).toBe(3);
    expect(meta.size).toEqual({ w: 168, h: 210 });
    expect(meta.scoreMode).toBe("high");
    expect(meta.spaceAction).toBe("action");
  });

  it("HUD 三栏与文案按 specs", () => {
    expect(meta.hud.map((slot) => slot.key)).toEqual(["score", "lives", "level"]);
    expect(meta.duration).toBe("2–4 分钟");
    expect(meta.tags).toEqual(["砖块 10/20/30", "掉落道具", "3 条命"]);
    expect(meta.tagline).toBe("三块砖一条命，撑到第三关");
  });
});
