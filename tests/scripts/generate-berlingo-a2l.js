// Génère un fichier A2L complet et spécifique au calculateur Berlingo de
// l'utilisateur (9663944680, SW Bosch 1037383736) en combinant :
//  1. open_damos (20 entries nommées, relocalisées par fingerprint)
//  2. auto-find (candidats heuristiques, labellés Map_<addr> si non matchés
//     dans open_damos, évite les doublons avec les 20 déjà nommées)
//
// Output :
//  - ressources/edc16c34/firmwares/9663944680_sw1037383736.a2l
//  - ressources/edc16c34/firmwares/9663944680_sw1037383736.json
//
// L'utilisateur télécharge ces fichiers, les utilise directement dans WinOLS,
// ou les re-upload dans l'app comme custom A2L projet.

const fs = require('fs');
const path = require('path');
const { loadOpenDamos, relocate } = require('../../src/open-damos');
const { findMaps } = require('../../src/map-finder');
const { exportA2l } = require('../../src/open-damos-a2l-export');

const BIN = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', '9663944680.Bin');
const OUT_DIR = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', 'firmwares');
const OUT_A2L = path.join(OUT_DIR, '9663944680_sw1037383736.a2l');
const OUT_JSON = path.join(OUT_DIR, '9663944680_sw1037383736.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

const FW_ID = {
  partNumber: '9663944680',
  softwareId: '1037383736',
  hardwareId: '0281012620',
  hwVariant: '9659614980',
  ecu: 'edc16c34',
  ecuVariant: 'EDC16C34-4.11',
  vehicles: ['Citroën Berlingo II 1.6 HDi 75cv', 'Peugeot Partner 1.6 HDi 75cv'],
  engine: 'DV6TED4',
  source: 'ecudiag.es + JeanLucPons/DTCController (CarInfo.java)',
};

function run() {
  const damos = loadOpenDamos('edc16c34');
  const rom = fs.readFileSync(BIN);

  // Phase 1 : relocalisation open_damos par fingerprint
  const relocated = relocate(damos, rom);
  const namedByAddr = new Map();
  for (const r of relocated) {
    if (r.addressSource === 'fingerprint' || r.addressSource === 'anchor') {
      namedByAddr.set(r.address, r);
    }
  }

  // Phase 2 : auto-find heuristique (candidats hors open_damos)
  const autoFound = findMaps(rom, { limit: 200 });
  const extraMaps = [];
  for (const cand of autoFound) {
    // Skip si déjà couvert par open_damos (overlap ±16 octets)
    let overlap = false;
    for (const addr of namedByAddr.keys()) {
      if (Math.abs(cand.address - addr) < 16) { overlap = true; break; }
    }
    if (overlap) continue;
    extraMaps.push(cand);
  }

  console.log(`  open_damos relocalisés   : ${[...namedByAddr.values()].length}`);
  console.log(`  auto-find candidats nets : ${extraMaps.length} (après dédup vs open_damos)`);

  // Phase 3 : construit un damos composite en ajoutant les auto-find comme
  // entries MAP génériques (nom Map_<addr>, record layout Kf_Xs16_Ys16_Ws16,
  // pas de compu method spécifique). Les axes portent les vrais offsets,
  // mais sans fingerprint hard-coded (l'adresse est celle du Berlingo).
  const composite = {
    ...damos,
    version: damos.version + '+auto',
    description: damos.description + ' — build spécifique firmware ' + FW_ID.softwareId + ' (' + FW_ID.vehicles.join(', ') + ').',
    firmware: FW_ID,
    characteristics: [
      ...damos.characteristics,
      ...extraMaps.map(m => {
        // Lit les vrais axes à cette adresse pour servir de fingerprint
        // (compatible avec le sous-système relocate qui exige un fingerprint).
        const xAxis = [];
        for (let i = 0; i < m.nx; i++) {
          const off = m.address + 4 + i * 2;
          const u = (rom[off] << 8) | rom[off + 1];
          xAxis.push(u & 0x8000 ? u - 0x10000 : u);
        }
        const yAxis = [];
        for (let i = 0; i < m.ny; i++) {
          const off = m.address + 4 + m.nx * 2 + i * 2;
          const u = (rom[off] << 8) | rom[off + 1];
          yAxis.push(u & 0x8000 ? u - 0x10000 : u);
        }
        return {
          name: `Map_${m.address.toString(16).toUpperCase()}`,
          category: 'auto-found',
          description: `Cartographie auto-détectée (map-finder score ${m.score.toFixed(2)}, hors open_damos).`,
          type: 'MAP',
          recordLayout: 'Kf_Xs16_Ys16_Ws16',
          defaultAddress: '0x' + m.address.toString(16).toUpperCase(),
          dims: { nx: m.nx, ny: m.ny },
          axes: [
            { inputQuantity: 'Unknown_X', unit: '-', factor: 1, offset: 0, dataType: 'SWORD_BE', fingerprint: xAxis },
            { inputQuantity: 'Unknown_Y', unit: '-', factor: 1, offset: 0, dataType: 'SWORD_BE', fingerprint: yAxis },
          ],
          data: { dataType: 'SWORD_BE', factor: 1, offset: 0, unit: '-' },
        };
      }),
    ],
  };

  // Phase 4 : export A2L avec les adresses relocalisées pour les 20 open_damos
  // et les adresses des auto-find (déjà bien sûres). Pour ça on passe la ROM
  // à exportA2l qui réutilise relocate() en interne pour les entries nommées,
  // et pour les entries auto-found, defaultAddress = déjà la bonne.
  const { a2l, relocation } = exportA2l(composite, rom);

  // Ajoute une bannière commentaire en tête du fichier pour identifier
  // précisément le firmware cible.
  const banner = [
    '/*',
    ' * ═══════════════════════════════════════════════════════════════════',
    ' *  OPEN_DAMOS — fichier A2L généré pour un firmware spécifique',
    ' * ═══════════════════════════════════════════════════════════════════',
    ' *',
    ' *  Calculateur     : ' + FW_ID.ecuVariant + ' (' + FW_ID.ecu + ')',
    ' *  Part Bosch      : ' + FW_ID.hardwareId,
    ' *  Part PSA / SW   : ' + FW_ID.partNumber + ' / SW ' + FW_ID.softwareId,
    ' *  Variante HW     : ' + FW_ID.hwVariant,
    ' *  Moteur          : ' + FW_ID.engine + ' 1.6 HDi 75cv',
    ' *  Véhicules       : ' + FW_ID.vehicles.join(', '),
    ' *  Source IDs      : ' + FW_ID.source,
    ' *',
    ' *  Généré par      : open_damos ' + damos.version + ' + auto-find heuristic',
    ' *  Date            : ' + new Date().toISOString(),
    ' *  Entries         : ' + damos.characteristics.length + ' nommées + ' + extraMaps.length + ' auto-détectées',
    ' *  Licence         : CC0-1.0 (domaine public)',
    ' *',
    ' *  Usage WinOLS    : File → Read assignment file → ce fichier',
    ' *  Usage open-car-reprog : upload via 📑 A2L dans le toolbar projet',
    ' *',
    ' *  ATTENTION — les entries "Map_<addr>" sont auto-détectées et non',
    ' *  identifiées. Leurs axes et data n\'ont pas d\'unité connue — à',
    ' *  identifier par comparaison avec une ROM tunée ou datalog avant',
    ' *  modification.',
    ' */',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_A2L, banner + a2l);
  fs.writeFileSync(OUT_JSON, JSON.stringify(composite, null, 2));

  console.log('');
  console.log(`  ✓ ${path.relative(process.cwd(), OUT_A2L)}  ${(fs.statSync(OUT_A2L).size / 1024).toFixed(1)} KB`);
  console.log(`  ✓ ${path.relative(process.cwd(), OUT_JSON)}  ${(fs.statSync(OUT_JSON).size / 1024).toFixed(1)} KB`);
  console.log(`  Total CHARACTERISTICs dans le .a2l : ${composite.characteristics.length}`);
}

run();
