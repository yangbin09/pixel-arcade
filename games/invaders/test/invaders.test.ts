import { describe, expect, it } from "vitest";

import {
  DRAG_SENSITIVITY,
  ENEMY_COLS,
  ENEMY_MARGIN,
  ENEMY_ROWS,
  ENEMY_START_Y,
  ENEMY_STEP_X,
  ENEMY_STEP_Y,
  FIELD_W,
  FORMATION_MAX_X,
  FORMATION_MIN_X,
  FORMATION_RIGHT,
  MARCH_SPEED_BASE,
  SHIP_MARGIN,
  SHIP_W,
  START_LIVES,
  WAVE_COUNT,
  accuracy,
  clampShipX,
  enemyScore,
  enemyX,
  enemyY,
  marchStep,
  sweptHit,
  touchDragAnchor,
  touchDragTarget,
  waveFireInterval,
  waveSpeed,
  type MarchState,
} from "../src/logic";

/** 编队测试用状态。 */
function makeMarch(offset = 0, dir: -1 | 1 = 1): MarchState {
  return { offset, dir };
}

describe("波次 · 难度曲线", () => {
  it("第一波速度是基准值", () => {
    expect(waveSpeed(1)).toBeCloseTo(MARCH_SPEED_BASE, 5);
  });

  it("每波 +15%，五波严格递增", () => {
    expect(waveSpeed(2)).toBeCloseTo(MARCH_SPEED_BASE * 1.15, 5);

    for (let wave = 2; wave <= WAVE_COUNT; wave += 1) {
      expect(waveSpeed(wave)).toBeGreaterThan(waveSpeed(wave - 1));
    }
  });

  it("波次小于 1 时按第一波处理", () => {
    expect(waveSpeed(0)).toBe(waveSpeed(1));
    expect(waveSpeed(-3)).toBe(waveSpeed(1));
  });

  it("投弹间隔从 1.2s 递减到 0.5s", () => {
    expect(waveFireInterval(1)).toBe(1200);
    expect(waveFireInterval(2)).toBe(1025);
    expect(waveFireInterval(WAVE_COUNT)).toBe(500);
    expect(waveFireInterval(WAVE_COUNT + 3)).toBe(500);
    expect(waveFireInterval(0)).toBe(1200);
  });

  it("敌机分值按行 30/20/20/10", () => {
    expect([0, 1, 2, 3].map((row) => enemyScore(row))).toEqual([30, 20, 20, 10]);
    expect(enemyScore(9)).toBe(10);
  });

  it("五波、三条命是固定配置", () => {
    expect(WAVE_COUNT).toBe(5);
    expect(START_LIVES).toBe(3);
  });
});

describe("编队 · 几何与行进", () => {
  it("4 行 × 6 列", () => {
    expect(ENEMY_ROWS).toBe(4);
    expect(ENEMY_COLS).toBe(6);
    expect(ENEMY_ROWS * ENEMY_COLS).toBe(24);
  });

  it("敌机按行列均匀排开", () => {
    expect(enemyX(0, 0)).toBe(21);
    expect(enemyX(5, 0) - enemyX(0, 0)).toBe(ENEMY_STEP_X * 5);
    expect(enemyY(0, 0)).toBe(ENEMY_START_Y);
    expect(enemyY(3, 0) - enemyY(0, 0)).toBe(ENEMY_STEP_Y * 3);
  });

  it("编队偏移到两端时仍留出 4px", () => {
    expect(FORMATION_MIN_X + enemyX(0, 0)).toBe(ENEMY_MARGIN);
    expect(FORMATION_MAX_X + FORMATION_RIGHT).toBe(FIELD_W - ENEMY_MARGIN);
  });

  it("中间移动不触发下压", () => {
    const state = makeMarch();
    expect(marchStep(state, 5)).toBe(false);
    expect(state.offset).toBeCloseTo(5, 5);
    expect(state.dir).toBe(1);
  });

  it("撞到右边界：夹住、反向、下压", () => {
    const state = makeMarch(FORMATION_MAX_X - 1, 1);
    expect(marchStep(state, 4)).toBe(true);
    expect(state.offset).toBe(FORMATION_MAX_X);
    expect(state.dir).toBe(-1);
  });

  it("撞到左边界：夹住、反向、下压", () => {
    const state = makeMarch(FORMATION_MIN_X + 1, -1);
    expect(marchStep(state, 4)).toBe(true);
    expect(state.offset).toBe(FORMATION_MIN_X);
    expect(state.dir).toBe(1);
  });

  it("刚被夹到边界后往回走，不再连续下压", () => {
    const state = makeMarch(FORMATION_MIN_X, 1);
    expect(marchStep(state, 2)).toBe(false);
    expect(state.offset).toBeGreaterThan(FORMATION_MIN_X);
  });

  it("零步长或非法边界时原地不动", () => {
    const idle = makeMarch(3, 1);
    expect(marchStep(idle, 0)).toBe(false);
    expect(idle).toEqual({ offset: 3, dir: 1 });

    const invalid = makeMarch(3, -1);
    expect(marchStep(invalid, 2, 10, 10)).toBe(false);
    expect(invalid).toEqual({ offset: 3, dir: -1 });
  });
});

describe("碰撞 · 扫掠命中", () => {
  it("正对敌机时命中", () => {
    // 敌机左上角 (25, 40)，子弹 x=30 从 y=50 飞到 y=44。
    expect(sweptHit(30, 50, 44, 25, 40)).toBe(true);
  });

  it("x 不在敌机宽度内时不命中", () => {
    expect(sweptHit(40, 50, 48, 25, 40)).toBe(false);
    expect(sweptHit(24, 50, 48, 25, 40)).toBe(false);
    expect(sweptHit(36, 50, 48, 25, 40)).toBe(false);
  });

  it("一帧跨过整架敌机也能命中（防穿透）", () => {
    // 终点在敌机上方，但扫过的路径穿过了 y=40..47。
    expect(sweptHit(30, 60, 30, 25, 40)).toBe(true);
  });

  it("从敌机下方掠过时不命中", () => {
    expect(sweptHit(30, 70, 60, 25, 40)).toBe(false);
  });

  it("命中判定考虑子弹自身高度", () => {
    // 子弹顶到敌机下沿（敌机 40..47，子弹 44..48）。
    expect(sweptHit(30, 44, 44, 25, 40)).toBe(true);
  });

  it("可以拿同一套判定检查玩家飞船", () => {
    const ship = sweptHit(80, 180, 188, 79, 194, SHIP_W, 7, 4);
    expect(ship).toBe(false);
    expect(sweptHit(80, 190, 196, 79, 194, SHIP_W, 7, 4)).toBe(true);
  });
});

describe("玩家 · 边界与统计", () => {
  it("飞船中心被夹在左右安全区内", () => {
    expect(clampShipX(-20)).toBe(SHIP_MARGIN);
    expect(clampShipX(999)).toBe(FIELD_W - SHIP_MARGIN);
    expect(clampShipX(84)).toBe(84);
  });

  it("飞船任何位置都不会画出画布", () => {
    const left = Math.round(clampShipX(-20) - SHIP_W / 2);
    const right = Math.round(clampShipX(999) - SHIP_W / 2);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right + SHIP_W).toBeLessThanOrEqual(FIELD_W);
  });

  it("命中率四舍五入，零发射时是 0", () => {
    expect(accuracy(0, 0)).toBe(0);
    expect(accuracy(0, 5)).toBe(0);
    expect(accuracy(3, 4)).toBe(75);
    expect(accuracy(1, 3)).toBe(33);
  });
});

describe("玩家 · 触摸相对拖动", () => {
  it("灵敏度为 1.2", () => {
    expect(DRAG_SENSITIVITY).toBeCloseTo(1.2);
  });

  it("正向拖动按灵敏度放大位移", () => {
    const anchor = touchDragAnchor(50, 84);
    expect(touchDragTarget(anchor, 70)).toBeCloseTo(84 + 20 * 1.2);
  });

  it("反向拖动同样按灵敏度放大", () => {
    const anchor = touchDragAnchor(50, 84);
    expect(touchDragTarget(anchor, 30)).toBeCloseTo(84 - 20 * 1.2);
  });

  it("拖出场地时夹在左右安全区", () => {
    const anchor = touchDragAnchor(84, 84);
    expect(touchDragTarget(anchor, -500)).toBe(SHIP_MARGIN);
    expect(touchDragTarget(anchor, 500)).toBe(FIELD_W - SHIP_MARGIN);
  });

  it("手指离飞船很远按下时不会瞬移，零位移保持原位", () => {
    const anchor = touchDragAnchor(160, 84);
    expect(touchDragTarget(anchor, 160)).toBe(84);
    // 灵敏度可以显式覆盖。
    expect(touchDragTarget(anchor, 170, 2)).toBeCloseTo(84 + 10 * 2);
  });
});
