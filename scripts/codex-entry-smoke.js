async (page) => {
  const trigger = page.getByRole("button", { name: "Abrir assistente de IA" });
  await trigger.waitFor({ state: "visible" });
  const triggerChecks = {
    triggerHasAccessibleName: (await trigger.count()) === 1,
    triggerHasNoVisibleLabel: (await trigger.textContent())?.trim() === "",
    triggerKeepsShortcutHint:
      (await trigger.getAttribute("title")) === "Abrir assistente de IA (Ctrl+K)",
    triggerExposesPanelState:
      (await trigger.getAttribute("aria-controls")) === "codex-assistant-panel" &&
      (await trigger.getAttribute("aria-expanded")) === "false",
  };

  const panelChecks = await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDom } = await import(
      "/node_modules/.vite/deps/react-dom_client.js"
    );
    const { CodexPanel } = await import("/src/codex-ui/CodexPanel.tsx");
    const { resolveReadyAiProvider } = await import(
      "/src/codex-ui/useCodexAssistant.ts"
    );

    const waitForEffects = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const noop = () => undefined;
    const baseProps = {
      account: null,
      activeProvider: "chatgpt",
      activeProject: true,
      authDiscoveryComplete: false,
      authDiscoveryRevision: 0,
      busy: false,
      canUndo: false,
      deviceLogin: null,
      error: null,
      focusRequest: 1,
      initializing: true,
      loginPending: false,
      messages: [],
      plan: null,
      providerConnections: [],
      providerError: null,
      providerModel: "default",
      providerReasoningEffort: "low",
      providerSettingsBusy: false,
      readOnly: false,
      runtimeReady: false,
      scope: "viewport",
      selectedElementCount: 0,
      status: "Verificando acessos",
      onApplyPlan: noop,
      onCancelPlan: noop,
      onCancelLogin: noop,
      onClose: noop,
      onDeviceLogin: noop,
      onInterrupt: noop,
      onLogin: noop,
      onLogout: noop,
      onOpenDeviceLoginUrl: noop,
      onProviderChange: noop,
      onProviderModelChange: noop,
      onProviderReasoningEffortChange: noop,
      onRemoveApiKey: async () => undefined,
      onRetryRuntime: noop,
      onSaveApiKey: async () => undefined,
      onScopeChange: noop,
      onSubmit: noop,
      onTestProvider: async () => "ok",
      onUndo: noop,
    };

    document.body.innerHTML = '<div id="codex-entry-smoke"></div>';
    const host = document.getElementById("codex-entry-smoke");
    host.style.height = "700px";
    host.style.width = "380px";
    const root = ReactDom.createRoot(host);
    const render = (props) => root.render(React.createElement(CodexPanel, props));

    render(baseProps);
    await waitForEffects();
    const waitsBeforeRouting =
      host.querySelector(".codex-panel-state strong")?.textContent ===
        "Verificando acesso" &&
      host.querySelector(".codex-provider-settings") === null;

    render({
      ...baseProps,
      authDiscoveryComplete: true,
      authDiscoveryRevision: 1,
      initializing: false,
      status: "Conectar provedor",
    });
    await waitForEffects();
    const settings = host.querySelector(".codex-provider-settings");
    const opensSettingsWithoutCredentials =
      settings !== null &&
      settings.querySelectorAll('input[type="password"]').length === 3 &&
      settings.textContent.includes("Login do ChatGPT") &&
      settings.contains(document.activeElement) &&
      host.querySelector(".codex-panel-state") === null &&
      host.querySelector(".codex-composer") === null;
    settings
      ?.querySelector('button[aria-label="Fechar provedores"]')
      ?.click();
    await waitForEffects();
    const restoresFocusAfterClosingSettings =
      document.activeElement?.getAttribute("aria-label") === "Configurar provedores";

    const geminiConnection = {
      provider: "gemini",
      authType: "apiKey",
      hasKey: true,
      secureStoreAvailable: true,
    };
    render({
      ...baseProps,
      activeProvider: "gemini",
      authDiscoveryComplete: true,
      authDiscoveryRevision: 2,
      focusRequest: 2,
      initializing: false,
      providerConnections: [geminiConnection],
      providerModel: "gemini-3.5-flash",
      providerReasoningEffort: "medium",
      status: "Pronto",
    });
    await waitForEffects();
    const composer = host.querySelector(".codex-composer textarea");
    const opensChatWithConfiguredProvider =
      host.querySelector(".codex-provider-settings") === null &&
      composer instanceof HTMLTextAreaElement &&
      document.activeElement === composer;

    host.querySelector('button[aria-label="Configurar provedores"]')?.click();
    await waitForEffects();
    const settingsCanStillOpenManually =
      host.querySelector(".codex-provider-settings") !== null;

    render({
      ...baseProps,
      activeProvider: "gemini",
      authDiscoveryComplete: true,
      authDiscoveryRevision: 3,
      focusRequest: 2,
      initializing: false,
      providerConnections: [geminiConnection],
      providerModel: "gemini-3.5-flash",
      providerReasoningEffort: "medium",
      status: "Pronto",
    });
    await waitForEffects();
    const backgroundRefreshKeepsManualSettingsOpen =
      host.querySelector(".codex-provider-settings") !== null;

    render({
      ...baseProps,
      activeProvider: "gemini",
      authDiscoveryComplete: true,
      authDiscoveryRevision: 4,
      focusRequest: 3,
      initializing: false,
      providerConnections: [geminiConnection],
      providerModel: "gemini-3.5-flash",
      providerReasoningEffort: "medium",
      status: "Pronto",
    });
    await waitForEffects();
    const triggerReturnsConfiguredUserToChat =
      host.querySelector(".codex-provider-settings") === null;

    let reconciledProvider = null;
    render({
      ...baseProps,
      activeProvider: "chatgpt",
      authDiscoveryComplete: true,
      authDiscoveryRevision: 5,
      focusRequest: 4,
      initializing: false,
      onProviderChange: (provider) => {
        reconciledProvider = provider;
      },
      providerConnections: [geminiConnection],
      status: "Pronto",
    });
    await waitForEffects();
    const reconcilesUnavailableActiveProvider =
      reconciledProvider === "gemini" &&
      host.querySelector(".codex-provider-settings") === null;

    const openAiConnection = {
      provider: "openai",
      authType: "apiKey",
      hasKey: true,
      secureStoreAvailable: true,
    };
    const resolverChecks = {
      preservesReadyPreference:
        resolveReadyAiProvider("gemini", [openAiConnection, geminiConnection], true) ===
        "gemini",
      fallsBackToConfiguredApi:
        resolveReadyAiProvider("chatgpt", [geminiConnection], false) === "gemini",
      fallsBackToChatGptSession:
        resolveReadyAiProvider("anthropic", [], true) === "chatgpt",
      returnsNullWithoutAuthentication:
        resolveReadyAiProvider("chatgpt", [], false) === null,
    };

    return {
      waitsBeforeRouting,
      opensSettingsWithoutCredentials,
      restoresFocusAfterClosingSettings,
      opensChatWithConfiguredProvider,
      settingsCanStillOpenManually,
      backgroundRefreshKeepsManualSettingsOpen,
      triggerReturnsConfiguredUserToChat,
      reconcilesUnavailableActiveProvider,
      ...resolverChecks,
    };
  });

  const checks = { ...triggerChecks, ...panelChecks };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`Codex entry smoke failed: ${JSON.stringify(checks)}`);
  }

  await page.evaluate((result) => {
    console.info(`[codex-entry-smoke] ${JSON.stringify(result)}`);
  }, checks);
}
