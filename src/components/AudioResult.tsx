"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { audioContext, type Clip, downloadClip, duration, playClip, stopPlayback } from "@/lib/audio/core";
import { Button } from "./ui";

// ---------- Коллекция сгенерированных звуков (только в памяти вкладки) ----------

export type SavedClip = { id: number; name: string; clip: Clip };

const LibraryContext = createContext<{
  items: SavedClip[];
  add: (name: string, clip: Clip) => void;
  remove: (id: number) => void;
} | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SavedClip[]>([]);
  const nextId = useRef(1);
  const add = useCallback((name: string, clip: Clip) => {
    setItems((prev) => [{ id: nextId.current++, name, clip }, ...prev]);
  }, []);
  const remove = useCallback((id: number) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  return <LibraryContext.Provider value={{ items, add, remove }}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary вне LibraryProvider");
  return ctx;
}

// ---------- Плеер ----------

function usePlayer(clip: Clip | null) {
  const [startAt, setStartAt] = useState<number | null>(null);
  const playingRef = useRef(false);
  useEffect(() => {
    playingRef.current = startAt !== null;
  }, [startAt]);
  // Остановить звук, если компонент исчез во время проигрывания.
  useEffect(() => () => {
    if (playingRef.current) stopPlayback();
  }, []);
  const toggle = useCallback(() => {
    if (!clip) return;
    if (startAt !== null) {
      stopPlayback();
      return;
    }
    setStartAt(playClip(clip, () => setStartAt(null)));
  }, [clip, startAt]);
  return { playing: startAt !== null, startAt, toggle };
}

function Waveform({ clip, startAt, height = 72 }: { clip: Clip; startAt: number | null; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const g = canvas.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, height);
      const style = getComputedStyle(canvas);
      const base = style.getPropertyValue("--wave").trim() || "#c7b8f5";
      const played = style.getPropertyValue("--accent").trim() || "#7c5cff";
      const x = clip.samples;
      const per = Math.max(1, Math.floor(x.length / w));
      let progress = -1;
      if (startAt !== null) {
        const t = audioContext().currentTime - startAt;
        progress = Math.max(0, Math.min(1, t / duration(clip)));
      }
      const mid = height / 2;
      for (let px = 0; px < w; px++) {
        let lo = 0, hi = 0;
        const s = Math.floor((px / w) * x.length);
        for (let i = s; i < Math.min(x.length, s + per); i++) {
          if (x[i] < lo) lo = x[i];
          if (x[i] > hi) hi = x[i];
        }
        g.fillStyle = progress >= 0 && px / w <= progress ? played : base;
        const top = mid - hi * mid * 0.95;
        g.fillRect(px, top, 1, Math.max(1, (hi - lo) * mid * 0.95));
      }
      if (startAt !== null) raf = requestAnimationFrame(draw);
    };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [clip, startAt, height]);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} style={{ width: "100%", height }} className="block" />
    </div>
  );
}

export function AudioResult({
  clip,
  name,
  label,
  compact,
}: {
  clip: Clip;
  name: string;
  label?: string;
  compact?: boolean;
}) {
  const { playing, startAt, toggle } = usePlayer(clip);
  const library = useContext(LibraryContext);
  const [savedClip, setSavedClip] = useState<Clip | null>(null);
  const saved = savedClip === clip;

  return (
    <div className="rounded-2xl bg-well p-3 ring-1 ring-line">
      {label && <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">{label}</div>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Стоп" : "Играть"}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-white shadow-sm transition hover:bg-accent-strong active:scale-95"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 size-5" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z" /></svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <Waveform clip={clip} startAt={startAt} height={compact ? 40 : 64} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs tabular-nums text-muted">{duration(clip).toFixed(2)} с · {clip.sampleRate} Гц</span>
        {library && !compact && (
          <Button
            variant="ghost"
            disabled={saved}
            onClick={() => {
              library.add(name, clip);
              setSavedClip(clip);
            }}
          >
            {saved ? "✓ В коллекции" : "☆ В коллекцию"}
          </Button>
        )}
        <Button variant="secondary" onClick={() => downloadClip(clip, name)}>
          ⬇ WAV
        </Button>
      </div>
    </div>
  );
}

export function Library() {
  const { items, remove } = useLibrary();
  if (!items.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-extrabold text-ink">Моя коллекция</h2>
      <p className="mb-3 text-sm text-muted">Хранится только до закрытия вкладки — скачайте то, что понравилось.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="relative">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="truncate text-sm font-bold text-ink">{item.name}</span>
              <button type="button" onClick={() => remove(item.id)} className="text-xs font-bold text-muted hover:text-ink">
                Удалить
              </button>
            </div>
            <AudioResult clip={item.clip} name={item.name} compact />
          </div>
        ))}
      </div>
    </section>
  );
}
