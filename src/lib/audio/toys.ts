// Звуки детских игрушек: аддитивный и шумовой синтез.

import { applyBiquad, biquad, type Clip, fadeEdges, normalize, reverb, rng } from "./core";

const SR = 44100;

export type ToyKind = "bell" | "xylophone" | "musicbox" | "rattle" | "squeaky" | "bubbles" | "whistle" | "drum";

export const TOYS: { id: ToyKind; label: string; emoji: string }[] = [
  { id: "xylophone", label: "Ксилофон", emoji: "🎹" },
  { id: "musicbox", label: "Музыкальная шкатулка", emoji: "🎶" },
  { id: "bell", label: "Колокольчик", emoji: "🔔" },
  { id: "rattle", label: "Погремушка", emoji: "🎊" },
  { id: "squeaky", label: "Пищалка", emoji: "🐤" },
  { id: "bubbles", label: "Пузырьки", emoji: "🧼" },
  { id: "whistle", label: "Свисток", emoji: "📯" },
  { id: "drum", label: "Барабан", emoji: "🥁" },
];

export type ToyParams = {
  kind: ToyKind;
  pitch: number; // -12..12 полутонов
  length: number; // 0.5..2 множитель длины/количества событий
  room: number; // 0..1
  seed: number;
};

type Overtone = [ratio: number, amp: number, decay: number];

function strike(out: Float32Array, at: number, freq: number, partials: Overtone[], rand: () => number) {
  const start = Math.floor(at * SR);
  for (const [ratio, amp, decay] of partials) {
    const f = freq * ratio * (1 + (rand() - 0.5) * 0.002);
    if (f > SR * 0.45) continue;
    const len = Math.min(out.length - start, Math.floor(decay * 6 * SR));
    const w = (2 * Math.PI * f) / SR;
    const ph = rand() * Math.PI * 2;
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-i / (decay * SR)) * Math.min(1, i / 40);
      out[start + i] += amp * env * Math.sin(w * i + ph);
    }
  }
}

const MELODIES = [
  [0, 4, 7, 12, 7, 4, 0],
  [0, 2, 4, 5, 7, 9, 11, 12],
  [7, 4, 4, 5, 2, 2, 0, 4, 7],
  [0, 0, 7, 7, 9, 9, 7, -1, 5, 5, 4, 4, 2, 2, 0],
  [12, 7, 9, 4, 5, 0, 5, 7],
];

export function synthesizeToy(p: ToyParams): Clip {
  const rand = rng(p.seed * 104729 + p.kind.length);
  const tune = Math.pow(2, p.pitch / 12);
  const L = p.length;
  let out: Float32Array;

  switch (p.kind) {
    case "xylophone":
    case "musicbox":
    case "bell": {
      const mel = MELODIES[Math.floor(rand() * MELODIES.length)];
      const notes = p.kind === "bell" ? [0, 0, 0].slice(0, Math.max(1, Math.round(2 * L))) : mel.slice(0, Math.max(3, Math.round(mel.length * Math.min(1, L))));
      const step = p.kind === "musicbox" ? 0.34 : p.kind === "bell" ? 0.55 : 0.22;
      const base = (p.kind === "musicbox" ? 1046 : p.kind === "bell" ? 1320 : 523) * tune;
      const partials: Overtone[] =
        p.kind === "xylophone"
          ? [[1, 1, 0.25], [3.93, 0.35, 0.06], [9.2, 0.12, 0.02]]
          : p.kind === "musicbox"
            ? [[1, 1, 0.9], [2, 0.25, 0.4], [5.4, 0.15, 0.12], [8.9, 0.05, 0.05]]
            : [[0.56, 0.4, 1.2], [0.92, 0.5, 0.9], [1, 1, 1.4], [1.19, 0.4, 0.7], [1.71, 0.35, 0.5], [2, 0.3, 0.4], [2.74, 0.25, 0.3], [3, 0.2, 0.25], [3.76, 0.15, 0.2]];
      const total = notes.length * step + 2.5;
      out = new Float32Array(Math.floor(total * SR));
      notes.forEach((semi, i) => {
        if (semi < 0) return;
        const t = i * step * (p.kind === "musicbox" ? 1 + (rand() - 0.5) * 0.08 : 1);
        strike(out, t, base * Math.pow(2, semi / 12), partials, rand);
        if (p.kind === "musicbox" && i % 2 === 0) strike(out, t, (base / 2) * Math.pow(2, semi / 12), partials, rand);
      });
      break;
    }
    case "rattle": {
      const shakes = Math.max(2, Math.round(4 * L));
      out = new Float32Array(Math.floor((shakes * 0.28 + 0.4) * SR));
      for (let s = 0; s < shakes; s++) {
        const t0 = s * 0.28 + (rand() - 0.5) * 0.03;
        const grains = 40 + Math.floor(rand() * 40);
        for (let g = 0; g < grains; g++) {
          // Бусины бьются чаще в начале каждого встряхивания.
          const t = t0 + Math.pow(rand(), 2) * 0.18;
          const start = Math.max(0, Math.floor(t * SR));
          const len = Math.floor(SR * (0.002 + rand() * 0.004));
          const amp = 0.3 + rand() * 0.7;
          for (let i = 0; i < len && start + i < out.length; i++) {
            out[start + i] += (rand() * 2 - 1) * amp * Math.exp(-i / (len * 0.3));
          }
        }
      }
      out = applyBiquad(out, biquad("bandpass", 4200 * tune, SR, 1.2));
      out = applyBiquad(out, biquad("peaking", 7000 * tune, SR, 2, 6));
      break;
    }
    case "squeaky": {
      const squeaks = Math.max(1, Math.round(2 * L));
      out = new Float32Array(Math.floor((squeaks * 0.45 + 0.2) * SR));
      for (let s = 0; s < squeaks; s++) {
        const start = Math.floor(s * 0.45 * SR);
        const len = Math.floor((0.28 + rand() * 0.1) * SR);
        const f0 = (900 + rand() * 300) * tune;
        let ph = 0;
        for (let i = 0; i < len && start + i < out.length; i++) {
          const x = i / len;
          // Высота поднимается при сжатии и падает при отпускании.
          const contour = 0.75 + 0.45 * Math.sin(Math.PI * Math.pow(x, 0.7));
          const f = f0 * contour * (1 + 0.04 * Math.sin(2 * Math.PI * 28 * (i / SR)));
          ph += (2 * Math.PI * f) / SR;
          const env = Math.sin(Math.PI * x) ** 0.6;
          const tone = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph);
          out[start + i] += env * (tone * 0.8 + (rand() * 2 - 1) * 0.15);
        }
      }
      break;
    }
    case "bubbles": {
      const count = Math.max(4, Math.round(14 * L));
      const total = count * 0.11 + 0.4;
      out = new Float32Array(Math.floor(total * SR));
      let t = 0;
      for (let b = 0; b < count; b++) {
        t += 0.04 + rand() * 0.12;
        const start = Math.floor(t * SR);
        const f0 = (400 + rand() * 900) * tune;
        const decay = 0.02 + rand() * 0.04;
        const len = Math.floor(decay * 6 * SR);
        let ph = 0;
        for (let i = 0; i < len && start + i < out.length; i++) {
          // Пузырёк: синус с быстро растущей частотой (модель Миннарта).
          const tt = i / SR;
          const f = f0 * (1 + 12 * tt);
          ph += (2 * Math.PI * f) / SR;
          out[start + i] += Math.sin(ph) * Math.exp(-tt / decay) * (0.5 + rand() * 0.02);
        }
      }
      break;
    }
    case "whistle": {
      const blows = Math.max(1, Math.round(2 * L));
      out = new Float32Array(Math.floor((blows * 0.6 + 0.3) * SR));
      for (let s = 0; s < blows; s++) {
        const start = Math.floor(s * 0.6 * SR);
        const len = Math.floor((s === blows - 1 ? 0.55 : 0.35) * SR);
        const f0 = 2400 * tune;
        let ph = 0;
        for (let i = 0; i < len && start + i < out.length; i++) {
          const tt = i / SR;
          // Горошина внутри свистка даёт быструю трель.
          const trill = 1 + 0.05 * Math.sign(Math.sin(2 * Math.PI * 32 * tt)) * Math.min(1, tt * 8);
          ph += (2 * Math.PI * f0 * trill) / SR;
          const env = Math.min(1, tt / 0.02) * Math.min(1, (len - i) / (0.04 * SR));
          out[start + i] += env * (Math.sin(ph) * 0.8 + (rand() * 2 - 1) * 0.12);
        }
      }
      break;
    }
    case "drum": {
      const hits = Math.max(2, Math.round(5 * L));
      const pattern = [0, 0.25, 0.5, 0.625, 0.75, 1, 1.25, 1.5, 1.625, 1.75];
      out = new Float32Array(Math.floor((pattern[Math.min(hits, pattern.length) - 1] + 0.7) * SR));
      for (let h = 0; h < Math.min(hits, pattern.length); h++) {
        const start = Math.floor(pattern[h] * SR);
        const len = Math.floor(0.35 * SR);
        const f0 = (180 + rand() * 20) * tune;
        let ph = 0;
        for (let i = 0; i < len && start + i < out.length; i++) {
          const tt = i / SR;
          const f = f0 * (1 + 1.2 * Math.exp(-tt / 0.02));
          ph += (2 * Math.PI * f) / SR;
          out[start + i] += Math.sin(ph) * Math.exp(-tt / 0.12) + (rand() * 2 - 1) * 0.35 * Math.exp(-tt / 0.02);
        }
      }
      break;
    }
  }

  out = applyBiquad(out, biquad("highpass", 60, SR));
  normalize(out, 0.8);
  out = reverb(out, SR, p.room * 0.6, 0.6);
  normalize(out, 0.9);
  fadeEdges(out, SR, 0.003);
  return { samples: out, sampleRate: SR };
}
