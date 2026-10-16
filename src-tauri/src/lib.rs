mod db;
mod models;

use db::Db;
use models::{CalEvent, Calendar, Task};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    db: Mutex<Db>,
}

type CmdResult<T> = Result<T, String>;

/// Avisa a todas las ventanas (app principal y widget) de que algo ha cambiado.
fn changed(app: &AppHandle, kind: &str) {
    let _ = app.emit("data-changed", kind);
}

fn with_db<T>(state: &State<AppState>, f: impl FnOnce(&Db) -> CmdResult<T>) -> CmdResult<T> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    f(&db)
}

#[tauri::command]
fn list_calendars(state: State<AppState>) -> CmdResult<Vec<Calendar>> {
    with_db(&state, |db| db.list_calendars())
}

#[tauri::command]
fn save_calendar(app: AppHandle, state: State<AppState>, calendar: Calendar) -> CmdResult<()> {
    with_db(&state, |db| db.save_calendar(&calendar))?;
    changed(&app, "calendars");
    Ok(())
}

#[tauri::command]
fn delete_calendar(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_calendar(&id))?;
    changed(&app, "calendars");
    Ok(())
}

#[tauri::command]
fn list_events(state: State<AppState>, from: i64, to: i64) -> CmdResult<Vec<CalEvent>> {
    with_db(&state, |db| db.list_events(from, to))
}

#[tauri::command]
fn get_event(state: State<AppState>, id: String) -> CmdResult<Option<CalEvent>> {
    with_db(&state, |db| db.get_event(&id))
}

#[tauri::command]
fn save_event(app: AppHandle, state: State<AppState>, event: CalEvent) -> CmdResult<()> {
    with_db(&state, |db| db.save_event(&event))?;
    changed(&app, "events");
    Ok(())
}

#[tauri::command]
fn delete_event(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_event(&id))?;
    changed(&app, "events");
    Ok(())
}

#[tauri::command]
fn list_tasks(state: State<AppState>) -> CmdResult<Vec<Task>> {
    with_db(&state, |db| db.list_tasks())
}

#[tauri::command]
fn save_task(app: AppHandle, state: State<AppState>, task: Task) -> CmdResult<()> {
    with_db(&state, |db| db.save_task(&task))?;
    changed(&app, "tasks");
    Ok(())
}

#[tauri::command]
fn delete_task(app: AppHandle, state: State<AppState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_task(&id))?;
    changed(&app, "tasks");
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> CmdResult<HashMap<String, serde_json::Value>> {
    with_db(&state, |db| db.get_settings())
}

#[tauri::command]
fn set_setting(app: AppHandle, state: State<AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    with_db(&state, |db| db.set_setting(&key, &value))?;
    changed(&app, "settings");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Db::open(&dir.join("agenda.db"))?;
            app.manage(AppState { db: Mutex::new(db) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_calendars,
            save_calendar,
            delete_calendar,
            list_events,
            get_event,
            save_event,
            delete_event,
            list_tasks,
            save_task,
            delete_task,
            get_settings,
            set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Agenda");
}
