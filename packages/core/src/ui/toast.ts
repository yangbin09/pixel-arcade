export interface ToastOptions {
  warn?: boolean;
  duration?: number;
}

/** 画面上方的小提示，沿用旧版 .toast 动画。 */
export class Toast {
  readonly el: HTMLElement;
  private timer = 0;
  private cleanup = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.hidden = true;
  }

  show(text: string, options: ToastOptions = {}): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.cleanup);
    this.el.textContent = text;
    this.el.classList.toggle("is-warn", !!options.warn);
    this.el.hidden = false;
    this.el.classList.remove("is-show");
    void this.el.offsetWidth;
    this.el.classList.add("is-show");
    const duration = options.duration ?? 1000;
    this.timer = window.setTimeout(() => {
      this.el.classList.remove("is-show");
      this.cleanup = window.setTimeout(() => {
        this.el.hidden = true;
      }, 180);
    }, duration);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.cleanup);
    this.el.classList.remove("is-show", "is-warn");
    this.el.hidden = true;
  }

  destroy(): void {
    this.hide();
  }
}
