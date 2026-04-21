# Tutoriel complet — de l'import ROM au flash

Ce tutoriel couvre le workflow type d'un tuner : importer un ROM lu via MPPS/KESS, appliquer un Stage 1, tester une variante dans une branche git, comparer, et exporter le `.bin` modifié pour le flasher.

Durée estimée : **15 minutes**.

---

## 1. Créer un projet

Depuis la page d'accueil, cliquer **`+ Nouveau projet`**.

![home](images/01-home.png)

Remplir le modal avec les infos du véhicule — ECU, immatriculation, année, véhicule, description :

![new-project-modal](images/02-new-project-modal.png)

Seuls le **nom** et le **calculateur** sont obligatoires. Les autres champs sont pour s'y retrouver plus tard (la recherche sur la page d'accueil filtre sur nom, véhicule et immat).

---

## 2. Importer la ROM

Sur la page du projet, soit :
- **Drag-and-drop** le fichier `.bin` sur la zone centrale
- Cliquer **`📂 Importer ROM`**
- Pour un fichier WinOLS : **`WinOLS (.ols/.bin/.hex)`** — le serveur détecte automatiquement ZIP vs Intel HEX vs binaire

L'original est sauvegardé dans `rom.original.bin` à l'import et **ne peut jamais être écrasé**. Tu retrouves ton ROM d'usine avec le bouton `⬇ ROM originale` quelle que soit la suite du projet.

Une fois importé, l'espace de travail se charge :

![workspace](images/03-workspace.png)

- Sidebar gauche : paramètres A2L (6638 pour EDC16C34)
- Centre : hex editor (scroll fluide sur 2 Mo) + éditeur de cartographies
- Droite : panneau git

---

## 3. Explorer les paramètres

Tape dans la barre de recherche du panneau gauche — ça filtre instantanément les 6638 caractéristiques A2L sur leur nom et leur description :

![param-search](images/04-param-search.png)

Filtre par type avec les onglets **Tous / VAL / CUR / MAP**.

Clique sur un paramètre : l'hex editor saute à son adresse, surbrille la zone, et l'éditeur de map s'ouvre avec la heatmap :

![map-editor](images/05-map-editor.png)

La heatmap en bas à droite montre visuellement la distribution des valeurs (vert = bas, rouge = haut).

---

## 4. Appliquer un Stage 1

Le bouton **`⚡ Auto-mods`** dans la toolbar ouvre le panneau des modifications automatiques :

![auto-mods](images/06-auto-mods.png)

Pour EDC16C34, les modifs disponibles :

| Modif | Description |
|-------|-------------|
| **Stage 1** | +15% couple haut rapport, +15% bas rapport, +12% quantité carburant, +10% pression rail, +25% limiteur couple |
| **Pop & Bang** | Seuil RPM + quantité carburant injectée en décélération |
| **DPF / FAP OFF** | Patch binaire à `0x1E9DD4` + signature 17 octets |
| **EGR OFF** | Adresse `0x1C4C4E` |
| **Swirl OFF** | Désactive les volets d'admission |

Les pourcentages Stage 1 sont **ajustables par carte** — tu peux faire un Stage 1 "light" à +8% ou un Stage 2 maison à +25% en personnalisant les valeurs. Les adresses sont confirmées ROM + A2L.

---

## 5. Éditer à la main

Si tu veux affiner : clique un paramètre, sélectionne une plage de cellules dans la map (click-drag), puis utilise les boutons `+5%`, `-5%`, `+10%`, etc.

![map-editor-detail](images/05-map-editor.png)

Tu peux aussi double-cliquer une cellule pour entrer une valeur physique (en Nm, bar, °C…) directement — l'app convertit automatiquement en raw via les coefficients A2L.

**Raccourci** : `Ctrl+S` envoie tous les octets modifiés au backend. L'appui ne commit PAS — il patche juste les bytes sur disque. Le commit se fait ensuite depuis le panneau git.

---

## 6. Commit via le panneau git

Après les modifs, ouvre le panneau git à droite. Appuie sur **`✨`** à côté du champ message — l'app détecte automatiquement ce qui a changé et propose un message pertinent :

![auto-commit-msg](images/12-auto-commit-msg.png)

Exemples de messages générés :
- `ACCD_uSRCMin_C +360%` (1 carte, fit exact)
- `Stage 1 (5/5 cartes)` (pattern reconnu)
- `5 cartes : ACCD_DebNplDef_C, ACCD_DebNplOK_C, …` (modifs diffuses)

Tu peux éditer avant d'appuyer **`💾 Commit modifications`**.

---

## 7. Tester une variante en branche git

C'est là que l'approche git brille. Tu veux essayer un Stage 2 sans perdre ton Stage 1 ? Clique sur **`⎇ master ▾`** dans la toolbar :

![branch-switcher](images/07-branch-switcher.png)

Tape un nom dans le champ `nouvelle branche depuis master`, Entrée → tu es maintenant sur une nouvelle branche. Applique Stage 2, commit. Tu peux switcher entre `master` et `stage2` en 1 clic, l'éditeur recharge le bon ROM à chaque fois.

**Aucun travail n'est perdu** : si tu switches avec des modifs non committées, elles sont automatiquement commitées en `WIP on <branch>` avant le switch.

---

## 8. Visualiser l'historique

Le panneau git montre un **graph SVG** avec lanes colorées par branche, diagonales aux divergences et badges `HEAD →`, `master`, tags :

![git-graph](images/09-git-graph.png)

Click sur un commit → tu vois le **diff map-level** : la liste des cartes A2L modifiées, pas des octets bruts :

![diff-map-level](images/10-diff-map-level.png)

Chaque ligne montre le type (MAP/CURVE/VALUE), le nombre de cellules changées, et un échantillon avant → après.

---

## 9. Compare view

Click sur une carte dans la liste du diff → l'éditeur s'ouvre en **mode comparaison vs parent** :

![map-compare](images/11-map-compare.png)

Les cellules modifiées sont entourées de **vert** (augmentées) ou **rouge** (diminuées) par rapport à la version parente. Hover → tooltip `avant: 50 → actuel: 70 (+20)`.

C'est plus puissant que WinOLS car ça marche entre n'importe quelles 2 versions (pas juste vs stock).

---

## 10. Restaurer / revenir en arrière

Chaque commit a un bouton **`⟲ Restaurer`** qui ramène le ROM à cet état. En interne c'est un `git checkout <hash> -- rom.bin` suivi d'un commit — donc c'est loggué dans l'historique, pas destructif.

Pour un vrai "retour arrière" sans garder la trace : supprimer la branche courante puis switcher sur celle qui a l'état voulu.

---

## 11. Exporter pour le flash

Click **`⬇ Télécharger ROM`** dans la toolbar → récupère le `.bin` modifié. Tu le flashes via MPPS/KESS/Galletto — **les checksums sont recalculés automatiquement par le tool de flashing**, tu n'as rien à faire côté app.

Si tu veux la version d'origine pour flasher en cas de problème : **`⬇ ROM originale`**.

---

## Workflow récap

```
Créer projet → Importer ROM → [paramètres A2L | auto-mods | édition directe] →
  Ctrl+S → ✨ commit → (optionnel: nouvelle branche) → exporter .bin → flash MPPS
```

La magie :
- **git** gère le versionnement, les branches, les rollbacks
- **diff map-level + compare view** te disent visuellement ce qui change
- **auto-mods** + **Stage 1 ajustable** pour les modifs de routine
- **Paramètres A2L** + **éditeur map** pour les modifs fines

---

Voir aussi :
- [Workflow git en détail](Workflow-git)
- [Auto-mods — liste complète](Auto-mods)
- [FAQ](FAQ)
