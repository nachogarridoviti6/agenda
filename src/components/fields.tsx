import type { CSSProperties, ReactNode } from "react";
import type { Calendar } from "../lib/types";

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="f-row">
      <span className="f-label">{label}</span>
      <div className="f-control">{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function CalendarSelect({ calendars, value, onChange }: { calendars: Calendar[]; value: string; onChange(id: string): void }) {
  const current = calendars.find((c) => c.id === value);
  return (
    <div className="cal-select" style={{ "--c": current?.color } as CSSProperties}>
      <span className="dot" />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Calendario">
        {calendars.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

/** Botón de borrar que pide una segunda pulsación para confirmar. */
export function DeleteButton({ label, armed, onArm, onConfirm }: { label: string; armed: boolean; onArm(): void; onConfirm(): void }) {
  return (
    <button type="button" className={`btn danger ${armed ? "armed" : ""}`} onClick={armed ? onConfirm : onArm}>
      {armed ? "¿Seguro? Pulsa otra vez" : label}
    </button>
  );
}
