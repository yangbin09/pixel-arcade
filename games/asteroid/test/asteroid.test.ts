import { describe, expect, it } from "vitest";

import {
  ASTEROID_RADIUS,
  ASTEROID_SCORE,
  ASTEROID_SPEED_MAX,
  BULLET_MS,
  BULLET_SPEED,
  FIRE_COOLDOWN_MS,
  H,
  INVULN_MS,
  MAX_SHIP_SPEED,
  SHIP_R,
  START_LIVES,
  THRUST,
  TURN_RATE,
  W,
  asteroidSpeed,
  bulletVelocity,
  circleHit,
  clampSpeed,
  makeAsteroid,
  normalizeAngle,
  scoreForSize,
  shipVelocity,
  spawnCount,
  splitAsteroid,
  turnAngle,
  wrapDelta,
  wrapDistance,
  wrapX,
  wrapY,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一串数（和 core 的 mulberry32 无关）。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("规格常量", () => {
  it("转向 3.6 rad/s、推力 110、速度上限 160、子弹 240px/s", () => {
    expect(TURN_RATE).toBe(3.6);
    expect(THRUST).toBe(110);
    expect(MAX_SHIP_SPEED).toBe(160);
    expect(BULLET_SPEED).toBe(240);
    expect(BULLET_MS).toBe(700);
    expect(FIRE_COOLDOWN_MS).toBe(180);
    expect(INVULN_MS).toBe(1200);
    expect(START_LIVES).toBe(3);
  });

  it("场地宽 168、高 210，飞船判定半径收窄到 4", () => {
    expect(W).toBe(168);
    expect(H).toBe(210);
    expect(SHIP_R).toBe(4);
  });
});

describe("wrapX / wrapY · 屏幕环绕", () => {
  it("x 出界从对面回来", () => {
    expect(wrapX(W + 5)).toBe(5);
    expect(wrapX(168)).toBe(0);
    expect(wrapX(170)).toBe(2);
    expect(wrapX(W / 2)).toBe(W / 2);
  });

  it("负值也能环绕到 [0, W)", () => {
    expect(wrapX(-5)).toBe(163);
    expect(wrapX(-168)).toBe(0);
    expect(wrapX(-170)).toBe(166);
  });

  it("y 环绕与 x 同一套规则，用高度 H", () => {
    expect(wrapY(H + 12)).toBe(12);
    expect(wrapY(-3)).toBe(H - 3);
    expect(wrapY(0)).toBe(0);
  });

  it("非有限值兜底为 0，不会把 NaN 传进画面", () => {
    expect(wrapX(Number.NaN)).toBe(0);
    expect(wrapY(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("wrapDelta / wrapDistance · 跨接缝几何", () => {
  it("跨接缝的最短位移比直线短", () => {
    expect(wrapDelta(2, 166, W)).toBe(4);
    expect(wrapDelta(166, 2, W)).toBe(-4);
    expect(wrapDelta(3, 3, W)).toBe(0);
  });

  it("跨接缝的两点只隔 4px", () => {
    expect(wrapDistance(2, 100, 166, 100)).toBeCloseTo(4, 5);
    expect(wrapDistance(10, 10, 10, 10)).toBe(0);
  });

  it("circleHit 在接缝两侧也算命中", () => {
    expect(circleHit(2, 100, 3, 166, 100, 3)).toBe(true);
    expect(circleHit(80, 100, 3, 20, 100, 3)).toBe(false);
  });
});

describe("splitAsteroid · 三档分裂", () => {
  it("large → medium，medium → small，small 不再分裂", () => {
    expect(splitAsteroid("large")).toBe("medium");
    expect(splitAsteroid("medium")).toBe("small");
    expect(splitAsteroid("small")).toBeNull();
  });
});

describe("scoreForSize · 越碎越值钱", () => {
  it("20 / 50 / 100 且严格递增", () => {
    expect(scoreForSize("large")).toBe(20);
    expect(scoreForSize("medium")).toBe(50);
    expect(scoreForSize("small")).toBe(100);
    expect(scoreForSize("large")).toBeLessThan(scoreForSize("medium"));
    expect(scoreForSize("medium")).toBeLessThan(scoreForSize("small"));
  });

  it("半径与得分表对得上规格", () => {
    expect(ASTEROID_RADIUS).toEqual({ large: 16, medium: 10, small: 6 });
    expect(ASTEROID_SCORE.small).toBeGreaterThan(ASTEROID_SCORE.large);
  });
});

describe("spawnCount / asteroidSpeed · 波次曲线", () => {
  it("每波 6 + wave 颗", () => {
    expect(spawnCount(1)).toBe(7);
    expect(spawnCount(5)).toBe(11);
    expect(spawnCount(0)).toBe(7);
  });

  it("速度 36 + wave*6 并在 90 封顶", () => {
    expect(asteroidSpeed(1)).toBe(42);
    expect(asteroidSpeed(2)).toBe(48);
    expect(asteroidSpeed(9)).toBe(ASTEROID_SPEED_MAX);
    expect(asteroidSpeed(30)).toBe(ASTEROID_SPEED_MAX);
    expect(asteroidSpeed(1)).toBeLessThan(asteroidSpeed(2));
  });
});

describe("shipVelocity · 无摩擦惯性", () => {
  it("不推进时原样保持速度（惯性漂流）", () => {
    const keep = shipVelocity(0, false, 16, { vx: 100, vy: -40 });
    expect(keep).toEqual({ vx: 100, vy: -40 });
    const keepLong = shipVelocity(1.2, false, 5000, { vx: 12, vy: 34 });
    expect(keepLong.vx).toBeCloseTo(12, 6);
    expect(keepLong.vy).toBeCloseTo(34, 6);
  });

  it("推进 1 秒沿朝向累加 110px/s²", () => {
    const up = shipVelocity(-Math.PI / 2, true, 1000);
    expect(up.vx).toBeCloseTo(0, 6);
    expect(up.vy).toBeCloseTo(-110, 6);
  });

  it("速度上限夹到 160，方向保持不变", () => {
    const fast = shipVelocity(0, true, 1000, { vx: 150, vy: 0 });
    expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(MAX_SHIP_SPEED, 6);
    expect(fast.vx).toBeGreaterThan(0);
    expect(fast.vy).toBeCloseTo(0, 6);
  });

  it("dt 是毫秒：16ms 的一帧只加约 1.76px/s", () => {
    const one = shipVelocity(0, true, 16);
    expect(one.vx).toBeCloseTo((THRUST * 16) / 1000, 6);
    const half = shipVelocity(0, true, 8);
    expect(half.vx).toBeCloseTo(one.vx / 2, 6);
  });

  it("clampSpeed 只缩不转", () => {
    const clamped = clampSpeed(300, 400);
    expect(Math.hypot(clamped.vx, clamped.vy)).toBeCloseTo(MAX_SHIP_SPEED, 6);
    expect(clamped.vx / clamped.vy).toBeCloseTo(300 / 400, 6);
    expect(clampSpeed(10, -10)).toEqual({ vx: 10, vy: -10 });
  });
});

describe("turnAngle · 左右转向", () => {
  it("右转 1 秒 = +3.6 rad，左转方向相反", () => {
    expect(turnAngle(0, 1, 1000)).toBeCloseTo(TURN_RATE, 6);
    expect(turnAngle(0, -1, 1000)).toBeCloseTo(Math.PI * 2 - TURN_RATE, 6);
    expect(turnAngle(0.5, 0, 1000)).toBeCloseTo(0.5, 6);
  });

  it("角度归一化到 [0, 2π)", () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((Math.PI * 3) / 2, 6);
    expect(normalizeAngle(Math.PI * 2)).toBe(0);
    const spun = turnAngle(0, 1, 3000);
    expect(spun).toBeGreaterThanOrEqual(0);
    expect(spun).toBeLessThan(Math.PI * 2);
  });
});

describe("bulletVelocity · 子弹继承飞船速度", () => {
  it("朝 X 正方向：240 + 飞船 vx 的一半", () => {
    const shot = bulletVelocity(0, 120, 40);
    expect(shot.vx).toBeCloseTo(BULLET_SPEED + 60, 6);
    expect(shot.vy).toBeCloseTo(20, 6);
  });

  it("朝向 -90° 时笔直向上，不受水平分量污染", () => {
    const shot = bulletVelocity(-Math.PI / 2, 0, 0);
    expect(shot.vx).toBeCloseTo(0, 6);
    expect(shot.vy).toBeCloseTo(-BULLET_SPEED, 6);
  });
});

describe("makeAsteroid · 同种子同结果 + 安全落点", () => {
  it("注入同一个随机源就得到同一颗陨石", () => {
    const a = makeAsteroid("medium", seeded(7), 40);
    const b = makeAsteroid("medium", seeded(7), 40);
    expect(a).toEqual(b);
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(40, 6);
  });

  it("落点被推离飞船至少 SAFE_SPAWN_DIST + 半径", () => {
    // rng 恒为 0.5 → 正中，正好压在飞船身上，必须被推开。
    const rock = makeAsteroid("large", () => 0.5, 40, W / 2, H / 2);
    const distance = wrapDistance(rock.x, rock.y, W / 2, H / 2);
    expect(distance).toBeGreaterThanOrEqual(46 + ASTEROID_RADIUS.large - 0.001);
    expect(rock.x).toBeGreaterThanOrEqual(0);
    expect(rock.x).toBeLessThan(W);
  });
});
