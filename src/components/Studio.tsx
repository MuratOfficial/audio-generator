"use client";

import { useSyncExternalStore } from "react";
import { AppShell, Backdrop, PageHint, ThemeToggle } from "@toimetdev/pathlogs-core";
import { Library, LibraryProvider } from "./AudioResult";
import { BabyTab } from "./tabs/BabyTab";
import { MyVoiceTab } from "./tabs/MyVoiceTab";
import { SfxTab } from "./tabs/SfxTab";
import { ToysTab } from "./tabs/ToysTab";
import { TtsTab } from "./tabs/TtsTab";
import { VoiceChangerTab } from "./tabs/VoiceChangerTab";

const TABS = [
  { id: "baby", group: "Голоса", label: "Голос малыша", emoji: "👶", desc: "Синтез детского голоса с нуля: слова, смех, лепет, плач, песенки.", Component: BabyTab },
  { id: "tts", group: "Голоса", label: "Текст → детский голос", emoji: "💬", desc: "Нейросеть читает текст, а мы превращаем голос в детский.", Component: TtsTab },
  { id: "changer", group: "Голоса", label: "Изменить голос", emoji: "🎙️", desc: "Ваша запись или файл — голосом ребёнка.", Component: VoiceChangerTab },
  { id: "myvoice", group: "Голоса", label: "Голос по образцу", emoji: "🦜", desc: "По записи голоса — смех, плач, лепет, песенка и слова тем же голосом.", Component: MyVoiceTab },
  { id: "toys", group: "Звуки", label: "Игрушки", emoji: "🧸", desc: "Ксилофон, погремушка, пищалка, пузырьки и другие.", Component: ToysTab },
  { id: "sfx", group: "Звуки", label: "Звуковые эффекты", emoji: "🎮", desc: "Монетки, прыжки, бонусы и взрывы для игр.", Component: SfxTab },
] as const;

type TabId = (typeof TABS)[number]["id"];
const GROUPS = [...new Set(TABS.map((t) => t.group))];

// Вкладка живёт в hash: ссылка в сайдбаре закрывает мобильный drawer (так устроен AppShell),
// а адрес вида /#toys можно отправить другу.
function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}
function currentTab(): TabId {
  const id = window.location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? (id as TabId) : "baby";
}

function Brand() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-pink text-sm text-white shadow-sm">
        А
      </span>
      <span className="text-sm font-bold text-foreground">Агу</span>
      <span className="text-xs text-muted">звуковая мастерская</span>
    </span>
  );
}

function Sidebar({ tab }: { tab: TabId }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-edge px-4">
        <Brand />
      </div>
      <nav aria-label="Разделы" className="flex-1 overflow-y-auto px-3 py-4">
        {GROUPS.map((group) => (
          <div key={group} className="mb-5">
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{group}</div>
            <ul className="grid gap-0.5">
              {TABS.filter((t) => t.group === group).map((t) => (
                <li key={t.id}>
                  <a
                    href={`#${t.id}`}
                    aria-current={t.id === tab ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition ${
                      t.id === tab ? "bg-accent/12 font-medium text-accent-hover" : "text-muted hover:bg-surface-2 hover:text-foreground"
                    }`}
                  >
                    <span className="w-5 text-center leading-none">{t.emoji}</span>
                    {t.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="flex items-center justify-between border-t border-edge px-4 py-3">
        <span className="text-xs text-muted">Всё считается в браузере</span>
        <ThemeToggle labels={{ toDark: "Тёмная тема", toLight: "Светлая тема", action: "Сменить тему" }} />
      </div>
    </div>
  );
}

export function Studio() {
  const tab = useSyncExternalStore(subscribeHash, currentTab, () => "baby" as TabId);
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <LibraryProvider>
      <Backdrop backdrop={{ color: "#a855f7" }} />
      <AppShell brand={<Brand />} menuLabel="Открыть меню" sidebar={<Sidebar tab={tab} />}>
        <div className="mx-auto w-full max-w-6xl pb-16">
          <header className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">{active.group}</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">{active.label}</h1>
            <PageHint>{active.desc}</PageHint>
          </header>

          {/* Все разделы остаются смонтированными, чтобы не терять результаты при переключении. */}
          {TABS.map(({ id, Component }) => (
            <div key={id} hidden={id !== tab}>
              <Component />
            </div>
          ))}

          <Library />
        </div>
      </AppShell>
    </LibraryProvider>
  );
}
