use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use std::{str::FromStr, sync::Mutex};
use zeroize::Zeroizing;

const KEYRING_SERVICE: &str = "com.excalibur.app.ai-providers";
const MAX_API_KEY_BYTES: usize = 1024;
static KEYRING_ACCESS: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ApiProvider {
    OpenAi,
    Anthropic,
    Gemini,
}

impl ApiProvider {
    const ALL: [Self; 3] = [Self::OpenAi, Self::Anthropic, Self::Gemini];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
        }
    }

    fn keyring_account(self) -> &'static str {
        match self {
            Self::OpenAi => "openai-api-key",
            Self::Anthropic => "anthropic-api-key",
            Self::Gemini => "gemini-api-key",
        }
    }
}

impl FromStr for ApiProvider {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "openai" => Ok(Self::OpenAi),
            "anthropic" | "claude" => Ok(Self::Anthropic),
            "gemini" | "google" => Ok(Self::Gemini),
            _ => Err("Provedor de IA invalido.".to_string()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderCredentialStatus {
    provider: &'static str,
    auth_type: &'static str,
    has_key: bool,
    secure_store_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    storage_error: Option<String>,
}

impl AiProviderCredentialStatus {
    fn chatgpt() -> Self {
        Self {
            provider: "chatgpt",
            auth_type: "chatgpt",
            has_key: false,
            secure_store_available: true,
            storage_error: None,
        }
    }

    fn api_key(provider: ApiProvider, has_key: bool) -> Self {
        Self {
            provider: provider.as_str(),
            auth_type: "apiKey",
            has_key,
            secure_store_available: true,
            storage_error: None,
        }
    }

    fn unavailable(provider: ApiProvider, error: String) -> Self {
        Self {
            provider: provider.as_str(),
            auth_type: "apiKey",
            has_key: false,
            secure_store_available: false,
            storage_error: Some(error),
        }
    }
}

fn entry(provider: ApiProvider) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, provider.keyring_account()).map_err(keyring_error)
}

fn keyring_error(error: KeyringError) -> String {
    // Keep platform error details and secrets out of the WebView boundary. The
    // native store may be unavailable when a Linux desktop has no Secret
    // Service session, for example; the UI only needs a safe actionable error.
    match error {
        KeyringError::NoEntry => "Nenhuma chave API foi armazenada.".to_string(),
        KeyringError::NoStorageAccess(_) | KeyringError::NoDefaultStore => {
            "O armazenamento seguro do sistema nao esta disponivel nesta sessao. Desbloqueie ou inicie o cofre do sistema e reinicie o Excalibur."
                .to_string()
        }
        _ => "Nao foi possivel acessar o armazenamento seguro do sistema.".to_string(),
    }
}

fn has_api_key(provider: ApiProvider) -> Result<bool, String> {
    let _guard = KEYRING_ACCESS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    match entry(provider)?.get_password() {
        Ok(secret) => {
            drop(Zeroizing::new(secret));
            Ok(true)
        }
        Err(KeyringError::NoEntry) => Ok(false),
        Err(error) => Err(keyring_error(error)),
    }
}

pub(crate) fn read_api_key(provider: ApiProvider) -> Result<Zeroizing<String>, String> {
    let _guard = KEYRING_ACCESS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let secret = entry(provider)?.get_password().map_err(keyring_error)?;
    Ok(Zeroizing::new(secret))
}

fn validate_api_key(value: String) -> Result<Zeroizing<String>, String> {
    let secret = Zeroizing::new(value);
    if secret.is_empty() {
        return Err("A chave API nao pode estar vazia.".to_string());
    }
    if secret.len() > MAX_API_KEY_BYTES {
        return Err("A chave API excede o tamanho permitido.".to_string());
    }
    if secret
        .chars()
        .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("A chave API contem caracteres invalidos.".to_string());
    }
    Ok(secret)
}

#[tauri::command]
pub(crate) async fn ai_provider_list() -> Result<Vec<AiProviderCredentialStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut statuses = Vec::with_capacity(4);
        statuses.push(AiProviderCredentialStatus::chatgpt());
        for provider in ApiProvider::ALL {
            statuses.push(match has_api_key(provider) {
                Ok(has_key) => AiProviderCredentialStatus::api_key(provider, has_key),
                Err(error) => AiProviderCredentialStatus::unavailable(provider, error),
            });
        }
        Ok(statuses)
    })
    .await
    .map_err(|_| "Falha ao consultar o armazenamento seguro do sistema.".to_string())?
}

#[tauri::command]
pub(crate) async fn ai_provider_save_api_key(
    provider: String,
    api_key: String,
) -> Result<AiProviderCredentialStatus, String> {
    let provider = ApiProvider::from_str(&provider)?;
    let secret = validate_api_key(api_key)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEYRING_ACCESS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        entry(provider)?
            .set_password(secret.as_str())
            .map_err(keyring_error)?;
        Ok(AiProviderCredentialStatus::api_key(provider, true))
    })
    .await
    .map_err(|_| "Falha ao salvar no armazenamento seguro do sistema.".to_string())?
}

#[tauri::command]
pub(crate) async fn ai_provider_remove_api_key(
    provider: String,
) -> Result<AiProviderCredentialStatus, String> {
    let provider = ApiProvider::from_str(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = KEYRING_ACCESS
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match entry(provider)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {}
            Err(error) => return Err(keyring_error(error)),
        }
        Ok(AiProviderCredentialStatus::api_key(provider, false))
    })
    .await
    .map_err(|_| "Falha ao remover do armazenamento seguro do sistema.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_supported_api_providers() {
        assert_eq!(ApiProvider::from_str("openai"), Ok(ApiProvider::OpenAi));
        assert_eq!(ApiProvider::from_str("CLAUDE"), Ok(ApiProvider::Anthropic));
        assert_eq!(ApiProvider::from_str("google"), Ok(ApiProvider::Gemini));
        assert!(ApiProvider::from_str("chatgpt").is_err());
        assert!(ApiProvider::from_str("unknown").is_err());
    }

    #[test]
    fn validates_secret_without_leaking_it() {
        let secret = validate_api_key("sk-example_123".to_string()).unwrap();
        assert_eq!(secret.as_str(), "sk-example_123");
        assert!(validate_api_key("".to_string()).is_err());
        assert!(validate_api_key(" key".to_string()).is_err());
        assert!(validate_api_key("key with spaces".to_string()).is_err());
        assert!(validate_api_key("key\nnext".to_string()).is_err());
        assert!(validate_api_key("x".repeat(MAX_API_KEY_BYTES + 1)).is_err());
    }

    #[test]
    fn status_never_contains_a_secret_field() {
        let status = AiProviderCredentialStatus::api_key(ApiProvider::OpenAi, true);
        let value = serde_json::to_value(status).unwrap();
        assert_eq!(value["provider"], "openai");
        assert_eq!(value["authType"], "apiKey");
        assert_eq!(value["hasKey"], true);
        assert_eq!(value["secureStoreAvailable"], true);
        assert_eq!(value.as_object().unwrap().len(), 4);
    }

    #[test]
    fn unavailable_status_exposes_only_a_sanitized_store_error() {
        let status = AiProviderCredentialStatus::unavailable(
            ApiProvider::Gemini,
            "O armazenamento seguro do sistema nao esta disponivel nesta sessao.".to_string(),
        );
        let value = serde_json::to_value(status).unwrap();
        assert_eq!(value["provider"], "gemini");
        assert_eq!(value["hasKey"], false);
        assert_eq!(value["secureStoreAvailable"], false);
        assert!(value["storageError"]
            .as_str()
            .unwrap()
            .contains("armazenamento seguro"));
    }
}
