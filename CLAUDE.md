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
  git-manager.js            Git par projet (simple-git + execFile pour diff binaire)
  a2l-parser.js             Parser ASAP2 récursif → 6638 caractéristiques EDC16C34
  rom-patcher.js            Patch ROM Kf_Xs16_Ys16_Ws16 (SWORD big-endian)
  winols-parser.js          Import ZIP / Intel HEX / binaire brut
public/
  index.html                SPA shell + modals (new project, edit, commit)
  css/app.css               Dark theme VS Code-like
  js/
    app.js                  Router hash (#/ home, #/project/:id)
    api.js                  Fetch wrapper vers l'API REST
    views/
      home.js               Grille projets, recherche, modals new/edit
      project.js            Vue projet : toolbar, hex editor, map editor, git panel
    components/
      hex-editor.js         Canvas + virtual scroll (2MB = 131k lignes × 20px)
      map-editor.js         Heatmap canvas, sélection cellules, ±% adjustments
      param-panel.js        Sidebar paramètres A2L avec recherche/filtre
      git-panel.js          Historique git, diff binaire, restore
      auto-mods.js          Modifications automatiques par ECU
ressources/
  edc16c34/damos.a2l        Fichier A2L Bosch EDC16C34 (440k lignes)
  edc16c34/damos.cache.json Cache JSON parsé (3.1 MB, gitignored, généré au 1er accès)
```

## API REST

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | /api/version | Version package.json |
| GET | /api/ecu | Liste des 13 ECUs du catalog |
| GET | /api/projects | Liste projets |
| POST | /api/projects | Créer projet |
| GET/PATCH/DELETE | /api/projects/:id | CRUD projet (champs : name, vehicle, immat, year, ecu, description) |
| POST | /api/projects/:id/rom | Importer ROM |
| GET | /api/projects/:id/rom | Télécharger ROM |
| GET | /api/projects/:id/rom/backup | ROM originale |
| PATCH | /api/projects/:id/rom/bytes | Patcher octets (base64) |
| POST | /api/projects/:id/git/commit | Commit git |
| GET | /api/projects/:id/git/log | Historique |
| GET | /api/projects/:id/git/diff/:hash | Diff binaire |
| POST | /api/projects/:id/git/restore/:hash | Restaurer version |
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

## Points à améliorer / bugs connus

- Les ECUs autres qu'edc16c34 n'ont pas d'adresses Stage 1 / pop&bang (à compléter)
- Le highlight dans le hex editor lors de la sélection d'un paramètre MAP calcule
  une taille approximative (à affiner avec les vraies dimensions lues en ROM)
- Pas encore de déploiement serveur (hébergement mutualisé OVH incompatible Node.js,
  VPS prévu ultérieurement sur fish-technics.fr)

## Repo git

```
git remote: git@github.com:Poisson48/open_car_reprog.git
branche principale: main
```
