// Порт классического генератора игровых звуков sfxr (DrPetter, 2007).

import { type Clip, fadeEdges, normalize, trimTail } from "./core";

export type WaveType = 0 | 1 | 2 | 3; // меандр, пила, синус, шум

export type SfxrParams = {
  waveType: WaveType;
  attack: number;
  sustain: number;
  punch: number;
  decay: number;
  baseFreq: number;
  freqLimit: number;
  freqRamp: number;
  freqDramp: number;
  vibStrength: number;
  vibSpeed: number;
  arpMod: number;
  arpSpeed: number;
  duty: number;
  dutyRamp: number;
  repeatSpeed: number;
  phaOffset: number;
  phaRamp: number;
  lpfFreq: number;
  lpfRamp: number;
  lpfResonance: number;
  hpfFreq: number;
  hpfRamp: number;
};

export const DEFAULT_SFXR: SfxrParams = {
  waveType: 0,
  attack: 0, sustain: 0.3, punch: 0, decay: 0.4,
  baseFreq: 0.3, freqLimit: 0, freqRamp: 0, freqDramp: 0,
  vibStrength: 0, vibSpeed: 0,
  arpMod: 0, arpSpeed: 0,
  duty: 0, dutyRamp: 0,
  repeatSpeed: 0,
  phaOffset: 0, phaRamp: 0,
  lpfFreq: 1, lpfRamp: 0, lpfResonance: 0,
  hpfFreq: 0, hpfRamp: 0,
};

/** Описание ползунков: ключ, подпись, двусторонний ли диапазон (-1..1). */
export const SFXR_SLIDERS: { group: string; items: [keyof SfxrParams, string, boolean][] }[] = [
  { group: "Огибающая", items: [["attack", "Атака", false], ["sustain", "Удержание", false], ["punch", "Удар", false], ["decay", "Затухание", false]] },
  { group: "Частота", items: [["baseFreq", "Высота", false], ["freqLimit", "Нижний предел", false], ["freqRamp", "Скольжение", true], ["freqDramp", "Ускорение скольжения", true]] },
  { group: "Вибрато и арпеджио", items: [["vibStrength", "Глубина вибрато", false], ["vibSpeed", "Скорость вибрато", false], ["arpMod", "Шаг арпеджио", true], ["arpSpeed", "Скорость арпеджио", false]] },
  { group: "Тембр", items: [["duty", "Скважность", false], ["dutyRamp", "Сдвиг скважности", true], ["repeatSpeed", "Повтор", false], ["phaOffset", "Фейзер", true], ["phaRamp", "Сдвиг фейзера", true]] },
  { group: "Фильтры", items: [["lpfFreq", "ФНЧ частота", false], ["lpfRamp", "ФНЧ сдвиг", true], ["lpfResonance", "ФНЧ резонанс", false], ["hpfFreq", "ФВЧ частота", false], ["hpfRamp", "ФВЧ сдвиг", true]] },
];

export const WAVE_LABELS = ["Меандр", "Пила", "Синус", "Шум"];

const SR = 44100;

export function renderSfxr(p: SfxrParams, seed = Math.random): Clip {
  const rand = seed;
  let fperiod = 0, fmaxperiod = 0, fslide = 0, fdslide = 0, period = 0;
  let squareDuty = 0, squareSlide = 0, arpModV = 0, arpTime = 0, arpLimit = 0;
  let phase = 0, fltp = 0, fltdp = 0, fltw = 0, fltwD = 0, fltdmp = 0, fltphp = 0, flthp = 0, flthpD = 0;
  let vibPhase = 0, vibSpeed = 0, vibAmp = 0;
  let envVol = 0, envStage = 0, envTime = 0;
  const envLength = [0, 0, 0];
  let fphase = 0, fdphase = 0, iphase = 0, ipp = 0;
  const phaserBuffer = new Float32Array(1024);
  const noiseBuffer = new Float32Array(32);
  let repTime = 0, repLimit = 0;

  const reset = (restart: boolean) => {
    fperiod = 100 / (p.baseFreq * p.baseFreq + 0.001);
    period = Math.floor(fperiod);
    fmaxperiod = 100 / (p.freqLimit * p.freqLimit + 0.001);
    fslide = 1 - Math.pow(p.freqRamp, 3) * 0.01;
    fdslide = -Math.pow(p.freqDramp, 3) * 0.000001;
    squareDuty = 0.5 - p.duty * 0.5;
    squareSlide = -p.dutyRamp * 0.00005;
    arpModV = p.arpMod >= 0 ? 1 - Math.pow(p.arpMod, 2) * 0.9 : 1 + Math.pow(p.arpMod, 2) * 10;
    arpTime = 0;
    arpLimit = Math.floor(Math.pow(1 - p.arpSpeed, 2) * 20000 + 32);
    if (p.arpSpeed === 1) arpLimit = 0;
    if (restart) return;
    phase = 0;
    fltp = 0; fltdp = 0;
    fltw = Math.pow(p.lpfFreq, 3) * 0.1;
    fltwD = 1 + p.lpfRamp * 0.0001;
    fltdmp = Math.min(0.8, (5 / (1 + Math.pow(p.lpfResonance, 2) * 20)) * (0.01 + fltw));
    fltphp = 0;
    flthp = Math.pow(p.hpfFreq, 2) * 0.1;
    flthpD = 1 + p.hpfRamp * 0.0003;
    vibPhase = 0;
    vibSpeed = Math.pow(p.vibSpeed, 2) * 0.01;
    vibAmp = p.vibStrength * 0.5;
    envVol = 0; envStage = 0; envTime = 0;
    envLength[0] = Math.floor(p.attack * p.attack * 100000);
    envLength[1] = Math.floor(p.sustain * p.sustain * 100000);
    envLength[2] = Math.floor(p.decay * p.decay * 100000);
    fphase = Math.pow(p.phaOffset, 2) * 1020 * Math.sign(p.phaOffset);
    fdphase = Math.pow(p.phaRamp, 2) * Math.sign(p.phaRamp);
    iphase = Math.abs(Math.floor(fphase));
    ipp = 0;
    phaserBuffer.fill(0);
    for (let i = 0; i < 32; i++) noiseBuffer[i] = rand() * 2 - 1;
    repTime = 0;
    repLimit = Math.floor(Math.pow(1 - p.repeatSpeed, 2) * 20000 + 32);
    if (p.repeatSpeed === 0) repLimit = 0;
  };

  reset(false);
  const maxLen = SR * 6;
  const out = new Float32Array(maxLen);
  let n = 0;
  let playing = true;

  for (; n < maxLen && playing; n++) {
    repTime++;
    if (repLimit !== 0 && repTime >= repLimit) {
      repTime = 0;
      reset(true);
    }
    arpTime++;
    if (arpLimit !== 0 && arpTime >= arpLimit) {
      arpLimit = 0;
      fperiod *= arpModV;
    }
    fslide += fdslide;
    fperiod *= fslide;
    if (fperiod > fmaxperiod) {
      fperiod = fmaxperiod;
      if (p.freqLimit > 0) playing = false;
    }
    let rfperiod = fperiod;
    if (vibAmp > 0) {
      vibPhase += vibSpeed;
      rfperiod = fperiod * (1 + Math.sin(vibPhase) * vibAmp);
    }
    period = Math.max(8, Math.floor(rfperiod));
    squareDuty = Math.min(0.5, Math.max(0, squareDuty + squareSlide));

    envTime++;
    if (envTime > envLength[envStage]) {
      envTime = 0;
      envStage++;
      if (envStage === 3) playing = false;
    }
    if (envStage === 0) envVol = envLength[0] ? envTime / envLength[0] : 1;
    else if (envStage === 1) envVol = 1 + Math.pow(1 - envTime / Math.max(1, envLength[1]), 1) * 2 * p.punch;
    else envVol = 1 - envTime / Math.max(1, envLength[2]);

    fphase += fdphase;
    iphase = Math.min(1023, Math.abs(Math.floor(fphase)));
    if (flthpD !== 0) flthp = Math.min(0.1, Math.max(0.00001, flthp * flthpD));

    let ssample = 0;
    for (let si = 0; si < 8; si++) {
      let sample = 0;
      phase++;
      if (phase >= period) {
        phase %= period;
        if (p.waveType === 3) for (let i = 0; i < 32; i++) noiseBuffer[i] = rand() * 2 - 1;
      }
      const fp = phase / period;
      switch (p.waveType) {
        case 0: sample = fp < squareDuty ? 0.5 : -0.5; break;
        case 1: sample = 1 - fp * 2; break;
        case 2: sample = Math.sin(fp * 2 * Math.PI); break;
        case 3: sample = noiseBuffer[Math.floor((phase * 32) / period)]; break;
      }
      const pp = fltp;
      fltw = Math.min(0.1, Math.max(0, fltw * fltwD));
      if (p.lpfFreq !== 1) {
        fltdp += (sample - fltp) * fltw;
        fltdp -= fltdp * fltdmp;
      } else {
        fltp = sample;
        fltdp = 0;
      }
      fltp += fltdp;
      fltphp += fltp - pp;
      fltphp -= fltphp * flthp;
      sample = fltphp;
      phaserBuffer[ipp & 1023] = sample;
      sample += phaserBuffer[(ipp - iphase + 1024) & 1023];
      ipp = (ipp + 1) & 1023;
      ssample += sample * envVol;
    }
    out[n] = ssample / 8;
  }

  const x = trimTail(out.subarray(0, n), 1e-5).slice();
  normalize(x, 0.8);
  fadeEdges(x, SR, 0.002);
  return { samples: x, sampleRate: SR };
}

// ---------- Генераторы пресетов (как в оригинальном sfxr) ----------

export type SfxrPreset = "coin" | "laser" | "explosion" | "powerup" | "hit" | "jump" | "blip" | "random";

export const SFXR_PRESETS: { id: SfxrPreset; label: string; emoji: string }[] = [
  { id: "coin", label: "Монетка", emoji: "💰" },
  { id: "jump", label: "Прыжок", emoji: "🦘" },
  { id: "powerup", label: "Бонус", emoji: "⭐" },
  { id: "laser", label: "Лазер", emoji: "🔫" },
  { id: "explosion", label: "Взрыв", emoji: "💥" },
  { id: "hit", label: "Удар", emoji: "🥊" },
  { id: "blip", label: "Клик", emoji: "🔘" },
  { id: "random", label: "Случайный", emoji: "🎲" },
];

export function generatePreset(kind: SfxrPreset, rand = Math.random): SfxrParams {
  const frnd = (r: number) => rand() * r;
  const rnd = (n: number) => Math.floor(rand() * (n + 1));
  const p: SfxrParams = { ...DEFAULT_SFXR };
  switch (kind) {
    case "coin":
      p.baseFreq = 0.4 + frnd(0.5);
      p.sustain = frnd(0.1);
      p.decay = 0.1 + frnd(0.4);
      p.punch = 0.3 + frnd(0.3);
      if (rnd(1)) {
        p.arpSpeed = 0.5 + frnd(0.2);
        p.arpMod = 0.2 + frnd(0.4);
      }
      break;
    case "laser":
      p.waveType = rnd(2) as WaveType;
      if (p.waveType === 2 && rnd(1)) p.waveType = rnd(1) as WaveType;
      p.baseFreq = 0.5 + frnd(0.5);
      p.freqLimit = Math.max(0.2, p.baseFreq - 0.2 - frnd(0.6));
      p.freqRamp = -0.15 - frnd(0.2);
      if (rnd(2) === 0) {
        p.baseFreq = 0.3 + frnd(0.6);
        p.freqLimit = frnd(0.1);
        p.freqRamp = -0.35 - frnd(0.3);
      }
      if (rnd(1)) {
        p.duty = frnd(0.5);
        p.dutyRamp = frnd(0.2);
      } else {
        p.duty = 0.4 + frnd(0.5);
        p.dutyRamp = -frnd(0.7);
      }
      p.sustain = 0.1 + frnd(0.2);
      p.decay = frnd(0.4);
      if (rnd(1)) p.punch = frnd(0.3);
      if (rnd(2) === 0) {
        p.phaOffset = frnd(0.2);
        p.phaRamp = -frnd(0.2);
      }
      if (rnd(1)) p.hpfFreq = frnd(0.3);
      break;
    case "explosion":
      p.waveType = 3;
      if (rnd(1)) {
        p.baseFreq = 0.1 + frnd(0.4);
        p.freqRamp = -0.1 + frnd(0.4);
      } else {
        p.baseFreq = 0.2 + frnd(0.7);
        p.freqRamp = -0.2 - frnd(0.2);
      }
      p.baseFreq *= p.baseFreq;
      if (rnd(4) === 0) p.freqRamp = 0;
      if (rnd(2) === 0) p.repeatSpeed = 0.3 + frnd(0.5);
      p.sustain = 0.1 + frnd(0.3);
      p.decay = frnd(0.5);
      if (rnd(1) === 0) {
        p.phaOffset = -0.3 + frnd(0.9);
        p.phaRamp = -frnd(0.3);
      }
      p.punch = 0.2 + frnd(0.6);
      if (rnd(1)) {
        p.vibStrength = frnd(0.7);
        p.vibSpeed = frnd(0.6);
      }
      if (rnd(2) === 0) {
        p.arpSpeed = 0.6 + frnd(0.3);
        p.arpMod = 0.8 - frnd(1.6);
      }
      break;
    case "powerup":
      if (rnd(1)) p.waveType = 1;
      else p.duty = frnd(0.6);
      p.baseFreq = 0.2 + frnd(0.3);
      if (rnd(1)) {
        p.freqRamp = 0.1 + frnd(0.4);
        p.repeatSpeed = 0.4 + frnd(0.4);
      } else {
        p.freqRamp = 0.05 + frnd(0.2);
        if (rnd(1)) {
          p.vibStrength = frnd(0.7);
          p.vibSpeed = frnd(0.6);
        }
      }
      p.sustain = frnd(0.4);
      p.decay = 0.1 + frnd(0.4);
      break;
    case "hit":
      p.waveType = rnd(2) as WaveType;
      if (p.waveType === 2) p.waveType = 3;
      if (p.waveType === 0) p.duty = frnd(0.6);
      p.baseFreq = 0.2 + frnd(0.6);
      p.freqRamp = -0.3 - frnd(0.4);
      p.sustain = frnd(0.1);
      p.decay = 0.1 + frnd(0.2);
      if (rnd(1)) p.hpfFreq = frnd(0.3);
      break;
    case "jump":
      p.duty = frnd(0.6);
      p.baseFreq = 0.3 + frnd(0.3);
      p.freqRamp = 0.1 + frnd(0.2);
      p.sustain = 0.1 + frnd(0.3);
      p.decay = 0.1 + frnd(0.2);
      if (rnd(1)) p.hpfFreq = frnd(0.3);
      if (rnd(1)) p.lpfFreq = 1 - frnd(0.6);
      break;
    case "blip":
      p.waveType = rnd(1) as WaveType;
      if (p.waveType === 0) p.duty = frnd(0.6);
      p.baseFreq = 0.2 + frnd(0.4);
      p.sustain = 0.1 + frnd(0.1);
      p.decay = frnd(0.2);
      p.hpfFreq = 0.1;
      break;
    case "random": {
      const sq = (v: number, k: number) => Math.pow(v, k);
      p.waveType = rnd(3) as WaveType;
      p.baseFreq = rnd(1) ? sq(frnd(2) - 1, 3) + 0.5 : sq(frnd(2) - 1, 2);
      p.freqRamp = sq(frnd(2) - 1, 5);
      if (p.baseFreq > 0.7 && p.freqRamp > 0.2) p.freqRamp = -p.freqRamp;
      if (p.baseFreq < 0.2 && p.freqRamp < -0.05) p.freqRamp = -p.freqRamp;
      p.freqDramp = sq(frnd(2) - 1, 3);
      p.duty = frnd(2) - 1;
      p.dutyRamp = sq(frnd(2) - 1, 3);
      p.vibStrength = sq(frnd(2) - 1, 3);
      p.vibSpeed = frnd(2) - 1;
      p.attack = sq(frnd(2) - 1, 3);
      p.sustain = sq(frnd(2) - 1, 2);
      p.decay = frnd(2) - 1;
      p.punch = sq(frnd(0.8), 2);
      if (p.attack + p.sustain + p.decay < 0.2) {
        p.sustain += 0.2 + frnd(0.3);
        p.decay += 0.2 + frnd(0.3);
      }
      p.lpfResonance = frnd(2) - 1;
      p.lpfFreq = 1 - sq(frnd(1), 3);
      p.lpfRamp = sq(frnd(2) - 1, 3);
      if (p.lpfFreq < 0.1 && p.lpfRamp < -0.05) p.lpfRamp = -p.lpfRamp;
      p.hpfFreq = sq(frnd(1), 5);
      p.hpfRamp = sq(frnd(2) - 1, 5);
      p.phaOffset = sq(frnd(2) - 1, 3);
      p.phaRamp = sq(frnd(2) - 1, 3);
      p.repeatSpeed = frnd(2) - 1;
      p.arpSpeed = frnd(2) - 1;
      p.arpMod = frnd(2) - 1;
      break;
    }
  }
  return clampParams(p);
}

export function mutate(p: SfxrParams, rand = Math.random): SfxrParams {
  const q = { ...p };
  for (const key of Object.keys(q) as (keyof SfxrParams)[]) {
    if (key === "waveType") continue;
    if (rand() < 0.5) (q[key] as number) += rand() * 0.1 - 0.05;
  }
  return clampParams(q);
}

const BIPOLAR = new Set<keyof SfxrParams>(
  SFXR_SLIDERS.flatMap((g) => g.items.filter(([, , bi]) => bi).map(([k]) => k)),
);

function clampParams(p: SfxrParams): SfxrParams {
  for (const key of Object.keys(p) as (keyof SfxrParams)[]) {
    if (key === "waveType") continue;
    const lo = BIPOLAR.has(key) ? -1 : 0;
    (p[key] as number) = Math.min(1, Math.max(lo, p[key] as number));
  }
  return p;
}
