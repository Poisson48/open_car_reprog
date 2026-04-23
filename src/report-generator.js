// HTML tune report : liste des maps modifiées vs backup original + métadonnées
// projet. Rendu inline (CSS autonome) pour que l'utilisateur fasse Ctrl-P
// → « Enregistrer en PDF » depuis le navigateur, sans dépendance serveur
// supplémentaire (pas de puppeteer).

const { mapsChanged } = require('./map-differ');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatPct(avg) {
  if (!avg || !Number.isFinite(avg.avgRatio)) return '';
  const pct = Math.round(avg.avgRatio * 100);
  return (pct >= 0 ? '+' : '') + pct + ' %';
}

function generateReport({ project, originalBuf, currentBuf, a2l, headHash, branchName }) {
  const { maps } = mapsChanged(originalBuf, currentBuf, a2l?.characteristics || []);
  const generatedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  const metaRows = [
    ['Projet', project.name],
    ['Véhicule', project.vehicle || '—'],
    ['Immat', project.immat || '—'],
    ['Année', project.year || '—'],
    ['ECU', project.ecu?.toUpperCase() || '—'],
    ['ROM', project.romName || '—'],
    ['Branche', branchName || '—'],
    ['HEAD', headHash ? headHash.slice(0, 12) : '—'],
    ['Généré le', generatedAt],
  ];

  const rows = maps.map(m => {
    const addr = '0x' + m.address.toString(16).toUpperCase().padStart(6, '0');
    const delta = formatPct(m.avg);
    const sample = m.sample ? `${m.sample.before} → ${m.sample.after}` : '—';
    return `
      <tr>
        <td class="map-name">${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.type)}</td>
        <td class="mono">${addr}</td>
        <td class="num">${m.cellsChanged}/${m.totalCells}</td>
        <td class="num ${delta.startsWith('+') ? 'up' : delta.startsWith('-') ? 'down' : ''}">${delta}</td>
        <td class="mono">${escapeHtml(sample)}</td>
        <td>${escapeHtml(m.unit || '')}</td>
        <td class="desc">${escapeHtml((m.description || '').slice(0, 120))}</td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Rapport tune — ${escapeHtml(project.name)}</title>
<style>
  @page { size: A4; margin: 1.5cm 1.2cm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #222; font-size: 12px; line-height: 1.45; margin: 0; padding: 20px; }
  h1 { font-size: 22px; margin: 0 0 4px 0; border-bottom: 2px solid #335cff; padding-bottom: 6px; }
  h1 small { font-weight: normal; color: #777; font-size: 13px; }
  h2 { font-size: 15px; margin: 20px 0 8px 0; color: #335cff; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  table.meta td { padding: 3px 8px; vertical-align: top; border: 0; }
  table.meta td:first-child { font-weight: 600; color: #555; width: 120px; }
  table.maps { margin-top: 8px; }
  table.maps th { background: #f3f4f7; text-align: left; padding: 6px 8px; border-bottom: 1px solid #ccc; }
  table.maps td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .mono { font-family: 'SFMono-Regular', 'Menlo', monospace; font-size: 10px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .up { color: #0a7a0a; font-weight: 600; }
  .down { color: #a02020; font-weight: 600; }
  .map-name { font-family: 'SFMono-Regular', 'Menlo', monospace; font-size: 10px; font-weight: 600; }
  .desc { color: #555; font-style: italic; max-width: 260px; }
  .empty { padding: 24px; text-align: center; color: #888; font-style: italic; border: 1px dashed #ccc; }
  .footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; color: #888; }
  .print-btn { position: fixed; top: 16px; right: 16px; padding: 8px 14px; background: #335cff; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-size: 13px; }
  @media print { .print-btn { display: none; } body { padding: 0; } }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Imprimer / PDF</button>

<h1>Rapport tune <small>${escapeHtml(project.name)}</small></h1>

<h2>Informations projet</h2>
<table class="meta">
  ${metaRows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('')}
</table>

<h2>Cartes modifiées (${maps.length}) <small style="font-weight:normal;color:#777">— par rapport à la ROM originale</small></h2>

${maps.length === 0 ? `<div class="empty">Aucune modification détectée entre la ROM actuelle et la ROM originale.</div>` : `
<table class="maps">
  <thead><tr>
    <th>Nom</th><th>Type</th><th>Adresse</th><th>Cellules</th><th>Δ moyen</th><th>Échantillon raw</th><th>Unité</th><th>Description</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
`}

<div class="footer">
  Généré par open-car-reprog · ${escapeHtml(generatedAt)} · Δ moyen = variation relative moyenne sur toutes les cellules modifiées.
</div>
</body>
</html>`;
}

module.exports = { generateReport };
