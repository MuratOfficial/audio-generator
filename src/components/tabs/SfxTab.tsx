"use client";

import { useEffect, useState } from "react";
import { type Clip, playClip, rng } from "@/lib/audio/core";
import {
  DEFAULT_SFXR,
  generatePreset,
  mutate,
  renderSfxr,
  SFXR_PRESETS,
  SFXR_SLIDERS,
  type SfxrParams,
  type SfxrPreset,
  type WaveType,
  WAVE_LABELS,
} from "@/lib/audio/sfxr";
import { AudioResult } from "../AudioResult";
import { Button, Card, SectionTitle, Segmented, Slider } from "../ui";

export function SfxTab() {
  const [params, setParams] = useState<SfxrParams>(() => generatePreset("coin", rng(7)));
  const [last, setLast] = useState<SfxrPreset>("coin");
  const [clip, setClip] = useState<Clip | null>(null);

  // Ползунки двигают звук «вживую»: рендер раз в 150 мс без автопроигрывания.
  useEffect(() => {
    const t = setTimeout(() => setClip(renderSfxr(params)), 150);
    return () => clearTimeout(t);
  }, [params]);

  const apply = (p: SfxrParams) => {
    setParams(p);
    const c = renderSfxr(p);
    setClip(c);
    playClip(c);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="grid content-start gap-5">
        <Card>
          <SectionTitle hint="Каждое нажатие создаёт новый случайный звук выбранного типа (алгоритм sfxr).">Игровые звуки</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SFXR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setLast(p.id);
                  apply(generatePreset(p.id));
                }}
                className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-sm font-bold transition active:scale-95 ${
                  last === p.id ? "bg-accent text-white" : "bg-chip text-ink hover:bg-chip-strong"
                }`}
              >
                <span className="text-2xl leading-none">{p.emoji}</span>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => apply(mutate(params))}>🧬 Мутировать</Button>
            <Button variant="secondary" onClick={() => clip && playClip(clip)}>▶ Повторить</Button>
            <Button variant="ghost" onClick={() => apply({ ...DEFAULT_SFXR })}>Сбросить</Button>
          </div>
        </Card>
        <Card>{clip && <AudioResult clip={clip} name={`звук-${last}`} />}</Card>
      </div>

      <Card className="content-start">
        <SectionTitle>Форма волны</SectionTitle>
        <Segmented
          options={WAVE_LABELS.map((label, i) => ({ id: String(i), label }))}
          value={String(params.waveType)}
          onChange={(v) => setParams((p) => ({ ...p, waveType: Number(v) as WaveType }))}
        />
        <div className="mt-5 grid gap-6">
          {SFXR_SLIDERS.map((group) => (
            <div key={group.group}>
              <SectionTitle>{group.group}</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.items.map(([key, label, bipolar]) => (
                  <Slider
                    key={key}
                    label={label}
                    value={params[key] as number}
                    min={bipolar ? -1 : 0}
                    max={1}
                    onChange={(v) => setParams((p) => ({ ...p, [key]: v }))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
