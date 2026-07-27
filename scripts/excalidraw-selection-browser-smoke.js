async (page) => {
  const createCanvasButtons = page.getByRole("button", { name: "Novo canvas" });
  await createCanvasButtons.first().click();

  const folderName = page.getByLabel("Nome da pasta");
  if (await folderName.isVisible()) {
    await folderName.fill("Teste de seleção");
    await page.getByRole("button", { name: "Criar", exact: true }).click();
  }

  const canvasName = page.getByLabel(/Nome do canvas/);
  await canvasName.waitFor({ state: "visible" });
  await canvasName.fill("Interseção parcial");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();

  const canvasHost = page.locator(".canvas-host");
  await canvasHost.locator(".excalidraw").waitFor({ state: "visible" });
  const bounds = await canvasHost.boundingBox();
  if (!bounds) {
    throw new Error("Canvas host has no bounding box");
  }

  const shape = {
    x1: bounds.x + bounds.width * 0.48,
    y1: bounds.y + bounds.height * 0.4,
    x2: bounds.x + bounds.width * 0.62,
    y2: bounds.y + bounds.height * 0.58,
  };

  await page.keyboard.press("r");
  await page.mouse.move(shape.x1, shape.y1);
  await page.mouse.down();
  await page.mouse.move(shape.x2, shape.y2, { steps: 5 });
  await page.mouse.up();

  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.mouse.click(
    bounds.x + bounds.width * 0.25,
    bounds.y + bounds.height * 0.75,
  );

  const copyButton = page.getByRole("button", { name: "Copiar", exact: true });
  const startsDeselected = await copyButton.isDisabled();

  await page.mouse.move(
    bounds.x + bounds.width * 0.4,
    bounds.y + bounds.height * 0.32,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.53,
    bounds.y + bounds.height * 0.46,
    { steps: 5 },
  );
  await page.mouse.up();

  const selectsOnPartialOverlap = await copyButton.isEnabled();

  await page.mouse.click(
    bounds.x + bounds.width * 0.25,
    bounds.y + bounds.height * 0.75,
  );
  await page.mouse.move(
    bounds.x + bounds.width * 0.15,
    bounds.y + bounds.height * 0.18,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.3,
    { steps: 5 },
  );
  await page.mouse.up();

  const ignoresSeparatedSelection = await copyButton.isDisabled();

  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.keyboard.press("l");
  await page.mouse.move(shape.x1, shape.y1);
  await page.mouse.down();
  await page.mouse.move(shape.x2, shape.y2, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  await page.mouse.click(
    bounds.x + bounds.width * 0.25,
    bounds.y + bounds.height * 0.75,
  );

  await page.mouse.move(
    bounds.x + bounds.width * 0.55,
    bounds.y + bounds.height * 0.41,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.6,
    bounds.y + bounds.height * 0.46,
    { steps: 5 },
  );
  await page.mouse.up();
  const ignoresEmptyAreaInsideLineBounds = await copyButton.isDisabled();

  await page.mouse.move(
    bounds.x + bounds.width * 0.54,
    bounds.y + bounds.height * 0.47,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.58,
    bounds.y + bounds.height * 0.53,
    { steps: 5 },
  );
  await page.mouse.up();
  const selectsWhenCrossingLine = await copyButton.isEnabled();

  const checks = {
    startsDeselected,
    selectsOnPartialOverlap,
    ignoresSeparatedSelection,
    ignoresEmptyAreaInsideLineBounds,
    selectsWhenCrossingLine,
  };

  if (!Object.values(checks).every(Boolean)) {
    throw new Error(
      `Excalidraw browser selection smoke failed: ${JSON.stringify(checks)}`,
    );
  }

  await page.evaluate((result) => {
    console.info(`[excalidraw-selection-browser-smoke] ${JSON.stringify(result)}`);
  }, checks);
}
