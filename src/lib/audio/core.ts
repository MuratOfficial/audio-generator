// Базовые типы и утилиты для работы со звуком в браузере.

export type Clip = {
  samples: Float32Array;
  sampleRate: number;
};

export function duration(clip: Clip): number {
  return clip.samples.length / clip.sampleRate;
}

/** Кодирует моно-сигнал в 16-битный PCM WAV. */
export function encodeWav({ samples, sampleRate }: Clip): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let p = 44;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    p += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function downloadClip(clip: Clip, name: string) {
  const url = URL.createObjectURL(encodeWav(clip));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".wav") ? name : `${name}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Воспроизведение ----------

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;
let currentOnEnd: (() => void) | null = null;

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function stopPlayback() {
  if (current) {
    current.onended = null;
    try {
      current.stop();
    } catch {
      // источник уже остановлен
    }
    current = null;
  }
  const cb = currentOnEnd;
  currentOnEnd = null;
  cb?.();
}

/** Проигрывает клип, прерывая предыдущий. Возвращает время старта в AudioContext. */
export function playClip(clip: Clip, onEnd?: () => void): number {
  stopPlayback();
  const ac = audioContext();
  const buf = ac.createBuffer(1, clip.samples.length, clip.sampleRate);
  buf.copyToChannel(new Float32Array(clip.samples), 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.onended = () => {
    if (current === src) {
      current = null;
      const cb = currentOnEnd;
      currentOnEnd = null;
      cb?.();
    }
  };
  current = src;
  currentOnEnd = onEnd ?? null;
  const startAt = ac.currentTime + 0.02;
  src.start(startAt);
  return startAt;
}

/** Декодирует любой поддерживаемый браузером аудиофайл в моно. */
export async function decodeToClip(data: ArrayBuffer): Promise<Clip> {
  const ac = audioContext();
  const buf = await ac.decodeAudioData(data);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return { samples: out, sampleRate: buf.sampleRate };
}

// ---------- Небольшая DSP-библиотека ----------

/** Детерминированный генератор случайных чисел (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Нормальное распределение (Box–Muller) поверх равномерного генератора. */
export function gauss(rand: () => number) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function normalize(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 1e-9) {
    const g = peak / m;
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  return x;
}

export function fadeEdges(x: Float32Array, sampleRate: number, seconds = 0.005): Float32Array {
  const n = Math.min(Math.floor(sampleRate * seconds), Math.floor(x.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

/** Обрезает тишину в конце (остаток после затухания). */
export function trimTail(x: Float32Array, threshold = 1e-4): Float32Array {
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]) < threshold) end--;
  return x.subarray(0, end);
}

export type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** Коэффициенты фильтров из Audio EQ Cookbook (R. Bristow-Johnson). */
export function biquad(
  type: "lowpass" | "highpass" | "bandpass" | "highshelf" | "peaking",
  freq: number,
  sampleRate: number,
  q = Math.SQRT1_2,
  gainDb = 0,
): Biquad {
  const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case "lowpass":
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case "highshelf": {
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + sq);
      b1 = -2 * A * (A - 1 + (A + 1) * cos);
      b2 = A * (A + 1 + (A - 1) * cos - sq);
      a0 = A + 1 - (A - 1) * cos + sq;
      a1 = 2 * (A - 1 - (A + 1) * cos);
      a2 = A + 1 - (A - 1) * cos - sq;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function applyBiquad(x: Float32Array, f: Biquad): Float32Array {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
  return x;
}

/** Простая реверберация Шрёдера/Freeverb: 4 гребенчатых + 2 всепропускающих фильтра. */
export function reverb(x: Float32Array, sampleRate: number, mix: number, size = 0.7): Float32Array {
  if (mix <= 0) return x;
  const tail = Math.floor(sampleRate * (0.4 + size));
  const out = new Float32Array(x.length + tail);
  const scale = sampleRate / 44100;
  const combDelays = [1116, 1188, 1277, 1356].map((d) => Math.floor(d * scale));
  const allDelays = [556, 441].map((d) => Math.floor(d * scale));
  const feedback = 0.7 + size * 0.25;
  const damp = 0.3;
  const wet = new Float32Array(out.length);

  for (const d of combDelays) {
    const buf = new Float32Array(d);
    let idx = 0;
    let store = 0;
    for (let i = 0; i < out.length; i++) {
      const input = i < x.length ? x[i] : 0;
      const y = buf[idx];
      store = y * (1 - damp) + store * damp;
      buf[idx] = input + store * feedback;
      idx = (idx + 1) % d;
      wet[i] += y * 0.25;
    }
  }
  for (const d of allDelays) {
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < wet.length; i++) {
      const bufOut = buf[idx];
      const input = wet[i];
      buf[idx] = input + bufOut * 0.5;
      wet[i] = bufOut - input;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = (i < x.length ? x[i] : 0) * (1 - mix * 0.5) + wet[i] * mix;
  }
  return trimTail(out);
}

/** Линейная интерполяция сэмпла с дробным индексом. */
export function sampleAt(x: Float32Array, pos: number): number {
  if (pos < 0 || pos >= x.length - 1) return 0;
  const i = Math.floor(pos);
  const f = pos - i;
  return x[i] * (1 - f) + x[i + 1] * f;
}

/** Ресемплинг в другую частоту дискретизации (линейная интерполяция). */
export function resample(clip: Clip, targetRate: number): Clip {
  if (clip.sampleRate === targetRate) return clip;
  const ratio = clip.sampleRate / targetRate;
  const n = Math.floor(clip.samples.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = sampleAt(clip.samples, i * ratio);
  return { samples: out, sampleRate: targetRate };
}
