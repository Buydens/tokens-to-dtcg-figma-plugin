// code.js — runs in the Figma sandbox. Has access to figma.* API.
// Reads local Variables and sends a plain-JSON snapshot to the UI.

figma.showUI(__html__, {
  width: 520,
  height: 680,
  themeColors: true,
  title: "Tokens → DTCG"
});

async function readLocalVariables() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();

  const collectionsOut = {};
  for (const col of collections) {
    const modes = {};
    for (const m of col.modes) modes[m.modeId] = m.name;
    collectionsOut[col.id] = {
      id: col.id,
      name: col.name,
      modes: modes,
      defaultModeId: col.defaultModeId,
      variableIds: col.variableIds
    };
  }

  const variablesOut = {};
  for (const v of variables) {
    // valuesByMode may contain VariableAlias objects which stringify cleanly
    // to { type: 'VARIABLE_ALIAS', id: '...' } via a manual copy.
    const valuesByMode = {};
    for (const [modeId, raw] of Object.entries(v.valuesByMode)) {
      if (raw && typeof raw === "object" && "type" in raw && raw.type === "VARIABLE_ALIAS") {
        valuesByMode[modeId] = { type: "VARIABLE_ALIAS", id: raw.id };
      } else {
        valuesByMode[modeId] = raw;
      }
    }

    variablesOut[v.id] = {
      id: v.id,
      name: v.name,
      description: v.description || "",
      resolvedType: v.resolvedType,
      variableCollectionId: v.variableCollectionId,
      valuesByMode: valuesByMode,
      scopes: v.scopes || [],
      hiddenFromPublishing: v.hiddenFromPublishing || false
    };
  }

  return {
    variableCollections: collectionsOut,
    variables: variablesOut,
    _meta: {
      collectionCount: Object.keys(collectionsOut).length,
      variableCount: Object.keys(variablesOut).length,
      fileName: figma.root.name || "Untitled"
    }
  };
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === "read-variables") {
      const data = await readLocalVariables();
      figma.ui.postMessage({ type: "variables-data", data });
    } else if (msg.type === "notify") {
      figma.notify(msg.message || "", { timeout: msg.timeout || 2000, error: msg.error === true });
    } else if (msg.type === "close") {
      figma.closePlugin(msg.message);
    } else if (msg.type === "resize") {
      figma.ui.resize(Math.max(400, msg.width || 520), Math.max(400, msg.height || 680));
    } else if (msg.type === "get-git-config") {
      const config = await figma.clientStorage.getAsync("git-config");
      figma.ui.postMessage({ type: "git-config", config: config || null });
    } else if (msg.type === "save-git-config") {
      await figma.clientStorage.setAsync("git-config", msg.config || null);
      figma.ui.postMessage({ type: "git-config-saved" });
    } else if (msg.type === "clear-git-config") {
      await figma.clientStorage.deleteAsync("git-config");
      figma.ui.postMessage({ type: "git-config", config: null });
    }
  } catch (err) {
    figma.ui.postMessage({
      type: "error",
      message: (err && err.message) ? err.message : String(err)
    });
  }
};
