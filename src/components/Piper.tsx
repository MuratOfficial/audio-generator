"use client";

import { useEffect, useState } from "react";
import type { Clip } from "@/lib/audio/core";
import { PIPER_VOICES, speakPiper, storedVoices } from "@/lib/tts/piper";
import { Field, Notice, ProgressBar, Select } from "./ui";

type Status = { kind: "idle" | "download" | "synth" } | { kind: "error"; message: string };

/** Синтез речи Piper с прогрессом скачивания модели и списком уже скачанных голосов. */
export function usePiper() {
  const [stored, setStored] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    void storedVoices().then(setStored);
  }, []);

  const speak = async (text: string, voiceId: string): Promise<Clip | null> => {
    setStatus({ kind: stored.includes(voiceId) ? "synth" : "download" });
    setProgress(0);
    try {
      const clip = await speakPiper(text, voiceId, ({ loaded, total }) => {
        setStatus({ kind: "download" });
        if (total) setProgress(loaded / total);
        if (loaded >= total) setStatus({ kind: "synth" });
      });
      setStatus({ kind: "idle" });
      setStored(await storedVoices());
      return clip;
    } catch (e) {
      console.error(e);
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };

  const busy = status.kind === "download" || status.kind === "synth";
  const label = status.kind === "download" ? "Скачиваю голос" : status.kind === "synth" ? "Синтезирую" : "▶ Озвучить";
  return { stored, setStored, status, progress, busy, label, speak };
}

export function PiperVoiceSelect({
  value,
  onChange,
  stored,
  hint,
}: {
  value: string;
  onChange: (id: string) => void;
  stored: string[];
  hint?: string;
}) {
  const meta = PIPER_VOICES.find((v) => v.id === value)!;
  return (
    <Field
      label="Голос нейросети"
      hint={
        stored.includes(value)
          ? (hint ?? "Модель уже скачана.")
          : `При первом запуске скачается модель голоса (~${meta.sizeMb} МБ), дальше работает без загрузки.${hint ? ` ${hint}` : ""}`
      }
    >
      {(props) => (
        <Select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
          {PIPER_VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {`${v.label} — ${v.lang === "ru" ? "русский" : "английский"}, ${v.gender === "f" ? "жен." : "муж."}${stored.includes(v.id) ? " ✓" : ""}`}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function PiperStatus({ piper, voiceId }: { piper: ReturnType<typeof usePiper>; voiceId: string }) {
  const { status, progress } = piper;
  const meta = PIPER_VOICES.find((v) => v.id === voiceId)!;
  if (status.kind === "download") {
    return (
      <div className="mb-4">
        <ProgressBar value={progress} />
        <p className="mt-1 text-xs text-muted">Загрузка модели: {Math.round(progress * 100)}% из ~{meta.sizeMb} МБ</p>
      </div>
    );
  }
  if (status.kind === "synth") {
    return <p className="mb-4 text-xs text-muted">Первый запуск дольше: браузер загружает и компилирует движок нейросети.</p>;
  }
  if (status.kind === "error") {
    return (
      <div className="mb-4">
        <Notice tone="error">Не получилось синтезировать речь: {status.message}</Notice>
      </div>
    );
  }
  return null;
}
