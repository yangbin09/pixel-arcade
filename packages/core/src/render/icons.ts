/** 像素图标：11x11 位图，按目标 CSS 尺寸整数放大。 */

const ICONS: Record<string, string[]> = {
  joystick: [
    "...........",
    "....ooo....",
    "...o+++o...",
    "...o+++o...",
    "....ooo....",
    ".....#.....",
    ".....#.....",
    "..#######..",
    ".o#*###*#o.",
    ".o#######o.",
    "..ooooooo..",
  ],
  sound: [
    "...........",
    "....#......",
    "...##..#...",
    "..###.#.#..",
    "#####.#..#.",
    "#####.#..#.",
    "#####.#..#.",
    "..###.#.#..",
    "...##..#...",
    "....#......",
    "...........",
  ],
  muted: [
    "...........",
    "....#......",
    "...##.x...x",
    "..###.x.x..",
    "#####..x...",
    "#####.x.x..",
    "#####.x...x",
    "..###......",
    "...##......",
    "....#......",
    "...........",
  ],
  pause: [
    "...........",
    "..##...##..",
    "..##...##..",
    "..##...##..",
    "..##...##..",
    "..##...##..",
    "..##...##..",
    "..##...##..",
    "..##...##..",
    "...........",
    "...........",
  ],
  play: [
    "...........",
    "..#........",
    "..##.......",
    "..###......",
    "..####.....",
    "..#####....",
    "..####.....",
    "..###......",
    "..##.......",
    "..#........",
    "...........",
  ],
  back: [
    "...........",
    "...#.......",
    "..##.......",
    ".###.......",
    "###########",
    "###########",
    ".###.......",
    "..##.......",
    "...#.......",
    "...........",
    "...........",
  ],
  restart: [
    "....###....",
    "...#...#...",
    "..#.....#..",
    "..#....###.",
    "..#........",
    "..#........",
    "..#.....#..",
    "...#...#...",
    "....###....",
    "...........",
    "...........",
  ],
};

export type IconName = keyof typeof ICONS;
export type IconColors = Record<string, string>;

const DEFAULT_INK: IconColors = {
  "#": "#f0e5ca",
  "+": "#f3a841",
  "*": "#a6d96b",
  x: "#d9523f",
  o: "#4b2f1c",
};

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function hasIcon(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

export function paintIcon(
  canvas: HTMLCanvasElement | null,
  name: string,
  targetCss = 22,
  colors: IconColors = {},
): void {
  const bitmap = ICONS[name];
  if (!bitmap || !canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 4);
  const cols = bitmap[0]!.length;
  const rows = bitmap.length;
  const unit = Math.max(1, Math.round((targetCss / cols) * dpr));
  const w = cols * unit;
  const h = rows * unit;

  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w / dpr}px`;
  canvas.style.height = `${h / dpr}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  const ink = { ...DEFAULT_INK, ...colors };

  for (let row = 0; row < rows; row += 1) {
    const line = bitmap[row]!;
    for (let col = 0; col < cols; col += 1) {
      const ch = line[col]!;
      if (!ch || ch === ".") continue;
      const color = ink[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(col * unit, row * unit, unit, unit);
    }
  }

  canvas.dataset.icon = name;
  canvas.dataset.iconSize = String(targetCss);
}

/** 重绘作用域内所有 canvas[data-icon]，resize / DPR 变化后调用。 */
export function paintAllIcons(root: ParentNode = document): void {
  const list = root.querySelectorAll<HTMLCanvasElement>("canvas[data-icon]");
  for (const canvas of Array.from(list)) {
    const name = canvas.dataset.icon ?? "";
    if (!hasIcon(name)) continue;
    paintIcon(canvas, name, Number(canvas.dataset.iconSize) || 22);
  }
}
