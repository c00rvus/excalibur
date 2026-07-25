async (page) => {
  const result = await page.evaluate(async () => {
    const { executeCanvasPlan } = await import("/src/codex/executor.ts");
    const created = executeCanvasPlan([], {
      summary: "layout smoke",
      commands: [
        { type: "createShape", id: "start", shape: "ellipse", x: 130, y: 40, width: 160, height: 70, label: "Início" },
        { type: "createShape", id: "login", shape: "rectangle", x: 100, y: 210, width: 220, height: 80, label: "Inserir email e senha" },
        { type: "createShape", id: "valid", shape: "diamond", x: 100, y: 400, width: 220, height: 120, label: "Credenciais válidas?" },
        { type: "connectElements", id: "a1", fromElementId: "start", toElementId: "login" },
        { type: "connectElements", id: "a2", fromElementId: "login", toElementId: "valid", label: "Continuar" },
      ],
    });
    const login = created.elements.find((element) => element.id === "login");
    const loginLabelId = login.boundElements.find((bound) => bound.type === "text").id;
    const updated = executeCanvasPlan(created.elements, {
      summary: "reflow smoke",
      commands: [
        { type: "updateText", elementId: loginLabelId, text: "Inserir endereço de email e senha com segurança" },
        { type: "resizeElement", elementId: "login", width: 180, height: 110 },
        { type: "moveElements", elementIds: ["valid"], deltaX: 320, deltaY: 20 },
      ],
    });

    const byId = (id) => updated.elements.find((element) => element.id === id);
    const point = (arrow, index) => ({
      x: arrow.x + arrow.points[index][0],
      y: arrow.y + arrow.points[index][1],
    });
    const insideRectangle = (candidate, shape) =>
      candidate.x >= shape.x && candidate.x <= shape.x + shape.width &&
      candidate.y >= shape.y && candidate.y <= shape.y + shape.height;
    const insideEllipse = (candidate, shape) => {
      const x = (candidate.x - (shape.x + shape.width / 2)) / (shape.width / 2);
      const y = (candidate.y - (shape.y + shape.height / 2)) / (shape.height / 2);
      return x * x + y * y <= 1;
    };
    const insideDiamond = (candidate, shape) => {
      const x = Math.abs(candidate.x - (shape.x + shape.width / 2)) / (shape.width / 2);
      const y = Math.abs(candidate.y - (shape.y + shape.height / 2)) / (shape.height / 2);
      return x + y <= 1;
    };
    const overlaps = (first, second) =>
      first.x < second.x + second.width && first.x + first.width > second.x &&
      first.y < second.y + second.height && first.y + first.height > second.y;

    const start = byId("start");
    const resizedLogin = byId("login");
    const valid = byId("valid");
    const firstArrow = byId("a1");
    const movedArrow = byId("a2");
    const loginLabel = byId(loginLabelId);
    const arrowLabel = updated.elements.find(
      (element) => element.type === "text" && element.containerId === "a2",
    );
    const checks = {
      firstArrowStartsOutsideEllipse: !insideEllipse(point(firstArrow, 0), start),
      firstArrowEndsOutsideRectangle: !insideRectangle(point(firstArrow, firstArrow.points.length - 1), resizedLogin),
      movedArrowStartsOutsideRectangle: !insideRectangle(point(movedArrow, 0), resizedLogin),
      movedArrowEndsOutsideDiamond: !insideDiamond(point(movedArrow, movedArrow.points.length - 1), valid),
      resizedLabelInsideContainer:
        loginLabel.x >= resizedLogin.x && loginLabel.y >= resizedLogin.y &&
        loginLabel.x + loginLabel.width <= resizedLogin.x + resizedLogin.width &&
        loginLabel.y + loginLabel.height <= resizedLogin.y + resizedLogin.height,
      resizedLabelWrapped: loginLabel.text.includes("\n"),
      arrowLabelAvoidsSource: !overlaps(arrowLabel, resizedLogin),
      arrowLabelAvoidsTarget: !overlaps(arrowLabel, valid),
      compactArrowLabel: arrowLabel.fontSize === 16,
    };
    return { checks, allPassed: Object.values(checks).every(Boolean) };
  });

  if (!result.allPassed) {
    throw new Error(`Codex layout smoke failed: ${JSON.stringify(result.checks)}`);
  }
  await page.evaluate((checks) => {
    console.info(`[codex-layout-smoke] ${JSON.stringify(checks)}`);
  }, result.checks);
}
