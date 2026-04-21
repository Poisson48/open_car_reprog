# open-car-reprog

Logiciel open source de reprogrammation ECU, comparable à WinOLS, entièrement basé web.  
Première cible : **Bosch EDC16C34** (PSA 1.6 HDi 110cv — 206, 307, 308, Partner…)

![dark theme hex editor](ressources/edc16c34/edc16c34%20schema.PNG)

---

## Fonctionnalités

- **Gestion de projets** — création, description, ECU associée
- **Import ROM** — `.bin`, `.hex` (Intel HEX), `.ols` (WinOLS ZIP)
- **Sauvegarde automatique de l'original** — le fichier `rom.original.bin` est créé à l'import et ne peut jamais être écrasé
- **Éditeur hexadécimal** — canvas virtuel, défilement fluide sur 2 Mo, édition nibble par nibble au clavier
- **6638 paramètres A2L** — parsés depuis le fichier DAMOS (`damos.a2l`) de l'EDC16C34, mis en cache JSON au premier démarrage
- **Navigateur de paramètres** — recherche texte, filtre par type (VALUE / CURVE / MAP)
- **Éditeur de cartographies** — tableau éditables + graphe Chart.js pour VALUE, CURVE et MAP 2D, avec conversion valeur brute ↔ valeur physique (factor/offset)
- **Git interne par projet** — chaque modification peut être committée avec un message ; diff binaire byte-level, restauration à n'importe quel commit
- **Import WinOLS** — détection automatique ZIP, Intel HEX, ou binaire brut
- **Interface redimensionnable** — panneaux latéraux ajustables à la souris

---

## Installation

```bash
git clone https://github.com/Poisson48/open_car_reprog
cd open_car_reprog
npm install
npm start
```

Ouvrir **http://localhost:3000** dans le navigateur.

> Node.js 18+ requis.

---

## Utilisation rapide

1. **Créer un projet** → cliquer sur `+ Nouveau projet`, renseigner le nom et choisir `EDC16C34`
2. **Importer une ROM** → glisser-déposer le `.bin` sur la zone prévue (ou bouton `📂 Importer ROM`)
3. **Explorer les paramètres** → panneau gauche, rechercher par nom ou description (`DPF`, `EGR`, `boost`…)
4. **Cliquer un paramètre** → l'éditeur hex saute à l'adresse, le panneau bas affiche la cartographie
5. **Modifier** → éditer dans le tableau de la carte ou directement dans l'hex (touches hex au clavier)
6. **Sauvegarder** → `Ctrl+S` pour flusher les bytes sur le disque
7. **Committer** → panneau droit, saisir un message et cliquer `💾 Commit modifications`
8. **Historique** → cliquer un commit pour voir le diff ; bouton `⟲ Restaurer` pour revenir en arrière

---

## Architecture

```
server.js                   Serveur Express (API REST)
src/
  a2l-parser.js             Parser ASAP2/DAMOS (récursif, tokenizer regex)
  project-manager.js        CRUD projets (filesystem)
  git-manager.js            Git par projet (simple-git + execFile binaire)
  winols-parser.js          Import WinOLS / Intel HEX / ZIP
public/
  js/
    app.js                  Routeur SPA (#/  et  #/project/:id)
    api.js                  Client fetch (wrapper REST)
    views/
      home.js               Vue liste de projets
      project.js            Vue workspace (hex + params + git)
    components/
      hex-editor.js         Éditeur hex canvas, virtual scroll
      param-panel.js        Navigateur paramètres A2L
      map-editor.js         Éditeur VALUE / CURVE / MAP + Chart.js
      git-panel.js          Historique git, diff, restauration
projects/                   Données runtime (gitignorées)
ressources/
  edc16c34/
    damos.a2l               Fichier DAMOS complet EDC16C34 (~440k lignes)
    ori.BIN                 ROM originale de référence (2 Mo)
```

---

## EDC16C34 — adresses utiles

| Paramètre | Adresse | Type | Notes |
|-----------|---------|------|-------|
| FAP/DPF switch | `0x1E9DD4` | 16-bit | `0x0000` = FAP OFF, `0x0101` = FAP ON |
| EGR hystérésis | `0x1C4C4E` | — | Voir forum ecuconnections |
| Boost max | chercher `boost` dans les paramètres | CURVE | — |

Séquence FAP OFF binaire (rechercher dans l'hex) :
```
FAP ON  : 7F 00 00 00 00 00 00 00 00 02 01 01 00 0C 3B 0D 03
FAP OFF : 7F 00 00 00 00 00 00 00 00 02 00 00 00 0C 3B 0D 03
```

---

## Calculateurs supportés

| ECU | Véhicule | A2L disponible |
|-----|----------|----------------|
| EDC16C34 | PSA 1.6 HDi 110cv (206, 307, 308, Partner) | ✅ |

> Contributions bienvenues pour d'autres calculateurs — ajouter le fichier `.a2l` dans `ressources/<ecu>/` et déclarer l'ECU dans `server.js`.

---

## Contribuer

Pull requests bienvenues. Pour ajouter un calculateur :

1. Ajouter `ressources/<nom_ecu>/damos.a2l`
2. Déclarer l'entrée dans `ECU_A2L` dans `server.js`
3. Ajouter l'option dans le `<select>` de `public/index.html`

---

## Licence

MIT
