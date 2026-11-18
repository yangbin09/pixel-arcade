/**
 * 打地鼠的纯逻辑：3×3 地鼠格上的光标移动。
 *
 * 不碰 DOM / Canvas，方便单测；索引按行优先排列，
 * 和 index.ts 里 `row * 3 + col` 的格子编号一致。
 */

/** 地鼠格：3 列 × 3 行。 */
export const CURSOR_COLS = 3;
export const CURSOR_ROWS = 3;

/** 默认停在中间那格。 */
export const CURSOR_HOME = 4;

/**
 * 方向键 / 虚拟手柄 D-pad 移动光标。
 *
 * - 只处理 left / right / up / down，其它动作原样返回。
 * - 边界 clamp，不循环：在第一列按 left 仍停在第一列。
 * - 非法 cursor 会先夹回有效范围，保证返回值始终是合法格子。
 */
export function moveCursor(cursor: number, action: string, cols: number, rows: number): number {
  const width = Math.max(1, Math.floor(cols));
  const height = Math.max(1, Math.floor(rows));
  const total = width * height;
  const start = Math.min(total - 1, Math.max(0, Math.floor(Number.isFinite(cursor) ? cursor : 0)));
  const col = start % width;
  const row = Math.floor(start / width);

  if (action === "left") return row * width + Math.max(0, col - 1);
  if (action === "right") return row * width + Math.min(width - 1, col + 1);
  if (action === "up") return Math.max(0, row - 1) * width + col;
  if (action === "down") return Math.min(height - 1, row + 1) * width + col;
  return start;
}
