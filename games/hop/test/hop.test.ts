import { describe, expect, it } from "vitest";

import {
  BOARD_H,
  CELL,
  COLS,
  HOME_POINTS,
  HOME_ROW,
  LANES,
  LOG_GRACE,
  MAX_LEVEL,
  ROWS,
  ROW_POINTS,
  START_COL,
  START_ROW,
  WIDTH,
  carHitsPlayer,
  cellCenter,
  clampCol,
  clampRow,
  clampX,
  colForX,
  createLane,
  gridToPx,
  isFirstVisit,
  isWaterRow,
  laneSpeed,
  levelFor,
  logUnder,
  playerXForCol,
  pxToGrid,
  rideDelta,
  rowKind,
  rowProgress,
  scoreForRow,
  stepObjects,
  stepOnWater,
  type RowKind,
  type TrafficObject,
} from "../src/logic";

/** 可复现随机源：同一个种子铺出同一条车道。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeObject(partial: Partial<TrafficObject> & { x: number }): TrafficObject {
  return { row: 1, w: 48, speed: 0, kind: 0, ...partial };
}

describe("棋盘常量", () => {
  it("8 行 × 7 列，cell 24，画布刚好 168 宽、8 行 192 高放进 210", () => {
    expect(COLS).toBe(7);
    expect(ROWS).toBe(8);
    expect(CELL).toBe(24);
    expect(WIDTH).toBe(168);
    expect(BOARD_H).toBe(192);
    expect(BOARD_H).toBeLessThanOrEqual(210);
    // 用 8 行而不是规格里最初写的 13 行：13*24=312 放不进 210。
    expect(ROWS * CELL).toBe(192);
    expect(START_ROW).toBe(7);
    expect(START_COL).toBe(3);
  });

  it("行类型表自上而下是 home / water×2 / safe / road×2 / safe / start", () => {
    const expected: RowKind[] = [
      "home",
      "water",
      "water",
      "safe",
      "road",
      "road",
      "safe",
      "start",
    ];
    for (let row = 0; row < ROWS; row += 1) expect(rowKind(row)).toBe(expected[row]);
    // 越界行夹到边界，不会拿到 undefined。
    expect(rowKind(-5)).toBe("home");
    expect(rowKind(99)).toBe("start");
  });

  it("只有 1/2 行是水，且水位判定与行类型一致", () => {
    const water: number[] = [];
    for (let row = 0; row < ROWS; row += 1) if (isWaterRow(row)) water.push(row);
    expect(water).toEqual([1, 2]);
  });
});

describe("坐标互转 · gridToPx / pxToGrid 必须互逆", () => {
  it("每个格子的左上角都能往返", () => {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const px = gridToPx(col, row);
        expect(px).toEqual({ x: col * CELL, y: row * CELL });
        expect(pxToGrid(px.x, px.y)).toEqual({ col, row });
        // 格子内部任意一点也落在同一格。
        expect(pxToGrid(px.x + CELL - 1, px.y + CELL - 1)).toEqual({ col, row });
      }
    }
  });

  it("格子中心往返稳定", () => {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const center = cellCenter(col, row);
        expect(pxToGrid(center.x, center.y)).toEqual({ col, row });
        expect(gridToPx(col, row).x).toBeLessThan(center.x);
      }
    }
  });

  it("画外坐标被夹回棋盘，不会返回负下标", () => {
    expect(pxToGrid(-40, -40)).toEqual({ col: 0, row: 0 });
    expect(pxToGrid(9999, 9999)).toEqual({ col: COLS - 1, row: ROWS - 1 });
    // 列夹在 0..COLS-1，行夹在 0..ROWS-1。
    expect(clampCol(-3)).toBe(0);
    expect(clampCol(99)).toBe(COLS - 1);
    expect(clampRow(-3)).toBe(0);
    expect(clampRow(99)).toBe(ROWS - 1);
    // NaN / 小数都被驯服。
    expect(clampCol(Number.NaN)).toBe(0);
    expect(clampCol(2.7)).toBe(3);
  });

  it("playerXForCol / colForX 互逆，且青蛙中心不出画面", () => {
    for (let col = 0; col < COLS; col += 1) {
      expect(colForX(playerXForCol(col))).toBe(col);
    }
    expect(clampX(-100)).toBe(CELL / 2);
    expect(clampX(WIDTH + 100)).toBe(WIDTH - CELL / 2);
  });
});

describe("laneSpeed · 方向交替与等级", () => {
  it("4 条车道，方向一右一左交替", () => {
    expect(LANES.map((lane) => lane.row)).toEqual([1, 2, 4, 5]);
    const speeds = LANES.map((lane) => laneSpeed(lane.row, 1));
    expect(speeds[0]).toBeGreaterThan(0);
    expect(speeds[1]).toBeLessThan(0);
    expect(speeds[2]).toBeGreaterThan(0);
    expect(speeds[3]).toBeLessThan(0);
  });

  it("等级越高速度越大（符号不变），非车道行速度为 0", () => {
    for (const lane of LANES) {
      let previous = Math.abs(laneSpeed(lane.row, 1));
      for (let lv = 2; lv <= MAX_LEVEL; lv += 1) {
        const speed = laneSpeed(lane.row, lv);
        expect(Math.sign(speed)).toBe(Math.sign(laneSpeed(lane.row, 1)));
        expect(Math.abs(speed)).toBeGreaterThan(previous);
        previous = Math.abs(speed);
      }
      // 超过上限被夹住，不会无限加速。
      expect(laneSpeed(lane.row, 999)).toBe(laneSpeed(lane.row, MAX_LEVEL));
    }
    expect(laneSpeed(0, 1)).toBe(0);
    expect(laneSpeed(3, 1)).toBe(0);
    expect(laneSpeed(7, 1)).toBe(0);
  });

  it("过河次数换算成等级：每 2 次升 1 级，封顶", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(1)).toBe(1);
    expect(levelFor(2)).toBe(2);
    expect(levelFor(5)).toBe(3);
    expect(levelFor(1000)).toBe(MAX_LEVEL);
    expect(levelFor(-4)).toBe(1);
  });
});

describe("rideDelta · 木头把人带走", () => {
  it("位移 = 速度 × 时间，和时间成正比", () => {
    // 100px/s 的木头，100ms 应该带 10px。
    expect(rideDelta({ speed: 100 }, 100)).toBeCloseTo(10, 6);
    expect(rideDelta({ speed: 100 }, 500)).toBeCloseTo(50, 6);
    expect(rideDelta({ speed: 100 }, 1000)).toBeCloseTo(100, 6);
    // 反向木头往左带。
    expect(rideDelta({ speed: -60 }, 250)).toBeCloseTo(-15, 6);
    // 静止木头不动人。
    expect(rideDelta({ speed: 0 }, 400)).toBe(0);
  });

  it("非法 dt / 速度不会产生 NaN 或反向位移", () => {
    expect(rideDelta({ speed: 50 }, 0)).toBe(0);
    expect(rideDelta({ speed: 50 }, -100)).toBe(0);
    expect(rideDelta({ speed: 50 }, Number.NaN)).toBe(0);
    expect(rideDelta({ speed: Number.NaN }, 100)).toBe(0);
  });

  it("连续多帧累加等于总时间的位移（不随帧率变化）", () => {
    const wood = { speed: 120 };
    let x = 0;
    for (let frame = 0; frame < 60; frame += 1) x += rideDelta(wood, 1000 / 60);
    expect(x).toBeCloseTo(120, 4);
  });
});

describe("logUnder · 踩没踩到木头", () => {
  it("木头上任意位置都算踩住，木头外就是踩空", () => {
    const log = makeObject({ row: 1, x: 40, w: 72, speed: 34 });
    expect(logUnder(42, 1, [log])).toBe(log);
    expect(logUnder(76, 1, [log])).toBe(log);
    expect(logUnder(110, 1, [log])).toBe(log);
    // 左右两侧踩空。
    expect(logUnder(39, 1, [log])).toBeNull();
    expect(logUnder(112, 1, [log])).toBeNull();
    // 行号不对也不算。
    expect(logUnder(76, 2, [log])).toBeNull();
    // 空河面。
    expect(logUnder(76, 1, [])).toBeNull();
  });

  it("多根木头时选中真正覆盖脚下的那根", () => {
    const near = makeObject({ row: 1, x: 0, w: 48 });
    const far = makeObject({ row: 1, x: 120, w: 48 });
    expect(logUnder(10, 1, [near, far])).toBe(near);
    expect(logUnder(130, 1, [near, far])).toBe(far);
    expect(logUnder(100, 1, [near, far])).toBeNull();
  });

  it("站木头的宽容度：身体边缘搭到木头也算站住", () => {
    const log = makeObject({ row: 1, x: 40, w: 48 });
    // 木头右边界是 88，中心点 90 已经出界，但身体还搭着。
    expect(logUnder(90, 1, [log])).toBeNull();
    expect(logUnder(90, 1, [log], LOG_GRACE)).toBe(log);
    // 宽容度不能无限大：远离木头依然踩空。
    expect(logUnder(120, 1, [log], LOG_GRACE)).toBeNull();
    expect(logUnder(20, 1, [log], LOG_GRACE)).toBeNull();
    // 负宽容度被当成 0，不会放宽判定。
    expect(logUnder(90, 1, [log], -50)).toBeNull();
  });
});

describe("stepOnWater · 木头带人走 / 水里没木头必死", () => {
  it("站在木头上：青蛙被木头带着走，位移和木头速度一致", () => {
    const log = makeObject({ row: 1, x: 40, w: 72, speed: 40 });
    const before = 76;
    const result = stepOnWater(before, 1, [log], 1000);

    expect(result.onLog).toBe(true);
    expect(result.log).toBe(log);
    // 40px/s 走 1 秒 → 正好被带 40px。
    expect(result.x).toBe(before + 40);
  });

  it("木头及青蛙一起前进：连续多帧后青蛙相对木头的位置不变", () => {
    const log = makeObject({ row: 1, x: 40, w: 96, speed: 60 });
    const offset = 30;
    let playerX = log.x + offset;

    for (let frame = 0; frame < 30; frame += 1) {
      stepObjects([log], 1000 / 60);
      const step = stepOnWater(playerX, 1, [log], 1000 / 60);
      expect(step.onLog).toBe(true);
      playerX = step.x;
      // 每帧结算后，青蛙仍在木头中间（相对位置不变）。
      expect(playerX - log.x).toBeCloseTo(offset, 4);
      expect(logUnder(playerX, 1, [log])).toBe(log);
    }
  });

  it("水里没有木头：onLog = false（调用方据此扣命），位置保持原位", () => {
    const log = makeObject({ row: 1, x: 40, w: 48, speed: 40 });
    const result = stepOnWater(140, 1, [log], 500);

    expect(result.onLog).toBe(false);
    expect(result.log).toBeNull();
    expect(result.x).toBe(140);

    // 完全空的河面也是必死。
    expect(stepOnWater(84, 2, [], 500).onLog).toBe(false);
    // 行号不对（木头在别的行）同样算踩空。
    expect(stepOnWater(76, 2, [log], 500).onLog).toBe(false);
  });

  it("木头把人带出画外时 x 被夹住，不会跑到负坐标", () => {
    const log = makeObject({ row: 2, x: 10, w: 72, speed: -200 });
    const step = stepOnWater(20, 2, [log], 1000);
    expect(step.onLog).toBe(true);
    expect(step.x).toBe(CELL / 2);
  });
});

describe("carHitsPlayer · 撞车判定", () => {
  it("水平重叠即命中，错开就安全", () => {
    const car = makeObject({ row: 4, x: 50, w: 36, speed: 48 });
    expect(carHitsPlayer(58, 4, [car])).toBe(true);
    expect(carHitsPlayer(50, 4, [car])).toBe(true);
    // 在车头前一点仍算蹭到（青蛙有半宽 7）。
    expect(carHitsPlayer(88, 4, [car])).toBe(true);
    // 远离车身。
    expect(carHitsPlayer(20, 4, [car])).toBe(false);
    expect(carHitsPlayer(120, 4, [car])).toBe(false);
    // 不同车道互不影响。
    expect(carHitsPlayer(58, 5, [car])).toBe(false);
  });

  it("空车道永不命中", () => {
    expect(carHitsPlayer(84, 4, [])).toBe(false);
  });
});

describe("车道铺设与推进", () => {
  it("同一等级 / 种子铺出同样的车道，且间距容得下青蛙", () => {
    const a = createLane(1, 1, "water", seeded(7));
    const b = createLane(1, 1, "water", seeded(7));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1);
    for (const log of a) {
      expect(log.row).toBe(1);
      expect(log.w).toBeGreaterThan(0);
      expect(log.speed).toBe(laneSpeed(1, 1));
    }
    // 相邻两根木头之间必须有空隙，否则青蛙无处可落。
    for (let i = 1; i < a.length; i += 1) {
      const left = (a[i - 1] as TrafficObject).x + (a[i - 1] as TrafficObject).w;
      expect((a[i] as TrafficObject).x).toBeGreaterThan(left);
    }
  });

  it("非车道行不铺东西", () => {
    // 车道速度 0 → 空数组（这是 createLane 的兜底）。
    expect(createLane(3, 1, "water", seeded(1))).toEqual([]);
  });

  it("木头按速度前进，越界后从另一侧回卷", () => {
    const log = makeObject({ row: 1, x: 100, w: 48, speed: 60 });
    stepObjects([log], 500);
    expect(log.x).toBeCloseTo(130, 6);

    // 一直往前走，最终会从左边重新出现，永远不留在画面外。
    for (let i = 0; i < 400; i += 1) stepObjects([log], 100);
    expect(log.x).toBeLessThanOrEqual(WIDTH);
    expect(log.x).toBeGreaterThanOrEqual(-log.w - 1);

    // 反向同理。
    const leftward = makeObject({ row: 2, x: 10, w: 48, speed: -60 });
    stepObjects([leftward], 500);
    expect(leftward.x).toBeCloseTo(-20, 6);
    for (let i = 0; i < 400; i += 1) stepObjects([leftward], 100);
    expect(leftward.x).toBeGreaterThanOrEqual(0);
  });
});

describe("计分 · 首次到达 vs 重复访问", () => {
  it("除对岸外每行 10 分，对岸 100 分，起点 0 分", () => {
    expect(scoreForRow(HOME_ROW)).toBe(HOME_POINTS);
    expect(HOME_POINTS).toBe(100);
    for (let row = 1; row < START_ROW; row += 1) expect(scoreForRow(row)).toBe(ROW_POINTS);
    expect(ROW_POINTS).toBe(10);
    expect(scoreForRow(START_ROW)).toBe(0);
  });

  it("首次到达计分，重复访问不再给分", () => {
    const visited = new Array<boolean>(ROWS).fill(false);
    visited[START_ROW] = true;

    expect(isFirstVisit(visited, 5)).toBe(true);
    visited[5] = true;
    expect(isFirstVisit(visited, 5)).toBe(false);

    // 模拟一局：上到 5 行、退回、再上到 5 行，总分只加一次。
    const run = new Array<boolean>(ROWS).fill(false);
    run[START_ROW] = true;
    let score = 0;
    for (const row of [6, 5, 4, 5, 6, 5]) {
      if (!isFirstVisit(run, row)) continue;
      run[row] = true;
      score += scoreForRow(row);
    }
    // 6 / 5 / 4 各首次 +10，后面三次重复访问 0 分。
    expect(score).toBe(30);
  });

  it("行进度：起点 0，每上一行 +1", () => {
    expect(rowProgress(START_ROW)).toBe(0);
    expect(rowProgress(6)).toBe(1);
    expect(rowProgress(1)).toBe(6);
    expect(rowProgress(HOME_ROW)).toBe(7);
  });
});
