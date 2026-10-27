// Формантный синтезатор детского голоса (по мотивам каскадного синтезатора Клатта).
//
// Источник — последовательность голосовых импульсов Розенберга с джиттером/шиммером
// и придыханием; фильтр — каскад из пяти резонаторов-формант. Шумные согласные
// идут параллельной веткой через полосовой фильтр. Детский голос получается за счёт
// высокой частоты основного тона (300–450 Гц) и сдвинутых вверх формант
// (короткий речевой тракт).

import {
  applyBiquad,
  biquad,
  type Clip,
  fadeEdges,
  gauss,
  normalize,
  reverb,
  rng,
} from "./core";

const SR = 44100;

type Formants = [number, number, number];

// Форманты гласных для ребёнка ~6 лет (Гц).
const VOWELS: Record<string, Formants> = {
  a: [1000, 1550, 3300],
  o: [680, 1100, 3200],
  u: [430, 1000, 3100],
  i: [400, 3000, 3800],
  e: [620, 2450, 3500],
  y: [450, 1850, 3200],
};
const VOWEL_BW: Formants = [90, 120, 180];

type PhoneDef =
  | { kind: "vowel"; F: Formants }
  | { kind: "nasal"; F: Formants; dur: number }
  | { kind: "stop"; voiced: boolean; F: Formants; noiseF: number; dur: number }
  | { kind: "fric"; voiced: boolean; F: Formants; noiseF: number; noiseQ: number; amp: number; dur: number }
  | { kind: "approx"; F: Formants; amp: number; dur: number }
  | { kind: "asp"; dur: number };

const PHONES: Record<string, PhoneDef> = {
  a: { kind: "vowel", F: VOWELS.a },
  o: { kind: "vowel", F: VOWELS.o },
  u: { kind: "vowel", F: VOWELS.u },
  i: { kind: "vowel", F: VOWELS.i },
  e: { kind: "vowel", F: VOWELS.e },
  y: { kind: "vowel", F: VOWELS.y },
  m: { kind: "nasal", F: [280, 1100, 2600], dur: 0.075 },
  n: { kind: "nasal", F: [280, 1700, 2700], dur: 0.07 },
  b: { kind: "stop", voiced: true, F: [320, 900, 2400], noiseF: 900, dur: 0.05 },
  p: { kind: "stop", voiced: false, F: [320, 900, 2400], noiseF: 900, dur: 0.06 },
  d: { kind: "stop", voiced: true, F: [320, 1900, 2900], noiseF: 4500, dur: 0.045 },
  t: { kind: "stop", voiced: false, F: [320, 1900, 2900], noiseF: 4500, dur: 0.055 },
  g: { kind: "stop", voiced: true, F: [320, 2200, 2500], noiseF: 2300, dur: 0.05 },
  k: { kind: "stop", voiced: false, F: [320, 2200, 2500], noiseF: 2300, dur: 0.06 },
  v: { kind: "fric", voiced: true, F: [320, 1100, 2500], noiseF: 4000, noiseQ: 1, amp: 0.12, dur: 0.07 },
  f: { kind: "fric", voiced: false, F: [320, 1100, 2500], noiseF: 5000, noiseQ: 0.8, amp: 0.25, dur: 0.1 },
  z: { kind: "fric", voiced: true, F: [320, 1800, 2800], noiseF: 7000, noiseQ: 2.5, amp: 0.3, dur: 0.09 },
  s: { kind: "fric", voiced: false, F: [320, 1800, 2800], noiseF: 7000, noiseQ: 2.5, amp: 0.5, dur: 0.11 },
  zh: { kind: "fric", voiced: true, F: [320, 1700, 2600], noiseF: 3200, noiseQ: 2, amp: 0.3, dur: 0.09 },
  sh: { kind: "fric", voiced: false, F: [320, 1700, 2600], noiseF: 3200, noiseQ: 2, amp: 0.5, dur: 0.11 },
  x: { kind: "fric", voiced: false, F: [400, 1400, 2600], noiseF: 1700, noiseQ: 1.3, amp: 0.25, dur: 0.09 },
  l: { kind: "approx", F: [380, 1200, 2700], amp: 0.65, dur: 0.06 },
  r: { kind: "approx", F: [420, 1350, 2400], amp: 0.35, dur: 0.035 },
  j: { kind: "approx", F: [330, 2700, 3500], amp: 0.6, dur: 0.045 },
  w: { kind: "approx", F: [350, 800, 2500], amp: 0.6, dur: 0.06 },
  // Придыхательное «х» как в смехе — шум через форманты следующей гласной.
  hh: { kind: "asp", dur: 0.07 },
};

// ---------- Структура высказывания ----------

/** Слог: согласные + одна гласная (или только согласные). f0 — множители по ходу гласной. */
export type Syl = {
  type: "syl";
  phones: string[];
  f0: number[];
  dur?: number; // множитель длительности гласной
  amp?: number;
};
type Ev = Syl | { type: "pause"; dur: number } | { type: "breath"; dur: number; amp: number; vowel: string };

type Seg = {
  t0: number;
  t1: number;
  F: Formants;
  bw: Formants;
  voice: number;
  asp: number;
  noise: number;
  noiseF: number;
  noiseQ: number;
  tau: number;
};

type Plan = { segs: Seg[]; f0: [number, number][]; total: number };

const VOWEL_BASE_DUR = 0.15;

function buildPlan(events: Ev[], baseF0: number, tempo: number, expr: number): Plan {
  const segs: Seg[] = [];
  const f0: [number, number][] = [];
  let t = 0.03;
  const push = (dur: number, s: Omit<Seg, "t0" | "t1">) => {
    segs.push({ ...s, t0: t, t1: t + dur });
    t += dur;
  };
  const silent = (F: Formants): Omit<Seg, "t0" | "t1"> => ({
    F, bw: VOWEL_BW, voice: 0, asp: 0, noise: 0, noiseF: 1000, noiseQ: 1, tau: 0.03,
  });
  const lastF = () => (segs.length ? segs[segs.length - 1].F : VOWELS.a);

  for (const ev of events) {
    if (ev.type === "pause") {
      push(ev.dur / tempo, silent(lastF()));
      continue;
    }
    if (ev.type === "breath") {
      const F = VOWELS[ev.vowel] ?? VOWELS.a;
      push(ev.dur / tempo, { ...silent(F), asp: ev.amp, bw: [200, 250, 300] });
      continue;
    }
    const amp = ev.amp ?? 1;
    const vowelIdx = ev.phones.findIndex((p) => PHONES[p]?.kind === "vowel");
    const nextVowelF = (from: number) => {
      for (let k = from; k < ev.phones.length; k++) {
        const d = PHONES[ev.phones[k]];
        if (d?.kind === "vowel") return d.F;
      }
      return lastF();
    };

    ev.phones.forEach((ph, k) => {
      const d = PHONES[ph];
      if (!d) return;
      const dur = (x: number) => x / tempo;
      switch (d.kind) {
        case "vowel": {
          const vd = dur(VOWEL_BASE_DUR * (ev.dur ?? 1));
          const n = ev.f0.length;
          for (let q = 0; q < n; q++) {
            const m = 1 + (ev.f0[q] - 1) * expr;
            f0.push([t + (n === 1 ? vd / 2 : (vd * q) / (n - 1)), baseF0 * m]);
          }
          push(vd, { ...silent(d.F), voice: amp, tau: 0.035 });
          break;
        }
        case "nasal":
          push(dur(d.dur), { ...silent(d.F), bw: [180, 300, 350], voice: 0.3 * amp, tau: 0.015 });
          break;
        case "approx":
          push(dur(d.dur), { ...silent(d.F), voice: d.amp * amp, tau: 0.02 });
          break;
        case "fric":
          push(dur(d.dur), {
            ...silent(d.F), voice: d.voiced ? 0.25 * amp : 0, noise: d.amp * amp,
            noiseF: d.noiseF, noiseQ: d.noiseQ, tau: 0.02,
          });
          break;
        case "asp":
          push(dur(d.dur), { ...silent(nextVowelF(k)), asp: 0.55 * amp, bw: [150, 200, 250], tau: 0.01 });
          break;
        case "stop": {
          const v = nextVowelF(k);
          push(dur(d.dur), { ...silent(d.F), voice: d.voiced ? 0.06 : 0, tau: 0.012 });
          push(0.012, { ...silent(d.F), noise: 0.7 * amp, noiseF: d.noiseF, noiseQ: 1.2, tau: 0.012 });
          if (!d.voiced) push(dur(0.035), { ...silent(v), asp: 0.35 * amp, bw: [150, 200, 250], tau: 0.015 });
          break;
        }
      }
    });
    if (vowelIdx < 0 && ev.f0.length) f0.push([t, baseF0 * ev.f0[0]]);
  }
  push(0.08, silent(lastF()));
  if (!f0.length) f0.push([0, baseF0]);
  return { segs, f0, total: t };
}

// ---------- Рендер ----------

class Resonator {
  private a = 0;
  private b = 0;
  private c = 0;
  private y1 = 0;
  private y2 = 0;
  set(f: number, bw: number) {
    const T = 1 / SR;
    this.c = -Math.exp(-2 * Math.PI * bw * T);
    this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * Math.min(f, SR * 0.45) * T);
    this.a = 1 - this.b - this.c;
  }
  tick(x: number) {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class Bandpass {
  private f = biquad("bandpass", 1000, SR, 1);
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  set(freq: number, q: number) {
    this.f = biquad("bandpass", freq, SR, q);
  }
  tick(x: number) {
    const f = this.f;
    const y = f.b0 * x + f.b1 * this.x1 + f.b2 * this.x2 - f.a1 * this.y1 - f.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function rosenberg(ph: number) {
  const tp = 0.4;
  const tn = 0.16;
  if (ph < tp) return 0.5 * (1 - Math.cos((Math.PI * ph) / tp));
  if (ph < tp + tn) return Math.cos((Math.PI * (ph - tp)) / (2 * tn));
  return 0;
}

type RenderOpts = {
  formantScale: number;
  breath: number;
  jitter: number;
  shimmer: number;
  subharmonic: number;
  tilt: number; // 0 — мягкий тембр, 1 — яркий
  vibratoRate: number;
  vibratoDepth: number;
  seed: number;
};

function render(plan: Plan, o: RenderOpts): Float32Array {
  const rand = rng(o.seed);
  const n = Math.ceil(plan.total * SR);
  const out = new Float32Array(n);
  const casc = [new Resonator(), new Resonator(), new Resonator(), new Resonator(), new Resonator()];
  const noiseBp = new Bandpass();

  const first = plan.segs[0];
  const F = [...first.F] as Formants;
  const BW = [...first.bw] as Formants;
  let voice = 0, asp = 0, noise = 0;
  let noiseF = first.noiseF, noiseQ = first.noiseQ;
  let seg = 0, fp = 0;
  let phase = 0, gPrev = 0, tiltState = 0;
  let periodF0 = plan.f0[0][1];
  let periodAmp = 1, periodIdx = 0;
  let drift = 0;
  const aAmp = 1 - Math.exp(-1 / (0.006 * SR));
  const aNoise = 1 - Math.exp(-1 / (0.002 * SR));
  const tiltCoef = 0.25 + 0.75 * o.tilt;

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    while (seg < plan.segs.length - 1 && t >= plan.segs[seg].t1) seg++;
    const s = plan.segs[seg];

    // Плавное движение параметров к целям текущего сегмента.
    const aF = 1 - Math.exp(-1 / (s.tau * SR));
    for (let k = 0; k < 3; k++) {
      F[k] += (s.F[k] - F[k]) * aF;
      BW[k] += (s.bw[k] - BW[k]) * aF;
    }
    voice += (s.voice - voice) * aAmp;
    asp += (s.asp - asp) * aAmp;
    noise += (s.noise - noise) * aNoise;
    noiseF += (s.noiseF - noiseF) * aNoise;
    noiseQ += (s.noiseQ - noiseQ) * aNoise;

    if ((i & 15) === 0) {
      const fs = o.formantScale;
      for (let k = 0; k < 3; k++) casc[k].set(F[k] * fs, BW[k] * Math.sqrt(fs));
      casc[3].set(4300 * fs, 300);
      casc[4].set(5300 * fs, 400);
      noiseBp.set(noiseF * Math.min(fs, 1.15), noiseQ);
    }

    // Контур основного тона.
    while (fp < plan.f0.length - 1 && t >= plan.f0[fp + 1][0]) fp++;
    let f0: number;
    if (t <= plan.f0[0][0]) f0 = plan.f0[0][1];
    else if (fp >= plan.f0.length - 1) f0 = plan.f0[plan.f0.length - 1][1];
    else {
      const [ta, fa] = plan.f0[fp];
      const [tb, fb] = plan.f0[fp + 1];
      const r = (t - ta) / Math.max(1e-6, tb - ta);
      f0 = fa * Math.pow(fb / fa, r);
    }
    if (o.vibratoDepth > 0) f0 *= 1 + o.vibratoDepth * Math.sin(2 * Math.PI * o.vibratoRate * t);
    if ((i & 255) === 0) drift = drift * 0.97 + gauss(rand) * 0.004;
    f0 *= 1 + drift;

    // Голосовой источник.
    phase += periodF0 / SR;
    if (phase >= 1) {
      phase -= 1;
      periodIdx++;
      periodF0 = f0 * (1 + o.jitter * gauss(rand));
      periodAmp = Math.max(0.2, 1 + o.shimmer * gauss(rand));
      if (o.subharmonic > 0 && periodIdx % 2) periodAmp *= 1 - o.subharmonic;
    }
    const g = rosenberg(phase);
    let src = ((g - gPrev) * SR) / (periodF0 * 10);
    gPrev = g;
    tiltState += (src - tiltState) * tiltCoef;
    src = tiltState * voice * periodAmp;

    const white = rand() * 2 - 1;
    const openPhase = phase < 0.56 ? 1 : 0.35;
    const aspAmt = asp + o.breath * voice * 0.22;
    src += white * aspAmt * (voice > 0.05 ? openPhase : 1) * 0.35;

    let y = src;
    for (let k = 0; k < 5; k++) y = casc[k].tick(y);
    y += noiseBp.tick(rand() * 2 - 1) * noise * 0.6;
    out[i] = y;
  }
  return out;
}

// ---------- Параметры и пресеты ----------

export type BabyAge = "baby" | "toddler" | "child";

export const AGES: Record<BabyAge, { label: string; emoji: string; f0: number; formant: number; tempo: number }> = {
  baby: { label: "Младенец", emoji: "🍼", f0: 430, formant: 1.22, tempo: 0.85 },
  toddler: { label: "Малыш 2–3 года", emoji: "🧸", f0: 350, formant: 1.12, tempo: 0.95 },
  child: { label: "Ребёнок 5–7 лет", emoji: "🎒", f0: 285, formant: 1.0, tempo: 1.0 },
};

export type Vocalization = "text" | "laugh" | "giggle" | "cry" | "coo" | "babble" | "sing" | "surprise";

export const VOCALIZATIONS: { id: Vocalization; label: string; emoji: string }[] = [
  { id: "text", label: "Слова", emoji: "💬" },
  { id: "laugh", label: "Смех", emoji: "😆" },
  { id: "giggle", label: "Хихиканье", emoji: "🤭" },
  { id: "babble", label: "Лепет", emoji: "👶" },
  { id: "coo", label: "Гуление", emoji: "🥰" },
  { id: "cry", label: "Плач", emoji: "😭" },
  { id: "surprise", label: "Удивление", emoji: "😮" },
  { id: "sing", label: "Песенка", emoji: "🎵" },
];

export type BabyParams = {
  age: BabyAge;
  vocalization: Vocalization;
  text: string;
  pitch: number; // множитель высоты, 0.7–1.5
  vocalTract: number; // множитель формант, 0.85–1.3
  tempo: number; // 0.6–1.6
  expressiveness: number; // 0–2
  breath: number; // 0–1
  roughness: number; // 0–1
  room: number; // 0–1
  seed: number;
};

export const DEFAULT_BABY: BabyParams = {
  age: "toddler",
  vocalization: "text",
  text: "Мама, папа! Дай ням-ням. Агу?",
  pitch: 1,
  vocalTract: 1,
  tempo: 1,
  expressiveness: 1,
  breath: 0.3,
  roughness: 0.15,
  room: 0.15,
  seed: 1,
};

// ---------- Текст → слоги ----------

const LETTERS: Record<string, string[]> = {
  а: ["a"], о: ["o"], у: ["u"], ы: ["y"], э: ["e"], и: ["i"],
  е: ["e"], ё: ["o"], ю: ["u"], я: ["a"],
  м: ["m"], н: ["n"], б: ["b"], п: ["p"], д: ["d"], т: ["t"], г: ["g"], к: ["k"],
  в: ["v"], ф: ["f"], з: ["z"], с: ["s"], ж: ["zh"], ш: ["sh"], щ: ["sh", "sh"],
  х: ["x"], л: ["l"], р: ["r"], й: ["j"], ц: ["t", "s"], ч: ["t", "sh"],
  // Латиница — для простого лепета вроде «baba», «gaga».
  a: ["a"], o: ["o"], u: ["u"], i: ["i"], e: ["e"], y: ["j"],
  m: ["m"], n: ["n"], b: ["b"], p: ["p"], d: ["d"], t: ["t"], g: ["g"], k: ["k"], c: ["k"],
  v: ["v"], f: ["f"], z: ["z"], s: ["s"], h: ["hh"], l: ["l"], r: ["r"], j: ["j"], w: ["w"],
};
const IOTATED = new Set(["е", "ё", "ю", "я"]);
const isVowelPhone = (p: string) => PHONES[p]?.kind === "vowel";

function wordToSyllables(word: string): { phones: string[]; stressed: boolean }[] {
  const phones: string[] = [];
  const stressMarks: boolean[] = [];
  let prevVowelOrStart = true;
  for (let k = 0; k < word.length; k++) {
    const ch = word[k];
    if (ch === "+") {
      if (stressMarks.length) stressMarks[stressMarks.length - 1] = true;
      continue;
    }
    if (ch === "ь" || ch === "ъ") {
      prevVowelOrStart = ch === "ъ";
      continue;
    }
    const ph = LETTERS[ch];
    if (!ph) continue;
    if (IOTATED.has(ch) && prevVowelOrStart) phones.push("j");
    for (const p of ph) {
      phones.push(p);
      if (isVowelPhone(p)) stressMarks.push(false);
    }
    prevVowelOrStart = ph.some(isVowelPhone);
  }
  // Деление на слоги: согласные перед гласной — её начало, хвост — к последнему слогу.
  const syls: { phones: string[]; stressed: boolean }[] = [];
  let cur: string[] = [];
  let vi = 0;
  for (const p of phones) {
    cur.push(p);
    if (isVowelPhone(p)) {
      syls.push({ phones: cur, stressed: stressMarks[vi++] });
      cur = [];
    }
  }
  if (cur.length) {
    if (syls.length) syls[syls.length - 1].phones.push(...cur);
    else syls.push({ phones: cur, stressed: false });
  }
  if (syls.length && !syls.some((s) => s.stressed)) syls[0].stressed = true;
  return syls;
}

function textEvents(text: string): Ev[] {
  const events: Ev[] = [];
  const phrases = text.toLowerCase().match(/[^.!?…,;:]+[.!?…,;:]*/g) ?? [];
  for (const phrase of phrases) {
    const punct = phrase.match(/[.!?…,;:]+$/)?.[0] ?? "";
    const words = phrase.replace(/[.!?…,;:]+$/, "").split(/[\s\-—]+/).filter(Boolean);
    const sylls = words.map(wordToSyllables);
    const total = sylls.reduce((s, w) => s + w.length, 0);
    const question = punct.includes("?");
    const exclaim = punct.includes("!");
    let idx = 0;
    sylls.forEach((w, wi) => {
      w.forEach((s) => {
        const decl = 1 - 0.14 * (idx / Math.max(1, total - 1));
        const lift = exclaim ? 1.1 : 1;
        const last = idx === total - 1;
        let f0: number[];
        if (last && question) f0 = [decl, decl * 1.12, decl * 1.4];
        else if (s.stressed) f0 = [decl * lift, decl * lift * (exclaim ? 1.3 : 1.16), decl * lift * 1.02];
        else f0 = [decl * lift * 0.98, decl * lift * 0.95];
        const hasVowel = s.phones.some(isVowelPhone);
        events.push({
          type: "syl",
          phones: s.phones,
          f0,
          dur: (s.stressed ? 1.35 : 0.95) * (last ? 1.4 : 1) * (hasVowel ? 1 : 0),
          amp: s.stressed ? 1 : 0.8,
        });
        idx++;
      });
      if (wi < sylls.length - 1) events.push({ type: "pause", dur: 0.035 });
    });
    if (punct) events.push({ type: "pause", dur: /[.!?…]/.test(punct) ? 0.38 : 0.18 });
  }
  return events;
}

// ---------- Вокализации ----------

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function laughEvents(rand: () => number, giggle: boolean): Ev[] {
  const ev: Ev[] = [];
  const bursts = giggle ? 2 : 1 + Math.floor(rand() * 2);
  for (let b = 0; b < bursts; b++) {
    const n = (giggle ? 5 : 4) + Math.floor(rand() * 4);
    const vowel = giggle ? pick(rand, ["i", "i", "e"]) : pick(rand, ["a", "a", "e", "o"]);
    const top = giggle ? 1.45 : 1.25 + rand() * 0.15;
    for (let k = 0; k < n; k++) {
      const p = k / Math.max(1, n - 1);
      const f = top - p * (giggle ? 0.25 : 0.35) + (rand() - 0.5) * 0.06;
      ev.push({
        type: "syl",
        phones: ["hh", vowel],
        f0: [f * 1.02, f, f * 0.96],
        dur: (giggle ? 0.45 : 0.62) * (0.9 + rand() * 0.2),
        amp: 1 - p * 0.4,
      });
      ev.push({ type: "pause", dur: giggle ? 0.025 : 0.04 });
    }
    ev.push({ type: "breath", dur: giggle ? 0.22 : 0.32, amp: 0.25, vowel: "i" });
    ev.push({ type: "pause", dur: 0.08 });
  }
  return ev;
}

function cryEvents(rand: () => number): Ev[] {
  const ev: Ev[] = [];
  const n = 2 + Math.floor(rand() * 2);
  for (let k = 0; k < n; k++) {
    const peak = 1.45 + rand() * 0.2;
    ev.push({
      type: "syl",
      phones: ["w", "a"],
      f0: [1.15, peak, peak * 1.04, peak * 0.95, 1.1],
      dur: 5 + rand() * 3,
      amp: 1,
    });
    ev.push({ type: "pause", dur: 0.06 });
    ev.push({ type: "breath", dur: 0.18, amp: 0.35, vowel: "i" });
    ev.push({ type: "pause", dur: 0.05 });
    ev.push({ type: "breath", dur: 0.12, amp: 0.3, vowel: "e" });
    ev.push({ type: "pause", dur: 0.12 });
  }
  ev.push({ type: "syl", phones: ["hh", "a"], f0: [1.3, 1.2], dur: 1.6, amp: 0.7 });
  ev.push({ type: "syl", phones: ["hh", "a"], f0: [1.25, 1.1], dur: 2.2, amp: 0.6 });
  return ev;
}

function cooEvents(rand: () => number): Ev[] {
  const templates: Ev[][] = [
    [
      { type: "syl", phones: ["a"], f0: [1, 1.1, 1.05], dur: 2.5, amp: 0.9 },
      { type: "syl", phones: ["g", "u"], f0: [1.15, 1.35, 1.2], dur: 3, amp: 1 },
    ],
    [
      { type: "syl", phones: ["a"], f0: [1, 1.2, 1.3, 1.1], dur: 4.5, amp: 0.9 },
      { type: "pause", dur: 0.1 },
      { type: "syl", phones: ["u"], f0: [1.2, 1.05, 0.95], dur: 4, amp: 0.8 },
    ],
    [
      { type: "syl", phones: ["g", "u"], f0: [1.1, 1.25], dur: 1.6 },
      { type: "syl", phones: ["g", "u"], f0: [1.2, 1.05], dur: 2.2 },
      { type: "pause", dur: 0.2 },
      { type: "syl", phones: ["a"], f0: [1, 1.3, 1.15], dur: 2.5 },
      { type: "syl", phones: ["g", "u"], f0: [1.25, 1.4, 1.2], dur: 2.8 },
    ],
  ];
  const t = pick(rand, templates);
  return [...t, { type: "pause", dur: 0.15 }, ...pick(rand, templates)];
}

function babbleEvents(rand: () => number): Ev[] {
  const ev: Ev[] = [];
  const groups = 3 + Math.floor(rand() * 2);
  let level = 1.05;
  for (let g = 0; g < groups; g++) {
    const c = pick(rand, ["m", "b", "d", "p", "n", "g", "t", "l"]);
    const v = pick(rand, ["a", "a", "a", "e", "u", "i", "o"]);
    const reps = 2 + Math.floor(rand() * 3);
    for (let r = 0; r < reps; r++) {
      level = Math.min(1.4, Math.max(0.9, level + (rand() - 0.5) * 0.25));
      const last = r === reps - 1;
      ev.push({
        type: "syl",
        phones: [c, v],
        f0: last ? [level, level * 1.1, level * 0.9] : [level, level * 1.05],
        dur: last ? 1.6 : 0.9 + rand() * 0.3,
        amp: r === 0 ? 1 : 0.85,
      });
    }
    ev.push({ type: "pause", dur: 0.18 + rand() * 0.2 });
  }
  return ev;
}

function surpriseEvents(rand: () => number): Ev[] {
  return pick(rand, [
    [{ type: "syl", phones: ["o", "j"], f0: [1.1, 1.55, 1.3], dur: 1.6 }],
    [
      { type: "syl", phones: ["o"], f0: [1.2, 1.4], dur: 1.2 },
      { type: "pause", dur: 0.08 },
      { type: "syl", phones: ["o"], f0: [1.5, 1.25], dur: 2.4 },
    ],
    [
      { type: "syl", phones: ["u", "x"], f0: [1.1, 1.4], dur: 1.2 },
      { type: "syl", phones: ["t", "y"], f0: [1.45, 1.2], dur: 1.9 },
    ],
  ] as Ev[][]);
}

// «Ах вы, сени» / «Twinkle twinkle» — народные мелодии.
const MELODIES: { notes: [number, number][] }[] = [
  {
    notes: [
      [0, 1], [0, 1], [7, 1], [7, 1], [9, 1], [9, 1], [7, 2],
      [5, 1], [5, 1], [4, 1], [4, 1], [2, 1], [2, 1], [0, 2],
    ],
  },
  {
    notes: [
      [7, 1], [4, 1], [4, 2], [7, 1], [4, 1], [4, 2],
      [7, 1], [5, 1], [4, 1], [2, 1], [0, 2],
    ],
  },
];

function singEvents(rand: () => number): Ev[] {
  const mel = pick(rand, MELODIES);
  const beat = 0.36;
  return mel.notes.map(([semi, beats], i) => {
    const m = Math.pow(2, semi / 12) * 0.92;
    // dur — множитель базовой длительности гласной; «л» забирает 60 мс от ноты.
    const vowelDur = (beat * beats - 0.06) / VOWEL_BASE_DUR;
    return {
      type: "syl",
      phones: ["l", i === mel.notes.length - 1 ? "a" : pick(rand, ["a", "a", "a", "i"])],
      f0: [m, m, m * (i === mel.notes.length - 1 ? 0.98 : 1)],
      dur: vowelDur,
      amp: beats > 1 ? 1 : 0.9,
    } satisfies Syl;
  });
}

// ---------- Публичный API ----------

export function synthesizeBaby(p: BabyParams): Clip {
  const age = AGES[p.age];
  const rand = rng(p.seed * 7919 + p.vocalization.length);
  const tempo = age.tempo * p.tempo;
  let events: Ev[];
  let expr = p.expressiveness;
  const o: RenderOpts = {
    formantScale: age.formant * p.vocalTract,
    breath: p.breath,
    jitter: 0.006 + p.roughness * 0.025,
    shimmer: 0.04 + p.roughness * 0.15,
    subharmonic: p.roughness * 0.25,
    tilt: 0.7,
    vibratoRate: 5.5,
    vibratoDepth: 0,
    seed: p.seed,
  };

  switch (p.vocalization) {
    case "laugh":
      events = laughEvents(rand, false);
      o.breath = Math.max(o.breath, 0.45);
      break;
    case "giggle":
      events = laughEvents(rand, true);
      o.breath = Math.max(o.breath, 0.5);
      break;
    case "cry":
      events = cryEvents(rand);
      o.tilt = 0.95;
      o.jitter += 0.02;
      o.subharmonic = Math.min(0.6, o.subharmonic + 0.25);
      o.vibratoRate = 7;
      o.vibratoDepth = 0.02;
      break;
    case "coo":
      events = cooEvents(rand);
      o.tilt = 0.35;
      break;
    case "babble":
      events = babbleEvents(rand);
      break;
    case "surprise":
      events = surpriseEvents(rand);
      expr *= 1.2;
      break;
    case "sing":
      events = singEvents(rand);
      expr = 1;
      o.vibratoDepth = 0.012;
      o.tilt = 0.55;
      break;
    default:
      events = textEvents(p.text || "агу");
  }

  const plan = buildPlan(events, age.f0 * p.pitch, tempo, expr);
  let x = render(plan, o);
  x = applyBiquad(x, biquad("highpass", 90, SR));
  normalize(x, 0.8);
  x = reverb(x, SR, p.room * 0.6, 0.5);
  normalize(x, 0.9);
  fadeEdges(x, SR, 0.004);
  return { samples: x, sampleRate: SR };
}
