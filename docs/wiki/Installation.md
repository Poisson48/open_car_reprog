# Installation

## Pré-requis

- **Node.js 18+** (testé sur 18.19)
- **git** (pour le versionnement des projets)
- **Un navigateur moderne** (Chrome, Firefox, Safari, Edge)

## Installation

```bash
git clone https://github.com/Poisson48/open_car_reprog.git
cd open_car_reprog
npm install
```

## Lancer le serveur

```bash
node server.js           # production
node --watch server.js   # dev (hot reload sur changements)
```

Par défaut : **http://localhost:3000**

Pour un port différent :

```bash
PORT=3001 node server.js
```

## Premier démarrage

Le parser A2L compile `ressources/edc16c34/damos.a2l` (440 000 lignes) au premier accès aux paramètres et écrit un cache JSON de 3,1 Mo (`damos.cache.json`). Le cache est gitignoré et régénéré automatiquement s'il manque.

Compte **5 à 10 secondes** pour le premier parse, instantané ensuite.

## Tester l'installation

Le projet inclut des tests Playwright qui vérifient bout-en-bout chaque feature UI :

```bash
npm install          # installe playwright + chromium
node server.js &     # ou PORT=3001 si 3000 est pris
node tests/branch-switcher.test.js
node tests/diff-map-level.test.js
node tests/auto-commit-msg.test.js
node tests/git-graph.test.js
node tests/map-compare.test.js
node tests/a2l-parser-fix.test.js
node tests/display-base.test.js
```

Chaque test écrit des captures dans `tests/screenshots/` (gitignoré).

## Structure des données

Les projets sont stockés dans `projects/<uuid>/` :

```
projects/
  a4d53061-.../
    meta.json           # nom, ECU, véhicule, immat, année, description, displayAddressBase
    rom.bin             # ROM courant (édité par l'app)
    rom.original.bin    # sauvegarde immuable de l'import
    .git/               # repo git dédié au projet
```

Rien n'est envoyé à un serveur distant — tout reste local.
