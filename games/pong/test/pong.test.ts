import { describe, expect, it } from "vitest";

import {
  AI_LEAD_STEP,
  AI_MAX_LEVEL,
  AI_MAX_REACTION,
  AI_MAX_SPEED,
  AI_MIN_LEAD,
  AI_MIN_REACTION,
  AI_MIN_SPEED,
  BALL_MAX_X,
  BALL_MIN_X,
  BALL_R,
  BASE_SPEED,
  BOTTOM_LINE,
  EDGE,
  FIELD,
  MAX_BOUNCE,
  MAX_SPEED,
  PADDLE_H,
  PADDLE_HALF,
  PADDLE_MAX,
  PADDLE_MIN,
  PADDLE_SPEED,
  RALLY_POINT,
  SERVE_SPREAD,
  TOP_LINE,
  WIN_BONUS,
  WIN_POINTS,
  aiReaction,
  aiSpeed,
  aiStep,
  aiTarget,
  ballBox,
  bounceVelocity,
  catchesPaddle,
  clampPaddle,
  dragAnchor,
  dragTarget,
  foldX,
  goalScored,
  hitOffset,
  overlap,
  paddleRect,
  paddleSpan,
  predictLandingX,
  reflectAngle,
  scoreForRally,
  serveAngle,
  speedUp,
  substepsFor,
  type Ball,
  type Rect,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一串 [0,1)。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const box = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** 一颗飞向顶挡板的球（vy < 0）。 */
const risingBall = (over: Partial<Ball> = {}): Ball => ({
  x: 84,
  y: 100,
  vx: 0,
  vy: -110,
  speed: BASE_SPEED,
  ...over,
});

describe("规格常量", () => {
  it("球场 168×168，四周留白 6px", () => {
    expect(FIELD).toBe(168);
    expect(EDGE).toBe(6);
    expect(TOP_LINE).toBe(6);
    expect(BOTTOM_LINE).toBe(162);
  });

  it("挡板 28 长、球半径 2、初速 110、上限 260", () => {
    expect(PADDLE_H).toBe(28);
    expect(PADDLE_HALF).toBe(14);
    expect(BALL_R).toBe(2);
    expect(BASE_SPEED).toBe(110);
    expect(MAX_SPEED).toBe(260);
  });

  it("七分制、每拍 1 分、赢一分 50 分", () => {
    expect(WIN_POINTS).toBe(7);
    expect(RALLY_POINT).toBe(1);
    expect(WIN_BONUS).toBe(50);
  });
});

describe("reflectAngle · 反弹角", () => {
  it("左右对称：偏移反号则角度反号", () => {
    for (const offset of [0, 0.25, 0.5, 0.75, 1]) {
      expect(reflectAngle(-offset)).toBeCloseTo(-reflectAngle(offset), 10);
    }
    expect(reflectAngle(0)).toBe(0);
  });

  it("±1 对应 ±60°，中间线性插值", () => {
    expect(reflectAngle(1)).toBeCloseTo(MAX_BOUNCE, 10);
    expect(reflectAngle(-1)).toBeCloseTo(-MAX_BOUNCE, 10);
    expect(MAX_BOUNCE).toBeCloseTo(Math.PI / 3, 10);
    expect(reflectAngle(0.5)).toBeCloseTo(Math.PI / 6, 10);
    expect(Math.abs(reflectAngle(1))).toBeLessThan(Math.PI / 2);
  });

  it("偏移超出 ±1 时夹住，不会出现垂直/贴板角度", () => {
    expect(reflectAngle(2)).toBe(reflectAngle(1));
    expect(reflectAngle(-3)).toBe(reflectAngle(-1));
    expect(Math.abs(reflectAngle(99))).toBeLessThan(Math.PI / 2 - 0.01);
  });

  it("反弹后速度大小不变，方向始终离开挡板", () => {
    for (const offset of [-1, -0.4, 0, 0.4, 1]) {
      const down = bounceVelocity(offset, 140, 1);
      const up = bounceVelocity(offset, 140, -1);
      expect(Math.hypot(down.vx, down.vy)).toBeCloseTo(140, 6);
      expect(Math.hypot(up.vx, up.vy)).toBeCloseTo(140, 6);
      // vy 永远不为 0：球不会沿着挡板平面横飞
      expect(Math.abs(down.vy)).toBeGreaterThan(0);
      expect(down.vy).toBeGreaterThan(0);
      expect(up.vy).toBeLessThan(0);
      expect(Math.sign(down.vx)).toBe(Math.sign(offset));
    }
    expect(bounceVelocity(0, 110, 1).vy).toBeCloseTo(110, 6);
    expect(bounceVelocity(0, 110, -1).vy).toBeCloseTo(-110, 6);
  });
});

describe("speedUp · 每回合加速", () => {
  it("每拍 +6%，逐拍复利", () => {
    expect(speedUp(BASE_SPEED, 0)).toBeCloseTo(110, 6);
    expect(speedUp(BASE_SPEED, 1)).toBeCloseTo(116.6, 6);
    expect(speedUp(BASE_SPEED, 2)).toBeCloseTo(110 * 1.06 * 1.06, 6);
    expect(speedUp(110, 1)).toBeGreaterThan(speedUp(110, 0));
  });

  it("封顶 260：无论打多少拍都不会超速", () => {
    expect(speedUp(BASE_SPEED, 20)).toBe(MAX_SPEED);
    expect(speedUp(BASE_SPEED, 1000)).toBe(MAX_SPEED);
    expect(speedUp(MAX_SPEED, 1)).toBe(MAX_SPEED);
  });

  it("异常输入不会返回 NaN", () => {
    // 速度非法时从初速算起，拍数照常应用。
    expect(speedUp(Number.NaN, 0)).toBeCloseTo(BASE_SPEED, 6);
    expect(speedUp(Number.NaN, 1)).toBeCloseTo(BASE_SPEED * 1.06, 6);
    expect(speedUp(BASE_SPEED, -5)).toBeCloseTo(BASE_SPEED, 6);
    expect(speedUp(BASE_SPEED, Number.NaN)).toBeCloseTo(BASE_SPEED, 6);
    expect(Number.isFinite(speedUp(Number.NaN, Number.NaN))).toBe(true);
  });
});

describe("clampPaddle · 挡板不出界", () => {
  it("轨道两端是 20..148（两侧各留半个挡板）", () => {
    expect(PADDLE_MIN).toBe(20);
    expect(PADDLE_MAX).toBe(148);
    expect(PADDLE_MIN).toBe(EDGE + PADDLE_HALF);
    expect(PADDLE_MAX).toBe(FIELD - EDGE - PADDLE_HALF);
  });

  it("越界值被夹回轨道", () => {
    expect(clampPaddle(-100)).toBe(PADDLE_MIN);
    expect(clampPaddle(0)).toBe(PADDLE_MIN);
    expect(clampPaddle(9999)).toBe(PADDLE_MAX);
    expect(clampPaddle(84)).toBe(84);
  });

  it("非有限值兜底到球场中心", () => {
    expect(clampPaddle(Number.NaN)).toBe(FIELD / 2);
    expect(clampPaddle(Number.POSITIVE_INFINITY)).toBe(FIELD / 2);
    expect(clampPaddle(Number.NEGATIVE_INFINITY)).toBe(FIELD / 2);
  });

  it("挡板矩形始终在侧墙之间", () => {
    for (const center of [-50, PADDLE_MIN, 84, PADDLE_MAX, 500]) {
      const rect = paddleRect(center, TOP_LINE);
      expect(rect.x).toBeGreaterThanOrEqual(BALL_MIN_X - BALL_R - PADDLE_HALF);
      expect(rect.x + rect.w).toBeLessThanOrEqual(FIELD - EDGE + 1);
      expect(rect.w).toBe(PADDLE_H);
    }
    expect(paddleSpan(84)).toEqual({ left: 70, right: 98 });
  });

  it("命中偏移归一化到 -1..1", () => {
    expect(hitOffset(84, 84)).toBe(0);
    expect(hitOffset(98, 84)).toBe(1);
    expect(hitOffset(70, 84)).toBe(-1);
    expect(hitOffset(200, 84)).toBe(1);
    expect(hitOffset(0, 84)).toBe(-1);
  });

  it("接球判定包含球半径，差一点点就接不到", () => {
    expect(catchesPaddle(84, 84)).toBe(true);
    expect(catchesPaddle(84 + PADDLE_HALF + BALL_R, 84)).toBe(true);
    expect(catchesPaddle(84 + PADDLE_HALF + BALL_R + 0.01, 84)).toBe(false);
    expect(catchesPaddle(84 + 14, 84)).toBe(true);
    expect(catchesPaddle(84 + 20, 84)).toBe(false);
  });
});

describe("serveAngle · 发球角度", () => {
  it("范围是 ±30°，且 rng 两端落在边界上", () => {
    expect(SERVE_SPREAD).toBeCloseTo(Math.PI / 6, 10);
    expect(serveAngle(() => 0)).toBeCloseTo(-SERVE_SPREAD, 10);
    expect(serveAngle(() => 1)).toBeCloseTo(SERVE_SPREAD, 10);
    expect(serveAngle(() => 0.5)).toBeCloseTo(0, 10);
  });

  it("任意种子下都落在 ±30° 之间，不会横着发球", () => {
    const rng = seeded(2020);
    for (let i = 0; i < 200; i += 1) {
      const angle = serveAngle(rng);
      expect(angle).toBeGreaterThanOrEqual(-SERVE_SPREAD - 1e-9);
      expect(angle).toBeLessThanOrEqual(SERVE_SPREAD + 1e-9);
      expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
    }
  });

  it("同一个种子跑出同一串角度", () => {
    const a = seeded(7);
    const b = seeded(7);
    const first = [serveAngle(a), serveAngle(a), serveAngle(a)];
    const second = [serveAngle(b), serveAngle(b), serveAngle(b)];
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(3);
  });
});

describe("AI 挡板 · 限速与反应延迟", () => {
  it("速度上限随等级提高，且任何等级都低于球速上限与玩家挡板", () => {
    expect(aiSpeed(1)).toBe(AI_MIN_SPEED);
    expect(aiSpeed(AI_MAX_LEVEL)).toBe(AI_MAX_SPEED);
    expect(aiSpeed(99)).toBe(AI_MAX_SPEED);
    expect(aiSpeed(0)).toBe(AI_MIN_SPEED);
    expect(AI_MAX_SPEED).toBeLessThan(MAX_SPEED);
    expect(AI_MAX_SPEED).toBeLessThan(PADDLE_SPEED);
    for (let lv = 1; lv <= AI_MAX_LEVEL; lv += 1) {
      expect(aiSpeed(lv)).toBeGreaterThanOrEqual(AI_MIN_SPEED);
      expect(aiSpeed(lv)).toBeLessThanOrEqual(AI_MAX_SPEED);
      if (lv < AI_MAX_LEVEL) expect(aiSpeed(lv)).toBeLessThan(aiSpeed(lv + 1));
    }
  });

  it("反应延迟始终大于 0，等级越高越短", () => {
    expect(aiReaction(1)).toBe(AI_MAX_REACTION);
    expect(aiReaction(AI_MAX_LEVEL)).toBe(AI_MIN_REACTION);
    expect(aiReaction(1)).toBeGreaterThan(aiReaction(AI_MAX_LEVEL));
    expect(aiReaction(AI_MAX_LEVEL)).toBeGreaterThan(0);
    expect(aiReaction(99)).toBe(aiReaction(AI_MAX_LEVEL));
    expect(aiReaction(0)).toBe(aiReaction(1));
  });

  it("一帧内位移不超过上限，绝不瞬移到目标", () => {
    const target = PADDLE_MAX;
    const oneFrame = aiStep(84, target, 16);
    expect(oneFrame).toBeCloseTo(84 + AI_MAX_SPEED * 0.016, 6);
    expect(oneFrame).toBeLessThan(target);

    // 放大到 1 秒：最多走 AI_MAX_SPEED 像素，仍可能到不了。
    const oneSecond = aiStep(84, target, 1000);
    expect(oneSecond).toBe(target);

    // dt 很小的时候几乎不动。
    expect(aiStep(84, target, 1)).toBeLessThan(84.5);
  });

  it("多帧后才能追到目标，且不会越过目标", () => {
    let center = 84;
    for (let i = 0; i < 200; i += 1) center = aiStep(center, PADDLE_MAX, 16);
    expect(center).toBe(PADDLE_MAX);

    let back = PADDLE_MAX;
    for (let i = 0; i < 200; i += 1) back = aiStep(back, PADDLE_MIN, 16);
    expect(back).toBe(PADDLE_MIN);
  });

  it("目标是界外值时按轨道夹住，dt 非法时不动", () => {
    expect(aiStep(84, 9999, 1000, 400)).toBe(PADDLE_MAX);
    expect(aiStep(84, -9999, 1000, 400)).toBe(PADDLE_MIN);
    expect(aiStep(84, PADDLE_MIN, 0)).toBe(84);
    expect(aiStep(84, PADDLE_MIN, Number.NaN)).toBe(84);
    expect(aiStep(84, PADDLE_MIN, 16, 0)).toBe(84);
  });

  it("球飞向玩家半场时回中线待命", () => {
    const falling = risingBall({ vy: 110 });
    expect(aiTarget(falling, 5)).toBe(FIELD / 2);
    expect(aiTarget(falling, 1)).toBe(FIELD / 2);
  });

  it("球飞向自己时按等级做不同距离的直线外推，且结果在轨道内", () => {
    const ball = risingBall({ x: 60, vx: 60, vy: -110 });
    // 直线外推：x + vx * lead，lead 随等级从 0.06s 增到 0.18s。
    const leadFor = (lv: number) => AI_MIN_LEAD + (lv - 1) * AI_LEAD_STEP;
    for (let lv = 1; lv <= AI_MAX_LEVEL; lv += 1) {
      const target = aiTarget(ball, lv);
      expect(target).toBeCloseTo(60 + 60 * leadFor(lv), 6);
      expect(target).toBeGreaterThanOrEqual(PADDLE_MIN);
      expect(target).toBeLessThanOrEqual(PADDLE_MAX);
    }
    // 等级越高看得越远，目标越靠右侧。
    expect(aiTarget(ball, AI_MAX_LEVEL)).toBeGreaterThan(aiTarget(ball, 1));
  });

  it("外推不预判侧墙反弹：贴墙斜线球会把 AI 带到轨道边界", () => {
    // 球在左上、向右上飞，直线外推会冲出右侧墙。
    const bankBall = risingBall({ x: 150, vx: 200, vy: -110 });
    expect(aiTarget(bankBall, AI_MAX_LEVEL)).toBe(PADDLE_MAX);
    // 换个方向同理。
    const leftBank = risingBall({ x: 20, vx: -200, vy: -110 });
    expect(aiTarget(leftBank, AI_MAX_LEVEL)).toBe(PADDLE_MIN);
  });

  it("预测落点函数会把侧墙反弹折回场内（供调试/测试使用）", () => {
    const wild = risingBall({ x: 150, vx: 240 });
    const landing = predictLandingX(wild);
    expect(landing).toBeGreaterThanOrEqual(BALL_MIN_X);
    expect(landing).toBeLessThanOrEqual(BALL_MAX_X);
    expect(foldX(BALL_MAX_X + 4)).toBeCloseTo(BALL_MAX_X - 4, 6);
  });

  it("预测落点会把侧墙反弹折回场内", () => {
    expect(foldX(BALL_MIN_X)).toBe(BALL_MIN_X);
    expect(foldX(BALL_MAX_X)).toBe(BALL_MAX_X);
    expect(foldX(BALL_MAX_X + 4)).toBeCloseTo(BALL_MAX_X - 4, 6);
    expect(foldX(BALL_MIN_X - 8)).toBeCloseTo(BALL_MIN_X + 8, 6);

    // 球心横坐标冲出侧墙时，预测值仍落在场内。
    const wild = risingBall({ x: 150, vx: 240 });
    const landing = predictLandingX(wild);
    expect(landing).toBeGreaterThanOrEqual(BALL_MIN_X);
    expect(landing).toBeLessThanOrEqual(BALL_MAX_X);
  });
});

describe("计分与判定", () => {
  it("scoreForRally：每拍 1 分，赢下这分再 +50", () => {
    expect(scoreForRally(0, false)).toBe(0);
    expect(scoreForRally(0, true)).toBe(WIN_BONUS);
    expect(scoreForRally(3, true)).toBe(3 + WIN_BONUS);
    expect(scoreForRally(4, false)).toBe(4);
    expect(scoreForRally(-2, true)).toBe(WIN_BONUS);
    expect(scoreForRally(2.9, false)).toBe(2);
    expect(scoreForRally(Number.NaN, true)).toBe(WIN_BONUS);
  });

  it("goalScored：越顶线玩家得分，越底线 AI 得分", () => {
    expect(goalScored({ y: 6 - BALL_R })).toBe("player");
    expect(goalScored({ y: 0 })).toBe("player");
    expect(goalScored({ y: 84 })).toBeNull();
    expect(goalScored({ y: BOTTOM_LINE + BALL_R })).toBe("ai");
    expect(goalScored({ y: FIELD + 10 })).toBe("ai");
    expect(goalScored({ y: BOTTOM_LINE })).toBeNull();
    expect(goalScored({ y: TOP_LINE })).toBeNull();
  });

  it("子步进保证高速球不穿板", () => {
    expect(substepsFor(0)).toBe(1);
    expect(substepsFor(-3)).toBe(1);
    expect(substepsFor(2.5)).toBe(1);
    expect(substepsFor(2.51)).toBe(2);
    expect(substepsFor(MAX_SPEED * 0.05)).toBeGreaterThanOrEqual(6);
  });
});

describe("触摸拖动与碰撞盒", () => {
  it("相对拖动：按下不瞬移，横移按灵敏度放大", () => {
    const anchor = dragAnchor(50, 60);
    expect(anchor.centerX).toBe(60);
    expect(dragTarget(anchor, 50)).toBe(60);
    expect(dragTarget(anchor, 70)).toBeCloseTo(60 + 20 * 1.4, 6);
    expect(dragTarget(anchor, 30)).toBeCloseTo(60 - 20 * 1.4, 6);
  });

  it("拖出轨道时夹住，灵敏度可覆盖", () => {
    const anchor = dragAnchor(84, 84);
    expect(dragTarget(anchor, -500)).toBe(PADDLE_MIN);
    expect(dragTarget(anchor, 500)).toBe(PADDLE_MAX);
    expect(dragTarget(anchor, 94, 2)).toBeCloseTo(104, 6);
    expect(dragTarget(anchor, Number.NaN)).toBe(84);
  });

  it("球按 4×4 的 AABB 处理，贴边不算命中", () => {
    expect(ballBox(10, 20)).toEqual({ x: 8, y: 18, w: 4, h: 4 });
    expect(overlap(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
    expect(overlap(box(0, 0, 10, 10), box(10, 0, 5, 5))).toBe(false);
    expect(overlap(box(0, 0, 10, 10), box(0, 10, 5, 5))).toBe(false);
  });
});
