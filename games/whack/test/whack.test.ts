import { describe, expect, it } from "vitest";

import { CURSOR_COLS, CURSOR_HOME, CURSOR_ROWS, moveCursor } from "../src/logic";

describe("whack · 手柄光标", () => {
  it("默认光标在 3×3 的中间格", () => {
    expect(CURSOR_COLS).toBe(3);
    expect(CURSOR_ROWS).toBe(3);
    expect(CURSOR_HOME).toBe(4);
  });

  it("四个方向各走一格，按行优先编号", () => {
    expect(moveCursor(4, "left", 3, 3)).toBe(3);
    expect(moveCursor(4, "right", 3, 3)).toBe(5);
    expect(moveCursor(4, "up", 3, 3)).toBe(1);
    expect(moveCursor(4, "down", 3, 3)).toBe(7);
  });

  it("角落 clamp，不循环到另一侧", () => {
    expect(moveCursor(0, "left", 3, 3)).toBe(0);
    expect(moveCursor(0, "up", 3, 3)).toBe(0);
    expect(moveCursor(2, "right", 3, 3)).toBe(2);
    expect(moveCursor(2, "down", 3, 3)).toBe(5);
    expect(moveCursor(6, "left", 3, 3)).toBe(6);
    expect(moveCursor(6, "down", 3, 3)).toBe(6);
    expect(moveCursor(8, "right", 3, 3)).toBe(8);
    expect(moveCursor(8, "down", 3, 3)).toBe(8);
  });

  it("左右移动只在当前行内，不会跨行", () => {
    expect(moveCursor(3, "left", 3, 3)).toBe(3);
    expect(moveCursor(5, "right", 3, 3)).toBe(5);
    expect(moveCursor(3, "down", 3, 3)).toBe(6);
    expect(moveCursor(6, "up", 3, 3)).toBe(3);
  });

  it("非方向动作（A 键 / 数字键）不移动光标", () => {
    expect(moveCursor(4, "action", 3, 3)).toBe(4);
    expect(moveCursor(2, "slot5", 3, 3)).toBe(2);
    expect(moveCursor(8, "primary", 3, 3)).toBe(8);
  });

  it("任意连续移动都留在 0..8", () => {
    const actions = ["left", "right", "up", "down"];
    let cursor = CURSOR_HOME;
    for (let step = 0; step < 200; step += 1) {
      cursor = moveCursor(cursor, actions[step % actions.length]!, 3, 3);
      expect(cursor).toBeGreaterThanOrEqual(0);
      expect(cursor).toBeLessThanOrEqual(8);
    }
  });
});
