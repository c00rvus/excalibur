import { invoke, isTauri } from "@tauri-apps/api/core";

export type CollaborationRole = "host" | "guest";

export type CollaborationSessionInfo = {
  role: CollaborationRole;
  sessionId: string;
  canvasId: string;
  peerId: string;
  code?: string | null;
  endpoints: string[];
  peerCount: number;
  readOnly: boolean;
  initialPayload?: string | null;
};

export type CollaborationEvent = {
  kind:
    | "started"
    | "connected"
    | "joinRequest"
    | "peerConnected"
    | "peerDisconnected"
    | "sceneUpdate"
    | "cursorUpdate"
    | "disconnected"
    | "error";
  role?: CollaborationRole | null;
  sessionId?: string | null;
  canvasId?: string | null;
  requestId?: string | null;
  peerId?: string | null;
  readOnly?: boolean | null;
  payload?: string | null;
  peerCount?: number | null;
  message?: string | null;
};

export type CollaborationStartOptions = {
  requireApproval: boolean;
  defaultReadOnly: boolean;
};

export async function startCollaborationSession(
  canvasId: string,
  initialPayload: string,
  options: CollaborationStartOptions,
) {
  if (!isTauri()) {
    throw new Error("Colaboracao P2P esta disponivel no app desktop.");
  }

  return invoke<CollaborationSessionInfo>("start_collaboration_session", {
    canvasId,
    initialPayload,
    options,
  });
}

export async function joinCollaborationSession(code: string) {
  if (!isTauri()) {
    throw new Error("Colaboracao P2P esta disponivel no app desktop.");
  }

  return invoke<CollaborationSessionInfo>("join_collaboration_session", { code });
}

export async function stopCollaborationSession() {
  if (!isTauri()) {
    return;
  }

  return invoke<void>("stop_collaboration_session");
}

export async function respondCollaborationJoinRequest(
  requestId: string,
  approved: boolean,
  readOnly: boolean,
) {
  if (!isTauri()) {
    return;
  }

  return invoke<void>("respond_collaboration_join_request", {
    requestId,
    approved,
    readOnly,
  });
}

export async function sendCollaborationUpdate(payload: string) {
  if (!isTauri()) {
    return;
  }

  return invoke<void>("send_collaboration_update", { payload });
}

export async function sendCollaborationCursorUpdate(
  x: number,
  y: number,
  visible: boolean,
) {
  if (!isTauri()) {
    return;
  }

  return invoke<void>("send_collaboration_cursor_update", { x, y, visible });
}

export async function getCollaborationStatus() {
  if (!isTauri()) {
    return null;
  }

  return invoke<CollaborationSessionInfo | null>("get_collaboration_status");
}

export async function writeCollaborationDebugLog(message: string) {
  if (!isTauri()) {
    return null;
  }

  return invoke<string>("write_collaboration_debug_log", { message });
}

export async function getCollaborationDebugLogPath() {
  if (!isTauri()) {
    return null;
  }

  return invoke<string>("get_collaboration_debug_log_path");
}
