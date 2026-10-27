"use client";

import { useEffect, useState } from "react";
import type { Clip } from "@/lib/audio/core";
import { PIPER_VOICES, removeVoice, speakPiper, storedVoices } from "@/lib/tts/piper";
import { AudioResult } from "../AudioResult";
import { ChildVoiceControls, useChildVoice } from "../ChildVoiceControls";
import { Button, Card, Notice, SectionTitle, Segmented, Slider } from "../ui";

const DEFAULT_TEXT = "Привет! Меня зовут Маша, мне пять лет. Давай играть вместе!";

export function TtsTab() {
  const [mode, setMode] = useState<"neural" | "system">("neural");
  return (
    <div className="grid gap-5">
      <Segmented
        options={[
          { id: "neural", label: "Нейросеть + детский голос" },
          { id: "system", label: "Системные голоса (быстро)" },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === "neural" ? <NeuralTts /> : <SystemTts />}
    </div>
  );
}

function NeuralTts() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [voiceId, setVoiceId] = useState(PIPER_VOICES[0].id);
  const [stored, setStored] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "idle" | "download" | "synth" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [progress, setProgress] = useState(0);
  const [source, setSource] = useState<Clip | null>(null);
  const voice = useChildVoice(source);

  useEffect(() => {
    void storedVoices().then(setStored);
  }, []);

  const busy = status.kind === "download" || status.kind === "synth";
  const isStored = stored.includes(voiceId);
  const meta = PIPER_VOICES.find((v) => v.id === voiceId)!;

  const run = async () => {
    if (!text.trim()) return;
    setStatus({ kind: isStored ? "synth" : "download" });
    setProgress(0);
    try {
      const clip = await speakPiper(text, voiceId, ({ loaded, total }) => {
        setStatus({ kind: "download" });
        if (total) setProgress(loaded / total);
        if (loaded >= total) setStatus({ kind: "synth" });
      });
      setSource(clip);
      setStatus({ kind: "idle" });
      setStored(await storedVoices());
    } catch (e) {
      console.error(e);
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <Card className="content-start">
        <SectionTitle hint="Нейросеть Piper работает прямо в браузере. Модель голоса скачивается один раз (~60 МБ) и сохраняется.">
          Текст
        </SectionTitle>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full resize-y rounded-2xl bg-well p-3 text-base text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
        />
        <div className="mt-4">
          <SectionTitle>Исходный голос</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PIPER_VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setVoiceId(v.id)}
                className={`rounded-2xl px-3 py-2 text-left text-sm font-bold transition ${
                  v.id === voiceId ? "bg-accent text-white" : "bg-chip text-ink hover:bg-chip-strong"
                }`}
              >
                <span className="block">{v.label}</span>
                <span className={`block text-xs font-semibold ${v.id === voiceId ? "text-white/80" : "text-muted"}`}>
                  {v.lang === "ru" ? "русский" : "английский"} · {v.gender === "f" ? "жен." : "муж."}
                  {stored.includes(v.id) ? " · ✓" : ""}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Для детского голоса лучше подходят женские голоса — их меньше приходится сдвигать.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={busy || !text.trim()}>
            {status.kind === "download" ? "Скачиваю голос…" : status.kind === "synth" ? "Синтезирую…" : "▶ Озвучить"}
          </Button>
          {isStored && !busy && (
            <Button
              variant="ghost"
              onClick={async () => {
                await removeVoice(voiceId);
                setStored(await storedVoices());
              }}
            >
              Удалить модель «{meta.label}»
            </Button>
          )}
        </div>
        {status.kind === "download" && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-chip">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">Загрузка модели: {Math.round(progress * 100)}% из ~{meta.sizeMb} МБ</p>
          </div>
        )}
        {status.kind === "synth" && (
          <p className="mt-2 text-xs text-muted">Первый запуск дольше: браузер загружает и компилирует движок нейросети.</p>
        )}
        {status.kind === "error" && (
          <div className="mt-3">
            <Notice tone="error">Не получилось синтезировать речь: {status.message}</Notice>
          </div>
        )}
      </Card>

      <Card className="content-start">
        <ChildVoiceControls voice={voice} />
        <div className="mt-5 grid gap-3">
          {voice.result ? (
            <>
              <AudioResult clip={voice.result} label="Детский голос" name={`детский-голос-${voice.presetId || "свой"}`} />
              {source && <AudioResult clip={source} label="Оригинал" name={`оригинал-${meta.label}`} compact />}
            </>
          ) : (
            <Notice>Нажмите «Озвучить» — здесь появится результат. Настройки можно менять после синтеза, звук пересчитается сам.</Notice>
          )}
        </div>
      </Card>
    </div>
  );
}

function SystemTts() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [text, setText] = useState(DEFAULT_TEXT);
  const [pitch, setPitch] = useState(1.9);
  const [rate, setRate] = useState(1.05);
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const all = speechSynthesis.getVoices();
      const preferred = all.filter((v) => /^(ru|en)/i.test(v.lang));
      const list = preferred.length ? preferred : all;
      setVoices(list);
      setVoiceUri((cur) => cur || list.find((v) => v.lang.startsWith("ru"))?.voiceURI || list[0]?.voiceURI || "");
    };
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  const speak = () => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.voiceURI === voiceUri);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.pitch = pitch;
    u.rate = rate;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speechSynthesis.speak(u);
  };

  if (!supported) return <Notice tone="error">Этот браузер не поддерживает Web Speech API.</Notice>;

  return (
    <Card>
      <SectionTitle hint="Голоса операционной системы: мгновенно и без скачивания, но звук нельзя сохранить в файл, а высоту можно только поднять «как есть», без сдвига формант.">
        Системный синтез речи
      </SectionTitle>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full resize-y rounded-2xl bg-well p-3 text-base text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink">Голос</span>
          <select
            value={voiceUri}
            onChange={(e) => setVoiceUri(e.target.value)}
            className="w-full rounded-xl bg-well px-3 py-2 text-ink ring-1 ring-line"
          >
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <Slider label="Высота" value={pitch} min={0.5} max={2} onChange={setPitch} />
        <Slider label="Скорость" value={rate} min={0.5} max={1.8} onChange={setRate} />
      </div>
      <div className="mt-5 flex gap-3">
        <Button onClick={speak}>▶ Сказать</Button>
        {speaking && (
          <Button variant="secondary" onClick={() => { speechSynthesis.cancel(); setSpeaking(false); }}>
            Стоп
          </Button>
        )}
      </div>
    </Card>
  );
}
