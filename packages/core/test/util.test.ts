import { describe, expect, it } from "vitest";
import {
  approach,
  clamp,
  easeOutBack,
  easeOutCubic,
  lerp,
  mulberry32,
  padNumber,
  shuffle,
  wave,
} from "../src/util";

describe("util", () => {
  it("clamp 夹住边界", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
    expect(clamp(1.5, 0, 3)).toBe(1.5);
  });

  it("lerp 与 approach", () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(10, 0, 3)).toBe(7);
  });

  it("缓动端点正确", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
    expect(wave(0)).toBeCloseTo(0.5, 6);
  });

  it("mulberry32 同种子同序列", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it("shuffle 不改原数组且元素一致", () => {
    const source = [1, 2, 3, 4, 5];
    const out = shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5]);
    expect(out.slice().sort()).toEqual(source);
  });

  it("padNumber 补零且不吃负数", () => {
    expect(padNumber(7, 5)).toBe("00007");
    expect(padNumber(-3, 3)).toBe("000");
    expect(padNumber(123456, 4)).toBe("123456");
  });
});
