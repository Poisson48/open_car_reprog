# API REST

Toutes les routes sont sous `/api`. Le serveur écoute par défaut sur `http://localhost:3000` (override via `PORT=3001 node server.js`). Format JSON, sauf endpoints ROM (binaire).

---

## Application

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/version` | `{ "version": "0.1.0" }` depuis package.json |
| GET | `/api/ecu` | Liste du catalog : `[{ id, name, a2l, stage1, popbang }]` |

---

## Projets

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/projects` | Liste tous les projets (plus récent d'abord) |
| POST | `/api/projects` | Créer `{ name, ecu, description?, vehicle?, immat?, year? }` |
| GET | `/api/projects/:id` | Détails d'un projet |
| PATCH | `/api/projects/:id` | MAJ partielle : `name`, `description`, `vehicle`, `immat`, `year`, `ecu`, `displayAddressBase` |
| DELETE | `/api/projects/:id` | Supprime le dossier entier du projet |

### Metadata

```json
{
  "id": "a4d53061-...",
  "name": "206 HDI Stage 1",
  "ecu": "edc16c34",
  "vehicle": "Peugeot 206 1.6 HDi 110cv",
  "immat": "AB-123-CD",
  "year": "2005",
  "description": "Stage 1 + FAP off",
  "displayAddressBase": 0,
  "createdAt": "2026-04-21T21:23:45.000Z",
  "hasRom": true,
  "romName": "rom.bin",
  "romSize": 2097152,
  "romImportedAt": "2026-04-21T21:25:00.000Z"
}
```

---

## ROM

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/projects/:id/rom` | Import ROM (multipart `rom=@file.bin`) → crée aussi `rom.original.bin` si absent |
| GET | `/api/projects/:id/rom` | Télécharge le ROM courant (binaire). Query `?commit=<hash>` → version à ce commit |
| GET | `/api/projects/:id/rom/backup` | Télécharge la sauvegarde originale (immuable) |
| PATCH | `/api/projects/:id/rom/bytes` | Patche des octets : body JSON `{ offset: number, data: base64 }` |
| POST | `/api/projects/:id/import-winols` | Import WinOLS (.ols ZIP, Intel HEX ou binaire détecté automatiquement) |

**Exemple** patch 2 octets à l'offset 0x1E9DD4 :

```bash
curl -X PATCH http://localhost:3000/api/projects/<id>/rom/bytes \
  -H 'Content-Type: application/json' \
  -d '{"offset":2005972,"data":"AAA="}'   # AAA= = Buffer.from([0,0]).toString('base64')
```

---

## Git

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/projects/:id/git/commit` | Commit toutes les modifs ; body `{ message: string }` |
| GET | `/api/projects/:id/git/log` | Log avec `parents` + `refs` (HEAD, branches, tags) pour le graph |
| GET | `/api/projects/:id/git/diff/:hash` | Diff binaire byte-level (legacy) |
| **GET** | **`/api/projects/:id/git/diff-maps/:hash`** | **Diff map-level** : quelles caractéristiques A2L changent entre le commit et son parent |
| GET | `/api/projects/:id/git/diff-maps-head` | Diff HEAD vs working tree (pour ✨ auto-commit message) |
| POST | `/api/projects/:id/git/restore/:hash` | Restaure le ROM à cet état (crée un nouveau commit "Restored to …") |
| GET | `/api/projects/:id/git/branches` | `{ current, all: [...] }` |
| POST | `/api/projects/:id/git/branches` | Crée une branche `{ name }` + checkout |
| PUT | `/api/projects/:id/git/branches/:name` | Switch vers cette branche (auto-commit `WIP on <branche>` si working tree dirty) |
| DELETE | `/api/projects/:id/git/branches/:name` | Supprime une branche (impossible sur la courante) |

### Diff map-level — format

```json
{
  "hash": "a017964...",
  "parentHash": "044b460...",
  "intervalCount": 3,
  "maps": [
    {
      "name": "AccPed_trqEngHiGear_MAP",
      "type": "MAP",
      "address": 1840200,
      "size": 580,
      "unit": "Nm",
      "description": "driver's behaviour map…",
      "cellsChanged": 2,
      "totalCells": 290,
      "tightness": 0.0069,
      "sample": { "offset": 36, "before": 500, "after": 600 }
    },
    …
  ]
}
```

Trié par **tightness** (cellules changées / cellules totales) descendant — les fit exacts (VALUE touchée précisément) passent devant les gros MAPs peu touchés.

---

## Paramètres A2L

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/ecu/:ecu/parameters` | Liste paginée. Query : `search` (texte), `type` (VALUE/CURVE/MAP/VAL_BLK), `offset`, `limit` |
| GET | `/api/ecu/:ecu/parameters/:name` | Détail d'un paramètre (enrichi avec record layout + compu method) |

Exemple :

```bash
curl 'http://localhost:3000/api/ecu/edc16c34/parameters?search=DPF&type=VALUE&limit=5'
```

---

## Modifications automatiques

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/projects/:id/stage1` | Body `{ pcts: { "MapName": 15, ... } }` — applique les pourcentages à chaque carte du catalog Stage 1 |
| POST | `/api/projects/:id/popbang` | Body `{ rpm: 4400, fuelQty: 10 }` |

D'autres modifications (DPF, EGR, Swirl, Speed limiter) sont déclenchées depuis le frontend via `PATCH /rom/bytes` après lecture du ROM. Voir [Auto-mods](Auto-mods).

---

## Exemple — script complet via API

```bash
#!/bin/bash
HOST=http://localhost:3000

# 1. Créer un projet
PROJ=$(curl -s -X POST $HOST/api/projects -H 'Content-Type: application/json' \
  -d '{"name":"Stage 1 API demo","ecu":"edc16c34","vehicle":"206 1.6 HDi"}')
ID=$(echo $PROJ | jq -r .id)

# 2. Importer ROM
curl -s -X POST $HOST/api/projects/$ID/rom -F rom=@ori.BIN

# 3. Créer une branche stage1
curl -s -X POST $HOST/api/projects/$ID/git/branches \
  -H 'Content-Type: application/json' -d '{"name":"stage1"}'

# 4. Appliquer Stage 1 (valeurs par défaut)
curl -s -X POST $HOST/api/projects/$ID/stage1 \
  -H 'Content-Type: application/json' -d '{}'

# 5. Commit
curl -s -X POST $HOST/api/projects/$ID/git/commit \
  -H 'Content-Type: application/json' -d '{"message":"Stage 1"}'

# 6. Télécharger le ROM modifié
curl -s $HOST/api/projects/$ID/rom > rom_stage1.bin

echo "ROM Stage 1 dans rom_stage1.bin"
```
