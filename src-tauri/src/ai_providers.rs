use crate::{
    codex::validate_generated_png_base64,
    credentials::{read_api_key, ApiProvider},
};
use base64::{engine::general_purpose, Engine as _};
use reqwest::{header::HeaderValue, redirect::Policy, Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, MutexGuard},
    time::Duration,
};
use tauri::State;
use tokio_util::sync::CancellationToken;

const MAX_REQUEST_ID_BYTES: usize = 96;
const MAX_SYSTEM_PROMPT_BYTES: usize = 64 * 1024;
const MAX_PROMPT_BYTES: usize = 768 * 1024;
const MAX_IMAGE_PROMPT_BYTES: usize = 8 * 1024;
const MAX_OUTPUT_SCHEMA_BYTES: usize = 256 * 1024;
const MAX_PLAN_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES: usize = 24 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_ERROR_MESSAGE_CHARS: usize = 500;

const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_IMAGES_URL: &str = "https://api.openai.com/v1/images/generations";
const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const GEMINI_INTERACTIONS_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

const OPENAI_MODELS: &[&str] = &["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const ANTHROPIC_MODELS: &[&str] = &["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"];
const GEMINI_MODELS: &[&str] = &[
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
];

#[derive(Debug)]
pub(crate) struct AiProviderRuntime {
    client: Client,
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl Default for AiProviderRuntime {
    fn default() -> Self {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(8 * 60))
            .https_only(true)
            // API URLs are fixed and never need redirects. Disabling them also
            // prevents custom API-key headers from crossing to another host.
            .redirect(Policy::none())
            .user_agent(concat!("Excalibur/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("fixed provider HTTP client configuration must be valid");
        Self {
            client,
            active: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderGenerateRequest {
    request_id: String,
    provider: String,
    model: String,
    reasoning_effort: String,
    system_prompt: String,
    prompt: String,
    output_schema: Value,
    #[serde(default)]
    generate_image: bool,
    image_prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderGenerateResponse {
    text: String,
    generated_images: Vec<AiProviderGeneratedImage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderGeneratedImage {
    data_url: String,
    mime_type: &'static str,
    width: u32,
    height: u32,
    revised_prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderTestResult {
    ok: bool,
    message: String,
}

#[tauri::command]
pub(crate) async fn ai_provider_generate(
    state: State<'_, AiProviderRuntime>,
    request: AiProviderGenerateRequest,
) -> Result<AiProviderGenerateResponse, String> {
    validate_request(&request)?;
    let request_id = request.request_id.clone();
    let cancellation = CancellationToken::new();
    {
        let mut active = lock_active(&state);
        if !active.is_empty() {
            return Err("Ja existe uma solicitacao de IA em andamento.".to_string());
        }
        active.insert(request_id.clone(), cancellation.clone());
    }

    let result = tokio::select! {
        _ = cancellation.cancelled() => Err("Solicitacao interrompida.".to_string()),
        result = generate_inner(&state.client, request) => result,
    };
    lock_active(&state).remove(&request_id);
    result
}

#[tauri::command]
pub(crate) async fn ai_provider_cancel(
    state: State<'_, AiProviderRuntime>,
    request_id: String,
) -> Result<bool, String> {
    validate_request_id(&request_id)?;
    let cancellation = lock_active(&state).get(&request_id).cloned();
    if let Some(cancellation) = cancellation {
        cancellation.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub(crate) async fn ai_provider_test(
    state: State<'_, AiProviderRuntime>,
    provider: String,
    model: Option<String>,
) -> Result<AiProviderTestResult, String> {
    let provider = parse_provider(&provider)?;
    if let Some(model) = model.as_deref() {
        validate_model(provider, model)?;
    }
    let key = load_api_key(provider).await?;
    let request = match provider {
        ApiProvider::OpenAi => state
            .client
            .get(OPENAI_MODELS_URL)
            .bearer_auth(key.as_str()),
        ApiProvider::Anthropic => state
            .client
            .get(ANTHROPIC_MODELS_URL)
            .header("x-api-key", sensitive_api_key_header(key.as_str())?)
            .header("anthropic-version", "2023-06-01"),
        ApiProvider::Gemini => state
            .client
            .get(GEMINI_MODELS_URL)
            .header("x-goog-api-key", sensitive_api_key_header(key.as_str())?),
    };
    let response = request
        .send()
        .await
        .map_err(|error| network_error(provider, error))?;
    if !response.status().is_success() {
        return Err(provider_http_error(provider, response).await);
    }
    Ok(AiProviderTestResult {
        ok: true,
        message: "Chave validada com sucesso.".to_string(),
    })
}

fn lock_active(state: &AiProviderRuntime) -> MutexGuard<'_, HashMap<String, CancellationToken>> {
    state
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

async fn load_api_key(provider: ApiProvider) -> Result<zeroize::Zeroizing<String>, String> {
    tauri::async_runtime::spawn_blocking(move || read_api_key(provider))
        .await
        .map_err(|_| "Falha ao consultar o armazenamento seguro do sistema.".to_string())?
}

async fn generate_inner(
    client: &Client,
    request: AiProviderGenerateRequest,
) -> Result<AiProviderGenerateResponse, String> {
    let provider = parse_provider(&request.provider)?;
    validate_model(provider, &request.model)?;
    let effort = normalized_effort(provider, &request.model, &request.reasoning_effort)?;
    let key = load_api_key(provider).await?;

    if request.generate_image && provider == ApiProvider::Anthropic {
        return Err("Geracao de imagem nao esta disponivel com Claude.".to_string());
    }

    let text = match provider {
        ApiProvider::OpenAi => {
            generate_openai_plan(
                client,
                key.as_str(),
                &request.model,
                effort,
                &request.system_prompt,
                &request.prompt,
                request.output_schema,
            )
            .await?
        }
        ApiProvider::Anthropic => {
            generate_anthropic_plan(
                client,
                key.as_str(),
                &request.model,
                effort,
                &request.system_prompt,
                &request.prompt,
                request.output_schema,
            )
            .await?
        }
        ApiProvider::Gemini => {
            generate_gemini_plan(
                client,
                key.as_str(),
                &request.model,
                effort,
                &request.system_prompt,
                &request.prompt,
                request.output_schema,
            )
            .await?
        }
    };

    let generated_images = if request.generate_image {
        let image_prompt = request
            .image_prompt
            .as_deref()
            .ok_or_else(|| "O pedido da imagem nao foi informado.".to_string())?;
        vec![match provider {
            ApiProvider::OpenAi => {
                generate_openai_image(client, key.as_str(), image_prompt).await?
            }
            ApiProvider::Gemini => {
                generate_gemini_image(client, key.as_str(), image_prompt).await?
            }
            ApiProvider::Anthropic => unreachable!("Claude image generation is rejected above"),
        }]
    } else {
        Vec::new()
    };

    Ok(AiProviderGenerateResponse {
        text,
        generated_images,
    })
}

async fn generate_openai_plan(
    client: &Client,
    key: &str,
    model: &str,
    effort: Option<&str>,
    system_prompt: &str,
    prompt: &str,
    output_schema: Value,
) -> Result<String, String> {
    let mut body = json!({
        "model": model,
        "instructions": system_prompt,
        "input": prompt,
        "store": false,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "excalibur_canvas_plan",
                "strict": true,
                "schema": output_schema
            }
        }
    });
    if let Some(effort) = effort {
        body["reasoning"] = json!({ "effort": effort });
    }
    let response = client
        .post(OPENAI_RESPONSES_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|error| network_error(ApiProvider::OpenAi, error))?;
    let value = read_json_response(ApiProvider::OpenAi, response, MAX_PLAN_RESPONSE_BYTES).await?;
    extract_openai_text(&value)
        .ok_or_else(|| "A OpenAI concluiu sem retornar o plano do canvas.".to_string())
}

async fn generate_anthropic_plan(
    client: &Client,
    key: &str,
    model: &str,
    effort: Option<&str>,
    system_prompt: &str,
    prompt: &str,
    output_schema: Value,
) -> Result<String, String> {
    let max_tokens = anthropic_max_tokens(effort);
    let mut output_config = json!({
        "format": {
            "type": "json_schema",
            "schema": output_schema
        }
    });
    if let Some(effort) = effort {
        output_config["effort"] = Value::String(effort.to_string());
    }
    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": prompt }],
        "output_config": output_config
    });
    if model == "claude-opus-4-8" {
        body["thinking"] = json!({ "type": "adaptive" });
    }
    let response = client
        .post(ANTHROPIC_MESSAGES_URL)
        .header("x-api-key", sensitive_api_key_header(key)?)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|error| network_error(ApiProvider::Anthropic, error))?;
    let value =
        read_json_response(ApiProvider::Anthropic, response, MAX_PLAN_RESPONSE_BYTES).await?;
    extract_anthropic_text(&value)
        .ok_or_else(|| "O Claude concluiu sem retornar o plano do canvas.".to_string())
}

fn anthropic_max_tokens(effort: Option<&str>) -> u32 {
    match effort {
        Some("xhigh" | "max") => 65_536,
        Some("high") => 32_768,
        _ => 16_384,
    }
}

async fn generate_gemini_plan(
    client: &Client,
    key: &str,
    model: &str,
    effort: Option<&str>,
    system_prompt: &str,
    prompt: &str,
    output_schema: Value,
) -> Result<String, String> {
    let mut body = json!({
        "model": model,
        "system_instruction": system_prompt,
        "input": prompt,
        "response_format": {
            "type": "text",
            "mime_type": "application/json",
            "schema": output_schema
        }
    });
    if let Some(effort) = effort {
        body["generation_config"] = json!({ "thinking_level": effort });
    }
    let response = client
        .post(GEMINI_INTERACTIONS_URL)
        .header("x-goog-api-key", sensitive_api_key_header(key)?)
        .json(&body)
        .send()
        .await
        .map_err(|error| network_error(ApiProvider::Gemini, error))?;
    let value = read_json_response(ApiProvider::Gemini, response, MAX_PLAN_RESPONSE_BYTES).await?;
    extract_gemini_text(&value)
        .ok_or_else(|| "O Gemini concluiu sem retornar o plano do canvas.".to_string())
}

async fn generate_openai_image(
    client: &Client,
    key: &str,
    prompt: &str,
) -> Result<AiProviderGeneratedImage, String> {
    let response = client
        .post(OPENAI_IMAGES_URL)
        .bearer_auth(key)
        .json(&json!({
            "model": "gpt-image-2",
            "prompt": prompt,
            "size": "1536x1024",
            "quality": "medium",
            "output_format": "png",
            "n": 1
        }))
        .send()
        .await
        .map_err(|error| network_error(ApiProvider::OpenAi, error))?;
    let value = read_json_response(ApiProvider::OpenAi, response, MAX_IMAGE_RESPONSE_BYTES).await?;
    let item = value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| "A OpenAI concluiu sem retornar a imagem.".to_string())?;
    let encoded = item
        .get("b64_json")
        .and_then(Value::as_str)
        .ok_or_else(|| "A OpenAI retornou uma imagem invalida.".to_string())?;
    validated_image(
        encoded,
        item.get("revised_prompt")
            .and_then(Value::as_str)
            .map(str::to_string),
    )
}

async fn generate_gemini_image(
    client: &Client,
    key: &str,
    prompt: &str,
) -> Result<AiProviderGeneratedImage, String> {
    let response = client
        .post(GEMINI_INTERACTIONS_URL)
        .header("x-goog-api-key", sensitive_api_key_header(key)?)
        .json(&json!({
            "model": "gemini-3.1-flash-image",
            "input": prompt,
            "response_format": {
                "type": "image",
                "mime_type": "image/png",
                "aspect_ratio": "16:9",
                "image_size": "1K"
            }
        }))
        .send()
        .await
        .map_err(|error| network_error(ApiProvider::Gemini, error))?;
    let value = read_json_response(ApiProvider::Gemini, response, MAX_IMAGE_RESPONSE_BYTES).await?;
    let encoded = extract_gemini_image(&value)
        .ok_or_else(|| "O Gemini concluiu sem retornar a imagem.".to_string())?;
    validated_image(encoded, None)
}

fn validated_image(
    encoded: &str,
    revised_prompt: Option<String>,
) -> Result<AiProviderGeneratedImage, String> {
    let (bytes, width, height) = validate_generated_png_base64(encoded)?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(AiProviderGeneratedImage {
        data_url: format!("data:image/png;base64,{encoded}"),
        mime_type: "image/png",
        width,
        height,
        revised_prompt,
    })
}

async fn read_json_response(
    provider: ApiProvider,
    response: Response,
    max_bytes: usize,
) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(provider_http_error(provider, response).await);
    }
    let bytes = read_limited_response(provider, response, max_bytes).await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "O provedor retornou uma resposta JSON invalida.".to_string())
}

async fn provider_http_error(provider: ApiProvider, mut response: Response) -> String {
    let status = response.status();
    let provider_name = provider_display_name(provider);
    let mut bytes = Vec::new();
    while bytes.len() <= MAX_ERROR_RESPONSE_BYTES {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = MAX_ERROR_RESPONSE_BYTES.saturating_sub(bytes.len());
                bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
                if chunk.len() > remaining {
                    break;
                }
            }
            Ok(None) | Err(_) => break,
        }
    }
    let detail = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.pointer("/message"))
                .and_then(Value::as_str)
                .map(safe_message)
        })
        .filter(|message| !message.is_empty());
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return format!("A chave API do {provider_name} foi recusada.");
    }
    detail.unwrap_or_else(|| {
        format!(
            "O {provider_name} recusou a solicitacao (HTTP {}).",
            status.as_u16()
        )
    })
}

async fn read_limited_response(
    provider: ApiProvider,
    mut response: Response,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err("A resposta do provedor excedeu o limite seguro.".to_string());
    }

    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(max_bytes as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| network_error(provider, error))?
    {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err("A resposta do provedor excedeu o limite seguro.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn sensitive_api_key_header(key: &str) -> Result<HeaderValue, String> {
    let mut value = HeaderValue::from_str(key)
        .map_err(|_| "A chave API contem caracteres invalidos.".to_string())?;
    value.set_sensitive(true);
    Ok(value)
}

fn network_error(provider: ApiProvider, error: reqwest::Error) -> String {
    let name = provider_display_name(provider);
    if error.is_timeout() {
        format!("A solicitacao ao {name} excedeu o tempo limite.")
    } else if error.is_connect() {
        format!("Nao foi possivel conectar ao {name}.")
    } else {
        format!("A comunicacao com o {name} falhou.")
    }
}

fn safe_message(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_ERROR_MESSAGE_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

fn extract_openai_text(value: &Value) -> Option<String> {
    if let Some(text) = value.get("output_text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            return Some(text.to_string());
        }
    }
    value
        .get("output")?
        .as_array()?
        .iter()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find_map(|content| {
            matches!(
                content.get("type").and_then(Value::as_str),
                Some("output_text") | Some("text")
            )
            .then(|| content.get("text").and_then(Value::as_str))
            .flatten()
            .filter(|text| !text.trim().is_empty())
            .map(str::to_string)
        })
}

fn extract_anthropic_text(value: &Value) -> Option<String> {
    value
        .get("content")?
        .as_array()?
        .iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("text"))
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_string)
}

fn extract_gemini_text(value: &Value) -> Option<String> {
    value
        .get("steps")?
        .as_array()?
        .iter()
        .filter(|step| step.get("type").and_then(Value::as_str) == Some("model_output"))
        .flat_map(|step| {
            step.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find(|content| content.get("type").and_then(Value::as_str) == Some("text"))
        .and_then(|content| content.get("text"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_string)
}

fn extract_gemini_image(value: &Value) -> Option<&str> {
    value
        .get("steps")?
        .as_array()?
        .iter()
        .filter(|step| step.get("type").and_then(Value::as_str) == Some("model_output"))
        .flat_map(|step| {
            step.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find(|content| {
            content.get("type").and_then(Value::as_str) == Some("image")
                && content.get("mime_type").and_then(Value::as_str) == Some("image/png")
        })
        .and_then(|content| content.get("data"))
        .and_then(Value::as_str)
}

fn validate_request(request: &AiProviderGenerateRequest) -> Result<(), String> {
    validate_request_id(&request.request_id)?;
    let provider = parse_provider(&request.provider)?;
    validate_model(provider, &request.model)?;
    normalized_effort(provider, &request.model, &request.reasoning_effort)?;
    validate_text_size(
        &request.system_prompt,
        MAX_SYSTEM_PROMPT_BYTES,
        "As instrucoes do assistente",
    )?;
    validate_text_size(&request.prompt, MAX_PROMPT_BYTES, "O contexto do canvas")?;
    if request.output_schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("O schema do plano precisa ter um objeto como raiz.".to_string());
    }
    let schema_size = serde_json::to_vec(&request.output_schema)
        .map_err(|_| "O schema do plano nao e valido.".to_string())?
        .len();
    if schema_size > MAX_OUTPUT_SCHEMA_BYTES {
        return Err("O schema do plano excede o limite seguro.".to_string());
    }
    if request.generate_image {
        let prompt = request
            .image_prompt
            .as_deref()
            .ok_or_else(|| "O pedido da imagem nao foi informado.".to_string())?;
        validate_text_size(prompt, MAX_IMAGE_PROMPT_BYTES, "O pedido da imagem")?;
    }
    Ok(())
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > MAX_REQUEST_ID_BYTES
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Identificador de solicitacao invalido.".to_string());
    }
    Ok(())
}

fn validate_text_size(value: &str, max_bytes: usize, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} nao pode estar vazio."));
    }
    if value.len() > max_bytes {
        return Err(format!("{label} excede o limite seguro."));
    }
    Ok(())
}

fn parse_provider(value: &str) -> Result<ApiProvider, String> {
    value.parse::<ApiProvider>()
}

fn validate_model(provider: ApiProvider, model: &str) -> Result<(), String> {
    let models = match provider {
        ApiProvider::OpenAi => OPENAI_MODELS,
        ApiProvider::Anthropic => ANTHROPIC_MODELS,
        ApiProvider::Gemini => GEMINI_MODELS,
    };
    if models.contains(&model) {
        Ok(())
    } else {
        Err("O modelo selecionado nao e permitido para este provedor.".to_string())
    }
}

fn normalized_effort(
    provider: ApiProvider,
    model: &str,
    effort: &str,
) -> Result<Option<&'static str>, String> {
    match provider {
        ApiProvider::OpenAi => match effort {
            "none" | "minimal" => Ok(Some("none")),
            "low" => Ok(Some("low")),
            "medium" => Ok(Some("medium")),
            "high" => Ok(Some("high")),
            "xhigh" => Ok(Some("xhigh")),
            "max" => Ok(Some("max")),
            _ => Err("Esforco de raciocinio invalido para a OpenAI.".to_string()),
        },
        ApiProvider::Anthropic if model == "claude-haiku-4-5" => match effort {
            "none" | "automatic" => Ok(None),
            _ => Err("Claude Haiku 4.5 nao oferece seletor de esforco.".to_string()),
        },
        ApiProvider::Anthropic => match effort {
            "low" => Ok(Some("low")),
            "medium" => Ok(Some("medium")),
            "high" => Ok(Some("high")),
            "xhigh" => Ok(Some("xhigh")),
            "max" => Ok(Some("max")),
            _ => Err("Esforco de raciocinio invalido para o Claude.".to_string()),
        },
        ApiProvider::Gemini => {
            let allowed = match model {
                "gemini-3.5-flash" | "gemini-3.1-flash-lite" => {
                    &["minimal", "low", "medium", "high"][..]
                }
                _ => &["low", "medium", "high"][..],
            };
            if allowed.contains(&effort) {
                Ok(Some(match effort {
                    "minimal" => "minimal",
                    "low" => "low",
                    "medium" => "medium",
                    "high" => "high",
                    _ => unreachable!(),
                }))
            } else {
                Err("Nivel de thinking invalido para o Gemini selecionado.".to_string())
            }
        }
    }
}

fn provider_display_name(provider: ApiProvider) -> &'static str {
    match provider {
        ApiProvider::OpenAi => "OpenAI",
        ApiProvider::Anthropic => "Claude",
        ApiProvider::Gemini => "Gemini",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_provider_model_and_effort_pairs() {
        assert!(validate_model(ApiProvider::OpenAi, "gpt-5.6-sol").is_ok());
        assert!(validate_model(ApiProvider::OpenAi, "claude-sonnet-5").is_err());
        assert_eq!(
            normalized_effort(ApiProvider::OpenAi, "gpt-5.6-sol", "minimal").unwrap(),
            Some("none")
        );
        assert_eq!(
            normalized_effort(ApiProvider::Anthropic, "claude-haiku-4-5", "none").unwrap(),
            None
        );
        assert!(
            normalized_effort(ApiProvider::Gemini, "gemini-3.1-pro-preview", "minimal").is_err()
        );
        assert_eq!(anthropic_max_tokens(Some("medium")), 16_384);
        assert_eq!(anthropic_max_tokens(Some("high")), 32_768);
        assert_eq!(anthropic_max_tokens(Some("xhigh")), 65_536);
        assert_eq!(anthropic_max_tokens(Some("max")), 65_536);
    }

    #[test]
    fn extracts_text_from_all_provider_shapes() {
        let openai = json!({
            "output": [{"content": [{"type": "output_text", "text": "{\"summary\":\"o\",\"commands\":[]}"}]}]
        });
        let anthropic = json!({
            "content": [{"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": "{\"summary\":\"a\",\"commands\":[]}"}]
        });
        let gemini = json!({
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": "{\"summary\":\"g\",\"commands\":[]}"}]}]
        });
        assert!(extract_openai_text(&openai).unwrap().contains("\"o\""));
        assert!(extract_anthropic_text(&anthropic)
            .unwrap()
            .contains("\"a\""));
        assert!(extract_gemini_text(&gemini).unwrap().contains("\"g\""));
    }

    #[test]
    fn extracts_only_png_gemini_images() {
        let value = json!({
            "steps": [{"type": "model_output", "content": [
                {"type": "image", "mime_type": "image/jpeg", "data": "jpeg"},
                {"type": "image", "mime_type": "image/png", "data": "png"}
            ]}]
        });
        assert_eq!(extract_gemini_image(&value), Some("png"));
    }

    #[test]
    fn validates_request_ids_without_accepting_paths_or_whitespace() {
        assert!(validate_request_id("request_123-abc").is_ok());
        assert!(validate_request_id("../secret").is_err());
        assert!(validate_request_id("has space").is_err());
    }

    #[test]
    fn sanitizes_provider_error_text() {
        let message = safe_message(" bad\nmessage\u{0000} ");
        assert_eq!(message, "badmessage");
        assert!(safe_message(&"x".repeat(800)).len() <= MAX_ERROR_MESSAGE_CHARS);
    }
}
