import type { PadSpec } from "../game";
import type { KeyMap } from "./keys";
import { Sound } from "../audio";

/** 触屏上的短振动；iOS Safari 没有这个 API，自动忽略。 */
function buzz(ms = 7): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* 不支持或权限被拒 */
  }
}

export interface PadOptions {
  /** START：准备界面直接开局，游戏中暂停/继续。 */
  onStart: () => void;
  /** 拉手/机台开关要求展开或收起时通知壳层（持久化 + 同步开关）。 */
  onToggle?: (visible: boolean) => void;
}

/**
 * 虚拟手柄：DOM 按钮，天生支持多指。
 *
 * 每个按钮独立 pointer capture，按住的键会记在 KeyMap 的 virtualHeld 里，
 * 和物理键盘完全解耦；同一个动作被两个键同时按住时用计数避免提前松开。
 */
export class Pad {
  readonly root: HTMLElement;
  private readonly keys: KeyMap;
  private readonly options: PadOptions;
  private readonly counts = new Map<string, number>();
  private readonly cleanup: (() => void)[] = [];
  private readonly spec: PadSpec | null;
  private handle: HTMLButtonElement | null = null;
  private controls: HTMLElement | null = null;
  private collapsed = false;

  constructor(root: HTMLElement, spec: PadSpec | undefined, keys: KeyMap, options: PadOptions) {
    this.root = root;
    this.keys = keys;
    this.options = options;
    this.spec = spec ?? null;

    if (!spec) {
      root.hidden = true;
      return;
    }

    this.build(spec);
  }

  get visible(): boolean {
    return !this.root.hidden && !this.collapsed;
  }

  setVisible(visible: boolean): void {
    if (!this.spec) {
      this.root.hidden = true;
      return;
    }
    if (!visible) this.releaseAll();
    this.collapsed = !visible;
    this.root.classList.toggle("is-collapsed", this.collapsed);
    if (this.controls) this.controls.hidden = this.collapsed;
    if (this.handle) {
      this.handle.setAttribute("aria-expanded", String(!this.collapsed));
      this.handle.setAttribute("aria-label", this.collapsed ? "展开虚拟手柄" : "收起虚拟手柄");
    }
  }

  destroy(): void {
    this.releaseAll();
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    this.handle = null;
    this.controls = null;
    this.root.replaceChildren();
  }

  private build(spec: PadSpec): void {
    this.root.replaceChildren();
    this.root.hidden = false;
    this.root.dataset.dpad = spec.dpad ?? "none";

    const dpad = this.buildDpad(spec);
    const face = this.buildFace(spec);
    const start = spec.start === false ? null : this.buildStart();

    if (!dpad && !face && !start) {
      this.root.hidden = true;
      return;
    }

    this.handle = this.buildHandle();
    this.controls = document.createElement("div");
    this.controls.className = "pad-controls";
    if (dpad) this.controls.append(dpad);
    if (start) this.controls.append(start);
    if (face) this.controls.append(face);

    this.root.append(this.handle, this.controls);
    this.setVisible(true);
  }

  private buildHandle(): HTMLButtonElement {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "pad-handle";
    handle.setAttribute("aria-expanded", "true");
    handle.setAttribute("aria-label", "收起虚拟手柄");
    const label = document.createElement("span");
    label.textContent = "PAD";
    const chevron = document.createElement("i");
    chevron.setAttribute("aria-hidden", "true");
    handle.append(label, chevron);
    handle.addEventListener("click", this.onHandleClick);
    this.cleanup.push(() => handle.removeEventListener("click", this.onHandleClick));
    return handle;
  }

  private onHandleClick = (): void => {
    this.options.onToggle?.(!this.visible);
  };

  private buildDpad(spec: PadSpec): HTMLElement | null {
    const shape = spec.dpad ?? "none";
    if (shape === "none") return null;

    const wrap = document.createElement("div");
    wrap.className = "pad-dpad";
    wrap.dataset.shape = shape;
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "方向键");

    const hub = document.createElement("span");
    hub.className = "pad-dpad-hub";
    hub.setAttribute("aria-hidden", "true");

    const directions: { dir: "up" | "down" | "left" | "right"; label: string }[] =
      shape === "lr"
        ? [
            { dir: "left", label: "左" },
            { dir: "right", label: "右" },
          ]
        : [
            { dir: "up", label: "上" },
            { dir: "left", label: "左" },
            { dir: "right", label: "右" },
            { dir: "down", label: "下" },
          ];

    for (const { dir, label } of directions) {
      const action = spec[dir] ?? dir;
      const button = this.button(`pad-dir pad-dir--${dir}`, label, action, "arrow");
      button.dataset.dir = dir;
      wrap.append(button);
    }

    if (shape === "four") wrap.append(hub);
    return wrap;
  }

  private buildFace(spec: PadSpec): HTMLElement | null {
    if (!spec.a && !spec.b) return null;

    const wrap = document.createElement("div");
    wrap.className = "pad-face";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "操作键");

    if (spec.b) wrap.append(this.button("pad-round pad-round--b", "B", spec.b.action, "letter", spec.b.label));
    if (spec.a) wrap.append(this.button("pad-round pad-round--a", "A", spec.a.action, "letter", spec.a.label));
    return wrap;
  }

  private buildStart(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "pad-start-wrap";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pad-start";
    button.textContent = "START";
    button.setAttribute("aria-label", "开始或暂停");
    this.bindStart(button);
    wrap.append(button);
    return wrap;
  }

  /**
   * 创建一个按住型按键。
   * kind=letter 时按钮显示大字母 + 下方小标签；arrow 时只显示箭头。
   */
  private button(
    className: string,
    text: string,
    action: string,
    kind: "arrow" | "letter",
    subLabel?: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;

    if (kind === "letter") {
      const letter = document.createElement("b");
      letter.textContent = text;
      const label = document.createElement("span");
      label.textContent = subLabel ?? "";
      button.append(letter, label);
      button.setAttribute("aria-label", subLabel ? `${text}：${subLabel}` : text);
    } else {
      const arrow = document.createElement("i");
      arrow.setAttribute("aria-hidden", "true");
      button.append(arrow);
      button.setAttribute("aria-label", text);
    }

    let active = false;

    const down = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      if (active) return;
      active = true;
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        /* 合成事件可能不支持 */
      }
      button.classList.add("is-down");
      this.add(action);
      Sound.pad();
      buzz();
    };

    const up = (): void => {
      if (!active) return;
      active = false;
      button.classList.remove("is-down");
      this.remove(action);
    };

    const onPointerDown = down;
    const onPointerUp = up;
    const onCancel = up;
    const onLost = up;
    const onContext = (event: Event): void => event.preventDefault();
    const onClick = (event: MouseEvent): void => {
      // 键盘回车/空格触发的 click，detail 为 0；指针点击已经在 pointerdown 处理过
      if (event.detail !== 0) return;
      event.preventDefault();
      this.pulse(action);
    };

    button.addEventListener("pointerdown", onPointerDown);
    button.addEventListener("pointerup", onPointerUp);
    button.addEventListener("pointercancel", onCancel);
    button.addEventListener("lostpointercapture", onLost);
    button.addEventListener("contextmenu", onContext);
    button.addEventListener("click", onClick);

    this.cleanup.push(() => {
      button.removeEventListener("pointerdown", onPointerDown);
      button.removeEventListener("pointerup", onPointerUp);
      button.removeEventListener("pointercancel", onCancel);
      button.removeEventListener("lostpointercapture", onLost);
      button.removeEventListener("contextmenu", onContext);
      button.removeEventListener("click", onClick);
    });

    return button;
  }

  private bindStart(button: HTMLButtonElement): void {
    let active = false;
    const down = (event: PointerEvent): void => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      if (active) return;
      active = true;
      button.classList.add("is-down");
      this.options.onStart();
      Sound.ui();
      buzz(10);
    };
    const up = (): void => {
      if (!active) return;
      active = false;
      button.classList.remove("is-down");
    };
    const onClick = (event: MouseEvent): void => {
      if (event.detail !== 0) return;
      event.preventDefault();
      this.options.onStart();
      Sound.ui();
    };

    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("lostpointercapture", up);
    button.addEventListener("click", onClick);
    this.cleanup.push(() => {
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointerup", up);
      button.removeEventListener("pointercancel", up);
      button.removeEventListener("lostpointercapture", up);
      button.removeEventListener("click", onClick);
    });
  }

  /** 键盘无障碍：按一下松开，不进入 held。 */
  private pulse(action: string): void {
    this.add(action);
    Sound.pad();
    window.setTimeout(() => this.remove(action), 90);
  }

  private add(action: string): void {
    const next = (this.counts.get(action) ?? 0) + 1;
    this.counts.set(action, next);
    if (next === 1) this.keys.press(action);
  }

  private remove(action: string): void {
    const current = this.counts.get(action) ?? 0;
    if (current <= 1) {
      this.counts.delete(action);
      this.keys.release(action);
    } else {
      this.counts.set(action, current - 1);
    }
  }

  private releaseAll(): void {
    for (const action of [...this.counts.keys()]) {
      this.counts.delete(action);
      this.keys.release(action);
    }
  }
}
