import { describeRule, endOfDayZ, type Freq, type Rule, WEEKDAYS } from "../lib/rrule";
import { dayKey, parseDayKey, z, addDaysZ } from "../lib/dates";
import { Row } from "./fields";
import { DateInput } from "./DateTimeInputs";

type Preset = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

const DOW_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
const DOW_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const ORD = ["primer", "segundo", "tercer", "cuarto", "quinto"];

function presetOf(rule: Rule | null): Preset {
  if (!rule) return "none";
  const plain = !rule.byMonthDay.length;
  if (rule.freq === "DAILY" && rule.interval === 1) return "daily";
  if (rule.freq === "WEEKLY" && rule.interval === 1) return "weekly";
  if (rule.freq === "WEEKLY" && rule.interval === 2) return "biweekly";
  if (rule.freq === "MONTHLY" && rule.interval === 1 && plain) return "monthly";
  if (rule.freq === "YEARLY" && rule.interval === 1) return "yearly";
  return "custom";
}

const base = (freq: Freq, interval = 1): Rule => ({ freq, interval, byDay: [], byMonthDay: [], until: null, count: null });

/** Editor de "Repetir" y "Termina" del formulario de evento. */
export function RepeatEditor({ rule, start, onChange }: { rule: Rule | null; start: number; onChange(r: Rule | null): void }) {
  const preset = presetOf(rule);
  const zs = z(start);
  const dow = (zs.getDay() + 6) % 7;
  const dom = zs.getDate();
  const nth = Math.ceil(dom / 7);
  const isLastWeek = dom + 7 > new Date(zs.getFullYear(), zs.getMonth() + 1, 0).getDate();

  const setPreset = (p: Preset) => {
    const keep = (r: Rule) => (rule ? { ...r, until: rule.until, count: rule.count } : r);
    switch (p) {
      case "none": return onChange(null);
      case "daily": return onChange(keep(base("DAILY")));
      case "weekly": return onChange(keep({ ...base("WEEKLY"), byDay: [WEEKDAYS[dow]] }));
      case "biweekly": return onChange(keep({ ...base("WEEKLY", 2), byDay: [WEEKDAYS[dow]] }));
      case "monthly": return onChange(keep(base("MONTHLY")));
      case "yearly": return onChange(keep(base("YEARLY")));
      case "custom": return onChange(rule ? { ...rule } : { ...base("WEEKLY"), byDay: [WEEKDAYS[dow]] });
    }
  };

  const toggleDay = (i: number) => {
    if (!rule) return;
    const cur = rule.byDay.length ? rule.byDay : [WEEKDAYS[dow]];
    const next = cur.includes(WEEKDAYS[i]) ? cur.filter((d) => d !== WEEKDAYS[i]) : [...cur, WEEKDAYS[i]];
    if (!next.length) return;
    onChange({ ...rule, byDay: WEEKDAYS.filter((d) => next.includes(d)) });
  };

  const endMode = !rule ? "never" : rule.until != null ? "until" : rule.count != null ? "count" : "never";

  return (
    <>
      <Row label="Repetir">
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label="Repetir">
          <option value="none">Nunca</option>
          <option value="daily">Cada día</option>
          <option value="weekly">Cada semana</option>
          <option value="biweekly">Cada 2 semanas</option>
          <option value="monthly">Cada mes</option>
          <option value="yearly">Cada año</option>
          <option value="custom">Personalizado…</option>
        </select>
      </Row>
      {rule && preset === "custom" && (
        <Row label="Cada">
          <input
            type="number"
            min={1}
            max={99}
            className="num-input"
            value={rule.interval}
            onChange={(e) => onChange({ ...rule, interval: Math.max(1, Number(e.target.value) || 1) })}
            aria-label="Intervalo"
          />
          <select value={rule.freq} onChange={(e) => onChange({ ...base(e.target.value as Freq, rule.interval), until: rule.until, count: rule.count, byDay: e.target.value === "WEEKLY" ? [WEEKDAYS[dow]] : [] })} aria-label="Unidad">
            <option value="DAILY">{rule.interval === 1 ? "día" : "días"}</option>
            <option value="WEEKLY">{rule.interval === 1 ? "semana" : "semanas"}</option>
            <option value="MONTHLY">{rule.interval === 1 ? "mes" : "meses"}</option>
            <option value="YEARLY">{rule.interval === 1 ? "año" : "años"}</option>
          </select>
        </Row>
      )}
      {rule?.freq === "WEEKLY" && (
        <Row label="Los días">
          <div className="dow-picker">
            {DOW_SHORT.map((d, i) => {
              const on = (rule.byDay.length ? rule.byDay : [WEEKDAYS[dow]]).includes(WEEKDAYS[i]);
              return (
                <button type="button" key={d} className={on ? "is-on" : ""} onClick={() => toggleDay(i)} aria-pressed={on} aria-label={DOW_LONG[i]} title={DOW_LONG[i]}>
                  {d}
                </button>
              );
            })}
          </div>
        </Row>
      )}
      {rule?.freq === "MONTHLY" && (
        <Row label="El">
          <select
            value={rule.byDay[0] ?? "day"}
            onChange={(e) => onChange({ ...rule, byDay: e.target.value === "day" ? [] : [e.target.value], byMonthDay: [] })}
            aria-label="Día del mes"
          >
            <option value="day">día {dom}</option>
            {nth <= 4 && <option value={`${nth}${WEEKDAYS[dow]}`}>{ORD[nth - 1]} {DOW_LONG[dow]}</option>}
            {isLastWeek && <option value={`-1${WEEKDAYS[dow]}`}>último {DOW_LONG[dow]}</option>}
          </select>
        </Row>
      )}
      {rule && (
        <Row label="Termina">
          <select
            value={endMode}
            onChange={(e) => {
              const m = e.target.value;
              if (m === "never") onChange({ ...rule, until: null, count: null });
              if (m === "until") onChange({ ...rule, count: null, until: endOfDayZ(addDaysZ(start, 30)) });
              if (m === "count") onChange({ ...rule, until: null, count: 10 });
            }}
            aria-label="Termina"
          >
            <option value="never">Nunca</option>
            <option value="until">El día…</option>
            <option value="count">Tras…</option>
          </select>
          {endMode === "until" && (
            <DateInput label="Fecha de fin" value={dayKey(rule.until!)} onChange={(v) => onChange({ ...rule, until: endOfDayZ(parseDayKey(v)) })} />
          )}
          {endMode === "count" && (
            <>
              <input type="number" min={1} max={999} className="num-input" value={rule.count ?? 1} onChange={(e) => onChange({ ...rule, count: Math.max(1, Number(e.target.value) || 1) })} aria-label="Número de veces" />
              <span className="f-muted">veces</span>
            </>
          )}
        </Row>
      )}
      {rule && <div className="f-note">{describeRule(rule, start)}</div>}
    </>
  );
}
