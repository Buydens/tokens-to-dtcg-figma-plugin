# Tokens → DTCG (Figma plugin)

Converteer Figma Variables en Tokens Studio JSON naar strict DTCG
(W3C Design Tokens Community Group) formaat, met ingebouwde validatie én
optionele Git-sync (GitLab of GitHub).

## Installeren (lokale ontwikkeling)

1. Pak deze map uit op je computer.
2. Open Figma (desktop app — plugins werken niet in de browser versie).
3. Menu: **Plugins → Development → Import plugin from manifest…**
4. Selecteer het `manifest.json` bestand uit deze map.
5. De plugin verschijnt nu onder **Plugins → Development → Tokens → DTCG**.

## Gebruik

### Tokens ophalen
- **Read Figma variables** — leest alle lokale Figma Variables in dit bestand
  (collections, modes, aliases) en converteert ze naar DTCG.
- **Import** — paste of drop een Tokens Studio / Figma Variables / DTCG
  JSON bestand.
- **Pull** — haal het geconfigureerde DTCG bestand op uit GitLab of GitHub.

### Tokens wegschrijven
- **Copy / Download** — copy to clipboard of download als `.dtcg.json`.
- **Push** — commit en push het bestand naar de repo met een commit message
  (alleen zichtbaar als Git is geconfigureerd én er is output).

## Git setup

Klik op het tandwiel-icoon rechtsboven. Kies **GitLab** of **GitHub**
in de provider-toggle.

### GitLab

**Token aanmaken:**
- User Settings → Access Tokens, of
- Project → Settings → Access Tokens voor een team-gedeelde config

**Vereiste scopes:** `read_repository` + `write_repository`

| Veld | Voorbeeld |
|---|---|
| GitLab URL | `https://gitlab.com` (of self-hosted) |
| Project | `my-team/design-tokens` (of numeric ID) |
| Branch | `main` |
| File path | `tokens.dtcg.json` |
| Token | `glpat-xxxxxxxxx…` |

### GitHub

**Token aanmaken:**
- Settings → Developer settings → Personal access tokens → **Fine-grained tokens** (aanbevolen)
- Repository access: selecteer alleen de relevante repo(s)
- Permissions → **Contents: Read and write**

Of voor een classic token: scope `repo`.

| Veld | Voorbeeld |
|---|---|
| GitHub API URL | `https://api.github.com` (of `https://github.company.com/api/v3` voor Enterprise) |
| Repository | `my-org/design-tokens` |
| Branch | `main` |
| File path | `tokens.dtcg.json` |
| Token | `github_pat_xxxxxxxxx…` of `ghp_xxxxxxxxx…` |

Klik **Test connection** om te verifiëren dat de repo bereikbaar is, of het
bestand al bestaat, en of de scopes kloppen.

### Waar de credentials staan
Via Figma's `clientStorage`:
- Lokaal op jouw machine, per gebruiker
- Niet gesynchroniseerd naar teamleden
- Niet opgeslagen in het Figma-bestand
- De plugin verstuurt het token alleen naar de URL die jij in settings
  hebt ingevuld

## Validatie

De **Validation** tab toont drie niveaus issues:

**Errors** (breken DTCG spec):
- Ontbrekende `$value` of `$type`
- `$type` buiten de DTCG vocabulaire
- Broken references (`{foo.bar}` → niks)
- Math-expressies in values
- Dimensions zonder eenheid

**Warnings** (waarschijnlijk fout):
- Spaties of reserved chars in token-namen
- Inconsistente naamgevingsstijl tussen tokens
- Mixed units binnen één groep
- Placeholder-namen (`temp`, `xxx`, `todo`)
- Alias tokens met scale-namen zonder betekenis

**Suggestions**:
- Duplicate values die aliases zouden moeten zijn
- Te diepe nesting (> 4 levels)
- Ontbrekende `$description` bij primitives
- Inconsistent hex-formaat

## Conversie overzicht

| Input (Tokens Studio) | Output (DTCG) |
|---|---|
| `value`, `type` | `$value`, `$type` |
| `sizing`, `spacing`, `borderRadius`, `fontSizes`, … | `dimension` |
| `fontFamilies` | `fontFamily` |
| `fontWeights` (string `"700"`) | `fontWeight` (number `700`) |
| `boxShadow` met `x`, `y` | `shadow` met `offsetX`, `offsetY` |
| Bare number `"16"` op dimensies | `"16px"` |
| `{r, g, b, a}` kleurobjecten | hex (bv `#rrggbbaa`) |
| `{color.brand.primary}` references | blijven identiek |
| `$themes`, `$metadata` (Tokens Studio meta) | weggelaten |
| Figma aliases (`VARIABLE_ALIAS`) | `{Collection.Path.To.Token}` |
| Onbekende velden op tokens | bewaard onder `$extensions` |

## Privacy

De plugin doet geen enkele HTTP-request tenzij je Git configureert. Ook
dan gaat er alleen verkeer naar de URL die jij zelf invult. Geen
analytics, geen externe dependencies, geen telemetrie.
