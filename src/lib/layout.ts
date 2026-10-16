import type { Occurrence } from "./types";
import { addDaysZ, minutesIntoDay } from "./dates";

export interface PlacedEvent {
  occ: Occurrence;
  /** minutos desde la medianoche del día */
  top: number;
  /** duración visible en minutos (mínimo 15 para que se pueda leer y pulsar) */
  height: number;
  /** columna dentro del grupo solapado y número de columnas del grupo */
  col: number;
  cols: number;
}

const MIN_HEIGHT = 15;

/**
 * Coloca los eventos con hora de un día en columnas, como Apple Calendar:
 * los que se solapan se reparten el ancho; los que no, ocupan toda la columna.
 * Un evento que cruza la medianoche se recorta al día.
 */
export function layoutDay(occs: Occurrence[], dayStart: number): PlacedEvent[] {
  const dayEnd = addDaysZ(dayStart, 1);
  const items = occs
    .filter((o) => !o.event.allDay && o.start < dayEnd && o.end > dayStart)
    .map((o) => {
      const top = o.start <= dayStart ? 0 : minutesIntoDay(o.start, dayStart);
      const bottom = o.end >= dayEnd ? 1440 : minutesIntoDay(o.end, dayStart);
      return { occ: o, top, bottom: Math.max(bottom, top + MIN_HEIGHT) };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.occ.event.title.localeCompare(b.occ.event.title));

  const out: PlacedEvent[] = [];
  let group: { item: (typeof items)[number]; col: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;

  const flush = () => {
    const cols = colEnds.length;
    for (const g of group) {
      out.push({ occ: g.item.occ, top: g.item.top, height: g.item.bottom - g.item.top, col: g.col, cols });
    }
    group = [];
    colEnds = [];
  };

  for (const it of items) {
    if (it.top >= groupEnd && group.length) flush();
    let col = colEnds.findIndex((end) => end <= it.top);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.bottom);
    } else {
      colEnds[col] = it.bottom;
    }
    group.push({ item: it, col });
    groupEnd = Math.max(group.length === 1 ? 0 : groupEnd, it.bottom);
  }
  if (group.length) flush();
  return out;
}

/** Ordena para listas (vista mes, widget): primero todo el día, luego por hora. */
export function sortOccurrences(occs: Occurrence[]): Occurrence[] {
  return [...occs].sort(
    (a, b) =>
      Number(b.event.allDay) - Number(a.event.allDay) ||
      a.start - b.start ||
      a.end - b.end ||
      a.event.title.localeCompare(b.event.title),
  );
}

/** Apariciones que tocan el día que empieza en `dayStart`. */
export function occurrencesOnDay(occs: Occurrence[], dayStart: number): Occurrence[] {
  const dayEnd = addDaysZ(dayStart, 1);
  return occs.filter((o) => o.start < dayEnd && o.end > dayStart);
}

/** ¿Va en la franja "todo el día"? Los de todo el día y los que duran 24 h o más (como Apple). */
export const isAllDayLike = (o: Occurrence) => o.event.allDay || o.end - o.start >= 24 * 3600_000;

export interface SpanBar {
  occ: Occurrence;
  startCol: number;
  endCol: number; // inclusiva
  lane: number;
  /** El evento empezó antes / sigue después de lo visible (para redondear solo los extremos reales). */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Coloca barras que abarcan varios días en carriles sin solaparse (franja todo el día de la semana). */
export function layoutSpans(occs: Occurrence[], days: number[]): { bars: SpanBar[]; lanes: number } {
  const first = days[0];
  const last = days[days.length - 1];
  const end = addDaysZ(last, 1);
  const colOf = (ms: number) => {
    let col = 0;
    for (let i = 0; i < days.length; i++) if (days[i] <= ms) col = i;
    return col;
  };
  const items = occs
    .filter((o) => isAllDayLike(o) && o.start < end && o.end > first)
    .map((o) => ({
      occ: o,
      startCol: o.start <= first ? 0 : colOf(o.start),
      endCol: o.end >= end ? days.length - 1 : colOf(o.end - 1),
      clippedStart: o.start < first,
      clippedEnd: o.end > end,
    }))
    .sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));

  const laneEnds: number[] = [];
  const bars: SpanBar[] = items.map((it) => {
    let lane = laneEnds.findIndex((e) => e < it.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endCol);
    } else laneEnds[lane] = it.endCol;
    return { ...it, lane };
  });
  return { bars, lanes: laneEnds.length };
}
