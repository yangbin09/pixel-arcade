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

/**
 * 键盘输入：把物理键映射成语义动作（left/right/rotate/pause…）。
 * 同时维护 held 集合，支持长按连续操作。
 */
export class KeyMap {
  readonly bindings: Record<string, string>;
  readonly held = new Set<string>();
  private pressHandlers = new Set<(action: string, event: KeyboardEvent) => void>();
  private releaseHandlers = new Set<(action: string, event: KeyboardEvent) => void>();
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

  onPress(handler: (action: string, event: KeyboardEvent) => void): () => void {
    this.pressHandlers.add(handler);
    return () => this.pressHandlers.delete(handler);
  }

  onRelease(handler: (action: string, event: KeyboardEvent) => void): () => void {
    this.releaseHandlers.add(handler);
    return () => this.releaseHandlers.delete(handler);
  }

  isDown(action: string): boolean {
    return this.held.has(action);
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
    this.held.add(action);
    for (const handler of this.pressHandlers) handler(action, event);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const action = this.actionOf(event);
    if (!action) return;
    this.held.delete(action);
    for (const handler of this.releaseHandlers) handler(action, event);
  };

  private onBlur = (): void => this.held.clear();

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.pressHandlers.clear();
    this.releaseHandlers.clear();
    this.held.clear();
  }
}
