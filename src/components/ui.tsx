"use client";

import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-card p-5 shadow-soft ring-1 ring-line sm:p-6 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-muted">{children}</h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent-strong shadow-sm",
    secondary: "bg-chip text-ink hover:bg-chip-strong",
    ghost: "text-muted hover:bg-chip hover:text-ink",
  }[variant];
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
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
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <span className="tabular-nums text-muted">{format(value)}</span>
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

export function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
  columns = "grid-cols-2 sm:grid-cols-4",
}: {
  options: { id: T; label: string; emoji?: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: string;
}) {
  return (
    <div className={`grid gap-2 ${columns}`}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-bold transition ${
              active ? "bg-accent text-white shadow-sm" : "bg-chip text-ink hover:bg-chip-strong"
            }`}
          >
            {o.emoji && <span className="text-lg leading-none">{o.emoji}</span>}
            <span className="min-w-0">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className={`block truncate text-xs font-semibold ${active ? "text-white/80" : "text-muted"}`}>{o.hint}</span>}
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
    <div className="inline-flex flex-wrap gap-1 rounded-2xl bg-chip p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded-xl px-3 py-1.5 text-sm font-bold transition ${
            o.id === value ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
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
    <div className={`rounded-2xl px-4 py-3 text-sm ${tone === "error" ? "bg-red-50 text-red-800 ring-1 ring-red-200" : "bg-chip text-muted"}`}>
      {children}
    </div>
  );
}
