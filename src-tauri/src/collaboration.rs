use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{BufReader, ErrorKind, Read, Write},
    net::{Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs, UdpSocket},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

const INVITE_PREFIX: &str = "EXC1.";
const COLLABORATION_EVENT: &str = "collaboration-event";
const MAX_WIRE_MESSAGE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Default)]
pub struct CollaborationManager {
    runtime: Mutex<Option<CollaborationRuntime>>,
}

impl CollaborationManager {
    pub fn stop(&self, reason: &str) {
        stop_existing_runtime(self, reason);
    }
}

struct CollaborationRuntime {
    role: CollaborationRole,
    session_id: String,
    canvas_id: String,
    peer_id: String,
    code: Option<String>,
    stop: Arc<AtomicBool>,
    peers: Option<Arc<Mutex<HashMap<String, Sender<WireMessage>>>>>,
    outbound: Option<Sender<WireMessage>>,
    latest_payload: Option<Arc<Mutex<String>>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CollaborationRole {
    Host,
    Guest,
}

impl CollaborationRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::Host => "host",
            Self::Guest => "guest",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WireMessage {
    Hello {
        token: String,
        client_id: String,
    },
    Welcome {
        session_id: String,
        canvas_id: String,
        payload: String,
        peer_count: usize,
    },
    SceneUpdate {
        session_id: String,
        canvas_id: String,
        author_id: String,
        revision: u64,
        payload: String,
    },
    Stop {
        reason: String,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CollaborationInvite {
    version: u8,
    session_id: String,
    canvas_id: String,
    token: String,
    endpoints: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationSessionInfo {
    role: String,
    session_id: String,
    canvas_id: String,
    peer_id: String,
    code: Option<String>,
    endpoints: Vec<String>,
    peer_count: usize,
    initial_payload: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CollaborationEvent {
    kind: String,
    role: Option<String>,
    session_id: Option<String>,
    canvas_id: Option<String>,
    payload: Option<String>,
    peer_count: Option<usize>,
    message: Option<String>,
}

trait CollaborationEventSink: Clone + Send + Sync + 'static {
    fn emit_collaboration_event(&self, event: CollaborationEvent);
}

impl CollaborationEventSink for AppHandle {
    fn emit_collaboration_event(&self, event: CollaborationEvent) {
        let _ = self.emit(COLLABORATION_EVENT, event);
    }
}

#[tauri::command]
pub fn start_collaboration_session(
    app: AppHandle,
    state: State<'_, CollaborationManager>,
    canvas_id: String,
    initial_payload: String,
) -> Result<CollaborationSessionInfo, String> {
    start_collaboration_session_inner(app, state.inner(), canvas_id, initial_payload)
}

fn start_collaboration_session_inner<S: CollaborationEventSink>(
    event_sink: S,
    manager: &CollaborationManager,
    canvas_id: String,
    initial_payload: String,
) -> Result<CollaborationSessionInfo, String> {
    let canvas_id = canvas_id.trim().to_string();
    append_debug_log(&format!(
        "native start_requested canvas={canvas_id} {}",
        payload_summary(&initial_payload)
    ));

    if canvas_id.is_empty() {
        append_debug_log("native start_rejected reason=missing_canvas");
        return Err("Canvas ausente para iniciar colaboracao.".to_string());
    }

    if initial_payload.trim().is_empty() {
        append_debug_log("native start_rejected reason=missing_payload");
        return Err("Cena atual ausente para iniciar colaboracao.".to_string());
    }

    stop_existing_runtime(manager, "Sessao substituida.");

    let listener = TcpListener::bind("0.0.0.0:0").map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let session_id = random_token(12);
    let token = random_token(18);
    let peer_id = random_token(8);
    let endpoints = invite_endpoints(port);
    append_debug_log(&format!(
        "native host_listener_ready session={session_id} canvas={canvas_id} peer={peer_id} port={port} endpoints={}",
        endpoints.join(",")
    ));

    let invite = CollaborationInvite {
        version: 1,
        session_id: session_id.clone(),
        canvas_id: canvas_id.clone(),
        token: token.clone(),
        endpoints: endpoints.clone(),
    };
    let code = encode_invite(&invite)?;
    let stop = Arc::new(AtomicBool::new(false));
    let peers = Arc::new(Mutex::new(HashMap::new()));
    let latest_payload = Arc::new(Mutex::new(initial_payload.clone()));

    {
        let mut runtime = manager.runtime.lock().map_err(|error| error.to_string())?;
        *runtime = Some(CollaborationRuntime {
            role: CollaborationRole::Host,
            session_id: session_id.clone(),
            canvas_id: canvas_id.clone(),
            peer_id: peer_id.clone(),
            code: Some(code.clone()),
            stop: Arc::clone(&stop),
            peers: Some(Arc::clone(&peers)),
            outbound: None,
            latest_payload: Some(Arc::clone(&latest_payload)),
        });
    }

    spawn_host_listener(
        event_sink.clone(),
        listener,
        HostSession {
            session_id: session_id.clone(),
            canvas_id: canvas_id.clone(),
            token,
            host_peer_id: peer_id.clone(),
            stop,
            peers,
            latest_payload,
        },
    );

    emit_event(
        &event_sink,
        CollaborationEvent {
            kind: "started".to_string(),
            role: Some("host".to_string()),
            session_id: Some(session_id.clone()),
            canvas_id: Some(canvas_id.clone()),
            payload: None,
            peer_count: Some(0),
            message: Some("Colaboracao iniciada.".to_string()),
        },
    );

    Ok(CollaborationSessionInfo {
        role: "host".to_string(),
        session_id,
        canvas_id,
        peer_id,
        code: Some(code),
        endpoints,
        peer_count: 0,
        initial_payload: None,
    })
}

#[tauri::command]
pub fn join_collaboration_session(
    app: AppHandle,
    state: State<'_, CollaborationManager>,
    code: String,
) -> Result<CollaborationSessionInfo, String> {
    join_collaboration_session_inner(app, state.inner(), code)
}

fn join_collaboration_session_inner<S: CollaborationEventSink>(
    event_sink: S,
    manager: &CollaborationManager,
    code: String,
) -> Result<CollaborationSessionInfo, String> {
    append_debug_log(&format!(
        "native join_requested code_chars={}",
        code.trim().len()
    ));

    let invite = decode_invite(&code)?;
    if invite.version != 1 {
        append_debug_log(&format!(
            "native join_rejected reason=incompatible_version version={}",
            invite.version
        ));
        return Err("Codigo de colaboracao incompativel.".to_string());
    }

    stop_existing_runtime(manager, "Sessao substituida.");

    let peer_id = random_token(8);
    let mut last_error = "Nao foi possivel conectar ao host.".to_string();
    append_debug_log(&format!(
        "native join_decoded session={} canvas={} peer={} endpoints={}",
        invite.session_id,
        invite.canvas_id,
        peer_id,
        invite.endpoints.join(",")
    ));

    for endpoint in &invite.endpoints {
        append_debug_log(&format!("native guest_connect_try endpoint={endpoint}"));
        match connect_to_endpoint(endpoint) {
            Ok(mut stream) => {
                append_debug_log(&format!("native guest_connected endpoint={endpoint}"));
                stream.set_nodelay(true).ok();
                stream.set_read_timeout(Some(Duration::from_secs(12))).ok();

                send_wire_message(
                    &mut stream,
                    &WireMessage::Hello {
                        token: invite.token.clone(),
                        client_id: peer_id.clone(),
                    },
                )?;

                let mut reader =
                    BufReader::new(stream.try_clone().map_err(|error| error.to_string())?);

                let welcome = match read_wire_message(&mut reader) {
                    Ok(Some(WireMessage::Welcome {
                        session_id,
                        canvas_id,
                        payload,
                        peer_count,
                    })) => (session_id, canvas_id, payload, peer_count),
                    Ok(Some(WireMessage::Error { message })) => {
                        append_debug_log(&format!(
                            "native guest_welcome_error endpoint={endpoint} message={message}"
                        ));
                        last_error = message;
                        continue;
                    }
                    Ok(Some(_)) => {
                        append_debug_log(&format!(
                            "native guest_welcome_invalid endpoint={endpoint}"
                        ));
                        last_error = "Resposta invalida do host.".to_string();
                        continue;
                    }
                    Ok(None) => {
                        append_debug_log(&format!(
                            "native guest_welcome_timeout endpoint={endpoint}"
                        ));
                        last_error = "Tempo esgotado aguardando o host.".to_string();
                        continue;
                    }
                    Err(error) => {
                        append_debug_log(&format!(
                            "native guest_welcome_read_error endpoint={endpoint} error={error}"
                        ));
                        last_error = error;
                        continue;
                    }
                };

                let (session_id, canvas_id, payload, peer_count) = welcome;
                append_debug_log(&format!(
                    "native guest_welcome_ok session={session_id} canvas={canvas_id} peers={peer_count} {}",
                    payload_summary(&payload)
                ));
                let stop = Arc::new(AtomicBool::new(false));
                let (tx, rx) = mpsc::channel::<WireMessage>();
                let writer_stream = stream;
                let reader_stream = reader.into_inner();
                reader_stream.set_read_timeout(None).ok();

                spawn_writer_thread(
                    writer_stream,
                    rx,
                    Arc::clone(&stop),
                    format!("guest session={session_id} canvas={canvas_id} peer={peer_id}"),
                );
                spawn_guest_reader(
                    event_sink.clone(),
                    reader_stream,
                    Arc::clone(&stop),
                    session_id.clone(),
                    canvas_id.clone(),
                );

                {
                    let mut runtime = manager.runtime.lock().map_err(|error| error.to_string())?;
                    *runtime = Some(CollaborationRuntime {
                        role: CollaborationRole::Guest,
                        session_id: session_id.clone(),
                        canvas_id: canvas_id.clone(),
                        peer_id: peer_id.clone(),
                        code: None,
                        stop,
                        peers: None,
                        outbound: Some(tx),
                        latest_payload: None,
                    });
                }

                emit_event(
                    &event_sink,
                    CollaborationEvent {
                        kind: "connected".to_string(),
                        role: Some("guest".to_string()),
                        session_id: Some(session_id.clone()),
                        canvas_id: Some(canvas_id.clone()),
                        payload: None,
                        peer_count: Some(peer_count),
                        message: Some("Conectado ao host.".to_string()),
                    },
                );

                return Ok(CollaborationSessionInfo {
                    role: "guest".to_string(),
                    session_id,
                    canvas_id,
                    peer_id,
                    code: None,
                    endpoints: invite.endpoints,
                    peer_count,
                    initial_payload: Some(payload),
                });
            }
            Err(error) => {
                append_debug_log(&format!(
                    "native guest_connect_error endpoint={endpoint} error={error}"
                ));
                last_error = error;
            }
        }
    }

    append_debug_log(&format!("native join_failed error={last_error}"));
    Err(last_error)
}

#[tauri::command]
pub fn stop_collaboration_session(state: State<'_, CollaborationManager>) -> Result<(), String> {
    append_debug_log("native stop_command reason=user_or_ui");
    stop_existing_runtime(state.inner(), "Colaboracao encerrada.");
    Ok(())
}

#[tauri::command]
pub fn send_collaboration_update(
    state: State<'_, CollaborationManager>,
    payload: String,
) -> Result<(), String> {
    send_collaboration_update_inner(state.inner(), payload)
}

fn send_collaboration_update_inner(
    manager: &CollaborationManager,
    payload: String,
) -> Result<(), String> {
    if payload.trim().is_empty() {
        append_debug_log("native send_rejected reason=missing_payload");
        return Err("Cena ausente para sincronizar.".to_string());
    }

    let mut runtime = manager.runtime.lock().map_err(|error| error.to_string())?;
    if runtime
        .as_ref()
        .is_some_and(|runtime| runtime.stop.load(Ordering::Relaxed))
    {
        append_debug_log("native send_rejected reason=runtime_stopped");
        runtime.take();
        return Err("Conexao de colaboracao encerrada.".to_string());
    }

    let Some(runtime) = runtime.as_ref() else {
        append_debug_log("native send_rejected reason=no_runtime");
        return Err("Nao ha colaboracao ativa.".to_string());
    };

    append_debug_log(&format!(
        "native send_update role={} session={} canvas={} peer={} {}",
        runtime.role.as_str(),
        runtime.session_id,
        runtime.canvas_id,
        runtime.peer_id,
        payload_summary(&payload)
    ));

    let message = WireMessage::SceneUpdate {
        session_id: runtime.session_id.clone(),
        canvas_id: runtime.canvas_id.clone(),
        author_id: runtime.peer_id.clone(),
        revision: now_millis(),
        payload: payload.clone(),
    };

    match runtime.role {
        CollaborationRole::Host => {
            if let Some(latest_payload) = &runtime.latest_payload {
                if let Ok(mut latest) = latest_payload.lock() {
                    *latest = merge_payload_with_previous_files(&latest, &payload);
                }
            }

            if let Some(peers) = &runtime.peers {
                let peer_count = peers.lock().ok().map(|peers| peers.len()).unwrap_or(0);
                append_debug_log(&format!("native host_broadcast_queued peers={peer_count}"));
                broadcast_to_peers(peers, &message, None);
            }
        }
        CollaborationRole::Guest => {
            let outbound = runtime
                .outbound
                .as_ref()
                .ok_or_else(|| "Conexao com host indisponivel.".to_string())?;
            outbound.send(message).map_err(|_| {
                append_debug_log("native guest_send_queue_error reason=outbound_closed");
                "Conexao com host encerrada.".to_string()
            })?;
            append_debug_log("native guest_send_queued");
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_collaboration_status(
    state: State<'_, CollaborationManager>,
) -> Result<Option<CollaborationSessionInfo>, String> {
    get_collaboration_status_inner(state.inner())
}

fn get_collaboration_status_inner(
    manager: &CollaborationManager,
) -> Result<Option<CollaborationSessionInfo>, String> {
    let mut runtime = manager.runtime.lock().map_err(|error| error.to_string())?;
    if runtime
        .as_ref()
        .is_some_and(|runtime| runtime.stop.load(Ordering::Relaxed))
    {
        runtime.take();
        return Ok(None);
    }

    let Some(runtime) = runtime.as_ref() else {
        return Ok(None);
    };

    let peer_count = runtime
        .peers
        .as_ref()
        .and_then(|peers| peers.lock().ok().map(|peers| peers.len()))
        .unwrap_or(0);

    Ok(Some(CollaborationSessionInfo {
        role: runtime.role.as_str().to_string(),
        session_id: runtime.session_id.clone(),
        canvas_id: runtime.canvas_id.clone(),
        peer_id: runtime.peer_id.clone(),
        code: runtime.code.clone(),
        endpoints: Vec::new(),
        peer_count,
        initial_payload: None,
    }))
}

#[tauri::command]
pub fn write_collaboration_debug_log(message: String) -> Result<String, String> {
    let trimmed = message.trim();
    if !trimmed.is_empty() {
        append_debug_log(&format!("ui {trimmed}"));
    }

    Ok(collaboration_log_path().to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_collaboration_debug_log_path() -> Result<String, String> {
    let path = collaboration_log_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

struct HostSession {
    session_id: String,
    canvas_id: String,
    token: String,
    host_peer_id: String,
    stop: Arc<AtomicBool>,
    peers: Arc<Mutex<HashMap<String, Sender<WireMessage>>>>,
    latest_payload: Arc<Mutex<String>>,
}

fn spawn_host_listener<S: CollaborationEventSink>(
    event_sink: S,
    listener: TcpListener,
    session: HostSession,
) {
    thread::spawn(move || {
        append_debug_log(&format!(
            "native host_listener_loop_start session={} canvas={}",
            session.session_id, session.canvas_id
        ));
        while !session.stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, addr)) => {
                    append_debug_log(&format!(
                        "native host_accept addr={addr} session={} canvas={}",
                        session.session_id, session.canvas_id
                    ));
                    let event_sink = event_sink.clone();
                    let peer_session = session.clone_for_peer();
                    thread::spawn(move || handle_host_peer(event_sink, stream, peer_session));
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(120));
                }
                Err(error) => {
                    append_debug_log(&format!(
                        "native host_accept_error session={} canvas={} error={error}",
                        session.session_id, session.canvas_id
                    ));
                    emit_event(
                        &event_sink,
                        CollaborationEvent {
                            kind: "error".to_string(),
                            role: Some("host".to_string()),
                            session_id: Some(session.session_id.clone()),
                            canvas_id: Some(session.canvas_id.clone()),
                            payload: None,
                            peer_count: None,
                            message: Some(error.to_string()),
                        },
                    );
                    thread::sleep(Duration::from_millis(500));
                }
            }
        }
        append_debug_log(&format!(
            "native host_listener_loop_stop session={} canvas={}",
            session.session_id, session.canvas_id
        ));
    });
}

impl HostSession {
    fn clone_for_peer(&self) -> Self {
        Self {
            session_id: self.session_id.clone(),
            canvas_id: self.canvas_id.clone(),
            token: self.token.clone(),
            host_peer_id: self.host_peer_id.clone(),
            stop: Arc::clone(&self.stop),
            peers: Arc::clone(&self.peers),
            latest_payload: Arc::clone(&self.latest_payload),
        }
    }
}

fn handle_host_peer<S: CollaborationEventSink>(
    event_sink: S,
    mut stream: TcpStream,
    session: HostSession,
) {
    let peer_addr = stream
        .peer_addr()
        .map(|addr| addr.to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    append_debug_log(&format!(
        "native host_peer_start addr={peer_addr} session={} canvas={}",
        session.session_id, session.canvas_id
    ));

    stream.set_nonblocking(false).ok();
    stream.set_nodelay(true).ok();
    stream.set_read_timeout(Some(Duration::from_secs(12))).ok();

    let reader_stream = match stream.try_clone() {
        Ok(value) => value,
        Err(error) => {
            append_debug_log(&format!(
                "native host_peer_clone_error addr={peer_addr} error={error}"
            ));
            let _ = send_wire_message(
                &mut stream,
                &WireMessage::Error {
                    message: error.to_string(),
                },
            );
            return;
        }
    };
    let mut reader = BufReader::new(reader_stream);

    let peer_id = match read_wire_message(&mut reader) {
        Ok(Some(WireMessage::Hello { token, client_id })) if token == session.token => {
            append_debug_log(&format!(
                "native host_handshake_ok addr={peer_addr} peer={client_id}"
            ));
            client_id
        }
        Ok(Some(WireMessage::Hello { .. })) => {
            append_debug_log(&format!(
                "native host_handshake_invalid_token addr={peer_addr}"
            ));
            let _ = send_wire_message(
                &mut stream,
                &WireMessage::Error {
                    message: "Token de colaboracao invalido.".to_string(),
                },
            );
            return;
        }
        Ok(_) => {
            append_debug_log(&format!("native host_handshake_invalid addr={peer_addr}"));
            let _ = send_wire_message(
                &mut stream,
                &WireMessage::Error {
                    message: "Handshake de colaboracao invalido.".to_string(),
                },
            );
            return;
        }
        Err(error) => {
            append_debug_log(&format!(
                "native host_handshake_read_error addr={peer_addr} error={error}"
            ));
            let _ = send_wire_message(&mut stream, &WireMessage::Error { message: error });
            return;
        }
    };

    stream.set_read_timeout(None).ok();
    reader.get_ref().set_read_timeout(None).ok();

    let (tx, rx) = mpsc::channel::<WireMessage>();
    let payload = session
        .latest_payload
        .lock()
        .map(|payload| payload.clone())
        .unwrap_or_default();
    let peer_count = {
        let mut peers = match session.peers.lock() {
            Ok(peers) => peers,
            Err(_) => return,
        };
        peers.insert(peer_id.clone(), tx.clone());
        peers.len()
    };
    let welcome_payload_summary = payload_summary(&payload);

    if send_wire_message(
        &mut stream,
        &WireMessage::Welcome {
            session_id: session.session_id.clone(),
            canvas_id: session.canvas_id.clone(),
            payload: payload.clone(),
            peer_count,
        },
    )
    .is_err()
    {
        append_debug_log(&format!(
            "native host_welcome_send_error peer={peer_id} addr={peer_addr}"
        ));
        remove_peer(&session.peers, &peer_id);
        return;
    }
    append_debug_log(&format!(
        "native host_welcome_sent peer={peer_id} peers={peer_count} {}",
        welcome_payload_summary
    ));

    emit_event(
        &event_sink,
        CollaborationEvent {
            kind: "peerConnected".to_string(),
            role: Some("host".to_string()),
            session_id: Some(session.session_id.clone()),
            canvas_id: Some(session.canvas_id.clone()),
            payload: None,
            peer_count: Some(peer_count),
            message: Some("Visitante conectado.".to_string()),
        },
    );

    spawn_writer_thread(
        stream,
        rx,
        Arc::clone(&session.stop),
        format!(
            "host session={} canvas={} peer={peer_id}",
            session.session_id, session.canvas_id
        ),
    );

    let mut disconnect_message = "Visitante desconectado.".to_string();

    loop {
        if session.stop.load(Ordering::Relaxed) {
            break;
        }

        match read_wire_message(&mut reader) {
            Ok(Some(WireMessage::SceneUpdate {
                session_id,
                canvas_id,
                author_id,
                revision,
                payload,
            })) if session_id == session.session_id && canvas_id == session.canvas_id => {
                append_debug_log(&format!(
                    "native host_scene_update_received peer={peer_id} author={author_id} rev={revision} {}",
                    payload_summary(&payload)
                ));
                if let Ok(mut latest) = session.latest_payload.lock() {
                    *latest = merge_payload_with_previous_files(&latest, &payload);
                }

                let message = WireMessage::SceneUpdate {
                    session_id: session.session_id.clone(),
                    canvas_id: session.canvas_id.clone(),
                    author_id: author_id.clone(),
                    revision,
                    payload: payload.clone(),
                };
                broadcast_to_peers(&session.peers, &message, Some(&peer_id));
                emit_event(
                    &event_sink,
                    CollaborationEvent {
                        kind: "sceneUpdate".to_string(),
                        role: Some("host".to_string()),
                        session_id: Some(session.session_id.clone()),
                        canvas_id: Some(session.canvas_id.clone()),
                        payload: Some(payload),
                        peer_count: None,
                        message: None,
                    },
                );
            }
            Ok(Some(WireMessage::Stop { reason })) => {
                append_debug_log(&format!(
                    "native host_peer_stop_received peer={peer_id} reason={reason}"
                ));
                disconnect_message = reason;
                break;
            }
            Ok(Some(message)) => {
                append_debug_log(&format!(
                    "native host_peer_unexpected_message peer={peer_id} {}",
                    wire_message_summary(&message)
                ));
            }
            Ok(None) => {}
            Err(error) => {
                append_debug_log(&format!(
                    "native host_peer_read_error peer={peer_id} error={error}"
                ));
                disconnect_message = format!("Visitante desconectado: {error}");
                break;
            }
        }
    }

    let peer_count = remove_peer(&session.peers, &peer_id);
    append_debug_log(&format!(
        "native host_peer_removed peer={peer_id} remaining_peers={peer_count} message={disconnect_message}"
    ));
    emit_event(
        &event_sink,
        CollaborationEvent {
            kind: "peerDisconnected".to_string(),
            role: Some("host".to_string()),
            session_id: Some(session.session_id),
            canvas_id: Some(session.canvas_id),
            payload: None,
            peer_count: Some(peer_count),
            message: Some(disconnect_message),
        },
    );
}

fn spawn_writer_thread(
    mut stream: TcpStream,
    rx: mpsc::Receiver<WireMessage>,
    stop: Arc<AtomicBool>,
    label: String,
) {
    thread::spawn(move || {
        append_debug_log(&format!("native writer_start {label}"));
        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(message) => {
                    let should_stop = matches!(message, WireMessage::Stop { .. });
                    append_debug_log(&format!(
                        "native writer_send {label} {}",
                        wire_message_summary(&message)
                    ));
                    if let Err(error) = send_wire_message(&mut stream, &message) {
                        append_debug_log(&format!(
                            "native writer_send_error {label} error={error}"
                        ));
                        break;
                    }
                    if should_stop {
                        append_debug_log(&format!("native writer_stop_message_sent {label}"));
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if stop.load(Ordering::Relaxed) {
                        append_debug_log(&format!("native writer_stop_flag {label}"));
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    append_debug_log(&format!("native writer_channel_closed {label}"));
                    break;
                }
            }
        }

        let _ = stream.shutdown(Shutdown::Write);
        append_debug_log(&format!("native writer_shutdown_write {label}"));
    });
}

fn spawn_guest_reader<S: CollaborationEventSink>(
    event_sink: S,
    stream: TcpStream,
    stop: Arc<AtomicBool>,
    session_id: String,
    canvas_id: String,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        append_debug_log(&format!(
            "native guest_reader_start session={session_id} canvas={canvas_id}"
        ));

        loop {
            if stop.load(Ordering::Relaxed) {
                append_debug_log(&format!(
                    "native guest_reader_stop_flag session={session_id} canvas={canvas_id}"
                ));
                break;
            }

            match read_wire_message(&mut reader) {
                Ok(Some(WireMessage::SceneUpdate {
                    session_id: incoming_session,
                    canvas_id: incoming_canvas,
                    payload,
                    ..
                })) if incoming_session == session_id && incoming_canvas == canvas_id => {
                    append_debug_log(&format!(
                        "native guest_scene_update_received session={session_id} canvas={canvas_id} {}",
                        payload_summary(&payload)
                    ));
                    emit_event(
                        &event_sink,
                        CollaborationEvent {
                            kind: "sceneUpdate".to_string(),
                            role: Some("guest".to_string()),
                            session_id: Some(session_id.clone()),
                            canvas_id: Some(canvas_id.clone()),
                            payload: Some(payload),
                            peer_count: None,
                            message: None,
                        },
                    );
                }
                Ok(Some(WireMessage::Stop { reason })) => {
                    append_debug_log(&format!(
                        "native guest_stop_received session={session_id} canvas={canvas_id} reason={reason}"
                    ));
                    emit_event(
                        &event_sink,
                        CollaborationEvent {
                            kind: "disconnected".to_string(),
                            role: Some("guest".to_string()),
                            session_id: Some(session_id.clone()),
                            canvas_id: Some(canvas_id.clone()),
                            payload: None,
                            peer_count: Some(0),
                            message: Some(reason),
                        },
                    );
                    break;
                }
                Ok(Some(WireMessage::Error { message })) => {
                    append_debug_log(&format!(
                        "native guest_error_received session={session_id} canvas={canvas_id} message={message}"
                    ));
                    emit_event(
                        &event_sink,
                        CollaborationEvent {
                            kind: "error".to_string(),
                            role: Some("guest".to_string()),
                            session_id: Some(session_id.clone()),
                            canvas_id: Some(canvas_id.clone()),
                            payload: None,
                            peer_count: None,
                            message: Some(message),
                        },
                    );
                    break;
                }
                Ok(Some(message)) => {
                    append_debug_log(&format!(
                        "native guest_unexpected_message session={session_id} canvas={canvas_id} {}",
                        wire_message_summary(&message)
                    ));
                }
                Ok(None) => {}
                Err(error) => {
                    append_debug_log(&format!(
                        "native guest_read_error session={session_id} canvas={canvas_id} error={error}"
                    ));
                    emit_event(
                        &event_sink,
                        CollaborationEvent {
                            kind: "disconnected".to_string(),
                            role: Some("guest".to_string()),
                            session_id: Some(session_id.clone()),
                            canvas_id: Some(canvas_id.clone()),
                            payload: None,
                            peer_count: Some(0),
                            message: Some(error),
                        },
                    );
                    break;
                }
            }
        }

        stop.store(true, Ordering::Relaxed);
        append_debug_log(&format!(
            "native guest_reader_exit session={session_id} canvas={canvas_id}"
        ));
    });
}

fn stop_existing_runtime(manager: &CollaborationManager, reason: &str) {
    let runtime = match manager.runtime.lock() {
        Ok(mut runtime) => runtime.take(),
        Err(_) => None,
    };

    if let Some(runtime) = runtime {
        append_debug_log(&format!(
            "native stop_runtime role={} session={} canvas={} peer={} reason={reason}",
            runtime.role.as_str(),
            runtime.session_id,
            runtime.canvas_id,
            runtime.peer_id
        ));
        let message = WireMessage::Stop {
            reason: reason.to_string(),
        };

        if let Some(peers) = runtime.peers {
            let peer_count = peers.lock().ok().map(|peers| peers.len()).unwrap_or(0);
            append_debug_log(&format!("native stop_runtime_broadcast peers={peer_count}"));
            broadcast_to_peers(&peers, &message, None);
        }

        if let Some(outbound) = runtime.outbound {
            if outbound.send(message).is_err() {
                append_debug_log("native stop_runtime_outbound_closed");
            }
        }

        runtime.stop.store(true, Ordering::Relaxed);
    } else {
        append_debug_log(&format!("native stop_runtime_none reason={reason}"));
    }
}

fn broadcast_to_peers(
    peers: &Arc<Mutex<HashMap<String, Sender<WireMessage>>>>,
    message: &WireMessage,
    except_peer_id: Option<&str>,
) {
    let peers = match peers.lock() {
        Ok(peers) => peers,
        Err(_) => return,
    };

    for (peer_id, tx) in peers.iter() {
        if except_peer_id.is_some_and(|except| except == peer_id) {
            continue;
        }

        let _ = tx.send(message.clone());
    }
}

fn remove_peer(peers: &Arc<Mutex<HashMap<String, Sender<WireMessage>>>>, peer_id: &str) -> usize {
    match peers.lock() {
        Ok(mut peers) => {
            peers.remove(peer_id);
            peers.len()
        }
        Err(_) => 0,
    }
}

fn send_wire_message(stream: &mut TcpStream, message: &WireMessage) -> Result<(), String> {
    let data = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    let length = u32::try_from(data.len())
        .map_err(|_| "Mensagem de colaboracao muito grande.".to_string())?;

    stream
        .write_all(&length.to_be_bytes())
        .map_err(|error| error.to_string())?;
    stream.write_all(&data).map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())
}

fn read_wire_message(reader: &mut BufReader<TcpStream>) -> Result<Option<WireMessage>, String> {
    let mut header = [0u8; 4];

    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::Interrupted => return read_wire_message(reader),
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => {
            return Err("Conexao encerrada.".to_string());
        }
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            return Ok(None);
        }
        Err(error) => return Err(error.to_string()),
    }

    let length = u32::from_be_bytes(header) as usize;
    if length == 0 {
        return Ok(None);
    }

    if length > MAX_WIRE_MESSAGE_BYTES {
        return Err(format!(
            "Mensagem de colaboracao muito grande: {length} bytes."
        ));
    }

    let mut data = vec![0u8; length];
    match reader.read_exact(&mut data) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::Interrupted => {
            return Err("Frame de colaboracao interrompido.".to_string());
        }
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => {
            return Err("Frame de colaboracao incompleto.".to_string());
        }
        Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
            return Err("Tempo esgotado lendo frame de colaboracao.".to_string());
        }
        Err(error) => return Err(error.to_string()),
    }

    serde_json::from_slice(&data).map(Some).map_err(|error| {
        let prefix = String::from_utf8_lossy(&data[..data.len().min(32)]);
        format!("{error}; prefix={prefix:?}; bytes={}", data.len())
    })
}

fn merge_payload_with_previous_files(previous_payload: &str, incoming_payload: &str) -> String {
    let Ok(mut incoming) = serde_json::from_str::<serde_json::Value>(incoming_payload) else {
        return incoming_payload.to_string();
    };

    let Some(incoming_object) = incoming.as_object_mut() else {
        return incoming_payload.to_string();
    };

    let Ok(previous) = serde_json::from_str::<serde_json::Value>(previous_payload) else {
        return incoming_payload.to_string();
    };

    let Some(previous_files) = previous
        .get("files")
        .filter(|files| !is_empty_json_object(files))
    else {
        return incoming_payload.to_string();
    };

    match incoming_object.get_mut("files") {
        Some(incoming_files) if !is_empty_json_object(incoming_files) => {
            if let (Some(previous_files), Some(incoming_files)) =
                (previous_files.as_object(), incoming_files.as_object_mut())
            {
                for (file_id, file_data) in previous_files {
                    incoming_files
                        .entry(file_id.clone())
                        .or_insert_with(|| file_data.clone());
                }
            }
        }
        _ => {
            incoming_object.insert("files".to_string(), previous_files.clone());
        }
    }

    serde_json::to_string(&incoming).unwrap_or_else(|_| incoming_payload.to_string())
}

fn is_empty_json_object(value: &serde_json::Value) -> bool {
    value.as_object().is_some_and(|object| object.is_empty())
}

fn connect_to_endpoint(endpoint: &str) -> Result<TcpStream, String> {
    let mut last_error = None;

    for addr in endpoint
        .to_socket_addrs()
        .map_err(|error| format!("{endpoint}: {error}"))?
    {
        match TcpStream::connect_timeout(&addr, Duration::from_secs(5)) {
            Ok(stream) => {
                stream.set_nonblocking(false).ok();
                return Ok(stream);
            }
            Err(error) => last_error = Some(error.to_string()),
        }
    }

    Err(format!(
        "Falha ao conectar em {endpoint}: {}",
        last_error.unwrap_or_else(|| "endereco indisponivel".to_string())
    ))
}

fn invite_endpoints(port: u16) -> Vec<String> {
    let loopback_endpoint = format!("127.0.0.1:{port}");
    let mut endpoints = Vec::new();

    if let Some(ip) = default_lan_ip() {
        let endpoint = format!("{ip}:{port}");
        if endpoint != loopback_endpoint {
            endpoints.push(endpoint);
        }
    }

    endpoints.push(loopback_endpoint);
    endpoints
}

fn default_lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;

    match addr {
        SocketAddr::V4(value) if !value.ip().is_loopback() => Some(value.ip().to_string()),
        SocketAddr::V6(value) if !value.ip().is_loopback() => Some(value.ip().to_string()),
        _ => None,
    }
}

fn encode_invite(invite: &CollaborationInvite) -> Result<String, String> {
    let json = serde_json::to_vec(invite).map_err(|error| error.to_string())?;
    Ok(format!("{INVITE_PREFIX}{}", URL_SAFE_NO_PAD.encode(json)))
}

fn decode_invite(code: &str) -> Result<CollaborationInvite, String> {
    let trimmed = code.trim();
    let encoded = trimmed
        .strip_prefix(INVITE_PREFIX)
        .ok_or_else(|| "Codigo de colaboracao invalido.".to_string())?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "Codigo de colaboracao invalido.".to_string())?;

    serde_json::from_slice(&bytes).map_err(|_| "Codigo de colaboracao invalido.".to_string())
}

fn random_token(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    OsRng.fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

fn collaboration_log_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);

    base.join("Excalibur")
        .join("logs")
        .join("collaboration-debug.log")
}

fn append_debug_log(message: &str) {
    if cfg!(test) {
        return;
    }

    let path = collaboration_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} {}", now_millis(), message);
    }
}

fn payload_summary(payload: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return format!("bytes={} json=invalid", payload.len());
    };

    let elements = value
        .get("elements")
        .and_then(|elements| elements.as_array())
        .map(|elements| elements.len())
        .unwrap_or(0);
    let files = value
        .get("files")
        .and_then(|files| files.as_object())
        .map(|files| files.len())
        .unwrap_or(0);

    format!("bytes={} elements={elements} files={files}", payload.len())
}

fn wire_message_summary(message: &WireMessage) -> String {
    match message {
        WireMessage::Hello { client_id, .. } => {
            format!("hello client={client_id}")
        }
        WireMessage::Welcome {
            session_id,
            canvas_id,
            payload,
            peer_count,
        } => format!(
            "welcome session={session_id} canvas={canvas_id} peers={peer_count} {}",
            payload_summary(payload)
        ),
        WireMessage::SceneUpdate {
            session_id,
            canvas_id,
            author_id,
            revision,
            payload,
        } => format!(
            "sceneUpdate session={session_id} canvas={canvas_id} author={author_id} rev={revision} {}",
            payload_summary(payload)
        ),
        WireMessage::Stop { reason } => format!("stop reason={reason}"),
        WireMessage::Error { message } => format!("error message={message}"),
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::Condvar,
        time::{Duration, Instant},
    };

    #[derive(Clone, Default)]
    struct TestEventSink {
        events: Arc<(Mutex<Vec<CollaborationEvent>>, Condvar)>,
    }

    impl CollaborationEventSink for TestEventSink {
        fn emit_collaboration_event(&self, event: CollaborationEvent) {
            let (events, notify) = &*self.events;
            let mut events = events.lock().expect("test events should lock");
            events.push(event);
            notify.notify_all();
        }
    }

    impl TestEventSink {
        fn wait_for<F>(&self, label: &str, predicate: F) -> CollaborationEvent
        where
            F: Fn(&CollaborationEvent) -> bool,
        {
            let deadline = Instant::now() + Duration::from_secs(8);
            let (events, notify) = &*self.events;
            let mut events = events.lock().expect("test events should lock");

            loop {
                if let Some(index) = events.iter().position(&predicate) {
                    return events.remove(index);
                }

                let now = Instant::now();
                if now >= deadline {
                    panic!("timed out waiting for {label}; received events: {events:?}");
                }

                let remaining = deadline - now;
                let (next_events, wait) = notify
                    .wait_timeout(events, remaining)
                    .expect("test wait should not poison");
                events = next_events;

                if wait.timed_out() {
                    panic!("timed out waiting for {label}; received events: {events:?}");
                }
            }
        }
    }

    #[test]
    fn invite_code_round_trips_and_rejects_invalid_input() {
        let invite = CollaborationInvite {
            version: 1,
            session_id: "session-1".to_string(),
            canvas_id: "canvas-1".to_string(),
            token: "token-1".to_string(),
            endpoints: vec![
                "127.0.0.1:12345".to_string(),
                "192.168.1.10:12345".to_string(),
            ],
        };

        let code = encode_invite(&invite).expect("invite should encode");
        assert!(code.starts_with(INVITE_PREFIX));

        let decoded = decode_invite(&code).expect("invite should decode");
        assert_eq!(decoded.version, invite.version);
        assert_eq!(decoded.session_id, invite.session_id);
        assert_eq!(decoded.canvas_id, invite.canvas_id);
        assert_eq!(decoded.token, invite.token);
        assert_eq!(decoded.endpoints, invite.endpoints);
        assert!(decode_invite("invalid").is_err());
    }

    #[test]
    fn wire_protocol_transfers_large_scene_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let addr = listener.local_addr().expect("listener should expose addr");
        let payload = "x".repeat(4 * 1024 * 1024);
        let expected_len = payload.len();

        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("server should accept client");
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .expect("server should set timeout");
            let mut reader =
                BufReader::new(stream.try_clone().expect("server should clone stream"));
            let mut writer = stream;

            match read_wire_message(&mut reader).expect("server should read message") {
                Some(WireMessage::SceneUpdate {
                    session_id,
                    canvas_id,
                    author_id,
                    revision,
                    payload,
                }) => {
                    assert_eq!(session_id, "session");
                    assert_eq!(canvas_id, "canvas");
                    assert_eq!(author_id, "peer");
                    assert_eq!(revision, 42);
                    assert_eq!(payload.len(), expected_len);
                }
                other => panic!("unexpected wire message: {other:?}"),
            }

            send_wire_message(
                &mut writer,
                &WireMessage::Stop {
                    reason: "done".to_string(),
                },
            )
            .expect("server should send stop");
        });

        let mut client = TcpStream::connect(addr).expect("client should connect");
        client
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("client should set timeout");
        send_wire_message(
            &mut client,
            &WireMessage::SceneUpdate {
                session_id: "session".to_string(),
                canvas_id: "canvas".to_string(),
                author_id: "peer".to_string(),
                revision: 42,
                payload,
            },
        )
        .expect("client should send large payload");

        let mut reader = BufReader::new(client);
        match read_wire_message(&mut reader).expect("client should read stop") {
            Some(WireMessage::Stop { reason }) => assert_eq!(reason, "done"),
            other => panic!("unexpected wire response: {other:?}"),
        }

        server.join().expect("server thread should finish");
    }

    #[test]
    fn compact_payload_preserves_previous_files_for_late_joiners() {
        let previous = r#"{
            "type": "excalidraw",
            "elements": [{"id": "image-1", "x": 10}],
            "files": {
                "file-1": {
                    "id": "file-1",
                    "mimeType": "image/png",
                    "dataURL": "data:image/png;base64,abc"
                }
            }
        }"#;
        let incoming = r#"{
            "type": "excalidraw",
            "elements": [{"id": "image-1", "x": 20}]
        }"#;

        let merged = merge_payload_with_previous_files(previous, incoming);
        let value: serde_json::Value =
            serde_json::from_str(&merged).expect("merged payload should be valid json");

        assert_eq!(value["elements"][0]["x"], 20);
        assert_eq!(value["files"]["file-1"]["mimeType"], "image/png");
        assert_eq!(
            value["files"]["file-1"]["dataURL"],
            "data:image/png;base64,abc"
        );
    }

    #[test]
    fn guest_compact_update_keeps_host_snapshot_files() {
        let host_manager = CollaborationManager::default();
        let first_guest_manager = CollaborationManager::default();
        let second_guest_manager = CollaborationManager::default();
        let host_events = TestEventSink::default();
        let first_guest_events = TestEventSink::default();
        let second_guest_events = TestEventSink::default();
        let initial_payload = r#"{
            "type": "excalidraw",
            "elements": [{"id": "image-1", "x": 10}],
            "files": {
                "file-1": {
                    "id": "file-1",
                    "mimeType": "image/png",
                    "dataURL": "data:image/png;base64,abc"
                }
            }
        }"#;
        let compact_update = r#"{
            "type": "excalidraw",
            "elements": [{"id": "image-1", "x": 20}]
        }"#;

        let host_info = start_collaboration_session_inner(
            host_events.clone(),
            &host_manager,
            "canvas-a".to_string(),
            initial_payload.to_string(),
        )
        .expect("host should start collaboration");
        let mut invite = decode_invite(host_info.code.as_deref().expect("host should expose code"))
            .expect("host code should decode");
        invite
            .endpoints
            .retain(|endpoint| endpoint.starts_with("127.0.0.1:"));
        assert_eq!(invite.endpoints.len(), 1);
        let loopback_code = encode_invite(&invite).expect("loopback invite should encode");

        join_collaboration_session_inner(
            first_guest_events.clone(),
            &first_guest_manager,
            loopback_code.clone(),
        )
        .expect("first guest should join host");
        host_events.wait_for("first guest connected", |event| {
            event.kind == "peerConnected" && event.peer_count == Some(1)
        });

        send_collaboration_update_inner(&first_guest_manager, compact_update.to_string())
            .expect("guest should send compact update");
        host_events.wait_for("host received compact update", |event| {
            event.kind == "sceneUpdate" && event.payload.as_deref() == Some(compact_update)
        });

        let second_guest_info = join_collaboration_session_inner(
            second_guest_events.clone(),
            &second_guest_manager,
            loopback_code,
        )
        .expect("second guest should join host");
        let latest_payload: serde_json::Value = serde_json::from_str(
            second_guest_info
                .initial_payload
                .as_deref()
                .expect("second guest should receive latest payload"),
        )
        .expect("latest payload should be json");

        assert_eq!(latest_payload["elements"][0]["x"], 20);
        assert_eq!(latest_payload["files"]["file-1"]["mimeType"], "image/png");
        assert_eq!(
            latest_payload["files"]["file-1"]["dataURL"],
            "data:image/png;base64,abc"
        );

        host_manager.stop("done");
    }

    #[test]
    fn collaboration_runtime_connects_syncs_and_stops() {
        let host_manager = CollaborationManager::default();
        let guest_manager = CollaborationManager::default();
        let host_events = TestEventSink::default();
        let guest_events = TestEventSink::default();

        let host_info = start_collaboration_session_inner(
            host_events.clone(),
            &host_manager,
            "canvas-a".to_string(),
            "initial-scene".to_string(),
        )
        .expect("host should start collaboration");
        assert_eq!(host_info.role, "host");
        assert_eq!(host_info.canvas_id, "canvas-a");

        let mut invite = decode_invite(host_info.code.as_deref().expect("host should expose code"))
            .expect("host code should decode");
        invite
            .endpoints
            .retain(|endpoint| endpoint.starts_with("127.0.0.1:"));
        assert_eq!(invite.endpoints.len(), 1);
        let loopback_code = encode_invite(&invite).expect("loopback invite should encode");

        let guest_info =
            join_collaboration_session_inner(guest_events.clone(), &guest_manager, loopback_code)
                .expect("guest should join host");
        assert_eq!(guest_info.role, "guest");
        assert_eq!(guest_info.canvas_id, "canvas-a");
        assert_eq!(guest_info.initial_payload.as_deref(), Some("initial-scene"));

        let connected = host_events.wait_for("host peer connected", |event| {
            event.kind == "peerConnected" && event.peer_count == Some(1)
        });
        assert_eq!(connected.message.as_deref(), Some("Visitante conectado."));

        send_collaboration_update_inner(&guest_manager, "guest-update".to_string())
            .expect("guest should send update");
        let guest_update = host_events.wait_for("host scene update from guest", |event| {
            event.kind == "sceneUpdate" && event.payload.as_deref() == Some("guest-update")
        });
        assert_eq!(guest_update.role.as_deref(), Some("host"));

        send_collaboration_update_inner(&host_manager, "host-update".to_string())
            .expect("host should send update");
        let host_update = guest_events.wait_for("guest scene update from host", |event| {
            event.kind == "sceneUpdate" && event.payload.as_deref() == Some("host-update")
        });
        assert_eq!(host_update.role.as_deref(), Some("guest"));

        host_manager.stop("host closed");
        assert!(get_collaboration_status_inner(&host_manager)
            .expect("host status should be readable")
            .is_none());

        let disconnected = guest_events.wait_for("guest disconnected after host stop", |event| {
            event.kind == "disconnected" && event.message.as_deref() == Some("host closed")
        });
        assert_eq!(disconnected.peer_count, Some(0));

        for _ in 0..50 {
            if get_collaboration_status_inner(&guest_manager)
                .expect("guest status should be readable")
                .is_none()
            {
                return;
            }

            thread::sleep(Duration::from_millis(20));
        }

        panic!("guest runtime did not clear after host stop");
    }
}

fn emit_event<S: CollaborationEventSink>(event_sink: &S, event: CollaborationEvent) {
    let payload = event
        .payload
        .as_ref()
        .map(|payload| payload_summary(payload))
        .unwrap_or_else(|| "payload=none".to_string());
    append_debug_log(&format!(
        "native emit_event kind={} role={} session={} canvas={} peers={} message={} {}",
        event.kind,
        event.role.as_deref().unwrap_or("none"),
        event.session_id.as_deref().unwrap_or("none"),
        event.canvas_id.as_deref().unwrap_or("none"),
        event
            .peer_count
            .map(|count| count.to_string())
            .unwrap_or_else(|| "none".to_string()),
        event.message.as_deref().unwrap_or("none"),
        payload
    ));
    event_sink.emit_collaboration_event(event);
}
