import { GLYPHS, normalizeText } from "./font";

export interface PixelTextOptions {
  /** 每个像素点占多少屏幕像素（默认 3）。 */
  size?: number;
  color?: string;
  /** 硬阴影颜色，给了就画。 */
  shadow?: string | null;
  /** 数字补零位数。 */
  pad?: number;
  /** 固定占位字符数，避免数字变化时抖动。 */
  minChars?: number;
}

/**
 * 把一行像素字画到独立 canvas 上（HUD、结算数字）。
 * 尺寸按 DPR 放大，CSS 尺寸再缩回去，保证清晰。
 */
export class PixelText {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  size: number;
  color: string;
  shadow: string | null;
  pad: number;
  minChars: number;
  value = "";

  constructor(canvas: HTMLCanvasElement, options: PixelTextOptions = {}) {
    this.el = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context 不可用");
    this.ctx = ctx;
    this.size = options.size ?? 3;
    this.color = options.color ?? "#f0e5ca";
    this.shadow = options.shadow ?? null;
    this.pad = options.pad ?? 0;
    this.minChars = options.minChars ?? 0;
    this.draw("");
  }

  private draw(text: string): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    const unit = Math.max(1, Math.round(this.size * dpr));
    const chars = Math.max(1, text.length, this.minChars);
    const extra = this.shadow ? 1 : 0;
    const w = (Math.max(1, chars * 6 - 1) + extra) * unit;
    const h = (7 + extra) * unit;
    const canvas = this.el;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    const paint = (ink: string, ox: number, oy: number): void => {
      ctx.fillStyle = ink;
      let cursor = ox;
      for (let i = 0; i < text.length; i += 1) {
        const glyph = GLYPHS[text[i]] ?? GLYPHS["?"]!;
        for (let row = 0; row < 7; row += 1) {
          const line = glyph[row] ?? "";
          for (let col = 0; col < 5; col += 1) {
            if (line[col] === "1") {
              ctx.fillRect(cursor + col * unit, oy + row * unit, unit, unit);
            }
          }
        }
        cursor += 6 * unit;
      }
    };

    if (this.shadow) paint(this.shadow, unit, unit);
    paint(this.color, 0, 0);

    canvas.style.width = `${w / dpr}px`;
    canvas.style.height = `${h / dpr}px`;
  }

  set(value: string | number): void {
    let text = normalizeText(value);
    if (this.pad) text = text.padStart(this.pad, "0");
    if (text === this.value) return;
    this.value = text;
    this.draw(text);
  }

  setColor(color: string): void {
    if (!color || color === this.color) return;
    this.color = color;
    this.draw(this.value);
  }

  refresh(): void {
    this.draw(this.value);
  }
}
