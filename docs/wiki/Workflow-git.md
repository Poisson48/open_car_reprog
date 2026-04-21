# Workflow git

Le cœur différenciateur d'open-car-reprog vs WinOLS : **chaque projet est un vrai repo git dédié**. Cela donne gratuitement historique, branches, diff, restore et merge — là où WinOLS ne fait que des snapshots linéaires.

---

## Vue d'ensemble du panneau git

![git-graph](images/09-git-graph.png)

Le panneau de droite contient, de haut en bas :
- **Champ de message de commit** + bouton **✨** pour auto-suggestion
- Bouton **`💾 Commit modifications`**
- **Graph des commits** (SVG) avec lanes colorées par branche
- (Quand un commit est sélectionné) **Diff map-level** + bouton **`⟲ Restaurer`**

---

## Branches

![branch-switcher](images/07-branch-switcher.png)

Le dropdown **`⎇ <branche> ▾`** de la toolbar gère les branches git du projet :

- **Switch** → click sur une branche dans la liste. L'éditeur recharge le bon ROM.
- **Créer** → taper un nom dans `nouvelle branche depuis <courante>` + Entrée. La nouvelle branche hérite de l'historique de la courante.
- **Supprimer** → icône 🗑 à droite d'une branche non courante. Le bouton est désactivé sur la branche active (sécurité).

### Auto-commit des changements en cours (WIP)

Si tu switches avec des octets modifiés **déjà patchés sur disque** (via `Ctrl+S`) mais pas encore commités, le serveur auto-commit comme `WIP on <branche>` avant de checkout la nouvelle branche. **Aucun travail perdu.**

Si tu as des octets modifiés **en mémoire uniquement** (pas encore `Ctrl+S`), le client affiche une confirmation `"Modifications non sauvegardées dans l'éditeur — elles seront perdues en changeant de branche"`. C'est ton filet de sécurité.

### Cas d'usage classiques

| Scénario | Actions |
|----------|---------|
| Essayer un Stage 2 sans abandonner Stage 1 | Depuis `stage1`, créer `stage2` → appliquer les modifs Stage 2 → commit. Tu alternes en 1 clic. |
| Faire varier un seul paramètre | Depuis `stage1`, créer `stage1-pressrail-+5` → modifier la pression rail → commit → comparer via diff map-level |
| Revenir à un état antérieur sans casser l'historique | `⟲ Restaurer` sur un commit → ça crée un nouveau commit qui replace le ROM à cet état |
| Repartir de zéro | Créer une nouvelle branche `neutral` depuis un ancien commit propre |

---

## Graph

Les commits sont rendus en SVG, un par ligne :

- **Cercle coloré** : un commit (couleur = lane = branche)
- **Ligne verticale** : continuité d'une branche
- **Diagonale** : divergence (fork) ou merge
- **Badge `HEAD → stage1`** (orange) : commit actuel + branche courante
- **Badge `master`** (bleu) : tip d'une autre branche
- **Badge `tag: v1.0`** (vert) : tag éventuel

L'algorithme de lanes (`computeLanes` dans `public/js/components/git-panel.js`) parcourt les commits newest-first, assigne chacun à la lane qui l'attend, ou ouvre une nouvelle lane si personne ne l'attend, merge les lanes qui convergent.

---

## Diff map-level

![diff-map-level](images/10-diff-map-level.png)

Click sur un commit → le panneau affiche **la liste des paramètres A2L modifiés**, pas des octets bruts :

```
7 cartes modifiées                         ⟲ Restaurer

[MAP] AccPed_trqEngHiGear_MAP           2 cells
  500 → 600 (+100, +20%)
  0x1C1448 · driver's behaviour map as engine torque…

[CURVE] Rail_pSetPointBase_MAP          16 cells
  1200 → 1380 (+180, +15%)
  0x17A4A4 · rail pressure setpoint base

[VALUE] AirCtl_nOvrRun_C                1 cell
  1000 → 4400 (+3400, +340%)
  0x1C4046 · overrun threshold RPM
```

Chaque ligne montre :
- **Tag type** coloré (MAP violet, CURVE bleu, VAL_BLK vert, VALUE jaune)
- **Nom** de la caractéristique
- **Cells changed** (nombre de cellules SWORD qui diffèrent)
- **Échantillon** : 1 cellule avant → après + delta absolu et relatif
- **Adresse** + début de description

### Algo de détection

Côté backend (`src/map-differ.js`) :
1. Calcul des intervalles d'octets qui diffèrent entre `parent_buffer` et `commit_buffer`
2. Pour chaque caractéristique A2L, calcul de sa région `[address, address + size)` en utilisant le RECORD_LAYOUT + `maxAxisPoints`
3. Si la région overlap un intervalle de diff → la carte est dans le résultat
4. Tri par **tightness** (cellsChanged / totalCells) pour mettre en tête les fit exacts (VALUE qu'on a changé précisément) vs les gros MAPs sparsely touchés

Click sur une ligne → l'éditeur de maps s'ouvre en [compare view](#compare-view) et l'hex editor saute à l'adresse.

---

## Compare view

![map-compare](images/11-map-compare.png)

Quand tu cliques une carte depuis le diff d'un commit, l'éditeur s'ouvre en **mode comparaison vs le commit parent** :

- Cellules **entourées de vert** : valeur augmentée
- Cellules **entourées de rouge** : valeur diminuée
- Hover → tooltip `avant: 50.00 → actuel: 70.00 (+20.00)`
- Banner en haut à droite : `📊 Comparaison vs "<commit>"` avec bouton `✕` pour revenir en mode édition

Sous le capot : l'app appelle `/api/projects/:id/rom?commit=<parent_hash>` pour récupérer le buffer parent, puis l'éditeur lit les valeurs aux mêmes adresses dans les 2 buffers et applique les bordures colorées sur les cellules.

---

## Auto-suggest commit message

![auto-commit-msg](images/12-auto-commit-msg.png)

Bouton **✨** à côté du champ message OU focus sur un champ vide → le serveur calcule le diff map-level **entre HEAD et la working tree** (changements non committés) et propose un message :

| Situation | Exemple de message |
|-----------|--------------------|
| 1 carte modifiée avec fit exact | `ACCD_uSRCMin_C +360%` |
| Stage 1 pattern (≥3/5 cartes canoniques) | `Stage 1 (5/5 cartes)` |
| 2-4 cartes diverses | `AirCtl_nOvrRun_C, AirCtl_qOvrRun_C` |
| Beaucoup de changements | `5 cartes : ACCD_DebNplDef_C, ACCD_DebNplOK_C, …` |
| Rien de modifié | Bouton flash `rien à committer` |

Tu peux éditer le message avant d'appuyer `💾 Commit modifications`.

---

## Restauration

Bouton **`⟲ Restaurer`** dans le diff map-level d'un commit → ramène le ROM à cet état via :

```bash
git checkout <hash> -- rom.bin
git add rom.bin
git commit -m "Restored to <hash8>"
```

C'est **non destructif** : la restauration est elle-même un commit, loggé dans l'historique. Tu peux "restaurer la restauration" si tu changes d'avis.

---

## Sous le capot

- **`simple-git`** npm pour les opérations haut niveau
- **`git show <hash>:rom.bin`** via `execFile` pour lire les buffers binaires
- Le repo git vit dans `projects/<uuid>/.git/`
- L'utilisateur git est configuré en local au projet : `user.email=reprog@local`, `user.name=open-car-reprog`

Tu peux **ouvrir `projects/<uuid>`** dans n'importe quel client git externe (gitk, GitKraken, ligne de commande) pour voir le même historique.
