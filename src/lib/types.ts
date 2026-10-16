export type Id = string;

export interface Calendar {
  id: Id;
  name: string;
  color: string; // hex, p. ej. "#007AFF"
  visible: boolean;
  sortOrder: number;
}

/**
 * Evento tal y como se guarda.
 * - Con hora: `start`/`end` son instantes UTC en ms.
 * - Todo el día: `start` es la medianoche (Europe/Madrid) del primer día y `end`
 *   la medianoche del día siguiente al último (exclusivo), como en iCalendar.
 */
export interface CalEvent {
  id: Id;
  calendarId: Id;
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  start: number;
  end: number;
  /** Regla RRULE (RFC 5545) sin el prefijo "RRULE:", o null si no se repite. */
  rrule: string | null;
  /** Inicios (UTC ms) de las repeticiones eliminadas o sustituidas por una excepción. */
  exdates: number[];
  /** Para excepciones de una serie: id del evento maestro. */
  seriesId: Id | null;
  /** Para excepciones: inicio original (UTC ms) de la repetición que sustituye. */
  recurrenceId: number | null;
  /** Alertas, en minutos antes del inicio. */
  alerts: number[];
  createdAt: number;
  updatedAt: number;
}

export type Priority = 0 | 1 | 2 | 3; // ninguna, baja, media, alta

export interface Task {
  id: Id;
  calendarId: Id;
  title: string;
  notes: string;
  /** Fecha límite (UTC ms). Si `dueHasTime` es false, es la medianoche de ese día. */
  due: number | null;
  dueHasTime: boolean;
  priority: Priority;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Una aparición concreta de un evento en el calendario (las series se expanden). */
export interface Occurrence {
  key: string;
  event: CalEvent;
  start: number;
  end: number;
}

export type ViewMode = "day" | "week" | "month" | "year";
export type ThemePref = "system" | "light" | "dark";

export interface WidgetConfig {
  visible: boolean;
  monitor: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  positionSet: boolean;
  locked: boolean;
  acrylic: boolean;
  opacity: number;
  theme: ThemePref;
}

export interface MonitorInfo {
  name: string;
  label: string;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

export type Corner = "tl" | "tr" | "bl" | "br";
