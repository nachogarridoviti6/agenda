import type { CalEvent, Calendar, Task } from "./types";
import { expandEvents } from "./occurrences";
import { dayDiff, fmt, hm } from "./dates";

export interface Alarm {
  /** Único por aparición + alerta, para no avisar dos veces. */
  id: string;
  at: number;
  title: string;
  body: string;
}

export const ALERT_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "A la hora del evento" },
  { value: 5, label: "5 minutos antes" },
  { value: 10, label: "10 minutos antes" },
  { value: 15, label: "15 minutos antes" },
  { value: 30, label: "30 minutos antes" },
  { value: 60, label: "1 hora antes" },
  { value: 120, label: "2 horas antes" },
  { value: 1440, label: "1 día antes" },
  { value: 2880, label: "2 días antes" },
  { value: 10080, label: "1 semana antes" },
];

export function alertLabel(min: number): string {
  return ALERT_OPTIONS.find((o) => o.value === min)?.label ?? `${min} minutos antes`;
}

function whenText(start: number, at: number): string {
  const mins = Math.round((start - at) / 60_000);
  if (mins <= 0) return "Ahora";
  if (mins < 60) return `En ${mins} min`;
  const d = dayDiff(start, at);
  if (d === 0) return `Hoy a las ${hm(start)}`;
  if (d === 1) return `Mañana a las ${hm(start)}`;
  return fmt(start, "EEEE d 'a las' H:mm");
}

/**
 * Alertas que suenan en [from, to). Eventos: según sus alertas (las de todo el día cuentan
 * desde las 9:00 del día). Tareas con hora: a la hora límite.
 */
export function computeAlarms(calendars: Calendar[], events: CalEvent[], tasks: Task[], from: number, to: number): Alarm[] {
  const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
  const maxLead = Math.max(0, ...events.flatMap((e) => e.alerts)) * 60_000;
  const out: Alarm[] = [];
  for (const o of expandEvents(events, from, to + maxLead + 86_400_000)) {
    if (!visible.has(o.event.calendarId)) continue;
    const ref = o.event.allDay ? o.start + 9 * 3600_000 : o.start;
    for (const lead of o.event.alerts) {
      const at = ref - lead * 60_000;
      if (at < from || at >= to) continue;
      const place = o.event.location ? ` · ${o.event.location}` : "";
      out.push({
        id: `${o.key}#${lead}`,
        at,
        title: o.event.title || "Evento",
        body: o.event.allDay ? `${whenText(o.start, at).replace(/ a las.*/, "")} · Todo el día${place}` : `${whenText(o.start, at)} (${hm(o.start)}–${hm(o.end)})${place}`,
      });
    }
  }
  for (const t of tasks) {
    if (!visible.has(t.calendarId) || t.completedAt != null || t.due == null || !t.dueHasTime) continue;
    if (t.due < from || t.due >= to) continue;
    out.push({ id: `task:${t.id}@${t.due}`, at: t.due, title: `Tarea: ${t.title}`, body: `Vence ahora (${hm(t.due)})` });
  }
  return out.sort((a, b) => a.at - b.at);
}
