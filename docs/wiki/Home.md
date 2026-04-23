# open-car-reprog

**Outil web open-source de reprogrammation ECU** — alternative libre à WinOLS, qui tourne dans ton navigateur sans build step, avec git par projet pour toute la gestion de versions / variantes de tune / comparaisons.

![workspace](images/03-workspace.png)

---

## Démarrage rapide

1. **[Installation](Installation)** — cloner, `npm install`, `node server.js`
2. **[Tutoriel complet](Tutoriel)** — de la création d'un projet au flash final (pas-à-pas avec captures)
3. **[Tuto Stage 1 (avec/sans damos)](Tuto-Stage1)** — cas réel sur Berlingo 1.6 HDi 110 : deux workflows en parallèle, ce qu'il faut savoir avant de flasher

## Documentation

### Prise en main
- **[Gestion des projets](Gestion-des-projets)** — créer, éditer, rechercher, immat, année, description
- **[Tutoriel complet](Tutoriel)** — workflow type : import ROM → Stage 1 → commit → variante → flash

### Éditeurs
- **[Éditeur hex](Editeur-Hex)** — canvas 2 Mo avec virtual scroll, navigation, édition nibble, base d'adresses configurable, champ « Aller à » avec validation hex stricte
- **[Éditeur de cartographies](Editeur-de-maps)** — heatmap 2D, vue 3D (valeur / **delta** / split / **overlay wireframe**), slice viewer, sélection, ±% (bump raw garanti), lisser/égaliser/rampe, copy/paste, notes, compare view, **toggle unités Nm↔lb·ft / °C↔°F**
- **[Paramètres A2L](Parametres-A2L)** — 6638 caractéristiques EDC16C34 parsées, recherche, filtres, A2L perso par projet

### Modifications
- **[Auto-mods](Auto-mods)** — Stage 1, Pop & Bang, DPF/FAP OFF, EGR OFF + **6 recettes auto-tune one-click** (Speed Limiter OFF, Rev Limit raise, Torque Limiter +30%, Rail Pressure +15%, Smoke Limiter -5%, Full Dépollution)
- **[Templates véhicule](Templates-vehicule)** — presets one-click par famille de voiture (Stage 1 Safe / Sport / Dépollution), **+ batch apply à N projets d'une flotte**
- **[Map-Finder](Map-Finder)** — détection heuristique auto de MAPs (ROMs sans A2L), **filtre par nom / adresse / dimensions + toggle « hors A2L »**
- **[open_damos](Open-DAMOS)** 🧬 — damos libre (CC0) qui relocalise les maps par empreinte d'axes. Stage 1 marche sur n'importe quel firmware EDC16C34 PSA sans acheter de damos Bosch. Badge damos-match 🟢/🟠/🔴 dans la toolbar prévient si ton damos ne matche pas. Export A2L standard pour WinOLS.

### Git workflow
- **[Workflow git](Workflow-git)** — branches (création / switch / **suppression** 🗑), graph, diff map-level, auto-commit messages (via ✨ **auto-flush** des modifs en mémoire), compare view, compare vs fichier, **compare 2 commits/branches arbitraires**, **split view 2D/3D**, **liste cliquable des modifs** (flash doré sur la cellule), bouton **« Δ vs parent »** un clic pour comparer avec le commit parent de HEAD, restore, undo/redo

### Livrables
- **📄 Rapport tune** — endpoint `/report.html` : rapport autonome des cartes modifiées vs ROM originale, imprimable en PDF depuis le navigateur (Ctrl-P)

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
| Compare view vs fichier .bin externe | ✅ | ✅ |
| **Damos libre** (open_damos — auto-relocate par empreinte d'axes) | ❌ (damos payant par firmware) | ✅ (CC0) |
| Correction checksums | ✅ (modules payants) | ❌ (fait par MPPS/KESS/Galletto au flash) |
| Vue 3D map (yaw/pitch souris) | ✅ | ✅ |
| Slice viewer (ligne/colonne → graph) | ✅ | ✅ |
| Copy/paste sélections, lisser/égaliser/rampe | ✅ | ✅ |
| Map finder (auto-détection sans A2L) | ✅ | ✅ |
| Templates véhicule one-click | ⚠ | ✅ |
| Multi-ROM slots (stock/tune/ref) par projet | ⚠ | ✅ |
| Undo/redo ROM-level (Ctrl-Z / Ctrl-Shift-Z) | ✅ | ✅ |
| **3D — mode delta vs ref + overlay wireframe** | ⚠ limité | ✅ |
| **Toggle unités Nm↔lb·ft / °C↔°F** | ⚠ | ✅ |
| **Rapport PDF tune** client (cartes modifiées + deltas) | ✅ (module payant) | ✅ (HTML → Ctrl-P) |
| **Batch apply** template à N ROMs d'une flotte | ⚠ | ✅ |
| Prix | ~400-2000 € | **gratuit, open-source** |

Le workflow est orienté **"git-first"** : chaque projet est un repo git dédié, ce qui donne gratuitement branches, historique, diff, restore, merge — tout ce que les snapshots WinOLS font plus mal.

---

## Licence

MIT — contributions bienvenues.
