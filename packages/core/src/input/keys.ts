import { isInteractiveTarget } from "../dom";

/** 键位名归一化：' ' → 'space'，其余小写。 */
function normalizeKey(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  if (key === " " || key === "spacebar") return "space";
  if (key === "esc") return "escape";
  if (key === "arrowup" || key === "up") return "arrowup";
  if (key === "arrowdown" || key === "down") return "arrowdown";
  if (key === "arrowleft" || key === "left") return "arrowleft";
  if (key === "arrowright" || key === "right") return "arrowright";
  return key;
}

export interface KeyMapOptions {
  /** 绑定键是否 preventDefault（方向键、空格必须），默认 true。 */
  preventDefault?: boolean;
  /** 焦点在按钮/输入框时不响应，默认 true。 */
  ignoreInteractive?: boolean;
}

type PressHandler = (action: string, event?: KeyboardEvent) => void;
type ReleaseHandler = (action: string, event?: KeyboardEvent) => void;

/**
 * 键盘 + 虚拟手柄输入：把物理键/屏幕按键映射成语义动作（left/right/rotate…）。
 * 同时维护 held 集合，支持长按连续操作。
 *
 * 键盘和虚拟手柄分开记，避免「键盘按住左 + 手柄松开左」把键盘的手感弄丢。
 */
export class KeyMap {
  readonly bindings: Record<string, string>;
  /** 物理键盘当前按住的语义动作。 */
  readonly held = new Set<string>();
  /** 虚拟手柄当前按住的语义动作。 */
  private readonly virtualHeld = new Set<string>();
  private pressHandlers = new Set<PressHandler>();
  private releaseHandlers = new Set<ReleaseHandler>();
  private readonly options: Required<KeyMapOptions>;

  constructor(bindings: Record<string, string>, options: KeyMapOptions = {}) {
    this.bindings = bindings;
    this.options = {
      preventDefault: options.preventDefault ?? true,
      ignoreInteractive: options.ignoreInteractive ?? true,
    };
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  onPress(handler: PressHandler): () => void {
    this.pressHandlers.add(handler);
    return () => this.pressHandlers.delete(handler);
  }

  onRelease(handler: ReleaseHandler): () => void {
    this.releaseHandlers.add(handler);
    return () => this.releaseHandlers.delete(handler);
  }

  isDown(action: string): boolean {
    return this.held.has(action) || this.virtualHeld.has(action);
  }

  /** 虚拟手柄按下：和键盘共用同一套动作，但不伪造 KeyboardEvent。 */
  press(action: string): void {
    const wasDown = this.isDown(action);
    this.virtualHeld.add(action);
    if (!wasDown) for (const handler of this.pressHandlers) handler(action);
  }

  /** 虚拟手柄松开。 */
  release(action: string): void {
    if (!this.virtualHeld.delete(action)) return;
    if (!this.held.has(action)) for (const handler of this.releaseHandlers) handler(action);
  }

  /** 某个键是否绑定成这个动作。 */
  actionOf(event: KeyboardEvent): string | undefined {
    return this.bindings[normalizeKey(event)];
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.options.ignoreInteractive && isInteractiveTarget(event.target)) return;
    const action = this.actionOf(event);
    if (!action) return;
    if (this.options.preventDefault) event.preventDefault();
    if (event.repeat) return;
    const wasDown = this.isDown(action);
    this.held.add(action);
    if (!wasDown) for (const handler of this.pressHandlers) handler(action, event);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const action = this.actionOf(event);
    if (!action) return;
    this.held.delete(action);
    if (!this.virtualHeld.has(action)) for (const handler of this.releaseHandlers) handler(action, event);
  };

  private onBlur = (): void => {
    const released = [...this.held].filter((action) => !this.virtualHeld.has(action));
    this.held.clear();
    for (const action of released) for (const handler of this.releaseHandlers) handler(action);
  };

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.pressHandlers.clear();
    this.releaseHandlers.clear();
    this.held.clear();
    this.virtualHeld.clear();
  }
}
