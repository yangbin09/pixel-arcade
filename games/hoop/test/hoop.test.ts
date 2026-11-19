import { describe, expect, it } from "vitest";

import {
  ANGLE_DEG,
  BALLS_PER_ROUND,
  COMBO_HOT,
  GRAVITY,
  MAX_SUBSTEP_MS,
  ORIGIN,
  POWER_PERIOD_MS,
  RIM,
  RIM_MARGIN,
  RIM_POINTS,
  ROUND_MS,
  SPEED_MAX,
  SPEED_MIN,
  SWISH_POINTS,
  comboAfter,
  crossingX,
  inRim,
  isSwish,
  makeKind,
  makePowerWindow,
  minSpeedToReach,
  powerFromHold,
  rimCrossX,
  scoreFor,
  shoot,
  speedFromPower,
  stepBall,
  swishPowerWindow,
  type Ball,
  type Rim,
} from "../src/logic";

/* ---------------- 测试辅助 ---------------- */

/** 让球从出手点飞到手感平面附近，返回穿过筐口平面的那一帧。 */
function flyToRim(power: number, dtMs = 1): Ball {
  const ball = shoot(ORIGIN, power);
  for (let i = 0; i < 20000; i += 1) {
    stepBall(ball, dtMs);
    // stepBall 会把上一帧位置写进 prevX/prevY，所以这里能判断「这一帧穿过了筐口平面」。
    if (ball.prevY <= RIM.y && ball.y >= RIM.y) return ball;
    if (ball.y > 260) break;
  }
  return ball;
}

/** 穿筐口那一刻的横坐标；没穿过就是 NaN。 */
function crossAt(power: number, dtMs = 1): number {
  return rimCrossX(flyToRim(power, dtMs), RIM);
}

/**
 * 造一个「本帧正好向下穿过筐口平面」的球。
 *
 * 让 prevY = rim.y - 2、y = rim.y + 2，则插值系数 t = 0.5，
 * 于是 crossX = (prevX + x) / 2 —— 给定落点就能反解出坐标，
 * 筐口边界因此可以被精确地测到像素级。
 */
function ballCrossing(crossX: number, rim: Rim = RIM): Ball {
  const prevY = rim.y - 2;
  const y = rim.y + 2;
  const prevX = 120;
  return { x: 2 * crossX - prevX, y, vx: 200, vy: 300, prevX, prevY };
}

describe("常量与规则锚点", () => {
  it("抛射角固定 62°、每轮十球、60 秒、重力 640", () => {
    expect(ANGLE_DEG).toBe(62);
    expect(BALLS_PER_ROUND).toBe(10);
    expect(ROUND_MS).toBe(60_000);
    expect(GRAVITY).toBe(640);
    expect(COMBO_HOT).toBe(3);
  });

  it("筐口几何：x=132、y=96、宽 26", () => {
    expect(RIM).toEqual({ x: 132, y: 96, w: 26 });
  });

  it("初速 250..430，重力 640 下筐口平面可达", () => {
    expect(SPEED_MIN).toBe(250);
    expect(SPEED_MAX).toBe(430);
    // 顶点刚好够到筐口平面所需的初速必须落在映射区间内，否则整条力度条都没有意义。
    expect(minSpeedToReach(RIM.y)).toBeGreaterThan(SPEED_MIN);
    expect(minSpeedToReach(RIM.y)).toBeLessThan(SPEED_MAX);
  });
});

describe("powerFromHold · 力度周期 1100ms", () => {
  it("0 / 半周期 / 整周期：0 → 1 → 0", () => {
    expect(powerFromHold(0)).toBeCloseTo(0, 6);
    expect(powerFromHold(POWER_PERIOD_MS / 2)).toBeCloseTo(1, 6);
    expect(powerFromHold(POWER_PERIOD_MS)).toBeCloseTo(0, 6);
    expect(powerFromHold(POWER_PERIOD_MS * 2)).toBeCloseTo(0, 6);
  });

  it("按住很久也只在 0..1 之间来回，并周期性回归", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let ms = 0; ms <= POWER_PERIOD_MS * 5; ms += 5) {
      const power = powerFromHold(ms);
      expect(power).toBeGreaterThanOrEqual(0);
      expect(power).toBeLessThanOrEqual(1);
      min = Math.min(min, power);
      max = Math.max(max, power);
    }
    expect(min).toBeCloseTo(0, 3);
    expect(max).toBeCloseTo(1, 3);

    // 任意按住时长 + n 个整周期，力度完全一样。
    for (const ms of [0, 137, 275, 550, 811, 1099]) {
      expect(powerFromHold(ms + POWER_PERIOD_MS * 3)).toBeCloseTo(powerFromHold(ms), 6);
    }
  });

  it("三角波：前半程上升、后半程下降，且左右对称", () => {
    expect(powerFromHold(POWER_PERIOD_MS / 4)).toBeCloseTo(0.5, 6);
    expect(powerFromHold((POWER_PERIOD_MS * 3) / 4)).toBeCloseTo(0.5, 6);
    for (const ms of [50, 120, 275, 400, 500]) {
      expect(powerFromHold(ms)).toBeCloseTo(powerFromHold(POWER_PERIOD_MS - ms), 6);
    }
    // 上升段确实单调增。
    let previous = -1;
    for (let ms = 0; ms <= POWER_PERIOD_MS / 2; ms += 25) {
      const power = powerFromHold(ms);
      expect(power).toBeGreaterThanOrEqual(previous);
      previous = power;
    }
  });

  it("非法输入（负数 / NaN）按 0 处理", () => {
    expect(powerFromHold(-100)).toBe(0);
    expect(powerFromHold(Number.NaN)).toBe(0);
    expect(powerFromHold(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("speedFromPower · 250..430", () => {
  it("两个端点精确映射到 250 和 430", () => {
    expect(speedFromPower(0)).toBeCloseTo(SPEED_MIN, 6);
    expect(speedFromPower(1)).toBeCloseTo(SPEED_MAX, 6);
    expect(speedFromPower(0.5)).toBeCloseTo(340, 6);
  });

  it("线性且单调：越界夹住，不退化成 NaN", () => {
    for (let p = 0; p <= 1; p += 0.05) {
      expect(speedFromPower(p)).toBeCloseTo(SPEED_MIN + p * (SPEED_MAX - SPEED_MIN), 6);
    }
    expect(speedFromPower(-2)).toBe(SPEED_MIN);
    expect(speedFromPower(3)).toBe(SPEED_MAX);
    expect(speedFromPower(Number.NaN)).toBe(SPEED_MIN);
  });
});

describe("shoot · 固定 62°", () => {
  it("速度大小等于力度映射值，方向朝右上", () => {
    for (const power of [0, 0.3, 0.65, 1]) {
      const ball = shoot(ORIGIN, power);
      const speed = Math.hypot(ball.vx, ball.vy);
      expect(speed).toBeCloseTo(speedFromPower(power), 6);
      expect(ball.vx).toBeGreaterThan(0);
      expect(ball.vy).toBeLessThan(0);
      // 仰角 = atan2(-vy, vx) 必须是 62°。
      expect((Math.atan2(-ball.vy, ball.vx) * 180) / Math.PI).toBeCloseTo(62, 6);
    }
  });

  it("从出手点 (30,170) 出发，prev 同步初始化", () => {
    const ball = shoot(ORIGIN, 0.65);
    expect(ball).toMatchObject({ x: 30, y: 170, prevX: 30, prevY: 170 });
  });
});

describe("stepBall · 抛物线积分", () => {
  it("重力按 dt 累加到 vy，x 按 vx 匀速前进", () => {
    const ball = shoot(ORIGIN, 0.65);
    const { vx } = ball;
    stepBall(ball, 100);
    expect(ball.vy).toBeCloseTo(-Math.sin((62 * Math.PI) / 180) * speedFromPower(0.65) + GRAVITY * 0.1, 2);
    expect(ball.x).toBeCloseTo(ORIGIN.x + vx * 0.1, 3);
    expect(ball.y).toBeLessThan(ORIGIN.y);
  });

  it("记录上一帧位置，供筐口插值使用", () => {
    const ball = shoot(ORIGIN, 0.65);
    stepBall(ball, 16);
    const first = { x: ball.x, y: ball.y };
    stepBall(ball, 16);
    expect(ball.prevX).toBeCloseTo(first.x, 9);
    expect(ball.prevY).toBeCloseTo(first.y, 9);
  });

  it("50ms 大帧被拆成子步：落点与 1ms 小帧相差不到 1.5px", () => {
    // 引擎的 dt 上限就是 50ms，这里直接按最坏情况验证。
    const coarse = crossAt(0.65, 50);
    const fine = crossAt(0.65, 1);
    expect(Number.isNaN(coarse)).toBe(false);
    expect(Number.isNaN(fine)).toBe(false);
    expect(Math.abs(coarse - fine)).toBeLessThan(1.5);

    // 也要和解析解对得上，确保积分没有偷偷漂移。
    expect(Math.abs(fine - crossingX(0.65))).toBeLessThan(1.5);
    expect(MAX_SUBSTEP_MS).toBeLessThanOrEqual(5);
  });

  it("50ms 步长下不会穿透筐口判定（不跳帧）", () => {
    // 逐步长扫描：每个步长都必须判定为进球，而不是时中时不中。
    for (const dt of [1, 4, 8, 16, 33, 50]) {
      const ball = flyToRim(0.65, dt);
      expect(inRim(ball, RIM)).toBe(true);
      expect(makeKind(ball, RIM)).toBe("swish");
    }
  });

  it("整段飞行不出现 NaN，且最终落到地板以下", () => {
    const ball = shoot(ORIGIN, 1);
    for (let i = 0; i < 200; i += 1) stepBall(ball, 50);
    expect(Number.isFinite(ball.x)).toBe(true);
    expect(Number.isFinite(ball.y)).toBe(true);
    expect(ball.y).toBeGreaterThan(196);
  });

  it("dt=0 不推进位置", () => {
    const ball = shoot(ORIGIN, 0.65);
    stepBall(ball, 0);
    expect(ball.x).toBe(ORIGIN.x);
    expect(ball.y).toBe(ORIGIN.y);
  });
});

describe("inRim · 筐口边界", () => {
  it("左沿 / 右沿正好压线算进，越界 0.05px 就不算", () => {
    expect(inRim(ballCrossing(RIM.x), RIM)).toBe(true);
    expect(inRim(ballCrossing(RIM.x - 0.05), RIM)).toBe(false);
    expect(inRim(ballCrossing(RIM.x + RIM.w), RIM)).toBe(true);
    expect(inRim(ballCrossing(RIM.x + RIM.w + 0.05), RIM)).toBe(false);
  });

  it("筐口正中稳定命中，筐外两侧都不算", () => {
    const center = RIM.x + RIM.w / 2;
    expect(inRim(ballCrossing(center), RIM)).toBe(true);
    expect(inRim(ballCrossing(RIM.x - 20), RIM)).toBe(false);
    expect(inRim(ballCrossing(RIM.x + RIM.w + 20), RIM)).toBe(false);
  });

  it("只有向下穿过筐口平面才算，向上穿过不算", () => {
    const rising: Ball = {
      x: 145,
      y: RIM.y - 2,
      prevX: 145,
      prevY: RIM.y + 2,
      vx: 200,
      vy: -300,
    };
    expect(inRim(rising, RIM)).toBe(false);
    expect(Number.isNaN(rimCrossX(rising, RIM))).toBe(true);
  });

  it("本帧完全没穿过筐口平面时返回 NaN / false", () => {
    const above: Ball = { x: 145, y: RIM.y - 5, prevX: 145, prevY: RIM.y - 9, vx: 200, vy: 300 };
    const below: Ball = { x: 145, y: RIM.y + 9, prevX: 145, prevY: RIM.y + 5, vx: 200, vy: 300 };
    expect(Number.isNaN(rimCrossX(above, RIM))).toBe(true);
    expect(Number.isNaN(rimCrossX(below, RIM))).toBe(true);
    expect(inRim(above, RIM)).toBe(false);
    expect(inRim(below, RIM)).toBe(false);
  });
});

describe("isSwish / makeKind · 空心 vs 擦筐", () => {
  it("筐口正中是空心", () => {
    const center = RIM.x + RIM.w / 2;
    const ball = ballCrossing(center);
    expect(isSwish(ball, RIM)).toBe(true);
    expect(makeKind(ball, RIM)).toBe("swish");
  });

  it("贴着筐沿进（余量 < 4px）算擦筐，不是空心", () => {
    const nearLeft = ballCrossing(RIM.x + RIM_MARGIN - 0.5);
    const nearRight = ballCrossing(RIM.x + RIM.w - RIM_MARGIN + 0.5);
    for (const ball of [nearLeft, nearRight]) {
      expect(inRim(ball, RIM)).toBe(true);
      expect(isSwish(ball, RIM)).toBe(false);
      expect(makeKind(ball, RIM)).toBe("rim");
    }
  });

  it("空心区间正好是筐口内缩 4px 的那一段", () => {
    expect(isSwish(ballCrossing(RIM.x + RIM_MARGIN), RIM)).toBe(true);
    expect(isSwish(ballCrossing(RIM.x + RIM_MARGIN - 0.05), RIM)).toBe(false);
    expect(isSwish(ballCrossing(RIM.x + RIM.w - RIM_MARGIN), RIM)).toBe(true);
    expect(isSwish(ballCrossing(RIM.x + RIM.w - RIM_MARGIN + 0.05), RIM)).toBe(false);
  });

  it("两种进球由真实抛体飞行也能复现（空心与擦筐各一例）", () => {
    // 0.65 落在空心区间中部。
    expect(makeKind(flyToRim(0.65), RIM)).toBe("swish");
    // 0.70 落在右侧擦筐带（空心窗口的上沿之外）。
    expect(makeKind(flyToRim(0.70), RIM)).toBe("rim");
  });
});

describe("计分与连击", () => {
  it("空心 +15、擦筐进 +10、不进 0", () => {
    expect(scoreFor("swish")).toBe(15);
    expect(scoreFor("rim")).toBe(10);
    expect(scoreFor("miss")).toBe(0);
    expect(SWISH_POINTS).toBe(15);
    expect(RIM_POINTS).toBe(10);
  });

  it("连击：空心 +1，擦筐进不涨，不进清零", () => {
    expect(comboAfter("swish", 0)).toBe(1);
    expect(comboAfter("swish", 4)).toBe(5);
    expect(comboAfter("rim", 4)).toBe(4);
    expect(comboAfter("miss", 4)).toBe(0);
    expect(comboAfter("miss", 0)).toBe(0);
  });

  it("只有连续空心才会跨到冒火线（3 连）", () => {
    let combo = 0;
    combo = comboAfter("swish", combo);
    combo = comboAfter("swish", combo);
    expect(combo).toBe(2);
    expect(combo).toBeLessThan(COMBO_HOT);
    combo = comboAfter("swish", combo);
    expect(combo).toBe(3);
    expect(combo).toBeGreaterThanOrEqual(COMBO_HOT);

    // 擦筐进会卡住连击，不会自己涨到冒火。
    let stalled = 2;
    for (let i = 0; i < 5; i += 1) stalled = comboAfter("rim", stalled);
    expect(stalled).toBe(2);
  });

  it("非法连击值按 0 处理", () => {
    expect(comboAfter("swish", Number.NaN)).toBe(1);
    expect(comboAfter("swish", -3)).toBe(1);
    expect(comboAfter("rim", -3)).toBe(0);
  });
});

describe("命中窗口 · 锁死可玩性修正", () => {
  it("能进球的力度窗口是 0.60..0.71，且空心窗口嵌在里面", () => {
    const make = makePowerWindow(RIM);
    const swish = swishPowerWindow(RIM);
    expect(make.low).toBeGreaterThan(0.55);
    expect(make.low).toBeLessThan(0.65);
    expect(make.high).toBeGreaterThan(0.68);
    expect(make.high).toBeLessThan(0.76);
    expect(make.high).toBeGreaterThan(make.low);

    // 空心区间必须是命中区间的子集。
    expect(swish.low).toBeGreaterThanOrEqual(make.low);
    expect(swish.high).toBeLessThanOrEqual(make.high);
    expect(swish.high).toBeGreaterThan(swish.low);
  });

  it("0.62 / 0.70 都进，0.5 和 0.9 都空球", () => {
    for (const power of [0.62, 0.70]) {
      expect(inRim(flyToRim(power), RIM)).toBe(true);
    }
    for (const power of [0.5, 0.9]) {
      expect(inRim(flyToRim(power), RIM)).toBe(false);
      expect(makeKind(flyToRim(power), RIM)).toBe("miss");
    }
  });

  it("窗口内的力度都命中，窗口外两侧都落空（单调过的远度）", () => {
    const make = makePowerWindow(RIM);
    for (const power of [make.low + 0.005, (make.low + make.high) / 2, make.high - 0.005]) {
      expect(inRim(flyToRim(power), RIM)).toBe(true);
    }
    // 力度不足：顶点都够不到筐口平面。
    expect(Number.isNaN(crossingX(make.low - 0.15))).toBe(true);
    // 力度过大：远远飞过筐。
    expect(crossingX(make.high + 0.15)).toBeGreaterThan(RIM.x + RIM.w + 10);
  });
});
