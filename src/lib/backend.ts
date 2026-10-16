import type { CalEvent, Calendar, Corner, Id, MonitorInfo, Task, WidgetConfig } from "./types";
import { DEFAULT_CALENDARS, DEFAULT_WIDGET } from "./defaults";
import { demoData } from "./demo";
import type { Alarm } from "./alarms";

/**
 * Contrato con el backend. En la app real lo implementa Rust (SQLite) vía comandos de Tauri;
 * en el navegador (desarrollo y capturas) lo implementa `MockBackend` con localStorage.
 */
export interface Backend {
  listCalendars(): Promise<Calendar[]>;
  saveCalendar(c: Calendar): Promise<void>;
  /** Borra el calendario y todo lo que contiene. */
  deleteCalendar(id: Id): Promise<void>;

  /** Eventos que pueden aparecer en [from, to): los normales que solapan y todas las series que empiezan antes de `to`. */
  listEvents(from: number, to: number): Promise<CalEvent[]>;
  getEvent(id: Id): Promise<CalEvent | null>;
  /** Todos los eventos (para la búsqueda). */
  listAllEvents(): Promise<CalEvent[]>;
  deleteExceptionsFrom(seriesId: Id, from: number): Promise<void>;
  /** Alertas que el backend debe disparar como notificaciones de Windows. */
  setAlarms(alarms: Alarm[]): Promise<void>;
  saveEvent(e: CalEvent): Promise<void>;
  /** Borra el evento y, si es una serie, también sus excepciones. */
  deleteEvent(id: Id): Promise<void>;

  listTasks(): Promise<Task[]>;
  saveTask(t: Task): Promise<void>;
  deleteTask(id: Id): Promise<void>;

  getSettings(): Promise<Record<string, unknown>>;
  setSetting(key: string, value: unknown): Promise<void>;

  /** Se llama cuando cualquier ventana cambia datos. Devuelve la función para dejar de escuchar. */
  onChange(cb: (kind: string) => void): Promise<() => void>;

  // Widget y sistema
  getWidgetConfig(): Promise<WidgetConfig>;
  setWidgetConfig(c: WidgetConfig): Promise<void>;
  snapWidget(corner: Corner): Promise<void>;
  listMonitors(): Promise<MonitorInfo[]>;
  /** Abre la ventana principal (y navega a `day` si se indica). */
  openMain(day?: number): Promise<void>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
  /** Eventos de la bandeja / del widget dirigidos a la ventana principal. */
  onNavigate(cb: (day: number) => void): Promise<() => void>;
  onQuickAdd(cb: () => void): Promise<() => void>;
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

class TauriBackend implements Backend {
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  listCalendars() { return this.call<Calendar[]>("list_calendars"); }
  saveCalendar(calendar: Calendar) { return this.call<void>("save_calendar", { calendar }); }
  deleteCalendar(id: Id) { return this.call<void>("delete_calendar", { id }); }
  listEvents(from: number, to: number) { return this.call<CalEvent[]>("list_events", { from, to }); }
  getEvent(id: Id) { return this.call<CalEvent | null>("get_event", { id }); }
  listAllEvents() { return this.call<CalEvent[]>("list_all_events"); }
  deleteExceptionsFrom(seriesId: Id, from: number) { return this.call<void>("delete_exceptions_from", { seriesId, from }); }
  setAlarms(alarms: Alarm[]) { return this.call<void>("set_alarms", { alarms }); }
  saveEvent(event: CalEvent) { return this.call<void>("save_event", { event }); }
  deleteEvent(id: Id) { return this.call<void>("delete_event", { id }); }
  listTasks() { return this.call<Task[]>("list_tasks"); }
  saveTask(task: Task) { return this.call<void>("save_task", { task }); }
  deleteTask(id: Id) { return this.call<void>("delete_task", { id }); }
  getSettings() { return this.call<Record<string, unknown>>("get_settings"); }
  setSetting(key: string, value: unknown) { return this.call<void>("set_setting", { key, value }); }
  async onChange(cb: (kind: string) => void) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("data-changed", (e) => cb(e.payload));
  }
  getWidgetConfig() { return this.call<WidgetConfig>("widget_get_config"); }
  setWidgetConfig(config: WidgetConfig) { return this.call<void>("widget_set_config", { config }); }
  snapWidget(corner: Corner) { return this.call<void>("widget_snap", { corner }); }
  listMonitors() { return this.call<MonitorInfo[]>("list_monitors"); }
  openMain(day?: number) { return this.call<void>("open_main", { day: day ?? null }); }
  getAutostart() { return this.call<boolean>("get_autostart"); }
  setAutostart(enabled: boolean) { return this.call<void>("set_autostart", { enabled }); }
  async onNavigate(cb: (day: number) => void) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().listen<number>("navigate", (e) => cb(e.payload));
  }
  async onQuickAdd(cb: () => void) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().listen("quick-add", () => cb());
  }
}

interface MockDb {
  calendars: Calendar[];
  events: CalEvent[];
  tasks: Task[];
  settings: Record<string, unknown>;
}

/** Backend en memoria + localStorage para `npm run dev` en el navegador. Se sincroniza entre pestañas. */
export class MockBackend implements Backend {
  private key = "agenda-mock-db";
  private channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("agenda") : null;
  private listeners = new Set<(k: string) => void>();
  private memory: MockDb | null = null;
  /** Con datos de ejemplo se trabaja solo en memoria (no se toca lo guardado). */
  private memoryOnly = false;

  constructor(seed?: Partial<MockDb>) {
    if (seed) {
      this.memory = { calendars: DEFAULT_CALENDARS, events: [], tasks: [], settings: {}, ...seed };
      this.memoryOnly = true;
    }
    this.channel?.addEventListener("message", (e) => {
      if (!String(e.data).startsWith("navigate:")) this.listeners.forEach((l) => l(String(e.data)));
    });
  }

  private load(): MockDb {
    if (!this.memoryOnly) {
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) return JSON.parse(raw);
      } catch {
        /* sin almacenamiento: seguimos en memoria */
      }
    }
    this.memory ??= { calendars: [...DEFAULT_CALENDARS], events: [], tasks: [], settings: {} };
    return this.memory;
  }
  private save(db: MockDb, kind: string) {
    this.memory = db;
    if (!this.memoryOnly) {
      try {
        localStorage.setItem(this.key, JSON.stringify(db));
      } catch {
        /* se queda en memoria */
      }
    }
    this.listeners.forEach((l) => l(kind));
    if (!this.memoryOnly) this.channel?.postMessage(kind);
  }
  private upsert<T extends { id: Id }>(list: T[], item: T): T[] {
    const i = list.findIndex((x) => x.id === item.id);
    return i === -1 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
  }

  async listCalendars() { return [...this.load().calendars].sort((a, b) => a.sortOrder - b.sortOrder); }
  async saveCalendar(c: Calendar) { const db = this.load(); db.calendars = this.upsert(db.calendars, c); this.save(db, "calendars"); }
  async deleteCalendar(id: Id) {
    const db = this.load();
    db.calendars = db.calendars.filter((c) => c.id !== id);
    db.events = db.events.filter((e) => e.calendarId !== id);
    db.tasks = db.tasks.filter((t) => t.calendarId !== id);
    this.save(db, "calendars");
  }
  async listEvents(from: number, to: number) {
    return this.load().events.filter((e) =>
      e.rrule ? e.start < to : e.start < to && e.end > from,
    );
  }
  async getEvent(id: Id) { return this.load().events.find((e) => e.id === id) ?? null; }
  async listAllEvents() { return this.load().events; }
  async deleteExceptionsFrom(seriesId: Id, from: number) {
    const db = this.load();
    db.events = db.events.filter((e) => !(e.seriesId === seriesId && (e.recurrenceId ?? 0) >= from));
    this.save(db, "events");
  }
  async setAlarms() {}
  async saveEvent(e: CalEvent) { const db = this.load(); db.events = this.upsert(db.events, e); this.save(db, "events"); }
  async deleteEvent(id: Id) {
    const db = this.load();
    db.events = db.events.filter((e) => e.id !== id && e.seriesId !== id);
    this.save(db, "events");
  }
  async listTasks() { return this.load().tasks; }
  async saveTask(t: Task) { const db = this.load(); db.tasks = this.upsert(db.tasks, t); this.save(db, "tasks"); }
  async deleteTask(id: Id) { const db = this.load(); db.tasks = db.tasks.filter((t) => t.id !== id); this.save(db, "tasks"); }
  async getSettings() { return { ...this.load().settings }; }
  async setSetting(key: string, value: unknown) { const db = this.load(); db.settings[key] = value; this.save(db, "settings"); }
  async onChange(cb: (kind: string) => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  async getWidgetConfig() { return { ...DEFAULT_WIDGET, ...(this.load().settings.widget as Partial<WidgetConfig> | undefined) }; }
  async setWidgetConfig(c: WidgetConfig) { await this.setSetting("widget", c); }
  async snapWidget(corner: Corner) {
    const c = await this.getWidgetConfig();
    await this.setWidgetConfig({ ...c, positionSet: true, x: corner.endsWith("l") ? 24 : 1440 - c.width - 24, y: corner.startsWith("t") ? 24 : 900 - c.height - 24 });
  }
  async listMonitors(): Promise<MonitorInfo[]> {
    return [{ name: "navegador", label: "Pantalla 1 (principal) — 1440×960", width: 1440, height: 960, scale: 2, primary: true }];
  }
  async openMain(day?: number) { this.channel?.postMessage(`navigate:${day ?? ""}`); }
  async getAutostart() { return Boolean(this.load().settings.autostart ?? true); }
  async setAutostart(enabled: boolean) { await this.setSetting("autostart", enabled); }
  async onNavigate(cb: (day: number) => void) {
    const l = (e: MessageEvent) => {
      const m = String(e.data).match(/^navigate:(\d*)$/);
      if (m && m[1]) cb(Number(m[1]));
    };
    this.channel?.addEventListener("message", l);
    return () => this.channel?.removeEventListener("message", l);
  }
  async onQuickAdd() { return () => {}; }
}

function browserBackend(): Backend {
  // /?demo arranca con datos de ejemplo en memoria (no toca lo guardado en localStorage).
  if (typeof location !== "undefined" && new URLSearchParams(location.search).has("demo")) return new MockBackend(demoData());
  return new MockBackend();
}

export const backend: Backend = isTauri() ? new TauriBackend() : browserBackend();

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
