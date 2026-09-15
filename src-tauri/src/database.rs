use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, Runtime, State};

const STATE_KEY: &str = "root";
const MAX_BACKUP_BYTES: usize = 64 * 1024 * 1024;
const MAX_HISTORY_DAYS: usize = 100_000;
const MAX_HISTORY_DAY_BYTES: usize = 256 * 1024;
const MAX_JSON_DEPTH: usize = 20;
const TRACKER_DUNGEON_IDS: &[&str] = &[
    "eternity-caves-low",
    "silver-citadel-normal",
    "silver-citadel-hard",
    "twilight-library",
    "celestial-palace",
    "dream-terrace-normal",
    "dream-terrace-hard",
    "dream-terrace-legendary",
    "eternity-caves-high",
    "full-moon-pavilion",
    "sea-of-illusions",
    "whispering-tomb",
    "elements-temple",
    "frozen-hell",
    "frozen-hell-15",
    "frozen-hell-19",
    "frozen-hell-21",
    "frozen-hell-23",
    "dawn-palace",
    "knights-island",
];
const LOOT_DUNGEON_IDS: &[&str] = &[
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17",
    "18", "19", "20",
];

pub struct Database {
    connection: Mutex<Connection>,
    data_dir: PathBuf,
}

struct ValidatedState {
    root_without_history: String,
    history: Vec<(String, String)>,
}

impl Database {
    pub fn open<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Не удалось определить папку данных: {error}"))?;

        fs::create_dir_all(&data_dir)
            .map_err(|error| format!("Не удалось создать папку данных: {error}"))?;

        migrate_legacy_database(&data_dir)?;
        let database_path = data_dir.join("castaryn.sqlite3");
        let connection = Connection::open(database_path)
            .map_err(|error| format!("Не удалось открыть локальную базу: {error}"))?;

        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("Не удалось настроить локальную базу: {error}"))?;

        connection
            .execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;
                PRAGMA synchronous = FULL;
                PRAGMA secure_delete = ON;

                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                CREATE TABLE IF NOT EXISTS history_days (
                    day_key TEXT PRIMARY KEY,
                    sort_order INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
                );

                CREATE INDEX IF NOT EXISTS history_days_order_idx
                    ON history_days(sort_order);

                INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
                INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
                ",
            )
            .map_err(|error| format!("Не удалось подготовить локальную базу: {error}"))?;

        Ok(Self {
            connection: Mutex::new(connection),
            data_dir,
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "Локальная база временно недоступна".to_string())
    }

    fn load_payload(&self) -> Result<Option<String>, String> {
        let connection = self.lock()?;
        load_combined_payload(&connection)
    }

    fn save_payload(&self, payload: &str) -> Result<(), String> {
        let validated = validate_and_split_state(payload)?;
        let mut connection = self.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("Не удалось начать сохранение: {error}"))?;
        save_validated_state(&transaction, validated)?;
        transaction
            .commit()
            .map_err(|error| format!("Не удалось завершить сохранение: {error}"))
    }

    fn write_automatic_backup(&self, payload: &str) -> Result<PathBuf, String> {
        let backups_dir = self.data_dir.join("backups");
        fs::create_dir_all(&backups_dir)
            .map_err(|error| format!("Не удалось создать резервную папку: {error}"))?;
        let timestamp = unix_timestamp()?;
        let path = backups_dir.join(format!("pre-import-{timestamp}.castaryn"));
        fs::write(&path, encode_backup(payload)?)
            .map_err(|error| format!("Не удалось создать копию перед импортом: {error}"))?;
        let mut backups = fs::read_dir(&backups_dir)
            .map_err(|error| format!("Не удалось проверить резервные копии: {error}"))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("pre-import-")
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|value| value == "castaryn" || value == "elyvo")
            })
            .collect::<Vec<_>>();
        backups.sort_by_key(|entry| entry.file_name());
        let remove_count = backups.len().saturating_sub(5);
        for entry in backups.into_iter().take(remove_count) {
            let _ = fs::remove_file(entry.path());
        }
        Ok(path)
    }
}

fn migrate_legacy_database(data_dir: &std::path::Path) -> Result<(), String> {
    let database_path = data_dir.join("castaryn.sqlite3");
    if database_path.exists() {
        return Ok(());
    }

    let current_legacy_path = data_dir.join("elyvo.sqlite3");
    let previous_app_path = data_dir
        .parent()
        .map(|parent| parent.join("com.elyvo.desktop").join("elyvo.sqlite3"));
    let legacy_path = if current_legacy_path.exists() {
        Some(current_legacy_path)
    } else {
        previous_app_path.filter(|path| path.exists())
    };

    let Some(legacy_path) = legacy_path else {
        return Ok(());
    };

    for suffix in ["", "-wal", "-shm"] {
        let source = PathBuf::from(format!("{}{suffix}", legacy_path.display()));
        if source.exists() {
            let target = PathBuf::from(format!("{}{suffix}", database_path.display()));
            fs::copy(&source, &target).map_err(|error| {
                format!("Не удалось перенести локальные данные Castaryn: {error}")
            })?;
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupEnvelope {
    format: String,
    version: u32,
    exported_at: u64,
    payload: Value,
}

fn validate_and_split_state(payload: &str) -> Result<ValidatedState, String> {
    if payload.len() > MAX_BACKUP_BYTES {
        return Err("Размер локальных данных превышает допустимый предел".to_string());
    }

    let mut root: Value =
        serde_json::from_str(payload).map_err(|_| "Некорректный формат локальных данных")?;
    validate_json_limits(&root, 0)?;

    let root_object = root
        .as_object_mut()
        .ok_or_else(|| "Корневое значение локальных данных должно быть объектом".to_string())?;
    let version = root_object
        .get("version")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Версия локальных данных не указана".to_string())?;
    if version == 0 || version > 100 {
        return Err("Версия локальных данных не поддерживается".to_string());
    }
    let state = root_object
        .get_mut("state")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Состояние Castaryn повреждено".to_string())?;
    validate_player_state(state)?;

    let history_value = state
        .remove("history")
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let history_array = history_value
        .as_array()
        .ok_or_else(|| "История Castaryn повреждена".to_string())?;
    if history_array.len() > MAX_HISTORY_DAYS {
        return Err("История Castaryn превышает допустимый предел".to_string());
    }

    let mut day_keys = HashSet::with_capacity(history_array.len());
    let mut history = Vec::with_capacity(history_array.len());
    for day in history_array {
        let day_object = day
            .as_object()
            .ok_or_else(|| "Запись истории повреждена".to_string())?;
        validate_history_day(day_object)?;
        let day_key = day_object
            .get("dayKey")
            .and_then(Value::as_str)
            .or_else(|| day_object.get("date").and_then(Value::as_str))
            .ok_or_else(|| "Дата истории не указана".to_string())?;
        if day_key.is_empty() || day_key.len() > 32 || !day_keys.insert(day_key.to_string()) {
            return Err("Дата истории некорректна или повторяется".to_string());
        }
        let encoded = serde_json::to_string(day).map_err(|_| "Запись истории повреждена")?;
        if encoded.len() > MAX_HISTORY_DAY_BYTES {
            return Err("Одна запись истории слишком большая".to_string());
        }
        history.push((day_key.to_string(), encoded));
    }

    state.insert("history".to_string(), Value::Array(Vec::new()));
    let root_without_history =
        serde_json::to_string(&root).map_err(|_| "Не удалось сохранить локальные данные")?;
    Ok(ValidatedState {
        root_without_history,
        history,
    })
}

fn validate_player_state(state: &Map<String, Value>) -> Result<(), String> {
    for required in [
        "onboardingCompleted",
        "playMode",
        "dayKey",
        "profile",
        "defaultPacks",
        "packs",
    ] {
        if !state.contains_key(required) {
            return Err(format!("В локальных данных отсутствует поле {required}"));
        }
    }
    if !state["onboardingCompleted"].is_boolean()
        || !state["dayKey"].is_string()
        || !state["profile"].is_object()
        || !state["defaultPacks"].is_array()
        || !state["packs"].is_array()
    {
        return Err("Типы полей локальных данных некорректны".to_string());
    }
    if !matches!(state["playMode"].as_str(), Some("single" | "multi")) {
        return Err("Режим игры в локальных данных некорректен".to_string());
    }
    let slot_count = if state["playMode"].as_str() == Some("single") {
        1
    } else {
        10
    };
    validate_day_key(
        state["dayKey"]
            .as_str()
            .ok_or_else(|| "Дата игрового дня повреждена".to_string())?,
    )?;
    let profile = state["profile"]
        .as_object()
        .ok_or_else(|| "Профиль повреждён".to_string())?;
    validate_string_field(profile, "name", 64)?;
    validate_string_field(profile, "server", 64)?;
    for packs_key in ["defaultPacks", "packs"] {
        let packs = state[packs_key]
            .as_array()
            .ok_or_else(|| "Список пачек повреждён".to_string())?;
        if packs.len() > 20 {
            return Err("Количество пачек превышает допустимый предел".to_string());
        }
        let mut pack_ids = std::collections::HashSet::new();
        for pack in packs {
            let object = pack
                .as_object()
                .ok_or_else(|| "Пачка повреждена".to_string())?;
            validate_string_field(object, "id", 80)?;
            validate_string_field(object, "name", 48)?;
            let pack_id = object["id"]
                .as_str()
                .ok_or_else(|| "Идентификатор пачки повреждён".to_string())?;
            if pack_id.is_empty() || !pack_ids.insert(pack_id) {
                return Err("Идентификаторы пачек должны быть уникальными".to_string());
            }
            if !object.get("enabled").is_some_and(Value::is_boolean)
                || !object
                    .get("completedManually")
                    .is_some_and(Value::is_boolean)
            {
                return Err("Статус пачки повреждён".to_string());
            }
            let by_dungeon = object
                .get("chestInventoryByDungeon")
                .and_then(Value::as_object)
                .ok_or_else(|| "Инвентарь по данжам повреждён".to_string())?;
            if by_dungeon.len() > 100 {
                return Err("Слишком много типов сундуков".to_string());
            }
            for (dungeon_id, slots) in by_dungeon {
                if dungeon_id.is_empty()
                    || dungeon_id.len() > 80
                    || !TRACKER_DUNGEON_IDS.contains(&dungeon_id.as_str())
                {
                    return Err("Идентификатор типа сундуков повреждён".to_string());
                }
                validate_inventory_slots(slots, slot_count)?;
            }
            let dungeons = object
                .get("dungeons")
                .and_then(Value::as_array)
                .ok_or_else(|| "Список данжей повреждён".to_string())?;
            if dungeons.len() > 100 {
                return Err("Количество данжей превышает допустимый предел".to_string());
            }
            let mut dungeon_ids = std::collections::HashSet::new();
            for dungeon in dungeons {
                let dungeon = dungeon
                    .as_object()
                    .ok_or_else(|| "Данж повреждён".to_string())?;
                let dungeon_id = dungeon
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Идентификатор данжа повреждён".to_string())?;
                if !TRACKER_DUNGEON_IDS.contains(&dungeon_id) || !dungeon_ids.insert(dungeon_id) {
                    return Err("Идентификаторы данжей в пачке должны быть уникальными".to_string());
                }
                validate_dungeon(dungeon, false, slot_count)?;
                if packs_key == "defaultPacks"
                    && (dungeon.get("status").and_then(Value::as_str) != Some("idle")
                        || dungeon.get("durationSeconds").and_then(Value::as_u64) != Some(0)
                        || dungeon.get("rewardedSlots").and_then(Value::as_u64) != Some(0)
                        || dungeon.get("chests").and_then(Value::as_u64) != Some(0))
                {
                    return Err(
                        "Постоянный план не может содержать прогресс прохождения".to_string()
                    );
                }
            }
        }
    }
    let default_ids: std::collections::HashSet<&str> = state["defaultPacks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|pack| pack.get("id").and_then(Value::as_str))
        .collect();
    let current_ids: std::collections::HashSet<&str> = state["packs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|pack| pack.get("id").and_then(Value::as_str))
        .collect();
    if default_ids != current_ids {
        return Err("Постоянный и текущий планы содержат разные пачки".to_string());
    }
    if let Some(selected_pack_id) = state.get("selectedPackId") {
        let selected_pack_id = selected_pack_id
            .as_str()
            .ok_or_else(|| "Идентификатор выбранной пачки повреждён".to_string())?;
        if !selected_pack_id.is_empty() && !current_ids.contains(selected_pack_id) {
            return Err("Выбранная пачка отсутствует в текущем плане".to_string());
        }
    }
    if let Some(active_run) = state.get("activeRun").filter(|value| !value.is_null()) {
        let active_run = active_run
            .as_object()
            .ok_or_else(|| "Активный таймер повреждён".to_string())?;
        validate_string_field(active_run, "packId", 80)?;
        validate_string_field(active_run, "dungeonId", 80)?;
        validate_bounded_u64(active_run, "elapsedSeconds", 604_800)?;
        if let Some(started_at) = active_run.get("startedAtMs")
            && !started_at.as_f64().is_some_and(|value| {
                value.is_finite() && (0.0..=253_402_300_799_999.0).contains(&value)
            })
        {
            return Err("Время запуска таймера повреждено".to_string());
        }
        let pack_id = active_run["packId"]
            .as_str()
            .ok_or_else(|| "Пачка активного таймера повреждена".to_string())?;
        let dungeon_id = active_run["dungeonId"]
            .as_str()
            .ok_or_else(|| "Данж активного таймера повреждён".to_string())?;
        let active_target_exists = state["packs"].as_array().is_some_and(|packs| {
            packs.iter().any(|pack| {
                pack.as_object().is_some_and(|pack| {
                    pack.get("id").and_then(Value::as_str) == Some(pack_id)
                        && pack
                            .get("dungeons")
                            .and_then(Value::as_array)
                            .is_some_and(|dungeons| {
                                dungeons.iter().any(|dungeon| {
                                    dungeon.as_object().is_some_and(|dungeon| {
                                        dungeon.get("id").and_then(Value::as_str)
                                            == Some(dungeon_id)
                                            && dungeon.get("status").and_then(Value::as_str)
                                                == Some("active")
                                    })
                                })
                            })
                })
            })
        });
        if !active_target_exists {
            return Err("Активный таймер не связан с активным данжем".to_string());
        }
    }
    let active_dungeon_count = state["packs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter_map(|pack| pack.get("dungeons").and_then(Value::as_array))
        .flatten()
        .filter(|dungeon| dungeon.get("status").and_then(Value::as_str) == Some("active"))
        .count();
    let has_active_run = state.get("activeRun").is_some_and(|value| !value.is_null());
    if active_dungeon_count != usize::from(has_active_run) {
        return Err("Состояние активных данжей не совпадает с таймером".to_string());
    }
    if let Some(ratings) = state.get("arenaRatings") {
        let ratings = ratings
            .as_object()
            .ok_or_else(|| "Рейтинги Арены повреждены".to_string())?;
        for mode in ["order", "chaos"] {
            let rating = ratings
                .get(mode)
                .ok_or_else(|| "В рейтингах Арены отсутствует режим".to_string())?;
            if !rating.is_null() && !rating.as_u64().is_some_and(|value| value <= 99_999) {
                return Err("Рейтинг Арены выходит за допустимые пределы".to_string());
            }
        }
    }
    if let Some(matches) = state.get("arenaMatches") {
        let matches = matches
            .as_array()
            .ok_or_else(|| "История Арены повреждена".to_string())?;
        if matches.len() > 2_000 {
            return Err("История Арены превышает допустимый предел".to_string());
        }
        let mut match_ids = HashSet::with_capacity(matches.len());
        for arena_match in matches {
            let arena_match = arena_match
                .as_object()
                .ok_or_else(|| "Запись Арены повреждена".to_string())?;
            validate_string_field(arena_match, "id", 100)?;
            validate_string_field(arena_match, "dayKey", 10)?;
            validate_day_key(
                arena_match["dayKey"]
                    .as_str()
                    .ok_or_else(|| "Дата боя Арены повреждена".to_string())?,
            )?;
            validate_string_field(arena_match, "playedAt", 64)?;
            if !matches!(
                arena_match.get("mode").and_then(Value::as_str),
                Some("order" | "chaos")
            ) || !matches!(
                arena_match.get("result").and_then(Value::as_str),
                Some("win" | "loss")
            ) {
                return Err("Режим или результат Арены повреждён".to_string());
            }
            let rating_before = arena_match
                .get("ratingBefore")
                .and_then(Value::as_i64)
                .filter(|value| (0..=99_999).contains(value))
                .ok_or_else(|| "Начальный рейтинг боя Арены повреждён".to_string())?;
            let rating_delta = arena_match
                .get("ratingDelta")
                .and_then(Value::as_i64)
                .filter(|value| (-999..=999).contains(value))
                .ok_or_else(|| "Изменение рейтинга Арены повреждено".to_string())?;
            let rating_after = arena_match
                .get("ratingAfter")
                .and_then(Value::as_i64)
                .filter(|value| (0..=99_999).contains(value))
                .ok_or_else(|| "Итоговый рейтинг боя Арены повреждён".to_string())?;
            let result = arena_match["result"]
                .as_str()
                .ok_or_else(|| "Результат Арены повреждён".to_string())?;
            if rating_before + rating_delta != rating_after
                || (result == "win" && rating_delta < 0)
                || (result == "loss" && rating_delta > 0)
            {
                return Err("Изменение рейтинга Арены не соответствует результату".to_string());
            }
            let id = arena_match["id"]
                .as_str()
                .ok_or_else(|| "Идентификатор боя Арены повреждён".to_string())?;
            if id.is_empty() || !match_ids.insert(id) {
                return Err("Идентификаторы боёв Арены должны быть уникальными".to_string());
            }
        }
    }
    let has_active_imperial = state
        .get("activeImperialRun")
        .is_some_and(|value| !value.is_null());
    if has_active_run && has_active_imperial {
        return Err("Одновременно может работать только один таймер".to_string());
    }
    if let Some(active) = state
        .get("activeImperialRun")
        .filter(|value| !value.is_null())
    {
        let active = active
            .as_object()
            .ok_or_else(|| "Таймер Императорской битвы повреждён".to_string())?;
        validate_string_field(active, "dayKey", 10)?;
        validate_day_key(
            active["dayKey"]
                .as_str()
                .ok_or_else(|| "Дата Императорской битвы повреждена".to_string())?,
        )?;
        validate_bounded_u64(active, "elapsedSeconds", 604_800)?;
        let started_at = active
            .get("startedAtMs")
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite() && (0.0..=253_402_300_799_999.0).contains(value));
        if started_at.is_none() {
            return Err("Время запуска Императорской битвы повреждено".to_string());
        }
    }
    if let Some(battles) = state.get("imperialBattles") {
        let battles = battles
            .as_array()
            .ok_or_else(|| "История Императорской битвы повреждена".to_string())?;
        if battles.len() > 2_000 {
            return Err("История Императорской битвы превышает допустимый предел".to_string());
        }
        let mut battle_ids = HashSet::with_capacity(battles.len());
        for battle in battles {
            let battle = battle
                .as_object()
                .ok_or_else(|| "Запись Императорской битвы повреждена".to_string())?;
            validate_string_field(battle, "id", 100)?;
            validate_string_field(battle, "dayKey", 10)?;
            validate_day_key(
                battle["dayKey"]
                    .as_str()
                    .ok_or_else(|| "Дата Императорской битвы повреждена".to_string())?,
            )?;
            validate_string_field(battle, "startedAt", 64)?;
            validate_string_field(battle, "endedAt", 64)?;
            validate_bounded_u64(battle, "durationSeconds", 604_800)?;
            if let Some(placement) = battle.get("placement") {
                if !placement.is_null()
                    && !placement
                        .as_u64()
                        .is_some_and(|value| (1..=99).contains(&value))
                {
                    return Err("Место в Императорской битве повреждено".to_string());
                }
            } else {
                return Err("В записи Императорской битвы отсутствует место".to_string());
            }
            let id = battle["id"]
                .as_str()
                .ok_or_else(|| "Идентификатор Императорской битвы повреждён".to_string())?;
            if id.is_empty() || !battle_ids.insert(id) {
                return Err("Идентификаторы Императорских битв должны быть уникальными".to_string());
            }
        }
    }
    if let Some(calculator) = state.get("lootCalculator") {
        let calculator = calculator
            .as_object()
            .ok_or_else(|| "Настройки калькулятора повреждены".to_string())?;
        validate_bounded_u64(calculator, "characterCount", 1_000)?;
        if !calculator
            .get("doubleReward")
            .is_some_and(Value::is_boolean)
        {
            return Err("Настройка двойной награды повреждена".to_string());
        }
        if !matches!(
            calculator.get("source").and_then(Value::as_str),
            Some("forecast" | "all_inventory" | "selected_packs")
        ) {
            return Err("Источник калькулятора повреждён".to_string());
        }
        validate_string_array(calculator, "selectedDungeonIds", 100, 80)?;
        validate_string_array(calculator, "selectedPackIds", 20, 80)?;
        if calculator["selectedDungeonIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .any(|id| !LOOT_DUNGEON_IDS.contains(&id))
        {
            return Err("Калькулятор ссылается на неизвестный данж".to_string());
        }
        if calculator["selectedPackIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .any(|id| !current_ids.contains(id))
        {
            return Err("Калькулятор ссылается на неизвестную пачку".to_string());
        }
    }
    if let Some(prices) = state.get("lootPrices") {
        let prices = prices
            .as_array()
            .ok_or_else(|| "Цены калькулятора повреждены".to_string())?;
        if prices.len() > 1_000 {
            return Err("Слишком много пользовательских цен".to_string());
        }
        for price in prices {
            let price = price
                .as_object()
                .ok_or_else(|| "Цена калькулятора повреждена".to_string())?;
            validate_string_field(price, "itemId", 80)?;
            validate_bounded_number(price, "price", 1_000_000_000_000_000.0)?;
        }
    }
    if let Some(history) = state.get("lootHistory") {
        let history = history
            .as_array()
            .ok_or_else(|| "История калькулятора повреждена".to_string())?;
        if history.len() > 200 {
            return Err("История калькулятора превышает допустимый предел".to_string());
        }
        for entry in history {
            let entry = entry
                .as_object()
                .ok_or_else(|| "Запись калькулятора повреждена".to_string())?;
            validate_string_field(entry, "id", 100)?;
            validate_string_field(entry, "createdAt", 64)?;
            validate_bounded_u64(entry, "characterCount", 1_000)?;
            if !entry.get("doubleReward").is_some_and(Value::is_boolean) {
                return Err("Запись калькулятора повреждена".to_string());
            }
            for field in ["totalDayValue", "totalWeekValue", "totalMonthValue"] {
                validate_bounded_number(entry, field, 1_000_000_000_000_000.0)?;
            }
            if let Some(source) = entry.get("source")
                && !matches!(
                    source.as_str(),
                    Some("forecast" | "all_inventory" | "selected_packs")
                )
            {
                return Err("Источник записи калькулятора повреждён".to_string());
            }
        }
    }
    if let Some(settings) = state.get("interfaceSettings") {
        let settings = settings
            .as_object()
            .ok_or_else(|| "Настройки интерфейса повреждены".to_string())?;
        if !matches!(
            settings.get("scale").and_then(Value::as_u64),
            Some(90 | 100 | 110)
        ) || !settings.get("reduceMotion").is_some_and(Value::is_boolean)
            || !settings.get("compactMode").is_some_and(Value::is_boolean)
            || !settings
                .get("startWithWindows")
                .is_some_and(Value::is_boolean)
        {
            return Err("Настройки интерфейса повреждены".to_string());
        }
        validate_string_field(settings, "primaryShortcut", 64)?;
        validate_string_field(settings, "undoShortcut", 64)?;
    }
    if let Some(anchor) = state
        .get("dailyCategoryOverride")
        .filter(|value| !value.is_null())
    {
        let anchor = anchor
            .as_object()
            .ok_or_else(|| "Настройка цикла ежедневок повреждена".to_string())?;
        validate_string_field(anchor, "dayKey", 10)?;
        validate_day_key(
            anchor["dayKey"]
                .as_str()
                .ok_or_else(|| "Дата цикла ежедневок повреждена".to_string())?,
        )?;
        if !matches!(
            anchor.get("category").and_then(Value::as_str),
            Some("armor" | "weapon" | "relic")
        ) {
            return Err("Категория цикла ежедневок повреждена".to_string());
        }
    }
    Ok(())
}

fn validate_history_day(day: &Map<String, Value>) -> Result<(), String> {
    validate_string_field(day, "date", 32)?;
    validate_history_date(
        day["date"]
            .as_str()
            .ok_or_else(|| "Дата истории повреждена".to_string())?,
    )?;
    if let Some(day_key) = day.get("dayKey").and_then(Value::as_str) {
        validate_day_key(day_key)?;
    }
    validate_string_field(day, "label", 64)?;
    validate_bounded_u64(day, "dungeons", 100_000)?;
    validate_bounded_u64(day, "chests", 10_000_000)?;
    validate_bounded_u64(day, "durationSeconds", 31_536_000)?;
    let packs = day
        .get("packs")
        .and_then(Value::as_array)
        .ok_or_else(|| "Пачки в истории повреждены".to_string())?;
    if packs.len() > 20 {
        return Err("Слишком много пачек в записи истории".to_string());
    }
    for pack in packs {
        let pack = pack
            .as_object()
            .ok_or_else(|| "Пачка в истории повреждена".to_string())?;
        validate_string_field(pack, "name", 48)?;
        let dungeons = pack
            .get("dungeons")
            .and_then(Value::as_array)
            .ok_or_else(|| "Данжи в истории повреждены".to_string())?;
        if dungeons.len() > 100 {
            return Err("Слишком много данжей в записи истории".to_string());
        }
        for dungeon in dungeons {
            validate_dungeon(
                dungeon
                    .as_object()
                    .ok_or_else(|| "Данж в истории повреждён".to_string())?,
                true,
                10,
            )?;
        }
    }
    Ok(())
}

fn validate_dungeon(
    dungeon: &Map<String, Value>,
    history: bool,
    slot_count: usize,
) -> Result<(), String> {
    validate_string_field(dungeon, "id", 80)?;
    validate_string_field(dungeon, "name", 80)?;
    if !history {
        validate_string_field(dungeon, "category", 80)?;
        if !matches!(
            dungeon.get("status").and_then(Value::as_str),
            Some("idle" | "active" | "completed")
        ) {
            return Err("Статус данжа повреждён".to_string());
        }
    }
    validate_bounded_u64(dungeon, "durationSeconds", 604_800)?;
    validate_bounded_u64(dungeon, "rewardedSlots", 100)?;
    validate_bounded_u64(dungeon, "chests", 10_000)?;
    if let Some(indexes) = dungeon.get("rewardedSlotIndexes") {
        let indexes = indexes
            .as_array()
            .ok_or_else(|| "Список получивших награду повреждён".to_string())?;
        if indexes.len() > slot_count
            || indexes
                .iter()
                .any(|value| !value.as_u64().is_some_and(|slot| slot < slot_count as u64))
        {
            return Err("Список получивших награду повреждён".to_string());
        }
        let mut unique = std::collections::HashSet::new();
        if indexes
            .iter()
            .filter_map(Value::as_u64)
            .any(|slot| !unique.insert(slot))
        {
            return Err("Список получивших награду содержит повторы".to_string());
        }
        if dungeon.get("rewardedSlots").and_then(Value::as_u64) != Some(indexes.len() as u64) {
            return Err("Количество награждённых не совпадает со списком персонажей".to_string());
        }
    }
    if let Some(category) = dungeon.get("lootCategory")
        && !matches!(category.as_str(), Some("armor" | "weapon" | "relic"))
    {
        return Err("Категория лута повреждена".to_string());
    }
    if let Some(category) = dungeon
        .get("dailyCategory")
        .filter(|value| !value.is_null())
        && !matches!(category.as_str(), Some("armor" | "weapon" | "relic"))
    {
        return Err("Категория ежедневного задания повреждена".to_string());
    }
    if dungeon.contains_key("chestsPerSlot") {
        validate_bounded_u64(dungeon, "chestsPerSlot", 3)?;
        if let (Some(rewarded), Some(per_slot), Some(chests)) = (
            dungeon.get("rewardedSlots").and_then(Value::as_u64),
            dungeon.get("chestsPerSlot").and_then(Value::as_u64),
            dungeon.get("chests").and_then(Value::as_u64),
        ) && chests != rewarded * per_slot
        {
            return Err("Итог сундуков не совпадает с наградой персонажей".to_string());
        }
    }
    Ok(())
}

fn validate_inventory_slots(value: &Value, slot_count: usize) -> Result<(), String> {
    let slots = value
        .as_array()
        .ok_or_else(|| "Инвентарь сундуков повреждён".to_string())?;
    if slots.len() != slot_count
        || slots
            .iter()
            .any(|value| !value.as_u64().is_some_and(|count| count <= 999_999))
    {
        return Err("Инвентарь сундуков повреждён".to_string());
    }
    Ok(())
}

fn validate_bounded_number(
    object: &Map<String, Value>,
    field: &str,
    maximum: f64,
) -> Result<(), String> {
    let value = object
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("Поле {field} повреждено"))?;
    if !value.is_finite() || !(0.0..=maximum).contains(&value) {
        return Err(format!("Поле {field} выходит за допустимые пределы"));
    }
    Ok(())
}

fn validate_string_array(
    object: &Map<String, Value>,
    field: &str,
    max_items: usize,
    max_length: usize,
) -> Result<(), String> {
    let values = object
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Поле {field} повреждено"))?;
    if values.len() > max_items
        || values.iter().any(|value| {
            !value
                .as_str()
                .is_some_and(|text| !text.is_empty() && text.len() <= max_length)
        })
    {
        return Err(format!("Поле {field} повреждено"));
    }
    Ok(())
}

fn validate_string_field(
    object: &Map<String, Value>,
    field: &str,
    max_length: usize,
) -> Result<(), String> {
    let value = object
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Поле {field} повреждено"))?;
    if value.len() > max_length {
        return Err(format!("Поле {field} слишком длинное"));
    }
    Ok(())
}

fn validate_bounded_u64(
    object: &Map<String, Value>,
    field: &str,
    maximum: u64,
) -> Result<(), String> {
    match object.get(field).and_then(Value::as_u64) {
        Some(value) if value <= maximum => Ok(()),
        _ => Err(format!("Поле {field} повреждено")),
    }
}

fn validate_day_key(value: &str) -> Result<(), String> {
    let valid = value
        .split_once('-')
        .and_then(|(year, rest)| rest.split_once('-').map(|(month, day)| (year, month, day)))
        .and_then(|(year, month, day)| {
            Some((
                year.parse::<u32>().ok()?,
                month.parse::<u32>().ok()?,
                day.parse::<u32>().ok()?,
            ))
        })
        .is_some_and(|(year, month, day)| {
            value.len() == 10 && valid_calendar_date(year, month, day)
        });
    if valid {
        Ok(())
    } else {
        Err("Дата игрового дня повреждена".to_string())
    }
}

// History entries store their date as a ru-RU-formatted "DD.MM.YYYY" string
// (see formatHistoryDate in src/domain/day.ts), unlike the ISO "YYYY-MM-DD"
// used for the current day's dayKey -- so this checks the format history
// entries actually use instead of reusing validate_day_key.
fn validate_history_date(value: &str) -> Result<(), String> {
    let valid = value
        .split_once('.')
        .and_then(|(day, rest)| rest.split_once('.').map(|(month, year)| (year, month, day)))
        .and_then(|(year, month, day)| {
            Some((
                year.parse::<u32>().ok()?,
                month.parse::<u32>().ok()?,
                day.parse::<u32>().ok()?,
            ))
        })
        .is_some_and(|(year, month, day)| {
            value.len() == 10 && valid_calendar_date(year, month, day)
        });
    if valid {
        Ok(())
    } else {
        Err("Дата истории повреждена".to_string())
    }
}

fn valid_calendar_date(year: u32, month: u32, day: u32) -> bool {
    if !(1..=9999).contains(&year) || !(1..=12).contains(&month) || day == 0 {
        return false;
    }
    let leap_year =
        year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum_day = match month {
        2 if leap_year => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    day <= maximum_day
}

fn validate_json_limits(value: &Value, depth: usize) -> Result<(), String> {
    if depth > MAX_JSON_DEPTH {
        return Err("Локальные данные имеют слишком большую вложенность".to_string());
    }
    match value {
        Value::String(value) if value.len() > MAX_HISTORY_DAY_BYTES => {
            Err("Строка в локальных данных слишком большая".to_string())
        }
        Value::Array(values) => {
            if values.len() > MAX_HISTORY_DAYS {
                return Err("Массив в локальных данных слишком большой".to_string());
            }
            for value in values {
                validate_json_limits(value, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            if values.len() > 1_000 {
                return Err("Объект в локальных данных слишком большой".to_string());
            }
            for value in values.values() {
                validate_json_limits(value, depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn save_validated_state(
    transaction: &Transaction<'_>,
    validated: ValidatedState,
) -> Result<(), String> {
    transaction
        .execute(
            "
            INSERT INTO app_state(key, payload, updated_at)
            VALUES (?1, ?2, unixepoch())
            ON CONFLICT(key) DO UPDATE SET
                payload = excluded.payload,
                updated_at = excluded.updated_at
            ",
            params![STATE_KEY, validated.root_without_history],
        )
        .map_err(|error| format!("Не удалось сохранить локальные данные: {error}"))?;

    let mut retained = HashSet::with_capacity(validated.history.len());
    for (sort_order, (day_key, payload)) in validated.history.into_iter().enumerate() {
        retained.insert(day_key.clone());
        transaction
            .execute(
                "
                INSERT INTO history_days(day_key, sort_order, payload, updated_at)
                VALUES (?1, ?2, ?3, unixepoch())
                ON CONFLICT(day_key) DO UPDATE SET
                    sort_order = excluded.sort_order,
                    payload = excluded.payload,
                    updated_at = unixepoch()
                WHERE history_days.sort_order <> excluded.sort_order
                   OR history_days.payload <> excluded.payload
                ",
                params![day_key, sort_order as i64, payload],
            )
            .map_err(|error| format!("Не удалось сохранить историю: {error}"))?;
    }

    let existing = {
        let mut statement = transaction
            .prepare("SELECT day_key FROM history_days")
            .map_err(|error| format!("Не удалось проверить историю: {error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Не удалось проверить историю: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Не удалось проверить историю: {error}"))?
    };
    for day_key in existing {
        if !retained.contains(&day_key) {
            transaction
                .execute(
                    "DELETE FROM history_days WHERE day_key = ?1",
                    params![day_key],
                )
                .map_err(|error| format!("Не удалось обновить историю: {error}"))?;
        }
    }
    Ok(())
}

fn load_combined_payload(connection: &Connection) -> Result<Option<String>, String> {
    let Some(root_payload) = connection
        .query_row(
            "SELECT payload FROM app_state WHERE key = ?1",
            params![STATE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Не удалось прочитать локальные данные: {error}"))?
    else {
        return Ok(None);
    };

    let mut root: Value = serde_json::from_str(&root_payload)
        .map_err(|_| "Локальные данные повреждены".to_string())?;
    let state = root
        .as_object_mut()
        .and_then(|value| value.get_mut("state"))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Локальные данные повреждены".to_string())?;

    let mut statement = connection
        .prepare("SELECT payload FROM history_days ORDER BY sort_order")
        .map_err(|error| format!("Не удалось прочитать историю: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Не удалось прочитать историю: {error}"))?;
    let mut history = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("Не удалось прочитать историю: {error}"))?;
        history.push(
            serde_json::from_str(&payload).map_err(|_| "Запись истории повреждена".to_string())?,
        );
    }
    state.insert("history".to_string(), Value::Array(history));
    serde_json::to_string(&root)
        .map(Some)
        .map_err(|_| "Не удалось подготовить локальные данные".to_string())
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Некорректное системное время".to_string())
        .map(|value| value.as_secs())
}

fn encode_backup(payload: &str) -> Result<Vec<u8>, String> {
    let payload_value: Value =
        serde_json::from_str(payload).map_err(|_| "Не удалось подготовить резервную копию")?;
    let envelope = BackupEnvelope {
        format: "castaryn-player-backup".to_string(),
        version: 1,
        exported_at: unix_timestamp()?,
        payload: payload_value,
    };
    serde_json::to_vec_pretty(&envelope)
        .map_err(|_| "Не удалось сформировать резервную копию".to_string())
}

#[tauri::command]
pub fn load_app_state(database: State<'_, Database>) -> Result<Option<String>, String> {
    database.load_payload()
}

#[tauri::command]
pub fn save_app_state(payload: String, database: State<'_, Database>) -> Result<(), String> {
    database.save_payload(&payload)
}

#[tauri::command]
pub fn clear_app_state(database: State<'_, Database>) -> Result<(), String> {
    let mut connection = database.lock()?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Не удалось начать очистку: {error}"))?;
    transaction
        .execute("DELETE FROM app_state WHERE key = ?1", params![STATE_KEY])
        .map_err(|error| format!("Не удалось очистить локальные данные: {error}"))?;
    transaction
        .execute("DELETE FROM history_days", [])
        .map_err(|error| format!("Не удалось очистить историю: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Не удалось завершить очистку: {error}"))
}

#[tauri::command]
pub fn export_backup(database: State<'_, Database>) -> Result<Option<String>, String> {
    let Some(payload) = database.load_payload()? else {
        return Err("Нет локальных данных для экспорта".to_string());
    };
    validate_and_split_state(&payload)?;
    let encoded = encode_backup(&payload)?;

    let Some(path) = rfd::FileDialog::new()
        .add_filter("Резервная копия Castaryn", &["castaryn", "elyvo"])
        .set_file_name("Castaryn_backup.castaryn")
        .save_file()
    else {
        return Ok(None);
    };

    fs::write(&path, encoded)
        .map_err(|error| format!("Не удалось сохранить резервную копию: {error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn import_backup(database: State<'_, Database>) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Резервная копия Castaryn", &["castaryn", "elyvo"])
        .pick_file()
    else {
        return Ok(None);
    };

    let metadata =
        fs::metadata(&path).map_err(|error| format!("Не удалось открыть файл: {error}"))?;
    if metadata.len() as usize > MAX_BACKUP_BYTES {
        return Err("Файл резервной копии слишком большой".to_string());
    }

    let encoded =
        fs::read_to_string(&path).map_err(|error| format!("Не удалось прочитать файл: {error}"))?;
    let envelope: BackupEnvelope =
        serde_json::from_str(&encoded).map_err(|_| "Файл не является резервной копией Castaryn")?;
    if !matches!(
        envelope.format.as_str(),
        "castaryn-player-backup" | "elyvo-player-backup"
    ) || envelope.version != 1
    {
        return Err("Версия резервной копии не поддерживается".to_string());
    }

    let payload =
        serde_json::to_string(&envelope.payload).map_err(|_| "Резервная копия повреждена")?;
    validate_and_split_state(&payload)?;
    if let Some(current) = database.load_payload()? {
        database.write_automatic_backup(&current)?;
    }
    database.save_payload(&payload)?;
    Ok(Some(payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_state() -> String {
        serde_json::json!({
            "state": {
                "onboardingCompleted": true,
                "playMode": "multi",
                "dayKey": "2026-07-24",
                "profile": {"name": "Player", "server": ""},
                "defaultPacks": [],
                "packs": [],
                "history": []
            },
            "version": 6
        })
        .to_string()
    }

    #[test]
    fn accepts_current_player_state() {
        assert!(validate_and_split_state(&valid_state()).is_ok());
    }

    #[test]
    fn accepts_valid_local_pvp_state() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["arenaRatings"] = serde_json::json!({
            "order": 1520,
            "chaos": null
        });
        value["state"]["arenaMatches"] = serde_json::json!([{
            "id": "arena-1",
            "dayKey": "2026-07-24",
            "playedAt": "2026-07-24T18:00:00.000Z",
            "mode": "order",
            "result": "win",
            "ratingBefore": 1500,
            "ratingDelta": 20,
            "ratingAfter": 1520
        }]);
        value["state"]["activeImperialRun"] = Value::Null;
        value["state"]["imperialBattles"] = serde_json::json!([{
            "id": "imperial-1",
            "dayKey": "2026-07-24",
            "startedAt": "2026-07-24T19:00:00.000Z",
            "endedAt": "2026-07-24T19:12:00.000Z",
            "durationSeconds": 720,
            "placement": null
        }]);
        assert!(validate_and_split_state(&value.to_string()).is_ok());
    }

    #[test]
    fn rejects_inconsistent_arena_rating_change() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["arenaRatings"] = serde_json::json!({"order": 1510, "chaos": null});
        value["state"]["arenaMatches"] = serde_json::json!([{
            "id": "arena-1",
            "dayKey": "2026-07-24",
            "playedAt": "2026-07-24T18:00:00.000Z",
            "mode": "order",
            "result": "win",
            "ratingBefore": 1500,
            "ratingDelta": -10,
            "ratingAfter": 1490
        }]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_simultaneous_pve_and_imperial_timers() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        let active_dungeon = serde_json::json!({
            "id": "knights-island",
            "name": "Остров Рыцарей",
            "category": "Реликвии",
            "status": "active",
            "durationSeconds": 0,
            "rewardedSlots": 0,
            "rewardedSlotIndexes": [],
            "chests": 0,
            "lootCategory": "relic",
            "dailyCategory": null,
            "chestsPerSlot": 2
        });
        let default_dungeon = serde_json::json!({
            "id": "knights-island",
            "name": "Остров Рыцарей",
            "category": "Реликвии",
            "status": "idle",
            "durationSeconds": 0,
            "rewardedSlots": 0,
            "rewardedSlotIndexes": [],
            "chests": 0,
            "lootCategory": "relic",
            "dailyCategory": null,
            "chestsPerSlot": 2
        });
        let base_pack = serde_json::json!({
            "id": "pack-1",
            "name": "Пачка 1",
            "enabled": true,
            "completedManually": false,
            "chestInventoryByDungeon": {}
        });
        let mut default_pack = base_pack.clone();
        default_pack["dungeons"] = serde_json::json!([default_dungeon]);
        let mut current_pack = base_pack;
        current_pack["dungeons"] = serde_json::json!([active_dungeon]);
        value["state"]["defaultPacks"] = serde_json::json!([default_pack]);
        value["state"]["packs"] = serde_json::json!([current_pack]);
        value["state"]["activeRun"] = serde_json::json!({
            "packId": "pack-1",
            "dungeonId": "knights-island",
            "elapsedSeconds": 10,
            "startedAtMs": 1_700_000_000_000_u64
        });
        value["state"]["activeImperialRun"] = serde_json::json!({
            "dayKey": "2026-07-24",
            "elapsedSeconds": 10,
            "startedAtMs": 1_700_000_000_000_u64
        });
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_non_object_state() {
        assert!(validate_and_split_state("[]").is_err());
    }

    #[test]
    fn rejects_missing_domain_fields() {
        assert!(validate_and_split_state(r#"{"state":{},"version":6}"#).is_err());
    }

    #[test]
    fn extracts_history_from_root_payload() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["history"] = serde_json::json!([
            {
                "dayKey": "2026-07-23",
                "date": "23.07.2026",
                "label": "Четверг",
                "dungeons": 1,
                "chests": 20,
                "durationSeconds": 60,
                "packs": []
            }
        ]);
        let validated = validate_and_split_state(&value.to_string()).unwrap();
        assert_eq!(validated.history.len(), 1);
        assert!(!validated.root_without_history.contains("23.07.2026"));
    }

    #[test]
    fn rejects_malformed_history_dates() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["history"] = serde_json::json!([
            {
                "date": "2026-07-23",
                "label": "Четверг",
                "dungeons": 1,
                "chests": 20,
                "durationSeconds": 60,
                "packs": []
            }
        ]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_impossible_calendar_dates() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["history"] = serde_json::json!([
            {
                "dayKey": "2026-02-30",
                "date": "30.02.2026",
                "label": "Невозможная дата",
                "dungeons": 1,
                "chests": 20,
                "durationSeconds": 60,
                "packs": []
            }
        ]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_malformed_history_day_keys() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["history"] = serde_json::json!([
            {
                "dayKey": "not-a-date",
                "date": "23.07.2026",
                "label": "Четверг",
                "dungeons": 1,
                "chests": 20,
                "durationSeconds": 60,
                "packs": []
            }
        ]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_malformed_typed_chest_inventory() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["packs"] = serde_json::json!([{
            "id": "pack-1",
            "name": "Пачка 1",
            "enabled": true,
            "completedManually": false,
            "chestInventoryByDungeon": {
                "knights-island": [1, -1]
            },
            "dungeons": []
        }]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_unknown_inventory_dungeon() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        let pack = serde_json::json!({
            "id": "pack-1",
            "name": "Пачка 1",
            "enabled": true,
            "completedManually": false,
            "chestInventoryByDungeon": {"unknown-dungeon": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]},
            "dungeons": []
        });
        value["state"]["defaultPacks"] = serde_json::json!([pack.clone()]);
        value["state"]["packs"] = serde_json::json!([pack]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_non_string_selected_pack_id() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["selectedPackId"] = serde_json::json!(42);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_progress_in_permanent_plan() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        let default_pack = serde_json::json!({
            "id": "pack-1",
            "name": "Пачка 1",
            "enabled": true,
            "completedManually": false,
            "chestInventoryByDungeon": {},
            "dungeons": [{
                "id": "knights-island",
                "name": "Остров Рыцарей",
                "category": "Реликвии",
                "status": "completed",
                "durationSeconds": 10,
                "rewardedSlots": 10,
                "rewardedSlotIndexes": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                "chests": 20,
                "lootCategory": "relic",
                "dailyCategory": null,
                "chestsPerSlot": 2
            }]
        });
        let current_pack = default_pack.clone();
        value["state"]["defaultPacks"] = serde_json::json!([default_pack]);
        value["state"]["packs"] = serde_json::json!([current_pack]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_invalid_calculator_source() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["lootCalculator"] = serde_json::json!({
            "characterCount": 10,
            "doubleReward": false,
            "selectedDungeonIds": ["20"],
            "selectedPackIds": [],
            "source": "remote"
        });
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_unknown_calculator_references() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["lootCalculator"] = serde_json::json!({
            "characterCount": 10,
            "doubleReward": false,
            "selectedDungeonIds": ["999"],
            "selectedPackIds": [],
            "source": "forecast"
        });
        assert!(validate_and_split_state(&value.to_string()).is_err());

        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["lootCalculator"] = serde_json::json!({
            "characterCount": 10,
            "doubleReward": false,
            "selectedDungeonIds": ["20"],
            "selectedPackIds": ["missing-pack"],
            "source": "selected_packs"
        });
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_invalid_loot_prices_and_interface_settings() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["lootPrices"] = serde_json::json!([
            {"itemId": "item-1", "price": -1}
        ]);
        assert!(validate_and_split_state(&value.to_string()).is_err());

        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["interfaceSettings"] = serde_json::json!({
            "scale": 999,
            "reduceMotion": false,
            "compactMode": false,
            "primaryShortcut": "Shift+F1",
            "undoShortcut": "Shift+G",
            "startWithWindows": false
        });
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_invalid_daily_cycle_anchor() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["dailyCategoryOverride"] = serde_json::json!({
            "dayKey": "2026-02-30",
            "category": "armor"
        });
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_inventory_with_wrong_slot_count() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        let pack = serde_json::json!({
            "id": "pack-1",
            "name": "Пачка 1",
            "enabled": true,
            "completedManually": false,
            "chestInventoryByDungeon": {"knights-island": [1]},
            "dungeons": []
        });
        value["state"]["defaultPacks"] = serde_json::json!([pack.clone()]);
        value["state"]["packs"] = serde_json::json!([pack]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_orphaned_active_timer() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        value["state"]["activeRun"] = serde_json::json!({
            "packId": "missing-pack",
            "dungeonId": "missing-dungeon",
            "elapsedSeconds": 10,
            "startedAtMs": 1_700_000_000_000_u64
        });
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_mismatched_rewarded_slot_list() {
        let mut value: Value = serde_json::from_str(&valid_state()).unwrap();
        let pack = serde_json::json!({
            "id": "pack-1",
            "name": "Пачка 1",
            "enabled": true,
            "completedManually": false,
            "chestInventoryByDungeon": {},
            "dungeons": [{
                "id": "knights-island",
                "name": "Остров Рыцарей",
                "category": "Реликвии",
                "status": "completed",
                "durationSeconds": 10,
                "rewardedSlots": 2,
                "rewardedSlotIndexes": [0],
                "chests": 4,
                "lootCategory": "relic",
                "dailyCategory": null,
                "chestsPerSlot": 2
            }]
        });
        value["state"]["defaultPacks"] = serde_json::json!([pack.clone()]);
        value["state"]["packs"] = serde_json::json!([pack]);
        assert!(validate_and_split_state(&value.to_string()).is_err());
    }
}
