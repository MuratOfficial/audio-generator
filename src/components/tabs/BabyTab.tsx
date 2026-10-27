"use client";

import { useEffect, useState } from "react";
import { AGES, type BabyAge, type BabyParams, DEFAULT_BABY, synthesizeBaby, VOCALIZATIONS } from "@/lib/audio/babySynth";
import { type Clip, playClip } from "@/lib/audio/core";
import { AudioResult } from "../AudioResult";
import { Button, Card, ChoiceGrid, Field, SectionTitle, Slider, Textarea } from "../ui";

const EXAMPLES = ["Мама, папа! Дай ням-ням. Агу?", "Ой! Ку-ку! Где мама?", "Баба, дай мячик!", "Привет! Я малыш.", "Пока-пока!"];

export function BabyTab() {
  const [p, setP] = useState<BabyParams>(DEFAULT_BABY);
  const [clip, setClip] = useState<Clip | null>(null);
  const set = <K extends keyof BabyParams>(k: K, v: BabyParams[K]) => setP((prev) => ({ ...prev, [k]: v }));

  const generate = (params: BabyParams, autoplay: boolean) => {
    const c = synthesizeBaby(params);
    setClip(c);
    if (autoplay) playClip(c);
  };

  // Синтез занимает десятки миллисекунд, поэтому пересчитываем сразу при изменении параметров.
  useEffect(() => {
    const t = setTimeout(() => generate(p, false), 120);
    return () => clearTimeout(t);
  }, [p]);

  const name = `малыш-${VOCALIZATIONS.find((v) => v.id === p.vocalization)?.label ?? ""}-${p.seed}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <Card>
          <SectionTitle hint="Голос синтезируется с нуля: голосовые связки + речевой тракт ребёнка. Без интернета и нейросетей.">
            Что сказать
          </SectionTitle>
          <ChoiceGrid options={VOCALIZATIONS} value={p.vocalization} onChange={(v) => set("vocalization", v)} />
          {p.vocalization === "text" && (
            <div className="mt-4">
              <Field
                label="Текст"
                hint="Лучше всего звучат короткие детские слова. Ударение по умолчанию на первый слог — поставьте «+» после ударной гласной, чтобы изменить: «куку+»."
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
          )}
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button variant="gradient" onClick={() => generate(p, true)}>▶ Озвучить</Button>
            <Button variant="secondary" onClick={() => setP((prev) => ({ ...prev, seed: prev.seed + 1 }))} title="Новый вариант интонации и ритма">
              🎲 Другой вариант
            </Button>
          </div>
          {clip && <AudioResult clip={clip} name={name} />}
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
          <Slider label="Придыхание" value={p.breath} min={0} max={1} onChange={(v) => set("breath", v)} />
          <Slider label="Дрожание голоса" value={p.roughness} min={0} max={1} onChange={(v) => set("roughness", v)} />
          <Slider label="Эхо комнаты" value={p.room} min={0} max={1} onChange={(v) => set("room", v)} />
          <Button variant="ghost" onClick={() => setP({ ...DEFAULT_BABY, vocalization: p.vocalization, text: p.text })}>
            Сбросить настройки
          </Button>
        </div>
      </Card>
    </div>
  );
}
