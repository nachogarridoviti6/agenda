/**
 * Festivos de España: nacionales y de cada comunidad autónoma.
 * Fijos + los que dependen de la Semana Santa (cálculo de la fecha de Pascua).
 * Los traslados cuando un festivo cae en domingo los decide cada comunidad cada año (BOE/boletín
 * autonómico), así que no se aplican: la interfaz avisa de que conviene revisarlos.
 */
import { addDaysZ, fromLocal } from "./dates";

export interface Holiday {
  /** "2026-10-12" */
  date: string;
  name: string;
  scope: "nacional" | "autonómico";
}

/** Domingo de Pascua (algoritmo anónimo gregoriano). Devuelve [mes (1-12), día]. */
export function easterSunday(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

type Rule = { md: string; name: string } | { easter: number; name: string };

const NATIONAL: Rule[] = [
  { md: "01-01", name: "Año Nuevo" },
  { md: "01-06", name: "Epifanía del Señor (Reyes)" },
  { easter: -2, name: "Viernes Santo" },
  { md: "05-01", name: "Fiesta del Trabajo" },
  { md: "08-15", name: "Asunción de la Virgen" },
  { md: "10-12", name: "Fiesta Nacional de España" },
  { md: "11-01", name: "Todos los Santos" },
  { md: "12-06", name: "Día de la Constitución" },
  { md: "12-08", name: "Inmaculada Concepción" },
  { md: "12-25", name: "Navidad" },
];

const JUEVES_SANTO: Rule = { easter: -3, name: "Jueves Santo" };
const LUNES_PASCUA: Rule = { easter: 1, name: "Lunes de Pascua" };

/** Festivos autonómicos habituales (los que se repiten cada año). */
export const REGIONS: Record<string, { name: string; rules: Rule[] }> = {
  AN: { name: "Andalucía", rules: [JUEVES_SANTO, { md: "02-28", name: "Día de Andalucía" }] },
  AR: { name: "Aragón", rules: [JUEVES_SANTO, { md: "04-23", name: "San Jorge (Día de Aragón)" }] },
  AS: { name: "Asturias", rules: [JUEVES_SANTO, { md: "09-08", name: "Día de Asturias" }] },
  IB: { name: "Islas Baleares", rules: [JUEVES_SANTO, LUNES_PASCUA, { md: "03-01", name: "Día de las Illes Balears" }] },
  CN: { name: "Canarias", rules: [JUEVES_SANTO, { md: "05-30", name: "Día de Canarias" }] },
  CB: { name: "Cantabria", rules: [JUEVES_SANTO, { md: "07-28", name: "Día de las Instituciones de Cantabria" }] },
  CM: { name: "Castilla-La Mancha", rules: [JUEVES_SANTO, { md: "05-31", name: "Día de Castilla-La Mancha" }] },
  CL: { name: "Castilla y León", rules: [JUEVES_SANTO, { md: "04-23", name: "Día de Castilla y León" }] },
  CT: { name: "Cataluña", rules: [LUNES_PASCUA, { md: "06-24", name: "Sant Joan" }, { md: "09-11", name: "Diada Nacional de Catalunya" }, { md: "12-26", name: "Sant Esteve" }] },
  EX: { name: "Extremadura", rules: [JUEVES_SANTO, { md: "09-08", name: "Día de Extremadura" }] },
  GA: { name: "Galicia", rules: [JUEVES_SANTO, { md: "05-17", name: "Día de las Letras Gallegas" }, { md: "07-25", name: "Día Nacional de Galicia" }] },
  MD: { name: "Comunidad de Madrid", rules: [JUEVES_SANTO, { md: "05-02", name: "Fiesta de la Comunidad de Madrid" }] },
  MC: { name: "Región de Murcia", rules: [JUEVES_SANTO, { md: "06-09", name: "Día de la Región de Murcia" }] },
  NC: { name: "Navarra", rules: [JUEVES_SANTO, LUNES_PASCUA, { md: "12-03", name: "San Francisco Javier" }] },
  PV: { name: "País Vasco", rules: [JUEVES_SANTO, LUNES_PASCUA] },
  RI: { name: "La Rioja", rules: [JUEVES_SANTO, { md: "06-09", name: "Día de La Rioja" }] },
  VC: { name: "Comunidad Valenciana", rules: [LUNES_PASCUA, { md: "03-19", name: "San José" }, { md: "10-09", name: "Día de la Comunidad Valenciana" }] },
  CE: { name: "Ceuta", rules: [JUEVES_SANTO, { md: "09-02", name: "Día de Ceuta" }] },
  ML: { name: "Melilla", rules: [JUEVES_SANTO, { md: "09-17", name: "Día de Melilla" }] },
};

function resolve(rule: Rule, year: number): string {
  if ("md" in rule) return `${year}-${rule.md}`;
  const [m, d] = easterSunday(year);
  const ms = addDaysZ(fromLocal(year, m - 1, d), rule.easter);
  const dt = new Date(ms + 12 * 3600_000); // mediodía para evitar problemas de zona
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Festivos del año para una comunidad (o solo nacionales con region = null), ordenados. */
export function holidaysFor(year: number, region: string | null): Holiday[] {
  const out = new Map<string, Holiday>();
  for (const r of NATIONAL) out.set(resolve(r, year), { date: resolve(r, year), name: r.name, scope: "nacional" });
  for (const r of (region && REGIONS[region]?.rules) || []) {
    const date = resolve(r, year);
    if (!out.has(date)) out.set(date, { date, name: r.name, scope: "autonómico" });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}
