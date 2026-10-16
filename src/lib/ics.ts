/**
 * Importar y exportar iCalendar (.ics, RFC 5545): Apple Calendar, Google Calendar, Outlook…
 *
 * Exporta eventos (con repeticiones, excepciones y alertas) y, opcionalmente, tareas (VTODO).
 * Cada componente lleva X-AGENDA-CALENDAR con el nombre de su calendario para poder
 * restaurar una copia completa. Al importar, el UID decide el id: reimportar el mismo archivo
 * actualiza en vez de duplicar.
 */
import { TZDate } from "@date-fns/tz";
import type { CalEvent, Calendar, Priority, Task } from "./types";
import { addDaysZ, fmt, TZ } from "./dates";
import { parseRRule } from "./rrule";

// ---------- Utilidades de texto ----------

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const unescapeText = (s: string) => s.replace(/\\([\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** Pliega líneas a 75 octetos (RFC 5545 §3.1) sin partir caracteres UTF-8. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
  /** Línea original (desplegada), para conservar propiedades que Agenda no gestiona. */
  raw: string;
}

function parseLine(line: string): Prop | null {
  // NOMBRE;PARAM=valor;PARAM="va:lor":VALOR
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (parts[0] ?? "").toUpperCase(), params, value, raw: line };
}

interface Component {
  type: string;
  props: Prop[];
  children: Component[];
}

function parseComponents(text: string): Component[] {
  const lines = text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const root: Component = { type: "ROOT", props: [], children: [] };
  const stack: Component[] = [root];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === "BEGIN") {
      const c: Component = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (p.name === "END") {
      if (stack.length > 1) stack.pop();
    } else top.props.push(p);
  }
  return root.children;
}

const get = (c: Component, name: string) => c.props.find((p) => p.name === name);
const getAll = (c: Component, name: string) => c.props.filter((p) => p.name === name);

// ---------- Fechas ----------

/** Nombres de zona de Windows/Outlook más habituales → IANA. */
const WINDOWS_TZ: Record<string, string> = {
  "Romance Standard Time": "Europe/Madrid",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central European Standard Time": "Europe/Warsaw",
  "Central Europe Standard Time": "Europe/Budapest",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Pacific Standard Time": "America/Los_Angeles",
  UTC: "UTC",
};

function resolveTz(tzid: string | undefined): string {
  if (!tzid) return TZ;
  const clean = tzid.replace(/^\/[^/]+\/[^/]+\//, ""); // "/mozilla.org/20050126_1/Europe/Madrid"
  const candidate = WINDOWS_TZ[clean] ?? clean;
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate });
    return candidate;
  } catch {
    return TZ;
  }
}

interface ParsedDate {
  ms: number;
  allDay: boolean;
}

function parseDate(p: Prop | undefined): ParsedDate | null {
  if (!p) return null;
  const v = p.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (hh == null || p.params.VALUE === "DATE") return { ms: new TZDate(+y, +mo - 1, +d, TZ).getTime(), allDay: true };
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss ?? 0)), allDay: false };
  // Con TZID o "flotante" (sin zona): se interpreta en esa zona o en Madrid.
  return { ms: new TZDate(+y, +mo - 1, +d, +hh, +mm, +(ss ?? 0), resolveTz(p.params.TZID)).getTime(), allDay: false };
}

function parseDateList(props: Prop[]): number[] {
  const out: number[] = [];
  for (const p of props) for (const part of p.value.split(",")) {
    const d = parseDate({ ...p, value: part });
    if (d) out.push(d.ms);
  }
  return out;
}

/** "-PT15M", "P1D", "-P1DT2H", "PT0S" → minutos (con signo). */
function parseDuration(v: string): number | null {
  const m = v.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const total = (+(w ?? 0)) * 10080 + (+(d ?? 0)) * 1440 + (+(h ?? 0)) * 60 + (+(mi ?? 0)) + Math.round(+(s ?? 0) / 60);
  return sign === "-" ? -total : total;
}

function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const a = Math.abs(minutes);
  if (a === 0) return "PT0S";
  if (a % 1440 === 0) return `${sign}P${a / 1440}D`;
  if (a % 60 === 0) return `${sign}PT${a / 60}H`;
  return `${sign}PT${a}M`;
}

const utcStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const localStamp = (ms: number) => fmt(ms, "yyyyMMdd'T'HHmmss");
const dateStamp = (ms: number) => fmt(ms, "yyyyMMdd");
const dtProp = (name: string, ms: number, allDay: boolean) =>
  allDay ? `${name};VALUE=DATE:${dateStamp(ms)}` : `${name};TZID=${TZ}:${localStamp(ms)}`;

const VTIMEZONE_MADRID = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZ}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

// ---------- Exportar ----------

/** Minutos de alerta (modelo de Agenda) → disparador relativo al inicio. */
function alertToTrigger(lead: number, allDay: boolean): string {
  // En todo el día Agenda avisa a las 9:00: "1 día antes" = 15 h antes de la medianoche.
  return formatDuration(-(allDay ? lead - 540 : lead));
}

export interface ExportOptions {
  events: CalEvent[];
  tasks?: Task[];
  calendars: Calendar[];
  name?: string;
  now?: number;
  /** UID a usar por id de serie/evento (para respetar los UID creados en el iPhone). */
  uids?: Map<string, string>;
  /** Líneas que conservar de la versión remota, por componente ("" = maestro, o el ms de RECURRENCE-ID). */
  preserve?: Map<string, string[]>;
  sequence?: number;
}

export function exportIcs(opts: ExportOptions): string {
  const now = opts.now ?? Date.now();
  const calName = new Map(opts.calendars.map((c) => [c.id, c.name]));
  const uidOf = (id: string) => opts.uids?.get(id) ?? `${id}@agenda`;
  const byId = new Map(opts.events.map((e) => [e.id, e]));
  const exceptionStarts = new Map<string, Set<number>>();
  for (const e of opts.events) if (e.seriesId && e.recurrenceId != null) {
    const set = exceptionStarts.get(e.seriesId) ?? new Set();
    set.add(e.recurrenceId);
    exceptionStarts.set(e.seriesId, set);
  }

  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agenda//Agenda 0.3//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (opts.name) L.push(`X-WR-CALNAME:${escapeText(opts.name)}`);
  L.push(`X-WR-TIMEZONE:${TZ}`, ...VTIMEZONE_MADRID);

  for (const e of opts.events) {
    const master = e.seriesId ? byId.get(e.seriesId) : undefined;
    if (e.seriesId && !master) continue; // excepción huérfana
    L.push("BEGIN:VEVENT", `UID:${uidOf(master ? master.id : e.id)}`, `DTSTAMP:${utcStamp(now)}`);
    L.push(`CREATED:${utcStamp(e.createdAt || now)}`, `LAST-MODIFIED:${utcStamp(e.updatedAt || now)}`);
    if (master && e.recurrenceId != null) L.push(dtProp("RECURRENCE-ID", e.recurrenceId, master.allDay));
    L.push(dtProp("DTSTART", e.start, e.allDay), dtProp("DTEND", e.end, e.allDay));
    L.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) L.push(`LOCATION:${escapeText(e.location)}`);
    if (e.notes) L.push(`DESCRIPTION:${escapeText(e.notes)}`);
    if (e.rrule) {
      L.push(`RRULE:${e.rrule}`);
      const overridden = exceptionStarts.get(e.id) ?? new Set();
      const ex = e.exdates.filter((x) => !overridden.has(x));
      if (ex.length) L.push(e.allDay ? `EXDATE;VALUE=DATE:${ex.map(dateStamp).join(",")}` : `EXDATE;TZID=${TZ}:${ex.map(localStamp).join(",")}`);
    }
    const cal = calName.get(e.calendarId);
    if (cal) L.push(`X-AGENDA-CALENDAR:${escapeText(cal)}`);
    if (opts.sequence != null) L.push(`SEQUENCE:${opts.sequence}`);
    for (const line of opts.preserve?.get(master && e.recurrenceId != null ? String(e.recurrenceId) : "") ?? []) L.push(line);
    for (const lead of e.alerts) {
      L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:${alertToTrigger(lead, e.allDay)}`, "END:VALARM");
    }
    L.push("END:VEVENT");
  }

  for (const t of opts.tasks ?? []) {
    L.push("BEGIN:VTODO", `UID:${uidOf(t.id)}`, `DTSTAMP:${utcStamp(now)}`, `SUMMARY:${escapeText(t.title)}`);
    if (t.notes) L.push(`DESCRIPTION:${escapeText(t.notes)}`);
    if (t.due != null) L.push(dtProp("DUE", t.due, !t.dueHasTime));
    if (t.priority) L.push(`PRIORITY:${({ 3: 1, 2: 5, 1: 9 } as Record<number, number>)[t.priority]}`);
    if (t.completedAt != null) L.push("STATUS:COMPLETED", `COMPLETED:${utcStamp(t.completedAt)}`);
    else L.push("STATUS:NEEDS-ACTION");
    const cal = calName.get(t.calendarId);
    if (cal) L.push(`X-AGENDA-CALENDAR:${escapeText(cal)}`);
    L.push("END:VTODO");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

// ---------- Importar ----------

export interface ImportResult {
  name: string | null;
  events: CalEvent[];
  tasks: Task[];
  /** UID original de cada serie/evento importado (por id). */
  uids: Map<string, string>;
  /** Ids de series/eventos que Agenda no puede editar sin perder información (invitados, reglas raras). */
  lossy: Set<string>;
  /** LAST-MODIFIED (o DTSTAMP) más reciente de cada serie/evento. */
  modified: Map<string, number>;
  /** Nombre de calendario de origen (X-AGENDA-CALENDAR) por id importado. */
  sourceCalendar: Map<string, string>;
  warnings: string[];
}

const SUPPORTED_RULE_KEYS = new Set(["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "UNTIL", "COUNT", "WKST"]);

/** Hash corto y estable para convertir UIDs ajenos en ids. */
function hashId(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519);
  }
  return `ics-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

const idFromUid = (uid: string) => (uid.endsWith("@agenda") ? uid.slice(0, -"@agenda".length) : hashId(uid));

/** Comprueba que la regla la entiende el motor de Agenda; si no, la descarta (queda la primera fecha). */
function cleanRule(raw: string, start: number): string | null {
  const parts = raw.split(";").filter(Boolean).map((p) => p.split("=") as [string, string]);
  const keys = parts.map(([k]) => k.toUpperCase());
  const freq = parts.find(([k]) => k.toUpperCase() === "FREQ")?.[1]?.toUpperCase();
  const byMonth = parts.find(([k]) => k.toUpperCase() === "BYMONTH")?.[1];
  // BYMONTH en una regla anual que coincide con el mes de inicio es redundante.
  const redundantMonth = freq === "YEARLY" && byMonth != null && Number(byMonth) === Number(fmt(start, "M"));
  if (keys.some((k) => !SUPPORTED_RULE_KEYS.has(k) && !(k === "BYMONTH" && redundantMonth))) return null;
  const kept = parts.filter(([k]) => !["WKST", "BYMONTH"].includes(k.toUpperCase())).map(([k, v]) => `${k.toUpperCase()}=${v.toUpperCase()}`).join(";");
  return parseRRule(kept) ? kept : null;
}

export function importIcs(text: string, now = Date.now()): ImportResult {
  const comps = parseComponents(text);
  const cal = comps.find((c) => c.type === "VCALENDAR");
  if (!cal) throw new Error("El archivo no es un calendario .ics válido.");
  const name = get(cal, "X-WR-CALNAME") ? unescapeText(get(cal, "X-WR-CALNAME")!.value) : null;
  const warnings: string[] = [];
  const sourceCalendar = new Map<string, string>();
  const masters = new Map<string, CalEvent>();
  const exceptions: { uid: string; ev: CalEvent }[] = [];
  const uids = new Map<string, string>();
  const lossyUids = new Set<string>();
  const modifiedByUid = new Map<string, number>();
  let unsupported = 0;

  for (const c of cal.children.filter((x) => x.type === "VEVENT")) {
    const uid = get(c, "UID")?.value.trim() || `${Math.random()}`;
    if (get(c, "STATUS")?.value.toUpperCase() === "CANCELLED") continue;
    const start = parseDate(get(c, "DTSTART"));
    if (!start) continue;
    let end = parseDate(get(c, "DTEND"))?.ms;
    if (end == null) {
      const dur = get(c, "DURATION") ? parseDuration(get(c, "DURATION")!.value) : null;
      end = dur != null ? start.ms + dur * 60_000 : start.allDay ? addDaysZ(start.ms, 1) : start.ms;
    }
    if (end < start.ms) end = start.ms;
    const alerts: number[] = [];
    for (const a of c.children.filter((x) => x.type === "VALARM")) {
      const trig = get(a, "TRIGGER");
      if (!trig || trig.params.VALUE === "DATE-TIME" || trig.params.RELATED === "END") continue;
      const mins = parseDuration(trig.value);
      if (mins == null) continue;
      const lead = start.allDay ? -mins + 540 : -mins;
      if (lead >= 0 && !alerts.includes(lead)) alerts.push(lead);
    }
    let rrule: string | null = null;
    const rr = get(c, "RRULE");
    if (rr) {
      rrule = cleanRule(rr.value, start.ms);
      if (!rrule) {
        unsupported++;
        lossyUids.add(uid);
      }
    }
    // Con invitados o fechas sueltas (RDATE) editar desde aquí podría estropear la invitación.
    if (get(c, "ATTENDEE") || get(c, "RDATE")) lossyUids.add(uid);
    const mod = parseDate(get(c, "LAST-MODIFIED") ?? get(c, "DTSTAMP"));
    if (mod) modifiedByUid.set(uid, Math.max(modifiedByUid.get(uid) ?? 0, mod.ms));
    const recurrence = parseDate(get(c, "RECURRENCE-ID"));
    const ev: CalEvent = {
      id: recurrence ? `${idFromUid(uid)}-r${recurrence.ms}` : idFromUid(uid),
      calendarId: "",
      title: unescapeText(get(c, "SUMMARY")?.value ?? "").trim() || "Sin título",
      location: unescapeText(get(c, "LOCATION")?.value ?? "").trim(),
      notes: unescapeText(get(c, "DESCRIPTION")?.value ?? "").trim(),
      allDay: start.allDay,
      start: start.ms,
      end,
      rrule: recurrence ? null : rrule,
      exdates: recurrence ? [] : parseDateList(getAll(c, "EXDATE")),
      seriesId: null,
      recurrenceId: recurrence?.ms ?? null,
      alerts: alerts.slice(0, 2),
      createdAt: now,
      updatedAt: now,
    };
    const src = get(c, "X-AGENDA-CALENDAR");
    if (src) sourceCalendar.set(ev.id, unescapeText(src.value));
    if (recurrence) exceptions.push({ uid, ev });
    else {
      masters.set(uid, ev);
      uids.set(ev.id, uid);
    }
  }

  // Excepciones ("solo este"): se cuelgan de su serie y la serie se salta esa repetición.
  for (const { uid, ev } of exceptions) {
    const master = masters.get(uid);
    if (!master || !master.rrule) {
      // Sin serie conocida: se importa como evento suelto.
      masters.set(`${uid}#${ev.recurrenceId}`, { ...ev, recurrenceId: null });
      uids.set(ev.id, uid);
      continue;
    }
    ev.seriesId = master.id;
    if (!master.exdates.includes(ev.recurrenceId!)) master.exdates.push(ev.recurrenceId!);
  }

  const tasks: Task[] = [];
  for (const c of cal.children.filter((x) => x.type === "VTODO")) {
    const uid = get(c, "UID")?.value.trim() || `${Math.random()}`;
    const due = parseDate(get(c, "DUE"));
    const prio = Number(get(c, "PRIORITY")?.value ?? 0);
    const status = get(c, "STATUS")?.value.toUpperCase();
    const completed = parseDate(get(c, "COMPLETED"));
    const t: Task = {
      id: idFromUid(uid),
      calendarId: "",
      title: unescapeText(get(c, "SUMMARY")?.value ?? "").trim() || "Sin título",
      notes: unescapeText(get(c, "DESCRIPTION")?.value ?? "").trim(),
      due: due?.ms ?? null,
      dueHasTime: due ? !due.allDay : false,
      priority: (prio >= 1 && prio <= 4 ? 3 : prio === 5 ? 2 : prio >= 6 ? 1 : 0) as Priority,
      completedAt: status === "COMPLETED" || completed ? (completed?.ms ?? now) : null,
      createdAt: now,
      updatedAt: now,
    };
    const src = get(c, "X-AGENDA-CALENDAR");
    if (src) sourceCalendar.set(t.id, unescapeText(src.value));
    tasks.push(t);
  }

  if (unsupported) warnings.push(`${unsupported} ${unsupported === 1 ? "evento repetido usa" : "eventos repetidos usan"} reglas que Agenda no entiende; se han importado solo con su primera fecha.`);
  const events = [...masters.values(), ...exceptions.filter((x) => x.ev.seriesId).map((x) => x.ev)];
  const lossy = new Set<string>();
  const modified = new Map<string, number>();
  for (const [id, uid] of uids) {
    if (lossyUids.has(uid)) lossy.add(id);
    const m = modifiedByUid.get(uid);
    if (m != null) modified.set(id, m);
  }
  return { name, events, tasks, uids, lossy, modified, sourceCalendar, warnings };
}

/** Propiedades que Agenda genera; el resto (invitados, URL, X-APPLE-…) se conserva al subir cambios. */
const MANAGED = new Set([
  "UID", "DTSTAMP", "CREATED", "LAST-MODIFIED", "RECURRENCE-ID", "DTSTART", "DTEND", "DURATION", "SUMMARY",
  "LOCATION", "DESCRIPTION", "RRULE", "EXDATE", "SEQUENCE", "X-AGENDA-CALENDAR",
]);

/**
 * De un .ics remoto saca lo que hay que conservar al reescribirlo: líneas no gestionadas de cada
 * VEVENT (clave "" para el maestro o el ms de RECURRENCE-ID) y el SEQUENCE siguiente.
 */
export function preservedFrom(raw: string): { preserve: Map<string, string[]>; sequence: number } {
  const preserve = new Map<string, string[]>();
  let sequence = 0;
  try {
    const cal = parseComponents(raw).find((c) => c.type === "VCALENDAR");
    for (const c of cal?.children.filter((x) => x.type === "VEVENT") ?? []) {
      const rid = parseDate(get(c, "RECURRENCE-ID"));
      preserve.set(rid ? String(rid.ms) : "", c.props.filter((p) => !MANAGED.has(p.name)).map((p) => p.raw));
      sequence = Math.max(sequence, Number(get(c, "SEQUENCE")?.value ?? 0) + 1);
    }
  } catch {
    /* sin versión remota legible: nada que conservar */
  }
  return { preserve, sequence };
}
