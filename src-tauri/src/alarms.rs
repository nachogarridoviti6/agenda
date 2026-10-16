//! Alertas: el frontend calcula las de las próximas horas (repeticiones incluidas) y las manda
//! aquí; un hilo las dispara con notificaciones nativas de Windows a su hora, aunque la ventana
//! principal esté oculta.

use serde::Deserialize;
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Clone, Deserialize)]
pub struct Alarm {
    pub id: String,
    pub at: i64,
    pub title: String,
    pub body: String,
}

#[derive(Default)]
pub struct AlarmState {
    pending: Mutex<Vec<Alarm>>,
    fired: Mutex<HashSet<String>>,
}

/// Margen para avisar de algo que debía sonar hace poco (p. ej. el PC estaba suspendido).
const GRACE_MS: i64 = 10 * 60 * 1000;

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn set(app: &AppHandle, alarms: Vec<Alarm>) {
    let state = app.state::<AlarmState>();
    *state.pending.lock().unwrap() = alarms;
}

/// Saca las alertas que toca disparar ahora y las marca como disparadas.
fn take_due(state: &AlarmState, now: i64) -> Vec<Alarm> {
    let pending = state.pending.lock().unwrap();
    let mut fired = state.fired.lock().unwrap();
    let due: Vec<Alarm> = pending
        .iter()
        .filter(|a| a.at <= now && a.at > now - GRACE_MS && !fired.contains(&a.id))
        .cloned()
        .collect();
    for a in &due {
        fired.insert(a.id.clone());
    }
    if fired.len() > 5000 {
        fired.clear();
        fired.extend(due.iter().map(|a| a.id.clone()));
    }
    due
}

pub fn start(app: &AppHandle) {
    app.manage(AlarmState::default());
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let state = app.state::<AlarmState>();
        for a in take_due(&state, now_ms()) {
            let _ = app.notification().builder().title(&a.title).body(&a.body).show();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alarm(id: &str, at: i64) -> Alarm {
        Alarm { id: id.into(), at, title: id.into(), body: String::new() }
    }

    #[test]
    fn dispara_cada_alerta_una_sola_vez_y_solo_a_su_hora() {
        let state = AlarmState::default();
        *state.pending.lock().unwrap() = vec![alarm("a", 1_000_000), alarm("b", 2_000_000), alarm("vieja", 1_000)];
        assert!(take_due(&state, 999_999).is_empty());
        let ids: Vec<_> = take_due(&state, 1_000_500).into_iter().map(|a| a.id).collect();
        assert_eq!(ids, ["a"]);
        assert!(take_due(&state, 1_000_600).is_empty());
        // Si el frontend vuelve a mandar la misma alerta, no se repite.
        *state.pending.lock().unwrap() = vec![alarm("a", 1_000_000), alarm("b", 2_000_000)];
        let ids: Vec<_> = take_due(&state, 2_000_000).into_iter().map(|a| a.id).collect();
        assert_eq!(ids, ["b"]);
    }
}
