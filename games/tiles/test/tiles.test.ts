import { describe, expect, it } from "vitest";

import {
  AUTO_LANE,
  BLOCK_H,
  BLOCK_W,
  FLOOR_Y,
  H,
  HIT_Y,
  LANES,
  LANE_W,
  MAX_BLOCKS,
  MAX_LEVEL,
  SPEED_CAP,
  START_SPEED,
  W,
  blockBottom,
  blockX,
  isHittable,
  isMissed,
  lowestHittable,
  lowestHittableAny,
  multiplierFor,
  pickLaneTarget,
  pointsFor,
  speedForHits,
  speedForLevel,
  speedLevelFor,
  spawnIntervalFor,
  type Block,
} from "../src/logic";

/** 造一块指定轨道、指定顶边 y 的方块。 */
const block = (id: number, lane: number, y: number): Block => ({ id, lane, y });

describe("tiles · 画布与轨道", () => {
  it("尺寸是 168×252，四条 42px 轨道正好铺满", () => {
    expect(W).toBe(168);
    expect(H).toBe(252);
    expect(LANES).toBe(4);
    expect(LANE_W).toBe(42);
    expect(LANES * LANE_W).toBe(W);
    expect(MAX_BLOCKS).toBe(3);
  });

  it("方块横向居中，每条轨道留 3px 边", () => {
    expect(blockX(0)).toBe(3);
    expect(blockX(1)).toBe(45);
    expect(blockX(3)).toBe(129);
    expect(blockX(0) + BLOCK_W).toBe(LANE_W - 3);
  });
});

describe("tiles · 判定窗口", () => {
  it("底边还没进入底部 56px，不可点", () => {
    const early = block(1, 0, HIT_Y - BLOCK_H - 1);
    expect(blockBottom(early)).toBe(HIT_Y - 1);
    expect(isHittable(early)).toBe(false);
  });

  it("底边刚碰到判定区上沿就能点", () => {
    const edge = block(1, 0, HIT_Y - BLOCK_H);
    expect(blockBottom(edge)).toBe(HIT_Y);
    expect(isHittable(edge)).toBe(true);
  });

  it("判定区中间可点，贴近地面仍可点", () => {
    expect(isHittable(block(1, 2, 180))).toBe(true);
    expect(isHittable(block(2, 2, FLOOR_Y - BLOCK_H - 1))).toBe(true);
  });

  it("底边碰到画布底边就算漏块，且不再可点", () => {
    const landed = block(1, 3, FLOOR_Y - BLOCK_H);
    expect(blockBottom(landed)).toBe(FLOOR_Y);
    expect(isHittable(landed)).toBe(false);
    expect(isMissed(landed)).toBe(true);
  });

  it("越过底边也算漏块", () => {
    expect(isMissed(block(1, 1, FLOOR_Y - BLOCK_H + 5))).toBe(true);
  });

  it("同一轨道取最下方的可点方块", () => {
    const blocks = [block(1, 1, 170), block(2, 1, 205), block(3, 1, 90), block(4, 0, 240)];
    expect(lowestHittable(blocks, 1)?.id).toBe(2);
  });

  it("该轨道只有未进入判定区的块时返回 null", () => {
    const blocks = [block(1, 1, 40), block(2, 1, 120)];
    expect(lowestHittable(blocks, 1)).toBeNull();
  });

  it("空格用：取所有轨道里最下方的可点块", () => {
    const blocks = [block(1, 0, 200), block(2, 2, 217), block(3, 3, 120)];
    expect(lowestHittableAny(blocks)?.id).toBe(2);
    expect(lowestHittableAny([block(1, 0, 0)])).toBeNull();
  });
});

describe("tiles · 手柄选轨", () => {
  it("选中轨道有可点块时，取该轨道最下方的一块", () => {
    const blocks = [block(1, 0, 200), block(2, 1, 210), block(3, 1, 178), block(4, 2, 217)];
    expect(pickLaneTarget(blocks, 1)?.id).toBe(2);
    expect(pickLaneTarget(blocks, 0)?.id).toBe(1);
  });

  it("选中轨道空着时回退到全场最下方，不判 miss", () => {
    const blocks = [block(1, 0, 200), block(2, 2, 217)];
    expect(pickLaneTarget(blocks, 3)?.id).toBe(2);
  });

  it("选中轨道只有还没进入判定区的块时也算空，回退到全场", () => {
    const blocks = [block(1, 1, HIT_Y - BLOCK_H - 1), block(2, 3, 210)];
    expect(pickLaneTarget(blocks, 1)?.id).toBe(2);
  });

  it("所有轨道都没有可点块时返回 null", () => {
    expect(pickLaneTarget([block(1, 0, 40), block(2, 3, 120)], 0)).toBeNull();
    expect(pickLaneTarget([], 2)).toBeNull();
  });

  it("AUTO_LANE（-1）等价于直接砸全场最下方", () => {
    const blocks = [block(1, 0, 200), block(2, 3, 217)];
    expect(AUTO_LANE).toBe(-1);
    expect(pickLaneTarget(blocks, AUTO_LANE)?.id).toBe(2);
    expect(pickLaneTarget(blocks, AUTO_LANE)).toBe(lowestHittableAny(blocks));
  });
});

describe("tiles · 速度曲线", () => {
  it("每命中 10 块升一级，到速度上限后停住", () => {
    expect(speedLevelFor(0)).toBe(1);
    expect(speedLevelFor(9)).toBe(1);
    expect(speedLevelFor(10)).toBe(2);
    expect(speedLevelFor(19)).toBe(2);
    expect(speedLevelFor(20)).toBe(3);
    expect(speedLevelFor(180)).toBe(MAX_LEVEL);
    expect(speedLevelFor(400)).toBe(MAX_LEVEL);
  });

  it("90px/s 起，每级 +12，封顶 300", () => {
    expect(START_SPEED).toBe(90);
    expect(speedForLevel(1)).toBe(90);
    expect(speedForLevel(2)).toBe(102);
    expect(speedForLevel(11)).toBe(210);
    expect(speedForLevel(19)).toBe(300);
    expect(speedForLevel(99)).toBe(SPEED_CAP);
  });

  it("速度随命中数单调不减，且不会超过上限", () => {
    let previous = 0;
    for (let hitCount = 0; hitCount <= 400; hitCount += 1) {
      const speed = speedForHits(hitCount);
      expect(speed).toBeGreaterThanOrEqual(previous);
      expect(speed).toBeLessThanOrEqual(SPEED_CAP);
      previous = speed;
    }
    expect(speedForHits(0)).toBe(90);
    expect(speedForHits(10)).toBe(102);
  });

  it("生成间隔随等级缩短，下限 0.22 秒", () => {
    expect(spawnIntervalFor(1)).toBeCloseTo(0.6);
    expect(spawnIntervalFor(10)).toBeCloseTo(0.42);
    expect(spawnIntervalFor(19)).toBeCloseTo(0.24);
    expect(spawnIntervalFor(20)).toBeCloseTo(0.22);
    expect(spawnIntervalFor(200)).toBeCloseTo(0.22);

    let previous = Number.POSITIVE_INFINITY;
    for (let level = 1; level <= 30; level += 1) {
      const interval = spawnIntervalFor(level);
      expect(interval).toBeLessThanOrEqual(previous);
      expect(interval).toBeGreaterThanOrEqual(0.22);
      previous = interval;
    }
  });
});

describe("tiles · 连击倍率", () => {
  it("1 + floor(combo / 10)，最高 5", () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(9)).toBe(1);
    expect(multiplierFor(10)).toBe(2);
    expect(multiplierFor(19)).toBe(2);
    expect(multiplierFor(20)).toBe(3);
    expect(multiplierFor(39)).toBe(4);
    expect(multiplierFor(40)).toBe(5);
    expect(multiplierFor(999)).toBe(5);
  });

  it("单块得分 = 10 × 倍率", () => {
    expect(pointsFor(0)).toBe(10);
    expect(pointsFor(9)).toBe(10);
    expect(pointsFor(10)).toBe(20);
    expect(pointsFor(20)).toBe(30);
    expect(pointsFor(40)).toBe(50);
  });
});
