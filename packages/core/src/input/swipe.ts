export type SwipeDirection = "up" | "down" | "left" | "right";

export interface SwipeInfo {
  direction: SwipeDirection;
  dx: number;
  dy: number;
  /** 拖动持续时间（毫秒），可以用来区分「甩」和「拖」。 */
  duration: number;
}

export interface DragInfo {
  dx: number;
  dy: number;
  x: number;
  y: number;
}

/**
 * 滑动手势：4 方向识别，触屏和鼠标拖拽都能用。
 * 2048 / 贪吃蛇这类网格游戏用它做主要输入。
 */
export class SwipeInput {
  readonly el: HTMLElement;
  threshold: number;

  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private active = false;
  private swipeHandlers = new Set<(info: SwipeInfo) => void>();
  private dragHandlers = new Set<(info: DragInfo) => void>();

  constructor(el: HTMLElement, options: { threshold?: number } = {}) {
    this.el = el;
    this.threshold = options.threshold ?? 24;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
  }

  onSwipe(handler: (info: SwipeInfo) => void): () => void {
    this.swipeHandlers.add(handler);
    return () => this.swipeHandlers.delete(handler);
  }

  onDrag(handler: (info: DragInfo) => void): () => void {
    this.dragHandlers.add(handler);
    return () => this.dragHandlers.delete(handler);
  }

  private onDown = (event: PointerEvent): void => {
    this.active = true;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.startTime = performance.now();
  };

  private onMove = (event: PointerEvent): void => {
    if (!this.active) return;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    for (const handler of this.dragHandlers) handler({ dx, dy, x: event.clientX, y: event.clientY });
  };

  private onUp = (event: PointerEvent): void => {
    if (!this.active) return;
    this.active = false;
    const dx = event.clientX - this.startX;
    const dy = event.clientY - this.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < this.threshold) return;
    const direction: SwipeDirection =
      absX > absY ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    const info: SwipeInfo = {
      direction,
      dx,
      dy,
      duration: performance.now() - this.startTime,
    };
    for (const handler of this.swipeHandlers) handler(info);
  };

  private onCancel = (): void => {
    this.active = false;
  };

  destroy(): void {
    this.el.removeEventListener("pointerdown", this.onDown);
    this.el.removeEventListener("pointermove", this.onMove);
    this.el.removeEventListener("pointerup", this.onUp);
    this.el.removeEventListener("pointercancel", this.onCancel);
    this.swipeHandlers.clear();
    this.dragHandlers.clear();
  }
}
