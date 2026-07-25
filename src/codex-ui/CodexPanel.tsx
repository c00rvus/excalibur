import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  CircleStop,
  Copy,
  Eye,
  EyeOff,
  ImageOff,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { isGeneratedImageRequest } from "./prompt";
import {
  AI_PROVIDER_OPTIONS,
  AI_REASONING_LABELS,
  getAiProviderOption,
  type AiProviderConnection,
  type AiProviderId,
  type AiReasoningEffort,
} from "./providers";
import "./CodexPanel.css";

export type CodexScope = "selection" | "viewport" | "canvas";

export type CodexAccount = {
  type: "chatgpt";
  email?: string | null;
  planType?: string | null;
};

export type CodexChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type CodexPlanPreview = {
  summary: string;
  operationCount: number;
  affectedCount: number;
  createdCount: number;
  deletedCount: number;
};

export type CodexDeviceLogin = {
  verificationUrl: string;
  userCode: string;
};

type CodexPanelProps = {
  account: CodexAccount | null;
  activeProvider: AiProviderId;
  activeProject: boolean;
  authDiscoveryComplete: boolean;
  authDiscoveryRevision: number;
  busy: boolean;
  canUndo: boolean;
  deviceLogin: CodexDeviceLogin | null;
  error: string | null;
  focusRequest: number;
  initializing: boolean;
  loginPending: boolean;
  messages: CodexChatMessage[];
  plan: CodexPlanPreview | null;
  providerConnections: readonly AiProviderConnection[];
  providerError: string | null;
  providerModel: string;
  providerReasoningEffort: AiReasoningEffort;
  providerSettingsBusy: boolean;
  readOnly: boolean;
  runtimeReady: boolean;
  scope: CodexScope;
  selectedElementCount: number;
  status: string;
  onApplyPlan: () => void;
  onCancelPlan: () => void;
  onCancelLogin: () => void;
  onClose: () => void;
  onDeviceLogin: () => void;
  onInterrupt: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onOpenDeviceLoginUrl: () => void;
  onProviderChange: (provider: AiProviderId) => void;
  onProviderModelChange: (model: string) => void;
  onProviderReasoningEffortChange: (effort: AiReasoningEffort) => void;
  onRemoveApiKey: (provider: Exclude<AiProviderId, "chatgpt">) => Promise<void>;
  onRetryRuntime: () => void;
  onSaveApiKey: (
    provider: Exclude<AiProviderId, "chatgpt">,
    apiKey: string,
  ) => Promise<void>;
  onScopeChange: (scope: CodexScope) => void;
  onSubmit: (prompt: string) => void;
  onTestProvider: (
    provider: Exclude<AiProviderId, "chatgpt">,
  ) => Promise<string>;
  onUndo: () => void;
};

function planMeta(plan: CodexPlanPreview) {
  const parts = [`${plan.operationCount} operacao${plan.operationCount === 1 ? "" : "oes"}`];

  if (plan.createdCount) {
    parts.push(`${plan.createdCount} novo${plan.createdCount === 1 ? "" : "s"}`);
  }
  if (plan.deletedCount) {
    parts.push(`${plan.deletedCount} removido${plan.deletedCount === 1 ? "" : "s"}`);
  }
  if (plan.affectedCount) {
    parts.push(`${plan.affectedCount} afetado${plan.affectedCount === 1 ? "" : "s"}`);
  }

  return parts.join(" · ");
}

export function CodexPanel({
  account,
  activeProvider,
  activeProject,
  authDiscoveryComplete,
  authDiscoveryRevision,
  busy,
  canUndo,
  deviceLogin,
  error,
  focusRequest,
  initializing,
  loginPending,
  messages,
  plan,
  providerConnections,
  providerError,
  providerModel,
  providerReasoningEffort,
  providerSettingsBusy,
  readOnly,
  runtimeReady,
  scope,
  selectedElementCount,
  status,
  onApplyPlan,
  onCancelPlan,
  onCancelLogin,
  onClose,
  onDeviceLogin,
  onInterrupt,
  onLogin,
  onLogout,
  onOpenDeviceLoginUrl,
  onProviderChange,
  onProviderModelChange,
  onProviderReasoningEffortChange,
  onRemoveApiKey,
  onRetryRuntime,
  onSaveApiKey,
  onScopeChange,
  onSubmit,
  onTestProvider,
  onUndo,
}: CodexPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [apiKeys, setApiKeys] = useState<Partial<Record<AiProviderId, string>>>({});
  const [providerActionError, setProviderActionError] = useState<string | null>(null);
  const [providerActionMessage, setProviderActionMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleApiKeys, setVisibleApiKeys] = useState<Partial<Record<AiProviderId, boolean>>>({});
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const routedEntryRef = useRef("");
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsRef = useRef<HTMLElement | null>(null);
  const wasSettingsOpenRef = useRef(false);

  const activeProviderOption = getAiProviderOption(activeProvider);
  const activeConnection = providerConnections.find(
    (connection) => connection.provider === activeProvider,
  );
  const providerReady =
    activeProvider === "chatgpt"
      ? Boolean(runtimeReady && account)
      : Boolean(activeConnection?.hasKey);
  const activeModel =
    activeProviderOption.models.find((model) => model.id === providerModel) ??
    activeProviderOption.models[0];
  const imageRequestBlocked =
    activeProvider === "anthropic" && isGeneratedImageRequest(prompt);
  const providerName = activeProviderOption.shortLabel;

  const connectedProviders = useMemo(
    () =>
      new Set(
        AI_PROVIDER_OPTIONS.filter((provider) =>
          provider.id === "chatgpt"
            ? Boolean(runtimeReady && account)
            : providerConnections.some(
                (connection) => connection.provider === provider.id && connection.hasKey,
              ),
        ).map((provider) => provider.id),
      ),
    [account, providerConnections, runtimeReady],
  );

  useEffect(() => {
    if (!authDiscoveryComplete) {
      routedEntryRef.current = "";
      return;
    }
    const entryKey = `${focusRequest}:${authDiscoveryRevision}`;
    if (focusRequest <= 0 || routedEntryRef.current === entryKey) {
      return;
    }

    const routedFocusRequest = routedEntryRef.current
      ? Number(routedEntryRef.current.split(":", 1)[0])
      : null;
    if (
      settingsOpen &&
      (routedFocusRequest === null || routedFocusRequest === focusRequest)
    ) {
      routedEntryRef.current = entryKey;
      return;
    }

    routedEntryRef.current = entryKey;
    setProviderActionError(null);
    setProviderActionMessage(null);
    if (!providerReady && connectedProviders.size > 0) {
      const fallbackProvider = AI_PROVIDER_OPTIONS.find((provider) =>
        connectedProviders.has(provider.id),
      );
      if (fallbackProvider) {
        onProviderChange(fallbackProvider.id);
      }
    }
    setSettingsOpen(connectedProviders.size === 0);
  }, [
    authDiscoveryComplete,
    authDiscoveryRevision,
    connectedProviders,
    focusRequest,
    onProviderChange,
    providerReady,
    settingsOpen,
  ]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      settingsRef.current
        ?.querySelector<HTMLElement>(
          ".codex-provider-settings-list button:not(:disabled), " +
            ".codex-provider-settings-list input:not(:disabled)",
        )
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsOpen]);

  useEffect(() => {
    const wasOpen = wasSettingsOpenRef.current;
    wasSettingsOpenRef.current = settingsOpen;
    if (!wasOpen || settingsOpen || providerReady) {
      return;
    }
    const frame = window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [providerReady, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen && focusRequest > 0 && providerReady && activeProject) {
      inputRef.current?.focus();
    }
  }, [activeProject, focusRequest, providerReady, settingsOpen]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, plan, busy]);

  const submit = () => {
    const value = prompt.trim();
    if (!value || busy || !providerReady || !activeProject || readOnly || imageRequestBlocked) {
      return;
    }

    setPrompt("");
    onSubmit(value);
  };

  const apiErrorMessage = (value: unknown) =>
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "Não foi possível atualizar o provedor.";

  const saveApiKey = async (provider: Exclude<AiProviderId, "chatgpt">) => {
    const apiKey = apiKeys[provider]?.trim() ?? "";
    if (!apiKey || providerSettingsBusy) {
      return;
    }

    setProviderActionError(null);
    setProviderActionMessage(null);
    try {
      await onSaveApiKey(provider, apiKey);
      setApiKeys((current) => ({ ...current, [provider]: "" }));
      setVisibleApiKeys((current) => ({ ...current, [provider]: false }));
      setProviderActionMessage(`Chave de ${getAiProviderOption(provider).shortLabel} salva.`);
    } catch (nextError) {
      setProviderActionError(apiErrorMessage(nextError));
    }
  };

  const removeApiKey = async (provider: Exclude<AiProviderId, "chatgpt">) => {
    if (providerSettingsBusy) {
      return;
    }
    setProviderActionError(null);
    setProviderActionMessage(null);
    try {
      await onRemoveApiKey(provider);
      setApiKeys((current) => ({ ...current, [provider]: "" }));
      setProviderActionMessage(`Chave de ${getAiProviderOption(provider).shortLabel} removida.`);
    } catch (nextError) {
      setProviderActionError(apiErrorMessage(nextError));
    }
  };

  const testProvider = async (provider: Exclude<AiProviderId, "chatgpt">) => {
    if (providerSettingsBusy) {
      return;
    }
    setProviderActionError(null);
    setProviderActionMessage(null);
    try {
      setProviderActionMessage(await onTestProvider(provider));
    } catch (nextError) {
      setProviderActionError(apiErrorMessage(nextError));
    }
  };

  return (
    <aside aria-label="Codex" className="codex-panel" id="codex-assistant-panel">
      <header className="codex-panel-header">
        <div className="codex-panel-heading">
          <span className="codex-panel-icon">
            <Sparkles size={16} />
          </span>
          <div>
            <strong>Codex</strong>
            <span>
              {activeProvider === "chatgpt" && account?.email
                ? account.email
                : `${providerName} · ${status}`}
            </span>
          </div>
        </div>
        <div className="codex-panel-header-actions">
          {activeProvider === "chatgpt" && account ? (
            <button
              aria-label="Sair do Codex"
              className="codex-icon-button"
              disabled={busy}
              onClick={onLogout}
              title="Sair"
              type="button"
            >
              <LogOut size={15} />
            </button>
          ) : null}
          <button
            aria-label="Configurar provedores"
            aria-expanded={settingsOpen}
            className="codex-icon-button"
            onClick={() => {
              setProviderActionError(null);
              setProviderActionMessage(null);
              setSettingsOpen((current) => !current);
            }}
            title="Provedores"
            type="button"
            ref={settingsButtonRef}
          >
            <Settings2 size={16} />
          </button>
          <button
            aria-label="Fechar Codex"
            className="codex-icon-button"
            onClick={onClose}
            title="Fechar"
            type="button"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <section
          aria-label="Provedores de IA"
          className="codex-provider-settings"
          ref={settingsRef}
        >
          <header>
            <div>
              <strong>Provedores de IA</strong>
              <span>Conexões e chaves</span>
            </div>
            <button
              aria-label="Fechar provedores"
              className="codex-icon-button"
              onClick={() => setSettingsOpen(false)}
              type="button"
            >
              <X size={15} />
            </button>
          </header>

          <div className="codex-provider-settings-list">
            {AI_PROVIDER_OPTIONS.map((provider) => {
              const connection = providerConnections.find(
                (candidate) => candidate.provider === provider.id,
              );
              const configured =
                provider.id === "chatgpt"
                  ? Boolean(runtimeReady && account)
                  : Boolean(connection?.hasKey);

              if (provider.id === "chatgpt") {
                return (
                  <article className="codex-provider-card" key={provider.id}>
                    <header>
                      <div>
                        <strong>{provider.label}</strong>
                        <span>{configured ? "Conectado" : "Login do ChatGPT"}</span>
                      </div>
                      <span className={configured ? "is-connected" : ""}>
                        {configured ? "Ativo" : "Não conectado"}
                      </span>
                    </header>
                    <div className="codex-provider-card-actions">
                      {configured ? (
                        <button
                          className="codex-secondary-button"
                          disabled={busy || providerSettingsBusy}
                          onClick={() => onProviderChange("chatgpt")}
                          type="button"
                        >
                          Usar
                        </button>
                      ) : runtimeReady ? (
                        <button
                          className="codex-secondary-button"
                          disabled={busy || providerSettingsBusy}
                          onClick={() => {
                            setSettingsOpen(false);
                            onProviderChange("chatgpt");
                            onLogin();
                          }}
                          type="button"
                        >
                          <LogIn size={14} />
                          Entrar
                        </button>
                      ) : (
                        <button
                          className="codex-secondary-button"
                          disabled={initializing || providerSettingsBusy}
                          onClick={onRetryRuntime}
                          type="button"
                        >
                          Tentar iniciar
                        </button>
                      )}
                    </div>
                  </article>
                );
              }

              const apiProvider = provider.id;
              const visible = Boolean(visibleApiKeys[apiProvider]);
              const secureStoreUnavailable = connection?.secureStoreAvailable === false;
              return (
                <article className="codex-provider-card" key={provider.id}>
                  <header>
                    <div>
                      <strong>{provider.label}</strong>
                      <span>
                        {secureStoreUnavailable ? "Cofre seguro indisponível" : "Chave da API"}
                      </span>
                    </div>
                    <span className={configured ? "is-connected" : ""}>
                      {secureStoreUnavailable
                        ? "Indisponível"
                        : configured
                          ? "Configurada"
                          : "Não configurada"}
                    </span>
                  </header>
                  <div className="codex-api-key-field">
                    <KeyRound aria-hidden="true" size={14} />
                    <input
                      aria-label={`Nova chave da ${provider.label}`}
                      autoCapitalize="none"
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      disabled={busy || providerSettingsBusy || secureStoreUnavailable}
                      name={`excalibur-${provider.id}-credential`}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setApiKeys((current) => ({
                          ...current,
                          [apiProvider]: value,
                        }));
                      }}
                      placeholder={configured ? "Substituir chave" : "Inserir chave"}
                      spellCheck={false}
                      type={visible ? "text" : "password"}
                      value={apiKeys[apiProvider] ?? ""}
                    />
                    <button
                      aria-label={visible ? "Ocultar chave" : "Mostrar chave"}
                      className="codex-api-key-visibility"
                      disabled={busy || providerSettingsBusy || secureStoreUnavailable}
                      onClick={() =>
                        setVisibleApiKeys((current) => ({
                          ...current,
                          [apiProvider]: !current[apiProvider],
                        }))
                      }
                      type="button"
                    >
                      {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="codex-provider-card-actions">
                    <button
                      className="codex-primary-button"
                      disabled={
                        !apiKeys[apiProvider]?.trim() ||
                        busy ||
                        providerSettingsBusy ||
                        secureStoreUnavailable
                      }
                      onClick={() => void saveApiKey(apiProvider)}
                      type="button"
                    >
                      Salvar
                    </button>
                    {configured ? (
                      <>
                        <button
                          className="codex-secondary-button"
                          disabled={
                            busy ||
                            providerSettingsBusy ||
                            secureStoreUnavailable ||
                            activeProvider === apiProvider
                          }
                          onClick={() => {
                            onProviderChange(apiProvider);
                            setSettingsOpen(false);
                          }}
                          type="button"
                        >
                          {activeProvider === apiProvider ? "Em uso" : "Usar"}
                        </button>
                        <button
                          className="codex-secondary-button"
                          disabled={busy || providerSettingsBusy || secureStoreUnavailable}
                          onClick={() => void testProvider(apiProvider)}
                          type="button"
                        >
                          Testar
                        </button>
                        <button
                          aria-label={`Remover chave da ${provider.label}`}
                          className="codex-icon-button codex-danger-button"
                          disabled={busy || providerSettingsBusy || secureStoreUnavailable}
                          onClick={() => void removeApiKey(apiProvider)}
                          title="Remover chave"
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : null}
                  </div>
                  {secureStoreUnavailable && connection.storageError ? (
                    <div className="codex-provider-card-note">{connection.storageError}</div>
                  ) : null}
                </article>
              );
            })}
          </div>

          <div className="codex-provider-security-note">
            <ShieldCheck aria-hidden="true" size={14} />
            <span>As chaves ficam no cofre seguro do sistema, nunca no projeto.</span>
          </div>
          {providerActionError || providerError ? (
            <div className="codex-error">{providerActionError || providerError}</div>
          ) : null}
          {providerActionMessage ? (
            <div className="codex-provider-success">{providerActionMessage}</div>
          ) : null}
        </section>
      ) : null}

      {settingsOpen ? null : !authDiscoveryComplete ? (
        <div aria-live="polite" className="codex-panel-state">
          <LoaderCircle className="is-spinning" size={28} />
          <strong>Verificando acesso</strong>
          <span>Consultando login e chaves configuradas.</span>
        </div>
      ) : !providerReady && activeProvider === "chatgpt" && !runtimeReady ? (
        <div className="codex-panel-state">
          {initializing ? (
            <LoaderCircle className="is-spinning" size={28} />
          ) : (
            <Bot size={28} />
          )}
          <strong>{initializing ? "Iniciando Codex" : "Codex indisponível"}</strong>
          <span>{error || status}</span>
          {!initializing ? (
            <div className="codex-login-actions">
              <button className="codex-secondary-button" onClick={onRetryRuntime} type="button">
                Tentar novamente
              </button>
              <button
                className="codex-secondary-button"
                onClick={() => setSettingsOpen(true)}
                type="button"
              >
                Usar chave API
              </button>
            </div>
          ) : null}
        </div>
      ) : !providerReady && activeProvider === "chatgpt" ? (
        <div className="codex-panel-state">
          <Bot size={28} />
          <strong>Conectar ao Codex</strong>
          <div className="codex-login-actions">
            <button
              className="codex-primary-button"
              disabled={busy}
              onClick={onLogin}
              type="button"
            >
              {busy ? <LoaderCircle className="is-spinning" size={16} /> : <LogIn size={16} />}
              <span>Entrar com ChatGPT</span>
            </button>
            <button
              className="codex-secondary-button"
              disabled={busy}
              onClick={onDeviceLogin}
              type="button"
            >
              Usar codigo
            </button>
          </div>
          {deviceLogin ? (
            <div className="codex-device-login">
              <code>{deviceLogin.userCode}</code>
              <div>
                <button
                  className="codex-secondary-button"
                  onClick={() => void navigator.clipboard.writeText(deviceLogin.userCode)}
                  type="button"
                >
                  <Copy size={14} />
                  Copiar
                </button>
                <button
                  className="codex-secondary-button"
                  onClick={onOpenDeviceLoginUrl}
                  type="button"
                >
                  Abrir
                </button>
              </div>
            </div>
          ) : null}
          {loginPending ? (
            <button className="codex-secondary-button" onClick={onCancelLogin} type="button">
              Cancelar login
            </button>
          ) : null}
          {error ? <div className="codex-error">{error}</div> : null}
        </div>
      ) : !providerReady ? (
        <div className="codex-panel-state">
          <KeyRound size={28} />
          <strong>Conectar {providerName}</strong>
          <span>Adicione uma chave da API para usar este provedor.</span>
          <button
            className="codex-primary-button"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            Configurar chave
          </button>
          {providerError || error ? (
            <div className="codex-error">{providerError || error}</div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="codex-scope-switch" role="group" aria-label="Escopo do Codex">
            <button
              className={scope === "selection" ? "is-active" : ""}
              disabled={!selectedElementCount || busy}
              onClick={() => onScopeChange("selection")}
              type="button"
            >
              Selecao{selectedElementCount ? ` (${selectedElementCount})` : ""}
            </button>
            <button
              className={scope === "viewport" ? "is-active" : ""}
              disabled={busy}
              onClick={() => onScopeChange("viewport")}
              type="button"
            >
              Visivel
            </button>
            <button
              className={scope === "canvas" ? "is-active" : ""}
              disabled={busy}
              onClick={() => onScopeChange("canvas")}
              type="button"
            >
              Canvas
            </button>
          </div>

          <div aria-live="polite" className="codex-messages" ref={messagesRef}>
            {messages.map((message) => (
              <article className={`codex-message codex-message-${message.role}`} key={message.id}>
                <span>{message.role === "user" ? "Voce" : "Codex"}</span>
                <p>{message.text}</p>
              </article>
            ))}

            {busy ? (
              <div className="codex-thinking">
                <LoaderCircle className="is-spinning" size={15} />
                <span>{status}</span>
              </div>
            ) : null}

            {error ? <div className="codex-error">{error}</div> : null}

            {plan ? (
              <section className="codex-plan-card">
                <header>
                  <span className="codex-plan-icon">
                    <Check size={15} />
                  </span>
                  <div>
                    <strong>Previa pronta</strong>
                    <span>{planMeta(plan)}</span>
                  </div>
                </header>
                <p>{plan.summary}</p>
                <footer>
                  <button className="codex-secondary-button" onClick={onCancelPlan} type="button">
                    Cancelar
                  </button>
                  <button
                    className="codex-primary-button"
                    disabled={readOnly}
                    onClick={onApplyPlan}
                    type="button"
                  >
                    Aplicar
                  </button>
                </footer>
              </section>
            ) : null}

            {canUndo && !plan ? (
              <button className="codex-undo-button" onClick={onUndo} type="button">
                <Undo2 size={14} />
                <span>Desfazer última aplicação</span>
              </button>
            ) : null}
          </div>

          <form
            className="codex-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <textarea
              aria-label="Solicitacao ao Codex"
              disabled={!activeProject || readOnly}
              maxLength={4_000}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Descreva a alteracao"
              ref={inputRef}
              rows={3}
              value={prompt}
            />
            <div className="codex-composer-options">
              <label>
                <span>Provedor</span>
                <select
                  aria-label="Provedor de IA"
                  disabled={busy}
                  onChange={(event) => onProviderChange(event.currentTarget.value as AiProviderId)}
                  value={activeProvider}
                >
                  {AI_PROVIDER_OPTIONS.map((provider) => (
                    <option
                      disabled={!connectedProviders.has(provider.id)}
                      key={provider.id}
                      value={provider.id}
                    >
                      {provider.shortLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="codex-model-select">
                <span>Modelo</span>
                <select
                  aria-label="Modelo de IA"
                  disabled={busy}
                  onChange={(event) => onProviderModelChange(event.currentTarget.value)}
                  value={activeModel.id}
                >
                  {activeProviderOption.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Esforço</span>
                <select
                  aria-label="Esforço de raciocínio"
                  disabled={busy || activeModel.reasoningEfforts.length < 2}
                  onChange={(event) =>
                    onProviderReasoningEffortChange(
                      event.currentTarget.value as AiReasoningEffort,
                    )
                  }
                  value={providerReasoningEffort}
                >
                  {activeModel.reasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {AI_REASONING_LABELS[effort]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {imageRequestBlocked ? (
              <div className="codex-provider-hint" role="status">
                <ImageOff aria-hidden="true" size={13} />
                <span>O Claude não gera imagens. Escolha ChatGPT, OpenAI ou Gemini.</span>
              </div>
            ) : null}
            <div className="codex-composer-footer">
              <span>{readOnly ? "Somente visualizacao" : status}</span>
              {busy ? (
                <button
                  aria-label="Interromper Codex"
                  className="codex-send-button"
                  onClick={onInterrupt}
                  title="Interromper"
                  type="button"
                >
                  <CircleStop size={17} />
                </button>
              ) : (
                <button
                  aria-label="Enviar ao Codex"
                  className="codex-send-button"
                  disabled={!prompt.trim() || !activeProject || readOnly || imageRequestBlocked}
                  title="Enviar"
                  type="submit"
                >
                  <Send size={17} />
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
