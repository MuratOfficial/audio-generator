"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { type Vocalization, VOCALIZATIONS } from "@/lib/audio/babySynth";
import { type Clip, duration, playClip } from "@/lib/audio/core";
import { analyzeVoice, cloneVocalization, speechInVoice, type VoiceProfile } from "@/lib/audio/voiceClone";
import { PIPER_VOICES } from "@/lib/tts/piper";
import { AudioResult } from "../AudioResult";
import { PiperStatus, PiperVoiceSelect, usePiper } from "../Piper";
import { SourceInput } from "../SourceInput";
import { Badge, Button, Card, ChoiceGrid, Field, Notice, SectionTitle, Slider, Textarea } from "../ui";

const DEFAULT_TEXT = "Привет! Давай играть вместе!";

type Speech = { text: string; voiceId: string; clip: Clip };

export function MyVoiceTab() {
  const [sample, setSample] = useState<Clip | null>(null);
  const analysis = useMemo<{ profile: VoiceProfile | null; error: string | null }>(() => {
    if (!sample) return { profile: null, error: null };
    try {
      return { profile: analyzeVoice(sample), error: null };
    } catch (e) {
      return { profile: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [sample]);
  const profile = analysis.profile;

  const [kind, setKind] = useState<Vocalization>("laugh");
  const [pitch, setPitch] = useState(1);
  const [room, setRoom] = useState(0.15);
  const [seed, setSeed] = useState(1);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [voiceChoice, setVoiceChoice] = useState<string | null>(null);
  const piper = usePiper();
  const [speech, setSpeech] = useState<Speech | null>(null);

  // Для низкого голоса из записи берём мужской голос нейросети — его меньше приходится сдвигать.
  const voiceId =
    voiceChoice ?? (profile && profile.median > 0 && profile.median < 165 ? "ru_RU-denis-medium" : PIPER_VOICES[0].id);

  // Пересчёт занимает от десятков до сотен миллисекунд; отложенные значения не дают ползункам «залипать».
  const dPitch = useDeferredValue(pitch);
  const dRoom = useDeferredValue(room);
  const result = useMemo<Clip | null>(() => {
    if (!profile) return null;
    if (kind === "text") return speech ? speechInVoice(speech.clip, profile, { pitch: dPitch, room: dRoom }) : null;
    return cloneVocalization(profile, kind, { pitch: dPitch, room: dRoom, seed });
  }, [profile, kind, speech, dPitch, dRoom, seed]);

  const speak = async () => {
    if (!profile || !text.trim()) return;
    const clip = await piper.speak(text.trim(), voiceId);
    if (!clip) return;
    setSpeech({ text: text.trim(), voiceId, clip });
    playClip(speechInVoice(clip, profile, { pitch, room }));
  };

  const play = () => {
    if (kind === "text") void speak();
    else if (result) playClip(result);
  };

  const stale = kind === "text" && !!speech && (speech.text !== text.trim() || speech.voiceId !== voiceId);
  const label = VOCALIZATIONS.find((v) => v.id === kind)?.label ?? "";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <Card>
          <SectionTitle hint="5–20 секунд речи, лепета или пения в тишине. Чем больше разных слогов, тем лучше: из них собираются все звуки. Запись никуда не отправляется.">
            Образец голоса
          </SectionTitle>
          <SourceInput
            onClip={(c) => {
              setSample(c);
              setSpeech(null);
            }}
          />
          <div className="mt-4 grid gap-3">
            {analysis.error && <Notice tone="error">{analysis.error}</Notice>}
            {sample && <AudioResult clip={sample} label="Образец" name="образец-голоса" compact />}
            {profile && <VoiceSummary profile={profile} sample={sample!} />}
            {!sample && <Notice>Запишите голос ребёнка или взрослого — дальше он будет смеяться, лепетать, петь и говорить сам.</Notice>}
          </div>
        </Card>

        <Card>
          <SectionTitle>Что сгенерировать</SectionTitle>
          <ChoiceGrid options={VOCALIZATIONS} value={kind} onChange={setKind} />
          {kind === "text" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Текст" hint="Слова читает нейросеть Piper, затем голос подстраивается под образец: высота, интонация, тембр.">
                {(props) => (
                  <Textarea {...props} value={text} onChange={(e) => setText(e.target.value)} rows={3} className="resize-y text-base" />
                )}
              </Field>
              <PiperVoiceSelect value={voiceId} onChange={setVoiceChoice} stored={piper.stored} />
            </div>
          )}
          <div className="mt-5 mb-4 flex flex-wrap items-center gap-3">
            <Button variant="gradient" onClick={play} disabled={!profile || (kind === "text" && !text.trim())} loading={kind === "text" && piper.busy}>
              {kind === "text" ? piper.label : "▶ Озвучить"}
            </Button>
            {kind !== "text" && (
              <Button variant="secondary" onClick={() => setSeed((s) => s + 1)} disabled={!profile} title="Новый вариант ритма, интонации и подбора слогов">
                🎲 Другой вариант
              </Button>
            )}
          </div>
          {kind === "text" && <PiperStatus piper={piper} voiceId={voiceId} />}
          {stale && !piper.busy && (
            <p className="mb-3 text-xs text-muted">Текст или голос изменились — нажмите «Озвучить», чтобы услышать новый вариант.</p>
          )}
          {result ? (
            <AudioResult clip={result} name={`мой-голос-${kind === "text" ? "слова" : `${label}-${seed}`}`} />
          ) : (
            <Notice>
              {profile ? "Нажмите «Озвучить» — фраза прозвучит голосом из образца." : "Сначала добавьте образец голоса."}
            </Notice>
          )}
        </Card>
      </div>

      <Card className="content-start">
        <SectionTitle>Настройки</SectionTitle>
        <div className="grid gap-4">
          <Slider label="Высота голоса" value={pitch} min={0.7} max={1.5} onChange={setPitch} format={(v) => `×${v.toFixed(2)}`} />
          <Slider label="Эхо комнаты" value={room} min={0} max={1} onChange={setRoom} />
        </div>
        <p className="mt-4 text-xs text-muted">
          Смех, плач, лепет, гуление и песенка собираются из слогов самой записи — это действительно тот же голос.
          Слова читает нейросеть, подстроенная под высоту и тембр образца: похоже, но не точная копия.
        </p>
      </Card>
    </div>
  );
}

function VoiceSummary({ profile, sample }: { profile: VoiceProfile; sample: Clip }) {
  const few = profile.units.length < 6;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Badge color="#6366f1" tip="Средняя высота голоса и её обычный размах">
          {`${Math.round(profile.median)} Гц · ${Math.round(profile.low)}–${Math.round(profile.high)}`}
        </Badge>
        <Badge color="#a855f7" tip="Сколько слогов нашлось в записи — из них собираются звуки">
          {`слогов: ${profile.units.length}`}
        </Badge>
        <Badge color="#64748b">{`${duration(sample).toFixed(1)} с`}</Badge>
      </div>
      {few && <Notice>Слогов маловато — звуки будут однообразными. Запишите 10–20 секунд с разными словами.</Notice>}
    </div>
  );
}
