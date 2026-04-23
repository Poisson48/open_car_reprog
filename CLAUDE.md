# open-car-reprog — CLAUDE.md

Outil web open-source de reprogrammation ECU, comparable à WinOLS.
Stack : Node.js + Express (backend) · Vanilla ES6 modules sans build step (frontend).

## Lancer le serveur

```bash
node server.js          # production
node --watch server.js  # dev (rechargement auto)
```

Accessible sur **http://localhost:3000**

## MCP disponible

**Playwright** est configuré (`claude mcp list` → playwright ✓ Connected).
Utilise-le pour tester visuellement l'app sans attendre le retour utilisateur :
ouvre http://localhost:3000, prends des screenshots, clique, scrolle.

## Architecture

```
server.js                   Express REST API + point d'entrée
src/
  ecu-catalog.js            Registre de 13 ECUs (EDC16/EDC17/ME7/MED17)
  vehicle-templates.js      Presets one-click par famille véhicule (Stage 1 Safe / Sport / Dépollution)
  map-finder.js             Heuristique auto-détection de MAPs (header inline + axes monotones + data smooth)
  project-manager.js        Projets sur filesystem (projects/<uuid>/)
  git-manager.js            Git par projet : branches, log avec parents+refs, diff binaire, WIP auto-commit au switch
  a2l-parser.js             Parser ASAP2 récursif → 6638 caractéristiques EDC16C34
  map-differ.js             Calcule quelles caractéristiques A2L diffèrent entre 2 buffers (intervalles + tightness)
  rom-patcher.js            Patch ROM Kf_Xs16_Ys16_Ws16 (SWORD big-endian)
  winols-parser.js          Import ZIP / Intel HEX / binaire brut
public/
  index.html                SPA shell + modals (new project, edit, commit)
  css/app.css               Dark theme VS Code-like
  js/
    app.js                  Router hash (#/ home, #/project/:id)
    api.js                  Fetch wrapper vers l'API REST
    views/
      home.js               Grille projets, recherche, modals new/edit (dont champ displayAddressBase)
      project.js            Vue projet : toolbar, hex editor, map editor, git panel, pile undo/redo (Ctrl-Z / Ctrl-Shift-Z) au niveau du projet
    components/
      hex-editor.js         Canvas + virtual scroll (2MB = 131k lignes × 20px), displayBase pour décaler les adresses affichées
      map-editor.js         Heatmap canvas, sélection cellules, ±% adjustments, mode compare (deltas vert/rouge), vue 3D surface (yaw/pitch à la souris)
      param-panel.js        Sidebar paramètres A2L avec recherche/filtre
      git-panel.js          Historique git avec graph SVG (lanes colorées + ref badges), diff map-level, restore, ✨ suggestion msg
      branch-switcher.js    Dropdown branches dans la toolbar
      auto-mods.js          Modifications automatiques par ECU
      map-finder.js         Modal liste des candidats auto-détectés, tri par score, clic → saut hex editor
ressources/
  edc16c34/damos.a2l        Fichier A2L Bosch EDC16C34 (440k lignes)
  edc16c34/damos.cache.json Cache JSON parsé (3.1 MB, gitignored, généré au 1er accès — SUPPRIMER pour forcer le re-parse)
  edc16c34/ori.BIN          ROM de référence — dump FULL (code PowerPC MPC555 à 0x10000-0x0D0000 + calibration 0x1C0000+). Matche damos.a2l à 100 %. Probablement un BDM dump.
  edc16c34/9663944680.Bin   Stock Bosch PSA pour Peugeot 308 I / Berlingo 1.6 HDi 110 (SW 1037383736, HW 0281012620). Dump calibration-only (reste en FF FF) typique MPPS OBD. Firmware DIFFÉRENT de damos.a2l (zone cal identique à 23 % seulement), les maps existent mais à d'autres adresses (ex: AccPed_trqEngHiGear_MAP à 0x1C162C au lieu de 0x1C1448, axes identiques).
  edc16c34/1.7bar boost…    Tune complet (code + calibration + signatures MAC/RSA regénérées par le flasher)
tests/
  *.test.js                 Tests Playwright end-to-end, lancés via `node tests/<x>.test.js`
  scripts/                  Scripts d'analyse offline (checksum forensics…)
docs/
  screenshots/              Screenshots des features, référencés dans README
```

## API REST

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/version | Version package.json |
| GET | /api/ecu | Liste des 13 ECUs du catalog |
| GET | /api/projects | Liste projets |
| POST | /api/projects | Créer projet |
| GET/PATCH/DELETE | /api/projects/:id | CRUD projet (champs : name, vehicle, immat, year, ecu, description, displayAddressBase, units) |
| POST | /api/projects/:id/rom | Importer ROM |
| GET | /api/projects/:id/rom | Télécharger ROM (query `?commit=<hash>` → version à ce commit) |
| GET | /api/projects/:id/rom/backup | ROM originale |
| PATCH | /api/projects/:id/rom/bytes | Patcher octets (base64) |
| POST | /api/projects/:id/git/commit | Commit git |
| GET | /api/projects/:id/git/log | Historique (inclut parents, refs HEAD/branch/tag) |
| GET | /api/projects/:id/git/diff/:hash | Diff binaire (legacy) |
| GET | /api/projects/:id/git/diff-maps/:hash | **Diff map-level** : quelles caractéristiques A2L changent |
| GET | /api/projects/:id/git/diff-maps-head | Diff HEAD vs working tree (utilisé par ✨ auto-message) |
| POST | /api/projects/:id/compare-file | Upload d'un .bin de référence → liste des cartes qui diffèrent (buffer gardé en RAM) |
| GET | /api/projects/:id/compare-file | Récupère le .bin de compare stocké (pour `mapEditor.showCompare`) |
| DELETE | /api/projects/:id/compare-file | Libère le buffer de compare en RAM |
| GET | /api/projects/:id/notes | Toutes les notes map → `{ [mapName]: text }` |
| PATCH | /api/projects/:id/notes/:mapName | Enregistre/efface la note d'une carte (body `{ text }`, vide = delete) |
| GET | /api/projects/:id/parameters | Liste paramètres A2L pour CE projet (custom si uploadé, sinon catalog ECU) |
| GET | /api/projects/:id/parameters/:name | Détail enrichi d'un paramètre |
| POST | /api/projects/:id/a2l | Upload d'un `.a2l` personnalisé (multipart `a2l`), parse à chaud |
| GET | /api/projects/:id/a2l/info | `{ custom, fileName?, characteristicsCount? }` |
| DELETE | /api/projects/:id/a2l | Supprime le custom A2L → retour au A2L catalog ECU |
| GET | /api/projects/:id/roms | Liste les ROMs de référence stockées (slots) |
| POST | /api/projects/:id/roms | Ajoute un slot (multipart `rom`, opt. `name`) |
| DELETE | /api/projects/:id/roms/:slug | Supprime un slot |
| POST | /api/projects/:id/compare-file-from-slot/:slug | Charge un slot comme ref. compare-file (retourne le diff-maps) |
| POST | /api/projects/:id/git/restore/:hash | Restaurer version |
| GET/POST | /api/projects/:id/git/branches | Lister / créer |
| PUT | /api/projects/:id/git/branches/:name | Switch (auto-commit WIP si dirty) |
| DELETE | /api/projects/:id/git/branches/:name | Supprimer |
| GET | /api/ecu/:ecu/parameters | Paramètres A2L (search, type, offset, limit) |
| GET | /api/ecu/:ecu/parameters/:name | Paramètre détaillé |
| POST | /api/projects/:id/import-winols | Import WinOLS (.ols/.zip/hex/bin) |
| POST | /api/projects/:id/stage1 | Stage 1 auto (body: { pcts: { MapName: % } }) |
| POST | /api/projects/:id/popbang | Pop & bang (body: { rpm, fuelQty }) |
| GET | /api/templates | Liste tous les templates véhicule |
| GET | /api/projects/:id/templates | Templates compatibles avec l'ECU du projet |
| POST | /api/projects/:id/apply-template/:tid | Applique un template (Stage 1 + Pop&Bang + auto-mods) en un call |
| GET | /api/projects/:id/auto-find-maps | Scan heuristique de la ROM → liste des candidats MAPs triés par score (cross-ref A2L inclus) |
| GET | /api/projects/:id/report.html | Rapport HTML standalone (Ctrl-P → PDF) des cartes modifiées vs ROM originale |
| POST | /api/templates/:tid/batch-apply | Applique un template à N projets (body `{ projectIds, commitMessage? }`) — auto-commit par projet |

## Format ROM — Kf_Xs16_Ys16_Ws16 (Bosch DAMOS)

Layout à l'adresse A (tout en SWORD big-endian signé) :
```
A+0              : nx (nb points axe X)
A+2              : ny (nb points axe Y)
A+4              : axe X [nx × SWORD]
A+4+nx*2         : axe Y [ny × SWORD]
A+4+nx*2+ny*2    : données [nx × ny × SWORD]
```

Fonctions utilitaires dans `src/rom-patcher.js` :
- `readMapData(rom, address)` → { nx, ny, xAxis, yAxis, data, dataOff }
- `applyPctToMap(rom, address, pct, opts)` → modifie en place, retourne changed[]
- `readValue / writeValue` → SWORD unique

## ECU catalog — edc16c34 (seul ECU pleinement supporté)

**A2L** : 6638 caractéristiques parsées, types VAL_BLK / CURVE / MAP / VALUE.
Cache auto dans `ressources/edc16c34/damos.cache.json` (généré au 1er démarrage).

**Stage 1** (adresses du damos.a2l, validées sur `ori.BIN` — voir
`tests/ecu-catalog-edc16c34.test.js` pour le garde-fou CI) :
| Map | Adresse | Dims | % défaut |
|-----|---------|------|----------|
| AccPed_trqEngHiGear_MAP | 0x1C1448 | 16×10 | +15% |
| AccPed_trqEngLoGear_MAP | 0x1C168C | 16×10 | +15% |
| FMTC_trq2qBas_MAP | 0x1C9AAA | 16×16 | +12% |
| Rail_pSetPointBase_MAP | 0x1E726C | 16×16 | +10% |
| EngPrt_trqAPSLim_MAP | 0x1C8838 | 8×12 | +25% |

**Historique** : les 5 adresses précédentes (0x16D6C4 etc.) étaient fausses —
elles pointaient sur du padding `FF FF FF FF` dans toutes les ROMs. Stage 1
retournait silencieusement 200 OK avec 0 octet changé. Fixé, endpoint
`/stage1` retourne maintenant HTTP 400 si 0 carte ne matche. Adresses A2L
confirmées via forums (ecuedit t365, ecuconnections t12953, mhhauto).

**Résolution dynamique** : `/stage1` préfère l'adresse A2L du projet (custom
uploadé ou catalog ECU) sur l'adresse du catalog JS. Permet de faire marcher
Stage 1 sur un firmware différent en uploadant le damos approprié. Le champ
`addressSource: 'a2l' | 'catalog'` dans la réponse indique la source.

**Pop & Bang** :
| Paramètre | Adresse | Valeur stock | Rôle |
|-----------|---------|--------------|------|
| AirCtl_nOvrRun_C | 0x1C4046 | 1000 tr/min | Seuil RPM départ overrun |
| AirCtl_qOvrRun_C | 0x1C40B4 | 50 (raw) | Quantité carburant overrun |

**Auto-mods** :
- DPF OFF (pattern) : signature 17 octets en O(n). Non trouvée dans ori.BIN
  ni 9663944680.Bin — cette signature est firmware-spécifique.
- EGR OFF (adresse) : `AirCtl_nMin_C @ 0x1C41B8` patché à `0x1F40` (8000 rpm)
  → seuil RPM coupure EGR au-dessus de la zone d'utilisation normale.
  Méthode forum ecuedit/mhhauto, confirmée par A2L damos. L'ancienne
  adresse 0x1C4C4E n'avait jamais été validée.
- DPF DTC : `@ 0x1E9DD4` à `FF FF` — adresse non confirmée (donne FF FF sur
  ori.BIN déjà, 00 00 sur Berlingo). À revalider vs DFC_DFCCDfp_PFlt*.

Pour ajouter un ECU : remplir son entrée dans `src/ecu-catalog.js`
(stage1Maps + popbangParams + autoModPatterns avec les adresses confirmées).

## Map-Finder — `src/map-finder.js`

Détection heuristique de MAPs dans une ROM sans A2L (ou pour compléter un A2L partiel).
À chaque offset pair, interprète `(nx, ny)` comme UWORD BE. Si dans `[minN, maxN]`
(défaut 4..32), lit les axes aux offsets Bosch (N_X → N_Y → axe X → axe Y → data).

**Filtres** (tous obligatoires pour passer) :
- nx, ny dans les bornes
- axes strictement monotones (croissants OU décroissants)
- span d'axe ≥ 10 (évite axes constants)
- range data ≥ 5 (exclut zones de 0xFF / 0x00 / padding)

**Score** (0..1) = 0.55 × smoothness + 0.25 × variance + 0.20 × taille préférée
- smoothness : 1 − (moyenne |diff adjacents| / range total)
- variance : min(1, range / 1000)
- taille : pic à nx+ny = 32 (16×16), décroit linéairement ±40

**Dédup** : les candidats qui se chevauchent (± 16 octets) sont fusionnés, on garde le plus haut score.

**Perf** : ~30 ms pour scanner 2 MB sur un Bosch réel. Le scan est côté serveur
(Node) — l'upload round-trip au navigateur pour scanner côté client serait plus lent.

**Limites** : ne détecte que les layouts type `Kf_Xs16_Ys16_Ws16` (header nx/ny
inline). Les MAPs EDC16C34 Stage 1 utilisent un autre layout (dims fixes en
RECORD_LAYOUT, pas de header inline) — elles ne sortent pas dans les résultats.
C'est cohérent avec l'objectif : le finder est utile pour les ROMs sans A2L
ou les ECUs où l'A2L est partiel.

**Cross-ref A2L** : la route serveur ajoute `knownName` sur chaque candidat dont
l'adresse correspond à une caractéristique de l'A2L projet. Permet de cibler
les candidats "hors A2L" d'un coup d'œil.

## Templates véhicule — `src/vehicle-templates.js`

Presets « one-click » par famille de voiture qui bundlent :
- un Stage 1 (pourcentages par carte, réutilise les adresses de `ecu-catalog.stage1Maps`),
- optionnellement un Pop & Bang (RPM + qté, réutilise `popbangParams`),
- optionnellement une liste d'ids `autoMods` qui résolvent contre `autoModPatterns` / `autoModAddresses`.

Livrés pour edc16c34 (PSA 1.6 HDi 110) : `psa_16hdi_110_stage1_safe`,
`psa_16hdi_110_stage1_sport` (Stage 1 + popbang), `psa_16hdi_110_depollution_off`
(DPF + DTC DPF + EGR). Exposés dans le modal Auto-mods en haut, section « 🚗 Templates véhicule ».

Pour en ajouter : nouvelle entrée dans `VEHICLE_TEMPLATES` avec `appliesTo`,
`stage1.pcts`, `popbang`, `autoMods`. Le serveur applique atomiquement (load ROM → patch Stage 1 → patch popbang → patch auto-mods → write).

## Hex editor — virtual scroll

Le canvas redessine uniquement les ~30 lignes visibles.
Bug scroll corrigé : `evLayer` (div top layer) forwardait pas les events `wheel` au `scroller` → ajout listener `wheel` → `scroller.scrollTop += e.deltaY`.

**`displayBase`** : champ optionnel sur `HexEditor` pour afficher les adresses avec un décalage
(ex : ROM mappée à `0x80000000` en mémoire physique). Le décalage est purement visuel — les offsets
fichier restent inchangés. La valeur est persistée en meta projet (`displayAddressBase`).

## Layouts DAMOS supportés

Le map editor gère n'importe quel `RECORD_LAYOUT` A2L tant que l'ordre des
positions suit la convention Bosch (nx → ny → axes → data). Concrètement,
la lecture d'`inline NO_AXIS_PTS_X/Y` utilise le `dataType` du record layout
(UWORD, SWORD, UBYTE…) et la taille d'en-tête se déduit du datatype. Le
datatype des valeurs de cellules et des axes vient de même du record layout.

Layouts testés : `Kf_Xs16_Ys16_Ws16` (EDC16C34), `Kf_Xu16_Yu16_Wu16` (MED17
typique), `Kl_Xs16_Ws16` (curves Bosch avec inline N), et par héritage tout
layout qui respecte la convention d'ordre ci-dessus.

## Parser A2L — attention AXIS_DESCR

L'ordre ASAP2 des champs positionnels de `AXIS_DESCR` est :
`Attribute InputQuantity Conversion MaxAxisPoints LowerLimit UpperLimit` (6 champs).
**Ne pas** ajouter `RecordLayout`/`MaxDiff` (ancienne erreur → `maxAxisPoints=32767` faux sur toutes les maps).
Le dataType d'axe est résolu via le RECORD_LAYOUT du parent (STD_AXIS) ou de l'AXIS_PTS référencé (COM_AXIS).

## Tests

Playwright est installé (devDep). Chaque feature a un test `tests/<feature>.test.js` qui :
- crée un projet via API, importe un ROM synthétique
- manipule l'UI via playwright headless (chromium)
- screenshote dans `tests/screenshots/` (gitignoré) + copie les utiles dans `docs/screenshots/` (commités)

Lancer : `node tests/<name>.test.js` (serveur sur 3001).

## Checksums — hors scope

L'utilisateur flashe via **MPPS** qui recalcule les checksums (simples + signatures crypto) au
moment du flash. Idem KESS / Galletto / CMD / bitbox. L'éditeur produit un `.bin` modifié, le
tool de flashing sanitise au flash. **Ne pas implémenter de checksum verify/fix dans l'app.**
Script `tests/scripts/analyze-checksums.js` gardé en référence forensic.

## Session Avril 2026 — passe finale v1

Corrections et features ajoutées au cours d'une seule session, dans l'ordre :

1. **Fix ±% muets sur petites valeurs** (`_applyPct`) — le raw reçoit maintenant un
   bump de ±1 quand l'arrondi retomberait sur lui-même, sauf sur les cellules à 0.
2. **Auto-flush avant Commit** (`flushPendingEdits` dans project.js, passé en
   `onBeforeCommit` à GitPanel) — plus besoin de Ctrl-S avant 💾.
3. **✨ suggest-msg** flush d'abord puis `avgChange()` signé côté map-differ pour
   ne pas inverser le signe du % sur les cellules négatives.
4. **Goto hex validation** — regex stricte + borne ROM + classe `input-error`.
5. **Empty state search home** (déjà présent, couvert par `tests/home-empty-state.test.js`).
6. **Filtre / toggle hors A2L dans Auto-find** (110+ candidats sur Bosch plein).
7. **Delete branche via 🗑** (déjà présent dans branch-switcher, couvert par tests).
8. **Feedback 0-cellules** dans `#map-sel-count` flashé 2.5 s.
9. **Toggle unités** `Nm ↔ lb·ft / °C ↔ °F` — preference meta projet, conversion
   display-only (src/units.js), write-back converti en phys A2L.
10. **Rapport HTML** `/api/projects/:id/report.html` imprimable en PDF depuis le
    navigateur, aucun puppeteer.
11. **Batch apply** d'un template à N projets — modal home + endpoint
    `POST /api/templates/:tid/batch-apply`.
12. **Mode 3D delta réel** (heights = delta, couleurs divergentes) + bouton
    **« Δ vs parent »** un clic depuis la toolbar du map editor.
13. **Mode 3D overlay** — surface courante remplie + ref en wireframe blanc dans
    la même box 3D.

36 tests Playwright passent. Walkthrough complet `tests/walkthrough.test.js` à 0 findings.

## Points à améliorer / bugs connus

- Les ECUs autres qu'edc16c34 n'ont pas d'adresses Stage 1 / pop&bang (à compléter après v1)
- Pas encore de déploiement serveur (hébergement mutualisé OVH incompatible Node.js,
  VPS prévu ultérieurement sur fish-technics.fr)

## Repo git

```
git remote: git@github.com:Poisson48/open_car_reprog.git
branche principale: main
```
