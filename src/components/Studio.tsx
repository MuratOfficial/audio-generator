"use client";

import { useState } from "react";
import { Library, LibraryProvider } from "./AudioResult";
import { BabyTab } from "./tabs/BabyTab";
import { SfxTab } from "./tabs/SfxTab";
import { ToysTab } from "./tabs/ToysTab";
import { TtsTab } from "./tabs/TtsTab";
import { VoiceChangerTab } from "./tabs/VoiceChangerTab";

const TABS = [
  { id: "baby", label: "Голос малыша", emoji: "👶", desc: "Синтез детского голоса с нуля: слова, смех, лепет, плач, песенки", Component: BabyTab },
  { id: "tts", label: "Текст → детский голос", emoji: "💬", desc: "Нейросеть читает текст, а мы превращаем голос в детский", Component: TtsTab },
  { id: "changer", label: "Изменить голос", emoji: "🎙️", desc: "Ваша запись или файл — голосом ребёнка", Component: VoiceChangerTab },
  { id: "toys", label: "Игрушки", emoji: "🧸", desc: "Ксилофон, погремушка, пищалка, пузырьки и другие", Component: ToysTab },
  { id: "sfx", label: "Звуковые эффекты", emoji: "🎮", desc: "Монетки, прыжки, бонусы и взрывы для игр", Component: SfxTab },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Studio() {
  const [tab, setTab] = useState<TabId>("baby");
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <LibraryProvider>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">
              Звуковая мастерская <span className="text-accent">Агу</span>
            </h1>
            <p className="mt-1 text-muted">Синтез звуков и детских голосов прямо в браузере. Всё бесплатно и без регистрации.</p>
          </div>
        </header>

        <nav className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold transition ${
                  t.id === tab ? "bg-ink text-white shadow-soft" : "bg-card text-ink ring-1 ring-line hover:bg-chip"
                }`}
              >
                <span className="text-lg leading-none">{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>
        </nav>

        <p className="mb-4 text-sm font-semibold text-muted">{active.desc}</p>

        {/* Все вкладки остаются смонтированными, чтобы не терять результаты при переключении. */}
        {TABS.map(({ id, Component }) => (
          <div key={id} hidden={id !== tab}>
            <Component />
          </div>
        ))}

        <Library />
      </div>
    </LibraryProvider>
  );
}
