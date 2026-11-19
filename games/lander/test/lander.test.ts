import { describe, expect, it } from "vitest";

import {
  FUEL_BURN_MS,
  FUEL_MAX,
  GOOD_ANGLE,
  GOOD_VY,
  GRAVITY,
  GROUND_Y,
  MIN_PAD_W,
  PERFECT_ANGLE,
  PERFECT_VY,
  ROUGH_ANGLE,
  ROUGH_VY,
  START_VX_MAX,
  START_VY,
  START_Y,
  THRUST,
  TURN_RATE,
  altitudeMeters,
  burnFuel,
  createShip,
  isOnPad,
  isOnRock,
  landingResult,
  landingScore,
  nearestPad,
  padCenter,
  startVelocity,
  stepShip,
  terrainFor,
  touchActionAt,
  wrapAngle,
  type ShipState,
  type Terrain,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一条地形。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 用一串固定值当随机源，把地形逼到指定分支。 */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe("物理常量 · 规格值", () => {
  it("重力 90、推力 170、转速 1.8 rad/s、地面 190、起点 30", () => {
    expect(GRAVITY).toBe(90);
    expect(THRUST).toBe(170);
    expect(TURN_RATE).toBe(1.8);
    expect(GROUND_Y).toBe(190);
    expect(START_Y).toBe(30);
  });

  it("燃料 100 单位，每 80ms 烧 1 单位", () => {
    expect(FUEL_MAX).toBe(100);
    expect(FUEL_BURN_MS).toBe(80);
  });

  it("初速 vy 固定 20，vx 落在 [-14, 14]", () => {
    expect(START_VY).toBe(20);
    expect(START_VX_MAX).toBe(14);
    expect(startVelocity(() => 0).vx).toBe(-14);
    expect(startVelocity(() => 0.999999).vx).toBeCloseTo(14, 1);
    expect(startVelocity(() => 0.5).vx).toBeCloseTo(0, 5);
    expect(startVelocity(() => 0.5).vy).toBe(20);
  });
});

describe("landingResult · 四档边界", () => {
  it("零速零倾角是 perfect，阈值为 |vy| <= 32 且 |angle| <= 0.10", () => {
    expect(landingResult(0, 0)).toBe("perfect");
    expect(landingResult(PERFECT_VY, PERFECT_ANGLE)).toBe("perfect");
    expect(landingResult(-PERFECT_VY, -PERFECT_ANGLE)).toBe("perfect");
  });

  it("速度或角度任一越过 perfect 线就掉到 good", () => {
    expect(landingResult(PERFECT_VY + 0.001, 0)).toBe("good");
    expect(landingResult(0, PERFECT_ANGLE + 0.001)).toBe("good");
  });

  it("good 阈值为 |vy| <= 58 且 |angle| <= 0.22", () => {
    expect(landingResult(GOOD_VY, GOOD_ANGLE)).toBe("good");
    expect(landingResult(GOOD_VY + 0.001, 0)).toBe("rough");
    expect(landingResult(0, GOOD_ANGLE + 0.001)).toBe("rough");
  });

  it("rough 阈值为 |vy| <= 92 且 |angle| <= 0.42，越界即 crash", () => {
    expect(landingResult(ROUGH_VY, ROUGH_ANGLE)).toBe("rough");
    expect(landingResult(ROUGH_VY + 0.001, 0)).toBe("crash");
    expect(landingResult(0, ROUGH_ANGLE + 0.001)).toBe("crash");
  });

  it("撞到岩石一律 crash，哪怕速度倾角都完美", () => {
    expect(landingResult(0, 0, true)).toBe("crash");
    expect(landingResult(1, 0.01, true)).toBe("crash");
  });

  it("角度按整圈归一化：2PI 等价于 0，2PI + 0.5 等价于 0.5", () => {
    expect(landingResult(0, Math.PI * 2)).toBe("perfect");
    expect(landingResult(0, Math.PI * 2 + 0.5)).toBe(landingResult(0, 0.5));
    expect(landingResult(0, -Math.PI * 2 - 0.5)).toBe(landingResult(0, -0.5));
  });
});

describe("wrapAngle", () => {
  it("收进 (-PI, PI]，整圈不变", () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0, 10);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 10);
    expect(wrapAngle(-Math.PI * 3 - 0.2)).toBeCloseTo(Math.PI - 0.2, 10);
  });
});

describe("landingScore · 燃料加成", () => {
  it("基础分 300 / 200 / 100 / 0，crash 一律不给分", () => {
    // drift = 0 时漂移加成是满额 +200，所以这里减掉它只看基础分。
    const base = (verdict: "perfect" | "good" | "rough" | "crash"): number =>
      landingScore(verdict, 0, 0) - (verdict === "crash" ? 0 : 200);
    expect(base("perfect")).toBe(300);
    expect(base("good")).toBe(200);
    expect(base("rough")).toBe(100);
    expect(landingScore("crash", 0, 0)).toBe(0);
    expect(landingScore("crash", 100, 0)).toBe(0);
  });

  it("燃料越多分越高，且严格单调（每 1 单位 +4）", () => {
    expect(landingScore("perfect", 50, 0) - landingScore("perfect", 49, 0)).toBe(4);
    expect(landingScore("good", 100, 0)).toBeGreaterThan(landingScore("good", 20, 0));
    expect(landingScore("perfect", 100, 0)).toBe(300 + 400 + 200);
  });

  it("燃料夹在 [0, 100]，负数与超量都不越界", () => {
    expect(landingScore("perfect", -50, 0)).toBe(300 + 200);
    expect(landingScore("perfect", 500, 0)).toBe(300 + 400 + 200);
  });

  it("水平漂移越大分越低，超过 100 封底为 0 加成", () => {
    expect(landingScore("perfect", 0, 0)).toBe(300 + 200);
    expect(landingScore("perfect", 0, 50)).toBe(300 + 100);
    expect(landingScore("perfect", 0, 100)).toBe(300);
    expect(landingScore("perfect", 0, 400)).toBe(300);
    // 漂移只看绝对值
    expect(landingScore("perfect", 0, -50)).toBe(landingScore("perfect", 0, 50));
  });
});

describe("burnFuel", () => {
  it("不推进不掉油", () => {
    expect(burnFuel(80, false, 1000)).toBe(80);
    expect(burnFuel(80, false, 0)).toBe(80);
  });

  it("推进时按 dt / 80ms 消耗", () => {
    expect(burnFuel(100, true, FUEL_BURN_MS)).toBe(99);
    expect(burnFuel(100, true, FUEL_BURN_MS * 10)).toBe(90);
    expect(burnFuel(100, true, FUEL_BURN_MS / 2)).toBe(99.5);
    expect(burnFuel(100, true, 0)).toBe(100);
  });

  it("始终夹在 [0, 100]，烧穿了也是 0", () => {
    expect(burnFuel(1, true, FUEL_BURN_MS * 1000)).toBe(0);
    expect(burnFuel(-30, true, 0)).toBe(0);
    expect(burnFuel(150, false, 0)).toBe(FUEL_MAX);
  });
});

describe("altitudeMeters", () => {
  it("贴地是 0，越高数值越大", () => {
    expect(altitudeMeters(GROUND_Y)).toBe(0);
    expect(altitudeMeters(GROUND_Y + 20)).toBe(0);
    expect(altitudeMeters(GROUND_Y - 20)).toBe(10);
    expect(altitudeMeters(START_Y)).toBe(80);
  });
});

describe("terrainFor · 同种子同地形", () => {
  it("同一个种子生成完全一致的地形", () => {
    const a = terrainFor(seeded(7));
    const b = terrainFor(seeded(7));
    expect(a).toEqual(b);
    expect(terrainFor(seeded(8))).not.toEqual(a);
  });

  it("每条着陆带宽度都 >= 34px（规格硬性要求）", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const terrain = terrainFor(seeded(seed));
      expect(terrain.pads.length).toBeGreaterThan(0);
      for (const pad of terrain.pads) {
        expect(pad.w).toBeGreaterThanOrEqual(MIN_PAD_W);
      }
    }
  });

  it("地形铺满整个宽度，且着陆带与岩石不重叠", () => {
    const terrain = terrainFor(seeded(3));
    const span = 168;

    const covered = [...terrain.pads, ...terrain.rocks]
      .slice()
      .sort((l, r) => l.x - r.x)
      .reduce((sum, part) => sum + part.w, 0);
    expect(covered).toBe(span);

    for (const pad of terrain.pads) {
      for (const rock of terrain.rocks) {
        const overlap = Math.min(pad.x + pad.w, rock.x + rock.w) - Math.max(pad.x, rock.x);
        expect(overlap).toBeLessThanOrEqual(0);
      }
    }
  });

  it("极值随机源（全 0 / 全 0.999999）也不会生出窄着陆带", () => {
    for (const rand of [sequence([0]), sequence([0.999999])]) {
      const terrain = terrainFor(rand);
      expect(terrain.pads.length).toBeGreaterThan(0);
      for (const pad of terrain.pads) expect(pad.w).toBeGreaterThanOrEqual(MIN_PAD_W);
    }
  });
});

describe("isOnPad / isOnRock · 落点判定", () => {
  const terrain: Terrain = {
    pads: [{ x: 40, w: 40 }],
    rocks: [
      { x: 0, w: 40 },
      { x: 80, w: 88 },
    ],
  };

  it("着陆带内（含左右端点）算落上停机坪", () => {
    expect(isOnPad(40, terrain.pads)).toBe(true);
    expect(isOnPad(60, terrain.pads)).toBe(true);
    expect(isOnPad(80, terrain.pads)).toBe(true);
  });

  it("着陆带外算岩石", () => {
    expect(isOnPad(39.9, terrain.pads)).toBe(false);
    expect(isOnPad(80.1, terrain.pads)).toBe(false);
    expect(isOnRock(20, terrain)).toBe(true);
    expect(isOnRock(120, terrain)).toBe(true);
    expect(isOnRock(60, terrain)).toBe(false);
  });

  it("没有着陆带时任何落点都不算着陆", () => {
    expect(isOnPad(60, [])).toBe(false);
    expect(isOnPad(Number.NaN, terrain.pads)).toBe(false);
  });
});

describe("nearestPad / padCenter", () => {
  it("padCenter 取中点，nearestPad 取最近的着陆带", () => {
    const pads = [
      { x: 10, w: 40 },
      { x: 100, w: 40 },
    ];
    expect(padCenter(pads[0]!)).toBe(30);
    expect(nearestPad(20, pads)).toEqual(pads[0]);
    expect(nearestPad(130, pads)).toEqual(pads[1]);
    expect(nearestPad(70, pads)).toEqual(pads[0]);
  });

  it("没有着陆带时返回 null", () => {
    expect(nearestPad(50, [])).toBeNull();
  });
});

describe("stepShip · 积分与边界", () => {
  it("不点火时只受重力，1 秒后 vy 增加 GRAVITY", () => {
    const ship: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    stepShip(ship, 1000, false, 0);
    expect(ship.vy).toBeCloseTo(GRAVITY, 5);
    expect(ship.vx).toBeCloseTo(0, 5);
    // 半隐式欧拉：先更新速度再用新速度位移，所以这一秒走的是 vy * 1s。
    expect(ship.y).toBeCloseTo(100 + GRAVITY, 5);
  });

  it("dt 是毫秒：传 1000 和传 1 的加速度差 1000 倍", () => {
    const second: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    stepShip(second, 1000, false, 0);

    const milli: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    stepShip(milli, 1, false, 0);

    expect(second.vy / milli.vy).toBeCloseTo(1000, 6);
  });

  it("机头朝上点火时竖直方向是减速的（重力 - 推力）", () => {
    const ship: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    stepShip(ship, 1000, true, 0);
    expect(ship.vy).toBeCloseTo(GRAVITY - THRUST, 5);
  });

  it("左右输入按 TURN_RATE 转，1 秒转 1.8 rad（turn = 0 不转）", () => {
    const ship: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    stepShip(ship, 1000, false, 1);
    expect(ship.angle).toBeCloseTo(TURN_RATE, 5);

    const other: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    stepShip(other, 1000, false, -1);
    expect(other.angle).toBeCloseTo(-TURN_RATE, 5);

    const idle: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0.3 };
    stepShip(idle, 1000, false, 0);
    expect(idle.angle).toBeCloseTo(0.3, 6);
  });

  it("旋转按 dt 线性累加：100 个 10ms 步长与 1 个 1000ms 步长转角相同", () => {
    const coarse: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    stepShip(coarse, 1000, false, 1);

    const fine: ShipState = { x: 84, y: 100, vx: 0, vy: 0, angle: 0 };
    for (let i = 0; i < 100; i += 1) stepShip(fine, 10, false, 1);

    expect(fine.angle).toBeCloseTo(coarse.angle, 6);
  });

  it("撞到左右边界时夹住并清零横向速度", () => {
    const left: ShipState = { x: 6, y: 100, vx: -400, vy: 0, angle: 0 };
    stepShip(left, 1000, false, 0);
    expect(left.x).toBe(5.5);
    expect(left.vx).toBe(0);

    const right: ShipState = { x: 162, y: 100, vx: 400, vy: 0, angle: 0 };
    stepShip(right, 1000, false, 0);
    expect(right.x).toBe(162.5);
    expect(right.vx).toBe(0);
  });

  it("飞不出画面顶部，顶到天花板后上升速度被清零", () => {
    const ship: ShipState = { x: 84, y: 20, vx: 0, vy: -500, angle: 0 };
    stepShip(ship, 1000, false, 0);
    expect(ship.y).toBe(8);
    expect(ship.vy).toBe(0);
  });
});

describe("createShip · 起始状态", () => {
  it("起点 y = 30、倾角 0，横向速度由随机源决定", () => {
    const ship = createShip(84, () => 0.5);
    expect(ship.y).toBe(START_Y);
    expect(ship.angle).toBe(0);
    expect(ship.vy).toBe(START_VY);
    expect(ship.x).toBe(84);
    expect(ship.vx).toBeCloseTo(0, 6);
  });
});

describe("touchActionAt · 画布内触屏按钮", () => {
  it("三个按钮各命中自己的动作，按钮之间的空隙返回 null", () => {
    expect(touchActionAt(10, 200)).toBe("left");
    expect(touchActionAt(80, 200)).toBe("thrust");
    expect(touchActionAt(140, 200)).toBe("right");
    expect(touchActionAt(56, 200)).toBeNull();
    expect(touchActionAt(84, 100)).toBeNull();
  });
});
