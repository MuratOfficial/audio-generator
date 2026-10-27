"use client";

// Локальные примитивы поверх PathLogs UI: кнопки и поля берутся из
// @toimetdev/pathlogs-core, остальное размечено утилитами токенов
// (bg-surface, border-edge, text-muted), поэтому следует теме.

import type { ReactNode } from "react";

export { Button, Field, Input, Select, Textarea, Badge, PageHint } from "@toimetdev/pathlogs-core";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-edge bg-surface p-5 shadow-sm sm:p-6 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = (v) => v.toFixed(2),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums text-muted">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range w-full"
      />
    </label>
  );
}

/** Сетка выбора: активный пункт подсвечивается так же, как пункт меню в PathLogs. */
export function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
  columns = "grid-cols-2 sm:grid-cols-4",
  large,
}: {
  options: { id: T; label: string; emoji?: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: string;
  large?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`flex rounded-lg border text-sm transition active:scale-[0.98] ${
              large ? "flex-col items-center gap-2 px-2 py-4 text-center" : "items-center gap-2.5 px-3 py-2 text-left"
            } ${
              active
                ? "border-accent/50 bg-accent/12 font-medium text-accent-hover"
                : "border-edge bg-surface-2 text-foreground hover:border-accent/30 hover:bg-surface"
            }`}
          >
            {o.emoji && <span className={`${large ? "text-2xl" : "text-base"} leading-none`}>{o.emoji}</span>}
            <span className="min-w-0">
              <span className={`block ${large ? "leading-tight" : "truncate"}`}>{o.label}</span>
              {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-edge bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            o.id === value ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-lg border px-4 py-3 text-sm ${
        tone === "error" ? "border-danger/40 bg-danger/10 text-danger" : "border-edge bg-surface-2 text-muted"
      }`}
    >
      {children}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
