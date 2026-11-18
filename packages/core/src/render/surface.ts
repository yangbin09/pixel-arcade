/**
 * 像素画布：逻辑分辨率固定，按整数倍放大到屏幕，永远不糊。
 * 负责 DPR、容器尺寸、全屏/旋转/resize 的统一重排。
 */

export interface SurfaceFit {
  unit: number;
  cssW: number;
  cssH: number;
  dpr: number;
}

export class PixelSurface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly container: HTMLElement;

  unit = 1;
  cssW = 0;
  cssH = 0;
  dpr = 1;

  private listeners = new Set<(fit: SurfaceFit) => void>();
  private observer: ResizeObserver | null = null;
  private queued = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, w: number, h: number, container: HTMLElement) {
    this.canvas = canvas;
    this.w = w;
    this.h = h;
    this.container = container;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("canvas 2d context 不可用");
    this.ctx = ctx;

    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(container);
    }
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("orientationchange", this.onViewportChange);
    window.visualViewport?.addEventListener("resize", this.onViewportChange);
    document.addEventListener("fullscreenchange", this.onViewportChange);

    this.fit();
  }

  private onViewportChange = (): void => this.schedule();

  schedule(): void {
    if (this.queued || this.disposed) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.fit();
    });
  }

  /** 重新计算整数缩放；返回尺寸是否发生变化。 */
  fit(): boolean {
    const boxW = this.container.clientWidth;
    const boxH = this.container.clientHeight;
    if (boxW <= 0 || boxH <= 0) return false;

    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 4);
    const unit = Math.max(1, Math.floor(Math.min((boxW * dpr) / this.w, (boxH * dpr) / this.h)));
    const cssW = (this.w * unit) / dpr;
    const cssH = (this.h * unit) / dpr;

    const same = unit === this.unit && Math.abs(cssW - this.cssW) < 0.01 && Math.abs(cssH - this.cssH) < 0.01;

    if (this.canvas.width !== this.w * unit || this.canvas.height !== this.h * unit) {
      this.canvas.width = this.w * unit;
      this.canvas.height = this.h * unit;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    this.unit = unit;
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;

    const ctx = this.ctx;
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    ctx.imageSmoothingEnabled = false;

    if (!same) {
      const info: SurfaceFit = { unit, cssW, cssH, dpr };
      for (const listener of this.listeners) listener(info);
    }
    return !same;
  }

  onFit(listener: (fit: SurfaceFit) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 屏幕坐标 → 逻辑像素坐标。 */
  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * this.w,
      y: ((clientY - rect.top) / rect.height) * this.h,
    };
  }

  destroy(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("orientationchange", this.onViewportChange);
    window.visualViewport?.removeEventListener("resize", this.onViewportChange);
    document.removeEventListener("fullscreenchange", this.onViewportChange);
    this.listeners.clear();
  }
}
