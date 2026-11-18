import { mulberry32 } from "@arcade/core";
import { describe, expect, it } from "vitest";

import { ICON_IDS, iconRows } from "../src/art";
import { accuracyPercent, buildDeck, timeScore } from "../src/index";

describe("buildDeck · 洗牌", () => {
  it("16 张牌，8 对图案各出现两次", () => {
    const deck = buildDeck(mulberry32(7));
    expect(deck).toHaveLength(16);
    expect(ICON_IDS).toHaveLength(8);
    for (let icon = 0; icon < ICON_IDS.length; icon += 1) {
      expect(deck.filter((value) => value === icon)).toHaveLength(2);
    }
  });

  it("同一个种子得到同一副牌", () => {
    expect(buildDeck(mulberry32(99))).toEqual(buildDeck(mulberry32(99)));
  });

  it("洗牌后不再是 0,0,1,1… 的顺序", () => {
    const deck = buildDeck(mulberry32(2));
    const sequential = deck.every((value, index) => value === Math.floor(index / 2));
    expect(sequential).toBe(false);
  });

  it("随机源只有 0 时也能洗完 16 张", () => {
    const deck = buildDeck(() => 0);
    expect(deck).toHaveLength(16);
    expect(new Set(deck).size).toBe(8);
  });
});

describe("accuracyPercent · 正确率", () => {
  it("全对是 100%", () => {
    expect(accuracyPercent(8, 8)).toBe(100);
  });

  it("8 对用了 10 步是 80%", () => {
    expect(accuracyPercent(8, 10)).toBe(80);
  });

  it("还没翻过牌时是 0%", () => {
    expect(accuracyPercent(0, 0)).toBe(0);
  });

  it("不会超过 100% 或低于 0%", () => {
    expect(accuracyPercent(9, 8)).toBe(100);
    expect(accuracyPercent(-1, 8)).toBe(0);
  });
});

describe("timeScore · 低分成绩", () => {
  it("不足一秒也记 1 秒", () => {
    expect(timeScore(0)).toBe(1);
    expect(timeScore(999)).toBe(1);
  });

  it("向上取整到秒", () => {
    expect(timeScore(1000)).toBe(1);
    expect(timeScore(1001)).toBe(2);
    expect(timeScore(13500)).toBe(14);
  });

  it("封顶 999 秒，避免分数溢出", () => {
    expect(timeScore(998001)).toBe(999);
    expect(timeScore(10_000_000)).toBe(999);
  });
});

describe("art · 图案尺寸", () => {
  it("8 个图案都是 16×16", () => {
    expect(ICON_IDS).toHaveLength(8);
    for (const id of ICON_IDS) {
      const rows = iconRows(id);
      expect(rows).toHaveLength(16);
      for (const row of rows) expect(row).toHaveLength(16);
    }
  });
});
