use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub location: String,
    pub notes: String,
    pub all_day: bool,
    /// UTC en milisegundos
    pub start: i64,
    pub end: i64,
    pub rrule: Option<String>,
    pub exdates: Vec<i64>,
    pub series_id: Option<String>,
    pub recurrence_id: Option<i64>,
    pub alerts: Vec<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub notes: String,
    pub due: Option<i64>,
    pub due_has_time: bool,
    pub priority: i64,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncLink {
    pub calendar_id: String,
    pub url: String,
    pub ctag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncItem {
    pub event_id: String,
    pub calendar_id: String,
    pub href: String,
    pub etag: String,
    pub uid: String,
    pub raw: String,
    pub synced_version: i64,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SyncState {
    pub links: Vec<SyncLink>,
    pub items: Vec<SyncItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncCommit {
    pub save_calendars: Vec<Calendar>,
    pub upsert_links: Vec<SyncLink>,
    pub delete_link_calendar_ids: Vec<String>,
    pub save_events: Vec<CalEvent>,
    pub delete_event_ids: Vec<String>,
    pub upsert_items: Vec<SyncItem>,
    pub delete_item_ids: Vec<String>,
}
