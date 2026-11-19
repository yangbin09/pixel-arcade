import { describe, expect, it } from "vitest";

import {
  BASE_TOP,
  BLOCK_H,
  CAMERA_LINE,
  CAMERA_THRESHOLD,
  COMBO_POINTS,
  DROP_Y,
  GROUND_Y,
  H,
  LAYER_POINTS,
  MAX_SWING_RANGE,
  MAX_WIDTH,
  PERFECT_REFUND,
  PERFECT_TOLERANCE,
  SPEED_MAX,
  SPEED_START,
  START_WIDTH,
  W,
  cameraFor,
  cropOverlap,
  isCollapsed,
  isPerfect,
  railCenterX,
  railRange,
  refundWidth,
  scoreForFloor,
  speedForFloor,
  spawnPhase,
  swingRangeFor,
  swingX,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一串数。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("常量契约", () => {
  it("尺寸、首块、容差、回赠、速度区间都对得上规格", () => {
    expect(START_WIDTH).toBe(96);
    expect(MAX_WIDTH).toBe(96);
    expect(BLOCK_H).toBe(14);
    expect(PERFECT_TOLERANCE).toBe(3);
    expect(PERFECT_REFUND).toBe(4);
    expect(SPEED_START).toBeCloseTo(1.6, 6);
    expect(SPEED_MAX).toBeCloseTo(4.2, 6);
    expect(W).toBe(168);
    expect(H).toBe(210);
    // 塔从底部 (0, 178) 开始：178 是首块底边，也就是地面。
    expect(GROUND_Y).toBe(178);
    expect(BASE_TOP).toBe(GROUND_Y - BLOCK_H);
    expect(BASE_TOP).toBe(164);
  });
});

describe("cropOverlap · 裁剪区间", () => {
  it("左偏：保留右半段，左边缘是上一块的左边", () => {
    // 上一块 [40, 136)，新块左移 10px → [30, 126)。
    const crop = cropOverlap(40, 96, 30, 96);

    expect(crop.x).toBe(40);
    expect(crop.w).toBe(86);
    expect(crop.offset).toBe(-10);
    expect(crop.cuts).toEqual([{ x: 30, w: 10 }]);
    expect(crop.x + crop.w).toBe(126);
    expect(isCollapsed(crop)).toBe(false);
  });

  it("右偏：保留左半段，右边缘是上一块的右边", () => {
    // 上一块 [40, 136)，新块右移 12px → [52, 148)。
    const crop = cropOverlap(40, 96, 52, 96);

    expect(crop.x).toBe(52);
    expect(crop.w).toBe(84);
    expect(crop.offset).toBe(12);
    expect(crop.cuts).toEqual([{ x: 136, w: 12 }]);
  });

  it("完全包含：没有偏移也没有碎块，宽度不变", () => {
    // 窄块落在宽块正中。
    const crop = cropOverlap(20, 96, 40, 56);

    expect(crop.x).toBe(40);
    expect(crop.w).toBe(56);
    expect(crop.offset).toBe(0);
    expect(crop.cuts).toEqual([]);
    expect(isPerfect(crop.offset)).toBe(true);
  });

  it("包含且同宽同位置：整块保留，碎块为空", () => {
    const crop = cropOverlap(40, 96, 40, 96);

    expect(crop.x).toBe(40);
    expect(crop.w).toBe(96);
    expect(crop.offset).toBe(0);
    expect(crop.cuts).toEqual([]);
  });

  it("窄块骑在左边缘：左边被切掉一块", () => {
    // 上一块 [40, 136) 中心 88，新块窄到 40、落在 [20, 60) 中心 40。
    const crop = cropOverlap(40, 96, 20, 40);

    expect(crop.x).toBe(40);
    expect(crop.w).toBe(20);
    expect(crop.offset).toBe(-48);
    expect(crop.cuts).toEqual([{ x: 20, w: 20 }]);
  });

  it("完全错开：重叠为 0，整块都是碎块，判定为塌", () => {
    const crop = cropOverlap(40, 96, 140, 20);

    expect(crop.w).toBe(0);
    expect(crop.cuts).toEqual([{ x: 140, w: 20 }]);
    expect(isCollapsed(crop)).toBe(true);
    expect(cropOverlap(40, 96, 136, 20).w).toBe(0);
  });

  it("擦边相接 0 像素也算塌", () => {
    // 上一块右边缘在 136，新块正好从 136 开始。
    expect(isCollapsed(cropOverlap(40, 96, 136, 30))).toBe(true);
    // 再挪回 1px 就活下来。
    const crop = cropOverlap(40, 96, 135, 30);
    expect(crop.w).toBe(1);
    expect(isCollapsed(crop)).toBe(false);
  });
});

describe("isPerfect · 3px 容差边界", () => {
  it("±3 以内算完美，±4 就不算", () => {
    expect(isPerfect(0)).toBe(true);
    expect(isPerfect(3)).toBe(true);
    expect(isPerfect(-3)).toBe(true);
    expect(isPerfect(2.999)).toBe(true);
    expect(isPerfect(4)).toBe(false);
    expect(isPerfect(-4)).toBe(false);
    expect(isPerfect(-3.001)).toBe(false);
  });

  it("裁剪出的偏移直接喂给判定：左偏 3 完美、左偏 4 不完美", () => {
    const inside = cropOverlap(40, 96, 37, 96);
    const outside = cropOverlap(40, 96, 36, 96);

    expect(inside.offset).toBe(-3);
    expect(isPerfect(inside.offset)).toBe(true);
    expect(outside.offset).toBe(-4);
    expect(isPerfect(outside.offset)).toBe(false);
  });
});

describe("refundWidth · 完美回赠", () => {
  it("每次 +4，天花板是 96", () => {
    expect(refundWidth(20)).toBe(24);
    expect(refundWidth(92)).toBe(96);
    expect(refundWidth(95)).toBe(96);
    expect(refundWidth(96)).toBe(96);
    expect(refundWidth(120)).toBe(96);
  });

  it("完美若干次能从很窄的块长满到 96", () => {
    let width = 40;
    for (let i = 0; i < 20; i += 1) width = refundWidth(width);
    expect(width).toBe(96);
  });
});

describe("scoreForFloor · 计分公式", () => {
  it("每层 10 + 连击 × 5", () => {
    expect(LAYER_POINTS).toBe(10);
    expect(COMBO_POINTS).toBe(5);
    expect(scoreForFloor(0, 0)).toBe(10);
    expect(scoreForFloor(1, 1)).toBe(15);
    expect(scoreForFloor(5, 4)).toBe(30);
    expect(scoreForFloor(30, 12)).toBe(70);
  });

  it("连击取整、负数与非法值退回底分", () => {
    expect(scoreForFloor(3, 2.9)).toBe(20);
    expect(scoreForFloor(3, -5)).toBe(10);
    expect(scoreForFloor(Number.NaN, Number.NaN)).toBe(10);
  });

  it("一整轮完美连击的总分累加正确", () => {
    let total = 0;
    for (let combo = 1; combo <= 4; combo += 1) total += scoreForFloor(combo, combo);

    expect(total).toBe(15 + 20 + 25 + 30);
  });
});

describe("速度曲线", () => {
  it("第 0 层是 1.6，随后单调不减，封顶 4.2", () => {
    expect(speedForFloor(0)).toBeCloseTo(1.6, 6);
    expect(speedForFloor(1)).toBeGreaterThan(speedForFloor(0));

    let previous = speedForFloor(0);
    for (let floor = 1; floor <= 40; floor += 1) {
      const speed = speedForFloor(floor);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }

    expect(speedForFloor(20)).toBeCloseTo(4.2, 6);
    expect(speedForFloor(40)).toBeCloseTo(4.2, 6);
    expect(speedForFloor(9999)).toBeCloseTo(4.2, 6);
  });

  it("时刻 0 的角速度最高，所以堆得越高摆得越快", () => {
    expect(speedForFloor(0)).toBeLessThan(speedForFloor(10));
    expect(speedForFloor(10)).toBeLessThan(speedForFloor(20));
  });
});

describe("swingX · 摆动不越界", () => {
  it("位移恒在 ±range 之内，并且真的能走到两端", () => {
    const range = 44;
    let lowest = Infinity;
    let highest = -Infinity;

    for (let step = 0; step <= 2000; step += 1) {
      const value = swingX(step * 0.01, 2.4, range);
      expect(Math.abs(value)).toBeLessThanOrEqual(range + 1e-9);
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }

    expect(lowest).toBeLessThan(-range + 0.01);
    expect(highest).toBeGreaterThan(range - 0.01);
  });

  it("四分之一周期到最高点，半周期回中，四分之三周期到最低点", () => {
    const speed = 2;
    const range = 30;
    const period = (Math.PI * 2) / speed;

    expect(swingX(0, speed, range)).toBeCloseTo(0, 6);
    expect(swingX(period / 4, speed, range)).toBeCloseTo(range, 6);
    expect(swingX(period / 2, speed, range)).toBeCloseTo(0, 6);
    expect(swingX((period * 3) / 4, speed, range)).toBeCloseTo(-range, 6);
  });

  it("range 为 0 或非法时不产生位移", () => {
    expect(swingX(12, 3, 0)).toBe(0);
    expect(swingX(12, 0, 40)).toBe(0);
    expect(swingX(Number.NaN, 3, 40)).toBe(0);
  });

  it("摆动加中心永远落在画布内", () => {
    for (const width of [96, 80, 60, 40, 24, 12, 6]) {
      const center = railCenterX(width);
      const range = swingRangeFor(width);
      expect(range).toBeLessThanOrEqual(railRange(width) + 1e-9);
      expect(range).toBeLessThanOrEqual(MAX_SWING_RANGE + 1e-9);

      for (let step = 0; step <= 720; step += 1) {
        const x = center + swingX(step * 0.02, 4.2, range);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(W);
      }
    }
  });

  it("96px 的首块摆动半径等于场地对称余量", () => {
    expect(railCenterX(96)).toBeCloseTo((W - 96) / 2, 6);
    expect(railRange(96)).toBeCloseTo((W - 96) / 2 - 2, 6);
    expect(swingRangeFor(96)).toBeLessThanOrEqual(MAX_SWING_RANGE);
  });
});

describe("cameraFor · 摄像机不倒退", () => {
  it("塔高 100px 以内不动，超过之后才开始跟随", () => {
    const lowTop = BASE_TOP - CAMERA_THRESHOLD;
    expect(CAMERA_LINE).toBe(lowTop);
    expect(cameraFor(BASE_TOP)).toBe(0);
    expect(cameraFor(BASE_TOP - 50)).toBe(0);
    expect(cameraFor(lowTop)).toBe(0);
    expect(cameraFor(lowTop - 1)).toBe(1);
    expect(cameraFor(lowTop - 60)).toBe(60);
  });

  it("塔越堆越高，返回值单调不减", () => {
    let previous = cameraFor(BASE_TOP);
    for (let floor = 0; floor <= 60; floor += 1) {
      const shift = cameraFor(BASE_TOP - floor * BLOCK_H);
      expect(shift).toBeGreaterThanOrEqual(previous);
      previous = shift;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("返回后塔顶永远停在 CAMERA_LINE，不会高过它", () => {
    for (let floor = 0; floor <= 40; floor += 1) {
      const top = BASE_TOP - floor * BLOCK_H;
      const shift = cameraFor(top);
      expect(top + shift).toBeGreaterThanOrEqual(CAMERA_LINE);
      // 低于阈值时塔顶就在原处，不会平白被推下去。
      if (top >= CAMERA_LINE) expect(top + shift).toBe(top);
    }
  });

  it("非法输入退回「不动」", () => {
    expect(cameraFor(Number.NaN)).toBe(0);
    expect(cameraFor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("spawnPhase · 随机相位", () => {
  it("落在 0–2π 之间", () => {
    const rng = seeded(2024);
    for (let i = 0; i < 200; i += 1) {
      const phase = spawnPhase(rng);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2 + 1e-9);
    }
  });

  it("同一个种子得到同一串相位，极端值也不越界", () => {
    const a = seeded(7);
    const b = seeded(7);
    for (let i = 0; i < 20; i += 1) expect(spawnPhase(a)).toBe(spawnPhase(b));

    expect(spawnPhase(() => 0)).toBe(0);
    expect(spawnPhase(() => 1)).toBeLessThan(Math.PI * 2);
    expect(spawnPhase(() => 5)).toBeLessThan(Math.PI * 2);
  });
});

describe("playthrough · 用纯逻辑跑一局", () => {
  it("连续完美 12 层：塔变高、相机跟上、分数累加", () => {
    let width = START_WIDTH;
    let x = Math.round((W - width) / 2);
    let top = BASE_TOP;
    let camera = 0;
    let score = 0;

    for (let floor = 1; floor <= 12; floor += 1) {
      // 完美对齐：偏移 0。
      const crop = cropOverlap(x, width, x, width);
      expect(isPerfect(crop.offset)).toBe(true);
      expect(isCollapsed(crop)).toBe(false);

      width = refundWidth(crop.w);
      x = Math.round(crop.x + crop.w - width);
      score += scoreForFloor(floor, floor);

      const nextTop = top - BLOCK_H;
      const nextCamera = cameraFor(nextTop);
      expect(nextCamera).toBeGreaterThanOrEqual(camera);

      camera = nextCamera;
      top = nextTop;
    }

    expect(width).toBe(96);
    expect(score).toBe(
      Array.from({ length: 12 }, (_, i) => scoreForFloor(i + 1, i + 1)).reduce((a, b) => a + b, 0),
    );
    // 12 层 × 14px = 168px，超过 100px 阈值，相机必须已经在跟。
    expect(camera).toBeGreaterThan(0);
    expect(top + camera).toBe(CAMERA_LINE);
  });

  it("偏移一路变大时宽度单调变窄，最后一块会落空", () => {
    let width = START_WIDTH;
    let x = Math.round((W - width) / 2);
    let floor = 0;

    for (let step = 0; step < 40; step += 1) {
      const landing = x + 6; // 每层右偏 6px
      const crop = cropOverlap(x, width, landing, width);

      if (isCollapsed(crop)) {
        expect(step).toBeGreaterThan(5);
        break;
      }

      width = Math.round(crop.w);
      x = crop.x;
      floor += 1;
      expect(width).toBeLessThanOrEqual(START_WIDTH);
    }

    expect(width).toBeLessThan(START_WIDTH);
    expect(floor).toBeGreaterThan(0);
  });
});

describe("摆放常量", () => {
  it("新块悬停高度在塔顶之上，且留在画面内", () => {
    expect(DROP_Y).toBeGreaterThan(0);
    expect(DROP_Y).toBeLessThan(BASE_TOP);
    expect(DROP_Y + BLOCK_H).toBeLessThan(BASE_TOP);
  });

  it("地面在画面内，首块底边正好压在地面上", () => {
    expect(GROUND_Y).toBeLessThan(H);
    expect(GROUND_Y).toBeGreaterThan(H * 0.6);
    expect(BASE_TOP + BLOCK_H).toBe(GROUND_Y);
  });
});
