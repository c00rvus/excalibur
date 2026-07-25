import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import {
  CANVAS_PLAN_OUTPUT_SCHEMA,
  GENERATED_IMAGE_PLAN_OUTPUT_SCHEMA,
} from "../codex/schema";
import type {
  CanvasContext,
  CanvasPlan,
  CanvasScope,
  GeneratedImageAsset,
} from "../codex/types";
import { parseCanvasPlan } from "../codex/validation";
import type {
  CodexAccount,
  CodexChatMessage,
  CodexDeviceLogin,
} from "./CodexPanel";
import {
  cancelCodexLogin,
  cancelAiProviderRequest,
  discardCodexGeneratedImages,
  generateWithAiProvider,
  getCodexErrorMessage,
  interruptCodexTurn,
  listenToCodex,
  listAiProviders,
  loginCodexWithChatGpt,
  loginCodexWithDeviceCode,
  logoutCodex,
  readCodexAccount,
  removeAiProviderApiKey,
  rejectCodexServerRequest,
  startCodex,
  startCodexThread,
  startCodexTurn,
  saveAiProviderApiKey,
  takeCodexGeneratedImage,
  testAiProvider,
  type CodexBridgeStatus,
  type CodexNotification,
} from "./client";
import {
  getAiProviderOption,
  normalizeAiProviderPreferences,
  type AiProviderConnection,
  type AiProviderId,
  type AiReasoningEffort,
} from "./providers";
import {
  buildCodexCanvasPrompt,
  CODEX_CANVAS_BASE_INSTRUCTIONS,
  isGeneratedImageRequest,
} from "./prompt";

type UseCodexAssistantOptions = {
  active: boolean;
  canvasId: string | null;
  projectTitle: string;
  getContext: (scope: CanvasScope) => CanvasContext | null;
};

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function accountFromResponse(value: unknown): CodexAccount | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const account = record.account;
  if (!account || typeof account !== "object") {
    return null;
  }
  const data = account as Record<string, unknown>;
  if (data.type === "chatgpt") {
    return {
      type: "chatgpt",
      email: typeof data.email === "string" ? data.email : null,
      planType: typeof data.planType === "string" ? data.planType : null,
    };
  }
  return null;
}

function eventString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function requireHttpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("O Codex retornou um endereço de login inválido.");
  }
  return url.toString();
}

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const AI_PREFERENCES_KEY = "excalibur.ai-provider-preferences.v1";

function loadAiProviderPreferences() {
  try {
    const value = window.localStorage.getItem(AI_PREFERENCES_KEY);
    return normalizeAiProviderPreferences(value ? JSON.parse(value) : null);
  } catch {
    return normalizeAiProviderPreferences(null);
  }
}

function validateGeneratedImage(asset: {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  revisedPrompt: string | null;
}) {
  if (
    asset.mimeType !== "image/png" ||
    !asset.dataUrl.startsWith("data:image/png;base64,") ||
    !Number.isInteger(asset.width) ||
    !Number.isInteger(asset.height) ||
    asset.width < 1 ||
    asset.height < 1
  ) {
    throw new Error("O Codex retornou uma imagem invalida.");
  }

  return {
    fileId: crypto.randomUUID() as FileId,
    dataURL: asset.dataUrl as DataURL,
    mimeType: "image/png",
    width: asset.width,
    height: asset.height,
    revisedPrompt: asset.revisedPrompt ?? undefined,
  } satisfies GeneratedImageAsset;
}

export function parseAssistantCanvasPlan(text: string, generatedImageMode: boolean) {
  const decoded = JSON.parse(text) as unknown;
  if (
    generatedImageMode &&
    decoded &&
    typeof decoded === "object" &&
    !Array.isArray(decoded)
  ) {
    const record = decoded as Record<string, unknown>;
    if (typeof record.summary === "string" && !record.summary.trim()) {
      record.summary = "Imagem gerada e pronta para adicionar ao canvas.";
    }
  }
  return parseCanvasPlan(decoded);
}

export function resolveReadyAiProvider(
  preferredProvider: AiProviderId,
  connections: readonly AiProviderConnection[],
  chatGptReady: boolean,
): AiProviderId | null {
  const preferredConnection = connections.find(
    (connection) => connection.provider === preferredProvider,
  );
  const preferredReady =
    preferredProvider === "chatgpt" ? chatGptReady : Boolean(preferredConnection?.hasKey);

  if (preferredReady) {
    return preferredProvider;
  }
  if (chatGptReady) {
    return "chatgpt";
  }
  return (
    connections.find(
      (connection) => connection.provider !== "chatgpt" && connection.hasKey,
    )?.provider ?? null
  );
}

export function useCodexAssistant({
  active,
  canvasId,
  projectTitle,
  getContext,
}: UseCodexAssistantOptions) {
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [providerConnections, setProviderConnections] = useState<AiProviderConnection[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerPreferences, setProviderPreferences] = useState(loadAiProviderPreferences);
  const [providerSettingsBusy, setProviderSettingsBusy] = useState(false);
  const [authDiscoveryComplete, setAuthDiscoveryComplete] = useState(false);
  const [authDiscoveryRevision, setAuthDiscoveryRevision] = useState(0);
  const [bridgeStatus, setBridgeStatus] = useState<CodexBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceLogin, setDeviceLogin] = useState<CodexDeviceLogin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [messages, setMessages] = useState<CodexChatMessage[]>([]);
  const [plan, setPlan] = useState<CanvasPlan | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImageAsset[]>([]);
  const [scope, setScopeState] = useState<CanvasScope>("canvas");
  const [status, setStatus] = useState("Pronto");

  const accountRef = useRef<CodexAccount | null>(null);
  const authDiscoveryRevisionRef = useRef(0);
  const activeCanvasIdRef = useRef<string | null>(canvasId);
  const assistantActiveRef = useRef(active);
  const activeProviderRef = useRef<AiProviderId>(providerPreferences.provider);
  const activeProviderRequestIdRef = useRef<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const activeTurnStartedRef = useRef(false);
  const cancelPendingRef = useRef(false);
  const finalPlanReceivedRef = useRef(false);
  const finalPlanHasCommandsRef = useRef(false);
  const generatedImageModeRef = useRef(false);
  const generatedImageTokensRef = useRef<string[]>([]);
  const pendingFinalPlanRef = useRef<CanvasPlan | null>(null);
  const bridgeStatusRef = useRef<CodexBridgeStatus | null>(null);
  const initializedRef = useRef(false);
  const initializingRef = useRef(false);
  const loginTimeoutRef = useRef<number | null>(null);
  const loginStartingRef = useRef(false);
  const messageStoreRef = useRef(new Map<string, CodexChatMessage[]>());
  const pendingLoginIdRef = useRef<string | null>(null);
  const providerConnectionsRef = useRef<AiProviderConnection[]>([]);
  const turnRequestActiveRef = useRef(false);
  const turnCanvasIdRef = useRef<string | null>(null);

  assistantActiveRef.current = active;

  const completeAuthDiscovery = useCallback(() => {
    const nextRevision = authDiscoveryRevisionRef.current + 1;
    authDiscoveryRevisionRef.current = nextRevision;
    setAuthDiscoveryRevision(nextRevision);
    setAuthDiscoveryComplete(true);
  }, []);

  const clearPendingLogin = useCallback(() => {
    pendingLoginIdRef.current = null;
    loginStartingRef.current = false;
    setLoginPending(false);
    if (loginTimeoutRef.current !== null) {
      window.clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
  }, []);

  const beginPendingLogin = useCallback((loginId: string) => {
    pendingLoginIdRef.current = loginId;
    setLoginPending(true);
    if (loginTimeoutRef.current !== null) {
      window.clearTimeout(loginTimeoutRef.current);
    }
    loginTimeoutRef.current = window.setTimeout(() => {
      if (pendingLoginIdRef.current !== loginId) {
        return;
      }
      void cancelCodexLogin(loginId)
        .catch(() => undefined)
        .finally(() => {
          if (pendingLoginIdRef.current === loginId) {
            pendingLoginIdRef.current = null;
            loginTimeoutRef.current = null;
            setLoginPending(false);
            setDeviceLogin(null);
            setBusy(false);
            setStatus("Login expirado");
          }
        });
    }, LOGIN_TIMEOUT_MS);
  }, []);

  const storeMessages = useCallback((targetCanvasId: string, next: CodexChatMessage[]) => {
    messageStoreRef.current.set(targetCanvasId, next);
    if (activeCanvasIdRef.current === targetCanvasId) {
      setMessages(next);
    }
  }, []);

  const appendMessage = useCallback(
    (targetCanvasId: string, message: CodexChatMessage) => {
      const next = [...(messageStoreRef.current.get(targetCanvasId) ?? []), message];
      storeMessages(targetCanvasId, next);
    },
    [storeMessages],
  );

  useEffect(() => {
    activeProviderRef.current = providerPreferences.provider;
    window.localStorage.setItem(AI_PREFERENCES_KEY, JSON.stringify(providerPreferences));
  }, [providerPreferences]);

  const refreshProviderConnections = useCallback(async () => {
    const connections = await listAiProviders();
    providerConnectionsRef.current = connections;
    setProviderConnections(connections);
    return connections;
  }, []);

  const setProvider = useCallback((provider: AiProviderId) => {
    activeProviderRef.current = provider;
    setProviderPreferences((current) =>
      normalizeAiProviderPreferences({ ...current, provider, model: undefined }),
    );
    setPlan(null);
    setGeneratedImages([]);
    setProviderError(null);
  }, []);

  const setProviderModel = useCallback((model: string) => {
    setProviderPreferences((current) =>
      normalizeAiProviderPreferences({ ...current, model, reasoningEffort: undefined }),
    );
  }, []);

  const setProviderReasoningEffort = useCallback((reasoningEffort: AiReasoningEffort) => {
    setProviderPreferences((current) =>
      normalizeAiProviderPreferences({ ...current, reasoningEffort }),
    );
  }, []);

  const saveProviderApiKey = useCallback(
    async (provider: Exclude<AiProviderId, "chatgpt">, apiKey: string) => {
      setProviderSettingsBusy(true);
      setProviderError(null);
      try {
        const connection = await saveAiProviderApiKey(provider, apiKey);
        const nextConnections = [
          ...providerConnectionsRef.current.filter((item) => item.provider !== provider),
          connection,
        ];
        providerConnectionsRef.current = nextConnections;
        setProviderConnections(nextConnections);
        setProvider(provider);
      } catch (nextError) {
        const message = getCodexErrorMessage(nextError);
        setProviderError(message);
        throw nextError;
      } finally {
        setProviderSettingsBusy(false);
      }
    },
    [setProvider],
  );

  const removeProviderApiKey = useCallback(
    async (provider: Exclude<AiProviderId, "chatgpt">) => {
      setProviderSettingsBusy(true);
      setProviderError(null);
      try {
        const connection = await removeAiProviderApiKey(provider);
        const nextConnections = [
          ...providerConnectionsRef.current.filter((item) => item.provider !== provider),
          connection,
        ];
        providerConnectionsRef.current = nextConnections;
        setProviderConnections(nextConnections);
        if (activeProviderRef.current === provider) {
          const chatGptReady = Boolean(
            accountRef.current &&
              bridgeStatusRef.current?.running &&
              bridgeStatusRef.current.initialized,
          );
          setProvider(
            resolveReadyAiProvider(provider, nextConnections, chatGptReady) ?? "chatgpt",
          );
        }
      } catch (nextError) {
        setProviderError(getCodexErrorMessage(nextError));
        throw nextError;
      } finally {
        setProviderSettingsBusy(false);
      }
    },
    [setProvider],
  );

  const testProviderConnection = useCallback(
    async (provider: Exclude<AiProviderId, "chatgpt">) => {
      setProviderSettingsBusy(true);
      setProviderError(null);
      try {
        const providerOption = getAiProviderOption(provider);
        const model =
          provider === providerPreferences.provider
            ? providerPreferences.model
            : providerOption.defaultModel;
        const response = await testAiProvider(provider, model);
        if (!response.ok) {
          throw new Error(response.message || "A conexao nao foi confirmada.");
        }
        return response.message || "Conexao confirmada.";
      } catch (nextError) {
        setProviderError(getCodexErrorMessage(nextError));
        throw nextError;
      } finally {
        setProviderSettingsBusy(false);
      }
    },
    [providerPreferences],
  );

  const refreshAccount = useCallback(async (refreshToken = false) => {
    const response = await readCodexAccount(refreshToken);
    const nextAccount = accountFromResponse(response);
    accountRef.current = nextAccount;
    setAccount(nextAccount);
    const resolvedProvider = resolveReadyAiProvider(
      activeProviderRef.current,
      providerConnectionsRef.current,
      Boolean(
        nextAccount && bridgeStatusRef.current?.running && bridgeStatusRef.current.initialized,
      ),
    );
    if (resolvedProvider && resolvedProvider !== activeProviderRef.current) {
      setProvider(resolvedProvider);
    }
    if (response.account && !nextAccount) {
      setError("O assistente do canvas requer autenticação com ChatGPT.");
      setStatus("Entrar com ChatGPT");
    }
    return nextAccount;
  }, [setProvider]);

  const interruptActiveTurn = useCallback(async () => {
    const threadId = activeThreadIdRef.current;
    const turnId = activeTurnIdRef.current;
    if (!threadId || !turnId) {
      return;
    }
    await interruptCodexTurn(threadId, turnId);
  }, []);

  const discardGeneratedImageTokens = useCallback((tokens: readonly string[]) => {
    if (!tokens.length) {
      return;
    }
    void discardCodexGeneratedImages([...tokens]).catch(() => undefined);
  }, []);

  const resetActiveTurn = useCallback(() => {
    setBusy(false);
    turnRequestActiveRef.current = false;
    activeTurnIdRef.current = null;
    activeTurnStartedRef.current = false;
    activeThreadIdRef.current = null;
    cancelPendingRef.current = false;
    turnCanvasIdRef.current = null;
    generatedImageModeRef.current = false;
    generatedImageTokensRef.current = [];
    pendingFinalPlanRef.current = null;
  }, []);

  const handleNotification = useCallback(
    (notification: CodexNotification) => {
      const params = notification.params ?? {};
      const notificationThreadId = eventString(params.threadId);
      const notificationTurn = params.turn;
      const notificationTurnId =
        eventString(params.turnId) ||
        (notificationTurn && typeof notificationTurn === "object"
          ? eventString((notificationTurn as Record<string, unknown>).id)
          : null);
      const belongsToActiveTurn =
        Boolean(activeThreadIdRef.current) &&
        (!notificationThreadId || notificationThreadId === activeThreadIdRef.current) &&
        (!notificationTurnId ||
          !activeTurnIdRef.current ||
          notificationTurnId === activeTurnIdRef.current);

      if (notification.method === "account/login/completed") {
        const loginId = eventString(params.loginId);
        if (!loginId || loginId !== pendingLoginIdRef.current) {
          return;
        }
        clearPendingLogin();
        const success = params.success === true;
        setBusy(false);
        turnRequestActiveRef.current = false;
        setDeviceLogin(null);
        if (!success) {
          setError(eventString(params.error) || "Nao foi possivel entrar com ChatGPT.");
          setStatus("Login nao concluido");
          return;
        }
        void refreshAccount(true)
          .then((nextAccount) => {
            if (!nextAccount) {
              throw new Error("O login terminou, mas a conta não pôde ser confirmada.");
            }
            setError(null);
            setStatus("Conectado");
          })
          .catch((nextError) => {
            setError(getCodexErrorMessage(nextError));
            setStatus("Falha ao confirmar login");
          });
        return;
      }

      if (notification.method === "account/updated") {
        if (pendingLoginIdRef.current) {
          return;
        }
        void refreshAccount(false).catch(() => undefined);
        return;
      }

      if (notification.method === "turn/started") {
        const threadId = eventString(params.threadId);
        const turn = params.turn;
        const turnId =
          turn && typeof turn === "object"
            ? eventString((turn as Record<string, unknown>).id)
            : null;
        if (
          threadId &&
          turnId &&
          threadId === activeThreadIdRef.current &&
          (!activeTurnIdRef.current || turnId === activeTurnIdRef.current)
        ) {
          activeTurnIdRef.current = turnId;
          activeTurnStartedRef.current = true;
          if (cancelPendingRef.current) {
            cancelPendingRef.current = false;
            void interruptActiveTurn().catch((nextError) => {
              setError(getCodexErrorMessage(nextError));
            });
          }
        }
        return;
      }

      if (notification.method === "item/started") {
        if (!belongsToActiveTurn) {
          return;
        }
        const item = params.item;
        if (
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "imageGeneration"
        ) {
          setStatus("Gerando imagem; isso pode levar alguns minutos");
        }
        return;
      }

      if (notification.method === "item/agentMessage/delta") {
        if (!belongsToActiveTurn) {
          return;
        }
        setStatus("Preparando alteracoes");
        return;
      }

      if (notification.method === "item/completed") {
        if (!belongsToActiveTurn) {
          return;
        }
        const item = params.item;
        if (!item || typeof item !== "object") {
          return;
        }
        const itemRecord = item as Record<string, unknown>;
        if (itemRecord.type === "imageGeneration") {
          const token = eventString(itemRecord.assetToken);
          const imageStatus = eventString(itemRecord.status);
          if (!generatedImageModeRef.current) {
            if (token) {
              discardGeneratedImageTokens([token]);
            }
            setError("O Codex tentou gerar uma imagem fora do modo de imagem.");
            return;
          }
          if (imageStatus !== "completed" || !token) {
            setError(
              eventString(itemRecord.assetError) ||
                "Nao foi possivel gerar a imagem solicitada.",
            );
            return;
          }
          if (!generatedImageTokensRef.current.includes(token)) {
            generatedImageTokensRef.current.push(token);
          }
          setStatus("Imagem gerada; preparando previa");
          return;
        }
        if (itemRecord.type !== "agentMessage" || itemRecord.phase !== "final_answer") {
          return;
        }
        const text = eventString(itemRecord.text);
        const targetCanvasId = turnCanvasIdRef.current;
        if (!text || !targetCanvasId) {
          return;
        }

        try {
          const parsed = parseAssistantCanvasPlan(text, generatedImageModeRef.current);
          finalPlanReceivedRef.current = true;
          finalPlanHasCommandsRef.current = parsed.commands.length > 0;
          pendingFinalPlanRef.current = parsed;
          appendMessage(targetCanvasId, {
            id: createMessageId("codex"),
            role: "assistant",
            text: parsed.summary,
          });
        } catch (nextError) {
          setError(getCodexErrorMessage(nextError));
        }
        return;
      }

      if (notification.method === "error") {
        if ((notificationThreadId || notificationTurnId) && !belongsToActiveTurn) {
          return;
        }
        const eventError = params.error;
        const message =
          eventError && typeof eventError === "object"
            ? eventString((eventError as Record<string, unknown>).message)
            : null;
        if (message) {
          setError(message);
        }
        return;
      }

      if (notification.method === "turn/completed") {
        if (!belongsToActiveTurn) {
          return;
        }
        const turn = params.turn;
        const turnRecord =
          turn && typeof turn === "object" ? (turn as Record<string, unknown>) : {};
        const turnStatus = eventString(turnRecord.status);
        const turnError = turnRecord.error;

        const targetCanvasId = turnCanvasIdRef.current;
        const pendingPlan = pendingFinalPlanRef.current;
        const imageMode = generatedImageModeRef.current;
        const imageTokens = [...generatedImageTokensRef.current];

        if (turnStatus === "interrupted") {
          discardGeneratedImageTokens(imageTokens);
          setStatus("Interrompido");
          resetActiveTurn();
        } else if (turnStatus === "failed") {
          discardGeneratedImageTokens(imageTokens);
          const message =
            turnError && typeof turnError === "object"
              ? eventString((turnError as Record<string, unknown>).message)
              : null;
          setError(message || "O Codex nao concluiu a solicitacao.");
          setStatus("Falha");
          resetActiveTurn();
        } else if (!finalPlanReceivedRef.current) {
          discardGeneratedImageTokens(imageTokens);
          setError("O Codex concluiu sem retornar um plano valido.");
          setStatus("Resposta invalida");
          resetActiveTurn();
        } else {
          void (async () => {
            try {
              if (!pendingPlan || !targetCanvasId) {
                throw new Error("O Codex concluiu sem retornar um plano valido.");
              }

              const imageCommands = pendingPlan.commands.filter(
                (command) => command.type === "createGeneratedImage",
              );
              let nextGeneratedImages: GeneratedImageAsset[] = [];

              if (imageMode) {
                if (!pendingPlan.commands.length) {
                  discardGeneratedImageTokens(imageTokens);
                } else if (
                  pendingPlan.commands.length !== 1 ||
                  imageCommands.length !== 1 ||
                  imageCommands[0].sourceIndex !== 0 ||
                  imageTokens.length !== 1
                ) {
                  discardGeneratedImageTokens(imageTokens);
                  throw new Error(
                    "A geracao nao retornou exatamente uma imagem valida para o canvas.",
                  );
                } else {
                  setStatus("Carregando imagem gerada");
                  nextGeneratedImages = [
                    validateGeneratedImage(
                      await takeCodexGeneratedImage(imageTokens[0]),
                    ),
                  ];
                }
              } else if (imageTokens.length) {
                discardGeneratedImageTokens(imageTokens);
                throw new Error("O Codex retornou uma imagem inesperada.");
              }

              if (activeCanvasIdRef.current !== targetCanvasId) {
                throw new Error("O canvas ativo mudou durante a solicitacao.");
              }

              setGeneratedImages(nextGeneratedImages);
              setPlan(pendingPlan.commands.length ? pendingPlan : null);
              setStatus(
                finalPlanHasCommandsRef.current ? "Previa pronta" : "Concluido",
              );
            } catch (nextError) {
              setGeneratedImages([]);
              setPlan(null);
              setError(getCodexErrorMessage(nextError));
              setStatus("Falha");
            } finally {
              resetActiveTurn();
            }
          })();
        }
      }
    },
    [
      appendMessage,
      clearPendingLogin,
      discardGeneratedImageTokens,
      interruptActiveTurn,
      refreshAccount,
      resetActiveTurn,
    ],
  );

  useEffect(() => {
    let activeListener = true;
    let cleanup: (() => void) | undefined;

    listenToCodex({
      onNotification: handleNotification,
      onProtocolError: (event) => {
        if (activeListener) {
          setError(event.message);
        }
      },
      onServerRequest: (request) => {
        void rejectCodexServerRequest(
          request.id,
          "O Excalibur nao permite ferramentas externas neste assistente.",
        ).catch(() => undefined);
      },
      onStatus: (nextStatus) => {
        if (!activeListener) {
          return;
        }
        bridgeStatusRef.current = nextStatus;
        setBridgeStatus(nextStatus);
        initializedRef.current = nextStatus.initialized;
        if (!nextStatus.initialized) {
          if (activeProviderRef.current !== "chatgpt") {
            return;
          }
          activeThreadIdRef.current = null;
          activeTurnIdRef.current = null;
          activeTurnStartedRef.current = false;
          turnRequestActiveRef.current = false;
          cancelPendingRef.current = false;
          turnCanvasIdRef.current = null;
          clearPendingLogin();
          setGeneratedImages([]);
          setPlan(null);
          setBusy(false);
          setError(
            nextStatus.lastError ||
              (nextStatus.running
                ? "O Codex precisa ser reiniciado."
                : "O processo Codex foi encerrado."),
          );
          setStatus("Codex indisponivel");
        }
      },
    })
      .then((unlisten) => {
        if (activeListener) {
          cleanup = unlisten;
        } else {
          unlisten();
        }
      })
      .catch((nextError) => {
        if (activeListener) {
          setError(getCodexErrorMessage(nextError));
          setStatus("Codex indisponivel");
        }
      });

    return () => {
      activeListener = false;
      cleanup?.();
    };
  }, [clearPendingLogin, handleNotification]);

  useEffect(
    () => () => {
      if (loginTimeoutRef.current !== null) {
        window.clearTimeout(loginTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    activeCanvasIdRef.current = canvasId;
    setMessages(canvasId ? messageStoreRef.current.get(canvasId) ?? [] : []);
    setPlan(null);
    setGeneratedImages([]);
    setScopeState(canvasId ? "viewport" : "canvas");
  }, [canvasId]);

  const initialize = useCallback(async () => {
    if (initializingRef.current) {
      return;
    }
    if (!isTauri()) {
      setError("O Codex esta disponivel no aplicativo desktop.");
      setStatus("Codex indisponivel");
      completeAuthDiscovery();
      return;
    }

    initializingRef.current = true;
    setInitializing(true);
    if (authDiscoveryRevisionRef.current === 0) {
      setAuthDiscoveryComplete(false);
    }
    setError(null);
    setProviderError(null);
    setStatus("Verificando acessos");
    let connections: AiProviderConnection[] = [];
    let chatGptError: string | null = null;
    let chatGptReady = false;

    try {
      try {
        connections = await refreshProviderConnections();
      } catch (nextError) {
        // A failure in an optional API-key store must never make the existing
        // ChatGPT authentication path unavailable.
        providerConnectionsRef.current = [];
        setProviderConnections([]);
        setProviderError(getCodexErrorMessage(nextError));
      }

      try {
        const nextStatus = await startCodex();
        bridgeStatusRef.current = nextStatus;
        setBridgeStatus(nextStatus);
        initializedRef.current = nextStatus.initialized;
        if (!nextStatus.initialized) {
          throw new Error(nextStatus.lastError || "O Codex não concluiu a inicialização.");
        }
        const nextAccount = await refreshAccount(false);
        chatGptReady = Boolean(nextAccount);
      } catch (nextError) {
        initializedRef.current = false;
        bridgeStatusRef.current = null;
        setBridgeStatus(null);
        accountRef.current = null;
        setAccount(null);
        chatGptError = getCodexErrorMessage(nextError);
      }

      const preferredProvider = activeProviderRef.current;
      const resolvedProvider = resolveReadyAiProvider(
        preferredProvider,
        connections,
        chatGptReady,
      );

      if (resolvedProvider) {
        if (resolvedProvider !== preferredProvider) {
          setProvider(resolvedProvider);
        }
        setError(null);
        setStatus("Pronto");
      } else if (chatGptError) {
        setError(chatGptError);
        setStatus("Codex indisponivel");
      } else {
        setError(null);
        setStatus("Conectar provedor");
      }
    } finally {
      initializingRef.current = false;
      setInitializing(false);
      if (assistantActiveRef.current) {
        completeAuthDiscovery();
      }
    }
  }, [completeAuthDiscovery, refreshAccount, refreshProviderConnections, setProvider]);

  useEffect(() => {
    if (active) {
      void initialize();
    }
  }, [active, initialize]);

  const login = useCallback(async () => {
    if (pendingLoginIdRef.current || loginStartingRef.current) {
      return;
    }
    loginStartingRef.current = true;
    setBusy(true);
    setDeviceLogin(null);
    setError(null);
    setStatus("Aguardando login");
    let loginId: string | null = null;
    try {
      const response = await loginCodexWithChatGpt();
      if (response.type !== "chatgpt") {
        throw new Error("Fluxo de login inesperado.");
      }
      loginId = response.loginId;
      const authUrl = requireHttpsUrl(response.authUrl);
      beginPendingLogin(loginId);
      loginStartingRef.current = false;
      await openUrl(authUrl);
    } catch (nextError) {
      loginStartingRef.current = false;
      if (loginId && pendingLoginIdRef.current === loginId) {
        await cancelCodexLogin(loginId).catch(() => undefined);
      }
      clearPendingLogin();
      setBusy(false);
      setError(getCodexErrorMessage(nextError));
    }
  }, [beginPendingLogin, clearPendingLogin]);

  const loginWithDeviceCode = useCallback(async () => {
    if (pendingLoginIdRef.current || loginStartingRef.current) {
      return;
    }
    loginStartingRef.current = true;
    setBusy(true);
    setDeviceLogin(null);
    setError(null);
    setStatus("Aguardando login");
    let loginId: string | null = null;
    try {
      const response = await loginCodexWithDeviceCode();
      if (response.type !== "chatgptDeviceCode") {
        throw new Error("Fluxo de login inesperado.");
      }
      loginId = response.loginId;
      const verificationUrl = requireHttpsUrl(response.verificationUrl);
      beginPendingLogin(loginId);
      loginStartingRef.current = false;
      setDeviceLogin({
        verificationUrl,
        userCode: response.userCode,
      });
    } catch (nextError) {
      loginStartingRef.current = false;
      if (loginId && pendingLoginIdRef.current === loginId) {
        await cancelCodexLogin(loginId).catch(() => undefined);
      }
      clearPendingLogin();
      setBusy(false);
      setError(getCodexErrorMessage(nextError));
    }
  }, [beginPendingLogin, clearPendingLogin]);

  const cancelLogin = useCallback(async () => {
    const loginId = pendingLoginIdRef.current;
    if (!loginId) {
      return;
    }

    setStatus("Cancelando login");
    let cancelStatus: "canceled" | "notFound";
    try {
      ({ status: cancelStatus } = await cancelCodexLogin(loginId));
    } catch (nextError) {
      if (pendingLoginIdRef.current === loginId) {
        setError(getCodexErrorMessage(nextError));
        setStatus("Falha ao cancelar login");
      }
      return;
    }

    if (pendingLoginIdRef.current === loginId) {
      clearPendingLogin();
      setDeviceLogin(null);
      setBusy(false);
      if (cancelStatus === "notFound") {
        void refreshAccount(true)
          .then((nextAccount) => setStatus(nextAccount ? "Conectado" : "Login encerrado"))
          .catch((nextError) => setError(getCodexErrorMessage(nextError)));
      } else {
        setStatus("Login cancelado");
      }
    }
  }, [clearPendingLogin, refreshAccount]);

  const logout = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logoutCodex();
      clearPendingLogin();
      accountRef.current = null;
      setAccount(null);
      setDeviceLogin(null);
      setPlan(null);
      setGeneratedImages([]);
      messageStoreRef.current.clear();
      setMessages([]);
      const fallbackProvider = resolveReadyAiProvider(
        "chatgpt",
        providerConnectionsRef.current,
        false,
      );
      if (fallbackProvider && fallbackProvider !== "chatgpt") {
        setProvider(fallbackProvider);
        setStatus("Pronto");
      } else {
        setStatus("Desconectado");
      }
    } catch (nextError) {
      setError(getCodexErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }, [busy, clearPendingLogin, setProvider]);

  const submit = useCallback(
    async (request: string) => {
      const targetCanvasId = activeCanvasIdRef.current;
      const activeProviderConnection = providerConnections.find(
        (connection) => connection.provider === providerPreferences.provider,
      );
      const providerAuthenticated =
        providerPreferences.provider === "chatgpt"
          ? Boolean(account)
          : Boolean(activeProviderConnection?.hasKey);
      if (
        !targetCanvasId ||
        !providerAuthenticated ||
        busy ||
        turnRequestActiveRef.current
      ) {
        return;
      }

      setError(null);
      setPlan(null);
      setGeneratedImages([]);
      finalPlanReceivedRef.current = false;
      finalPlanHasCommandsRef.current = false;
      pendingFinalPlanRef.current = null;
      generatedImageTokensRef.current = [];
      const generatedImageRequested = isGeneratedImageRequest(request);
      if (generatedImageRequested && providerPreferences.provider === "anthropic") {
        setProviderError("O Claude nao oferece geracao de imagens. Escolha outro provedor.");
        return;
      }
      generatedImageModeRef.current = generatedImageRequested;
      const context = getContext(scope);
      if (!context) {
        setError("Nao foi possivel ler o canvas atual.");
        return;
      }
      if (scope === "selection" && context.elements.length === 0) {
        setError("Selecione pelo menos um elemento.");
        return;
      }

      const recentMessages = (messageStoreRef.current.get(targetCanvasId) ?? [])
        .slice(-4)
        .map((message) => ({
          role: message.role,
          text: message.text.slice(0, 1_200),
        }));

      appendMessage(targetCanvasId, {
        id: createMessageId("user"),
        role: "user",
        text: request,
      });
      setBusy(true);
      turnRequestActiveRef.current = true;
      setStatus(
        generatedImageRequested
          ? "Preparando geracao de imagem"
          : "Analisando canvas",
      );
      turnCanvasIdRef.current = targetCanvasId;

      let directRequestId: string | null = null;
      try {
        if (providerPreferences.provider !== "chatgpt") {
          const requestId = crypto.randomUUID();
          directRequestId = requestId;
          activeProviderRequestIdRef.current = requestId;
          const outputSchema = generatedImageRequested
            ? GENERATED_IMAGE_PLAN_OUTPUT_SCHEMA
            : CANVAS_PLAN_OUTPUT_SCHEMA;
          const response = await generateWithAiProvider({
            requestId,
            provider: providerPreferences.provider,
            model: providerPreferences.model,
            reasoningEffort: providerPreferences.reasoningEffort,
            systemPrompt: CODEX_CANVAS_BASE_INSTRUCTIONS,
            prompt: buildCodexCanvasPrompt({
              context,
              generatedImageRequested,
              imageGenerationMode: "external",
              projectTitle,
              recentMessages,
              request,
            }),
            outputSchema,
            generateImage: generatedImageRequested,
            ...(generatedImageRequested ? { imagePrompt: request } : {}),
          });

          if (activeProviderRequestIdRef.current !== requestId) {
            return;
          }

          const parsed = parseAssistantCanvasPlan(response.text, generatedImageRequested);
          const imageCommands = parsed.commands.filter(
            (command) => command.type === "createGeneratedImage",
          );
          let nextGeneratedImages: GeneratedImageAsset[] = [];

          if (generatedImageRequested) {
            if (
              parsed.commands.length !== 1 ||
              imageCommands.length !== 1 ||
              imageCommands[0].sourceIndex !== 0 ||
              response.generatedImages.length !== 1
            ) {
              throw new Error(
                "O provedor nao retornou exatamente uma imagem valida para o canvas.",
              );
            }
            nextGeneratedImages = [validateGeneratedImage(response.generatedImages[0])];
          } else if (response.generatedImages.length || imageCommands.length) {
            throw new Error("O provedor retornou uma imagem inesperada.");
          }

          if (activeCanvasIdRef.current !== targetCanvasId) {
            throw new Error("O canvas ativo mudou durante a solicitacao.");
          }

          appendMessage(targetCanvasId, {
            id: createMessageId("assistant"),
            role: "assistant",
            text: parsed.summary,
          });
          setGeneratedImages(nextGeneratedImages);
          setPlan(parsed.commands.length ? parsed : null);
          setStatus(parsed.commands.length ? "Previa pronta" : "Concluido");
          activeProviderRequestIdRef.current = null;
          resetActiveTurn();
          return;
        }

        const thread = await startCodexThread({
          developerInstructions: CODEX_CANVAS_BASE_INSTRUCTIONS,
          serviceName: "excalibur",
          ...(providerPreferences.model === "default"
            ? {}
            : { model: providerPreferences.model }),
        });
        const threadId = thread.thread.id;

        if (cancelPendingRef.current) {
          setStatus("Interrompido");
          resetActiveTurn();
          return;
        }

        activeThreadIdRef.current = threadId;
        activeTurnIdRef.current = null;
        activeTurnStartedRef.current = false;
        turnCanvasIdRef.current = targetCanvasId;

        const response = await startCodexTurn({
          threadId,
          input: [
            {
              type: "text",
              text: buildCodexCanvasPrompt({
                context,
                generatedImageRequested,
                projectTitle,
                recentMessages,
                request,
              }),
              text_elements: [],
            },
          ],
          effort: providerPreferences.reasoningEffort as
            | "minimal"
            | "low"
            | "medium"
            | "high"
            | "xhigh",
          outputSchema: generatedImageRequested
            ? GENERATED_IMAGE_PLAN_OUTPUT_SCHEMA
            : CANVAS_PLAN_OUTPUT_SCHEMA,
        });

        if (
          activeThreadIdRef.current === threadId &&
          turnCanvasIdRef.current === targetCanvasId
        ) {
          activeTurnIdRef.current = response.turn.id;
        }
        if (
          cancelPendingRef.current &&
          activeTurnStartedRef.current &&
          activeThreadIdRef.current === threadId
        ) {
          cancelPendingRef.current = false;
          void interruptActiveTurn().catch((nextError) => {
            setError(getCodexErrorMessage(nextError));
          });
        }
      } catch (nextError) {
        if (
          directRequestId &&
          activeProviderRequestIdRef.current !== directRequestId
        ) {
          setStatus("Interrompido");
          resetActiveTurn();
          return;
        }
        activeProviderRequestIdRef.current = null;
        discardGeneratedImageTokens(generatedImageTokensRef.current);
        setStatus("Falha");
        setError(getCodexErrorMessage(nextError));
        resetActiveTurn();
      }
    },
    [
      account,
      appendMessage,
      busy,
      discardGeneratedImageTokens,
      getContext,
      interruptActiveTurn,
      projectTitle,
      providerConnections,
      providerPreferences,
      resetActiveTurn,
      scope,
    ],
  );

  const interrupt = useCallback(() => {
    if (!busy || !turnCanvasIdRef.current) {
      return;
    }
    setStatus("Interrompendo");
    const providerRequestId = activeProviderRequestIdRef.current;
    if (providerRequestId) {
      activeProviderRequestIdRef.current = null;
      void cancelAiProviderRequest(providerRequestId)
        .catch((nextError) => setError(getCodexErrorMessage(nextError)))
        .finally(() => {
          setStatus("Interrompido");
          resetActiveTurn();
        });
      return;
    }
    if (!activeTurnIdRef.current || !activeTurnStartedRef.current) {
      cancelPendingRef.current = true;
      return;
    }
    void interruptActiveTurn().catch((nextError) => {
      setError(getCodexErrorMessage(nextError));
    });
  }, [busy, interruptActiveTurn, resetActiveTurn]);

  const setScope = useCallback((nextScope: CanvasScope) => {
    setScopeState(nextScope);
    setPlan(null);
    setGeneratedImages([]);
  }, []);

  const clearPlan = useCallback((nextStatus = "Pronto") => {
    setPlan(null);
    setGeneratedImages([]);
    setStatus(nextStatus);
  }, []);

  return {
    account,
    activeProvider: providerPreferences.provider,
    authDiscoveryComplete,
    authDiscoveryRevision,
    bridgeStatus,
    busy,
    cancelLogin,
    clearPlan,
    deviceLogin,
    error,
    generatedImages,
    initialize,
    initializing,
    interrupt,
    login,
    loginPending,
    loginWithDeviceCode,
    logout,
    messages,
    openDeviceLoginUrl: () => {
      if (deviceLogin) {
        try {
          void openUrl(requireHttpsUrl(deviceLogin.verificationUrl));
        } catch (nextError) {
          setError(getCodexErrorMessage(nextError));
        }
      }
    },
    plan,
    providerConnections,
    providerError,
    providerModel: providerPreferences.model,
    providerReasoningEffort: providerPreferences.reasoningEffort,
    providerSettingsBusy,
    removeProviderApiKey,
    runtimeReady: Boolean(bridgeStatus?.running && bridgeStatus.initialized),
    scope,
    saveProviderApiKey,
    setProvider,
    setProviderModel,
    setProviderReasoningEffort,
    setScope,
    status,
    submit,
    testProviderConnection,
  };
}
