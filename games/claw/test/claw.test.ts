import { describe, expect, it } from "vitest";

import {
  CHANCE_AT_CENTER,
  CHANCE_AT_EDGE,
  CHANCE_CAP,
  CHANCE_OFFSET_MAX,
  CLAW_MAX,
  CLAW_MIN,
  CLAW_SPEED,
  EDGE,
  PRIZE_COUNT,
  PRIZE_MAX_W,
  PRIZE_MIN_W,
  PRIZE_TIERS,
  SHELF_Y,
  TRIES,
  clawSpeed,
  clampClaw,
  grabChance,
  layoutPrizes,
  offsetToPrize,
  overlap,
  pickPrize,
  prizeCenterX,
  resolveGrab,
  rollTier,
  scoreForPrize,
  stepClaw,
  tierOf,
  totalWeight,
  type Box,
} from "../src/logic";

/** 可复现随机源：同一个种子跑出同一层奖品。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 一个方便构造矩形的小工具。 */
function box(x: number, y: number, w: number, h: number): Box {
  return { x, y, w, h };
}

describe("机台几何与常量", () => {
  it("爪子横向范围 12..156、十次机会、货架线在 170", () => {
    expect(CLAW_MIN).toBe(12);
    expect(CLAW_MAX).toBe(156);
    expect(TRIES).toBe(10);
    expect(SHELF_Y).toBe(170);
    expect(CLAW_MAX - CLAW_MIN).toBe(144);
  });

  it("三档奖品：10 / 25 / 60 分，权重 60 / 30 / 10，宽度 20–26", () => {
    expect(PRIZE_TIERS.map((tier) => tier.key)).toEqual(["small", "mid", "big"]);
    expect(PRIZE_TIERS.map((tier) => tier.points)).toEqual([10, 25, 60]);
    expect(PRIZE_TIERS.map((tier) => tier.weight)).toEqual([60, 30, 10]);
    expect(totalWeight()).toBe(100);
    for (const tier of PRIZE_TIERS) {
      expect(tier.w).toBeGreaterThanOrEqual(PRIZE_MIN_W);
      expect(tier.w).toBeLessThanOrEqual(PRIZE_MAX_W);
      expect(tier.h).toBeGreaterThan(0);
    }
    expect(PRIZE_COUNT).toBe(5);
  });
});

describe("grabChance · 抓取概率曲线", () => {
  it("端点：正中 0.92，偏到 24px 及更远都是 0.06", () => {
    expect(CHANCE_AT_CENTER).toBe(0.92);
    expect(CHANCE_AT_EDGE).toBe(0.06);
    expect(CHANCE_OFFSET_MAX).toBe(24);

    expect(grabChance(0)).toBe(0.92);
    expect(grabChance(24)).toBe(0.06);
    expect(grabChance(25)).toBe(0.06);
    expect(grabChance(400)).toBe(0.06);
  });

  it("随瞄准偏差单调递减，且基础值始终落在 [0.06, 0.92]", () => {
    let previous = grabChance(0);
    expect(previous).toBe(0.92);

    for (let offset = 0.5; offset <= 40; offset += 0.5) {
      const chance = grabChance(offset);
      expect(chance).toBeLessThanOrEqual(previous);
      expect(chance).toBeGreaterThanOrEqual(CHANCE_AT_EDGE);
      expect(chance).toBeLessThanOrEqual(CHANCE_AT_CENTER);
      previous = chance;
    }
  });

  it("0..24 之间严格线性（等距差分恒定、中点取平均）", () => {
    const slope = (CHANCE_AT_EDGE - CHANCE_AT_CENTER) / CHANCE_OFFSET_MAX;

    for (const offset of [2, 6, 10, 14, 18, 22]) {
      expect(grabChance(offset)).toBeCloseTo(CHANCE_AT_CENTER + slope * offset, 10);
    }

    const step = 4;
    for (let offset = 0; offset + step <= CHANCE_OFFSET_MAX; offset += step) {
      const delta = grabChance(offset) - grabChance(offset + step);
      expect(delta).toBeCloseTo(-slope * step, 10);
    }

    // 中点正好是两端点的平均
    expect(grabChance(12)).toBeCloseTo((CHANCE_AT_CENTER + CHANCE_AT_EDGE) / 2, 10);
  });

  it("只认距离：负的 offset 和正的完全一样", () => {
    for (const offset of [0, 3, 7.5, 11.25, 24, 60]) {
      expect(grabChance(-offset)).toBeCloseTo(grabChance(offset), 12);
    }
  });

  it("连抓加成每级 +0.04，最终封顶 0.96", () => {
    expect(grabChance(12, 0)).toBeCloseTo(0.49, 10);
    expect(grabChance(12, 1)).toBeCloseTo(0.53, 10);
    expect(grabChance(12, 2)).toBeCloseTo(0.57, 10);

    // 正中已经 0.92，再加一级就顶到上限
    expect(grabChance(0, 1)).toBe(0.96);
    expect(grabChance(0, 2)).toBe(CHANCE_CAP);
    expect(grabChance(0, 99)).toBe(CHANCE_CAP);
    expect(CHANCE_CAP).toBe(0.96);

    for (const offset of [0, 3, 12, 24, 50, 999]) {
      for (const streak of [0, 1, 2, 5, 10, 100]) {
        expect(grabChance(offset, streak)).toBeLessThanOrEqual(CHANCE_CAP);
        expect(grabChance(offset, streak)).toBeGreaterThanOrEqual(CHANCE_AT_EDGE);
      }
    }
  });

  it("加成不会破坏单调性（连抓再高也是越偏越低）", () => {
    for (const streak of [0, 1, 3, 10]) {
      let previous = grabChance(0, streak);
      for (let offset = 1; offset <= 32; offset += 1) {
        const chance = grabChance(offset, streak);
        expect(chance).toBeLessThanOrEqual(previous);
        previous = chance;
      }
    }
  });

  it("非法输入稳定：NaN / Infinity 按最差瞄准处理", () => {
    expect(grabChance(Number.NaN)).toBe(CHANCE_AT_EDGE);
    expect(grabChance(Number.POSITIVE_INFINITY)).toBe(CHANCE_AT_EDGE);
    expect(grabChance(Number.NEGATIVE_INFINITY)).toBe(CHANCE_AT_EDGE);
    expect(grabChance(0, Number.NaN)).toBe(CHANCE_AT_CENTER);
    expect(grabChance(0, -5)).toBe(CHANCE_AT_CENTER);
  });
});

describe("resolveGrab · 掷点判定", () => {
  it("roll 小于概率才算抓住，恰好相等算失手", () => {
    expect(resolveGrab(0, 0, 0)).toBe(true);
    expect(resolveGrab(0, 0, 0.91)).toBe(true);
    expect(resolveGrab(0, 0, 0.92)).toBe(false);
    expect(resolveGrab(0, 0, 0.9999)).toBe(false);

    expect(resolveGrab(24, 0, 0.059)).toBe(true);
    expect(resolveGrab(24, 0, 0.06)).toBe(false);
  });

  it("连抓加成让同一个掷点从失手变命中", () => {
    expect(resolveGrab(12, 0, 0.55)).toBe(false);
    expect(resolveGrab(12, 2, 0.55)).toBe(true);
  });

  it("对准越准，同样的掷点越容易命中", () => {
    const roll = 0.5;
    expect(resolveGrab(0, 0, roll)).toBe(true);
    expect(resolveGrab(6, 0, roll)).toBe(true);
    // offset 15 → 0.92 - 0.86 * 15/24 ≈ 0.38，同一个 0.5 就失手了
    expect(resolveGrab(15, 0, roll)).toBe(false);
    expect(resolveGrab(20, 0, roll)).toBe(false);
  });
});

describe("奖品布局", () => {
  it("每个宽度下奖品都在货架边距内，且贴合 y=170 的货架线", () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const prizes = layoutPrizes(168, seeded(seed));
      expect(prizes.length).toBe(PRIZE_COUNT);

      for (const prize of prizes) {
        expect(prize.x).toBeGreaterThanOrEqual(EDGE);
        expect(prize.x + prize.w).toBeLessThanOrEqual(168 - EDGE);
        expect(prize.y + prize.h).toBe(SHELF_Y);
        expect(prize.w).toBeGreaterThanOrEqual(PRIZE_MIN_W);
        expect(prize.w).toBeLessThanOrEqual(PRIZE_MAX_W);
        expect(prize.w).toBe(tierOf(prize.tier).w);
        expect(prize.points).toBe(tierOf(prize.tier).points);
      }
    }
  });

  it("多组种子下奖品两两不重叠，且从左到右有序", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const prizes = layoutPrizes(168, seeded(seed));

      for (let i = 0; i < prizes.length; i += 1) {
        for (let j = i + 1; j < prizes.length; j += 1) {
          expect(overlap(prizes[i] as Box, prizes[j] as Box)).toBe(false);
        }
      }
      for (let i = 1; i < prizes.length; i += 1) {
        const previous = prizes[i - 1];
        const current = prizes[i];
        expect(previous).toBeDefined();
        expect(current).toBeDefined();
        if (!previous || !current) continue;
        expect(current.x).toBeGreaterThan(previous.x + previous.w);
      }
    }
  });

  it("极端随机源（全 0 / 全 1）也能摆出不重叠的一层", () => {
    for (const rng of [() => 0, () => 0.9999999, () => 0.5]) {
      const prizes = layoutPrizes(168, rng);
      expect(prizes.length).toBe(PRIZE_COUNT);
      for (let i = 0; i < prizes.length; i += 1) {
        for (let j = i + 1; j < prizes.length; j += 1) {
          expect(overlap(prizes[i] as Box, prizes[j] as Box)).toBe(false);
        }
      }
    }
  });

  it("同一个种子可复现，不同种子会摆出不同的一层", () => {
    const a = layoutPrizes(168, seeded(42));
    const b = layoutPrizes(168, seeded(42));
    expect(a).toEqual(b);

    const layouts = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      layouts.add(JSON.stringify(layoutPrizes(168, seeded(seed))));
    }
    expect(layouts.size).toBeGreaterThan(1);
  });

  it("画布太窄时不硬塞：返回空数组而不是越界重叠", () => {
    expect(layoutPrizes(30, seeded(1))).toEqual([]);
    expect(layoutPrizes(0, seeded(1))).toEqual([]);

    // 窄但放得下：仍然不越界、不重叠
    for (const width of [48, 60, 90, 120]) {
      const prizes = layoutPrizes(width, seeded(width));
      for (const prize of prizes) {
        expect(prize.x).toBeGreaterThanOrEqual(0);
        expect(prize.x + prize.w).toBeLessThanOrEqual(width - EDGE);
      }
      for (let i = 0; i < prizes.length; i += 1) {
        for (let j = i + 1; j < prizes.length; j += 1) {
          expect(overlap(prizes[i] as Box, prizes[j] as Box)).toBe(false);
        }
      }
    }
  });

  it("抽档权重接近 60 / 30 / 10", () => {
    const rng = seeded(7);
    const counts = { small: 0, mid: 0, big: 0 };
    const total = 20000;
    for (let i = 0; i < total; i += 1) {
      counts[rollTier(rng).key] += 1;
    }
    expect(counts.small / total).toBeCloseTo(0.6, 1);
    expect(counts.mid / total).toBeCloseTo(0.3, 1);
    expect(counts.big / total).toBeCloseTo(0.1, 1);
    expect(counts.small).toBeGreaterThan(counts.mid);
    expect(counts.mid).toBeGreaterThan(counts.big);
  });

  it("档位边界值固定：<0.6 小、[0.6,0.9) 中、≥0.9 大", () => {
    expect(rollTier(() => 0).key).toBe("small");
    expect(rollTier(() => 0.599999).key).toBe("small");
    expect(rollTier(() => 0.6).key).toBe("mid");
    expect(rollTier(() => 0.899999).key).toBe("mid");
    expect(rollTier(() => 0.9).key).toBe("big");
    expect(rollTier(() => 0.9999999).key).toBe("big");
  });
});

describe("overlap · 矩形相交", () => {
  it("相交 / 贴边 / 分离 / 零面积", () => {
    const base = box(10, 10, 10, 10);
    expect(overlap(base, base)).toBe(true);
    expect(overlap(base, box(15, 12, 5, 5))).toBe(true);
    // 贴边不算重叠
    expect(overlap(base, box(20, 10, 5, 5))).toBe(false);
    expect(overlap(base, box(21, 10, 5, 5))).toBe(false);
    // 只有 x 重叠、y 不重叠
    expect(overlap(base, box(12, 30, 5, 5))).toBe(false);
    // 只有 y 重叠、x 不重叠
    expect(overlap(base, box(40, 12, 5, 5))).toBe(false);
    // 零面积视为不重叠
    expect(overlap(base, box(10, 10, 0, 10))).toBe(false);
    expect(overlap(base, box(10, 10, 10, 0))).toBe(false);
  });
});

describe("选中奖品", () => {
  it("对准某个奖品时选中的就是它", () => {
    const prizes = layoutPrizes(168, seeded(5));
    const target = prizes[2];
    expect(target).toBeDefined();
    if (!target) return;

    const picked = pickPrize(prizes, prizeCenterX(target));
    expect(picked?.id).toBe(target.id);
    expect(picked?.tier).toBe(target.tier);
  });

  it("选最近的那个：最左端选第一个，最右端选最后一个", () => {
    const prizes = layoutPrizes(168, seeded(11));
    const first = prizes[0];
    const last = prizes[prizes.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (!first || !last) return;

    expect(pickPrize(prizes, 0)?.id).toBe(first.id);
    expect(pickPrize(prizes, 999)?.id).toBe(last.id);
    // 落在两个奖品正中间时一定是其中之一，不会凭空返回 null
    expect(pickPrize(prizes, 84)).not.toBeNull();
  });

  it("空奖池返回 null（爪子抓空气）", () => {
    expect(pickPrize([], 84)).toBeNull();
    expect(pickPrize([], CLAW_MIN)).toBeNull();
  });

  it("offset 按奖品中心算", () => {
    const prize = { x: 40, y: 100, w: 20, h: 10, id: 0, tier: "small" as const, points: 10 };
    expect(prizeCenterX(prize)).toBe(50);
    expect(offsetToPrize(prize, 50)).toBe(0);
    expect(offsetToPrize(prize, 70)).toBe(20);
    expect(offsetToPrize(prize, -10)).toBe(60);
    // offset 正好是 24 时落在最低概率点
    expect(grabChance(offsetToPrize(prize, 74))).toBe(0.06);
  });
});

describe("爪子移动", () => {
  it("松手静止，按住就是 90px/s（规格值，不随按住时长变化）", () => {
    expect(clawSpeed(false)).toBe(0);
    expect(clawSpeed(0)).toBe(0);
    expect(clawSpeed(true)).toBe(CLAW_SPEED);
    expect(CLAW_SPEED).toBe(90);

    // 传毫秒数也只认「有没有按住」：轻点与长按同速，符合规格
    for (const ms of [1, 30, 60, 120, 179, 180, 400]) {
      expect(clawSpeed(ms)).toBe(CLAW_SPEED);
    }
  });

  it("越界被夹在 12..156", () => {
    expect(clampClaw(-100)).toBe(CLAW_MIN);
    expect(clampClaw(1000)).toBe(CLAW_MAX);
    expect(clampClaw(84)).toBe(84);
    expect(stepClaw(CLAW_MIN, -1, 180, 1000)).toBe(CLAW_MIN);
    expect(stepClaw(CLAW_MAX, 1, 180, 1000)).toBe(CLAW_MAX);
    expect(stepClaw(84, 0, 180, 1000)).toBe(84);
  });

  it("一帧位移和速度一致（满速 100ms ≈ 9px）", () => {
    const start = 84;
    const next = stepClaw(start, 1, 180, 100);
    expect(next).toBeCloseTo(start + 9, 10);
    expect(stepClaw(start, -1, 180, 100)).toBeCloseTo(start - 9, 10);
  });
});

describe("计分", () => {
  it("按档位给底分：10 / 25 / 60", () => {
    expect(scoreForPrize("small")).toBe(10);
    expect(scoreForPrize("mid")).toBe(25);
    expect(scoreForPrize("big")).toBe(60);
    expect(scoreForPrize(tierOf("mid"))).toBe(25);
  });

  it("连抓每级 +5，负数当 0", () => {
    expect(scoreForPrize("small", 0)).toBe(10);
    expect(scoreForPrize("small", 1)).toBe(15);
    expect(scoreForPrize("small", 3)).toBe(25);
    expect(scoreForPrize("big", 1)).toBe(65);
    expect(scoreForPrize("big", 4)).toBe(80);
    expect(scoreForPrize("big", -2)).toBe(60);
    // 一局十次全连抓也不会溢出 HUD 的 5 位
    expect(scoreForPrize("big", 10)).toBeLessThanOrEqual(99999);
  });
});
