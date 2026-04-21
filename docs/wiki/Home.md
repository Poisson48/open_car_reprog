# open-car-reprog

**Outil web open-source de reprogrammation ECU** — alternative libre à WinOLS, qui tourne dans ton navigateur sans build step, avec git par projet pour toute la gestion de versions / variantes de tune / comparaisons.

![workspace](images/03-workspace.png)

---

## Démarrage rapide

1. **[Installation](Installation)** — cloner, `npm install`, `node server.js`
2. **[Tutoriel complet](Tutoriel)** — de la création d'un projet au flash final (pas-à-pas avec captures)

## Documentation

### Prise en main
- **[Gestion des projets](Gestion-des-projets)** — créer, éditer, rechercher, immat, année, description
- **[Tutoriel complet](Tutoriel)** — workflow type : import ROM → Stage 1 → commit → variante → flash

### Éditeurs
- **[Éditeur hex](Editeur-Hex)** — canvas 2 Mo avec virtual scroll, navigation, édition nibble, base d'adresses configurable
- **[Éditeur de cartographies](Editeur-de-maps)** — heatmap 2D, sélection, ±%, compare view
- **[Paramètres A2L](Parametres-A2L)** — 6638 caractéristiques EDC16C34 parsées, recherche, filtres

### Modifications
- **[Auto-mods](Auto-mods)** — Stage 1, Pop & Bang, DPF/FAP OFF, EGR OFF, Speed limiter

### Git workflow
- **[Workflow git](Workflow-git)** — branches, graph, diff map-level, auto-commit messages, compare view, restore

### Référence
- **[ECUs supportés](ECUs-supportes)** — catalog, comment ajouter un nouvel ECU
- **[API REST](API-REST)** — tous les endpoints
- **[FAQ](FAQ)** — troubleshooting (port, checksum, layout warning, MPPS…)

---

## Différences avec WinOLS

| Feature | WinOLS | open-car-reprog |
|---------|--------|-----------------|
| Navigateur de paramètres A2L | ✅ | ✅ |
| Édition maps 2D avec heatmap | ✅ | ✅ |
| Variantes de tune (branches) | ⚠ snapshots | ✅ **branches git natives** |
| Diff entre versions | ✅ | ✅ **map-level avec deltas par cellule** |
| Commit messages auto | ❌ | ✅ |
| Graph d'historique | ❌ | ✅ |
| Compare view per-cellule | ⚠ limité | ✅ |
| Correction checksums | ✅ (modules payants) | ❌ (fait par MPPS/KESS/Galletto au flash) |
| Vue 3D map | ✅ | ❌ (à venir) |
| Map finder (auto-détection) | ✅ | ❌ (à venir) |
| Prix | ~400-2000 € | **gratuit, open-source** |

Le workflow est orienté **"git-first"** : chaque projet est un repo git dédié, ce qui donne gratuitement branches, historique, diff, restore, merge — tout ce que les snapshots WinOLS font plus mal.

---

## Licence

MIT — contributions bienvenues.
