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
ressources/
  edc16c34/damos.a2l        Fichier A2L Bosch EDC16C34 (440k lignes)
  edc16c34/damos.cache.json Cache JSON parsé (3.1 MB, gitignored, généré au 1er accès — SUPPRIMER pour forcer le re-parse)
  edc16c34/ori.BIN          ROM de référence (partielle, calibration seule — pas de section code)
  edc16c34/9663944680.Bin   Stock Bosch PSA (calibration + signatures crypto, pas de code)
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
| GET/PATCH/DELETE | /api/projects/:id | CRUD projet (champs : name, vehicle, immat, year, ecu, description, displayAddressBase) |
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
| POST | /api/projects/:id/git/restore/:hash | Restaurer version |
| GET/POST | /api/projects/:id/git/branches | Lister / créer |
| PUT | /api/projects/:id/git/branches/:name | Switch (auto-commit WIP si dirty) |
| DELETE | /api/projects/:id/git/branches/:name | Supprimer |
| GET | /api/ecu/:ecu/parameters | Paramètres A2L (search, type, offset, limit) |
| GET | /api/ecu/:ecu/parameters/:name | Paramètre détaillé |
| POST | /api/projects/:id/import-winols | Import WinOLS (.ols/.zip/hex/bin) |
| POST | /api/projects/:id/stage1 | Stage 1 auto (body: { pcts: { MapName: % } }) |
| POST | /api/projects/:id/popbang | Pop & bang (body: { rpm, fuelQty }) |

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

**Stage 1** (adresses confirmées ROM + A2L) :
| Map | Adresse | % défaut |
|-----|---------|----------|
| AccPed_trqEngHiGear_MAP | 0x16D6C4 | +15% |
| AccPed_trqEngLoGear_MAP | 0x16DA04 | +15% |
| FMTC_trq2qBas_MAP | 0x1760A4 | +12% |
| Rail_pSetPointBase_MAP | 0x17A4A4 | +10% |
| EngPrt_trqAPSLim_MAP | 0x1758E4 | +25% |

**Pop & Bang** :
| Paramètre | Adresse | Valeur stock | Rôle |
|-----------|---------|--------------|------|
| AirCtl_nOvrRun_C | 0x1C4046 | 1000 tr/min | Seuil RPM départ overrun |
| AirCtl_qOvrRun_C | 0x1C40B4 | 0 (raw) | Quantité carburant overrun |

**Auto-mods pattern** (DPF OFF) : recherche signature 17 octets en O(n).
**Auto-mods adresse** : DPF DTC @ 0x1E9DD4, EGR OFF @ 0x1C4C4E.

Pour ajouter un ECU : remplir son entrée dans `src/ecu-catalog.js`
(stage1Maps + popbangParams + autoModPatterns avec les adresses confirmées).

## Hex editor — virtual scroll

Le canvas redessine uniquement les ~30 lignes visibles.
Bug scroll corrigé : `evLayer` (div top layer) forwardait pas les events `wheel` au `scroller` → ajout listener `wheel` → `scroller.scrollTop += e.deltaY`.

**`displayBase`** : champ optionnel sur `HexEditor` pour afficher les adresses avec un décalage
(ex : ROM mappée à `0x80000000` en mémoire physique). Le décalage est purement visuel — les offsets
fichier restent inchangés. La valeur est persistée en meta projet (`displayAddressBase`).

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

## Points à améliorer / bugs connus

- Les ECUs autres qu'edc16c34 n'ont pas d'adresses Stage 1 / pop&bang (à compléter)
- Pas encore de déploiement serveur (hébergement mutualisé OVH incompatible Node.js,
  VPS prévu ultérieurement sur fish-technics.fr)

## Repo git

```
git remote: git@github.com:Poisson48/open_car_reprog.git
branche principale: main
```
