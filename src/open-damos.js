// open_damos — un damos libre et gratuit pour Bosch EDC16C34 (et plus tard
// d'autres ECU). L'idée : au lieu de chasser un damos propriétaire pour
// chaque firmware (SW ID différent = adresses différentes), on utilise les
// axes RPM / pédale / couple comme **empreintes uniques** pour relocaliser
// automatiquement les maps dans n'importe quelle ROM de la même famille.
//
// Workflow :
//   1. loadOpenDamos('edc16c34') → lit ressources/edc16c34/open_damos.json
//   2. relocate(damos, romBuffer)  → pour chaque MAP/CURVE, scanne la ROM
//      à la recherche de l'empreinte d'axes. Pour chaque VALUE avec un
//      ancrage sur une MAP, applique le même décalage que l'ancre.
//   3. Retourne la liste des characteristics avec address résolue,
//      addressSource ∈ {fingerprint, anchor, default-fallback}, confidence 0..1.
//
// La tolérance fuzzy sur les axes accepte de petites variations (ex. 2746
// vs 2750) entre firmwares proches — ces variations sont fréquentes quand
// Bosch ajuste un point sans réorganiser la grille.

const fs = require('fs');
const path = require('path');

const DATA_TYPE_SIZE = {
  SBYTE: 1, UBYTE: 1,
  SWORD_BE: 2, UWORD_BE: 2,
  SLONG_BE: 4, ULONG_BE: 4,
};

function readInt(buf, off, type) {
  if (off < 0 || off + DATA_TYPE_SIZE[type] > buf.length) return null;
  switch (type) {
    case 'UBYTE':    return buf[off];
    case 'SBYTE':    { const v = buf[off]; return v & 0x80 ? v - 0x100 : v; }
    case 'UWORD_BE': return (buf[off] << 8) | buf[off + 1];
    case 'SWORD_BE': { const v = (buf[off] << 8) | buf[off + 1]; return v & 0x8000 ? v - 0x10000 : v; }
    case 'ULONG_BE': return (buf[off] * 0x1000000) + (buf[off+1] << 16) + (buf[off+2] << 8) + buf[off+3];
    case 'SLONG_BE': { const u = readInt(buf, off, 'ULONG_BE'); return u & 0x80000000 ? u - 0x100000000 : u; }
  }
  return null;
}

function parseAddr(s) {
  if (typeof s === 'number') return s;
  return parseInt(s, 16);
}

function loadOpenDamos(ecu, baseDir) {
  const dir = baseDir || path.join(__dirname, '..', 'ressources', ecu);
  const p = path.join(dir, 'open_damos.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Axes fuzzy match. Two-pass approach :
//   1. Strict (element-wise) match — tolère de petites dérives de valeurs
//      entre firmwares proches sans réorganisation d'axes.
//   2. Lenient (bag-of-values) — si la phase stricte échoue, on vérifie
//      combien de valeurs du fingerprint existent dans l'actual, à
//      tolérance près. Gère les insertions / décalages fréquents entre
//      calibrations Bosch de la même famille (ex. 16 points dont un nouveau
//      point ajouté au milieu → décale tout le reste).
// Renvoie {match, score, mode ∈ {strict, bag}, matches, total}.
function axisMatches(actual, expected, opts = {}) {
  const { absTol = 100, relTol = 0.05, strictMinFrac = 0.85, bagMinFrac = 0.70 } = opts;
  if (actual.length !== expected.length) return { match: false, score: 0 };

  // Phase 1 : strict element-wise
  let strictMatches = 0;
  let totalErr = 0;
  let totalAbs = 0;
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i];
    const tol = Math.max(absTol, Math.abs(e) * relTol);
    const err = Math.abs(a - e);
    if (err <= tol) strictMatches++;
    totalErr += err;
    totalAbs += Math.abs(e);
  }
  const strictFrac = strictMatches / expected.length;
  if (strictFrac >= strictMinFrac) {
    const score = strictFrac * (1 - Math.min(1, totalErr / (totalAbs || 1)));
    return { match: true, score, mode: 'strict', matches: strictMatches, total: expected.length };
  }

  // Phase 2 : bag-of-values — tolère insertions/déplacements
  let bagMatches = 0;
  for (const e of expected) {
    const tol = Math.max(absTol, Math.abs(e) * relTol);
    if (actual.some(a => Math.abs(a - e) <= tol)) bagMatches++;
  }
  const bagFrac = bagMatches / expected.length;
  if (bagFrac >= bagMinFrac) {
    // Sanity : la monotonie et la plage doivent correspondre, sinon on
    // matche par hasard sur une autre map qui contient 70 % des mêmes
    // nombres. Vérifie min/max dans ±15 %.
    const eMin = Math.min(...expected), eMax = Math.max(...expected);
    const aMin = Math.min(...actual), aMax = Math.max(...actual);
    const rangeTol = 0.15;
    const minOk = Math.abs(aMin - eMin) <= Math.max(absTol, Math.abs(eMin) * rangeTol);
    const maxOk = Math.abs(aMax - eMax) <= Math.max(absTol, Math.abs(eMax) * rangeTol);
    if (minOk && maxOk) {
      return { match: true, score: bagFrac * 0.8, mode: 'bag', matches: bagMatches, total: expected.length };
    }
  }

  return { match: false, score: Math.max(strictFrac, bagFrac) * 0.5 };
}

// Cherche une entry MAP/CURVE par empreinte d'axes dans toute la ROM.
// Retourne TOUS les candidats triés (pas juste le top) pour que la phase
// de désambiguation globale puisse attribuer la bonne occurrence quand
// plusieurs entries matchent les mêmes offsets.
function findMapByFingerprint(romBuf, entry, opts = {}) {
  const isMap = entry.type === 'MAP';
  const isCurve = entry.type === 'CURVE';
  if (!isMap && !isCurve) return [];

  const headerBytes = isMap ? 4 : 2;
  const axisDT = entry.axes[0]?.dataType || 'SWORD_BE';
  const axisSize = DATA_TYPE_SIZE[axisDT] || 2;

  const xFp = entry.axes[0].fingerprint;
  const yFp = isMap ? entry.axes[1].fingerprint : null;
  const expectedNx = entry.dims.nx;
  const expectedNy = isMap ? entry.dims.ny : 0;

  const candidates = [];
  const step = opts.step || 2;
  const start = opts.startOffset || 0;
  const end = Math.min(opts.endOffset || romBuf.length, romBuf.length);

  for (let off = start; off <= end - headerBytes; off += step) {
    const nx = readInt(romBuf, off, 'UWORD_BE');
    if (nx !== expectedNx) continue;
    if (isMap) {
      const ny = readInt(romBuf, off + 2, 'UWORD_BE');
      if (ny !== expectedNy) continue;
    }

    const xAxisOff = off + headerBytes;
    const xAxis = [];
    for (let i = 0; i < expectedNx; i++) xAxis.push(readInt(romBuf, xAxisOff + i * axisSize, axisDT));
    const xResult = axisMatches(xAxis, xFp, opts.axisTol);
    if (!xResult.match) continue;

    let yResult = { match: true, score: 1, mode: 'n/a' };
    let yAxis = [];
    if (isMap) {
      const yAxisOff = xAxisOff + expectedNx * axisSize;
      for (let i = 0; i < expectedNy; i++) yAxis.push(readInt(romBuf, yAxisOff + i * axisSize, axisDT));
      yResult = axisMatches(yAxis, yFp, opts.axisTol);
      if (!yResult.match) continue;
    }

    // Score composite : moyenne des scores d'axes, bonus si match strict
    // sur les deux axes (confiance maximale).
    const avgScore = isMap ? (xResult.score + yResult.score) / 2 : xResult.score;
    const strictBonus = (xResult.mode === 'strict' && (!isMap || yResult.mode === 'strict')) ? 0.1 : 0;

    candidates.push({
      address: off,
      score: Math.min(1, avgScore + strictBonus),
      xMode: xResult.mode,
      yMode: yResult.mode,
      xAxis, yAxis,
    });
  }

  if (!candidates.length) return [];

  // Tri : score desc, puis proximité avec defaultAddress (tie-breaker)
  const defaultAddr = parseAddr(entry.defaultAddress);
  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
    return Math.abs(a.address - defaultAddr) - Math.abs(b.address - defaultAddr);
  });

  return candidates;
}

// Relocalisation VALUE via ancrage : si l'ancre MAP a été trouvée à un offset
// différent de son defaultAddress, on applique le même delta à la VALUE.
// Hypothèse : Bosch range les constantes dans les mêmes régions mémoire que
// leurs MAPs associées (vérifié sur EDC16C34). Vérifie la plausibilité de
// la valeur lue vs la stockRawValue du damos — si trop divergent, la VALUE
// n'est probablement pas ici et on refuse l'ancrage.
function findValueByAnchor(romBuf, entry, anchorMatch) {
  const defaultAddr = parseAddr(entry.defaultAddress);
  const anchorDefault = parseAddr(anchorMatch.entry.defaultAddress);
  const delta = anchorMatch.address - anchorDefault;
  const candidate = defaultAddr + delta;
  if (candidate < 0 || candidate + 2 > romBuf.length) return null;

  const dt = entry.data?.dataType || 'SWORD_BE';
  const raw = readInt(romBuf, candidate, dt);
  const isPadding = raw === -1 || raw === 0xFFFF || raw === 0 && entry.stockRawValue !== 0;

  // Sanity plus fin : compare avec stockRawValue du damos. Une calibration
  // cousine peut avoir une valeur différente (ex. Berlingo avec EGR déjà
  // configuré en 5050 rpm stock), mais dans des plages raisonnables.
  // On rejette si la valeur est complètement aberrante (ex. signed ou hors
  // plage physique connue).
  let confidence = isPadding ? 0 : 0.8;
  let plausible = !isPadding;
  if (entry.stockRawValue !== undefined && raw !== null) {
    const stock = entry.stockRawValue;
    // Si stock est un RPM/quantité, la valeur doit rester positive et dans
    // un ratio raisonnable (typiquement entre stock/10 et stock×10, ou
    // entre 0 et une borne absolue type 8000 pour RPM).
    const absTolRange = Math.max(Math.abs(stock) * 10, 500);
    if (raw < 0 || raw > 32767) plausible = false;
    if (Math.abs(raw - stock) > absTolRange && raw > 0) {
      // Valeur dans la bonne plage générale — on garde mais avec confiance moindre
      confidence = 0.5;
    }
    if (!plausible) confidence = 0;
  }

  return {
    address: candidate,
    delta,
    raw,
    physValue: raw !== null ? raw * (entry.data?.factor || 1) + (entry.data?.offset || 0) : null,
    confidence,
    plausible,
  };
}

// Relocalisation complète : boucle sur tous les characteristics, renvoie
// pour chacun l'adresse retenue et sa source (fingerprint / anchor /
// default-fallback / not-found). Gère la désambiguation quand plusieurs
// entries partagent un même fingerprint (ex. AccPed_trqEngHi/Lo_MAP qui
// ont souvent des axes identiques sur les variantes 75cv PSA) via une
// attribution greedy : la meilleure entry prend l'offset le plus proche
// de son defaultAddress, les suivantes prennent les offsets restants.
function relocate(damos, romBuf, opts = {}) {
  const mapMatches = new Map(); // name → {entry, address, score, ...}

  // Phase 1.a : collecte les candidats MAP/CURVE par fingerprint (list, pas top-1)
  const entryCandidates = new Map(); // name → candidates[]
  const mapEntries = damos.characteristics.filter(c => c.type === 'MAP' || c.type === 'CURVE');
  for (const c of mapEntries) {
    entryCandidates.set(c.name, findMapByFingerprint(romBuf, c, opts));
  }

  // Phase 1.b : attribution greedy. On traite les entries dans l'ordre
  // où elles apparaissent dans le damos (ordre signifiant : Hi avant Lo,
  // etc.), chacune prenant son meilleur candidat non encore pris par une
  // autre entry, en préférant le candidat le plus proche de son defaultAddress.
  const usedAddresses = new Set();
  const resolvedByName = new Map();
  for (const c of mapEntries) {
    const cands = entryCandidates.get(c.name) || [];
    const defaultAddr = parseAddr(c.defaultAddress);
    // Filtre : élimine les candidats déjà pris
    const free = cands.filter(x => !usedAddresses.has(x.address));
    if (!free.length) {
      resolvedByName.set(c.name, null);
      continue;
    }
    // Re-trie les libres par score desc, puis proximité defaultAddress
    free.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
      return Math.abs(a.address - defaultAddr) - Math.abs(b.address - defaultAddr);
    });
    const pick = free[0];
    usedAddresses.add(pick.address);
    resolvedByName.set(c.name, pick);
    mapMatches.set(c.name, { entry: c, ...pick });
  }

  // Phase 1.c : formatte le résultat pour les MAP/CURVE
  const result = [];
  for (const c of mapEntries) {
    const pick = resolvedByName.get(c.name);
    if (pick) {
      result.push({
        name: c.name, type: c.type, category: c.category,
        description: c.description,
        address: pick.address,
        defaultAddress: parseAddr(c.defaultAddress),
        delta: pick.address - parseAddr(c.defaultAddress),
        addressSource: 'fingerprint',
        matchMode: (pick.xMode || 'strict') + (c.type === 'MAP' ? '/' + (pick.yMode || 'strict') : ''),
        score: pick.score,
        dims: c.dims,
        data: c.data,
        stage1: c.stage1,
      });
    } else {
      const otherCands = (entryCandidates.get(c.name) || []).length;
      result.push({
        name: c.name, type: c.type, category: c.category,
        description: c.description,
        address: parseAddr(c.defaultAddress),
        defaultAddress: parseAddr(c.defaultAddress),
        delta: 0,
        addressSource: 'default-fallback',
        score: 0,
        dims: c.dims,
        data: c.data,
        stage1: c.stage1,
        warning: otherCands
          ? `${otherCands} candidat(s) trouvé(s) mais tous pris par d'autres entries — augmente le debug de désambiguation.`
          : 'Empreinte d\'axes non trouvée dans la ROM — firmware très divergent ou pas un EDC16C34 PSA.',
      });
    }
  }

  // Phase 2 : VALUEs via ancrage sur une MAP trouvée. On accepte l'ancrage
  // uniquement si la valeur lue passe le sanity check (plausible > 0).
  // Sinon on tombe en default-fallback avec warning pour que l'utilisateur
  // sache qu'il faut vérifier manuellement cette VALUE.
  for (const c of damos.characteristics) {
    if (c.type !== 'VALUE') continue;
    const anchorName = c.relocation?.anchorMap;
    const anchor = anchorName ? mapMatches.get(anchorName) : null;
    if (anchor) {
      const found = findValueByAnchor(romBuf, c, anchor);
      if (found && found.plausible) {
        result.push({
          name: c.name, type: c.type, category: c.category,
          description: c.description,
          address: found.address,
          defaultAddress: parseAddr(c.defaultAddress),
          delta: found.delta,
          addressSource: 'anchor',
          anchorMap: anchorName,
          score: found.confidence,
          raw: found.raw,
          physValue: found.physValue,
          data: c.data,
          egrOff: c.egrOff,
          stockRawValue: c.stockRawValue,
          warning: found.confidence < 0.8 ? 'Valeur ancrée mais divergente du stock damos — vérifier manuellement avant de patcher.' : undefined,
        });
        continue;
      }
    }
    // Fallback : defaultAddress
    const defaultAddr = parseAddr(c.defaultAddress);
    const rawAtDefault = readInt(romBuf, defaultAddr, c.data?.dataType || 'SWORD_BE');
    const defaultIsPadding = rawAtDefault === -1 || rawAtDefault === 0xFFFF;
    result.push({
      name: c.name, type: c.type, category: c.category,
      description: c.description,
      address: defaultAddr,
      defaultAddress: defaultAddr,
      delta: 0,
      addressSource: 'default-fallback',
      score: defaultIsPadding ? 0 : 0.3,
      raw: rawAtDefault,
      data: c.data,
      egrOff: c.egrOff,
      stockRawValue: c.stockRawValue,
      warning: defaultIsPadding
        ? 'Adresse par défaut lit du padding (FF FF) — VALUE probablement absente ici. Ne PAS appliquer EGR/popbang sans vérification manuelle.'
        : anchorName
          ? `Ancre ${anchorName} n'a pas donné de lecture plausible, adresse par défaut utilisée (raw=${rawAtDefault}).`
          : 'Pas d\'ancre défini.',
    });
  }

  return result;
}

module.exports = { loadOpenDamos, relocate, findMapByFingerprint, findValueByAnchor };
