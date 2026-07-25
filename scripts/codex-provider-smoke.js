async (page) => {
  const catalogResult = await page.evaluate(async () => {
    const {
      AI_PROVIDER_OPTIONS,
      getAiProviderOption,
      normalizeAiProviderPreferences,
    } = await import("/src/codex-ui/providers.ts");
    const {
      buildCodexCanvasPrompt,
      isGeneratedImageRequest,
    } = await import("/src/codex-ui/prompt.ts");
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDom } = await import(
      "/node_modules/.vite/deps/react-dom_client.js"
    );
    const { CodexPanel } = await import("/src/codex-ui/CodexPanel.tsx");

    const providerIds = AI_PROVIDER_OPTIONS.map((provider) => provider.id);
    const invalidOpenAi = normalizeAiProviderPreferences({
      provider: "openai",
      model: "modelo-nao-permitido",
      reasoningEffort: "automatic",
    });
    const haiku = normalizeAiProviderPreferences({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      reasoningEffort: "max",
    });
    const externalImagePrompt = buildCodexCanvasPrompt({
      context: {
        scope: "viewport",
        elements: [],
        selectedElementIds: [],
        viewport: null,
        bounds: null,
        omittedElementCount: 0,
      },
      generatedImageRequested: true,
      imageGenerationMode: "external",
      projectTitle: "Smoke",
      request: "Crie uma imagem de um fluxo de autenticacao",
    });
    const nativeImagePrompt = buildCodexCanvasPrompt({
      context: {
        scope: "viewport",
        elements: [],
        selectedElementIds: [],
        viewport: null,
        bounds: null,
        omittedElementCount: 0,
      },
      generatedImageRequested: true,
      imageGenerationMode: "native-tool",
      projectTitle: "Smoke",
      request: "Crie uma imagem de um fluxo de autenticacao",
    });

    const checks = {
      providerIdsAreUnique: new Set(providerIds).size === providerIds.length,
      exposesAllAuthModes:
        providerIds.join(",") === "chatgpt,openai,anthropic,gemini",
      everyProviderHasAValidDefault: AI_PROVIDER_OPTIONS.every((provider) =>
        provider.models.some((model) => model.id === provider.defaultModel),
      ),
      modelIdsAreUniquePerProvider: AI_PROVIDER_OPTIONS.every(
        (provider) =>
          new Set(provider.models.map((model) => model.id)).size ===
          provider.models.length,
      ),
      everyModelHasReasoningEffort: AI_PROVIDER_OPTIONS.every((provider) =>
        provider.models.every((model) => model.reasoningEfforts.length > 0),
      ),
      claudeDoesNotClaimImageGeneration:
        getAiProviderOption("anthropic").supportsImageGeneration === false,
      otherProvidersClaimImageGeneration: ["chatgpt", "openai", "gemini"].every(
        (provider) => getAiProviderOption(provider).supportsImageGeneration,
      ),
      invalidModelFallsBackToAllowlistedDefault:
        invalidOpenAi.model === getAiProviderOption("openai").defaultModel,
      invalidEffortFallsBackToAllowlistedDefault:
        invalidOpenAi.reasoningEffort ===
        getAiProviderOption("openai").defaultReasoningEffort,
      modelSpecificEffortIsNormalized:
        haiku.reasoningEffort === "automatic",
      routesExplicitImageRequest: isGeneratedImageRequest(
        "Crie uma imagem de um fluxo de autenticacao e adicione ao canvas",
      ),
      keepsEditableFlowchartVector: !isGeneratedImageRequest(
        "Crie um fluxograma de autenticacao editavel",
      ),
      externalProviderDoesNotCallNativeTool:
        externalImagePrompt.includes("MODO IMAGEM GERADA EXTERNA") &&
        externalImagePrompt.includes("gerador externo") &&
        !externalImagePrompt.includes("Chame a ferramenta nativa image_gen"),
      chatGptKeepsNativeImageTool:
        nativeImagePrompt.includes("MODO IMAGEM GERADA ($imagegen)") &&
        nativeImagePrompt.includes("Chame a ferramenta nativa image_gen"),
    };

    document.body.innerHTML = '<div id="codex-provider-smoke"></div>';
    const noop = () => undefined;
    const root = ReactDom.createRoot(document.getElementById("codex-provider-smoke"));
    root.render(
      React.createElement(CodexPanel, {
        account: null,
        activeProvider: "anthropic",
        activeProject: true,
        authDiscoveryComplete: true,
        authDiscoveryRevision: 1,
        busy: false,
        canUndo: false,
        deviceLogin: null,
        error: null,
        focusRequest: 0,
        initializing: false,
        loginPending: false,
        messages: [],
        plan: null,
        providerConnections: [
          {
            provider: "openai",
            authType: "apiKey",
            hasKey: true,
            secureStoreAvailable: true,
          },
          {
            provider: "anthropic",
            authType: "apiKey",
            hasKey: true,
            secureStoreAvailable: true,
          },
        ],
        providerError: null,
        providerModel: "claude-sonnet-5",
        providerReasoningEffort: "high",
        providerSettingsBusy: false,
        readOnly: false,
        runtimeReady: false,
        scope: "viewport",
        selectedElementCount: 0,
        status: "Pronto",
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
      }),
    );

    return { checks };
  });

  const panel = page.locator("#codex-provider-smoke");
  const prompt = panel.locator("textarea");
  const selectors = panel.locator(".codex-composer-options select");
  const sendButton = panel.locator("button.codex-send-button");
  await prompt.fill("Crie uma imagem de um fluxo de autenticacao e adicione ao canvas");

  const imageUiChecks = {
    showsSubtleClaudeWarning:
      (await panel.locator(".codex-provider-hint").count()) === 1 &&
      (await panel.locator(".codex-provider-hint").textContent())?.includes(
        "ChatGPT, OpenAI ou Gemini",
      ),
    blocksImageSubmission: await sendButton.isDisabled(),
    exposesProviderSelector:
      (await selectors.nth(0).inputValue()) === "anthropic",
    exposesModelSelector:
      (await selectors.nth(1).inputValue()) === "claude-sonnet-5",
    exposesReasoningSelector:
      (await selectors.nth(2).inputValue()) === "high",
  };

  await prompt.fill("Crie um fluxograma de autenticacao editavel");
  const vectorUiChecks = {
    hidesWarningForVectorRequest:
      (await panel.locator(".codex-provider-hint").count()) === 0,
    allowsVectorSubmission: !(await sendButton.isDisabled()),
  };

  await panel.getByRole("button", { name: "Configurar provedores" }).click();
  const claudeKeyInput = panel.getByLabel("Nova chave da Claude API");
  await claudeKeyInput.fill("sk-ant-test-only");
  const credentialUiChecks = {
    acceptsApiKeyInputWithoutReactCrash:
      (await claudeKeyInput.inputValue()) === "sk-ant-test-only" &&
      (await panel.count()) === 1,
    keepsApiKeyInputMasked:
      (await claudeKeyInput.getAttribute("type")) === "password",
    exposesUseActionForAnotherConfiguredProvider:
      (await panel.getByRole("button", { name: "Usar", exact: true }).count()) === 1 &&
      !(await panel.getByRole("button", { name: "Usar", exact: true }).isDisabled()),
  };

  const checks = {
    ...catalogResult.checks,
    ...imageUiChecks,
    ...vectorUiChecks,
    ...credentialUiChecks,
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`Codex provider smoke failed: ${JSON.stringify(checks)}`);
  }

  await page.evaluate((result) => {
    console.info(`[codex-provider-smoke] ${JSON.stringify(result)}`);
  }, checks);
}
