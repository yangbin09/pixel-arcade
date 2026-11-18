import { describe, expect, it } from "vitest";

import {
  DRAG_SENSITIVITY,
  GRAZE_POINTS,
  H,
  MAX_DROPS,
  MAX_METEORS,
  MAX_PARTICLES,
  MAX_SHIELDS,
  MAX_TICKS,
  ROUND_MS,
  SHIELD_BONUS,
  W,
  circleRectOverlap,
  clampShipX,
  clampShipY,
  createMeteorPool,
  createParticlePool,
  createShieldPool,
  hitsShip,
  isGraze,
  meteorRadius,
  meteorSpeedAt,
  pointRectDistance,
  scoreFor,
  spawnIntervalAt,
  speedStageFor,
  stepParticles,
  survivalTicksFor,
  touchDragAnchor,
  touchDragTarget,
} from "../src/logic";

describe("陨石雨 · 难度曲线", () => {
  it("陨石速度从 60 线性升到 160 px/s", () => {
    expect(meteorSpeedAt(0)).toBeCloseTo(60);
    expect(meteorSpeedAt(ROUND_MS / 2)).toBeCloseTo(110);
    expect(meteorSpeedAt(ROUND_MS)).toBeCloseTo(160);
  });

  it("超出 45 秒后速度不再增长", () => {
    expect(meteorSpeedAt(-5000)).toBeCloseTo(60);
    expect(meteorSpeedAt(ROUND_MS * 2)).toBeCloseTo(160);
  });

  it("刷怪间隔从 560ms 收到 260ms", () => {
    expect(spawnIntervalAt(0)).toBeCloseTo(560);
    expect(spawnIntervalAt(ROUND_MS / 2)).toBeCloseTo(410);
    expect(spawnIntervalAt(ROUND_MS)).toBeCloseTo(260);
    expect(spawnIntervalAt(ROUND_MS + 9000)).toBeCloseTo(260);
  });

  it("每 15 秒进入下一段速度阶段", () => {
    expect(speedStageFor(0)).toBe(0);
    expect(speedStageFor(14_999)).toBe(0);
    expect(speedStageFor(15_000)).toBe(1);
    expect(speedStageFor(29_999)).toBe(1);
    expect(speedStageFor(30_000)).toBe(2);
    expect(speedStageFor(ROUND_MS)).toBe(2);
  });

  it("陨石直径落在 5–11px", () => {
    expect(meteorRadius(() => 0)).toBe(2.5);
    expect(meteorRadius(() => 0.5)).toBe(4);
    expect(meteorRadius(() => 0.999999)).toBe(5.5);
    expect(meteorRadius(() => 1)).toBe(5.5);
  });
});

describe("陨石雨 · 生存计分", () => {
  it("每 100ms 存活 +2，45 秒合计 900 分", () => {
    expect(survivalTicksFor(-1)).toBe(0);
    expect(survivalTicksFor(99)).toBe(0);
    expect(survivalTicksFor(100)).toBe(1);
    expect(survivalTicksFor(ROUND_MS / 2)).toBe(MAX_TICKS / 2);
    expect(survivalTicksFor(ROUND_MS)).toBe(MAX_TICKS);
    expect(survivalTicksFor(ROUND_MS + 8000)).toBe(MAX_TICKS);
    expect(scoreFor(MAX_TICKS, 0, 0)).toBe(900);
  });

  it("擦身 +15，未用护盾每个 +30", () => {
    expect(scoreFor(0, 1, 0)).toBe(GRAZE_POINTS);
    expect(scoreFor(0, 0, 1)).toBe(SHIELD_BONUS);
    expect(scoreFor(MAX_TICKS, 4, MAX_SHIELDS)).toBe(900 + 60 + 90);
  });

  it("参数越界会被夹住，不会出现负分", () => {
    expect(scoreFor(-10, -5, -2)).toBe(0);
    expect(scoreFor(99_999, 0, 0)).toBe(900);
    expect(scoreFor(0, 0, 99)).toBe(MAX_SHIELDS * SHIELD_BONUS);
  });
});

describe("陨石雨 · 碰撞", () => {
  it("点到矩形的距离：内部为 0，外部取最短边", () => {
    expect(pointRectDistance(5, 5, 3, 4, 10, 10)).toBe(0);
    expect(pointRectDistance(0, 0, 3, 4, 10, 10)).toBe(5);
    expect(pointRectDistance(20, 5, 3, 4, 10, 10)).toBe(7);
  });

  it("圆与矩形相交", () => {
    expect(circleRectOverlap(5, 5, 1, 0, 0, 10, 10)).toBe(true);
    expect(circleRectOverlap(11.5, 5, 2, 0, 0, 10, 10)).toBe(true);
    expect(circleRectOverlap(12.5, 5, 2, 0, 0, 10, 10)).toBe(false);
    expect(circleRectOverlap(15, 15, 4, 0, 0, 10, 10)).toBe(false);
  });

  it("命中飞船的 7×7 命中箱", () => {
    // 飞船中心 (84,100)，命中箱 x:80.5–87.5 / y:96.5–103.5
    expect(hitsShip(84, 100, 2.5, 84, 100)).toBe(true);
    expect(hitsShip(84, 95, 2.5, 84, 100)).toBe(true);
    expect(hitsShip(88, 100, 2.5, 84, 100)).toBe(true);
    expect(hitsShip(92, 100, 2.5, 84, 100)).toBe(false);
    expect(hitsShip(84, 92, 2.5, 84, 100)).toBe(false);
  });

  it("擦身：边缘距离小于 6px 且未命中", () => {
    // 飞船中心 (84,100)，整机轮廓 y:95.5–104.5
    expect(isGraze(84, 90, 3, 84, 100)).toBe(true);
    expect(isGraze(84, 86, 3, 84, 100)).toBe(false);
    expect(isGraze(84, 100, 3, 84, 100)).toBe(false);
    expect(isGraze(84, 94, 3, 84, 100)).toBe(false);
    // 斜角擦身
    expect(isGraze(75, 91, 3, 84, 100)).toBe(true);
  });

  it("飞船位置被限制在场地内", () => {
    expect(clampShipX(-100)).toBe(5);
    expect(clampShipX(W + 100)).toBe(W - 5);
    expect(clampShipY(-100)).toBe(8);
    expect(clampShipY(H + 100)).toBe(H - 8);
  });
});

describe("陨石雨 · 对象池", () => {
  it("池子上限固定，初始全部回收", () => {
    const meteors = createMeteorPool();
    const particles = createParticlePool();
    const drops = createShieldPool();
    expect(meteors).toHaveLength(MAX_METEORS);
    expect(particles).toHaveLength(MAX_PARTICLES);
    expect(drops).toHaveLength(MAX_DROPS);
    expect(meteors.every((m) => !m.alive)).toBe(true);
    expect(particles.every((p) => !p.alive)).toBe(true);
    expect(drops.every((d) => !d.alive)).toBe(true);
  });

  it("粒子寿命递减，归零后回收", () => {
    const particles = createParticlePool();
    const p = particles[0]!;
    p.alive = true;
    p.life = 100;
    p.max = 100;
    p.x = 0;
    p.y = 0;
    p.vx = 100;
    p.vy = 0;

    stepParticles(particles, 16);
    expect(p.x).toBeCloseTo(1.6);
    expect(p.life).toBe(84);
    expect(p.alive).toBe(true);

    stepParticles(particles, 100);
    expect(p.alive).toBe(false);
  });
});

describe("陨石雨 · 触摸相对拖动", () => {
  it("灵敏度为 1.15", () => {
    expect(DRAG_SENSITIVITY).toBeCloseTo(1.15);
  });

  it("正向拖动按灵敏度放大位移", () => {
    const anchor = touchDragAnchor(50, 40, 84, 100);
    const target = touchDragTarget(anchor, 70, 60);

    expect(target.x).toBeCloseTo(84 + 20 * 1.15);
    expect(target.y).toBeCloseTo(100 + 20 * 1.15);
  });

  it("反向拖动同样按灵敏度放大", () => {
    const anchor = touchDragAnchor(50, 40, 84, 100);
    const target = touchDragTarget(anchor, 30, 20);

    expect(target.x).toBeCloseTo(84 - 20 * 1.15);
    expect(target.y).toBeCloseTo(100 - 20 * 1.15);
  });

  it("拖出场地时夹在飞船活动范围内", () => {
    const anchor = touchDragAnchor(84, 100, 84, 100);

    const upLeft = touchDragTarget(anchor, -500, -500);
    expect(upLeft).toEqual({ x: clampShipX(-500), y: clampShipY(-500) });

    const downRight = touchDragTarget(anchor, 500, 500);
    expect(downRight).toEqual({ x: clampShipX(500), y: clampShipY(500) });
  });

  it("手指离飞船很远按下时不会瞬移，零位移保持原位", () => {
    const anchor = touchDragAnchor(20, 20, 84, 100);

    expect(touchDragTarget(anchor, 20, 20)).toEqual({ x: 84, y: 100 });
    // 灵敏度可以显式覆盖，位移按传入值缩放。
    expect(touchDragTarget(anchor, 30, 20, 1.5)).toEqual({ x: 84 + 10 * 1.5, y: 100 });
  });
});
