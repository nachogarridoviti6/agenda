import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import type { Calendar } from "./lib/types";
import { backend, isTauri } from "./lib/backend";
import { computeAlarms } from "./lib/alarms";

/** Hora actual que se refresca cada `ms` (por defecto 30 s), para la línea roja. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Aplica el tema elegido ("system" deja que mande el sistema). */
export function useApplyTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}

export function useCalendarMap(): Map<string, Calendar> {
  const calendars = useStore((s) => s.calendars);
  return useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/**
 * Atajos de teclado globales: N nuevo, T hoy, flechas navegar, 1/2/3/4 vistas,
 * Ctrl+K añadir rápido, Ctrl+F o / buscar.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const busy = s.editor || s.quickAddOpen || s.scopePrompt;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !busy) {
        const k = e.key.toLowerCase();
        if (k === "k") (e.preventDefault(), s.openQuickAdd(true));
        if (k === "f") (e.preventDefault(), s.focusSearch());
        return;
      }
      if (busy || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case "n":
        case "N":
          s.openNewEvent();
          break;
        case "t":
        case "T":
          s.goToday();
          break;
        case "ArrowLeft":
          s.step(-1);
          break;
        case "ArrowRight":
          s.step(1);
          break;
        case "1":
          s.setView("day");
          break;
        case "2":
          s.setView("week");
          break;
        case "3":
          s.setView("month");
          break;
        case "4":
          s.setView("year");
          break;
        case "/":
          s.focusSearch();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Programa las alertas de las próximas 48 h en el backend (que las dispara aunque la ventana
 * esté oculta). Se recalcula al cambiar datos y cada 30 minutos.
 */
export function useAlarmScheduler() {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const push = async () => {
      const now = Date.now();
      const from = now - 10 * 60_000;
      const to = now + 48 * 3600_000;
      const [calendars, events, tasks] = await Promise.all([backend.listCalendars(), backend.listEvents(from - 7 * 86_400_000, to + 8 * 86_400_000), backend.listTasks()]);
      if (!cancelled) await backend.setAlarms(computeAlarms(calendars, events, tasks, from, to));
    };
    void push();
    const id = setInterval(push, 30 * 60_000);
    const off = backend.onChange((k) => k !== "settings" && void push());
    return () => {
      cancelled = true;
      clearInterval(id);
      void off.then((f) => f());
    };
  }, []);
}
