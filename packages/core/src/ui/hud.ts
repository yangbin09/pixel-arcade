import { P, type PaletteKey } from "../palette";
import { PixelText } from "../render/pixel-text";
import { ceilSeconds, padNumber } from "../util";

export type HudKind = "number" | "text" | "time";

export interface HudSlot {
  /** 游戏内用来 set 的 key。 */
  key: string;
  label: string;
  kind?: HudKind;
  /** 数字补零位数。 */
  pad?: number;
  /** 固定占位宽度，避免数字跳动。 */
  minChars?: number;
  /** 语义色调（对应 CSS .dot--xxx）。 */
  tone?: "time" | "score" | "combo" | "mint" | "gold" | "red" | "none";
  /** 像素字颜色，默认按 tone 取调色板。 */
  color?: PaletteKey;
  /** 数字后面跟着的小字（如 ×2 倍率）。 */
  suffix?: string;
}

const TONE_COLOR: Record<string, PaletteKey> = {
  time: "cream",
  score: "gold",
  combo: "mint",
  mint: "mint",
  gold: "gold",
  red: "red",
  none: "cream",
};

interface SlotRuntime {
  slot: HudSlot;
  stat: HTMLElement;
  canvas: HTMLCanvasElement;
  text: PixelText;
  suffixEl: HTMLElement | null;
}

/**
 * HUD：完全由 meta.hud 描述生成，玩法只负责 set 值。
 * 三栏 / 两栏自动适配，视觉沿用旧版。
 */
export class Hud {
  readonly root: HTMLElement;
  private slots = new Map<string, SlotRuntime>();

  constructor(root: HTMLElement, slots: HudSlot[]) {
    this.root = root;
    root.innerHTML = "";
    root.dataset.cols = String(Math.min(Math.max(slots.length, 1), 3));

    for (const slot of slots) {
      const stat = document.createElement("div");
      stat.className = `stat${slot.key === "score" ? " stat-score" : ""}`;
      stat.dataset.stat = slot.key;

      const label = document.createElement("span");
      label.className = "stat-label";
      const dot = document.createElement("i");
      dot.className = `dot dot--${slot.tone ?? "none"}`;
      dot.setAttribute("aria-hidden", "true");
      label.append(dot, document.createTextNode(slot.label));

      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", slot.label);
      stat.append(label);

      const colorKey = slot.color ?? TONE_COLOR[slot.tone ?? "none"] ?? "cream";
      const text = new PixelText(canvas, {
        size: 3,
        color: P[colorKey],
        pad: slot.pad,
        minChars: slot.minChars ?? (slot.kind === "time" ? 2 : slot.pad ?? 1),
      });

      let suffixEl: HTMLElement | null = null;
      if (slot.suffix) {
        const line = document.createElement("div");
        line.className = "combo-line";
        suffixEl = document.createElement("span");
        suffixEl.className = "combo-mult";
        suffixEl.textContent = slot.suffix;
        line.append(canvas, suffixEl);
        stat.append(line);
      } else {
        stat.append(canvas);
      }

      root.append(stat);
      this.slots.set(slot.key, { slot, stat, canvas, text, suffixEl });
    }
  }

  private label(runtime: SlotRuntime, shown: string): void {
    const text = `${runtime.slot.label} ${shown}`;
    if (runtime.canvas.getAttribute("aria-label") !== text) {
      runtime.canvas.setAttribute("aria-label", text);
    }
  }

  set(key: string, value: number | string): void {
    const runtime = this.slots.get(key);
    if (!runtime) return;
    const { slot, text } = runtime;
    if (typeof value === "number") {
      if (slot.kind === "time") {
        const seconds = ceilSeconds(value);
        text.set(seconds);
        this.label(runtime, String(seconds));
        return;
      }
      const shown = slot.pad ? padNumber(value, slot.pad) : String(Math.round(value));
      text.set(shown);
      this.label(runtime, shown);
      return;
    }
    text.set(value);
    this.label(runtime, value);
  }

  /** 更新后缀小字（倍率、单位、波次）。 */
  setSuffix(key: string, value: string, className = ""): void {    const runtime = this.slots.get(key);
    if (!runtime?.suffixEl) return;
    runtime.suffixEl.textContent = value;
    runtime.suffixEl.className = `combo-mult${className ? ` ${className}` : ""}`;
  }

  /** 改像素字颜色（连击倍率、倒计时警戒）。 */
  setColor(key: string, color: string): void {
    this.slots.get(key)?.text.setColor(color);
  }

  /** 数字变化时闪一下（沿用 .stat.is-bump / .is-broken 动画）。 */
  flash(key: string, className: "is-bump" | "is-broken" = "is-bump"): void {
    const runtime = this.slots.get(key);
    if (!runtime) return;
    runtime.stat.classList.remove(className);
    void runtime.stat.offsetWidth;
    runtime.stat.classList.add(className);
    window.setTimeout(() => runtime.stat.classList.remove(className), 400);
  }

  urgent(on: boolean): void {
    this.root.classList.toggle("is-urgent", on);
  }

  reset(): void {
    for (const runtime of this.slots.values()) {
      runtime.text.set(runtime.slot.kind === "time" ? 0 : runtime.slot.pad ? padNumber(0, runtime.slot.pad) : 0);
      if (runtime.suffixEl) runtime.suffixEl.textContent = runtime.slot.suffix ?? "";
    }
    this.root.classList.remove("is-urgent");
  }

  refresh(): void {
    for (const runtime of this.slots.values()) runtime.text.refresh();
  }

  destroy(): void {
    this.slots.clear();
    this.root.innerHTML = "";
  }
}
