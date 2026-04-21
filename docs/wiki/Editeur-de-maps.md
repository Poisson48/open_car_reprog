# Éditeur de cartographies

![map-editor](images/05-map-editor.png)

Quand tu cliques un paramètre A2L dans la sidebar gauche, l'éditeur de maps s'ouvre en bas. Il supporte 4 types A2L :

- **VALUE** — une seule valeur scalaire
- **CURVE** — tableau 1D (axe X + valeurs)
- **VAL_BLK** — bloc de valeurs sans axe
- **MAP** — tableau 2D (axe X + axe Y + grille)

## Toolbar

- **Nom + description** de la carte
- Métadonnées : `MAP · SWORD · Nm · 0x1C1448` (type · dataType · unité · adresse)
- **✕** ferme l'éditeur

## Table éditable

Les cellules affichent les **valeurs physiques** (converties via les coefficients A2L — factor, offset, unité). Exemple : une valeur brute `500` SWORD peut afficher `50.00 Nm` avec un factor 0.1.

**Édition** :
- Double-click → entrée de valeur physique
- Validation (Enter / blur) → conversion automatique en raw via les coefficients

## Sélection multi-cellules

- **Click-drag** → sélection rectangulaire
- **Shift+click** → étend la sélection
- **Ctrl+click** → ajoute/retire une cellule

Une barre d'édition apparaît quand au moins une cellule est sélectionnée :

- Boutons rapides : `+1%` / `-1%` / `+5%` / `-5%` / `+10%` / `-10%`
- Input `Valeur…` + bouton `Appliquer` → valeur absolue
- `Tout sélectionner` / `Désélectionner`

Les changements mettent à jour les octets en mémoire et sont répercutés dans l'hex editor (les octets deviennent orange). Appuyer `Ctrl+S` pour persister sur disque.

## Heatmap

À droite de la table, un canvas Chart.js montre la cartographie en 2D heatmap :
- Axes X et Y avec unités
- Couleur interpolée (bleu → vert → jaune → rouge)
- Click cellule → sélectionne aussi dans la table

## Layouts supportés

L'éditeur respecte le `RECORD_LAYOUT` A2L de chaque caractéristique :

- **Kf_Xs16_Ys16_Ws16** — layout classique EDC16C34 avec `NO_AXIS_PTS_X/Y` inline (header 4 bytes : nx, ny)
- **Kl_Xs16_Ws16** — CURVE 1D avec `NO_AXIS_PTS_X` inline (header 2 bytes)
- **Kwb_Wr32** — VAL_BLK 32-bit, dimensions fixes via `AXIS_DESCR.maxAxisPoints`
- **COM_AXIS** — axes partagés stockés séparément via `AXIS_PTS_REF`

Si un ROM ne contient pas la map à l'adresse A2L attendue (firmware différent, base offset), l'éditeur affiche un badge **`⚠ Layout`** dans la toolbar. Il tombe back sur les dimensions déclarées dans A2L (`maxAxisPoints`) pour pouvoir quand même rendre quelque chose.

## Compare view

Quand tu ouvres une carte depuis la liste du diff git, l'éditeur entre en **mode comparaison** vs le commit parent :

![map-compare](images/11-map-compare.png)

- Cellules **entourées de vert** = valeur augmentée depuis le commit parent
- Cellules **entourées de rouge** = valeur diminuée
- Hover → tooltip `avant: 50.00 → actuel: 70.00 (+20.00)`
- Banner en haut à droite : `📊 Comparaison vs "<commit>"` avec bouton `✕` pour quitter

Voir [Workflow git — Compare view](Workflow-git#compare-view).

## Raccourcis

| Action | Méthode |
|--------|---------|
| Entrer une valeur | Double-click cellule, taper, Enter |
| Sélection rectangle | Click-drag |
| Ajuster sélection | `+5%`, `-5%`, etc. dans la barre |
| Fermer | **✕** (toolbar) |
| Quitter compare mode | **✕** du banner |
