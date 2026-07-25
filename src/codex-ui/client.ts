import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiProviderConnection,
  AiProviderId,
  AiReasoningEffort,
} from "./providers";

export type CodexBridgeStatus = {
  running: boolean;
  initialized: boolean;
  pid: number | null;
  executable: string | null;
  codexHome: string | null;
  lastError: string | null;
  stderrTail: string[];
};

export type CodexNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type CodexServerRequest = {
  id: string | number;
  method: string;
};

export type CodexProtocolError = {
  message: string;
  rawLine?: string | null;
};

export type CodexAccountResponse = {
  account:
    | {
        type: "chatgpt";
        email: string | null;
        planType: string | null;
      }
    | { type: "apiKey" }
    | { type: "amazonBedrock" }
    | null;
  requiresOpenaiAuth: boolean;
};

export type CodexLoginResponse =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | {
      type: "chatgptDeviceCode";
      loginId: string;
      verificationUrl: string;
      userCode: string;
    };

export type CodexThreadStartResponse = {
  thread: { id: string };
  model?: string;
};

export type CodexTurnStartResponse = {
  turn: { id: string; status: string };
};

export type CodexGeneratedImageResponse = {
  dataUrl: string;
  mimeType: "image/png";
  width: number;
  height: number;
  revisedPrompt: string | null;
};

export type AiProviderGeneratedImage = {
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  revisedPrompt: string | null;
};

export type AiProviderGenerateRequest = {
  requestId: string;
  provider: Exclude<AiProviderId, "chatgpt">;
  model: string;
  reasoningEffort: AiReasoningEffort;
  systemPrompt: string;
  prompt: string;
  outputSchema: unknown;
  generateImage: boolean;
  imagePrompt?: string;
};

export type AiProviderGenerateResponse = {
  text: string;
  generatedImages: AiProviderGeneratedImage[];
};

export type AiProviderTestResponse = {
  ok: boolean;
  message: string;
};

export type CodexThreadStartParams = {
  baseInstructions?: string;
  developerInstructions?: string;
  serviceName?: string;
  model?: string;
  cwd?: string;
  runtimeWorkspaceRoots?: string[];
};

export type CodexTurnStartParams = {
  threadId: string;
  input: Array<{
    type: "text";
    text: string;
    text_elements: unknown[];
  }>;
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  outputSchema: unknown;
};

export function getCodexErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (
      record.rpc &&
      typeof record.rpc === "object" &&
      typeof (record.rpc as Record<string, unknown>).message === "string"
    ) {
      return (record.rpc as Record<string, unknown>).message as string;
    }
  }
  return "Falha inesperada no Codex.";
}

function requireDesktop() {
  if (!isTauri()) {
    throw new Error("O Codex esta disponivel no aplicativo desktop.");
  }
}

export async function startCodex() {
  requireDesktop();
  return invoke<CodexBridgeStatus>("codex_start");
}

export async function getCodexStatus() {
  requireDesktop();
  return invoke<CodexBridgeStatus>("codex_status");
}

export async function readCodexAccount(refreshToken = false) {
  requireDesktop();
  return invoke<CodexAccountResponse>("codex_account_read", { refreshToken });
}

export async function loginCodexWithChatGpt() {
  requireDesktop();
  return invoke<CodexLoginResponse>("codex_login_chatgpt");
}

export async function loginCodexWithDeviceCode() {
  requireDesktop();
  return invoke<CodexLoginResponse>("codex_login_device_code");
}

export async function cancelCodexLogin(loginId: string) {
  requireDesktop();
  return invoke<{ status: "canceled" | "notFound" }>("codex_login_cancel", {
    loginId,
  });
}

export async function logoutCodex() {
  requireDesktop();
  return invoke<Record<string, never>>("codex_logout");
}

export async function startCodexThread(params: CodexThreadStartParams) {
  requireDesktop();
  return invoke<CodexThreadStartResponse>("codex_thread_start", { params });
}

export async function startCodexTurn(params: CodexTurnStartParams) {
  requireDesktop();
  return invoke<CodexTurnStartResponse>("codex_turn_start", { params });
}

export async function takeCodexGeneratedImage(token: string) {
  requireDesktop();
  return invoke<CodexGeneratedImageResponse>("codex_take_generated_image", { token });
}

export async function discardCodexGeneratedImages(tokens: string[]) {
  if (!tokens.length) {
    return 0;
  }
  requireDesktop();
  return invoke<number>("codex_discard_generated_images", { tokens });
}

export async function listAiProviders() {
  requireDesktop();
  return invoke<AiProviderConnection[]>("ai_provider_list");
}

export async function saveAiProviderApiKey(
  provider: Exclude<AiProviderId, "chatgpt">,
  apiKey: string,
) {
  requireDesktop();
  return invoke<AiProviderConnection>("ai_provider_save_api_key", {
    provider,
    apiKey,
  });
}

export async function removeAiProviderApiKey(
  provider: Exclude<AiProviderId, "chatgpt">,
) {
  requireDesktop();
  return invoke<AiProviderConnection>("ai_provider_remove_api_key", { provider });
}

export async function testAiProvider(
  provider: Exclude<AiProviderId, "chatgpt">,
  model: string,
) {
  requireDesktop();
  return invoke<AiProviderTestResponse>("ai_provider_test", { provider, model });
}

export async function generateWithAiProvider(request: AiProviderGenerateRequest) {
  requireDesktop();
  return invoke<AiProviderGenerateResponse>("ai_provider_generate", { request });
}

export async function cancelAiProviderRequest(requestId: string) {
  requireDesktop();
  return invoke<void>("ai_provider_cancel", { requestId });
}

export async function interruptCodexTurn(threadId: string, turnId: string) {
  requireDesktop();
  return invoke<Record<string, never>>("codex_turn_interrupt", {
    params: { threadId, turnId },
  });
}

export async function rejectCodexServerRequest(id: string | number, message: string) {
  requireDesktop();
  return invoke<void>("codex_respond_to_server_request", {
    response: {
      id,
      error: {
        code: -32_000,
        message,
        data: null,
      },
    },
  });
}

export async function shutdownCodex() {
  if (!isTauri()) {
    return null;
  }
  return invoke<CodexBridgeStatus>("codex_shutdown");
}

export async function listenToCodex(options: {
  onNotification: (event: CodexNotification) => void;
  onProtocolError?: (event: CodexProtocolError) => void;
  onServerRequest?: (event: CodexServerRequest) => void;
  onStatus?: (event: CodexBridgeStatus) => void;
}) {
  if (!isTauri()) {
    return () => undefined;
  }

  const unlisteners: UnlistenFn[] = [];
  try {
    unlisteners.push(
      await listen<CodexNotification>("codex://notification", (event) => {
        options.onNotification(event.payload);
      }),
    );
    unlisteners.push(
      await listen<CodexBridgeStatus>("codex://status", (event) => {
        options.onStatus?.(event.payload);
      }),
    );
    unlisteners.push(
      await listen<CodexProtocolError>("codex://protocol-error", (event) => {
        options.onProtocolError?.(event.payload);
      }),
    );
    unlisteners.push(
      await listen<CodexServerRequest>("codex://server-request", (event) => {
        options.onServerRequest?.(event.payload);
      }),
    );
  } catch (error) {
    unlisteners.forEach((unlisten) => unlisten());
    throw error;
  }

  return () => {
    unlisteners.forEach((unlisten) => unlisten());
  };
}
