"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AGES, type BabyAge, type BabyParams, DEFAULT_BABY, synthesizeBaby, VOCALIZATIONS } from "@/lib/audio/babySynth";
import { type PitchTrack, trackPitch, transformToChild } from "@/lib/audio/childVoice";
import { type Clip, normalize, playClip, reverb } from "@/lib/audio/core";
import { PIPER_VOICES } from "@/lib/tts/piper";
import { AudioResult } from "../AudioResult";
import { PiperStatus, PiperVoiceSelect, usePiper } from "../Piper";
import { Button, Card, ChoiceGrid, Field, Notice, SectionTitle, Segmented, Slider, Textarea } from "../ui";

const EXAMPLES = ["Мама, папа! Дай ням-ням. Агу?", "Ой! Ку-ку! Где мама?", "Баба, дай мячик!", "Привет! Я малыш.", "Пока-пока!"];

type Engine = "neural" | "synth";

// Детский голос для «Слов» через нейросеть: целевая высота и сдвиг формант по возрасту.
const NEURAL_AGE: Record<BabyAge, { targetPitch: number; formant: number; speed: number; expressiveness: number; brightness: number }> = {
  baby: { targetPitch: 420, formant: 1.36, speed: 0.88, expressiveness: 1.5, brightness: 2 },
  toddler: { targetPitch: 370, formant: 1.3, speed: 0.92, expressiveness: 1.4, brightness: 2 },
  child: { targetPitch: 300, formant: 1.24, speed: 1, expressiveness: 1.3, brightness: 3 },
};

type Speech = { text: string; voiceId: string; clip: Clip; track: PitchTrack };
type SpeechSettings = Pick<BabyParams, "age" | "pitch" | "vocalTract" | "tempo" | "expressiveness" | "room">;

/** Речь нейросети → детский голос с настройками вкладки. */
function childFromSpeech(speech: Speech, s: SpeechSettings): Clip {
  const a = NEURAL_AGE[s.age];
  const male = speech.track.median > 0 && speech.track.median < 165;
  const out = transformToChild(
    speech.clip,
    {
      targetPitch: a.targetPitch * s.pitch,
      formant: a.formant * s.vocalTract * (male ? 1.12 : 1),
      speed: a.speed * s.tempo,
      expressiveness: a.expressiveness * s.expressiveness,
      brightness: a.brightness,
    },
    speech.track,
  );
  if (s.room <= 0) return out;
  return { samples: normalize(reverb(out.samples, out.sampleRate, s.room * 0.6, 0.5), 0.9), sampleRate: out.sampleRate };
}

// «+» — разметка ударения для синтезатора; нейросеть расставляет ударения сама.
const plainText = (text: string) => text.replace(/\+/g, "").trim();

export function BabyTab() {
  const [p, setP] = useState<BabyParams>(DEFAULT_BABY);
  const [engine, setEngine] = useState<Engine>("neural");
  const [synthClip, setSynthClip] = useState<Clip | null>(null);
  const set = <K extends keyof BabyParams>(k: K, v: BabyParams[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const neural = p.vocalization === "text" && engine === "neural";

  const generateSynth = (params: BabyParams, autoplay: boolean) => {
    const c = synthesizeBaby(params);
    setSynthClip(c);
    if (autoplay) playClip(c);
  };

  // Синтез занимает десятки миллисекунд, поэтому пересчитываем сразу при изменении параметров.
  useEffect(() => {
    if (neural) return;
    const t = setTimeout(() => generateSynth(p, false), 120);
    return () => clearTimeout(t);
  }, [p, neural]);

  // ---------- Нейросеть ----------
  const [voiceId, setVoiceId] = useState(PIPER_VOICES[0].id);
  const piper = usePiper();
  const [speech, setSpeech] = useState<Speech | null>(null);

  // Превращение в детский голос занимает десятки миллисекунд; отложенные настройки не дают ползункам «залипать».
  const { age, pitch, vocalTract, tempo, expressiveness, room } = useDeferredValue(p);
  const neuralClip = useMemo(
    () => (speech ? childFromSpeech(speech, { age, pitch, vocalTract, tempo, expressiveness, room }) : null),
    [speech, age, pitch, vocalTract, tempo, expressiveness, room],
  );

  const text = plainText(p.text);
  const stale = !!speech && (speech.text !== text || speech.voiceId !== voiceId);

  const speak = async () => {
    if (!text) return;
    const clip = await piper.speak(text, voiceId);
    if (!clip) return;
    const next = { text, voiceId, clip, track: trackPitch(clip) };
    setSpeech(next);
    playClip(childFromSpeech(next, p));
  };

  const clip = neural ? neuralClip : synthClip;
  const name = neural
    ? `малыш-слова-${text.slice(0, 24)}`
    : `малыш-${VOCALIZATIONS.find((v) => v.id === p.vocalization)?.label ?? ""}-${p.seed}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <Card>
          <SectionTitle
            hint={
              neural
                ? "Слова читает нейросеть Piper прямо в браузере, затем голос превращается в детский."
                : "Голос синтезируется с нуля: голосовые связки + речевой тракт ребёнка. Без интернета и нейросетей."
            }
          >
            Что сказать
          </SectionTitle>
          <ChoiceGrid options={VOCALIZATIONS} value={p.vocalization} onChange={(v) => set("vocalization", v)} />
          {p.vocalization === "text" && (
            <div className="mt-4 grid gap-4">
              <Segmented
                options={[
                  { id: "neural", label: "Нейросеть" },
                  { id: "synth", label: "Синтезатор (без интернета)" },
                ]}
                value={engine}
                onChange={setEngine}
              />
              <div>
                <Field
                  label="Текст"
                  hint={
                    neural
                      ? "Можно писать обычные фразы — ударения нейросеть расставит сама."
                      : "Лучше всего звучат короткие детские слова. Ударение по умолчанию на первый слог (или на «ё») — поставьте «+» после ударной гласной, чтобы изменить: «молоко+». От ударения зависит, как читаются безударные гласные."
                  }
                >
                  {(props) => (
                    <Textarea
                      {...props}
                      value={p.text}
                      onChange={(e) => set("text", e.target.value)}
                      rows={2}
                      className="resize-y text-base"
                      placeholder="Напишите простые слова: мама, папа, агу…"
                    />
                  )}
                </Field>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => set("text", ex)}
                      className="rounded-full border border-edge bg-surface-2 px-2.5 py-1 text-xs text-muted transition hover:border-accent/40 hover:text-foreground"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
              {neural && (
                <PiperVoiceSelect value={voiceId} onChange={setVoiceId} stored={piper.stored} hint="Лучше всего подходит женский голос." />
              )}
            </div>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {neural ? (
              <Button variant="gradient" onClick={speak} loading={piper.busy} disabled={!text}>
                {piper.label}
              </Button>
            ) : (
              <>
                <Button variant="gradient" onClick={() => generateSynth(p, true)}>▶ Озвучить</Button>
                <Button variant="secondary" onClick={() => setP((prev) => ({ ...prev, seed: prev.seed + 1 }))} title="Новый вариант интонации и ритма">
                  🎲 Другой вариант
                </Button>
              </>
            )}
          </div>
          {neural && <PiperStatus piper={piper} voiceId={voiceId} />}
          {neural && stale && !piper.busy && (
            <p className="mb-3 text-xs text-muted">Текст или голос изменились — нажмите «Озвучить», чтобы услышать новый вариант.</p>
          )}
          {clip ? (
            <AudioResult clip={clip} name={name} />
          ) : (
            <Notice>Нажмите «Озвучить» — здесь появится результат. Настройки справа можно менять после синтеза, звук пересчитается сам.</Notice>
          )}
        </Card>
      </div>

      <Card className="content-start">
        <SectionTitle>Возраст</SectionTitle>
        <ChoiceGrid
          options={(Object.keys(AGES) as BabyAge[]).map((id) => ({ id, label: AGES[id].label, emoji: AGES[id].emoji }))}
          value={p.age}
          onChange={(v) => set("age", v)}
          columns="grid-cols-1"
        />
        <div className="mt-5 grid gap-4">
          <Slider label="Высота голоса" value={p.pitch} min={0.7} max={1.5} onChange={(v) => set("pitch", v)} format={(v) => `×${v.toFixed(2)}`} />
          <Slider label="Размер «ротика» (форманты)" value={p.vocalTract} min={0.85} max={1.3} onChange={(v) => set("vocalTract", v)} format={(v) => `×${v.toFixed(2)}`} />
          <Slider label="Темп" value={p.tempo} min={0.6} max={1.6} onChange={(v) => set("tempo", v)} format={(v) => `×${v.toFixed(2)}`} />
          <Slider label="Выразительность" value={p.expressiveness} min={0} max={2} onChange={(v) => set("expressiveness", v)} />
          {/* Придыхание и дрожание есть только у синтезатора: у нейросети они уже в записи голоса. */}
          {!neural && (
            <>
              <Slider label="Придыхание" value={p.breath} min={0} max={1} onChange={(v) => set("breath", v)} />
              <Slider label="Дрожание голоса" value={p.roughness} min={0} max={1} onChange={(v) => set("roughness", v)} />
            </>
          )}
          <Slider label="Эхо комнаты" value={p.room} min={0} max={1} onChange={(v) => set("room", v)} />
          <Button variant="ghost" onClick={() => setP({ ...DEFAULT_BABY, vocalization: p.vocalization, text: p.text })}>
            Сбросить настройки
          </Button>
        </div>
      </Card>
    </div>
  );
}
