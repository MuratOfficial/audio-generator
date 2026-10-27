"use client";

import { useDeferredValue, useMemo, useState } from "react";
import {
  CHILD_PRESETS,
  type ChildVoiceParams,
  type PitchTrack,
  presetParams,
  trackPitch,
  transformToChild,
} from "@/lib/audio/childVoice";
import type { Clip } from "@/lib/audio/core";
import { ChoiceGrid, SectionTitle, Slider } from "./ui";

/** Держит параметры детского голоса и пересчитывает результат при изменении источника или настроек. */
export function useChildVoice(source: Clip | null) {
  const [presetId, setPresetId] = useState("kid");
  const track = useMemo<PitchTrack | null>(() => (source ? trackPitch(source) : null), [source]);
  const [params, setParams] = useState<ChildVoiceParams>(() => presetParams(CHILD_PRESETS[1], 0));

  // Новый источник — заново подбираем форманты под мужской/женский голос.
  const [prevTrack, setPrevTrack] = useState(track);
  if (track !== prevTrack) {
    setPrevTrack(track);
    const preset = CHILD_PRESETS.find((p) => p.id === presetId);
    if (track && preset) setParams(presetParams(preset, track.median));
  }

  // Преобразование занимает миллисекунды; отложенные параметры не дают ползункам «залипать».
  const deferred = useDeferredValue(params);
  const result = useMemo<Clip | null>(
    () => (source && track ? transformToChild(source, deferred, track) : null),
    [source, track, deferred],
  );

  const choosePreset = (id: string) => {
    setPresetId(id);
    const preset = CHILD_PRESETS.find((p) => p.id === id);
    if (preset) setParams(presetParams(preset, track?.median ?? 0));
  };

  const update = (patch: Partial<ChildVoiceParams>) => {
    setPresetId("");
    setParams((prev) => ({ ...prev, ...patch }));
  };

  return { presetId, choosePreset, params, update, track, result };
}

export function ChildVoiceControls({ voice }: { voice: ReturnType<typeof useChildVoice> }) {
  const { presetId, choosePreset, params, update, track } = voice;
  return (
    <div>
      <SectionTitle
        hint={
          track && track.median > 0
            ? `Средняя высота исходного голоса: ${Math.round(track.median)} Гц (${track.median < 165 ? "мужской" : "женский/детский"})`
            : "Выберите возраст — параметры подстроятся под исходный голос"
        }
      >
        Каким будет ребёнок
      </SectionTitle>
      <ChoiceGrid
        options={CHILD_PRESETS.map((p) => ({ id: p.id, label: p.label, hint: p.hint }))}
        value={presetId}
        onChange={choosePreset}
        columns="grid-cols-2 sm:grid-cols-3"
      />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Slider label="Высота голоса" value={params.targetPitch} min={180} max={520} step={1} onChange={(v) => update({ targetPitch: v })} format={(v) => `${Math.round(v)} Гц`} />
        <Slider label="Форманты (размер тела)" value={params.formant} min={0.9} max={1.7} onChange={(v) => update({ formant: v })} format={(v) => `×${v.toFixed(2)}`} />
        <Slider label="Темп" value={params.speed} min={0.6} max={1.5} onChange={(v) => update({ speed: v })} format={(v) => `×${v.toFixed(2)}`} />
        <Slider label="Выразительность" value={params.expressiveness} min={0.5} max={2.2} onChange={(v) => update({ expressiveness: v })} format={(v) => `×${v.toFixed(2)}`} />
        <Slider label="Звонкость" value={params.brightness} min={-4} max={8} step={0.5} onChange={(v) => update({ brightness: v })} format={(v) => `${v > 0 ? "+" : ""}${v} дБ`} />
      </div>
    </div>
  );
}
