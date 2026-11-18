import type { GameContext, GameInstance, GameMeta, GameResult } from "./game";
import { Hud } from "./ui/hud";
import { Overlay } from "./ui/overlay";
import { Toast } from "./ui/toast";
import { PixelSurface } from "./render/surface";
import { PointerInput } from "./input/pointer";
import { KeyMap } from "./input/keys";
import { SwipeInput } from "./input/swipe";
import { Pad } from "./input/pad";
import { P } from "./palette";
import { Sound } from "./audio";
import { Store } from "./store";
import { must, isInteractiveTarget } from "./dom";
import { createLiveRegion } from "./a11y";
import { drawCountdownOverlay } from "./ui/countdown";
import { paintAllIcons } from "./render/icons";
import { clamp, prefersReducedMotion } from "./util";

export type GameState = "ready" | "countdown" | "playing" | "paused" | "over";

const COUNTDOWN_MS = 3000;

const DEFAULT_BINDINGS: Record<string, string> = {
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
  arrowup: "up",
  w: "up",
  arrowdown: "down",
  s: "down",
  enter: "action",
  z: "primary",
  x: "secondary",
  c: "third",
  "1": "slot1",
  "2": "slot2",
  "3": "slot3",
  "4": "slot4",
  "5": "slot5",
  "6": "slot6",
  "7": "slot7",
  "8": "slot8",
  "9": "slot9",
};

export interface PlayShellOptions {
  meta: GameMeta;
  create: (ctx: GameContext) => GameInstance;
  homeHref?: string;
}

/**
 * 播放壳：一个游戏页面的运行时。
 * 负责 HUD、倒计时、暂停、结算、输入、错误兜底，
 * 游戏只实现 start/update/render 三件事。
 */
export class PlayShell {
  state: GameState = "ready";
  readonly meta: GameMeta;

  private readonly create: (ctx: GameContext) => GameInstance;
  private readonly homeHref: string;

  private readonly shell: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly cabinet: HTMLElement;
  private readonly topbar: HTMLElement;
  private readonly field: HTMLCanvasElement;
  private readonly fx: HTMLCanvasElement;
  private readonly timerWrap: HTMLElement;
  private readonly timeFill: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly padToggle: HTMLButtonElement;
  private readonly crtToggle: HTMLButtonElement;
  private readonly overlay: Overlay;
  private readonly toast: Toast;
  private readonly hud: Hud;
  private readonly live = createLiveRegion();

  private readonly surface: PixelSurface;
  private readonly fxSurface: PixelSurface;
  private readonly pointer: PointerInput;
  private readonly keys: KeyMap;
  private readonly swipe: SwipeInput;
  private readonly pad: Pad;

  private game: GameInstance | null = null;
  private raf = 0;
  private last = 0;
  private running = false;
  private pausedFrom: GameState = "playing";
  private cdRemaining = COUNTDOWN_MS;
  private cdSecond = 0;
  private errorShown = false;
  private resizeRaf = 0;
  private bootTimer = 0;
  private lastDpr = window.devicePixelRatio || 1;
  private readonly cleanup: (() => void)[] = [];

  constructor(options: PlayShellOptions) {
    this.meta = options.meta;
    this.create = options.create;
    this.homeHref = options.homeHref ?? "../index.html";

    this.shell = must<HTMLElement>("#shell");
    this.screen = must<HTMLElement>("#screen");
    this.cabinet = must<HTMLElement>("#cabinet");
    this.topbar = must<HTMLElement>("#topbar");
    this.field = must<HTMLCanvasElement>("#field");
    this.fx = must<HTMLCanvasElement>("#fx");
    this.timerWrap = must<HTMLElement>("#timerWrap");
    this.timeFill = must<HTMLElement>("#timeFill");
    this.muteBtn = must<HTMLButtonElement>("#muteBtn");
    this.pauseBtn = must<HTMLButtonElement>("#pauseBtn");
    this.padToggle = must<HTMLButtonElement>("#padToggle");
    this.crtToggle = must<HTMLButtonElement>("#crtToggle");

    const meta = this.meta;
    document.title = `${meta.title} · PIXEL ARCADE 小游戏合集`;
    must<HTMLElement>("#gameTitle").textContent = meta.title;
    must<HTMLElement>("#gameTagline").textContent = meta.tagline;
    this.shell.style.setProperty("--screen-ratio", `${meta.size.w} / ${meta.size.h}`);
    this.shell.style.setProperty("--screen-w", String(meta.size.w));
    this.shell.style.setProperty("--screen-h", String(meta.size.h));
    // 1:2 的 blocks 和 1:1 的 whack 用不同的屏幕/手柄尺寸策略
    this.cabinet.dataset.ratio = meta.size.h > meta.size.w * 1.5 ? "tall" : "wide";
    this.field.setAttribute("aria-label", `${meta.title}．${meta.howto}`);
    const back = must<HTMLAnchorElement>("#backLink");
    back.href = this.homeHref;

    this.overlay = new Overlay(must<HTMLElement>("#overlay"), { homeHref: this.homeHref });
    this.toast = new Toast(must<HTMLElement>("#toast"));
    this.hud = new Hud(must<HTMLElement>("#hud"), meta.hud);
    this.timerWrap.hidden = true;

    this.surface = new PixelSurface(this.field, meta.size.w, meta.size.h, this.screen, {
      alpha: false,
      desynchronized: true,
    });
    this.fxSurface = new PixelSurface(this.fx, meta.size.w, meta.size.h, this.screen, {
      alpha: true,
      desynchronized: true,
    });

    this.pointer = new PointerInput(this.field, this.surface);
    this.swipe = new SwipeInput(this.field, { threshold: 22 });
    const bindings = { ...DEFAULT_BINDINGS };
    if ((meta.spaceAction ?? "pause") === "action") bindings["space"] = "action";
    this.keys = new KeyMap(bindings);
    this.pad = new Pad(must<HTMLElement>("#pad"), meta.pad, this.keys, {
      onStart: () => this.onPadStart(),
      onToggle: (visible) => this.setPadVisible(visible),
    });
    if (meta.pad) this.pad.setVisible(Store.flag("pad", true));
    document.body.classList.toggle("is-crt", Store.flag("crt", true));

    this.fillNotes();
    paintAllIcons(document);
    this.bindChrome();
    this.bindCabinet();
    this.bindGlobalKeys();
    this.bindOverlay();
    this.bindVisibility();
    this.syncCabinetSwitches();

    if (!prefersReducedMotion()) {
      this.cabinet.classList.add("is-booting");
      this.bootTimer = window.setTimeout(() => this.cabinet.classList.remove("is-booting"), 760);
    }

    // 建立游戏实例（此时还不能 update，但可以先画静态画面）
    this.hud.reset();
    this.game = this.create(this.makeContext());
    this.setState("ready");
    this.overlay.showReady({
      kicker: meta.duration,
      title: "准备好了吗？",
      lead: meta.howto,
      hint: meta.hint,
    });
    this.game.render();
    this.startLoop();

    // 动态 import 的游戏可能在首次布局之后才挂载，补一次强制 re-fit
    requestAnimationFrame(() => {
      this.surface.schedule();
      this.fxSurface.schedule();
    });

    window.addEventListener("resize", this.onResize);
    window.addEventListener("orientationchange", this.onResize);
  }

  private onResize = (): void => {
    if (this.resizeRaf) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      const dpr = window.devicePixelRatio || 1;
      if (dpr !== this.lastDpr) {
        this.lastDpr = dpr;
        paintAllIcons(document);
      }
      this.hud.refresh();
      this.game?.render();
    });
  };

  private makeContext(): GameContext {
    const self = this;
    return {
      meta: this.meta,
      P,
      surface: this.surface,
      ctx: this.surface.ctx,
      input: { pointer: this.pointer, keys: this.keys, swipe: this.swipe },
      audio: Sound,
      store: Store,
      hud: this.hud,
      toast: this.toast,
      reducedMotion: prefersReducedMotion(),
      timer: {
        set(remaining: number, total: number, options?: { low?: number; critical?: number }) {
          self.setTimer(remaining, total, options);
        },
        hide() {
          self.timerWrap.hidden = true;
        },
      },
      announce: (message: string) => this.live.announce(message),
      end: (result: GameResult) => this.finish(result),
      isPaused: () => this.state === "paused",
      padVisible: () => this.pad.visible,
      color: (key) => P[key],
    };
  }

  private setState(state: GameState): void {
    this.state = state;
    document.body.dataset.gameState = state;
    this.pauseBtn.disabled = state !== "playing" && state !== "countdown" && state !== "paused";
    this.pauseBtn.setAttribute("aria-pressed", String(state === "paused"));
    this.pauseBtn.setAttribute("aria-label", state === "paused" ? "继续游戏" : "暂停游戏");
    this.pauseBtn.title = state === "paused" ? "继续" : "暂停";
    const icon = this.pauseBtn.querySelector("canvas");
    if (icon) {
      icon.dataset.icon = state === "paused" ? "play" : "pause";
      paintAllIcons(this.pauseBtn);
    }
  }

  private onMuteClick = (): void => this.toggleMute();
  private onPauseClick = (): void => this.togglePause();

  private bindChrome(): void {
    this.muteBtn.addEventListener("click", this.onMuteClick);
    this.pauseBtn.addEventListener("click", this.onPauseClick);
    this.cleanup.push(() => {
      this.muteBtn.removeEventListener("click", this.onMuteClick);
      this.pauseBtn.removeEventListener("click", this.onPauseClick);
    });
    this.syncMuteIcon();
  }

  /** 机台上的两个小开关：虚拟手柄、CRT。 */
  private bindCabinet(): void {
    const onPad = (): void => this.setPadVisible(!this.pad.visible);
    const onCrt = (): void => {
      const next = !document.body.classList.contains("is-crt");
      document.body.classList.toggle("is-crt", next);
      Store.setFlag("crt", next);
      this.syncCabinetSwitches();
      this.toast.show(next ? "CRT 已开启" : "CRT 已关闭", { duration: 750 });
      Sound.ui();
    };
    this.padToggle.addEventListener("click", onPad);
    this.crtToggle.addEventListener("click", onCrt);
    this.cleanup.push(() => {
      this.padToggle.removeEventListener("click", onPad);
      this.crtToggle.removeEventListener("click", onCrt);
    });
  }

  /** 手柄展开/收起：拉手和机台开关共用。 */
  private setPadVisible(visible: boolean): void {
    if (!this.meta.pad) return;
    this.pad.setVisible(visible);
    Store.setFlag("pad", visible);
    this.syncCabinetSwitches();
    this.toast.show(visible ? "手柄已展开" : "手柄已收起", { duration: 750 });
    Sound.ui();
  }

  private syncCabinetSwitches(): void {
    this.padToggle.disabled = !this.meta.pad;
    this.padToggle.setAttribute("aria-checked", String(this.pad.visible));
    this.crtToggle.setAttribute("aria-checked", String(document.body.classList.contains("is-crt")));
  }

  private onPadStart(): void {
    if (this.state === "ready") this.begin();
    else if (this.state === "playing" || this.state === "countdown" || this.state === "paused") {
      this.togglePause();
    }
  }

  private bindGlobalKeys(): void {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInteractiveTarget(event.target) && this.overlay.open) return;
      const key = event.key.toLowerCase();
      if (key === "m") {
        this.toggleMute();
        return;
      }
      if (key === "p" || (key === " " && (this.meta.spaceAction ?? "pause") === "pause")) {
        event.preventDefault();
        this.togglePause();
        return;
      }
      if (key === "escape") {
        event.preventDefault();
        this.togglePause();
        return;
      }
      if (key === "enter" && this.state === "ready") {
        event.preventDefault();
        this.begin();
      }
    };
    window.addEventListener("keydown", onKey);
    this.cleanup.push(() => window.removeEventListener("keydown", onKey));
  }

  private bindOverlay(): void {
    this.overlay.onAction((action) => {
      if (action === "start" || action === "replay" || action === "restart") this.begin();
      else if (action === "resume") this.resume();
    });
  }

  private bindVisibility(): void {
    const onVisibility = (): void => {
      if (document.hidden) {
        if (this.state === "playing" || this.state === "countdown") this.pause(this.state);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  private fillNotes(): void {
    const notes = must<HTMLElement>("#notes");
    const rules = document.createElement("p");
    rules.className = "score-rules";
    for (const tag of this.meta.tags) {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = tag;
      rules.append(span);
    }
    const foot = document.createElement("div");
    foot.className = "play-foot";
    const link = document.createElement("a");
    link.className = "back-link";
    link.href = this.homeHref;
    link.textContent = "← 全部游戏";
    const code = document.createElement("span");
    code.className = "game-code";
    code.textContent = `NO. ${String(this.meta.no).padStart(2, "0")} / ${this.meta.id.toUpperCase()}`;
    foot.append(link, code);
    notes.append(rules, foot);
  }

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(Math.max(now - this.last, 0), 50);
      this.last = now;
      try {
        this.tick(dt);
      } catch (error) {
        console.error("[pixel-arcade]", error);
        if (!this.errorShown) {
          this.errorShown = true;
          this.toast.show("游戏出了点问题，请刷新重试", { warn: true, duration: 2400 });
        }
        this.running = false;
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private tick(dt: number): void {
    if (this.state === "countdown") {
      this.cdRemaining -= dt;
      const second = Math.max(0, Math.ceil(this.cdRemaining / 1000));
      if (second !== this.cdSecond) {
        this.cdSecond = second;
        if (second > 0) Sound.tick(second);
      }
      if (this.cdRemaining <= 0) {
        this.setState("playing");
        this.clearFx();
        Sound.go();
        this.announce("开始");
      }
      this.game?.render();
      if (this.state === "countdown") this.drawCountdown();
      return;
    }

    if (this.state === "playing") {
      this.game?.update(dt);
      this.game?.render();
    } else if (this.state === "ready" || this.state === "over") {
      this.game?.render();
    }
  }

  private drawCountdown(): void {
    const ctx = this.fxSurface.ctx;
    const { w, h } = this.meta.size;
    ctx.clearRect(0, 0, w, h);
    drawCountdownOverlay(ctx, w, h, this.cdRemaining, COUNTDOWN_MS);
  }

  private clearFx(): void {
    const ctx = this.fxSurface.ctx;
    ctx.clearRect(0, 0, this.meta.size.w, this.meta.size.h);
  }

  /* ---------------- 流程 ---------------- */

  begin(): void {
    if (this.state === "countdown" || this.state === "playing") return;
    Sound.unlock();
    this.hud.reset();
    this.hud.urgent(false);
    this.timerWrap.hidden = true;
    this.overlay.hide();
    this.errorShown = false;
    this.game?.start();

    if (this.meta.countdown === false) {
      this.setState("playing");
      this.live.announce("开始");
    } else {
      this.cdRemaining = COUNTDOWN_MS;
      this.cdSecond = 0;
      this.setState("countdown");
    }
    this.startLoop();
    this.last = performance.now();
    this.field.focus({ preventScroll: true });
  }

  pause(from: GameState = this.state): void {
    if (this.state !== "playing" && this.state !== "countdown") return;
    this.pausedFrom = from;
    this.game?.pause?.();
    this.setState("paused");
    this.overlay.showPause();
    this.stopLoop();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.overlay.hide();
    if (this.pausedFrom === "countdown") {
      this.cdRemaining = COUNTDOWN_MS;
      this.cdSecond = 0;
      this.setState("countdown");
    } else {
      this.setState("playing");
      this.game?.resume?.();
    }
    this.last = performance.now();
    this.startLoop();
    this.field.focus({ preventScroll: true });
  }

  togglePause(): void {
    if (this.state === "paused") this.resume();
    else if (this.state === "playing" || this.state === "countdown") this.pause();
  }

  private finish(result: GameResult): void {
    if (this.state === "over") return;
    const mode = this.meta.scoreMode ?? "high";
    const previous = Store.best(this.meta.id, mode);
    const record = Store.isRecord(this.meta.id, result.score, mode);
    if (record) Store.setBest(this.meta.id, result.score, mode);
    const best = record ? result.score : previous;

    this.setState("over");
    this.stopLoop();
    this.game?.pause?.();
    this.timerWrap.hidden = true;
    this.overlay.showResult(
      {
        kicker: result.kicker ?? "RESULT",
        title: result.title ?? "本局结束",
        score: result.score,
        scoreLabel: this.meta.scoreLabel ?? "本局得分",
        scorePad: mode === "low" ? 0 : 4,
        record,
        best: best ?? null,
        bestLabel: this.meta.bestLabel ?? "历史最高",
        stats: result.stats ?? [],
      },
    );
    this.live.announce(`${result.title ?? "本局结束"}，${this.meta.scoreLabel ?? "得分"} ${result.score}`);
    if (record) this.toast.show("新纪录！");
  }

  /* ---------------- 工具条 ---------------- */

  private toggleMute(): void {
    const muted = Sound.toggleMuted();
    this.syncMuteIcon();
    this.toast.show(muted ? "音效已关闭" : "音效已开启", { duration: 700 });
  }

  private syncMuteIcon(): void {
    const canvas = this.muteBtn.querySelector("canvas");
    if (!canvas) return;
    canvas.dataset.icon = Sound.muted ? "muted" : "sound";
    paintAllIcons(this.muteBtn);
    this.muteBtn.setAttribute("aria-pressed", String(Sound.muted));
    this.muteBtn.setAttribute("aria-label", Sound.muted ? "打开音效" : "关闭音效");
  }

  private setTimer(
    remaining: number,
    total: number,
    options?: { low?: number; critical?: number },
  ): void {
    if (total <= 0) {
      this.timerWrap.hidden = true;
      return;
    }
    const ratio = clamp(remaining / total, 0, 1);
    this.timerWrap.hidden = false;
    this.timeFill.style.width = `${(ratio * 100).toFixed(2)}%`;
    this.timerWrap.classList.toggle("is-low", ratio <= (options?.low ?? 0.34));
    this.timerWrap.classList.toggle("is-critical", ratio <= (options?.critical ?? 0.15));
  }

  private stopLoop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy(): void {
    this.stopLoop();
    this.game?.destroy?.();
    this.game = null;
    this.pointer.destroy();
    this.keys.destroy();
    this.swipe.destroy();
    this.surface.destroy();
    this.fxSurface.destroy();
    this.overlay.destroy();
    this.toast.destroy();
    this.hud.destroy();
    this.pad.destroy();
    this.live.destroy();
    for (const fn of this.cleanup) fn();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("orientationchange", this.onResize);
    window.clearTimeout(this.bootTimer);
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
  }

  /** 注意力提示：给游戏播报用（转发到 live region）。 */
  announce(message: string): void {
    this.live.announce(message);
  }
}
