# DTCG → Figma Variables Importer — Design

Status: draft, pre-implementation. The JSON in this repo is the source of truth; the exporter stays untouched. The importer has to handle DTCG files produced by this plugin **and** any reasonably-shaped third-party DTCG file.

---

## 0. Priority

The **importer is the product.** The exporter is a one-shot migration helper — used to seed the initial JSON from an existing Figma file, then effectively retired. Concretely:

- The importer's primary target is **well-formed DTCG written by humans or other tools** (hand-edited, Style Dictionary, Tokens Studio exports, etc.) — not files freshly produced by our own exporter.
- Round-trip fidelity (Figma → JSON → Figma) is **not** a goal. The expected workflow is Figma → JSON (once), then JSON → Figma (repeatedly).
- The exporter's bucketed-modes shape is still supported as a legacy input, but we don't optimize for it. The mapping UI carries the weight when an incoming file doesn't know about Figma's quirks.

---

## 1. Goals

- Apply a DTCG JSON to the current Figma file's local Variables: create, update, optionally delete.
- Be safe: nothing changes until the user explicitly applies a previewed diff.
- Be honest: surface every gap between DTCG and Figma Variables (composites, units, scopes) instead of silently dropping data.
- Stay DTCG-compliant. No mandatory non-standard fields. `$extensions.com.figma.*` is read if present (it's spec-sanctioned), but never required.

## 2. Non-goals

- Writing Figma **Styles** (text/effect styles). Composites stay reported-and-skipped for now.
- Editing the source JSON from inside the plugin. Round-tripping through GitHub is a separate concern.
- Bulk-renaming or refactoring existing Figma variables.

---

## 3. Accepted input shapes

The importer accepts any tree where leaves are DTCG tokens (`$value` + optional `$type`/`$description`/`$extensions`) and groups are plain objects.

Recognized top-level conventions:

1. **Single root, collections as top-level groups** — what this plugin's exporter produces:
   ```
   { "Colors": { ... }, "Spacing": { ... } }
   ```
2. **Mode-bucketed collections** — also produced by the exporter for multi-mode collections:
   ```
   { "Colors": { "Light": { ... }, "Dark": { ... } } }
   ```
   Detected when sibling groups under a collection have matching descendant structure. Always confirmed by the user in the mapping UI (never silent).
3. **Flat DTCG file with no collection wrapper** — single implicit collection, name asked in the UI.

Files with a `$themes` array or Tokens-Studio-style multi-set shape are out of scope for v1 (warn and refuse).

---

## 4. Type mapping (DTCG → Figma)

| DTCG `$type`     | Figma type         | Notes                                                                                          |
|------------------|--------------------|------------------------------------------------------------------------------------------------|
| `color`          | `COLOR`            | Parse `#rgb`/`#rrggbb`/`#rrggbbaa`, `rgb()`, `rgba()`, and `{colorSpace, components, alpha}`. Non-sRGB → convert to sRGB and warn. |
| `dimension`      | `FLOAT`            | Strip unit; `rem`/`em` → multiply by configured root size (default 16), warn once.             |
| `number`         | `FLOAT`            | Ambiguous (could be a dimension). Mapping UI offers "treat as dimension" toggle per group.     |
| `fontWeight`     | `FLOAT` or `STRING`| Numeric → `FLOAT`; named (`"bold"`) → `STRING`.                                                |
| `fontFamily`     | `STRING`           | Array → join with `, `.                                                                        |
| `duration`       | `FLOAT`            | Strip `ms`/`s`; `s` → ×1000; warn.                                                             |
| `cubicBezier`    | `STRING`           | Stringify the array.                                                                           |
| `string`         | `STRING`           |                                                                                                |
| `boolean`        | `BOOLEAN`          |                                                                                                |
| `strokeStyle`    | `STRING`           | Composite form (`{dashArray, lineCap}`) → JSON-stringify with warning.                         |
| `border`, `shadow`, `typography`, `transition`, `gradient` | — | **Skip + report.** No native Variable equivalent.   |
| missing `$type`  | infer from value   | hex string → `color`; bool → `boolean`; numeric string with unit → `dimension`; bare number → `number`; everything else → `string`. |

## 5. Scopes (defaults)

Derived from `$type` first, then refined by group-name heuristics; finally overridable in the mapping UI.

| Condition                                                  | Default scopes                                       |
|------------------------------------------------------------|------------------------------------------------------|
| `$type: color`                                             | `ALL_FILLS, STROKE_COLOR`                            |
| `$type: color` and group path includes `text` / `fg` / `foreground` | `TEXT_FILL` (in addition)                  |
| `$type: color` and group path includes `stroke` / `border` | `STROKE_COLOR` only                                  |
| `$type: dimension`                                         | `WIDTH_HEIGHT, GAP, CORNER_RADIUS`                   |
| `$type: dimension` and group path includes `border` / `stroke` | `STROKE_FLOAT`                                   |
| `$type: dimension` and group path includes `radius`        | `CORNER_RADIUS`                                      |
| `$type: dimension` and group path includes `space`/`gap`/`padding` | `GAP`                                        |
| `$type: number` (no override)                              | `ALL_SCOPES`                                         |
| `$type: fontWeight`                                        | `FONT_WEIGHT`                                        |
| `$type: fontFamily`                                        | `FONT_FAMILY`                                        |

`$extensions.com.figma.scopes` (array of strings) always wins if present.

---

## 6. Aliases

- DTCG alias syntax: `"{group.subgroup.token}"` anywhere a `$value` accepts a string.
- Path resolution is **case-sensitive**, segments split by `.`.
- The exporter prefixes aliases with `Collection.[Mode.]…`. The importer accepts either the prefixed form (matches the exporter) or unprefixed (resolved within the same collection).
- Resolution is **two-pass**: pass 1 creates/updates with literal placeholders for aliases; pass 2 binds aliases to the now-existing target variables.
- Unresolved aliases (`{UNRESOLVED:...}` from a broken export, or a typo'd path) are reported in the result, never silently dropped — the variable is created with its literal placeholder so the user can fix it manually.

## 7. Modes

Single-mode collections: trivial.

Multi-mode detection (in order):
1. If a token has `$extensions.com.figma.modes: { "Light": ..., "Dark": ... }`, use it directly. (Spec-compliant; preferred for new files.)
2. Else, if all sibling groups under a collection have matching descendant structure, propose them as modes in the mapping UI. **Never auto-applied** — the user toggles per collection.
3. Else, single mode named `"Default"` (or the existing default mode of the matched collection).

When a Figma collection already exists with different modes, the mapping UI maps incoming-mode → existing-mode (one-to-one), or creates new modes.

---

## 8. Mapping UI

Modeled on Shopify's CSV import: a single screen with sections, all editable, with a live diff at the bottom that recomputes when any mapping changes.

### Sections

1. **Source preview**
   - File name, token count, detected `$type`s, detected modes, validation summary (errors block, warnings don't).

2. **Collection mapping** — one row per detected top-level group:
   - `colors → Collection: [Colors ▾]` (existing collections, or "+ Create new").
   - Default = case-insensitive name match; falls back to "Create new".

3. **Mode mapping** — one row per detected mode in each multi-mode collection:
   - `light → Mode: [Light ▾]` per target collection.
   - Default = name match; "+ Create new" otherwise.

4. **Type & scope overrides** — collapsed by default, one row per leaf group with non-trivial inferences:
   - Shows: path, inferred `$type`, inferred Figma type, inferred scopes.
   - Editable: type override (limited list), scope checkboxes.
   - The "treat `number` as `dimension`" toggle lives here.

5. **Diff preview** (bottom, tabs):
   - **Create (N)** — new variables that will be added.
   - **Update (N)** — existing variables whose value/scopes/description differ. Each row shows old → new.
   - **Unchanged (N)** — collapsed list, count only.
   - **Will delete (N)** — Figma variables matching the target collection(s) that aren't in the JSON. **All unchecked by default.** User opts-in per row, or "Select all".
   - **Skipped (N)** — composites, unresolvable aliases, malformed entries; each with a reason.

6. **Apply** — disabled until at least one of Create/Update/Delete is non-zero **and** there are no blocking errors. On click: confirmation modal showing summary counts.

### State machine

```
LOAD → PARSE → VALIDATE
  → (errors? show, stop)
  → AUTO_MAP → user-edits-loop ⇄ COMPUTE_DIFF
  → APPLY (irreversible step, shows progress)
  → REPORT
```

---

## 9. Apply pipeline (in `code.js`)

The UI sends a fully-resolved plan; `code.js` executes it deterministically.

```
plan = {
  createCollections: [{ name, modes: [name, ...] }],
  createModes:       [{ collectionName, modeName }],
  upserts: [
    { collectionName, modeName, path, resolvedType, valuesByMode: { modeName: literalOrAliasRef }, scopes, description, hiddenFromPublishing }
  ],
  aliasBindings: [    // resolved in pass 2
    { collectionName, path, modeName, targetPath }
  ],
  deletes: [
    { collectionName, path }   // only items the user ticked
  ]
}
```

Execution order:
1. Create new collections (with their modes).
2. Create new modes on existing collections.
3. Upsert variables with literal values (alias slots filled with a sentinel).
4. Resolve and apply alias bindings.
5. Apply deletes.
6. Post a `report` message back to the UI.

Each step is wrapped in `try`/`catch`; failures are collected, not thrown. The report lists per-item success/failure.

## 10. Deletion safety

- Deletion is **never** a default. Empty selection → no deletes.
- The "would delete" set is scoped to the collections the import touches. Variables in untouched collections are never offered for deletion.
- The confirmation modal restates the delete count separately: *"Will delete N variables. This cannot be undone."*

## 11. Legacy exporter input

Files produced by this plugin's current exporter import as legacy input. They parse fine; expect the usual heuristic gaps (dimensions arrive as unitless `FLOAT`s, scopes are derived not preserved, `hiddenFromPublishing` is lost). This is acceptable because the exporter is a one-time migration tool — see §0. Round-trip fidelity is not a goal.

## 12. Open questions

- Should we cache the previous mapping per file (in `figma.clientStorage`) so re-imports skip the mapping step when nothing's changed? Probably yes, deferred.
- Should we offer a dry-run / "export plan as JSON" for diffing offline? Probably yes, deferred.
- For composite types: do we want a v2 path that emits Figma Text/Effect Styles? Out of scope here, separate doc.
