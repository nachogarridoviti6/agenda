import { create } from "zustand";
import { backend, newId } from "./lib/backend";
import type { CalEvent, Calendar, Occurrence, Task, ThemePref, ViewMode } from "./lib/types";
import { addDaysZ, startOfDayZ, stepCursor, viewRange } from "./lib/dates";
import { DEFAULT_EVENT_MINUTES } from "./lib/defaults";
import { deleteOccurrence, editOccurrence, shiftWeekday, type Scope, type SeriesOps } from "./lib/series";

export type Editor =
  /** `master` y `occStart` solo cuando se edita una repetición de una serie. */
  | { kind: "event"; event: CalEvent; isNew: boolean; master?: CalEvent; occStart?: number }
  | { kind: "task"; task: Task; isNew: boolean }
  | { kind: "calendar"; calendar: Calendar; isNew: boolean }
  | null;

interface State {
  ready: boolean;
  error: string | null;
  calendars: Calendar[];
  events: CalEvent[];
  tasks: Task[];
  theme: ThemePref;
  view: ViewMode;
  cursor: number;
  editor: Editor;
  sidebarOpen: boolean;
  /** Pregunta "¿solo este o todos los futuros?" pendiente. */
  scopePrompt: { action: "save" | "delete"; resolve(scope: Scope | null): void } | null;
  quickAddOpen: boolean;
  searchFocus: number;
  /** Contenido de un .ics pendiente de importar (doble clic en el Explorador). */
  pendingIcs: string | null;
  welcome: boolean;

  init(): Promise<void>;
  reload(kind?: string): Promise<void>;
  setView(v: ViewMode): void;
  setCursor(ms: number): void;
  goToday(): void;
  step(dir: number): void;
  toggleSidebar(): void;
  setTheme(t: ThemePref): Promise<void>;

  openNewEvent(opts?: { start?: number; end?: number; allDay?: boolean; calendarId?: string }): void;
  openEvent(occ: Occurrence): void;
  openNewTask(opts?: { due?: number | null; dueHasTime?: boolean; calendarId?: string }): void;
  openTask(t: Task): void;
  openNewCalendar(): void;
  openCalendar(c: Calendar): void;
  closeEditor(): void;

  saveEvent(e: CalEvent): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  /** Guarda lo editado en el editor (pregunta el alcance si es una repetición). */
  saveFromEditor(draft: CalEvent): Promise<void>;
  deleteFromEditor(): Promise<void>;
  /** Mover/redimensionar arrastrando (pregunta el alcance si es una repetición). */
  moveOccurrence(occ: Occurrence, start: number, end: number): Promise<void>;
  askScope(action: "save" | "delete"): Promise<Scope | null>;
  openQuickAdd(open?: boolean): void;
  focusSearch(): void;
  openOccurrenceAt(occ: Occurrence): void;
  saveTask(t: Task): Promise<void>;
  toggleTask(t: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;
  saveCalendar(c: Calendar): Promise<void>;
  toggleCalendar(c: Calendar): Promise<void>;
  deleteCalendar(id: string): Promise<void>;
}

/** Cuántos días extra cargamos a cada lado de la vista para navegar sin parpadeos. */
const PAD_DAYS = 7;

function fail(set: (p: Partial<State>) => void, e: unknown) {
  console.error(e);
  set({ error: String(e) });
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  error: null,
  calendars: [],
  events: [],
  tasks: [],
  theme: "system",
  view: "week",
  cursor: Date.now(),
  editor: null,
  sidebarOpen: true,
  scopePrompt: null,
  quickAddOpen: false,
  searchFocus: 0,
  pendingIcs: null,
  welcome: false,

  async init() {
    try {
      const settings = await backend.getSettings();
      const view = settings.lastView as ViewMode | undefined;
      set({
        // (en pruebas automáticas no se enseña, salvo con ?welcome)
        welcome: (!settings.welcomed && !navigator.webdriver) || new URLSearchParams(location.search).has("welcome"),
        theme: (settings.theme as ThemePref) ?? "system",
        view: view && ["day", "week", "month", "year"].includes(view) ? view : "week",
      });
      await get().reload();
      set({ ready: true });
      await backend.onChange((kind) => void get().reload(kind));
      // Doble clic en el widget o bandeja → abrir en un día / añadir rápido.
      await backend.onNavigate((day) => {
        set({ editor: null, view: "day" });
        get().setCursor(day);
      });
      await backend.onQuickAdd(() => get().openQuickAdd(true));
      // .ics abierto con doble clic: al arrancar o con la app ya abierta.
      const takeIcs = async () => {
        const text = await backend.takePendingIcs();
        if (text) set({ pendingIcs: text, editor: null });
      };
      await takeIcs();
      await backend.onOpenIcs(() => void takeIcs());
    } catch (e) {
      fail(set, e);
    }
  },

  async reload(kind) {
    const { view, cursor } = get();
    const [from, to] = viewRange(view, cursor);
    try {
      if (!kind || kind === "settings") {
        const s = await backend.getSettings();
        set({ theme: (s.theme as ThemePref) ?? "system" });
      }
      if (!kind || kind === "calendars") set({ calendars: await backend.listCalendars() });
      if (!kind || kind === "events" || kind === "calendars")
        set({ events: await backend.listEvents(addDaysZ(from, -PAD_DAYS), addDaysZ(to, PAD_DAYS)) });
      if (!kind || kind === "tasks" || kind === "calendars") set({ tasks: await backend.listTasks() });
    } catch (e) {
      fail(set, e);
    }
  },

  setView(view) {
    set({ view });
    void backend.setSetting("lastView", view);
    void get().reload("events");
  },
  setCursor(cursor) {
    set({ cursor });
    void get().reload("events");
  },
  goToday() {
    get().setCursor(Date.now());
  },
  step(dir) {
    const { view, cursor } = get();
    get().setCursor(stepCursor(view, cursor, dir));
  },
  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  },
  async setTheme(theme) {
    set({ theme });
    await backend.setSetting("theme", theme);
  },

  openNewEvent(opts = {}) {
    const { calendars, cursor } = get();
    const firstVisible = calendars.find((c) => c.visible) ?? calendars[0];
    let start = opts.start;
    if (start == null) {
      // Por defecto: la próxima hora en punto del día seleccionado.
      const now = Date.now();
      const base = startOfDayZ(cursor) === startOfDayZ(now) ? now : startOfDayZ(cursor) + 9 * 3600_000;
      start = Math.ceil(base / 3600_000) * 3600_000;
    }
    const allDay = opts.allDay ?? false;
    const end = opts.end ?? (allDay ? addDaysZ(startOfDayZ(start), 1) : start + DEFAULT_EVENT_MINUTES * 60_000);
    const now = Date.now();
    set({
      editor: {
        kind: "event",
        isNew: true,
        event: {
          id: newId(),
          calendarId: opts.calendarId ?? firstVisible?.id ?? "",
          title: "",
          location: "",
          notes: "",
          allDay,
          start: allDay ? startOfDayZ(start) : start,
          end,
          rrule: null,
          exdates: [],
          seriesId: null,
          recurrenceId: null,
          alerts: allDay ? [] : [15],
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  },
  openEvent(occ) {
    if (occ.event.rrule) {
      // Repetición de una serie: el formulario muestra las fechas de esta repetición.
      set({ editor: { kind: "event", isNew: false, event: { ...occ.event, start: occ.start, end: occ.end }, master: occ.event, occStart: occ.start } });
    } else set({ editor: { kind: "event", isNew: false, event: { ...occ.event } } });
  },
  openOccurrenceAt(occ) {
    set({ cursor: occ.start });
    void get().reload("events");
    get().openEvent(occ);
  },
  openNewTask(opts = {}) {
    const { calendars } = get();
    const now = Date.now();
    set({
      editor: {
        kind: "task",
        isNew: true,
        task: {
          id: newId(),
          calendarId: opts.calendarId ?? (calendars.find((c) => c.visible) ?? calendars[0])?.id ?? "",
          title: "",
          notes: "",
          due: opts.due === undefined ? startOfDayZ(get().cursor) : opts.due,
          dueHasTime: opts.dueHasTime ?? false,
          priority: 0,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  },
  openTask(task) {
    set({ editor: { kind: "task", isNew: false, task: { ...task } } });
  },
  openNewCalendar() {
    const { calendars } = get();
    set({
      editor: {
        kind: "calendar",
        isNew: true,
        calendar: {
          id: newId(),
          name: "",
          color: "#AF52DE",
          visible: true,
          sortOrder: Math.max(-1, ...calendars.map((c) => c.sortOrder)) + 1,
        },
      },
    });
  },
  openCalendar(calendar) {
    set({ editor: { kind: "calendar", isNew: false, calendar: { ...calendar } } });
  },
  closeEditor() {
    set({ editor: null });
  },

  async saveEvent(e) {
    try {
      await backend.saveEvent({ ...e, updatedAt: Date.now() });
      set({ editor: null });
      await get().reload("events");
    } catch (err) {
      fail(set, err);
    }
  },
  askScope(action) {
    return new Promise((resolve) =>
      set({
        scopePrompt: {
          action,
          resolve: (scope) => {
            set({ scopePrompt: null });
            resolve(scope);
          },
        },
      }),
    );
  },
  async saveFromEditor(draft) {
    const ed = get().editor;
    if (ed?.kind !== "event" || !ed.master || ed.occStart == null) return get().saveEvent(draft);
    const scope = await get().askScope("save");
    if (!scope) return;
    await applyOps(editOccurrence(ed.master, ed.occStart, draft, scope, newId), set, get);
  },
  async deleteFromEditor() {
    const ed = get().editor;
    if (ed?.kind !== "event") return;
    if (!ed.master || ed.occStart == null) return get().deleteEvent(ed.event.id);
    const scope = await get().askScope("delete");
    if (!scope) return;
    await applyOps(deleteOccurrence(ed.master, ed.occStart, scope), set, get);
  },
  async moveOccurrence(occ, start, end) {
    if (!occ.event.rrule) return get().saveEvent({ ...occ.event, start, end });
    const scope = await get().askScope("save");
    if (!scope) return;
    const draft = { ...occ.event, start, end, rrule: shiftWeekday(occ.event, occ.start, start) };
    await applyOps(editOccurrence(occ.event, occ.start, draft, scope, newId), set, get);
  },
  openQuickAdd(open = true) {
    set({ quickAddOpen: open });
  },
  focusSearch() {
    set((s) => ({ searchFocus: s.searchFocus + 1 }));
  },
  async deleteEvent(id) {
    try {
      await backend.deleteEvent(id);
      set({ editor: null });
      await get().reload("events");
    } catch (err) {
      fail(set, err);
    }
  },
  async saveTask(t) {
    try {
      await backend.saveTask({ ...t, updatedAt: Date.now() });
      set({ editor: null });
      await get().reload("tasks");
    } catch (err) {
      fail(set, err);
    }
  },
  async toggleTask(t) {
    const updated = { ...t, completedAt: t.completedAt ? null : Date.now(), updatedAt: Date.now() };
    // Optimista: el check responde al instante.
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === t.id ? updated : x)) }));
    try {
      await backend.saveTask(updated);
    } catch (err) {
      fail(set, err);
      await get().reload("tasks");
    }
  },
  async deleteTask(id) {
    try {
      await backend.deleteTask(id);
      set({ editor: null });
      await get().reload("tasks");
    } catch (err) {
      fail(set, err);
    }
  },
  async saveCalendar(c) {
    try {
      await backend.saveCalendar(c);
      set({ editor: null });
      await get().reload("calendars");
    } catch (err) {
      fail(set, err);
    }
  },
  async toggleCalendar(c) {
    const updated = { ...c, visible: !c.visible };
    set((s) => ({ calendars: s.calendars.map((x) => (x.id === c.id ? updated : x)) }));
    try {
      await backend.saveCalendar(updated);
    } catch (err) {
      fail(set, err);
    }
  },
  async deleteCalendar(id) {
    try {
      await backend.deleteCalendar(id);
      set({ editor: null });
      await get().reload();
    } catch (err) {
      fail(set, err);
    }
  },
}));

async function applyOps(ops: SeriesOps, set: (p: Partial<State>) => void, get: () => State) {
  try {
    if (ops.deleteExceptionsFrom) await backend.deleteExceptionsFrom(ops.deleteExceptionsFrom.seriesId, ops.deleteExceptionsFrom.from);
    for (const e of ops.save) await backend.saveEvent({ ...e, updatedAt: Date.now() });
    for (const id of ops.delete) await backend.deleteEvent(id);
    set({ editor: null });
    await get().reload("events");
  } catch (err) {
    fail(set, err);
  }
}

