import type { CalEvent, Task } from "./types";
import { expandRule, parseRRule } from "./rrule";
import { DAY_MS } from "./dates";

export type SearchHit =
  | { kind: "event"; event: CalEvent; start: number; end: number; score: number }
  | { kind: "task"; task: Task; score: number };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Busca en eventos (título, lugar, notas) y tareas (título, notas), sin distinguir
 * mayúsculas ni acentos. Todas las palabras tienen que aparecer. De cada serie se muestra la
 * próxima repetición (o la última, si ya terminó). Orden: próximos primero, luego pasados.
 */
export function search(events: CalEvent[], tasks: Task[], query: string, now = Date.now(), limit = 50): SearchHit[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const matches = (...fields: string[]) => {
    const hay = norm(fields.join(" "));
    return words.every((w) => hay.includes(w));
  };
  const titleBonus = (title: string) => (norm(title).startsWith(words[0]) ? 0 : 1);

  const hits: SearchHit[] = [];
  for (const e of events) {
    if (!matches(e.title, e.location, e.notes)) continue;
    let start = e.start;
    const rule = parseRRule(e.rrule);
    if (rule) {
      const next = expandRule(rule, e, now, now + 3 * 366 * DAY_MS)[0];
      if (next != null) start = next;
      else {
        const past = expandRule(rule, e, e.start, now);
        start = past[past.length - 1] ?? e.start;
      }
    }
    hits.push({ kind: "event", event: e, start, end: start + (e.end - e.start), score: titleBonus(e.title) });
  }
  for (const t of tasks) if (matches(t.title, t.notes)) hits.push({ kind: "task", task: t, score: titleBonus(t.title) });

  const when = (h: SearchHit) => (h.kind === "event" ? h.start : (h.task.due ?? now));
  const upcoming = (h: SearchHit) => (h.kind === "event" ? h.end >= now : h.task.completedAt == null);
  return hits
    .sort((a, b) => {
      const ua = upcoming(a);
      const ub = upcoming(b);
      if (ua !== ub) return ua ? -1 : 1;
      return ua ? when(a) - when(b) || a.score - b.score : when(b) - when(a);
    })
    .slice(0, limit);
}
