async (page) => {
  const checks = await page.evaluate(async () => {
    const {
      EXCALIBUR_COPY_ID_MIME,
      EXCALIBUR_WEB_COPY_ID_MIME,
      INTERNAL_CLIPBOARD_TTL_MS,
      collectInternalClipboardElements,
      createClipboardContentSignature,
      createClipboardCopyId,
      createInternalPasteEvent,
      embedInternalClipboardMarker,
      extractInternalClipboardCopyId,
      getClipboardContentSignature,
      getExternalClipboardHtml,
      getExternalClipboardSelectionMode,
      isInternalClipboardSnapshotFresh,
      isWritableClipboardTarget,
      serializeInternalClipboard,
      setClipboardEventRepresentations,
      writeAsyncClipboardRepresentations,
    } = await import("/src/clipboard.ts");
    const { duplicateNativeAttachmentRecords } = await import(
      "/src/attachmentDuplicates.ts"
    );

    const element = (overrides) => ({
      id: overrides.id,
      type: "rectangle",
      isDeleted: false,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      updated: 1,
      link: null,
      locked: false,
      ...overrides,
    });

    const frame = element({
      id: "frame-selected",
      type: "frame",
      boundElements: [
        { id: "frame-label", type: "text" },
        { id: "connected-arrow", type: "arrow" },
      ],
    });
    const frameLabel = element({
      id: "frame-label",
      type: "text",
      text: "Etapa",
      rawText: "Etapa",
      containerId: "frame-selected",
    });
    const child = element({
      id: "child-shape",
      frameId: "frame-selected",
      boundElements: [{ id: "child-label" }],
    });
    const childLabel = element({
      id: "child-label",
      type: "text",
      text: "Dentro",
      rawText: "Dentro",
      containerId: "child-shape",
      frameId: "frame-selected",
    });
    const childImage = element({
      id: "child-image",
      type: "image",
      fileId: "file-used",
      frameId: "frame-selected",
    });
    const childImageWithSharedFile = element({
      id: "child-image-shared-file",
      type: "image",
      fileId: "file-used",
      frameId: "frame-selected",
    });
    const connectedArrow = element({
      id: "connected-arrow",
      type: "arrow",
      startBinding: { elementId: "frame-selected" },
    });
    const deletedChild = element({
      id: "deleted-child",
      frameId: "frame-selected",
      isDeleted: true,
    });
    const unrelated = element({ id: "unrelated" });
    const scene = [
      unrelated,
      frameLabel,
      child,
      frame,
      childLabel,
      childImage,
      childImageWithSharedFile,
      connectedArrow,
      deletedChild,
    ];
    const standaloneText = element({
      id: "standalone-text",
      type: "text",
      text: "Texto",
      rawText: "Texto",
    });
    const standaloneImage = element({
      id: "standalone-image",
      type: "image",
      fileId: "file-used",
    });
    const secondStandaloneImage = element({
      id: "standalone-image-2",
      type: "image",
      fileId: "file-used",
    });
    const nativeRectangle = element({
      id: "native-rectangle",
      type: "rectangle",
    });
    const nativeDraw = element({
      id: "native-draw",
      type: "freedraw",
    });
    const imageOnlyClipboardMode = getExternalClipboardSelectionMode(
      [standaloneImage, secondStandaloneImage],
      { hasImage: true, hasText: false },
    );
    const textAndImageClipboardMode = getExternalClipboardSelectionMode(
      [standaloneText, standaloneImage],
      { hasImage: true, hasText: true },
    );
    const textOnlyClipboardMode = getExternalClipboardSelectionMode(
      [standaloneText],
      { hasImage: false, hasText: true },
    );
    const shapeAndContentClipboardMode = getExternalClipboardSelectionMode(
      [standaloneText, standaloneImage, nativeRectangle],
      { hasImage: true, hasText: true },
    );
    const drawAndImageClipboardMode = getExternalClipboardSelectionMode(
      [standaloneImage, nativeDraw],
      { hasImage: true, hasText: false },
    );
    const separateImagesHtml = getExternalClipboardHtml([
      {
        kind: "image",
        dataURL: "data:image/png;base64,AAAA",
        width: 120,
        height: 80,
      },
      {
        kind: "image",
        dataURL: "data:image/png;base64,BBBB",
        width: 90,
        height: 60,
      },
    ]);
    const firstImagePosition = separateImagesHtml.indexOf(
      "data:image/png;base64,AAAA",
    );
    const secondImagePosition = separateImagesHtml.indexOf(
      "data:image/png;base64,BBBB",
    );

    const collected = collectInternalClipboardElements(scene, {
      "child-image": true,
      "frame-selected": true,
      unrelated: false,
    });
    const collectedIds = collected.map((item) => item.id);
    const expectedCollectedIds = [
      "frame-label",
      "child-shape",
      "child-label",
      "child-image-shared-file",
      "frame-selected",
      "child-image",
    ];

    const files = {
      "file-used": {
        id: "file-used",
        dataURL: "data:image/png;base64,iVBORw0KGgo=",
        mimeType: "image/png",
        created: 1,
        lastRetrieved: 1,
      },
      "file-unused": {
        id: "file-unused",
        dataURL: "data:image/png;base64,dW51c2Vk",
        mimeType: "image/png",
        created: 1,
        lastRetrieved: 1,
      },
    };
    const snapshot = serializeInternalClipboard(collected, files);
    const serialized = JSON.parse(snapshot.json);
    const standaloneSnapshot = serializeInternalClipboard([child, childLabel], files);
    const standaloneSerialized = JSON.parse(standaloneSnapshot.json);

    const copyIdA = createClipboardCopyId();
    const copyIdB = createClipboardCopyId();
    const htmlA = embedInternalClipboardMarker(
      "<!doctype html><html><body><p>Primeiro</p></body></html>",
      copyIdA,
    );
    const htmlB = embedInternalClipboardMarker("<p>Segundo</p>", copyIdB);
    const emptyHtml = embedInternalClipboardMarker("", copyIdA);
    const markerReader = {
      getData: (type) => (type === "text/html" ? htmlA : ""),
    };
    const attributeOnlyReader = {
      getData: (type) =>
        type === "text/html"
          ? `<span data-excalibur-copy-id="${copyIdA}"></span>`
          : "",
    };
    const customMimeReader = {
      getData: (type) => {
        if (type === EXCALIBUR_COPY_ID_MIME) {
          return copyIdB;
        }
        return type === "text/html" ? htmlA : "";
      },
    };
    const throwingCustomMimeReader = {
      getData: (type) => {
        if (type === EXCALIBUR_COPY_ID_MIME || type === EXCALIBUR_WEB_COPY_ID_MIME) {
          throw new Error("custom MIME unavailable");
        }
        return type === "text/html" ? htmlA : "";
      },
    };

    const transferA = new DataTransfer();
    const payloadA = {
      copyId: copyIdA,
      html: htmlA,
      plainText: "Primeiro",
    };
    const transferB = new DataTransfer();
    const payloadB = {
      copyId: copyIdB,
      html: htmlB,
      plainText: "Segundo",
    };
    const wroteTransferA = setClipboardEventRepresentations(transferA, payloadA);
    const wroteTransferB = setClipboardEventRepresentations(transferB, payloadB);
    const activeSnapshot = { copyId: copyIdB };
    const oldTransferId = extractInternalClipboardCopyId(transferA);
    const currentTransferId = extractInternalClipboardCopyId(transferB);
    const signatureFromTransferA = getClipboardContentSignature(transferA);
    const signatureFromPayloadA = createClipboardContentSignature(
      payloadA.plainText,
      payloadA.html,
    );
    const normalizedSignature = createClipboardContentSignature(
      "Linha 1\r\nLinha 2",
      "<!doctype html><html><body><!--StartFragment--><p>Linha 1</p>\r\n<p>Linha 2</p><!--EndFragment--></body></html>",
    );
    const equivalentNormalizedSignature = createClipboardContentSignature(
      "Linha 1\nLinha 2",
      "<p>Linha 1</p>\n<p>Linha 2</p>",
    );
    const changedTextSignature = createClipboardContentSignature(
      "Linha 1\nLinha alterada",
      "<p>Linha 1</p>\n<p>Linha 2</p>",
    );
    const changedHtmlSignature = createClipboardContentSignature(
      "Linha 1\nLinha 2",
      "<p>Linha 1</p>\n<p>Linha alterada</p>",
    );
    const imageOnlySignature = createClipboardContentSignature(
      "",
      '<img src="data:image/png;base64,AAAA" />',
    );
    const changedImageOnlySignature = createClipboardContentSignature(
      "",
      '<img src="data:image/png;base64,BBBB" />',
    );
    const createdAt = 10_000;

    const host = document.createElement("section");
    host.innerHTML = `
      <textarea data-test="textarea"></textarea>
      <input data-test="text" type="text" />
      <input data-test="number" type="number" />
      <input data-test="password" type="password" />
      <input data-test="search" type="search" />
      <input data-test="email" type="email" />
      <input data-test="url" type="url" />
      <input data-test="tel" type="tel" />
      <select data-test="select"><option>Opcao</option></select>
      <input data-test="checkbox" type="checkbox" />
      <button data-test="button">Botao</button>
      <canvas data-test="canvas"></canvas>
      <div data-test="editable" contenteditable="true"><span data-test="editable-child">Texto</span></div>
      <div data-test="wysiwyg" data-type="wysiwyg"><span data-test="wysiwyg-child">Texto</span></div>
      <br data-test="br" />
    `;
    document.body.append(host);
    const target = (name) => host.querySelector(`[data-test="${name}"]`);
    const writableTargetChecks = {
      textarea: isWritableClipboardTarget(target("textarea")),
      text: isWritableClipboardTarget(target("text")),
      number: isWritableClipboardTarget(target("number")),
      password: isWritableClipboardTarget(target("password")),
      search: isWritableClipboardTarget(target("search")),
      email: isWritableClipboardTarget(target("email")),
      url: isWritableClipboardTarget(target("url")),
      tel: isWritableClipboardTarget(target("tel")),
      select: isWritableClipboardTarget(target("select")),
      editable: isWritableClipboardTarget(target("editable")),
      editableChild: isWritableClipboardTarget(target("editable-child")),
      wysiwyg: isWritableClipboardTarget(target("wysiwyg")),
      wysiwygChild: isWritableClipboardTarget(target("wysiwyg-child")),
      br: isWritableClipboardTarget(target("br")),
      checkboxIsNotWritable: !isWritableClipboardTarget(target("checkbox")),
      buttonIsNotWritable: !isWritableClipboardTarget(target("button")),
      canvasIsNotWritable: !isWritableClipboardTarget(target("canvas")),
      nullIsNotWritable: !isWritableClipboardTarget(null),
    };

    const internalPasteEvent = createInternalPasteEvent(snapshot.json);
    const sourceAttachmentId = "attachment-source";
    const sourcePageOne = element({
      id: "source-page-1",
      type: "image",
      fileId: "page-file-1",
      x: 20,
      y: 30,
      customData: {
        excaliburAttachment: {
          attachmentId: sourceAttachmentId,
          pageIndex: 0,
          sourcePath: "C:\\safe\\documento.pdf",
        },
      },
    });
    const sourcePageTwo = element({
      id: "source-page-2",
      type: "image",
      fileId: "page-file-2",
      x: 20,
      y: 130,
      customData: {
        excaliburAttachment: {
          attachmentId: sourceAttachmentId,
          pageIndex: 1,
          sourcePath: "C:\\safe\\documento.pdf",
        },
      },
    });
    const clonePageOne = element({
      ...sourcePageOne,
      id: "clone-page-1",
      x: 300,
      y: 300,
    });
    const clonePageTwo = element({
      ...sourcePageTwo,
      id: "clone-page-2",
      x: 300,
      y: 400,
    });
    const untrustedExternalElement = element({
      id: "external-page",
      type: "image",
      fileId: "external-file",
      x: 500,
      y: 500,
      customData: {
        excaliburAttachment: {
          attachmentId: "attachment-not-local",
          pageIndex: 0,
          sourcePath: "C:\\untrusted\\payload.pdf",
        },
      },
    });
    const sourceAttachment = {
      id: sourceAttachmentId,
      name: "documento.pdf",
      path: "C:\\safe\\documento.pdf",
      extension: "pdf",
      mimeType: "application/pdf",
      kind: "pdf",
      size: 1234,
      displayMode: "native",
      x: 20,
      y: 30,
      width: 100,
      height: 180,
      createdAt: 100,
      nativeElementIds: [sourcePageOne.id, sourcePageTwo.id],
      nativePageCount: 2,
      nativeSourcePageCount: 2,
    };
    const previousAttachmentElements = [sourcePageOne, sourcePageTwo];
    const nextAttachmentElements = [
      clonePageTwo,
      sourcePageTwo,
      untrustedExternalElement,
      clonePageOne,
      sourcePageOne,
    ];
    const duplicateResult = duplicateNativeAttachmentRecords(
      nextAttachmentElements,
      previousAttachmentElements,
      [sourceAttachment],
      () => "attachment-copy",
      20_000,
    );
    const duplicatedAttachment = duplicateResult?.attachments.find(
      (attachment) => attachment.id === "attachment-copy",
    );
    const duplicatedPageOne = duplicateResult?.elements.find(
      (item) => item.id === clonePageOne.id,
    );
    const duplicatedPageTwo = duplicateResult?.elements.find(
      (item) => item.id === clonePageTwo.id,
    );
    const preservedSourcePage = duplicateResult?.elements.find(
      (item) => item.id === sourcePageOne.id,
    );
    const preservedExternalPage = duplicateResult?.elements.find(
      (item) => item.id === untrustedExternalElement.id,
    );
    const idempotentDuplicateResult = duplicateResult
      ? duplicateNativeAttachmentRecords(
          duplicateResult.elements,
          previousAttachmentElements,
          duplicateResult.attachments,
          () => "should-not-be-created",
          30_000,
        )
      : undefined;
    const missingOriginResult = duplicateNativeAttachmentRecords(
      [...previousAttachmentElements, untrustedExternalElement],
      previousAttachmentElements,
      [sourceAttachment],
      () => "should-not-be-created",
      30_000,
    );
    const crossCanvasDuplicateResult = duplicateNativeAttachmentRecords(
      [clonePageTwo, clonePageOne],
      [],
      [],
      () => "attachment-cross-canvas",
      40_000,
      [sourceAttachment],
    );
    const crossCanvasAttachment = crossCanvasDuplicateResult?.attachments.find(
      (attachment) => attachment.id === "attachment-cross-canvas",
    );

    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const originalClipboardItemDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "ClipboardItem",
    );
    const writtenItems = [];
    class TestClipboardItem {
      constructor(representations) {
        this.representations = representations;
        this.types = Object.keys(representations);
      }
    }

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items) => {
          writtenItems.push(...items);
        },
      },
    });
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: TestClipboardItem,
    });

    let asyncWriteResult = false;
    let asyncTypes = [];
    let asyncPlainText = "";
    let asyncHtml = "";
    let resolvedCallbackHtml = "";
    let unavailableAsyncWriteResult = true;
    try {
      asyncWriteResult = await writeAsyncClipboardRepresentations({
        ...payloadA,
        imageBlob: Promise.resolve(new Blob(["png"], { type: "image/png" })),
        onResolvedHtml: (html) => {
          resolvedCallbackHtml = html;
        },
        renderImageBlobInHtml: true,
      });
      const item = writtenItems[0];
      asyncTypes = item?.types ?? [];
      asyncPlainText = await (
        await item?.representations?.["text/plain"]
      )?.text();
      asyncHtml = await (
        await item?.representations?.["text/html"]
      )?.text();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {},
      });
      unavailableAsyncWriteResult = await writeAsyncClipboardRepresentations(
        payloadA,
      );
    } finally {
      if (originalClipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
      } else {
        delete navigator.clipboard;
      }
      if (originalClipboardItemDescriptor) {
        Object.defineProperty(window, "ClipboardItem", originalClipboardItemDescriptor);
      } else {
        delete window.ClipboardItem;
      }
      host.remove();
    }

    let rejectsInvalidCopyId = false;
    try {
      embedInternalClipboardMarker("<p>Invalido</p>", "bad id");
    } catch {
      rejectsInvalidCopyId = true;
    }

    return {
      imageOnlySelectionKeepsImagesSeparate:
        imageOnlyClipboardMode === "rich" &&
        (separateImagesHtml.match(/<img /g) ?? []).length === 2 &&
        firstImagePosition >= 0 &&
        secondImagePosition > firstImagePosition,
      textAndImageSelectionKeepsRichOrdering:
        textAndImageClipboardMode === "rich",
      textOnlySelectionUsesPlainText:
        textOnlyClipboardMode === "text",
      nativeShapeForcesWholeSelectionRasterization:
        shapeAndContentClipboardMode === "raster",
      nativeDrawForcesWholeSelectionRasterization:
        drawAndImageClipboardMode === "raster",
      copyIdsAreUniqueAndPortable:
        copyIdA !== copyIdB &&
        /^[A-Za-z0-9_-]{8,128}$/.test(copyIdA) &&
        /^[A-Za-z0-9_-]{8,128}$/.test(copyIdB),
      frameIncludesChildrenAndBoundText:
        JSON.stringify(collectedIds) === JSON.stringify(expectedCollectedIds),
      frameAndExplicitChildAreCollectedOnlyOnce:
        collectedIds.length === new Set(collectedIds).size &&
        collectedIds.filter((id) => id === "child-image").length === 1,
      unselectedConnectedArrowsStayExcluded:
        !collectedIds.includes("connected-arrow"),
      deletedAndUnselectedElementsAreExcluded:
        !collectedIds.includes("deleted-child") && !collectedIds.includes("unrelated"),
      serializationUsesExcalidrawClipboardContract:
        serialized.type === "excalidraw/clipboard" &&
        serialized.elements.length === expectedCollectedIds.length,
      serializationKeepsCopiedFrameRelations:
        serialized.elements.find((item) => item.id === "child-shape")?.frameId ===
          "frame-selected" &&
        serialized.elements.find((item) => item.id === "child-label")?.frameId ===
          "frame-selected",
      serializationDetachesChildrenWithoutTheirFrame:
        standaloneSerialized.elements.every((item) => item.frameId === null) &&
        Object.keys(standaloneSerialized.files).length === 0 &&
        child.frameId === "frame-selected" &&
        childLabel.frameId === "frame-selected",
      serializationIncludesOnlyReferencedFiles:
        Object.keys(serialized.files ?? {}).join(",") === "file-used" &&
        serialized.files["file-used"].dataURL === files["file-used"].dataURL &&
        serialized.elements.filter((item) => item.fileId === "file-used").length === 2,
      sharedFileIsSerializedOnceForMultipleImages:
        Object.keys(serialized.files ?? {}).filter((fileId) => fileId === "file-used")
          .length === 1,
      snapshotElementsMatchSerializedElements:
        JSON.stringify(snapshot.elements) === JSON.stringify(serialized.elements),
      markerRoundTripsThroughHtml:
        extractInternalClipboardCopyId(markerReader) === copyIdA &&
        htmlA.includes("<p>Primeiro</p>") &&
        htmlA.indexOf(`excalibur-copy:${copyIdA}`) < htmlA.indexOf("<p>Primeiro</p>"),
      attributeMarkerIsAccepted:
        extractInternalClipboardCopyId(attributeOnlyReader) === copyIdA,
      customMimeTakesPrecedence:
        extractInternalClipboardCopyId(customMimeReader) === copyIdB,
      htmlFallbackSurvivesCustomMimeFailure:
        extractInternalClipboardCopyId(throwingCustomMimeReader) === copyIdA,
      emptyHtmlStillCarriesMarker:
        emptyHtml.includes("<!doctype html>") &&
        extractInternalClipboardCopyId({
          getData: (type) => (type === "text/html" ? emptyHtml : ""),
        }) === copyIdA,
      invalidMarkersAreRejected:
        extractInternalClipboardCopyId({
          getData: (type) =>
            type === "text/html" ? "<!--excalibur-copy:bad id-->" : "bad id",
        }) === null && rejectsInvalidCopyId,
      eventRepresentationsContainExternalContent:
        wroteTransferA &&
        transferA.getData("text/plain") === "Primeiro" &&
        transferA.getData("text/html") === htmlA,
      eventRepresentationsCarryInternalIdentity:
        extractInternalClipboardCopyId(transferA) === copyIdA,
      subsequentCopyInvalidatesOldIdentity:
        wroteTransferB &&
        oldTransferId !== activeSnapshot.copyId &&
        currentTransferId === activeSnapshot.copyId,
      clipboardSignatureReadsPublishedRepresentations:
        signatureFromTransferA === signatureFromPayloadA &&
        getClipboardContentSignature(null) === null &&
        getClipboardContentSignature({
          getData: () => {
            throw new Error("clipboard unavailable");
          },
        }) === null,
      clipboardSignatureNormalizesCrLfAndHtmlFragments:
        normalizedSignature === equivalentNormalizedSignature,
      clipboardSignatureRejectsChangedText:
        changedTextSignature !== normalizedSignature,
      clipboardSignatureRejectsChangedHtml:
        changedHtmlSignature !== normalizedSignature,
      imageOnlyClipboardStillHasContentIntegrity:
        imageOnlySignature !== changedImageOnlySignature,
      internalClipboardExpiresAtConfiguredBoundary:
        INTERNAL_CLIPBOARD_TTL_MS > 0 &&
        isInternalClipboardSnapshotFresh(createdAt, createdAt) &&
        !isInternalClipboardSnapshotFresh(
          createdAt,
          createdAt + INTERNAL_CLIPBOARD_TTL_MS,
        ) &&
        !isInternalClipboardSnapshotFresh(
          createdAt,
          createdAt + INTERNAL_CLIPBOARD_TTL_MS + 1,
        ) &&
        !isInternalClipboardSnapshotFresh(createdAt, createdAt - 1) &&
        !isInternalClipboardSnapshotFresh(Number.NaN, createdAt),
      writableTargetsArePreserved: Object.values(writableTargetChecks).every(Boolean),
      syntheticPasteCarriesOnlyInternalJson:
        internalPasteEvent.type === "paste" &&
        internalPasteEvent.bubbles &&
        internalPasteEvent.cancelable &&
        internalPasteEvent.clipboardData?.getData("text/plain") === snapshot.json &&
        internalPasteEvent.clipboardData?.getData("text/html") === "",
      multiPageDuplicateCreatesOneAttachment:
        duplicateResult !== null &&
        duplicateResult.attachments.length === 2 &&
        duplicateResult.attachments.filter(
          (attachment) => attachment.id === "attachment-copy",
        ).length === 1 &&
        duplicatedAttachment?.nativePageCount === 2,
      duplicatedPagesReceiveOneNewAttachmentIdentity:
        duplicatedPageOne?.customData?.excaliburAttachment?.attachmentId ===
          "attachment-copy" &&
        duplicatedPageTwo?.customData?.excaliburAttachment?.attachmentId ===
          "attachment-copy" &&
        JSON.stringify(duplicatedAttachment?.nativeElementIds) ===
          JSON.stringify(["clone-page-1", "clone-page-2"]),
      duplicatedAttachmentUsesPageOrderAndGroupBounds:
        duplicatedAttachment?.createdAt === 20_000 &&
        duplicatedAttachment?.x === 300 &&
        duplicatedAttachment?.y === 300 &&
        duplicatedAttachment?.width === 100 &&
        duplicatedAttachment?.height === 180,
      duplicatedAttachmentSharesPathAndBinaryFiles:
        duplicatedAttachment?.path === sourceAttachment.path &&
        duplicatedPageOne?.fileId === sourcePageOne.fileId &&
        duplicatedPageTwo?.fileId === sourcePageTwo.fileId,
      attachmentSourceAndInputsRemainImmutable:
        sourceAttachment.id === sourceAttachmentId &&
        sourceAttachment.nativeElementIds.join(",") ===
          "source-page-1,source-page-2" &&
        preservedSourcePage?.customData?.excaliburAttachment?.attachmentId ===
          sourceAttachmentId &&
        sourcePageOne.customData.excaliburAttachment.attachmentId ===
          sourceAttachmentId,
      untrustedAttachmentOriginIsNotDuplicated:
        preservedExternalPage?.customData?.excaliburAttachment?.attachmentId ===
          "attachment-not-local" &&
        !duplicateResult?.attachments.some(
          (attachment) => attachment.id === "attachment-not-local",
        ) &&
        missingOriginResult === null,
      crossCanvasDuplicateUsesTrustedClipboardSource:
        crossCanvasDuplicateResult !== null &&
        crossCanvasDuplicateResult.attachments.length === 1 &&
        crossCanvasAttachment?.path === sourceAttachment.path &&
        crossCanvasAttachment?.createdAt === 40_000 &&
        JSON.stringify(crossCanvasAttachment?.nativeElementIds) ===
          JSON.stringify(["clone-page-1", "clone-page-2"]) &&
        crossCanvasDuplicateResult.elements.every(
          (item) =>
            item.customData?.excaliburAttachment?.attachmentId ===
            "attachment-cross-canvas",
        ),
      duplicateReconciliationIsIdempotent: idempotentDuplicateResult === null,
      asyncClipboardWritesAllRepresentations:
        asyncWriteResult &&
        writtenItems.length === 1 &&
        ["text/html", "text/plain", "image/png"].every((type) =>
          asyncTypes.includes(type),
        ) &&
        asyncPlainText === "Primeiro" &&
        asyncHtml.includes(`<span data-excalibur-copy-id="${copyIdA}"`) &&
        asyncHtml.includes('<img src="data:image/png;base64,cG5n"') &&
        resolvedCallbackHtml === asyncHtml,
      unavailableAsyncClipboardIsReported:
        unavailableAsyncWriteResult === false,
    };
  });

  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`Clipboard smoke failed: ${JSON.stringify(checks)}`);
  }

  await page.evaluate((result) => {
    console.info(`[clipboard-smoke] ${JSON.stringify(result)}`);
  }, checks);
}
