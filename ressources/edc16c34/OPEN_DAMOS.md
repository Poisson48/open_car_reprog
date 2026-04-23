# open_damos — Bosch EDC16C34 PSA

**Damos libre et gratuit** pour la famille **Bosch EDC16C34 PSA** (moteur DV6TED4, 1.6 HDi 75/90/110 cv). Alternative open-source (licence CC0-1.0) aux damos propriétaires vendus 50-200 € par version firmware chez WinOLS Shop / Damos-Files / ecuedit / etc.

## Compatibilité

Tous les véhicules PSA/Ford/Mazda 1.6 HDi/TDCi avec ECU Bosch EDC16C34 :

- **Citroën** : Berlingo II, C3, C3 Picasso, C4, C4 Picasso, Xsara Picasso
- **Peugeot** : 206, 207, 307, 308, 407, Partner
- **Ford** : Fiesta TDCi, Fusion TDCi, C-Max TDCi, Focus TDCi
- **Mazda** : 2 MZ-CD, 3 MZ-CD
- **Volvo** : S40, V50, C30 (1.6D)
- **Suzuki** : SX4 1.6 DDiS

Testé sur :
- `ori.BIN` (firmware de référence damos Bosch, match 100 %)
- `9663944680.Bin` / SW `1037383736` (Berlingo II 75cv — 18/20 entries relocalisées par fingerprint, 2 par ancrage)

## Philosophie

Un damos propriétaire est un fichier A2L **hardcodé à une version firmware précise** : quand Bosch release un update (recall, SU), toutes les adresses bougent et le damos devient obsolète. Tu dois racheter.

open_damos contourne ça : chaque cartographie est décrite par l'**empreinte de ses axes** (RPM, pédale, pression…). Un scan rapide de ta ROM retrouve les maps, peu importe à quelle adresse Bosch les a déplacées. Ton damos marche sur tous les firmwares de la famille.

## Contenu (v1.1.0)

**20 entries** couvrant l'essentiel du tuning :

### Stage 1 (6 maps)
- `AccPed_trqEngHiGear_MAP` — driver's wish haut rapport
- `AccPed_trqEngLoGear_MAP` — driver's wish bas rapport
- `AccPed_trqPrp_MAP` — driver's wish propulsion (boîte auto)
- `FMTC_trq2qBas_MAP` — conversion couple → injection
- `Rail_pSetPointBase_MAP` — consigne pression rail
- `EngPrt_trqAPSLim_MAP` — limite couple protection turbo

### Safety / ceilings (3)
- `Rail_pSetPointMax_MAP` — max pression rail (pour Stage 2+)
- `EngPrt_qLim_CUR` — limiteur quantité carburant
- `AccPed_trqNMRMax_C` — couple max en non-monitored range

### Smoke / combustion (2)
- `FlMng_rLmbdSmk_MAP` — **smoke limiter lambda** (clé sur diesel pour éviter fumée noire)
- `InjCrv_phiMI1Bas2_MAP` — timing main injection

### Air / flow (3)
- `AFSCD_facCorrVal_MAP` — facteur correction débit air
- `AFSCD_dmAirSubsVal_MAP` — débit air substitut
- `AFSCD_dmLin_CUR` — linéarisation MAF

### Fuel / driver (2)
- `FlSys_rhoTFuel_CUR` — densité carburant vs température
- `Prp_rPrp_MAP` — map inverse driver's wish

### Popbang / EGR / limits (4)
- `AirCtl_nOvrRun_C` — seuil RPM overrun
- `AirCtl_qOvrRun_C` — quantité fuel overrun
- `AirCtl_nMin_C` — seuil coupure EGR (→ 8000 rpm = EGR OFF forum-style)
- `AccPed_nLimNMR_C` — seuil régime non-monitored

## Format

- `open_damos.json` — schéma JSON avec fingerprints, recordLayouts, compu methods
- Exporté en `A2L` **ASAP2 1.60** (standard ouvert) via `GET /api/ecu/edc16c34/open-damos.a2l` (baseline) ou `GET /api/projects/:id/open-damos.a2l` (relocalisé pour ta ROM)
- Utilisable dans **WinOLS, TunerPro, EcuFlash, open-car-reprog**, ou n'importe quel tool ASAP2-compliant

## Usage dans open-car-reprog

Rien à faire — l'app utilise open_damos automatiquement en fallback quand ton damos A2L ne matche pas ta ROM (cas d'un firmware différent de celui du damos de référence). Le badge toolbar te dit 🔴 Damos mismatch + Stage 1 tourne via fingerprint.

Pour exporter manuellement :
1. Ouvre ton projet (avec ROM importée)
2. Clic sur **🧬 open_damos** dans la toolbar
3. Télécharge le `.a2l` relocalisé → utilisable partout

## Usage dans WinOLS

1. Télécharge le fichier relocalisé (`open_damos_edc16c34_<ton-firmware>.a2l`)
2. Dans WinOLS : `File → Read ECU file` (ta ROM) puis `File → Read assignment file` (l'A2L open_damos)
3. Les 20 maps apparaissent avec leurs axes, unités, et tu peux les éditer directement

## Contribuer

Pour ajouter une map :
1. Obtenir son adresse + dimensions via le damos Bosch de référence ou par reverse
2. Lire les axes dans `ori.BIN` à cette adresse → ce sont les fingerprints
3. Ajouter une entry dans `open_damos.json` avec la structure type
4. PR : `node tests/open-damos.test.js` + `node tests/scripts/verify-berlingo-coherence.js` doivent passer

Pour ajouter une ECU :
1. Créer `ressources/<ecu>/open_damos.json` avec le même schéma
2. Fournir une ROM de référence et un damos A2L (ou cross-check via ROM tunée connue)
3. Tester sur au moins 2 firmwares différents de la famille

## Licence

**CC0-1.0** — domaine public. Aucune restriction. Redistribue, modifie, intègre dans un produit commercial, peu importe.
