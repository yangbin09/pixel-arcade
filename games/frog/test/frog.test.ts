import { describe, expect, it } from "vitest";

import {
  CELL_H,
  CELL_W,
  COLS,
  GOAL_ROW,
  LIVES,
  LOG_GAP,
  LOG_W,
  RIVER_FROM,
  ROWS,
  ROUND_MS,
  ROWS as ROW_COUNT,
  SCORE_PER_ROW,
  START_COL,
  START_ROW,
  advanceScore,
  carHitsPlayer,
  carLane,
  cellCenter,
  colForX,
  dirFromTap,
  hopPosition,
  isOnLog,
  isOutOfCanvas,
  laneObjects,
  lanePeriod,
  logLane,
  logUnder,
  movePlayer,
  nextBestRow,
  rowKind,
  xForCol,
  type Cell,
  type LaneObject,
} from "../src/logic";

/** 造一根浮木，缩短测试里的字面量。 */
function logAt(x: number, w = LOG_W): LaneObject {
  return { x, w, row: RIVER_FROM, index: 0 };
}

describe("网格常量", () => {
  it("11 行 × 8 列，格子 20×18，起点在行 0、终点在行 10", () => {
    expect(COLS).toBe(8);
    expect(ROWS).toBe(11);
    expect(CELL_W).toBe(20);
    expect(CELL_H).toBe(18);
    expect(START_ROW).toBe(0);
    expect(GOAL_ROW).toBe(10);
    expect(LIVES).toBe(3);
    expect(START_COL).toBe(4);
    expect(ROUND_MS).toBe(60_000);
  });

  it("行分类：行 0 起点、行 1–5 车道、行 6–9 河、行 10 终点", () => {
    expect(rowKind(0)).toBe("start");
    for (let row = 1; row <= 5; row += 1) expect(rowKind(row)).toBe("road");
    expect(RIVER_FROM).toBe(6);
    for (let row = 6; row <= 9; row += 1) expect(rowKind(row)).toBe("river");
    expect(rowKind(10)).toBe("goal");
  });
});

describe("cellCenter", () => {
  it("格心：列 0 → x=10，列 7 → x=150", () => {
    expect(cellCenter(0, 0)).toEqual({ x: 10, y: 198 });
    expect(cellCenter(7, 0).x).toBe(150);
  });

  it("格心：行 0 → y=198，行 10 → y=18，且完全落在画布内", () => {
    expect(cellCenter(0, 0).y).toBe(198);
    expect(cellCenter(0, 10).y).toBe(18);

    for (let row = 0; row < ROW_COUNT; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const { x, y } = cellCenter(col, row);
        expect(x - CELL_W / 2).toBeGreaterThanOrEqual(0);
        expect(x + CELL_W / 2).toBeLessThanOrEqual(168);
        expect(y - CELL_H / 2).toBeGreaterThanOrEqual(0);
        expect(y + CELL_H / 2).toBeLessThanOrEqual(210);
      }
    }
  });
});

describe("carLane · 车道", () => {
  it("只有行 1–5 是车道，行 0 / 6 / 10 返回 null", () => {
    expect(carLane(0)).toBeNull();
    expect(carLane(6)).toBeNull();
    expect(carLane(10)).toBeNull();
    for (let row = 1; row <= 5; row += 1) expect(carLane(row)).not.toBeNull();
  });

  it("速度 80 + row*22（行 1 = 102，行 5 = 190），逐行变快", () => {
    expect(carLane(1)?.speed).toBe(102);
    expect(carLane(5)?.speed).toBe(190);
    for (let row = 1; row < 5; row += 1) {
      expect(carLane(row + 1)!.speed).toBeGreaterThan(carLane(row)!.speed);
    }
  });

  it("间距 66 - row*4（行 1 = 62，行 5 = 46），逐行变窄", () => {
    expect(carLane(1)?.gap).toBe(62);
    expect(carLane(5)?.gap).toBe(46);
    for (let row = 1; row < 5; row += 1) {
      expect(carLane(row + 1)!.gap).toBeLessThan(carLane(row)!.gap);
    }
  });

  it("方向在相邻车道交替", () => {
    expect(carLane(1)?.dir).toBe(1);
    expect(carLane(2)?.dir).toBe(-1);
    expect(carLane(3)?.dir).toBe(1);
    for (let row = 1; row < 5; row += 1) {
      expect(carLane(row + 1)!.dir).toBe(-carLane(row)!.dir);
    }
  });
});

describe("logLane · 浮木带", () => {
  it("只有行 6–9 是河，速度 60 + (row-6)*18", () => {
    expect(logLane(5)).toBeNull();
    expect(logLane(10)).toBeNull();
    expect(logLane(6)?.speed).toBe(60);
    expect(logLane(7)?.speed).toBe(78);
    expect(logLane(8)?.speed).toBe(96);
    expect(logLane(9)?.speed).toBe(114);
  });

  it("方向：行 6 向右、7 向左、8 向右、9 向左；间距固定 40", () => {
    expect(logLane(6)?.dir).toBe(1);
    expect(logLane(7)?.dir).toBe(-1);
    expect(logLane(8)?.dir).toBe(1);
    expect(logLane(9)?.dir).toBe(-1);
    for (let row = RIVER_FROM; row < GOAL_ROW; row += 1) {
      expect(logLane(row)?.gap).toBe(LOG_GAP);
    }
  });
});

describe("laneObjects · 车道时序", () => {
  it("木头的周期 = 木宽 + 间距，位置按周期无缝平铺", () => {
    expect(lanePeriod("log", LOG_GAP)).toBe(LOG_W + LOG_GAP);

    const logs = laneObjects("log", 6, 0);
    expect(logs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < logs.length; i += 1) {
      expect(logs[i]!.x - logs[i - 1]!.x).toBeCloseTo(lanePeriod("log", LOG_GAP), 6);
    }
  });

  it("向右的车道随时间向右移动，向左的车道反向", () => {
    const rightA = laneObjects("car", 1, 0)[0]!;
    const rightB = laneObjects("car", 1, 500)[0]!;
    expect(rightB.x - rightA.x).toBeCloseTo((carLane(1)!.speed * 500) / 1000, 6);

    // 向左的车道会循环回绕，所以按「整体平移 delta（模一个周期）」比对
    const period = lanePeriod("car", carLane(2)!.gap);
    const delta = -(carLane(2)!.speed * 500) / 1000;
    const before = laneObjects("car", 2, 0).map((car) => car.x);
    const after = laneObjects("car", 2, 500).map((car) => car.x);
    for (const x of before) {
      const want = x + delta;
      const matched = after.some((y) => {
        const off = (((y - want) % period) + period) % period;
        return off < 1e-6 || period - off < 1e-6;
      });
      expect(matched).toBe(true);
    }
  });

  it("每隔一个完整周期，位置回到原处，且始终覆盖整条画布", () => {
    const period = lanePeriod("log", LOG_GAP);
    const a = laneObjects("log", 7, 0);
    const b = laneObjects("log", 7, (period / logLane(7)!.speed) * 1000);

    expect(b[0]!.x).toBeCloseTo(a[0]!.x, 6);
    expect(a[0]!.x).toBeLessThanOrEqual(0);
    expect(a[a.length - 1]!.x + a[a.length - 1]!.w).toBeGreaterThanOrEqual(168);
  });

  it("不存在的行返回空数组", () => {
    expect(laneObjects("car", 0, 1000)).toEqual([]);
    expect(laneObjects("log", 3, 1000)).toEqual([]);
    expect(laneObjects("car", 6, 1000)).toEqual([]);
  });
});

describe("movePlayer · 跳跃夹取", () => {
  it("四个方向各移动一格", () => {
    const mid: Cell = { col: 3, row: 4 };
    expect(movePlayer(mid, "left")).toEqual({ col: 2, row: 4 });
    expect(movePlayer(mid, "right")).toEqual({ col: 4, row: 4 });
    expect(movePlayer(mid, "up")).toEqual({ col: 3, row: 5 });
    expect(movePlayer(mid, "down")).toEqual({ col: 3, row: 3 });
  });

  it("左边界、右边界都夹在 [0, COLS-1]", () => {
    expect(movePlayer({ col: 0, row: 3 }, "left")).toEqual({ col: 0, row: 3 });
    expect(movePlayer({ col: COLS - 1, row: 3 }, "right")).toEqual({ col: COLS - 1, row: 3 });
  });

  it("下边界与上边界夹在 [0, ROWS-1]", () => {
    expect(movePlayer({ col: 4, row: 0 }, "down")).toEqual({ col: 4, row: 0 });
    expect(movePlayer({ col: 4, row: GOAL_ROW }, "up")).toEqual({ col: 4, row: GOAL_ROW });
    expect(movePlayer({ col: 4, row: ROWS - 1 }, "up").row).toBe(ROWS - 1);
  });
});

describe("advanceScore · 只对前进给分", () => {
  it("刷新最远行 +10，同行 / 后退给 0", () => {
    expect(SCORE_PER_ROW).toBe(10);
    expect(advanceScore(0, 1)).toBe(10);
    expect(advanceScore(3, 7)).toBe(10);
    expect(advanceScore(5, 5)).toBe(0);
    expect(advanceScore(5, 4)).toBe(0);
    expect(advanceScore(10, 9)).toBe(0);
  });

  it("最远行只升不降", () => {
    expect(nextBestRow(0, 5)).toBe(5);
    expect(nextBestRow(5, 5)).toBe(5);
    expect(nextBestRow(5, 2)).toBe(5);
  });
});

describe("isOnLog / logUnder · 浮木判定", () => {
  it("落在木头上返回 true，落在间隙返回 false", () => {
    const logs = [logAt(10), logAt(78)];
    expect(isOnLog(10, logs)).toBe(true);
    expect(isOnLog(24, logs)).toBe(true);
    expect(isOnLog(38, logs)).toBe(true);
    expect(isOnLog(37.9, logs)).toBe(true);
    expect(isOnLog(39, logs)).toBe(false);
    expect(isOnLog(60, logs)).toBe(false);
    expect(isOnLog(0, logs)).toBe(false);
    expect(isOnLog(200, logs)).toBe(false);
  });

  it("logUnder 返回脚下那根木头的身份，找不到返回 null", () => {
    const under = logAt(78);
    const logs = [logAt(10), under];
    expect(logUnder(90, logs)).toBe(under);
    expect(logUnder(45, logs)).toBeNull();
  });
});

describe("carHitsPlayer · 撞车判定", () => {
  it("车与青蛙矩形相交才算撞到", () => {
    const cars: LaneObject[] = [{ x: 40, w: 16, row: 2, index: 0 }];
    // 青蛙半宽 6：x=48 → 42..54，压在车身上
    expect(carHitsPlayer(48, cars)).toBe(true);
    expect(carHitsPlayer(40, cars)).toBe(true);
    // 车头 / 车尾刚好相切不算撞（严格大于 / 小于）
    expect(carHitsPlayer(35, cars)).toBe(true);
    expect(carHitsPlayer(34, cars)).toBe(false);
    expect(carHitsPlayer(61, cars)).toBe(true);
    expect(carHitsPlayer(62, cars)).toBe(false);
    expect(carHitsPlayer(100, [])).toBe(false);
  });
});

describe("横向边界 · 落水与取列", () => {
  it("横向超出 0–168 即被带出河面", () => {
    expect(isOutOfCanvas(0)).toBe(false);
    expect(isOutOfCanvas(168)).toBe(false);
    expect(isOutOfCanvas(-0.5)).toBe(true);
    expect(isOutOfCanvas(168.5)).toBe(true);
    expect(isOutOfCanvas(84)).toBe(false);
  });

  it("连续 x 与列号互转，夹在 0–7", () => {
    expect(colForX(10)).toBe(0);
    expect(colForX(150)).toBe(7);
    expect(colForX(84)).toBe(4);
    expect(colForX(-100)).toBe(0);
    expect(colForX(999)).toBe(COLS - 1);
    expect(xForCol(0)).toBe(10);
    expect(xForCol(7)).toBe(150);
    for (let col = 0; col < COLS; col += 1) expect(colForX(xForCol(col))).toBe(col);
  });
});

describe("dirFromTap · 触屏通路", () => {
  it("按主轴决定方向，点在自己身上就向前跳", () => {
    expect(dirFromTap(84, 100, 84, 120)).toBe("up");
    expect(dirFromTap(84, 140, 84, 120)).toBe("down");
    expect(dirFromTap(130, 120, 84, 120)).toBe("right");
    expect(dirFromTap(40, 120, 84, 120)).toBe("left");
    expect(dirFromTap(84, 121, 84, 120)).toBe("up");
  });

  it("斜向点击取位移更大的那个轴", () => {
    expect(dirFromTap(120, 122, 84, 120)).toBe("right");
    expect(dirFromTap(86, 160, 84, 120)).toBe("down");
  });
});

describe("hopPosition · 跳跃插值", () => {
  it("两端精确，中间有向上拱形", () => {
    const start = hopPosition(10, 198, 10, 180, 0);
    expect(start.x).toBeCloseTo(10, 6);
    expect(start.y).toBeCloseTo(198, 6);
    expect(start.lift).toBe(0);

    const end = hopPosition(10, 198, 10, 180, 1);
    expect(end.x).toBeCloseTo(10, 6);
    expect(end.y).toBeCloseTo(180, 6);
    expect(end.lift).toBe(0);

    const mid = hopPosition(10, 198, 10, 180, 0.5);
    expect(mid.y).toBeLessThan(189);
    expect(mid.lift).toBeGreaterThan(0);
  });

  it("进度被夹在 0–1，不会越界", () => {
    expect(hopPosition(0, 0, 20, 18, -3).x).toBe(0);
    expect(hopPosition(0, 0, 20, 18, 9).x).toBe(20);
  });
});
