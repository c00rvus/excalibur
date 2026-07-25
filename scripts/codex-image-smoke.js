async (page) => {
  const result = await page.evaluate(async () => {
    const { executeCanvasPlan } = await import("/src/codex/executor.ts");
    const { isGeneratedImageRequest } = await import("/src/codex-ui/prompt.ts");
    const { parseAssistantCanvasPlan } = await import(
      "/src/codex-ui/useCodexAssistant.ts"
    );
    const dataURL =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    const created = executeCanvasPlan(
      [],
      {
        summary: "image smoke",
        commands: [
          {
            type: "createGeneratedImage",
            id: "generated-auth-flow",
            sourceIndex: 0,
            x: 100,
            y: 120,
            width: 320,
            altText: "Fluxo de autenticacao",
          },
        ],
      },
      {
        generatedImages: [
          {
            fileId: "generated-file-1",
            dataURL,
            mimeType: "image/png",
            width: 1,
            height: 1,
            revisedPrompt: "Authentication flow illustration",
          },
        ],
      },
    );
    const image = created.elements.find(
      (element) => element.id === "generated-auth-flow",
    );
    let missingAssetRejected = false;
    try {
      executeCanvasPlan([], {
        summary: "missing image",
        commands: [
          {
            type: "createGeneratedImage",
            sourceIndex: 0,
            x: 0,
            y: 0,
          },
        ],
      });
    } catch {
      missingAssetRejected = true;
    }

    const checks = {
      createsOneImage: image?.type === "image",
      preservesAspectRatio: image?.width === 320 && image?.height === 320,
      bindsGeneratedFile: image?.fileId === "generated-file-1",
      returnsOneBinaryFile:
        created.files.length === 1 &&
        created.files[0].dataURL === dataURL &&
        created.files[0].mimeType === "image/png",
      marksImageMetadata:
        image?.customData?.excaliburCodex?.generatedImage === true,
      missingAssetRejected,
      routesExplicitImageRequest: isGeneratedImageRequest(
        "Crie uma imagem de um fluxo de autenticacao e adicione ao canvas",
      ),
      keepsFlowchartVector: !isGeneratedImageRequest(
        "Crie um fluxograma de autenticacao editavel",
      ),
      keepsExistingImageEditsVector: !isGeneratedImageRequest(
        "Adicione um texto abaixo da imagem existente",
      ),
      keepsImageCaptionVector: !isGeneratedImageRequest(
        "Crie uma legenda para a imagem selecionada",
      ),
      acceptsEmptyImageSummary:
        parseAssistantCanvasPlan(
          JSON.stringify({
            summary: "",
            commands: [
              {
                type: "createGeneratedImage",
                id: null,
                sourceIndex: 0,
                x: 100,
                y: 100,
                width: 640,
                altText: null,
              },
            ],
          }),
          true,
        ).summary.length > 0,
    };
    return { checks, allPassed: Object.values(checks).every(Boolean) };
  });

  if (!result.allPassed) {
    throw new Error(`Codex image smoke failed: ${JSON.stringify(result.checks)}`);
  }
  await page.evaluate((checks) => {
    console.info(`[codex-image-smoke] ${JSON.stringify(checks)}`);
  }, result.checks);
}
