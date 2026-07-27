import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(
  process.cwd(),
  "node_modules",
  "@excalidraw",
  "excalidraw",
);

const bundles = {
  development: {
    path: join(packageRoot, "dist", "dev", "chunk-4FTI6OG3.js"),
    expected:
      "selectionX1 <= elementX2 && selectionY1 <= elementY2 && selectionX2 >= elementX1 && selectionY2 >= elementY1 && excaliburElementIntersectsMarquee(element, [selectionX1, selectionY1, selectionX2, selectionY2], elementsMap)",
    rejected:
      "selectionX1 <= elementX1 && selectionY1 <= elementY1 && selectionX2 >= elementX2 && selectionY2 >= elementY2",
  },
  production: {
    path: join(packageRoot, "dist", "prod", "chunk-K2UTITRG.js"),
    expected:
      "o<=p&&i<=m&&a>=l&&s>=U&&excaliburElementIntersectsMarquee(c,[o,i,a,s],n)",
    rejected: "o<=l&&i<=U&&a>=p&&s>=m",
  },
};

const overlaps = (selection, element) =>
  selection.x1 <= element.x2 &&
  selection.y1 <= element.y2 &&
  selection.x2 >= element.x1 &&
  selection.y2 >= element.y1;

const behaviorChecks = {
  selectsWhenPartiallyOverlapping: overlaps(
    { x1: 0, y1: 0, x2: 60, y2: 60 },
    { x1: 50, y1: 50, x2: 100, y2: 100 },
  ),
  selectsWhenEdgesTouch: overlaps(
    { x1: 0, y1: 0, x2: 50, y2: 50 },
    { x1: 50, y1: 10, x2: 100, y2: 40 },
  ),
  selectsWhenFullyContained: overlaps(
    { x1: 0, y1: 0, x2: 100, y2: 100 },
    { x1: 25, y1: 25, x2: 75, y2: 75 },
  ),
  ignoresSeparatedElements: !overlaps(
    { x1: 0, y1: 0, x2: 49, y2: 49 },
    { x1: 50, y1: 50, x2: 100, y2: 100 },
  ),
};

const bundleChecks = Object.fromEntries(
  Object.entries(bundles).flatMap(([name, bundle]) => {
    const content = readFileSync(bundle.path, "utf8");
    return [
      [`${name}UsesOverlapSelection`, content.includes(bundle.expected)],
      [`${name}RemovedContainmentSelection`, !content.includes(bundle.rejected)],
      [
        `${name}UsesGeometryIntersection`,
        content.includes("var excaliburElementIntersectsMarquee ="),
      ],
    ];
  }),
);

const checks = {
  ...behaviorChecks,
  ...bundleChecks,
};

if (Object.values(checks).some((passed) => !passed)) {
  throw new Error(
    `Excalidraw selection smoke failed: ${JSON.stringify(checks)}`,
  );
}

console.info(`[excalidraw-selection-smoke] ${JSON.stringify(checks)}`);
