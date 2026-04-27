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

// Apply a resolved DTCG → Figma plan.
// plan = {
//   collections: [{ name, modes: [modeName, ...] }],
//   upserts: [{
//     collection, path, figmaType ("COLOR"|"FLOAT"|"STRING"|"BOOLEAN"),
//     scopes: [...], description,
//     values: [
//       { mode, kind: "literal", value: <figma value> },
//       { mode, kind: "alias",   target: { collection, path } }
//     ]
//   }],
//   deletes: [{ collection, path }]
// }
async function applyPlan(plan) {
  const report = {
    counts: { collectionsCreated: 0, modesCreated: 0, variablesCreated: 0, variablesUpdated: 0, valuesSet: 0, aliasesBound: 0, deleted: 0 },
    failed: [],
    notes: []
  };

  // ----- collections + modes -----
  const allCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const colByName = new Map();
  for (const c of allCollections) colByName.set(c.name, c);

  for (const colInfo of (plan.collections || [])) {
    let col = colByName.get(colInfo.name);
    const wantModes = Array.isArray(colInfo.modes) ? colInfo.modes : [];

    if (!col) {
      try {
        col = figma.variables.createVariableCollection(colInfo.name);
        colByName.set(colInfo.name, col);
        report.counts.collectionsCreated++;
        // Rename the auto-created default mode to the first requested mode (if any),
        // then add the rest. Avoids leaving a stray "Mode 1".
        if (wantModes.length > 0 && col.modes.length > 0) {
          try { col.renameMode(col.modes[0].modeId, wantModes[0]); } catch (_) {}
          for (let i = 1; i < wantModes.length; i++) {
            try { col.addMode(wantModes[i]); report.counts.modesCreated++; } catch (e) {
              report.failed.push({ where: "mode " + colInfo.name + "/" + wantModes[i], message: String(e && e.message || e) });
            }
          }
        }
      } catch (e) {
        report.failed.push({ where: "collection " + colInfo.name, message: String(e && e.message || e) });
        continue;
      }
    } else {
      // Add any missing modes (don't rename existing ones — that's user-customizable territory)
      const existing = new Set(col.modes.map(m => m.name));
      for (const m of wantModes) {
        if (!existing.has(m)) {
          try { col.addMode(m); existing.add(m); report.counts.modesCreated++; }
          catch (e) { report.failed.push({ where: "mode " + col.name + "/" + m, message: String(e && e.message || e) }); }
        }
      }
    }
  }

  // ----- variable lookup (refresh after any new creates) -----
  const allVarsNow = await figma.variables.getLocalVariablesAsync();
  const colIdToName = new Map();
  for (const c of colByName.values()) colIdToName.set(c.id, c.name);

  const varKey = (collection, name) => collection + "::" + name;
  const varByKey = new Map();
  for (const v of allVarsNow) {
    const colName = colIdToName.get(v.variableCollectionId);
    if (colName) varByKey.set(varKey(colName, v.name), v);
  }

  // ----- upserts (pass 1: literals; aliases deferred to pass 2) -----
  const aliasJobs = [];
  for (const u of (plan.upserts || [])) {
    const col = colByName.get(u.collection);
    if (!col) {
      report.failed.push({ where: u.collection + "/" + u.path, message: "Collection not available" });
      continue;
    }
    let variable = varByKey.get(varKey(u.collection, u.path));
    const isNew = !variable;
    if (isNew) {
      try {
        variable = figma.variables.createVariable(u.path, col, u.figmaType);
        varByKey.set(varKey(u.collection, u.path), variable);
        if (Array.isArray(u.scopes) && u.scopes.length) {
          try { variable.scopes = u.scopes; } catch (_) {}
        }
        if (typeof u.description === "string" && u.description) {
          try { variable.description = u.description; } catch (_) {}
        }
        report.counts.variablesCreated++;
      } catch (e) {
        report.failed.push({ where: u.collection + "/" + u.path, message: "Create: " + String(e && e.message || e) });
        continue;
      }
    } else {
      report.counts.variablesUpdated++;
    }

    for (const v of (u.values || [])) {
      const mode = col.modes.find(m => m.name === v.mode);
      if (!mode) {
        report.failed.push({ where: u.collection + "/" + u.path + " @ " + v.mode, message: "Mode missing" });
        continue;
      }
      if (v.kind === "literal") {
        try {
          variable.setValueForMode(mode.modeId, v.value);
          report.counts.valuesSet++;
        } catch (e) {
          report.failed.push({ where: u.collection + "/" + u.path + " @ " + v.mode, message: "setValue: " + String(e && e.message || e) });
        }
      } else if (v.kind === "alias") {
        aliasJobs.push({
          variable, modeId: mode.modeId, target: v.target,
          where: u.collection + "/" + u.path + " @ " + v.mode
        });
      }
    }
  }

  // ----- pass 2: aliases (now that all targets exist) -----
  for (const job of aliasJobs) {
    const target = varByKey.get(varKey(job.target.collection, job.target.path));
    if (!target) {
      report.failed.push({ where: job.where, message: "Alias target not found: " + job.target.collection + "/" + job.target.path });
      continue;
    }
    try {
      const aliasObj = figma.variables.createVariableAlias(target);
      job.variable.setValueForMode(job.modeId, aliasObj);
      report.counts.aliasesBound++;
    } catch (e) {
      report.failed.push({ where: job.where, message: "Alias: " + String(e && e.message || e) });
    }
  }

  // ----- deletes (only the ones the user opted into) -----
  for (const d of (plan.deletes || [])) {
    const v = varByKey.get(varKey(d.collection, d.path));
    if (!v) {
      report.notes.push("Delete skipped — not found: " + d.collection + "/" + d.path);
      continue;
    }
    try {
      v.remove();
      varByKey.delete(varKey(d.collection, d.path));
      report.counts.deleted++;
    } catch (e) {
      report.failed.push({ where: d.collection + "/" + d.path, message: "Delete: " + String(e && e.message || e) });
    }
  }

  return report;
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === "read-variables") {
      const data = await readLocalVariables();
      figma.ui.postMessage({ type: "variables-data", data });
    } else if (msg.type === "apply-plan") {
      const report = await applyPlan(msg.plan || {});
      figma.ui.postMessage({ type: "apply-report", report });
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
