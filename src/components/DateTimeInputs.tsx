import { useEffect, useRef, useState } from "react";
import { addMonthsZ, capitalize, dayKey, fmt, isSameDayZ, monthGridDays, parseDayKey, startOfMonthZ } from "../lib/dates";
import { parseTimeInput, shiftTime } from "../lib/timeinput";
import { ChevronLeft, ChevronRight } from "./icons";

/** Campo de hora 24 h independiente del idioma de Windows. Flechas ↑/↓ = ±15 min. */
export function TimeInput({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const t = parseTimeInput(text);
    if (t) {
      setBad(false);
      setText(t);
      if (t !== value) onChange(t);
    } else {
      setBad(true);
      setText(value);
    }
  };
  return (
    <input
      className={`time-input ${bad ? "is-bad" : ""}`}
      value={text}
      aria-label={label}
      inputMode="numeric"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = shiftTime(parseTimeInput(text) ?? value, e.key === "ArrowUp" ? 15 : -15);
          setText(next);
          onChange(next);
        }
      }}
    />
  );
}

/** Selector de fecha con mini calendario en español (semana empieza en lunes). */
export function DateInput({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  const [open, setOpen] = useState(false);
  const ms = parseDayKey(value);
  const [shown, setShown] = useState(startOfMonthZ(ms));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setShown(startOfMonthZ(ms));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const days = monthGridDays(shown);
  const month = fmt(shown, "M");
  return (
    <div className="date-input" ref={ref}>
      <button type="button" className="date-btn" aria-label={label} onClick={() => setOpen((o) => !o)}>
        {fmt(ms, "EEE, d MMM yyyy")}
      </button>
      {open && (
        <div className="date-pop" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false))}>
          <div className="mini-head">
            <span className="mini-title">{capitalize(fmt(shown, "MMMM yyyy"))}</span>
            <button type="button" className="icon-btn sm" onClick={() => setShown(addMonthsZ(shown, -1))} aria-label="Mes anterior">
              <ChevronLeft width={13} height={13} />
            </button>
            <button type="button" className="icon-btn sm" onClick={() => setShown(addMonthsZ(shown, 1))} aria-label="Mes siguiente">
              <ChevronRight width={13} height={13} />
            </button>
          </div>
          <div className="mini-grid">
            {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
              <div key={d} className="mini-wd">{d}</div>
            ))}
            {days.map((d) => (
              <button
                type="button"
                key={d}
                className={[
                  "mini-day",
                  fmt(d, "M") !== month && "is-other",
                  isSameDayZ(d, Date.now()) && "is-today-text",
                  isSameDayZ(d, ms) && "is-selected",
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  onChange(dayKey(d));
                  setOpen(false);
                }}
              >
                {fmt(d, "d")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
