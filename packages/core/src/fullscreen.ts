/**
 * 全屏控制：三层策略，任何设备都能「沉浸运行」。
 *
 * 1. 原生全屏   —— 支持 Element.requestFullscreen 的浏览器（桌面 / Android / iPad）
 * 2. 沉浸回退   —— iPhone Safari 不支持元素全屏，用 100dvh + 隐藏页框模拟
 * 3. 桌面临界   —— 都不支持时至少把画布放到最大，并提示用 F11
 *
 * 额外：进入全屏时尝试锁定竖屏、申请屏幕唤醒锁，退出/切后台自动释放。
 */

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

interface WakeLockLike {
  release: () => Promise<void>;
}

interface WakeLockNavigator {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> };
}

export type FullscreenChangeHandler = (active: boolean, native: boolean) => void;

const IMMERSIVE_CLASS = "is-immersive";

export class FullscreenController {
  readonly target: HTMLElement;
  private handlers = new Set<FullscreenChangeHandler>();
  private wakeLock: WakeLockLike | null = null;
  private immersive = false;
  private lastActive = false;

  constructor(target: HTMLElement) {
    this.target = target;
    document.addEventListener("fullscreenchange", this.handleChange);
    document.addEventListener("webkitfullscreenchange", this.handleChange as EventListener);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** 浏览器是否支持真正的元素全屏。 */
  get canNative(): boolean {
    const el = this.target as FsElement;
    return typeof el.requestFullscreen === "function" || typeof el.webkitRequestFullscreen === "function";
  }

  get native(): boolean {
    const doc = document as FsDocument;
    return (doc.fullscreenElement ?? doc.webkitFullscreenElement) === this.target;
  }

  get active(): boolean {
    return this.native || this.immersive;
  }

  onChange(handler: FullscreenChangeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** 必须在用户手势里调用（点击「开始」时顺带请求，成功率最高）。 */
  async enter(): Promise<boolean> {
    if (this.active) return true;

    if (this.canNative && !this.native) {
      const el = this.target as FsElement;
      try {
        if (typeof el.requestFullscreen === "function") {
          await el.requestFullscreen({ navigationUI: "hide" });
        } else if (typeof el.webkitRequestFullscreen === "function") {
          await el.webkitRequestFullscreen();
        }
      } catch {
        /* 用户拒绝或浏览器策略限制 → 走沉浸回退 */
      }
    }

    if (!this.native) this.setImmersive(true);

    // 竖屏优先；桌面/已锁定方向会直接失败，忽略即可
    try {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await orientation?.lock?.("portrait");
    } catch {
      /* 不支持就算了 */
    }

    await this.acquireWakeLock();
    this.emit();
    return this.active;
  }

  async exit(): Promise<void> {
    const doc = document as FsDocument;
    if (this.native) {
      try {
        if (typeof doc.exitFullscreen === "function") await doc.exitFullscreen();
        else if (typeof doc.webkitExitFullscreen === "function") await doc.webkitExitFullscreen();
      } catch {
        /* ignore */
      }
    }
    this.setImmersive(false);
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* ignore */
    }
    await this.releaseWakeLock();
    this.emit();
  }

  async toggle(): Promise<void> {
    if (this.active) await this.exit();
    else await this.enter();
  }

  private setImmersive(on: boolean): void {
    this.immersive = on;
    document.documentElement.classList.toggle(IMMERSIVE_CLASS, on);
    document.body.classList.toggle(IMMERSIVE_CLASS, on);
    if (on) window.scrollTo(0, 0);
  }

  private async acquireWakeLock(): Promise<void> {
    if (this.wakeLock || document.visibilityState !== "visible") return;
    const nav = navigator as unknown as WakeLockNavigator;
    if (!nav.wakeLock) return;
    try {
      this.wakeLock = await nav.wakeLock.request("screen");
    } catch {
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const lock = this.wakeLock;
    this.wakeLock = null;
    if (!lock) return;
    try {
      await lock.release();
    } catch {
      /* ignore */
    }
  }

  private emit(): void {
    const active = this.active;
    if (active === this.lastActive) return;
    this.lastActive = active;
    for (const handler of this.handlers) handler(active, this.native);
  }

  private handleChange = (): void => {
    if (this.native) {
      this.immersive = false;
      document.documentElement.classList.remove(IMMERSIVE_CLASS);
      document.body.classList.remove(IMMERSIVE_CLASS);
      void this.acquireWakeLock();
    } else if (!this.immersive) {
      void this.releaseWakeLock();
    }
    this.emit();
  };

  private onVisibility = (): void => {
    if (document.visibilityState === "visible" && this.active) void this.acquireWakeLock();
  };

  destroy(): void {
    document.removeEventListener("fullscreenchange", this.handleChange);
    document.removeEventListener("webkitfullscreenchange", this.handleChange as EventListener);
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.releaseWakeLock();
    this.setImmersive(false);
    this.handlers.clear();
  }
}
