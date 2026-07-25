export type AiProviderId = "chatgpt" | "openai" | "anthropic" | "gemini";

export type AiReasoningEffort =
  | "automatic"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type AiProviderConnection = {
  provider: AiProviderId;
  authType: "chatgpt" | "apiKey";
  hasKey: boolean;
  secureStoreAvailable: boolean;
  storageError?: string;
};

export type AiModelOption = {
  id: string;
  label: string;
  reasoningEfforts: readonly AiReasoningEffort[];
};

export type AiProviderOption = {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  supportsImageGeneration: boolean;
  models: readonly AiModelOption[];
  defaultModel: string;
  defaultReasoningEffort: AiReasoningEffort;
};

export type AiProviderPreferences = {
  provider: AiProviderId;
  model: string;
  reasoningEffort: AiReasoningEffort;
};

/**
 * Keep this list explicit instead of accepting arbitrary model IDs from project
 * files. Provider updates only change these non-secret UI preferences; API keys
 * are always owned by the native credential store.
 */
export const AI_PROVIDER_OPTIONS: readonly AiProviderOption[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    shortLabel: "ChatGPT",
    supportsImageGeneration: true,
    models: [
      {
        id: "default",
        label: "Padrão do Codex",
        reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      },
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      },
      {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh"],
      },
    ],
    defaultModel: "default",
    defaultReasoningEffort: "low",
  },
  {
    id: "openai",
    label: "OpenAI API",
    shortLabel: "OpenAI",
    supportsImageGeneration: true,
    models: [
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
        reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      },
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
        reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      },
      {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
        reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
      },
    ],
    defaultModel: "gpt-5.6-sol",
    defaultReasoningEffort: "medium",
  },
  {
    id: "anthropic",
    label: "Claude API",
    shortLabel: "Claude",
    supportsImageGeneration: false,
    models: [
      {
        id: "claude-sonnet-5",
        label: "Claude Sonnet 5",
        reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        id: "claude-opus-4-8",
        label: "Claude Opus 4.8",
        reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      },
      {
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        reasoningEfforts: ["automatic"],
      },
    ],
    defaultModel: "claude-sonnet-5",
    defaultReasoningEffort: "high",
  },
  {
    id: "gemini",
    label: "Gemini API",
    shortLabel: "Gemini",
    supportsImageGeneration: true,
    models: [
      {
        id: "gemini-3.5-flash",
        label: "Gemini 3.5 Flash",
        reasoningEfforts: ["minimal", "low", "medium", "high"],
      },
      {
        id: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro (preview)",
        reasoningEfforts: ["low", "medium", "high"],
      },
      {
        id: "gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash-Lite",
        reasoningEfforts: ["minimal", "low", "medium", "high"],
      },
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        reasoningEfforts: ["low", "medium", "high"],
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        reasoningEfforts: ["low", "medium", "high"],
      },
    ],
    defaultModel: "gemini-3.5-flash",
    defaultReasoningEffort: "medium",
  },
] as const;

export const AI_REASONING_LABELS: Record<AiReasoningEffort, string> = {
  automatic: "Automático",
  none: "Sem raciocínio",
  minimal: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

export function getAiProviderOption(provider: AiProviderId) {
  return AI_PROVIDER_OPTIONS.find((option) => option.id === provider) ?? AI_PROVIDER_OPTIONS[0];
}

export function normalizeAiProviderPreferences(
  preferences: Partial<AiProviderPreferences> | null | undefined,
): AiProviderPreferences {
  const providerOption = getAiProviderOption(preferences?.provider ?? "chatgpt");
  const model =
    providerOption.models.find((option) => option.id === preferences?.model) ??
    providerOption.models.find((option) => option.id === providerOption.defaultModel) ??
    providerOption.models[0];
  const reasoningEffort = model.reasoningEfforts.includes(
    preferences?.reasoningEffort as AiReasoningEffort,
  )
    ? (preferences?.reasoningEffort as AiReasoningEffort)
    : model.reasoningEfforts.includes(providerOption.defaultReasoningEffort)
      ? providerOption.defaultReasoningEffort
      : model.reasoningEfforts[0];

  return {
    provider: providerOption.id,
    model: model.id,
    reasoningEffort,
  };
}
