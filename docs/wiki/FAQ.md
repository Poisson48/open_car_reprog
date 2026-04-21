# FAQ

## Checksums

### Dois-je corriger les checksums avant de flasher ?

**Non**. Les outils de flashing (MPPS, KESS, Galletto, CMD Flash, bitbox) **recalculent automatiquement tous les checksums pendant le flash** — à la fois les sommes simples de calibration ET les signatures cryptographiques du bootloader. Tu produis un `.bin` avec tes modifications, le tool le sanitise au flash.

C'est pour ça qu'open-car-reprog **n'implémente pas de checksum**, volontairement. Implémenter ces algos (surtout les MAC/RSA Bosch) demande une reverse-engineering par famille d'ECU, ce que les outils commerciaux couvrent déjà.

### Mon ROM modifié ne passe pas le flash

Causes possibles :
- Modifs hors de la zone calibration (tu as touché du code) — le flasher peut refuser
- Taille du fichier différente de l'original — le flasher attend 2 Mo exactement pour EDC16C34
- Outil de flash obsolète ne reconnaissant pas la signature — maj le firmware du tool

Vérifier la taille du ROM exporté :

```bash
ls -l rom.bin   # doit être pile 2097152 bytes pour EDC16C34
```

---

## Erreurs fréquentes

### "Données invalides en ROM (nx=3338, ny=8224)" sur toutes les maps

Bug du parser A2L sur les vieux builds — l'ordre des champs `AXIS_DESCR` était faux. **Fixé dans commit `8d8f248`**.

Solution :
```bash
git pull
rm ressources/edc16c34/damos.cache.json
node server.js  # attendre ~10 s pour le re-parse
```

### Badge `⚠ Layout` sur une map

Ça veut dire que l'en-tête `nx/ny` lu dans le ROM à l'adresse A2L est implausible (par ex. `nx=3338`). Causes :
- ROM dumpé d'une **autre version firmware** que celle documentée par le fichier A2L (les adresses ont bougé)
- ROM avec un décalage mémoire non configuré → essayer [Base d'adresses affichage](Editeur-Hex#base-dadresses-configurable)

L'éditeur tombe back sur les dimensions A2L (`maxAxisPoints`) et rend quand même la map. Les valeurs affichées peuvent être absurdes (garbage), ne pas se fier.

### `listen EADDRINUSE :::3000`

Un autre processus écoute déjà sur le port 3000.

```bash
# Identifier qui
ss -tlnp 2>&1 | grep :3000

# Tuer (remplacer PID)
kill <PID>

# Ou juste changer de port
PORT=3001 node server.js
```

### `Cannot find module 'express'`

Dépendances pas installées :

```bash
npm install
```

---

## Performances

### Le parser A2L est lent au premier démarrage

Normal : ~10 secondes pour parser les 440 000 lignes du fichier DAMOS EDC16C34. Les démarrages suivants sont instantanés grâce au cache JSON (3,1 Mo dans `ressources/edc16c34/damos.cache.json`).

### Le scroll dans l'hex editor lagge sur 2 Mo

Ne devrait pas — virtual scroll ne redraw que ~30 lignes. Si ça lagge :
- Vérifie le navigateur (Chrome/Firefox récent)
- Désactive les extensions (AdBlock etc.)
- Ouvre la console et regarde s'il y a des exceptions JS

---

## Git

### Comment voir les commits dans gitk / GitKraken ?

Le repo git du projet vit dans `projects/<uuid>/.git/`. Ouvre-le directement dans ton client git :

```bash
gitk --all projects/<uuid>
# ou
cd projects/<uuid> && gitk --all
```

### Je veux commit avec mon propre email

Par défaut, les commits utilisent `open-car-reprog <reprog@local>`. Pour utiliser ton identité :

```bash
cd projects/<uuid>
git config user.email ton@email.com
git config user.name "Ton Nom"
```

La config est locale au projet, pas globale.

### J'ai fait n'importe quoi, je veux repartir de zéro

```bash
cd projects/<uuid>
git reflog                                # trouve le hash d'un état sain
git reset --hard <hash>                   # revient à cet état
```

Ou plus radical : supprimer le dossier et ré-importer le ROM.

---

## Déploiement

### Peut-on déployer sur un serveur public ?

Techniquement oui (Node.js 18+, port 3000, un proxy nginx devant). Pas encore fait — le projet roadmap mentionne un VPS `fish-technics.fr` à venir.

Attention à la **sécurité** :
- Pas d'auth dans l'app (pour le moment)
- Les ROM sont stockés côté serveur
- Exposer publiquement = risque de fuite de données clients

Pour un usage multi-user public, il faudra d'abord ajouter de l'auth + séparation des projets par utilisateur.

### Peut-on le faire tourner sur OVH mutualisé ?

Non — l'hébergement mutualisé PHP d'OVH n'exécute pas Node.js. Il faut un VPS ou équivalent (OVH Cloud, Hetzner, AWS EC2, Scaleway…).

---

## Développement

### Ajouter une nouvelle feature avec tests

1. Coder la feature (backend + frontend)
2. Créer un `tests/<feature>.test.js` avec Playwright headless (voir tests existants pour template)
3. Exécuter : `PORT=3001 node server.js & ; node tests/<feature>.test.js`
4. Commit + push

Le dossier `tests/screenshots/` est gitignoré ; les screenshots validés vont dans `docs/screenshots/` (commité) ou `docs/wiki/images/` (wiki).

### Ajouter un nouvel ECU

Voir [ECUs supportés — Ajouter un ECU](ECUs-supportes#ajouter-un-ecu).
