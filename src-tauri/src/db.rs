//! Persistencia en SQLite. Es la única fuente de verdad: las ventanas solo hablan con estos comandos.

use crate::models::{CalEvent, Calendar, Task};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;
use std::path::Path;

pub type DbResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Cada entrada es una migración; se aplican en orden y se apunta la versión en `user_version`.
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE calendars (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    visible     INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE events (
    id             TEXT PRIMARY KEY,
    calendar_id    TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    location       TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    all_day        INTEGER NOT NULL DEFAULT 0,
    start_ts       INTEGER NOT NULL,
    end_ts         INTEGER NOT NULL,
    rrule          TEXT,
    exdates        TEXT NOT NULL DEFAULT '[]',
    series_id      TEXT REFERENCES events(id) ON DELETE CASCADE,
    recurrence_id  INTEGER,
    alerts         TEXT NOT NULL DEFAULT '[]',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);
CREATE INDEX events_range ON events(start_ts, end_ts);
CREATE INDEX events_series ON events(series_id);
CREATE TABLE tasks (
    id            TEXT PRIMARY KEY,
    calendar_id   TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',
    due_ts        INTEGER,
    due_has_time  INTEGER NOT NULL DEFAULT 0,
    priority      INTEGER NOT NULL DEFAULT 0,
    completed_at  INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);
CREATE INDEX tasks_due ON tasks(due_ts);
CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
INSERT INTO calendars (id, name, color, visible, sort_order) VALUES
    ('cal-uni', 'Uni', '#007AFF', 1, 0),
    ('cal-trabajo', 'Trabajo', '#FF9500', 1, 1),
    ('cal-personal', 'Personal', '#34C759', 1, 2);
"#];

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> DbResult<Self> {
        Self::init(Connection::open(path).map_err(err)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> DbResult<Self> {
        Self::init(Connection::open_in_memory().map_err(err)?)
    }

    fn init(conn: Connection) -> DbResult<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(err)?;
        let mut db = Db { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&mut self) -> DbResult<()> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(err)?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            let tx = self.conn.transaction().map_err(err)?;
            tx.execute_batch(sql).map_err(err)?;
            tx.pragma_update(None, "user_version", (i + 1) as i64).map_err(err)?;
            tx.commit().map_err(err)?;
        }
        Ok(())
    }

    // ---------- Calendarios ----------

    pub fn list_calendars(&self) -> DbResult<Vec<Calendar>> {
        let mut st = self
            .conn
            .prepare("SELECT id, name, color, visible, sort_order FROM calendars ORDER BY sort_order, name")
            .map_err(err)?;
        let rows = st
            .query_map([], |r| {
                Ok(Calendar {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    visible: r.get(3)?,
                    sort_order: r.get(4)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn save_calendar(&self, c: &Calendar) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO calendars (id, name, color, visible, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET name = ?2, color = ?3, visible = ?4, sort_order = ?5",
                params![c.id, c.name, c.color, c.visible, c.sort_order],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn delete_calendar(&self, id: &str) -> DbResult<()> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM calendars", [], |r| r.get(0))
            .map_err(err)?;
        if count <= 1 {
            return Err("No se puede borrar el último calendario".into());
        }
        self.conn
            .execute("DELETE FROM calendars WHERE id = ?1", [id])
            .map_err(err)?;
        Ok(())
    }

    // ---------- Eventos ----------

    const EVENT_COLS: &'static str = "id, calendar_id, title, location, notes, all_day, start_ts, end_ts, \
         rrule, exdates, series_id, recurrence_id, alerts, created_at, updated_at";

    fn row_to_event(r: &Row) -> rusqlite::Result<CalEvent> {
        let exdates: String = r.get(9)?;
        let alerts: String = r.get(12)?;
        Ok(CalEvent {
            id: r.get(0)?,
            calendar_id: r.get(1)?,
            title: r.get(2)?,
            location: r.get(3)?,
            notes: r.get(4)?,
            all_day: r.get(5)?,
            start: r.get(6)?,
            end: r.get(7)?,
            rrule: r.get(8)?,
            exdates: serde_json::from_str(&exdates).unwrap_or_default(),
            series_id: r.get(10)?,
            recurrence_id: r.get(11)?,
            alerts: serde_json::from_str(&alerts).unwrap_or_default(),
            created_at: r.get(13)?,
            updated_at: r.get(14)?,
        })
    }

    /// Eventos sueltos que solapan [from, to) y todas las series que empiezan antes de `to`
    /// (la expansión de repeticiones se hace en el frontend).
    pub fn list_events(&self, from: i64, to: i64) -> DbResult<Vec<CalEvent>> {
        let sql = format!(
            "SELECT {} FROM events
             WHERE (rrule IS NULL AND start_ts < ?2 AND end_ts > ?1)
                OR (rrule IS NOT NULL AND start_ts < ?2)
             ORDER BY start_ts",
            Self::EVENT_COLS
        );
        let mut st = self.conn.prepare(&sql).map_err(err)?;
        let rows = st.query_map(params![from, to], Self::row_to_event).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn all_events(&self) -> DbResult<Vec<CalEvent>> {
        let sql = format!("SELECT {} FROM events ORDER BY start_ts", Self::EVENT_COLS);
        let mut st = self.conn.prepare(&sql).map_err(err)?;
        let rows = st.query_map([], Self::row_to_event).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn get_event(&self, id: &str) -> DbResult<Option<CalEvent>> {
        let sql = format!("SELECT {} FROM events WHERE id = ?1", Self::EVENT_COLS);
        self.conn
            .query_row(&sql, [id], Self::row_to_event)
            .optional()
            .map_err(err)
    }

    pub fn save_event(&self, e: &CalEvent) -> DbResult<()> {
        if e.end < e.start {
            return Err("El evento termina antes de empezar".into());
        }
        let exdates = serde_json::to_string(&e.exdates).map_err(err)?;
        let alerts = serde_json::to_string(&e.alerts).map_err(err)?;
        self.conn
            .execute(
                "INSERT INTO events (id, calendar_id, title, location, notes, all_day, start_ts, end_ts,
                    rrule, exdates, series_id, recurrence_id, alerts, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                 ON CONFLICT(id) DO UPDATE SET calendar_id = ?2, title = ?3, location = ?4, notes = ?5,
                    all_day = ?6, start_ts = ?7, end_ts = ?8, rrule = ?9, exdates = ?10, series_id = ?11,
                    recurrence_id = ?12, alerts = ?13, updated_at = ?15",
                params![
                    e.id, e.calendar_id, e.title, e.location, e.notes, e.all_day, e.start, e.end, e.rrule,
                    exdates, e.series_id, e.recurrence_id, alerts, e.created_at, e.updated_at
                ],
            )
            .map_err(err)?;
        Ok(())
    }

    /// Borra las excepciones ("solo este") de una serie a partir de un instante.
    pub fn delete_exceptions_from(&self, series_id: &str, from: i64) -> DbResult<()> {
        self.conn
            .execute(
                "DELETE FROM events WHERE series_id = ?1 AND recurrence_id >= ?2",
                params![series_id, from],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn delete_event(&self, id: &str) -> DbResult<()> {
        // ON DELETE CASCADE en series_id borra también las excepciones de la serie.
        self.conn
            .execute("DELETE FROM events WHERE id = ?1", [id])
            .map_err(err)?;
        Ok(())
    }

    /// Guarda muchos calendarios, eventos y tareas de golpe (importación) en una transacción.
    pub fn save_bulk(&self, calendars: &[Calendar], events: &[CalEvent], tasks: &[Task]) -> DbResult<()> {
        self.conn.execute_batch("BEGIN").map_err(err)?;
        let result = (|| {
            for c in calendars {
                self.save_calendar(c)?;
            }
            // Primero las series y después sus excepciones (clave foránea series_id).
            let (singles, exceptions): (Vec<_>, Vec<_>) = events.iter().partition(|e| e.series_id.is_none());
            for e in singles.into_iter().chain(exceptions) {
                self.save_event(e)?;
            }
            for t in tasks {
                self.save_task(t)?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => self.conn.execute_batch("COMMIT").map_err(err),
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    // ---------- Tareas ----------

    pub fn list_tasks(&self) -> DbResult<Vec<Task>> {
        let mut st = self
            .conn
            .prepare(
                "SELECT id, calendar_id, title, notes, due_ts, due_has_time, priority, completed_at,
                        created_at, updated_at
                 FROM tasks ORDER BY due_ts IS NULL, due_ts, priority DESC, created_at",
            )
            .map_err(err)?;
        let rows = st
            .query_map([], |r| {
                Ok(Task {
                    id: r.get(0)?,
                    calendar_id: r.get(1)?,
                    title: r.get(2)?,
                    notes: r.get(3)?,
                    due: r.get(4)?,
                    due_has_time: r.get(5)?,
                    priority: r.get(6)?,
                    completed_at: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn save_task(&self, t: &Task) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO tasks (id, calendar_id, title, notes, due_ts, due_has_time, priority,
                    completed_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET calendar_id = ?2, title = ?3, notes = ?4, due_ts = ?5,
                    due_has_time = ?6, priority = ?7, completed_at = ?8, updated_at = ?10",
                params![
                    t.id, t.calendar_id, t.title, t.notes, t.due, t.due_has_time, t.priority,
                    t.completed_at, t.created_at, t.updated_at
                ],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn delete_task(&self, id: &str) -> DbResult<()> {
        self.conn
            .execute("DELETE FROM tasks WHERE id = ?1", [id])
            .map_err(err)?;
        Ok(())
    }

    // ---------- Ajustes (clave → JSON) ----------

    pub fn get_settings(&self) -> DbResult<HashMap<String, serde_json::Value>> {
        let mut st = self.conn.prepare("SELECT key, value FROM settings").map_err(err)?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?;
        let mut out = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(err)?;
            out.insert(k, serde_json::from_str(&v).unwrap_or(serde_json::Value::Null));
        }
        Ok(out)
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = ?2",
                params![key, value.to_string()],
            )
            .map_err(err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, start: i64, end: i64, rrule: Option<&str>) -> CalEvent {
        CalEvent {
            id: id.into(),
            calendar_id: "cal-uni".into(),
            title: id.into(),
            location: String::new(),
            notes: String::new(),
            all_day: false,
            start,
            end,
            rrule: rrule.map(Into::into),
            exdates: vec![],
            series_id: None,
            recurrence_id: None,
            alerts: vec![15],
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn crea_calendarios_por_defecto() {
        let db = Db::open_in_memory().unwrap();
        let names: Vec<_> = db.list_calendars().unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["Uni", "Trabajo", "Personal"]);
    }

    #[test]
    fn guarda_y_actualiza_eventos() {
        let db = Db::open_in_memory().unwrap();
        let mut e = ev("a", 100, 200, None);
        db.save_event(&e).unwrap();
        e.title = "Cambiado".into();
        e.exdates = vec![5, 6];
        db.save_event(&e).unwrap();
        assert_eq!(db.get_event("a").unwrap().unwrap(), e);
    }

    #[test]
    fn rechaza_eventos_que_acaban_antes_de_empezar() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.save_event(&ev("a", 200, 100, None)).is_err());
    }

    #[test]
    fn filtra_por_rango_e_incluye_series() {
        let db = Db::open_in_memory().unwrap();
        db.save_event(&ev("dentro", 150, 250, None)).unwrap();
        db.save_event(&ev("antes", 0, 100, None)).unwrap();
        db.save_event(&ev("despues", 300, 400, None)).unwrap();
        db.save_event(&ev("serie", 0, 50, Some("FREQ=DAILY"))).unwrap();
        let ids: Vec<_> = db.list_events(100, 300).unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["serie", "dentro"]);
    }

    #[test]
    fn borrar_serie_borra_sus_excepciones() {
        let db = Db::open_in_memory().unwrap();
        db.save_event(&ev("serie", 0, 50, Some("FREQ=DAILY"))).unwrap();
        let mut ex = ev("excepcion", 10, 60, None);
        ex.series_id = Some("serie".into());
        db.save_event(&ex).unwrap();
        db.delete_event("serie").unwrap();
        assert!(db.all_events().unwrap().is_empty());
    }

    #[test]
    fn borra_excepciones_desde_una_fecha() {
        let db = Db::open_in_memory().unwrap();
        db.save_event(&ev("serie", 0, 50, Some("FREQ=DAILY"))).unwrap();
        for (id, rid) in [("ex1", 100), ("ex2", 200)] {
            let mut ex = ev(id, rid, rid + 10, None);
            ex.series_id = Some("serie".into());
            ex.recurrence_id = Some(rid);
            db.save_event(&ex).unwrap();
        }
        db.delete_exceptions_from("serie", 150).unwrap();
        let ids: Vec<_> = db.all_events().unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["serie", "ex1"]);
    }

    #[test]
    fn guardado_en_bloque_es_todo_o_nada() {
        let db = Db::open_in_memory().unwrap();
        let mut ex = ev("ex", 10, 20, None);
        ex.series_id = Some("serie".into());
        // La excepción va antes en la lista, pero se guarda después de su serie.
        db.save_bulk(&[], &[ex, ev("serie", 0, 50, Some("FREQ=DAILY"))], &[]).unwrap();
        assert_eq!(db.all_events().unwrap().len(), 2);
        // Un evento inválido deshace todo el bloque.
        assert!(db.save_bulk(&[], &[ev("ok", 0, 10, None), ev("mal", 10, 0, None)], &[]).is_err());
        assert_eq!(db.all_events().unwrap().len(), 2);
    }

    #[test]
    fn borrar_calendario_borra_su_contenido_pero_no_el_ultimo() {
        let db = Db::open_in_memory().unwrap();
        db.save_event(&ev("a", 0, 10, None)).unwrap();
        db.delete_calendar("cal-uni").unwrap();
        assert!(db.all_events().unwrap().is_empty());
        db.delete_calendar("cal-trabajo").unwrap();
        assert!(db.delete_calendar("cal-personal").is_err());
    }

    #[test]
    fn tareas_y_ajustes() {
        let db = Db::open_in_memory().unwrap();
        let t = Task {
            id: "t".into(),
            calendar_id: "cal-uni".into(),
            title: "Entrega".into(),
            notes: String::new(),
            due: Some(1000),
            due_has_time: true,
            priority: 3,
            completed_at: None,
            created_at: 0,
            updated_at: 0,
        };
        db.save_task(&t).unwrap();
        assert_eq!(db.list_tasks().unwrap(), vec![t]);
        db.set_setting("theme", &serde_json::json!("dark")).unwrap();
        assert_eq!(db.get_settings().unwrap()["theme"], serde_json::json!("dark"));
    }
}
