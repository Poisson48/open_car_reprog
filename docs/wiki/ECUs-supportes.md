# ECUs supportés

Le catalog est défini dans `src/ecu-catalog.js` — 13 ECUs déclarés mais **un seul pleinement supporté** (EDC16C34).

## État actuel

| ECU | Véhicule | A2L | Stage 1 | Pop & Bang | DPF / EGR |
|-----|----------|-----|---------|------------|-----------|
| **EDC16C34** | PSA 1.6 HDi 110 cv (206, 307, 308, Partner, Berlingo…) | ✅ | ✅ | ✅ | ✅ |
| EDC17C46 | diesel | déclaré | ❌ | ❌ | ❌ |
| EDC17CP44 | diesel | déclaré | ❌ | ❌ | ❌ |
| EDC17C41 | diesel | déclaré | ❌ | ❌ | ❌ |
| ME7.x | essence | déclaré | ❌ | ❌ | ❌ |
| MED17.x | essence | déclaré | ❌ | ❌ | ❌ |
| … | | | | | |

"Déclaré" = l'ECU existe dans le catalog et apparaît dans la liste du modal de création, mais **sans fichier A2L ni adresses Stage 1 renseignées**. Un projet peut être créé, mais les paramètres A2L sont vides et Auto-mods indisponible.

## EDC16C34 en détail

### Métadonnées

- **Taille ROM** : 2 Mo
- **CPU** : Motorola MPC555
- **Flasheurs compatibles** : MPPS, KESS, Galletto, CMD Flash, bitbox
- **Véhicules** : tous PSA/Citroën 1.6 HDi 110 cv (DV6TED4) sur la génération 2004-2009

### Adresses auto-mods confirmées

| Action | Adresse | Détail |
|--------|---------|--------|
| Stage 1 — couple accélérateur haut rapport | `0x16D6C4` | MAP 16×16 SWORD |
| Stage 1 — couple accélérateur bas rapport | `0x16DA04` | MAP 16×16 SWORD |
| Stage 1 — conversion couple→fuel | `0x1760A4` | MAP 16×16 SWORD |
| Stage 1 — pression rail | `0x17A4A4` | MAP 16×16 SWORD |
| Stage 1 — limiteur couple | `0x1758E4` | MAP 16×16 SWORD |
| Pop & bang — seuil RPM | `0x1C4046` | SWORD unique |
| Pop & bang — quantité fuel | `0x1C40B4` | SWORD unique |
| DPF/FAP DTC | `0x1E9DD4` | WORD |
| EGR OFF | `0x1C4C4E` | byte |
| DPF séquence OFF | scan pattern 17 octets | signature `7F 00 00 00 00 00 00 00 00 02 01 01 00 0C 3B 0D 03` |

### Fichier A2L

- **Source** : `ressources/edc16c34/damos.a2l` (7,6 Mo, 440 000 lignes)
- **Nombre de caractéristiques** : 6638
- **Format** : ASAP2 1.6 Bosch DAMOS
- **Cache** : généré en JSON au 1er accès dans `damos.cache.json` (3,1 Mo, gitignoré)

## Ajouter un ECU

### 1. Placer le fichier A2L

```bash
mkdir -p ressources/<nom_ecu>
cp /chemin/vers/damos.a2l ressources/<nom_ecu>/damos.a2l
```

### 2. Compléter le catalog

Éditer `src/ecu-catalog.js` :

```js
module.exports = {
  edc16c34: { /* déjà là */ },

  edc17c46: {
    id: 'edc17c46',
    name: 'Bosch EDC17C46',
    a2l: 'ressources/edc17c46/damos.a2l',
    romSize: 2 * 1024 * 1024,   // ou 4 Mo selon l'ECU

    // Stage 1 — adresses CONFIRMÉES sur le ROM + A2L
    stage1Maps: [
      { name: 'AccPedTrq_MAP', address: 0xABCDEF, defaultPct: 15 },
      // …
    ],

    // Pop & bang
    popbangParams: {
      nOvrRun: { address: 0xABCDEF, min: 1000, max: 8000 },
      qOvrRun: { address: 0xABCDEF, min: 0, max: 500 }
    },

    // Auto-mods
    autoModPatterns: {
      dpfOff: {
        // soit une signature à chercher…
        search: [0x7F, 0x00, ...],
        replace: [0x7F, 0x00, ...],
      },
      // …ou une adresse fixe
      egrOff: { address: 0xABCDEF, value: 0x00 }
    }
  }
};
```

### 3. Vérifier dans l'UI

- Lancer le serveur
- Créer un projet avec le nouvel ECU → vérifier que le parser A2L traite le fichier sans erreur
- Importer un ROM de test → vérifier que les adresses retournent des valeurs plausibles via `/api/ecu/<ecu>/parameters/<name>`
- Tester Stage 1 et Pop & Bang sur un ROM de test

### 4. Trouver les adresses

Méthodes :
- **Comparer un ROM stock avec un ROM tuné connu** (WinOLS export, damos shared file) — les adresses qui diffèrent sont les maps de tuning
- **Reverse symboles A2L** — pour EDC16C34, les noms `AccPed_trq*`, `Rail_p*`, `EngPrt_trq*` se retrouvent dans d'autres Bosch avec des préfixes proches
- **Forum ecuconnections** pour les adresses DPF/EGR
- **Datasheet MPC5xx** pour la carte mémoire et les zones code/data

---

## Checksums — hors scope

**Toutes les corrections de checksums sont faites par le tool de flashing** (MPPS, KESS, Galletto, CMD…) au moment du flash. L'app n'a PAS besoin d'implémenter les algos checksum.

Voir [FAQ — Checksums](FAQ#checksums).
