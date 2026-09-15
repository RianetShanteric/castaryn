use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use keyring::Entry;
use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::Duration,
};
use url::Url;

const KEYRING_SERVICE: &str = "com.castaryn.desktop.creator";
const LEGACY_KEYRING_SERVICE: &str = "com.elyvo.desktop.creator";
const KEYRING_USER: &str = "refresh-token";
const OVERLAY_KEYRING_SERVICE: &str = "com.castaryn.desktop.overlay";
const LEGACY_OVERLAY_KEYRING_SERVICE: &str = "com.elyvo.desktop.overlay";
const CREATOR_CALLBACK_PATH: &str = "/";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorRuntimeConfig {
    configured: bool,
    api_url: Option<&'static str>,
    oidc_authority: Option<&'static str>,
    oidc_client_id: Option<&'static str>,
    oidc_audience: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorSession {
    access_token: String,
    expires_in: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorApiResponse {
    status: u16,
    body: String,
}

#[derive(Deserialize)]
struct DiscoveryDocument {
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Serialize, Deserialize)]
struct StoredRefreshToken {
    authority: String,
    client_id: String,
    audience: String,
    refresh_token: String,
}

#[tauri::command]
pub fn creator_runtime_config() -> CreatorRuntimeConfig {
    let api_url = option_env!("CASTARYN_CREATOR_API_URL");
    let authority = option_env!("CASTARYN_CREATOR_OIDC_AUTHORITY");
    let client_id = option_env!("CASTARYN_CREATOR_OIDC_CLIENT_ID");
    let audience = option_env!("CASTARYN_CREATOR_OIDC_AUDIENCE");
    CreatorRuntimeConfig {
        configured: api_url.is_some()
            && authority.is_some()
            && client_id.is_some()
            && audience.is_some(),
        api_url,
        oidc_authority: authority,
        oidc_client_id: client_id,
        oidc_audience: audience,
    }
}

#[tauri::command]
pub async fn begin_creator_login(
    authority: String,
    client_id: String,
    audience: String,
) -> Result<CreatorSession, String> {
    validate_https_origin(&authority)?;
    validate_identifier(&client_id, "client ID")?;
    validate_identifier(&audience, "audience")?;

    let discovery = discover(&authority).await?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "Не удалось открыть локальный callback".to_string())?;
    listener
        .set_nonblocking(false)
        .map_err(|_| "Не удалось настроить локальный callback".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "Не удалось определить callback".to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let state = random_urlsafe(32);
    let verifier = random_urlsafe(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut authorization_url = Url::parse(&discovery.authorization_endpoint)
        .map_err(|_| "OIDC authorization endpoint некорректен".to_string())?;
    if authorization_url.scheme() != "https" {
        return Err("OIDC authorization endpoint должен использовать HTTPS".into());
    }
    authorization_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid profile email offline_access")
        .append_pair("audience", &audience)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");

    open_in_default_browser(authorization_url.as_str())?;
    let callback =
        tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, &state))
            .await
            .map_err(|_| "Авторизация была прервана".to_string())??;

    let token = exchange_code(
        &discovery.token_endpoint,
        &client_id,
        &audience,
        &redirect_uri,
        &verifier,
        &callback,
    )
    .await?;
    if let Some(refresh_token) = &token.refresh_token {
        save_refresh_token(StoredRefreshToken {
            authority,
            client_id,
            audience,
            refresh_token: refresh_token.clone(),
        })?;
    }
    Ok(CreatorSession {
        access_token: token.access_token,
        expires_in: token.expires_in.unwrap_or(900),
    })
}

#[tauri::command]
pub async fn refresh_creator_login() -> Result<Option<CreatorSession>, String> {
    let Some(stored) = load_refresh_token()? else {
        return Ok(None);
    };
    validate_https_origin(&stored.authority)?;
    let discovery = discover(&stored.authority).await?;
    let token = exchange_refresh_token(
        &discovery.token_endpoint,
        &stored.client_id,
        &stored.audience,
        &stored.refresh_token,
    )
    .await?;
    if let Some(refresh_token) = &token.refresh_token {
        save_refresh_token(StoredRefreshToken {
            refresh_token: refresh_token.clone(),
            ..stored
        })?;
    }
    Ok(Some(CreatorSession {
        access_token: token.access_token,
        expires_in: token.expires_in.unwrap_or(900),
    }))
}

#[tauri::command]
pub fn logout_creator() -> Result<(), String> {
    for service in [KEYRING_SERVICE, LEGACY_KEYRING_SERVICE] {
        let entry = Entry::new(service, KEYRING_USER)
            .map_err(|_| "Хранилище учётных данных недоступно".to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Не удалось удалить Creator-сессию".into()),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_overlay_token(creator_id: String, public_token: String) -> Result<(), String> {
    validate_overlay_credential(&creator_id, &public_token)?;
    Entry::new(OVERLAY_KEYRING_SERVICE, &creator_id)
        .map_err(|_| "Хранилище учётных данных недоступно".to_string())?
        .set_password(&public_token)
        .map_err(|_| "Не удалось сохранить ссылку OBS".to_string())
}

#[tauri::command]
pub fn load_overlay_token(creator_id: String) -> Result<Option<String>, String> {
    if !is_uuid(&creator_id) {
        return Err("Creator ID некорректен".into());
    }
    for service in [OVERLAY_KEYRING_SERVICE, LEGACY_OVERLAY_KEYRING_SERVICE] {
        let entry = Entry::new(service, &creator_id)
            .map_err(|_| "Хранилище учётных данных недоступно".to_string())?;
        match entry.get_password() {
            Ok(value) if is_overlay_token(&value) => {
                if service == LEGACY_OVERLAY_KEYRING_SERVICE {
                    save_overlay_token(creator_id.clone(), value.clone())?;
                    let _ = entry.delete_credential();
                }
                return Ok(Some(value));
            }
            Ok(_) => return Err("Сохранённая ссылка OBS повреждена".into()),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Не удалось прочитать ссылку OBS".into()),
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn delete_overlay_token(creator_id: String) -> Result<(), String> {
    if !is_uuid(&creator_id) {
        return Err("Creator ID некорректен".into());
    }
    for service in [OVERLAY_KEYRING_SERVICE, LEGACY_OVERLAY_KEYRING_SERVICE] {
        let entry = Entry::new(service, &creator_id)
            .map_err(|_| "Хранилище учётных данных недоступно".to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Не удалось удалить ссылку OBS".into()),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn creator_api_request(
    method: String,
    path: String,
    access_token: String,
    body: Option<String>,
) -> Result<CreatorApiResponse, String> {
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "DELETE") {
        return Err("HTTP-метод не поддерживается".into());
    }
    if !path.starts_with("/v1/") || path.contains("..") || path.contains("://") || path.len() > 1024
    {
        return Err("Путь Creator API некорректен".into());
    }
    if access_token.is_empty() || access_token.len() > 16_384 {
        return Err("Creator-сессия некорректна".into());
    }
    let api_base = option_env!("CASTARYN_CREATOR_API_URL").ok_or("Creator API не настроен")?;
    let mut url = Url::parse(api_base).map_err(|_| "Creator API настроен некорректно")?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    if url.scheme() != "https" && !(cfg!(debug_assertions) && loopback) {
        return Err("Creator API должен использовать HTTPS".into());
    }
    let (request_path, query) = path
        .split_once('?')
        .map_or((path.as_str(), None), |(value, query)| (value, Some(query)));
    url.set_path(request_path);
    url.set_query(query);
    let request_method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| "HTTP-метод не поддерживается")?;
    let client = Client::new();
    let mut request = client
        .request(request_method, url)
        .bearer_auth(access_token)
        .header("accept", "application/json")
        .timeout(Duration::from_secs(10));
    if let Some(body) = body {
        if body.len() > 64 * 1024 {
            return Err("Запрос Creator API слишком большой".into());
        }
        request = request
            .header("content-type", "application/json")
            .body(body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Creator API недоступен".to_string())?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Ответ Creator API повреждён".to_string())?;
    if bytes.len() > 256 * 1024 {
        return Err("Ответ Creator API слишком большой".into());
    }
    Ok(CreatorApiResponse {
        status,
        body: String::from_utf8(bytes.to_vec())
            .map_err(|_| "Ответ Creator API повреждён".to_string())?,
    })
}

#[tauri::command]
pub fn open_twitch_authorization(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Ссылка Twitch некорректна")?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("id.twitch.tv") {
        return Err("Разрешены только ссылки авторизации Twitch".into());
    }
    open_in_default_browser(parsed.as_str())
}

#[tauri::command]
pub fn open_youtube_authorization(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Ссылка YouTube некорректна")?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("accounts.google.com") {
        return Err("Разрешены только ссылки авторизации Google".into());
    }
    open_in_default_browser(parsed.as_str())
}

fn validate_https_origin(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "OIDC authority некорректен".to_string())?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err("OIDC authority должен использовать HTTPS".into());
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 256 {
        return Err(format!("Некорректный {label}"));
    }
    Ok(())
}

fn validate_overlay_credential(creator_id: &str, public_token: &str) -> Result<(), String> {
    if !is_uuid(creator_id) || !is_overlay_token(public_token) {
        return Err("Ссылка OBS некорректна".into());
    }
    Ok(())
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                8 | 13 | 18 | 23 => character == '-',
                _ => character.is_ascii_hexdigit(),
            })
}

fn is_overlay_token(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

async fn discover(authority: &str) -> Result<DiscoveryDocument, String> {
    let authority_host = Url::parse(authority)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_string))
        .ok_or_else(|| "OIDC authority некорректен".to_string())?;
    let url = format!(
        "{}/.well-known/openid-configuration",
        authority.trim_end_matches('/')
    );
    let document = Client::new()
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Сервис Castaryn Account недоступен".to_string())?
        .error_for_status()
        .map_err(|_| "Сервис Castaryn Account отклонил запрос".to_string())?
        .json::<DiscoveryDocument>()
        .await
        .map_err(|_| "OIDC-конфигурация некорректна".to_string())?;

    // A compromised or misconfigured identity provider could otherwise point
    // the discovery document at attacker-controlled endpoints; only accept
    // endpoints served from the same host we asked for discovery on.
    validate_discovery_endpoint(&document.authorization_endpoint, &authority_host)?;
    validate_discovery_endpoint(&document.token_endpoint, &authority_host)?;

    Ok(document)
}

fn validate_discovery_endpoint(endpoint: &str, authority_host: &str) -> Result<(), String> {
    let url = Url::parse(endpoint).map_err(|_| "OIDC-конфигурация некорректна".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some(authority_host) {
        return Err("OIDC-конфигурация указывает на недоверенный узел".into());
    }
    Ok(())
}

async fn exchange_code(
    token_endpoint: &str,
    client_id: &str,
    audience: &str,
    redirect_uri: &str,
    verifier: &str,
    code: &str,
) -> Result<TokenResponse, String> {
    exchange_token(
        token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("audience", audience),
            ("redirect_uri", redirect_uri),
            ("code_verifier", verifier),
            ("code", code),
        ],
    )
    .await
}

async fn exchange_refresh_token(
    token_endpoint: &str,
    client_id: &str,
    audience: &str,
    refresh_token: &str,
) -> Result<TokenResponse, String> {
    exchange_token(
        token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("audience", audience),
            ("refresh_token", refresh_token),
        ],
    )
    .await
}

async fn exchange_token(
    token_endpoint: &str,
    form: &[(&str, &str)],
) -> Result<TokenResponse, String> {
    let endpoint =
        Url::parse(token_endpoint).map_err(|_| "OIDC token endpoint некорректен".to_string())?;
    if endpoint.scheme() != "https" {
        return Err("OIDC token endpoint должен использовать HTTPS".into());
    }
    Client::new()
        .post(endpoint)
        .timeout(Duration::from_secs(10))
        .form(form)
        .send()
        .await
        .map_err(|_| "Не удалось завершить вход".to_string())?
        .error_for_status()
        .map_err(|_| "Сервис Castaryn Account отклонил вход".to_string())?
        .json::<TokenResponse>()
        .await
        .map_err(|_| "Ответ Castaryn Account некорректен".to_string())
}

fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "Не удалось настроить callback".to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    loop {
        match listener.accept() {
            Ok((stream, _)) => return handle_callback(stream, expected_state),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err("Время входа истекло".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return Err("Не удалось получить callback".into()),
        }
    }
}

fn handle_callback(mut stream: TcpStream, expected_state: &str) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| "Не удалось настроить callback".to_string())?;
    let mut request = [0u8; 8192];
    let bytes = stream
        .read(&mut request)
        .map_err(|_| "Не удалось прочитать callback".to_string())?;
    let request = String::from_utf8_lossy(&request[..bytes]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|line| line.split_once(' '))
        .map(|(target, _)| target)
        .ok_or_else(|| "Callback некорректен".to_string())?;
    let callback = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "Callback некорректен".to_string())?;
    if callback.path() != CREATOR_CALLBACK_PATH {
        return Err("Callback path некорректен".into());
    }
    let state = callback
        .query_pairs()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.into_owned());
    let code = callback
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned());
    let valid = state.as_deref() == Some(expected_state) && code.is_some();
    let (status, message) = if valid {
        ("200 OK", "Вход завершён. Вернитесь в Castaryn.")
    } else {
        ("400 Bad Request", "Не удалось подтвердить вход.")
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{message}",
        message.len()
    );
    let _ = stream.write_all(response.as_bytes());
    if valid {
        Ok(code.unwrap_or_default())
    } else {
        Err("Не удалось подтвердить вход".into())
    }
}

fn random_urlsafe(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn save_refresh_token(token: StoredRefreshToken) -> Result<(), String> {
    let value = serde_json::to_string(&token)
        .map_err(|_| "Не удалось сохранить Creator-сессию".to_string())?;
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|_| "Хранилище учётных данных недоступно".to_string())?
        .set_password(&value)
        .map_err(|_| "Не удалось сохранить Creator-сессию".to_string())
}

fn load_refresh_token() -> Result<Option<StoredRefreshToken>, String> {
    for service in [KEYRING_SERVICE, LEGACY_KEYRING_SERVICE] {
        let entry = Entry::new(service, KEYRING_USER)
            .map_err(|_| "Хранилище учётных данных недоступно".to_string())?;
        match entry.get_password() {
            Ok(value) => {
                let stored = serde_json::from_str::<StoredRefreshToken>(&value)
                    .map_err(|_| "Сохранённая Creator-сессия повреждена".to_string())?;
                if service == LEGACY_KEYRING_SERVICE {
                    save_refresh_token(StoredRefreshToken {
                        authority: stored.authority.clone(),
                        client_id: stored.client_id.clone(),
                        audience: stored.audience.clone(),
                        refresh_token: stored.refresh_token.clone(),
                    })?;
                    let _ = entry.delete_credential();
                }
                return Ok(Some(stored));
            }
            Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("Не удалось прочитать Creator-сессию".into()),
        }
    }
    Ok(None)
}

fn open_in_default_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Не удалось открыть системный браузер".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_https_authorities() {
        assert!(validate_https_origin("http://identity.example").is_err());
        assert!(validate_https_origin("https://identity.example").is_ok());
    }

    #[test]
    fn pkce_values_are_urlsafe_and_random() {
        let first = random_urlsafe(32);
        let second = random_urlsafe(32);
        assert_ne!(first, second);
        assert!(!first.contains('='));
    }

    #[test]
    fn validates_overlay_credentials() {
        assert!(
            validate_overlay_credential(
                "5c55f46a-3d83-4f1c-a1c0-16b386ba543b",
                "1234567890123456789012345678901234567890123",
            )
            .is_ok()
        );
        assert!(validate_overlay_credential("not-a-uuid", "short").is_err());
    }

    #[test]
    fn discovery_endpoints_must_match_the_authority_host() {
        assert!(
            validate_discovery_endpoint(
                "https://identity.example/oauth/authorize",
                "identity.example",
            )
            .is_ok()
        );
        assert!(
            validate_discovery_endpoint(
                "https://attacker.example/oauth/authorize",
                "identity.example",
            )
            .is_err()
        );
        assert!(
            validate_discovery_endpoint(
                "http://identity.example/oauth/authorize",
                "identity.example",
            )
            .is_err()
        );
    }
}
