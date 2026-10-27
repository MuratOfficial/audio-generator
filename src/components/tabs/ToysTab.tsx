"use client";

import { useEffect, useState } from "react";
import { type Clip, playClip } from "@/lib/audio/core";
import { synthesizeToy, type ToyKind, type ToyParams, TOYS } from "@/lib/audio/toys";
import { AudioResult } from "../AudioResult";
import { Button, Card, SectionTitle, Slider } from "../ui";

export function ToysTab() {
  const [p, setP] = useState<ToyParams>({ kind: "xylophone", pitch: 0, length: 1, room: 0.25, seed: 1 });
  const [clip, setClip] = useState<Clip | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setClip(synthesizeToy(p)), 120);
    return () => clearTimeout(t);
  }, [p]);

  const play = (next: ToyParams) => {
    setP(next);
    const c = synthesizeToy(next);
    setClip(c);
    playClip(c);
  };
  const label = TOYS.find((t) => t.id === p.kind)?.label ?? "";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <Card>
          <SectionTitle hint="Нажмите на игрушку, чтобы услышать её. «Другой вариант» меняет мелодию и ритм.">Игрушки</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TOYS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => play({ ...p, kind: t.id as ToyKind })}
                className={`flex flex-col items-center gap-2 rounded-3xl px-2 py-4 text-sm font-bold transition active:scale-95 ${
                  p.kind === t.id ? "bg-accent text-white" : "bg-chip text-ink hover:bg-chip-strong"
                }`}
              >
                <span className="text-3xl leading-none">{t.emoji}</span>
                <span className="text-center leading-tight">{t.label}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <div className="mb-4 flex flex-wrap gap-3">
            <Button onClick={() => clip && playClip(clip)}>▶ Играть</Button>
            <Button variant="secondary" onClick={() => play({ ...p, seed: p.seed + 1 })}>🎲 Другой вариант</Button>
          </div>
          {clip && <AudioResult clip={clip} name={`игрушка-${label}-${p.seed}`} />}
        </Card>
      </div>
      <Card className="content-start">
        <SectionTitle>Настройки</SectionTitle>
        <div className="grid gap-4">
          <Slider label="Высота" value={p.pitch} min={-12} max={12} step={1} onChange={(v) => setP({ ...p, pitch: v })} format={(v) => `${v > 0 ? "+" : ""}${v} пт`} />
          <Slider label="Длина" value={p.length} min={0.5} max={2} onChange={(v) => setP({ ...p, length: v })} format={(v) => `×${v.toFixed(1)}`} />
          <Slider label="Эхо комнаты" value={p.room} min={0} max={1} onChange={(v) => setP({ ...p, room: v })} />
        </div>
      </Card>
    </div>
  );
}
