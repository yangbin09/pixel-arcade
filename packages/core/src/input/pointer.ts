import type { PixelSurface } from "../render/surface";

export type PointerPhase = "down" | "move" | "up" | "cancel" | "leave";

export interface PointerEventInfo {
  /** 逻辑像素坐标（已经是游戏坐标系）。 */
  x: number;
  y: number;
  /** 原始事件，需要判断 pointerType / 按钮时用。 */
  source: PointerEvent;
  /** 是否处于按下状态（up/cancel 事件里为 false）。 */
  down: boolean;
}

type Handler = (info: PointerEventInfo) => void;

/**
 * 指针输入：把屏幕坐标统一换算成游戏逻辑坐标，并处理指针捕获。
 * 触屏、鼠标、笔都走同一条通路。
 */
export class PointerInput {
  readonly el: HTMLElement;
  readonly surface: PixelSurface;
  down = false;
  x = 0;
  y = 0;
  hover = false;
  lastPointerType = "mouse";

  private handlers = new Map<PointerPhase, Set<Handler>>();
  private capturedId: number | null = null;
  private readonly preventDefault: boolean;

  constructor(el: HTMLElement, surface: PixelSurface, options: { preventDefault?: boolean } = {}) {
    this.el = el;
    this.surface = surface;
    this.preventDefault = options.preventDefault ?? true;

    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("pointerleave", this.onLeave);
  }

  on(phase: PointerPhase, handler: Handler): () => void {
    let set = this.handlers.get(phase);
    if (!set) {
      set = new Set();
      this.handlers.set(phase, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  private emit(phase: PointerPhase, source: PointerEvent): void {
    const set = this.handlers.get(phase);
    if (!set) return;
    const point = this.surface.toLogical(source.clientX, source.clientY);
    const info: PointerEventInfo = {
      x: point.x,
      y: point.y,
      source,
      down: this.down,
    };
    for (const handler of set) handler(info);
  }

  private onDown = (event: PointerEvent): void => {
    if (this.capturedId !== null) return;
    if (this.preventDefault) event.preventDefault();
    this.down = true;
    this.hover = true;
    this.lastPointerType = event.pointerType || "mouse";
    this.capturedId = event.pointerId;
    try {
      this.el.setPointerCapture(event.pointerId);
    } catch {
      /* 某些浏览器在合成事件下会抛错 */
    }
    this.emit("down", event);
  };

  private onMove = (event: PointerEvent): void => {
    this.hover = true;
    this.emit("move", event);
  };

  private onUp = (event: PointerEvent): void => {
    if (this.capturedId !== null && event.pointerId !== this.capturedId) return;
    this.down = false;
    try {
      if (this.el.hasPointerCapture(event.pointerId)) this.el.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    this.capturedId = null;
    this.emit("up", event);
  };

  private onCancel = (event: PointerEvent): void => {
    this.down = false;
    this.capturedId = null;
    this.emit("cancel", event);
  };

  private onLeave = (event: PointerEvent): void => {
    this.hover = false;
    this.emit("leave", event);
  };

  destroy(): void {
    this.el.removeEventListener("pointerdown", this.onDown);
    this.el.removeEventListener("pointermove", this.onMove);
    this.el.removeEventListener("pointerup", this.onUp);
    this.el.removeEventListener("pointercancel", this.onCancel);
    this.el.removeEventListener("pointerleave", this.onLeave);
    this.handlers.clear();
  }
}
