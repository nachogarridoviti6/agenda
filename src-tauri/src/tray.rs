//! Icono de la bandeja del sistema.

use crate::{show_main, widget};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub struct TrayState {
    pub widget_item: CheckMenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir Agenda", true, None::<&str>)?;
    let widget_item = CheckMenuItem::with_id(app, "widget", "Mostrar widget", true, widget::load_config(app).visible, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Añadir rápido…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &widget_item, &quick, &sep, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("falta el icono de la app"))
        .tooltip("Agenda")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app, None),
            "widget" => {
                let mut cfg = widget::load_config(app);
                cfg.visible = !cfg.visible;
                let _ = widget::save_config(app, &cfg);
                let _ = widget::apply(app);
                sync_widget_item(app);
            }
            "quick" => {
                show_main(app, None);
                let _ = app.emit_to("main", "quick-add", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle(), None);
            }
        })
        .build(app)?;

    app.manage(TrayState { widget_item });
    Ok(())
}

/// Mantiene la marca "Mostrar widget" del menú igual que la configuración.
pub fn sync_widget_item(app: &AppHandle) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.widget_item.set_checked(widget::load_config(app).visible);
    }
}
