import { describe, expect, it } from "vitest";
import { GLYPHS, drawPixelText, measurePixelText, normalizeText } from "../src/render/font";

function fakeContext() {
  const calls: { x: number; y: number; w: number; h: number; color: string }[] = [];
  const ctx = {
    fillStyle: "",
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      calls.push({ x, y, w, h, color: String(this.fillStyle) });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("pixel font", () => {
  it("字库覆盖数字与大写", () => {
    for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      expect(GLYPHS[ch], ch).toBeDefined();
      expect(GLYPHS[ch]!.length).toBe(7);
    }
  });

  it("normalizeText 处理乘号与减号", () => {
    expect(normalizeText("×2")).toBe("X2");
    expect(normalizeText("3−1")).toBe("3-1");
    expect(normalizeText("abcd")).toBe("ABCD");
  });

  it("measure 按 6 格宽计算", () => {
    expect(measurePixelText("1", 2)).toBe(10);
    expect(measurePixelText("12", 2)).toBe(22);
    expect(measurePixelText("", 2)).toBe(0);
  });

  it("draw 只画有墨的像素，阴影多一轮", () => {
    const { ctx, calls } = fakeContext();
    const width = drawPixelText(ctx, "1", 0, 0, 2, "#fff");
    expect(width).toBe(10);
    const solid = calls.length;
    expect(solid).toBeGreaterThan(0);

    const shadowed = fakeContext();
    drawPixelText(shadowed.ctx, "1", 0, 0, 2, "#fff", "#000");
    expect(shadowed.calls.length).toBe(solid * 2);
  });

  it("未知字符退回问号", () => {
    const { ctx, calls } = fakeContext();
    drawPixelText(ctx, "中", 0, 0, 1, "#fff");
    expect(calls.length).toBeGreaterThan(0);
  });
});
