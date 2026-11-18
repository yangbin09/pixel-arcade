/** 固定 dt 上限的主循环：切后台回来不会瞬移，暂停时完全停止更新。 */

export interface LoopOptions {
  update: (dt: number, now: number) => void;
  render: () => void;
  /** 单帧最大步长（毫秒），默认 50。 */
  maxDelta?: number;
}

export class Loop {
  running = false;
  private raf = 0;
  private last = 0;
  private readonly options: LoopOptions;

  constructor(options: LoopOptions) {
    this.options = options;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const max = this.options.maxDelta ?? 50;
    const dt = Math.min(Math.max(now - this.last, 0), max);
    this.last = now;
    this.options.update(dt, now);
    this.options.render();
    this.raf = requestAnimationFrame(this.tick);
  };
}
