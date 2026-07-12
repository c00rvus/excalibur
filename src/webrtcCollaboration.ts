import type {
  CollaborationEvent,
  CollaborationRole,
  CollaborationSessionInfo,
  CollaborationStartOptions,
} from "./collaboration";

const WEBRTC_INVITE_PREFIX = "EXCWEB1.";
const DEFAULT_SIGNALING_TIMEOUT_MS = 25_000;
const MAX_WEBRTC_PEERS = 4;
const JOIN_APPROVAL_TIMEOUT_MS = 60_000;
const MAX_SIGNAL_ERROR_BEFORE_EVENT = 3;

type SignalMessageType =
  | "join"
  | "reject"
  | "offer"
  | "answer"
  | "ice"
  | "leave";

type SignalMessage = {
  id?: number;
  from: string;
  to?: string | null;
  type: SignalMessageType;
  payload?: unknown;
};

type WebRtcWireMessage =
  | {
      type: "welcome";
      sessionId: string;
      canvasId: string;
      payload: string;
      peerCount: number;
      readOnly: boolean;
      allowGuestSaveCopy: boolean;
    }
  | {
      type: "sceneUpdate";
      sessionId: string;
      canvasId: string;
      authorId: string;
      revision: number;
      payload: string;
    }
  | {
      type: "cursorUpdate";
      sessionId: string;
      canvasId: string;
      authorId: string;
      revision: number;
      x: number;
      y: number;
      visible: boolean;
    }
  | {
      type: "stop";
      reason: string;
    }
  | {
      type: "error";
      message: string;
    };

type WebRtcInvite = {
  version: 1;
  transport: "webrtc";
  signalingUrl: string;
  roomId: string;
  sessionId: string;
  canvasId: string;
  token: string;
  iceServers: RTCIceServer[];
};

export type WebRtcCollaborationConfig = {
  signalingUrl: string;
  iceServers: RTCIceServer[];
};

type EventHandler = (event: CollaborationEvent) => void;

type RuntimeBase = {
  role: CollaborationRole;
  sessionId: string;
  canvasId: string;
  peerId: string;
  roomId: string;
  token: string;
  signalingUrl: string;
  iceServers: RTCIceServer[];
  stopped: boolean;
  lastSignalId: number;
  eventHandler: EventHandler;
  pollAbort?: AbortController;
};

type HostPeer = {
  peerId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
  pendingRemoteCandidates: RTCIceCandidateInit[];
  readOnly: boolean;
  connected: boolean;
};

type PendingApproval = {
  peerId: string;
  timer: number;
  resolve: (decision: { approved: boolean; readOnly: boolean }) => void;
};

type HostRuntime = RuntimeBase & {
  role: "host";
  code: string;
  hostOptions: CollaborationStartOptions;
  latestPayload: string;
  peers: Map<string, HostPeer>;
  pendingApprovals: Map<string, PendingApproval>;
};

type GuestRuntime = RuntimeBase & {
  role: "guest";
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  pendingRemoteCandidates: RTCIceCandidateInit[];
  readOnly: boolean;
  allowGuestSaveCopy: boolean;
  joinResolve?: (info: CollaborationSessionInfo) => void;
  joinReject?: (error: Error) => void;
};

type WebRtcRuntime = HostRuntime | GuestRuntime;

let runtime: WebRtcRuntime | null = null;
let configuredEventHandler: EventHandler | null = null;

export function setWebRtcCollaborationEventHandler(handler: EventHandler | null) {
  configuredEventHandler = handler;
}

export function isWebRtcCollaborationCode(code: string) {
  return code.trim().startsWith(WEBRTC_INVITE_PREFIX);
}

export function getDefaultIceServers(): RTCIceServer[] {
  return [{ urls: "stun:stun.l.google.com:19302" }];
}

export function getDefaultIceServersJson() {
  return JSON.stringify(getDefaultIceServers(), null, 2);
}

export function parseIceServers(value: string): RTCIceServer[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return getDefaultIceServers();
  }

  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("ICE/STUN/TURN precisa ser uma lista JSON.");
  }

  return parsed.map((server, index) => {
    if (!server || typeof server !== "object") {
      throw new Error(`Servidor ICE invalido na posicao ${index + 1}.`);
    }

    const urls = (server as RTCIceServer).urls;
    if (
      typeof urls !== "string" &&
      !(Array.isArray(urls) && urls.every((url) => typeof url === "string"))
    ) {
      throw new Error(`Servidor ICE sem urls na posicao ${index + 1}.`);
    }

    return server as RTCIceServer;
  });
}

export async function startWebRtcCollaborationSession(
  canvasId: string,
  initialPayload: string,
  options: CollaborationStartOptions,
  config: WebRtcCollaborationConfig,
) {
  const eventHandler = configuredEventHandler;
  if (!eventHandler) {
    throw new Error("Eventos de colaboracao WebRTC nao foram inicializados.");
  }

  const signalingUrl = normalizeSignalingUrl(config.signalingUrl);
  if (!signalingUrl) {
    throw new Error("Informe o servidor de sinalizacao para usar o modo internet.");
  }

  if (!supportsWebRtc()) {
    throw new Error("WebRTC nao esta disponivel neste ambiente.");
  }

  await stopWebRtcCollaborationSession("Sessao substituida.");

  const sessionId = randomToken(12);
  const token = randomToken(18);
  const peerId = randomToken(8);
  const roomId = randomToken(10);
  const invite: WebRtcInvite = {
    version: 1,
    transport: "webrtc",
    signalingUrl,
    roomId,
    sessionId,
    canvasId,
    token,
    iceServers: config.iceServers.length ? config.iceServers : getDefaultIceServers(),
  };
  const code = encodeInvite(invite);

  const hostRuntime: HostRuntime = {
    role: "host",
    sessionId,
    canvasId,
    peerId,
    roomId,
    token,
    signalingUrl,
    iceServers: invite.iceServers,
    stopped: false,
    lastSignalId: 0,
    eventHandler,
    code,
    hostOptions: options,
    latestPayload: initialPayload,
    peers: new Map(),
    pendingApprovals: new Map(),
  };

  runtime = hostRuntime;
  logWebRtc("start", `session=${sessionId} canvas=${canvasId} room=${roomId}`);
  pollSignals(hostRuntime);

  emit(hostRuntime, {
    kind: "started",
    role: "host",
    sessionId,
    canvasId,
    peerId,
    readOnly: false,
    allowGuestSaveCopy: options.allowGuestSaveCopy,
    peerCount: 0,
    message: "Colaboracao internet iniciada.",
  });

  return {
    role: "host",
    sessionId,
    canvasId,
    peerId,
    code,
    endpoints: [signalingUrl],
    peerCount: 0,
    readOnly: false,
    allowGuestSaveCopy: options.allowGuestSaveCopy,
    initialPayload: null,
  } satisfies CollaborationSessionInfo;
}

export async function joinWebRtcCollaborationSession(code: string) {
  const eventHandler = configuredEventHandler;
  if (!eventHandler) {
    throw new Error("Eventos de colaboracao WebRTC nao foram inicializados.");
  }

  if (!supportsWebRtc()) {
    throw new Error("WebRTC nao esta disponivel neste ambiente.");
  }

  const invite = decodeInvite(code);
  await stopWebRtcCollaborationSession("Sessao substituida.");

  const peerId = randomToken(8);
  const pc = createPeerConnection(invite.iceServers);
  const guestRuntime: GuestRuntime = {
    role: "guest",
    sessionId: invite.sessionId,
    canvasId: invite.canvasId,
    peerId,
    roomId: invite.roomId,
    token: invite.token,
    signalingUrl: invite.signalingUrl,
    iceServers: invite.iceServers,
    stopped: false,
    lastSignalId: 0,
    eventHandler,
    pc,
    channel: null,
    pendingRemoteCandidates: [],
    readOnly: false,
    allowGuestSaveCopy: true,
  };

  runtime = guestRuntime;
  setupGuestPeerConnection(guestRuntime);
  pollSignals(guestRuntime);

  const connected = new Promise<CollaborationSessionInfo>((resolve, reject) => {
    guestRuntime.joinResolve = resolve;
    guestRuntime.joinReject = reject;
    window.setTimeout(() => {
      if (guestRuntime.joinReject) {
        guestRuntime.joinReject(new Error("Tempo esgotado aguardando o host."));
        guestRuntime.joinReject = undefined;
      }
    }, JOIN_APPROVAL_TIMEOUT_MS + DEFAULT_SIGNALING_TIMEOUT_MS);
  });

  try {
    await postSignal(guestRuntime, {
      from: peerId,
      to: "host",
      type: "join",
      payload: {
        token: invite.token,
        peerId,
      },
    });

    logWebRtc("join", `session=${invite.sessionId} canvas=${invite.canvasId} room=${invite.roomId}`);
    return await connected;
  } catch (error) {
    await stopWebRtcCollaborationSession("Falha ao conectar.");
    throw error;
  }
}

export async function stopWebRtcCollaborationSession(reason = "Colaboracao encerrada.") {
  const current = runtime;
  if (!current) {
    return;
  }

  runtime = null;
  current.stopped = true;
  current.pollAbort?.abort();
  logWebRtc("stop", `role=${current.role} session=${current.sessionId} reason=${reason}`);

  if (current.role === "host") {
    for (const peer of current.peers.values()) {
      sendData(peer.channel, { type: "stop", reason });
      peer.pc.close();
    }

    current.peers.clear();
    for (const pending of current.pendingApprovals.values()) {
      window.clearTimeout(pending.timer);
      pending.resolve({ approved: false, readOnly: true });
    }
    current.pendingApprovals.clear();
  } else {
    if (current.channel) {
      sendData(current.channel, { type: "stop", reason });
    }
    current.pc.close();
  }
}

export async function respondWebRtcCollaborationJoinRequest(
  requestId: string,
  approved: boolean,
  readOnly: boolean,
) {
  const current = runtime;
  if (!current || current.role !== "host") {
    throw new Error("Apenas o host pode aprovar visitantes.");
  }

  const pending = current.pendingApprovals.get(requestId);
  if (!pending) {
    throw new Error("Pedido de entrada expirado ou ja respondido.");
  }

  current.pendingApprovals.delete(requestId);
  window.clearTimeout(pending.timer);
  pending.resolve({ approved, readOnly });
}

export async function sendWebRtcCollaborationUpdate(payload: string) {
  const current = runtime;
  if (!current) {
    throw new Error("Nao ha colaboracao internet ativa.");
  }

  if (current.role === "guest") {
    if (current.readOnly) {
      throw new Error("Esta sessao esta em modo somente visualizacao.");
    }

    if (!current.channel || current.channel.readyState !== "open") {
      throw new Error("Conexao WebRTC ainda nao esta pronta.");
    }

    sendData(current.channel, {
      type: "sceneUpdate",
      sessionId: current.sessionId,
      canvasId: current.canvasId,
      authorId: current.peerId,
      revision: Date.now(),
      payload,
    });
    return;
  }

  current.latestPayload = mergePayloadWithPreviousFiles(current.latestPayload, payload);
  broadcastToHostPeers(current, {
    type: "sceneUpdate",
    sessionId: current.sessionId,
    canvasId: current.canvasId,
    authorId: current.peerId,
    revision: Date.now(),
    payload,
  });
}

export async function sendWebRtcCollaborationCursorUpdate(
  x: number,
  y: number,
  visible: boolean,
) {
  const current = runtime;
  if (!current) {
    return;
  }

  const message: WebRtcWireMessage = {
    type: "cursorUpdate",
    sessionId: current.sessionId,
    canvasId: current.canvasId,
    authorId: current.peerId,
    revision: Date.now(),
    x,
    y,
    visible,
  };

  if (current.role === "host") {
    broadcastToHostPeers(current, message);
    return;
  }

  if (current.channel?.readyState === "open") {
    sendData(current.channel, message);
  }
}

export function getWebRtcCollaborationStatus(): CollaborationSessionInfo | null {
  const current = runtime;
  if (!current || current.stopped) {
    return null;
  }

  return {
    role: current.role,
    sessionId: current.sessionId,
    canvasId: current.canvasId,
    peerId: current.peerId,
    code: current.role === "host" ? current.code : null,
    endpoints: [current.signalingUrl],
    peerCount: current.role === "host" ? current.peers.size : 1,
    readOnly: current.role === "guest" ? current.readOnly : false,
    allowGuestSaveCopy:
      current.role === "guest"
        ? current.allowGuestSaveCopy
        : current.hostOptions.allowGuestSaveCopy,
    initialPayload: null,
  };
}

async function handleSignal(runtime: WebRtcRuntime, message: SignalMessage) {
  if (message.from === runtime.peerId) {
    return;
  }

  if (runtime.role === "host") {
    await handleHostSignal(runtime, message);
  } else {
    await handleGuestSignal(runtime, message);
  }
}

async function handleHostSignal(host: HostRuntime, message: SignalMessage) {
  if (message.type === "join") {
    const payload = asRecord(message.payload);
    const token = typeof payload.token === "string" ? payload.token : "";
    const peerId = typeof payload.peerId === "string" ? payload.peerId : message.from;
    if (token !== host.token) {
      await postSignal(host, {
        from: host.peerId,
        to: peerId,
        type: "reject",
        payload: { message: "Token de colaboracao invalido." },
      });
      return;
    }

    await acceptHostPeer(host, peerId);
    return;
  }

  if (message.type === "answer") {
    const peer = host.peers.get(message.from);
    if (peer) {
      await peer.pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
      await flushRemoteCandidates(peer.pc, peer.pendingRemoteCandidates);
    }
    return;
  }

  if (message.type === "ice") {
    const peer = host.peers.get(message.from);
    if (peer && message.payload) {
      await addRemoteCandidate(peer.pc, peer.pendingRemoteCandidates, message.payload as RTCIceCandidateInit);
    }
    return;
  }

  if (message.type === "leave") {
    removeHostPeer(host, message.from, "Visitante desconectado.");
  }
}

async function handleGuestSignal(guest: GuestRuntime, message: SignalMessage) {
  if (message.type === "reject") {
    const payload = asRecord(message.payload);
    const reason =
      typeof payload.message === "string" ? payload.message : "Entrada recusada pelo host.";
    guest.joinReject?.(new Error(reason));
    guest.joinReject = undefined;
    return;
  }

  if (message.type === "offer") {
    await guest.pc.setRemoteDescription(message.payload as RTCSessionDescriptionInit);
    await flushRemoteCandidates(guest.pc, guest.pendingRemoteCandidates);
    const answer = await guest.pc.createAnswer();
    await guest.pc.setLocalDescription(answer);
    await postSignal(guest, {
      from: guest.peerId,
      to: "host",
      type: "answer",
      payload: guest.pc.localDescription,
    });
    return;
  }

  if (message.type === "ice" && message.payload) {
    await addRemoteCandidate(guest.pc, guest.pendingRemoteCandidates, message.payload as RTCIceCandidateInit);
  }
}

async function acceptHostPeer(host: HostRuntime, peerId: string) {
  if (host.peers.has(peerId)) {
    return;
  }

  if (host.peers.size >= MAX_WEBRTC_PEERS) {
    await postSignal(host, {
      from: host.peerId,
      to: peerId,
      type: "reject",
      payload: { message: "Limite de visitantes atingido." },
    });
    return;
  }

  const readOnly = await resolveHostApproval(host, peerId);
  if (readOnly === null) {
    await postSignal(host, {
      from: host.peerId,
      to: peerId,
      type: "reject",
      payload: { message: "Entrada recusada pelo host." },
    });
    return;
  }

  const pc = createPeerConnection(host.iceServers);
  const channel = pc.createDataChannel("excalibur-collaboration", {
    ordered: true,
  });
  const peer: HostPeer = {
    peerId,
    pc,
    channel,
    pendingRemoteCandidates: [],
    readOnly,
    connected: false,
  };
  host.peers.set(peerId, peer);
  setupHostPeerConnection(host, peer);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await postSignal(host, {
    from: host.peerId,
    to: peerId,
    type: "offer",
    payload: pc.localDescription,
  });
}

function resolveHostApproval(host: HostRuntime, peerId: string) {
  if (!host.hostOptions.requireApproval) {
    return Promise.resolve(host.hostOptions.defaultReadOnly);
  }

  const requestId = randomToken(8);
  return new Promise<boolean | null>((resolve) => {
    const timer = window.setTimeout(() => {
      host.pendingApprovals.delete(requestId);
      resolve(null);
    }, JOIN_APPROVAL_TIMEOUT_MS);

    host.pendingApprovals.set(requestId, {
      peerId,
      timer,
      resolve: (decision) => {
        resolve(decision.approved ? decision.readOnly : null);
      },
    });

    emit(host, {
      kind: "joinRequest",
      role: "host",
      sessionId: host.sessionId,
      canvasId: host.canvasId,
      requestId,
      peerId,
      readOnly: host.hostOptions.defaultReadOnly,
      allowGuestSaveCopy: host.hostOptions.allowGuestSaveCopy,
      peerCount: host.peers.size,
      message: "Visitante aguardando aprovacao via internet.",
    });
  });
}

function setupHostPeerConnection(host: HostRuntime, peer: HostPeer) {
  peer.pc.onicecandidate = (event) => {
    if (event.candidate) {
      void postSignal(host, {
        from: host.peerId,
        to: peer.peerId,
        type: "ice",
        payload: event.candidate.toJSON(),
      });
    }
  };

  peer.pc.onconnectionstatechange = () => {
    if (
      peer.pc.connectionState === "failed" ||
      peer.pc.connectionState === "closed" ||
      peer.pc.connectionState === "disconnected"
    ) {
      removeHostPeer(host, peer.peerId, "Visitante desconectado.");
    }
  };

  peer.channel.onopen = () => {
    peer.connected = true;
    sendData(peer.channel, {
      type: "welcome",
      sessionId: host.sessionId,
      canvasId: host.canvasId,
      payload: host.latestPayload,
      peerCount: host.peers.size,
      readOnly: peer.readOnly,
      allowGuestSaveCopy: host.hostOptions.allowGuestSaveCopy,
    });

    emit(host, {
      kind: "peerConnected",
      role: "host",
      sessionId: host.sessionId,
      canvasId: host.canvasId,
      peerId: peer.peerId,
      readOnly: peer.readOnly,
      allowGuestSaveCopy: host.hostOptions.allowGuestSaveCopy,
      peerCount: host.peers.size,
      message: "Visitante conectado via internet.",
    });
  };

  peer.channel.onmessage = (event) => {
    handleHostDataMessage(host, peer, event.data);
  };

  peer.channel.onclose = () => {
    removeHostPeer(host, peer.peerId, "Visitante desconectado.");
  };
}

function setupGuestPeerConnection(guest: GuestRuntime) {
  guest.pc.onicecandidate = (event) => {
    if (event.candidate) {
      void postSignal(guest, {
        from: guest.peerId,
        to: "host",
        type: "ice",
        payload: event.candidate.toJSON(),
      });
    }
  };

  guest.pc.ondatachannel = (event) => {
    const channel = event.channel;
    guest.channel = channel;
    channel.onmessage = (messageEvent) => {
      handleGuestDataMessage(guest, messageEvent.data);
    };
    channel.onclose = () => {
      if (!guest.stopped) {
        emit(guest, {
          kind: "disconnected",
          role: "guest",
          sessionId: guest.sessionId,
          canvasId: guest.canvasId,
          message: "Conexao WebRTC encerrada.",
        });
      }
    };
  };

  guest.pc.onconnectionstatechange = () => {
    if (
      !guest.stopped &&
      (guest.pc.connectionState === "failed" ||
        guest.pc.connectionState === "closed" ||
        guest.pc.connectionState === "disconnected")
    ) {
      emit(guest, {
        kind: "disconnected",
        role: "guest",
        sessionId: guest.sessionId,
        canvasId: guest.canvasId,
        message: "Conexao WebRTC encerrada.",
      });
    }
  };
}

function handleHostDataMessage(host: HostRuntime, peer: HostPeer, raw: unknown) {
  const message = parseDataMessage(raw);
  if (!message) {
    return;
  }

  if (message.type === "sceneUpdate") {
    if (peer.readOnly) {
      sendData(peer.channel, {
        type: "error",
        message: "Visitante esta em modo somente visualizacao.",
      });
      return;
    }

    if (message.sessionId !== host.sessionId || message.canvasId !== host.canvasId) {
      return;
    }

    host.latestPayload = mergePayloadWithPreviousFiles(host.latestPayload, message.payload);
    broadcastToHostPeers(host, message, peer.peerId);
    emit(host, {
      kind: "sceneUpdate",
      role: "host",
      sessionId: host.sessionId,
      canvasId: host.canvasId,
      peerId: peer.peerId,
      readOnly: false,
      allowGuestSaveCopy: host.hostOptions.allowGuestSaveCopy,
      payload: message.payload,
    });
    return;
  }

  if (message.type === "cursorUpdate") {
    if (message.sessionId !== host.sessionId || message.canvasId !== host.canvasId) {
      return;
    }

    broadcastToHostPeers(host, message, peer.peerId);
    emit(host, {
      kind: "cursorUpdate",
      role: "host",
      sessionId: host.sessionId,
      canvasId: host.canvasId,
      peerId: message.authorId,
      payload: cursorEventPayload(message.x, message.y, message.visible, message.revision),
    });
    return;
  }

  if (message.type === "stop") {
    removeHostPeer(host, peer.peerId, message.reason);
  }
}

function handleGuestDataMessage(guest: GuestRuntime, raw: unknown) {
  const message = parseDataMessage(raw);
  if (!message) {
    return;
  }

  if (message.type === "welcome") {
    guest.readOnly = message.readOnly;
    guest.allowGuestSaveCopy = message.allowGuestSaveCopy;
    const info: CollaborationSessionInfo = {
      role: "guest",
      sessionId: message.sessionId,
      canvasId: message.canvasId,
      peerId: guest.peerId,
      code: null,
      endpoints: [guest.signalingUrl],
      peerCount: message.peerCount,
      readOnly: message.readOnly,
      allowGuestSaveCopy: message.allowGuestSaveCopy,
      initialPayload: message.payload,
    };
    guest.joinResolve?.(info);
    guest.joinResolve = undefined;
    guest.joinReject = undefined;
    emit(guest, {
      kind: "connected",
      role: "guest",
      sessionId: message.sessionId,
      canvasId: message.canvasId,
      peerId: guest.peerId,
      readOnly: message.readOnly,
      allowGuestSaveCopy: message.allowGuestSaveCopy,
      peerCount: message.peerCount,
      message: "Conectado ao host via internet.",
    });
    return;
  }

  if (message.type === "sceneUpdate") {
    emit(guest, {
      kind: "sceneUpdate",
      role: "guest",
      sessionId: message.sessionId,
      canvasId: message.canvasId,
      peerId: message.authorId,
      payload: message.payload,
    });
    return;
  }

  if (message.type === "cursorUpdate") {
    emit(guest, {
      kind: "cursorUpdate",
      role: "guest",
      sessionId: message.sessionId,
      canvasId: message.canvasId,
      peerId: message.authorId,
      payload: cursorEventPayload(message.x, message.y, message.visible, message.revision),
    });
    return;
  }

  if (message.type === "stop") {
    emit(guest, {
      kind: "disconnected",
      role: "guest",
      sessionId: guest.sessionId,
      canvasId: guest.canvasId,
      message: message.reason,
    });
    return;
  }

  if (message.type === "error") {
    emit(guest, {
      kind: "error",
      role: "guest",
      sessionId: guest.sessionId,
      canvasId: guest.canvasId,
      message: message.message,
    });
  }
}

function broadcastToHostPeers(
  host: HostRuntime,
  message: WebRtcWireMessage,
  exceptPeerId?: string,
) {
  for (const peer of host.peers.values()) {
    if (peer.peerId === exceptPeerId || peer.channel.readyState !== "open") {
      continue;
    }

    sendData(peer.channel, message);
  }
}

function removeHostPeer(host: HostRuntime, peerId: string, message: string) {
  const peer = host.peers.get(peerId);
  if (!peer) {
    return;
  }

  host.peers.delete(peerId);
  peer.pc.close();
  emit(host, {
    kind: "peerDisconnected",
    role: "host",
    sessionId: host.sessionId,
    canvasId: host.canvasId,
    peerId,
    peerCount: host.peers.size,
    message,
  });
}

function createPeerConnection(
  iceServers: RTCIceServer[],
) {
  return new RTCPeerConnection({
    iceServers: iceServers.length ? iceServers : getDefaultIceServers(),
    bundlePolicy: "balanced",
    iceCandidatePoolSize: 4,
  });
}

async function addRemoteCandidate(
  pc: RTCPeerConnection,
  queue: RTCIceCandidateInit[],
  candidate: RTCIceCandidateInit,
) {
  if (!pc.remoteDescription) {
    queue.push(candidate);
    return;
  }

  await pc.addIceCandidate(candidate);
}

async function flushRemoteCandidates(
  pc: RTCPeerConnection,
  queue: RTCIceCandidateInit[],
) {
  while (queue.length) {
    const candidate = queue.shift();
    if (candidate) {
      await pc.addIceCandidate(candidate);
    }
  }
}

async function pollSignals(current: WebRtcRuntime) {
  let errors = 0;

  while (!current.stopped && runtime === current) {
    const abort = new AbortController();
    current.pollAbort = abort;

    try {
      const messages = await fetchSignals(current, abort.signal);
      errors = 0;

      for (const message of messages) {
        if (typeof message.id === "number") {
          current.lastSignalId = Math.max(current.lastSignalId, message.id);
        }
        await handleSignal(current, message);
      }
    } catch (error) {
      if (current.stopped || abort.signal.aborted) {
        return;
      }

      errors += 1;
      logWebRtc("signal_error", error instanceof Error ? error.message : String(error));
      if (errors === MAX_SIGNAL_ERROR_BEFORE_EVENT) {
        emit(current, {
          kind: "error",
          role: current.role,
          sessionId: current.sessionId,
          canvasId: current.canvasId,
          message: "Nao foi possivel comunicar com o servidor de sinalizacao.",
        });
      }
      await delay(1_000);
    }
  }
}

async function fetchSignals(current: WebRtcRuntime, signal: AbortSignal) {
  const url = new URL(
    `${current.signalingUrl}/rooms/${encodeURIComponent(current.roomId)}/messages`,
  );
  url.searchParams.set("peerId", current.role === "host" ? "host" : current.peerId);
  url.searchParams.set("after", String(current.lastSignalId));
  url.searchParams.set("timeout", String(DEFAULT_SIGNALING_TIMEOUT_MS));

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Sinalizacao respondeu ${response.status}.`);
  }

  const data = await response.json();
  return Array.isArray(data.messages) ? (data.messages as SignalMessage[]) : [];
}

async function postSignal(current: WebRtcRuntime, message: SignalMessage) {
  const response = await fetch(
    `${current.signalingUrl}/rooms/${encodeURIComponent(current.roomId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    },
  );

  if (!response.ok) {
    throw new Error(`Falha na sinalizacao: ${response.status}.`);
  }
}

function sendData(channel: RTCDataChannel, message: WebRtcWireMessage) {
  if (channel.readyState === "open") {
    channel.send(JSON.stringify(message));
  }
}

function parseDataMessage(raw: unknown): WebRtcWireMessage | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.type !== "string") {
      return null;
    }
    return parsed as WebRtcWireMessage;
  } catch {
    return null;
  }
}

function emit(current: WebRtcRuntime, event: CollaborationEvent) {
  current.eventHandler(event);
}

function normalizeSignalingUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function encodeInvite(invite: WebRtcInvite) {
  return `${WEBRTC_INVITE_PREFIX}${base64UrlEncode(JSON.stringify(invite))}`;
}

function decodeInvite(code: string): WebRtcInvite {
  const encoded = code.trim().replace(WEBRTC_INVITE_PREFIX, "");
  if (!encoded || encoded === code.trim()) {
    throw new Error("Codigo de colaboracao internet invalido.");
  }

  const parsed = JSON.parse(base64UrlDecode(encoded)) as WebRtcInvite;
  if (
    parsed.version !== 1 ||
    parsed.transport !== "webrtc" ||
    !parsed.roomId ||
    !parsed.token ||
    !parsed.signalingUrl
  ) {
    throw new Error("Codigo de colaboracao internet invalido.");
  }

  return {
    ...parsed,
    signalingUrl: normalizeSignalingUrl(parsed.signalingUrl),
    iceServers: Array.isArray(parsed.iceServers)
      ? parsed.iceServers
      : getDefaultIceServers(),
  };
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function randomToken(bytes: number) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(36).padStart(2, "0")).join("");
}

function supportsWebRtc() {
  return typeof RTCPeerConnection !== "undefined";
}

function cursorEventPayload(x: number, y: number, visible: boolean, revision: number) {
  return JSON.stringify({ x, y, visible, revision });
}

function mergePayloadWithPreviousFiles(previousPayload: string, incomingPayload: string) {
  try {
    const incoming = JSON.parse(incomingPayload);
    const previous = JSON.parse(previousPayload);
    const previousFiles = previous?.files;

    if (!previousFiles || typeof previousFiles !== "object" || !Object.keys(previousFiles).length) {
      return incomingPayload;
    }

    if (!incoming.files || typeof incoming.files !== "object") {
      incoming.files = previousFiles;
    } else {
      incoming.files = {
        ...previousFiles,
        ...incoming.files,
      };
    }

    return JSON.stringify(incoming);
  } catch {
    return incomingPayload;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function logWebRtc(scope: string, message: string) {
  console.info(`[webrtc-collaboration] ${scope}: ${message}`);
}
