import { Store } from "./store";

/**
 * WebAudio 合成音效：没有任何音频文件，全部现场合成。
 * 保留旧版音色，新增的只是通用预设，老游戏听感不变。
 */
export const Sound = {
  ctx: null as AudioContext | null,
  master: null as GainNode | null,
  muted: Store.muted(),
  noiseBuffer: null as AudioBuffer | null,
  volume: 0.62,

  unlock(): AudioContext | null {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!Sound.ctx) {
      try {
        const ac = new AC();
        const master = ac.createGain();
        master.gain.value = Sound.muted ? 0 : Sound.volume;
        master.connect(ac.destination);
        Sound.ctx = ac;
        Sound.master = master;

        const length = Math.floor(ac.sampleRate * 0.4);
        const buffer = ac.createBuffer(1, length, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
        Sound.noiseBuffer = buffer;
      } catch {
        return null;
      }
    }
    if (Sound.ctx.state === "suspended") {
      void Sound.ctx.resume().catch(() => {});
    }
    return Sound.ctx;
  },

  setMuted(muted: boolean): boolean {
    Sound.muted = !!muted;
    Store.setMuted(Sound.muted);
    if (Sound.ctx && Sound.master) {
      const now = Sound.ctx.currentTime;
      const gain = Sound.master.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(0.0001, gain.value), now);
      gain.linearRampToValueAtTime(Sound.muted ? 0 : Sound.volume, now + 0.03);
    }
    return Sound.muted;
  },

  toggleMuted(): boolean {
    const next = !Sound.muted;
    Sound.setMuted(next);
    if (!next) {
      Sound.unlock();
      Sound.tone(520, 0.04, "square", 0.06);
    }
    return next;
  },

  active(): boolean {
    return !Sound.muted && !!Sound.ctx && Sound.ctx.state === "running";
  },

  tone(freq: number, duration = 0.08, type: OscillatorType = "square", volume = 0.08, slideTo?: number | null, delay = 0): void {
    if (!Sound.active() || !Sound.ctx) return;
    const ac = Sound.ctx;
    const start = ac.currentTime + delay;
    const dur = Math.max(0.02, duration);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + dur);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(Sound.master!);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  },

  noise(duration = 0.05, volume = 0.12, filterType: BiquadFilterType = "bandpass", frequency = 1200, delay = 0): void {
    if (!Sound.active() || !Sound.noiseBuffer || !Sound.ctx) return;
    const ac = Sound.ctx;
    const start = ac.currentTime + delay;
    const dur = Math.max(0.02, duration);
    const source = ac.createBufferSource();
    source.buffer = Sound.noiseBuffer;
    const filter = ac.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(Sound.master!);
    source.start(start);
    source.stop(start + dur + 0.02);
  },

  /* ---------- 通用预设 ---------- */

  ui(): void {
    if (!Sound.active()) return;
    Sound.tone(480, 0.035, "square", 0.045);
  },

  tick(step = 1): void {
    if (!Sound.active()) return;
    const freq = step === 1 ? 960 : step === 2 ? 780 : 620;
    Sound.tone(freq, 0.055, "square", 0.075);
  },

  go(): void {
    if (!Sound.active()) return;
    Sound.tone(880, 0.09, "square", 0.09);
    Sound.tone(1320, 0.13, "triangle", 0.08, null, 0.07);
  },

  end(): void {
    if (!Sound.active()) return;
    Sound.tone(660, 0.12, "triangle", 0.12);
    Sound.tone(494, 0.12, "triangle", 0.11, null, 0.13);
    Sound.tone(330, 0.25, "triangle", 0.12, 294, 0.27);
  },

  tier(): void {
    if (!Sound.active()) return;
    Sound.tone(784, 0.06, "square", 0.07);
    Sound.tone(988, 0.06, "square", 0.065, null, 0.065);
    Sound.tone(1319, 0.1, "square", 0.06, null, 0.13);
  },

  hit(combo = 0): void {
    if (!Sound.active()) return;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34];
    const step = scale[Math.min(combo, scale.length - 1)]!;
    const freq = 330 * Math.pow(2, step / 12);
    Sound.noise(0.045, 0.16, "bandpass", 1450);
    Sound.tone(freq, 0.075, "triangle", 0.15, freq * 1.35);
    Sound.tone(freq * 2, 0.04, "square", 0.045);
    Sound.tone(110, 0.06, "sine", 0.1);
  },

  gold(combo = 0): void {
    Sound.hit(combo);
    if (!Sound.active()) return;
    Sound.tone(1568, 0.07, "sine", 0.08, null, 0.03);
    Sound.tone(2093, 0.09, "sine", 0.06, null, 0.09);
    Sound.tone(2637, 0.08, "sine", 0.035, null, 0.15);
  },

  miss(): void {
    if (!Sound.active()) return;
    Sound.tone(120, 0.13, "sine", 0.2, 58);
    Sound.tone(80, 0.09, "triangle", 0.12, 52);
    Sound.noise(0.06, 0.12, "lowpass", 420);
  },

  spawn(gold = false): void {
    if (!Sound.active()) return;
    Sound.tone(gold ? 720 : 230, 0.06, "triangle", gold ? 0.05 : 0.035, gold ? 1080 : 300);
    if (gold) Sound.tone(1440, 0.06, "sine", 0.04, null, 0.045);
  },

  coin(): void {
    if (!Sound.active()) return;
    Sound.tone(988, 0.05, "square", 0.07);
    Sound.tone(1319, 0.09, "square", 0.06, null, 0.05);
  },

  blip(): void {
    if (!Sound.active()) return;
    Sound.tone(660, 0.03, "square", 0.05);
  },

  pop(): void {
    if (!Sound.active()) return;
    Sound.tone(520, 0.05, "triangle", 0.08, 900);
  },

  slide(): void {
    if (!Sound.active()) return;
    Sound.tone(220, 0.09, "triangle", 0.07, 380);
    Sound.noise(0.05, 0.05, "highpass", 1800);
  },

  error(): void {
    if (!Sound.active()) return;
    Sound.tone(220, 0.12, "sawtooth", 0.08, 120);
  },

  win(): void {
    if (!Sound.active()) return;
    [523, 659, 784, 1047].forEach((freq, i) => {
      Sound.tone(freq, 0.12, "triangle", 0.1, null, i * 0.11);
    });
  },

  lose(): void {
    if (!Sound.active()) return;
    [392, 330, 262, 196].forEach((freq, i) => {
      Sound.tone(freq, 0.16, "triangle", 0.1, null, i * 0.12);
    });
  },
};
