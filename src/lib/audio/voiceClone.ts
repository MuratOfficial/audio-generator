// Голос по образцу: из короткой записи собираем смех, плач, лепет, песенку и т. д.
// тем же голосом, а речь нейросети подгоняем под его высоту и тембр.
//
// 1. Запись режется на слоги: вокализованные участки (YIN) делятся по провалам громкости.
//    Для каждого слога LPC даёт форманты F1/F2 — по ним видно, «а» это, «и» или «у».
// 2. Вокализация берёт сценарий из синтезатора (слоги, высоты, длительности, паузы) и
//    озвучивает его слогами записи: PSOLA меняет высоту и длительность, сохраняя тембр.
// 3. «Х», выдохи и вдохи — белый шум через LPC-фильтр слога, то есть шёпот тем же
//    речевым трактом.

import { type Env, VOWEL_BASE_DUR, type Vocalization, vocalEvents } from "./babySynth";
import { analysisMarks, type Mark, type PitchTrack, psola, trackPitch, transformToChild } from "./childVoice";
import { applyBiquad, biquad, type Clip, fadeEdges, gauss, normalize, reverb, rng } from "./core";

// ---------- LPC ----------

/** Коэффициенты предсказания (A(z) = 1 + Σ a_k z^-k) методом Левинсона–Дарбина. */
function lpc(frame: Float32Array, order: number): { a: Float64Array; err: number } {
  const n = frame.length;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pre = frame[i] - 0.97 * (i ? frame[i - 1] : 0);
    w[i] = pre * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) for (let i = k; i < n; i++) r[k] += w[i] * w[i - k];
  r[0] *= 1.0001; // небольшая регуляризация против неустойчивости
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0] || 1e-12;
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    const prev = a.slice();
    for (let j = 1; j < i; j++) a[j] = prev[j] + k * prev[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  return { a, err: Math.max(err, 1e-12) };
}

/** Первые три пика огибающей LPC — форманты. */
function formantsOf(a: Float64Array, sr: number): number[] {
  const top = Math.min(5200, sr / 2 - 200);
  const step = 20;
  const env: number[] = [];
  for (let f = 0; f <= top; f += step) {
    const w = (2 * Math.PI * f) / sr;
    let re = 0, im = 0;
    for (let k = 0; k < a.length; k++) {
      re += a[k] * Math.cos(w * k);
      im -= a[k] * Math.sin(w * k);
    }
    env.push(1 / (re * re + im * im));
  }
  const peaks: number[] = [];
  for (let i = 1; i < env.length - 1 && peaks.length < 3; i++) {
    if (i * step > 220 && env[i] > env[i - 1] && env[i] >= env[i + 1]) peaks.push(i * step);
  }
  return peaks;
}

// ---------- Анализ записи ----------

export type VoiceUnit = {
  onset: number; // начало слога вместе с согласным (отсчёты)
  start: number; // начало вокализованной части
  end: number;
  f0: number;
  rms: number;
  F1: number;
  F2: number;
  lpc: Float64Array; // огибающая на прореженном сигнале — для шёпота
  score: number; // насколько слог хорош как материал: громкий, длинный, ровный
};

export type VoiceProfile = {
  clip: Clip;
  track: PitchTrack;
  marks: Mark[];
  units: VoiceUnit[];
  median: number;
  low: number; // 10-й процентиль тона
  high: number; // 90-й процентиль
  formantLevel: number; // средний уровень F2/F3 — длина речевого тракта
  hf: number; // доля энергии выше 3 кГц — звонкость
};

const LPC_RATE = 11025;

function decimate(clip: Clip) {
  const d = Math.max(1, Math.floor(clip.sampleRate / LPC_RATE));
  const sr = clip.sampleRate / d;
  const lp = biquad("lowpass", sr * 0.42, clip.sampleRate);
  const f = applyBiquad(applyBiquad(new Float32Array(clip.samples), lp), lp);
  const x = new Float32Array(Math.floor(f.length / d));
  for (let i = 0; i < x.length; i++) x[i] = f[i * d];
  return { x, sr, d };
}

/** Доля энергии выше 3 кГц. */
function hfRatio(clip: Clip) {
  const hp = applyBiquad(new Float32Array(clip.samples), biquad("highpass", 3000, clip.sampleRate));
  let eh = 0, e = 0;
  for (let i = 0; i < hp.length; i++) {
    eh += hp[i] * hp[i];
    e += clip.samples[i] * clip.samples[i];
  }
  return e > 0 ? eh / e : 0;
}

/** Общие характеристики голоса: высота, её размах, уровень формант, звонкость. */
function measure(clip: Clip, track: PitchTrack) {
  const voiced = Array.from(track.f0).filter((v) => v > 0).sort((p, q) => p - q);
  const q = (k: number) => voiced[Math.floor(k * (voiced.length - 1))] ?? 0;
  const dec = decimate(clip);
  const win = Math.round(dec.sr * 0.03);
  const f2: number[] = [];
  const f3: number[] = [];
  for (let f = 0; f < track.f0.length; f += 2) {
    if (!track.f0[f]) continue;
    const s = Math.round((f * track.hop) / dec.d);
    if (s + win >= dec.x.length) break;
    const F = formantsOf(lpc(dec.x.subarray(s, s + win), 12).a, dec.sr);
    if (F.length === 3) {
      f2.push(F[1]);
      f3.push(F[2]);
    }
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
  return {
    median: track.median,
    low: q(0.1),
    high: q(0.9),
    formantLevel: f2.length ? Math.sqrt(mean(f2) * mean(f3)) : 0,
    hf: hfRatio(clip),
  };
}

export function analyzeVoice(clip: Clip): VoiceProfile {
  const x = clip.samples;
  const sr = clip.sampleRate;
  const track = trackPitch(clip);
  const hop = track.hop;
  const frames = track.f0.length;
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const s = f * hop;
    for (let i = 0; i < hop && s + i < x.length; i++) e += x[s + i] * x[s + i];
    rms[f] = Math.sqrt(e / hop);
  }

  // Вокализованные отрезки делим на слоги по провалам громкости.
  const spans: [number, number][] = [];
  for (let f = 0; f < frames; ) {
    if (!track.f0[f]) {
      f++;
      continue;
    }
    const a = f;
    while (f < frames && track.f0[f]) f++;
    let segStart = a, peak = 0, valley = Infinity, valleyAt = -1;
    for (let i = a; i < f; i++) {
      const r = rms[i];
      if (r > peak) {
        peak = r;
        valley = Infinity;
      } else if (r < valley) {
        valley = r;
        valleyAt = i;
      }
      if (valleyAt > segStart && valley < 0.55 * peak && r > valley * 1.8) {
        spans.push([segStart, valleyAt]);
        segStart = valleyAt;
        peak = r;
        valley = Infinity;
      }
    }
    spans.push([segStart, f]);
  }

  const dec = decimate(clip);
  const maxRms = Math.max(1e-9, ...Array.from(rms));
  const units: VoiceUnit[] = [];
  let prevEnd = 0;
  for (const [a, b] of spans) {
    const start = a * hop;
    const end = Math.min(x.length, b * hop);
    const len = end - start;
    if (len < sr * 0.06) continue;
    let e = 0;
    for (let f = a; f < b; f++) e += rms[f];
    const unitRms = e / (b - a);
    if (unitRms < maxRms * 0.12) continue;
    const f0s = Array.from(track.f0.subarray(a, b)).filter((v) => v > 0).sort((p, q) => p - q);
    const f0 = f0s[Math.floor(f0s.length / 2)];
    let dev = 0;
    for (const v of f0s) dev += Math.log(v / f0) ** 2;
    dev = Math.sqrt(dev / f0s.length);
    // LPC по 30 мс в середине слога.
    const mid = Math.round((start + end) / 2 / dec.d);
    const win = Math.round(dec.sr * 0.03);
    const frame = dec.x.subarray(Math.max(0, mid - win / 2), Math.max(0, mid - win / 2) + win);
    const { a: coef } = lpc(frame, 12);
    const F = formantsOf(coef, dec.sr);
    units.push({
      onset: Math.max(prevEnd, start - Math.round(sr * 0.07)),
      start,
      end,
      f0,
      rms: unitRms,
      F1: F[0] ?? 500,
      F2: F[1] ?? 1500,
      lpc: coef,
      score: (unitRms / maxRms) * Math.sqrt(len / sr) / (1 + 6 * dev),
    });
    prevEnd = end;
  }
  if (!units.length) throw new Error("В записи не нашлось голоса. Запишите 5–20 секунд речи или лепета в тишине.");

  return { clip, track, marks: analysisMarks(x, sr, track), units, ...measure(clip, track) };
}

// ---------- Озвучивание сценария голосом из записи ----------

// Желаемое положение гласной в нормированных F1/F2 (z-оценки по слогам записи).
const VOWEL_TARGET: Record<string, [number, number]> = {
  a: [1.4, 0.1],
  o: [0.4, -1],
  u: [-1, -1.4],
  M: [-1, -1.4],
  i: [-1, 1.5],
  I: [-0.7, 1.1],
  e: [0.2, 0.8],
  y: [-0.6, 0.2],
  "@": [0, 0],
};

type Picker = (vowel: string, withOnset: boolean) => VoiceUnit;

function makePicker(v: VoiceProfile, rand: () => number): Picker {
  const u = v.units;
  const stat = (k: "F1" | "F2") => {
    const m = u.reduce((s, x) => s + x[k], 0) / u.length;
    const sd = Math.sqrt(u.reduce((s, x) => s + (x[k] - m) ** 2, 0) / u.length) || 1;
    return (x: VoiceUnit) => (x[k] - m) / sd;
  };
  const z1 = stat("F1");
  const z2 = stat("F2");
  const best = Math.max(...u.map((x) => x.score));
  return (vowel, withOnset) => {
    const [t1, t2] = VOWEL_TARGET[vowel] ?? [0, 0];
    const ranked = u
      .map((x) => {
        const dist = Math.hypot(z1(x) - t1, z2(x) - t2);
        const onsetBonus = withOnset && x.start - x.onset > 0.02 * v.clip.sampleRate ? 0 : withOnset ? 0.8 : 0;
        return { x, cost: dist + onsetBonus + 1.5 * (1 - x.score / best) + 0.4 * rand() };
      })
      .sort((p, q) => p.cost - q.cost);
    return ranked[0].x;
  };
}

/** Слог из записи на новой высоте и длительности. Длинные гласные тянутся «туда-обратно». */
function renderUnit(
  v: VoiceProfile,
  u: VoiceUnit,
  outLen: number,
  f0At: (t: number) => number,
  withOnset: boolean,
  creak: number,
  rand: () => number,
): Float32Array {
  const sr = v.clip.sampleRate;
  const onsetLen = withOnset ? u.start - u.onset : 0;
  const len = u.end - u.start;
  const vs = withOnset ? u.start : u.start + len * 0.12;
  const ve = u.end - len * 0.12;
  const srcLen = Math.max(1, ve - vs);
  const vowelOut = Math.max(1, outLen - onsetLen);
  const srcAt = (ts: number) => {
    if (ts < onsetLen) return u.onset + ts;
    const q = ts - onsetLen;
    if (vowelOut <= srcLen) {
      // Короткая гласная — берём середину слога без сжатия: так спектр стабильнее.
      const from = withOnset ? vs : vs + (srcLen - vowelOut) / 2;
      return from + q;
    }
    const pos = q % (2 * srcLen);
    return pos < srcLen ? vs + pos : ve - (pos - srcLen);
  };
  const periodAt = (ts: number) => {
    const t = ts / outLen;
    const c = creak * Math.max(0, (t - 0.3) / 0.7);
    return (sr / (f0At(t) * (1 - 0.3 * c))) * (1 + 0.06 * c * gauss(rand));
  };
  return psola(v.clip.samples, sr, v.marks, outLen, srcAt, periodAt, 1, Math.floor(rand() * 1e9));
}

/** Шёпот тем же речевым трактом: белый шум через LPC-фильтр слога. */
function whisper(v: VoiceProfile, u: VoiceUnit, outLen: number, rand: () => number): Float32Array {
  const sr = v.clip.sampleRate;
  const d = Math.max(1, Math.floor(sr / LPC_RATE));
  const n = Math.ceil(outLen / d) + 2;
  const low = new Float32Array(n);
  // Расширяем полосы резонансов (a_k·γ^k): у высокого голоса LPC цепляется за гармоники,
  // и без этого шёпот свистит на отдельных частотах.
  const a = u.lpc.map((c, k) => c * Math.pow(0.9, k));
  for (let i = 0; i < n; i++) {
    let y = rand() * 2 - 1;
    for (let k = 1; k < a.length && i - k >= 0; k++) y -= a[k] * low[i - k];
    low[i] = y;
  }
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const p = i / d;
    const j = Math.floor(p);
    out[i] = low[j] * (1 - (p - j)) + low[j + 1] * (p - j) + 0.04 * (rand() * 2 - 1);
  }
  return out;
}

const rmsOf = (x: Float32Array) => {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, x.length));
};

function envelope(env: Env | undefined, u: number, final: boolean) {
  let g = env === "decay" ? (u < 0.08 ? u / 0.08 : Math.exp(-2.4 * (u - 0.08))) : env === "rise" ? 0.2 + 0.8 * u * u * (3 - 2 * u) : 1;
  if (!env) g *= Math.min(1, u / 0.06, (1 - u) / 0.08); // мягкие края
  if (final && u > 0.45) g *= 1 - 0.75 * Math.min(1, (u - 0.45) / 0.55);
  return Math.max(0, g);
}

export type CloneOptions = { pitch: number; room: number; seed: number };

/** Смех, плач, лепет и т. д. голосом из записи. */
export function cloneVocalization(v: VoiceProfile, kind: Exclude<Vocalization, "text">, o: CloneOptions): Clip {
  const sr = v.clip.sampleRate;
  const rand = rng(o.seed * 7919 + kind.length);
  const events = vocalEvents(kind, rand);
  const pick = makePicker(v, rand);
  // Высота сценария задана множителями к «обычному» тону — им становится средний тон записи.
  const base = v.median * o.pitch;
  const expr = kind === "surprise" ? 1.2 : 1;
  const ref = v.units.map((u) => u.rms).sort((p, q) => p - q)[Math.floor(v.units.length / 2)];
  // В лепете один и тот же слог повторяется — запоминаем выбор для каждого согласного.
  const syllableFor = new Map<string, VoiceUnit>();
  const syllabic = kind === "babble" || kind === "sing";

  const pieces: { at: number; x: Float32Array }[] = [];
  let t = 0.03 * sr;
  events.forEach((ev, ei) => {
    if (ev.type === "pause") {
      t += ev.dur * sr;
      return;
    }
    if (ev.type === "breath") {
      const len = Math.round(ev.dur * sr);
      const w = whisper(v, pick(ev.vowel, false), len, rand);
      const g = (ev.amp * 1.1 * ref) / Math.max(1e-9, rmsOf(w));
      for (let i = 0; i < len; i++) w[i] *= g * envelope(ev.env ?? "decay", i / len, false);
      pieces.push({ at: t, x: w });
      t += len;
      return;
    }
    const next = events[ei + 1];
    const final = !next || next.type === "breath" || (next.type === "pause" && next.dur >= 0.1);
    const vowel = ev.phones.find((p) => VOWEL_TARGET[p]) ?? "a";
    const amp = ev.amp ?? 1;
    // «Х» перед гласной — шёпот того же слога.
    const unit = syllabic
      ? syllableFor.get(ev.phones[0]) ?? syllableFor.set(ev.phones[0], pick(vowel, true)).get(ev.phones[0])!
      : pick(vowel, false);
    if (ev.phones.includes("hh") || ev.phones.includes("x")) {
      const len = Math.round(0.07 * (ev.breathy ? 0.65 : 1) * sr);
      const w = whisper(v, unit, len, rand);
      const g = (0.45 * amp * ref) / Math.max(1e-9, rmsOf(w));
      for (let i = 0; i < len; i++) w[i] *= g * Math.min(1, i / (0.01 * sr)) * (1 - 0.5 * (i / len));
      pieces.push({ at: t, x: w });
      t += len * 0.8; // «х» слегка заходит на гласную
    }
    const withOnset = syllabic && unit.start - unit.onset > 0.02 * sr;
    const onsetLen = withOnset ? unit.start - unit.onset : 0;
    const len = Math.round(VOWEL_BASE_DUR * (ev.dur ?? 1) * sr) + onsetLen;
    const pts = ev.f0.map((m) => base * (1 + (m - 1) * expr));
    const f0At = (u: number) => {
      if (pts.length === 1) return pts[0];
      const p = u * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(p));
      return pts[i] * Math.pow(pts[i + 1] / pts[i], p - i);
    };
    const x = renderUnit(v, unit, len, f0At, withOnset, ev.creak ?? 0, rand);
    if (ev.phones.includes("M")) applyBiquad(x, biquad("lowpass", 900, sr)); // «хм» с закрытым ртом
    if (ev.breathy) {
      const w = whisper(v, unit, len, rand);
      const g = (ev.breathy * 0.25 * rmsOf(x)) / Math.max(1e-9, rmsOf(w));
      for (let i = 0; i < len; i++) x[i] += w[i] * g;
    }
    const g = (amp * ref) / Math.max(1e-9, unit.rms);
    for (let i = 0; i < len; i++) x[i] *= g * envelope(ev.env, i / len, final);
    pieces.push({ at: t, x });
    t += len;
  });

  const total = Math.ceil(t + 0.08 * sr);
  let out: Float32Array = new Float32Array(total);
  for (const p of pieces) {
    const at = Math.round(p.at);
    for (let i = 0; i < p.x.length && at + i < total; i++) out[at + i] += p.x[i];
  }
  out = applyBiquad(out, biquad("highpass", 70, sr));
  normalize(out, 0.8);
  out = reverb(out, sr, o.room * 0.6, 0.5);
  normalize(out, 0.9);
  fadeEdges(out, sr, 0.004);
  return { samples: out, sampleRate: sr };
}

/** Речь нейросети → высота, размах интонации, тембр и звонкость голоса из записи. */
export function speechInVoice(speech: Clip, v: VoiceProfile, o: Omit<CloneOptions, "seed">): Clip {
  const track = trackPitch(speech);
  const src = measure(speech, track);
  const range = (m: { low: number; high: number }) => Math.log(Math.max(1.05, m.high / Math.max(1, m.low)));
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  const params = {
    targetPitch: v.median * o.pitch,
    formant: src.formantLevel && v.formantLevel ? clamp(v.formantLevel / src.formantLevel, 0.75, 1.7) : 1,
    speed: 1,
    expressiveness: clamp(range(v) / range(src), 0.6, 1.8),
    brightness: 0,
  };
  // Второй проход: сдвиг формант через PSOLA неточен (особенно вниз), а звонкость
  // зависит от него же — меряем первый результат и поправляем оба параметра.
  const first = transformToChild(speech, params, track);
  const got = measure(first, trackPitch(first));
  const formant = got.formantLevel && v.formantLevel ? clamp((params.formant * v.formantLevel) / got.formantLevel, 0.7, 1.8) : params.formant;
  const hf = hfRatio(transformToChild(speech, { ...params, formant }, track));
  const brightness = hf > 0 && v.hf > 0 ? clamp(10 * Math.log10(v.hf / hf), -8, 10) : 0;
  let y = transformToChild(speech, { ...params, formant, brightness }, track).samples;
  y = reverb(y, speech.sampleRate, o.room * 0.6, 0.5);
  normalize(y, 0.9);
  return { samples: y, sampleRate: speech.sampleRate };
}
