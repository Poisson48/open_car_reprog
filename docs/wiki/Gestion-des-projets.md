# Gestion des projets

![home](images/01-home.png)

## Page d'accueil

La grille affiche tous les projets, les plus récents en premier. Chaque carte montre :

- **Nom du projet** + **badge immatriculation**
- **Badges capacités** : l'ECU + `A2L` (paramètres disponibles) + `S1` (Stage 1 supporté)
- **Véhicule · année**
- **Description**
- **Date de création**
- **Statut ROM** : `✓ ROM: rom.bin (2048 KB)` si importée, sinon `⚠ Pas de ROM importée`
- Actions : **Ouvrir**, **Modifier**, **Supprimer**

## Recherche

La barre `Rechercher un projet, un véhicule, une immat…` filtre en temps réel sur :
- Nom du projet
- Nom du véhicule
- Immatriculation (insensible à la casse et aux tirets)
- Description
- Année

## Créer un projet

Bouton **`+ Nouveau projet`** :

![new-project-modal](images/02-new-project-modal.png)

Champs :
- **Nom** (obligatoire)
- **Véhicule** — marque / modèle (ex: Peugeot 206 1.6 HDi 110cv)
- **Immatriculation** — auto-formatée en MAJUSCULES
- **Année**
- **Calculateur** (obligatoire) — liste déroulante des 13 ECUs du catalog
- **Description**

## Modifier un projet

Bouton **`Modifier`** sur une carte, ou **`✎ Modifier`** dans la toolbar du workspace :

![edit-project](images/08-edit-project.png)

Mêmes champs que la création, plus :
- **Base adresses affichage (hex)** — voir [Éditeur Hex](Editeur-Hex#base-dadresses-configurable)

> 💡 Changer l'ECU d'un projet existant peut invalider les adresses A2L si tu passes sur un calculateur différent.

## Supprimer

Le bouton **`Supprimer`** efface **le dossier entier du projet** (ROM, backup, historique git). **Opération irréversible.**

---

## ROMs de référence — multi-slots

En plus du `rom.bin` qui est le ROM **courant** édité, chaque projet peut stocker plusieurs **slots** de ROMs de référence (stock, tune forum, backup…) — pratique pour comparer rapidement sans devoir re-uploader un fichier à chaque session.

Accès : toolbar → **`📚 ROMs de réf.`**. La modal liste les slots existants et propose :

- **Ajouter un slot** (upload `.bin`, nommage libre)
- **Supprimer** un slot
- **Comparer** → utilise le slot comme référence compare-file (voir [Workflow git — Compare vs fichier externe](Workflow-git#compare-vs-fichier-externe-bin))

Stockage : `projects/<uuid>/roms/<slug>.bin` + `projects/<uuid>/roms.json` pour les métadonnées.

## A2L personnalisé par projet

Si ton ECU n'est pas encore dans le catalog, ou que tu as un damos plus complet que celui fourni, tu peux **uploader un `.a2l` spécifique au projet**.

- Modal **Modifier projet** → section `A2L personnalisé`
- Upload du fichier → parse à chaud (plusieurs secondes si le fichier est gros)
- Les paramètres de ce projet utilisent ce A2L au lieu du damos ECU
- Bouton **`Supprimer`** → retour au A2L du catalog ECU

Le fichier est stocké dans `projects/<uuid>/custom.a2l` et son parsing est mis en cache dans `projects/<uuid>/custom.a2l.cache.json`.

Voir [Paramètres A2L](Parametres-A2L).

## Organisation sur disque

```
projects/
  <uuid>/
    meta.json           # toutes les infos du projet
    rom.bin             # ROM en cours d'édition
    rom.original.bin    # backup immuable (jamais écrasé)
    .git/               # repo git du projet
```

Tu peux zipper `projects/<uuid>/` pour déplacer un projet d'une machine à une autre. Pour importer côté nouvelle machine, recrée le dossier et relance le serveur — les projets sont auto-détectés au prochain chargement.
