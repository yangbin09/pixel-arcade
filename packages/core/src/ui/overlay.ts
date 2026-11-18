import { P } from "../palette";
import { PixelText } from "../render/pixel-text";

export type OverlayAction = "start" | "resume" | "restart" | "replay" | "home" | "exit-fs";

export interface ReadyCopy {
  kicker: string;
  title: string;
  lead: string;
  hint?: string;
}

export interface ResultView {
  kicker?: string;
  title: string;
  score: number;
  scoreLabel: string;
  scorePad?: number;
  record: boolean;
  recordText?: string;
  best: number | null;
  bestLabel: string;
  stats: { label: string; value: string | number }[];
}

/**
 * 弹窗层：准备 / 暂停 / 结算三块面板，10 个游戏共用。
 * 只负责展示与焦点管理，状态切换由 PlayShell 决定。
 */
export class Overlay {
  readonly root: HTMLElement;
  private readonly homeHref: string;
  private panels = new Map<string, HTMLElement>();
  private actions = new Set<(action: OverlayAction) => void>();
  private scoreText: PixelText | null = null;
  private statsBox: HTMLElement | null = null;
  private lastFocus: HTMLElement | null = null;

  constructor(root: HTMLElement, options: { homeHref?: string } = {}) {
    this.root = root;
    this.homeHref = options.homeHref ?? "../index.html";
    this.build();
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("keydown", this.onKeyDown);
  }

  private build(): void {
    this.root.innerHTML = "";

    const ready = this.panel("ready", [
      { tag: "p", className: "dialog-kicker", role: "kicker" },
      { tag: "h2", role: "title" },
      { tag: "p", className: "dialog-lead", role: "lead" },
      {
        tag: "div",
        className: "dialog-actions",
        children: [
          this.button("start", "开始游戏", "btn btn-primary"),
          this.link("home", "返回首页", "btn-link"),
        ],
      },
      { tag: "p", className: "dialog-hint", role: "hint" },
    ]);

    const pause = this.panel("pause", [
      { tag: "p", className: "dialog-kicker", text: "PAUSED" },
      { tag: "h2", text: "暂停中" },
      { tag: "p", className: "dialog-lead", text: "计时已经停下，准备好了再继续。" },
      {
        tag: "div",
        className: "dialog-actions",
        children: [
          this.button("resume", "继续游戏", "btn btn-primary"),
          this.button("restart", "重新开始", "btn btn-ghost"),
          this.link("home", "返回首页", "btn-link"),
        ],
      },
    ]);

    const resultChildren: PanelChild[] = [
      this.node("p", "dialog-kicker", "", "kicker"),
      this.node("h2", "", "", "title"),
      this.node("p", "score-label", "本局得分", "scoreLabel"),
      this.node("canvas", "", "", "score"),
      this.node("p", "record", "新纪录！", "record"),
      this.node("div", "result-stats", "", "stats"),
      {
        tag: "div",
        className: "dialog-actions",
        children: [
          this.button("replay", "再来一局", "btn btn-primary"),
          this.button("exit-fs", "退出全屏", "btn btn-ghost"),
          this.link("home", "返回首页", "btn btn-ghost"),
        ],
      },
    ];
    const result = this.panel("result", resultChildren);
    (this.panels.get("result")!.querySelector('[data-role="record"]') as HTMLElement).hidden = true;
    (this.panels.get("result")!.querySelector('[data-action="exit-fs"]') as HTMLElement).hidden = true;

    this.root.append(ready, pause, result);
    this.statsBox = result.querySelector('[data-role="stats"]');
  }

  private node(tag: string, className: string, text: string, role: string): HTMLElement {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    if (role) el.dataset.role = role;
    if (tag === "canvas") el.setAttribute("role", "img");
    return el;
  }

  private button(action: OverlayAction, text: string, className: string): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = text;
    btn.dataset.action = action;
    return btn;
  }

  private link(action: OverlayAction, text: string, className: string): HTMLElement {
    const a = document.createElement("a");
    a.className = className;
    a.textContent = text;
    a.href = this.homeHref;
    a.dataset.action = action;
    return a;
  }

  private panel(name: string, children: PanelChild[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "dialog";
    section.dataset.panel = name;
    section.setAttribute("role", "dialog");
    section.setAttribute("aria-modal", "true");
    section.hidden = true;

    for (const child of children) {
      if ("tag" in child) {
        const el = document.createElement(child.tag);
        if (child.className) el.className = child.className;
        if (child.text) el.textContent = child.text;
        if (child.role) el.dataset.role = child.role;
        for (const nested of child.children ?? []) el.append(nested);
        section.append(el);
      } else {
        section.append(child);
      }
    }
    this.panels.set(name, section);
    return section;
  }

  onAction(handler: (action: OverlayAction) => void): () => void {
    this.actions.add(handler);
    return () => this.actions.delete(handler);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  showReady(copy: ReadyCopy): void {
    const panel = this.panels.get("ready")!;
    (panel.querySelector('[data-role="kicker"]') as HTMLElement).textContent = copy.kicker;
    (panel.querySelector('[data-role="title"]') as HTMLElement).textContent = copy.title;
    (panel.querySelector('[data-role="lead"]') as HTMLElement).textContent = copy.lead;
    const hint = panel.querySelector('[data-role="hint"]') as HTMLElement;
    if (copy.hint) {
      hint.innerHTML = copy.hint;
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }
    this.show("ready");
  }

  showPause(): void {
    this.show("pause");
  }

  /** 结算：分数用像素字，统计栏自适应 1–3 项。 */
  showResult(view: ResultView, options: { canExitFullscreen: boolean }): void {
    const panel = this.panels.get("result")!;
    const kicker = panel.querySelector('[data-role="kicker"]') as HTMLElement;
    const title = panel.querySelector('[data-role="title"]') as HTMLElement;
    const scoreLabel = panel.querySelector('[data-role="scoreLabel"]') as HTMLElement;
    const record = panel.querySelector('[data-role="record"]') as HTMLElement;
    const scoreCanvas = panel.querySelector('[data-role="score"]') as HTMLCanvasElement;
    const exitBtn = panel.querySelector('[data-action="exit-fs"]') as HTMLElement;

    kicker.textContent = view.kicker ?? "RESULT";
    title.textContent = view.title;
    scoreLabel.textContent = view.scoreLabel;

    if (!this.scoreText) {
      this.scoreText = new PixelText(scoreCanvas, {
        size: 7,
        color: P.gold,
        shadow: P.orange,
        pad: view.scorePad ?? 4,
      });
    }
    this.scoreText.pad = view.scorePad ?? 4;
    this.scoreText.set(view.score);
    scoreCanvas.setAttribute("aria-label", `${view.scoreLabel} ${view.score}`);

    record.textContent = view.recordText ?? "新纪录！";
    record.hidden = !view.record;

    const stats = this.statsBox!;
    stats.innerHTML = "";
    const items: { label: string; value: string | number }[] = [
      ...view.stats.slice(0, 2),
      { label: view.bestLabel, value: view.best === null ? "—" : view.best },
    ];
    stats.dataset.count = String(items.length);
    for (const item of items) {
      const cell = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = item.label;
      const value = document.createElement("b");
      value.textContent = String(item.value);
      cell.append(label, value);
      stats.append(cell);
    }

    exitBtn.hidden = !options.canExitFullscreen;
    this.show("result");
    requestAnimationFrame(() => this.scoreText?.refresh());
  }

  hide(): void {
    this.root.hidden = true;
    for (const panel of this.panels.values()) panel.hidden = true;
    if (this.lastFocus && document.contains(this.lastFocus)) {
      this.lastFocus.focus({ preventScroll: true });
    }
    this.lastFocus = null;
  }

  private show(name: string): void {
    if (this.root.hidden) {
      this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.root.hidden = false;
    for (const [key, panel] of this.panels) panel.hidden = key !== name;
    requestAnimationFrame(() => {
      const target = this.panels.get(name)?.querySelector<HTMLElement>("button, a");
      target?.focus({ preventScroll: true });
    });
  }

  private onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action as OverlayAction | undefined;
    if (!action) return;
    if (target.tagName === "A" && action === "home") return; // 让链接正常跳转
    event.preventDefault();
    for (const handler of this.actions) handler(action);
  };

  /** 焦点锁在弹窗里，Tab 不会跑到背景的画布上。 */
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || this.root.hidden) return;
    const panel = this.root.querySelector<HTMLElement>(".dialog:not([hidden])");
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>("button:not([hidden]), a[href], [tabindex]:not([tabindex='-1'])"),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  destroy(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("keydown", this.onKeyDown);
    this.actions.clear();
  }
}

type PanelChild =
  | HTMLElement
  | {
      tag: string;
      className?: string;
      text?: string;
      role?: string;
      children?: HTMLElement[];
    };
