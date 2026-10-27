// Превращение взрослого голоса в детский.
//
// 1. Основной тон оценивается алгоритмом YIN на прореженном сигнале.
// 2. TD-PSOLA: сигнал режется на зёрна длиной два периода вокруг голосовых импульсов
//    и складывается заново с новым шагом — так меняется высота без изменения тембра.
// 3. Каждое зерно ещё и сжимается во времени — это поднимает форманты
//    (эффект «короткого речевого тракта»), не трогая высоту.

import { applyBiquad, biquad, type Clip, fadeEdges, normalize, sampleAt } from "./core";

// ---------- Оценка основного тона (YIN) ----------

export type PitchTrack = {
  f0: Float32Array; // Гц, 0 — невокализованный участок
  hop: number; // шаг кадров в отсчётах исходного сигнала
  median: number; // медиана F0 по вокализованным кадрам
};

export function trackPitch(clip: Clip, minHz = 65, maxHz = 650): PitchTrack {
  const { samples, sampleRate } = clip;
  const d = Math.max(1, Math.floor(sampleRate / 11025));
  const sr = sampleRate / d;

  // Прореживание с ФНЧ (два каскада для крутизны).
  const lp = biquad("lowpass", sr * 0.4, sampleRate);
  const filtered = applyBiquad(applyBiquad(new Float32Array(samples), lp), lp);
  const x = new Float32Array(Math.floor(samples.length / d));
  for (let i = 0; i < x.length; i++) x[i] = filtered[i * d];

  const hopSec = 0.01;
  const hopD = Math.round(sr * hopSec);
  const W = Math.round(sr * 0.03);
  const tauMin = Math.floor(sr / maxHz);
  const tauMax = Math.ceil(sr / minHz);
  const frames = Math.max(0, Math.floor((x.length - W - tauMax) / hopD) + 1);
  const f0 = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const diff = new Float32Array(tauMax + 1);
  const cm = new Float32Array(tauMax + 1);

  let maxRms = 0;
  for (let f = 0; f < frames; f++) {
    const s = f * hopD;
    let e = 0;
    for (let j = 0; j < W; j++) e += x[s + j] * x[s + j];
    rms[f] = Math.sqrt(e / W);
    maxRms = Math.max(maxRms, rms[f]);
  }

  for (let f = 0; f < frames; f++) {
    if (rms[f] < maxRms * 0.04) continue;
    const s = f * hopD;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const dd = x[s + j] - x[s + j + tau];
        sum += dd * dd;
      }
      diff[tau] = sum;
    }
    // Кумулятивная нормированная разностная функция.
    let running = 0;
    let best = -1;
    let bestVal = 1;
    cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += diff[tau];
      cm[tau] = running > 0 ? (diff[tau] * tau) / running : 1;
    }
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cm[tau] < 0.15) {
        while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++;
        best = tau;
        bestVal = cm[tau];
        break;
      }
    }
    if (best < 0) {
      for (let tau = tauMin; tau < tauMax; tau++) {
        if (cm[tau] < bestVal) {
          bestVal = cm[tau];
          best = tau;
        }
      }
      if (bestVal > 0.3) continue;
    }
    // Параболическая интерполяция минимума.
    const a = cm[best - 1] ?? cm[best];
    const b = cm[best];
    const c = cm[best + 1] ?? cm[best];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    f0[f] = sr / (best + Math.max(-0.5, Math.min(0.5, shift)));
  }

  // Медианный фильтр по 5 кадрам против октавных скачков и одиночных выбросов.
  const smooth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    if (!f0[f]) continue;
    const win: number[] = [];
    for (let k = -2; k <= 2; k++) if (f0[f + k]) win.push(f0[f + k]);
    win.sort((p, q) => p - q);
    smooth[f] = win.length >= 2 ? win[Math.floor(win.length / 2)] : 0;
  }

  const voiced = Array.from(smooth).filter((v) => v > 0).sort((p, q) => p - q);
  const median = voiced.length ? voiced[Math.floor(voiced.length / 2)] : 0;
  return { f0: smooth, hop: hopD * d, median };
}

// ---------- Преобразование ----------

export type ChildVoiceParams = {
  targetPitch: number; // целевая средняя высота, Гц
  formant: number; // множитель формант (1 — без изменений)
  speed: number; // темп: >1 — быстрее
  expressiveness: number; // размах интонации: 1 — как в оригинале
  brightness: number; // подъём верхов, дБ
};

export type ChildPreset = {
  id: string;
  label: string;
  hint: string;
  targetPitch: number;
  formant: number; // для женского исходного голоса; для мужского умножается
  speed: number;
  expressiveness: number;
  brightness: number;
};

export const CHILD_PRESETS: ChildPreset[] = [
  { id: "baby", label: "Малыш 3 года", hint: "очень высокий, мягкий", targetPitch: 380, formant: 1.32, speed: 0.92, expressiveness: 1.4, brightness: 2 },
  { id: "kid", label: "Ребёнок 6 лет", hint: "звонкий, живой", targetPitch: 300, formant: 1.24, speed: 1, expressiveness: 1.3, brightness: 3 },
  { id: "school", label: "Школьник 9 лет", hint: "чуть ниже, увереннее", targetPitch: 265, formant: 1.16, speed: 1, expressiveness: 1.15, brightness: 2 },
  { id: "teen", label: "Подросток 12 лет", hint: "почти взрослый", targetPitch: 230, formant: 1.08, speed: 1, expressiveness: 1, brightness: 1 },
  { id: "toon", label: "Мультяшный", hint: "как в мультфильмах", targetPitch: 460, formant: 1.42, speed: 1.08, expressiveness: 1.6, brightness: 4 },
];

/** Подбирает параметры пресета с учётом голоса источника (мужской голос требует большего сдвига формант). */
export function presetParams(preset: ChildPreset, sourceMedian: number): ChildVoiceParams {
  const maleSource = sourceMedian > 0 && sourceMedian < 165;
  return {
    targetPitch: preset.targetPitch,
    formant: +(preset.formant * (maleSource ? 1.12 : 1)).toFixed(2),
    speed: preset.speed,
    expressiveness: preset.expressiveness,
    brightness: preset.brightness,
  };
}

type Mark = { pos: number; period: number; voiced: boolean; f0: number };

function analysisMarks(x: Float32Array, sr: number, track: PitchTrack): Mark[] {
  const marks: Mark[] = [];
  const unvoicedPeriod = Math.round(sr * 0.005);
  let t = 0;
  let prevVoiced = false;
  let sign = 1;
  while (t < x.length) {
    const fi = Math.min(track.f0.length - 1, Math.floor(t / track.hop));
    const f0 = fi >= 0 ? track.f0[fi] : 0;
    if (f0 > 0) {
      const T = sr / f0;
      // Привязка меток к пикам сигнала — зёрна центрируются на голосовых импульсах.
      let lo: number, hi: number;
      if (!prevVoiced) {
        lo = Math.floor(t);
        hi = Math.floor(t + T);
      } else {
        lo = Math.floor(t - T * 0.2);
        hi = Math.floor(t + T * 0.2);
      }
      lo = Math.max(0, lo);
      hi = Math.min(x.length - 1, hi);
      let best = Math.round(t);
      let bestVal = -Infinity;
      for (let i = lo; i <= hi; i++) {
        const v = prevVoiced ? x[i] * sign : Math.abs(x[i]);
        if (v > bestVal) {
          bestVal = v;
          best = i;
        }
      }
      if (!prevVoiced) sign = x[best] >= 0 ? 1 : -1;
      if (marks.length && best <= marks[marks.length - 1].pos) best = Math.round(t);
      marks.push({ pos: best, period: T, voiced: true, f0 });
      t = best + T;
      prevVoiced = true;
    } else {
      marks.push({ pos: Math.round(t), period: unvoicedPeriod, voiced: false, f0: 0 });
      t += unvoicedPeriod;
      prevVoiced = false;
    }
  }
  return marks;
}

export function transformToChild(clip: Clip, p: ChildVoiceParams, track = trackPitch(clip)): Clip {
  const { samples: x, sampleRate: sr } = clip;
  const marks = analysisMarks(x, sr, track);
  const median = track.median || 200;
  const outLen = Math.ceil(x.length / p.speed) + sr;
  const out = new Float32Array(outLen);
  const fs = p.formant;

  let ts = 0;
  let k = 0;
  while (ts < outLen - sr && marks.length) {
    const ta = ts * p.speed;
    while (k < marks.length - 1 && Math.abs(marks[k + 1].pos - ta) <= Math.abs(marks[k].pos - ta)) k++;
    const m = marks[k];

    let outPeriod: number;
    if (m.voiced) {
      const rel = m.f0 / median;
      const f0out = p.targetPitch * Math.pow(rel, p.expressiveness);
      outPeriod = sr / f0out;
    } else {
      outPeriod = m.period / fs;
    }

    // Зерно: два периода с окном Ханна, сжатое в fs раз для сдвига формант.
    const half = m.period / fs;
    const L = Math.ceil(half);
    const gain = Math.min(1.5, outPeriod / half);
    const center = Math.round(ts);
    for (let j = -L; j <= L; j++) {
      const idx = center + j;
      if (idx < 0 || idx >= outLen) continue;
      const w = 0.5 * (1 + Math.cos((Math.PI * j) / half));
      if (Math.abs(j) >= half) continue;
      out[idx] += sampleAt(x, m.pos + j * fs) * w * gain;
    }
    ts += Math.max(2, outPeriod);
  }

  let y: Float32Array = out.subarray(0, Math.ceil(x.length / p.speed));
  y = applyBiquad(y, biquad("highpass", 110, sr));
  if (p.brightness) y = applyBiquad(y, biquad("highshelf", 3000, sr, 0.7, p.brightness));
  normalize(y, 0.9);
  fadeEdges(y, sr, 0.01);
  return { samples: y, sampleRate: sr };
}
