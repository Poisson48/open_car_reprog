import { api } from '../api.js';
import { HexEditor } from '../components/hex-editor.js';
import { ParamPanel } from '../components/param-panel.js';
import { MapEditor } from '../components/map-editor.js';
import { GitPanel } from '../components/git-panel.js';
import { AutoMods } from '../components/auto-mods.js';
import { MapFinder } from '../components/map-finder.js';
import { BranchSwitcher } from '../components/branch-switcher.js';
import { showEditModal } from './home.js';

export async function renderProject(container, { projectId, onBack }) {
  // Load project metadata
  let project;
  try {
    project = await api.getProject(projectId);
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Projet introuvable: ${e.message}</div>`;
    return;
  }

  function updateBreadcrumb() {
    const parts = [project.name];
    if (project.vehicle) parts.push(project.vehicle);
    if (project.immat) parts.push(project.immat.toUpperCase());
    const ecuLabel = project.customA2lName
      ? `${project.ecu.toUpperCase()} · A2L: ${project.customA2lName}`
      : project.ecu.toUpperCase();
    document.getElementById('breadcrumb').textContent = `→ ${parts.join(' · ')} (${ecuLabel})`;
  }
  updateBreadcrumb();

  // Render layout
  container.innerHTML = `
    <div class="workspace" style="flex:1;overflow:hidden">

      <!-- Param sidebar -->
      <div class="sidebar" id="param-sidebar"></div>
      <div class="resizer" id="resizer-left"></div>

      <!-- Main: toolbar + hex editor + map editor -->
      <div class="main-content">
        <div class="toolbar">
          <label>Aller à</label>
          <input type="text" id="goto-addr" placeholder="0x1E9DD4">
          <button class="btn btn-sm" id="btn-goto">↵ Go</button>
          <button class="btn btn-sm" id="btn-edit-project" title="Modifier les infos du projet">✎ Modifier</button>
          <button class="btn btn-sm" id="btn-auto-mods" title="Modifications automatiques EDC16C34" style="color:var(--warn);border-color:var(--warn)" ${!project.hasRom ? 'disabled' : ''}>⚡ Auto-mods</button>
          <button class="btn btn-sm" id="btn-map-finder" title="Détecter automatiquement les cartographies dans la ROM" ${!project.hasRom ? 'disabled' : ''}>🔍 Auto-find</button>
          <button class="btn btn-sm" id="btn-a2l-upload" title="Charger un fichier A2L/DAMOS personnalisé pour ce projet">📑 A2L</button>
          <input type="file" id="a2l-file-input" accept=".a2l,.A2L" style="display:none">
          <span id="damos-match-badge" title="Correspondance damos ↔ ROM" style="display:none"></span>
          <span id="branch-switcher-slot"></span>
          <div style="flex:1"></div>
          ${!project.hasRom ? `
            <button class="btn btn-primary btn-sm" id="btn-import-rom">📂 Importer ROM</button>
            <button class="btn btn-sm" id="btn-import-ols">WinOLS (.ols/.bin/.hex)</button>
          ` : `
            <button class="btn btn-sm" id="btn-import-replace">📂 Remplacer ROM</button>
            <button class="btn btn-sm" id="btn-import-ols">WinOLS import</button>
            <a class="btn btn-sm" id="btn-dl-rom" download="${project.romName || 'rom.bin'}" href="/api/projects/${projectId}/rom">⬇ Télécharger ROM</a>
            <a class="btn btn-sm" id="btn-dl-backup" href="/api/projects/${projectId}/rom/backup" download="rom.original.bin">⬇ ROM originale</a>
          `}
        </div>

        <div class="editor-area">
          <div class="hex-editor-wrap" id="hex-wrap">
            ${!project.hasRom ? `
              <div class="empty-state" style="padding:48px">
                <p style="margin-bottom:16px">Aucune ROM importée pour ce projet.</p>
                <label class="drop-zone" id="drop-zone" for="rom-file-input">
                  Glissez-déposez un fichier .bin ici, ou cliquez pour sélectionner
                </label>
                <input type="file" id="rom-file-input" accept=".bin,.BIN,.hex,.ols" style="display:none">
              </div>
            ` : ''}
          </div>
          <div class="map-editor-pane" id="map-editor-pane"></div>
        </div>
      </div>

      <div class="resizer" id="resizer-right"></div>

      <!-- Git panel -->
      <div class="git-panel" id="git-panel"></div>
    </div>
  `;

  // State
  let romData = null;
  let hexEditor = null;
  let mapEditor = null;
  let currentParam = null;

  // Undo stack: each entry is an array of { offset, newBytes, prevBytes }.
  // Edits that land in the same synchronous tick (e.g. ±% on a cell selection)
  // are grouped into one entry so a single Ctrl-Z undoes the whole batch.
  const undoStack = [];
  let undoPointer = 0; // next-to-undo == stack length when no redo is pending
  let editCollector = null;
  const MAX_UNDO = 200;

  // In-memory clipboard for map-to-map copy/paste (survives map switches).
  let mapClipboard = null;

  // Per-map notes cache (populated on ROM load, synced to server on change).
  let mapNotes = {};

  function recordEdit(offset, newBytes, prevBytes) {
    if (!editCollector) {
      editCollector = [];
      queueMicrotask(() => {
        if (editCollector && editCollector.length) {
          // Drop any forward history if the user was mid-redo
          undoStack.length = undoPointer;
          undoStack.push(editCollector);
          if (undoStack.length > MAX_UNDO) undoStack.shift();
          undoPointer = undoStack.length;
        }
        editCollector = null;
      });
    }
    editCollector.push({ offset, newBytes: Array.from(newBytes), prevBytes: Array.from(prevBytes || []) });
  }

  function applyPatches(patches) {
    // Write directly via hexEditor.patchBytes which also updates romData (shared
    // buffer) and re-renders the hex view — and crucially fires no callback,
    // so this does not re-enter the undo stack.
    for (const p of patches) hexEditor.patchBytes(p.offset, p.bytes);
    // If the map editor is currently showing a param whose memory range was
    // touched, re-render it to reflect the new bytes.
    if (mapEditor && currentParam && romData) {
      const mapStart = currentParam.address;
      const mapEnd = mapStart + estimateParamSize(currentParam);
      const touches = patches.some(p => p.offset < mapEnd && (p.offset + p.bytes.length) > mapStart);
      if (touches) mapEditor.show(currentParam, romData);
    }
  }

  function undo() {
    if (undoPointer === 0) return false;
    undoPointer--;
    const entry = undoStack[undoPointer];
    applyPatches(entry.map(e => ({ offset: e.offset, bytes: e.prevBytes })));
    setStatus(`↶ Undo (${entry.length} octet(s)) · ${undoPointer}/${undoStack.length}`);
    return true;
  }

  function redo() {
    if (undoPointer >= undoStack.length) return false;
    const entry = undoStack[undoPointer];
    undoPointer++;
    applyPatches(entry.map(e => ({ offset: e.offset, bytes: e.newBytes })));
    setStatus(`↷ Redo (${entry.length} octet(s)) · ${undoPointer}/${undoStack.length}`);
    return true;
  }

  function resetUndo() {
    undoStack.length = 0;
    undoPointer = 0;
    editCollector = null;
  }

  function estimateParamSize(p) {
    const valSz = p.byteSize || 2;
    if (p.type === 'VALUE') return valSz;
    const xPts = p.axisDefs?.[0]?.maxAxisPoints || 1;
    const yPts = p.axisDefs?.[1]?.maxAxisPoints || 1;
    // Over-approximate: header + both axes + data grid.
    return 4 + xPts * 2 + yPts * 2 + xPts * yPts * valSz;
  }

  const setStatus = (msg) => {
    const sb = document.getElementById('status-bar');
    if (sb) sb.innerHTML = `<span>${msg}</span>`;
  };

  // ── ROM Import ──────────────────────────────────────────────────────────────

  async function importRom(file, isWinols = false) {
    setStatus(`Import en cours: ${file.name}…`);
    try {
      const meta = isWinols
        ? await api.importWinols(projectId, file)
        : await api.importRom(projectId, file);
      project = meta;
      await loadRom();
      setStatus(`ROM importée: ${meta.romName} (${(meta.romSize / 1024).toFixed(0)} KB) — sauvegarde originale créée`);
    } catch (e) {
      alert('Import échoué: ' + e.message);
      setStatus('Erreur import');
    }
  }

  async function loadRom() {
    const buf = await api.getRom(projectId);
    romData = new Uint8Array(buf);

    // Refresh the damos-match badge whenever a ROM is (re)loaded. Runs in
    // background so it doesn't block the hex editor. If it fails silently
    // the badge stays hidden — not worth breaking the UI over this.
    fetch(`/api/projects/${projectId}/a2l/match`)
      .then(r => r.json())
      .then(data => updateDamosMatchBadge(data))
      .catch(() => {});

    const wrap = document.getElementById('hex-wrap');
    wrap.innerHTML = '';
    hexEditor = new HexEditor(wrap);
    hexEditor.load(buf);
    if (project.displayAddressBase) hexEditor.setDisplayBase(project.displayAddressBase);

    hexEditor.onByteChange = (offset, value, prev) => {
      recordEdit(offset, [value], prev === undefined ? [] : [prev]);
      setStatus(`Modifié: 0x${offset.toString(16).toUpperCase()} = 0x${value.toString(16).toUpperCase().padStart(2, '0')} | ${hexEditor.modified.size} byte(s) non sauvegardé(s)`);
    };

    // Load per-map notes once; the map editor reads/writes through the cached
    // object and syncs to the server on change.
    mapNotes = await api.getMapNotes(projectId).catch(() => ({}));

    // Initialize map editor
    const mapPane = document.getElementById('map-editor-pane');
    mapEditor = new MapEditor(mapPane, {
      onBytesChange: (offset, bytes, prevBytes) => {
        // Sync changes to hex editor
        hexEditor.patchBytes(offset, bytes);
        recordEdit(offset, bytes, prevBytes || []);
        setStatus(`Carte modifiée à 0x${offset.toString(16).toUpperCase()} | ${hexEditor.modified.size} byte(s) non sauvegardé(s)`);
      },
      getNote: (mapName) => mapNotes[mapName] || '',
      setNote: async (mapName, text) => {
        const trimmed = (text || '').trim();
        if (trimmed) mapNotes[mapName] = text;
        else delete mapNotes[mapName];
        await api.setMapNote(projectId, mapName, text);
      }
    });

    // Any ROM reload starts from a clean slate for undo.
    resetUndo();

    // Re-wire file drop on hex area
    bindFileDrop(wrap);
    rebindToolbar();
  }

  // ── File Drop ───────────────────────────────────────────────────────────────

  function bindFileDrop(target) {
    target.addEventListener('dragover', e => { e.preventDefault(); target.classList.add('drag-over'); });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', e => {
      e.preventDefault();
      target.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) importRom(file, /\.ols$/i.test(file.name));
    });
  }

  // Damos-match badge : colore + message selon score serveur. Click → modal
  // avec explication détaillée. Silent si pas de ROM / pas d'A2L.
  function updateDamosMatchBadge(data) {
    const badge = document.getElementById('damos-match-badge');
    if (!badge) return;
    if (!data || !data.hasRom || !data.hasA2l || data.score === null) {
      badge.style.display = 'none';
      return;
    }
    const { score, status, message } = data;
    const colors = {
      match:    { bg: '#1e3a1e', fg: '#4ade80', icon: '🟢', label: 'Damos OK' },
      partial:  { bg: '#3a2e1e', fg: '#fbbf24', icon: '🟠', label: 'Damos partiel' },
      mismatch: { bg: '#3a1e1e', fg: '#f87171', icon: '🔴', label: 'Damos mismatch' },
    };
    const c = colors[status] || colors.partial;
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '4px';
    badge.style.padding = '2px 8px';
    badge.style.marginLeft = '4px';
    badge.style.borderRadius = '3px';
    badge.style.fontSize = '11px';
    badge.style.fontWeight = '500';
    badge.style.cursor = 'pointer';
    badge.style.background = c.bg;
    badge.style.color = c.fg;
    badge.style.border = `1px solid ${c.fg}40`;
    badge.innerHTML = `${c.icon} ${c.label} (${score}%)`;
    badge.title = message;
    badge.onclick = () => {
      alert(
        `${c.label} — ${score}% de correspondance\n\n${message}\n\n` +
        `Détails : ${data.plausible}/${data.sampled} entries lisibles, ${data.padding} en padding (FFFF), ${data.implausible} invalides.\n` +
        `Damos source : ${data.a2lSource === 'custom' ? 'custom uploadé' : `catalog ECU ${data.ecu}`}\n\n` +
        (status === 'mismatch'
          ? '→ Stage 1 utilisera open_damos (fingerprint auto) plutôt que les adresses A2L pour cette ROM.'
          : status === 'partial'
            ? '→ Stage 1 vérifiera chaque adresse A2L ; fallback open_damos si une map ne matche pas.'
            : '→ Stage 1 utilise les adresses A2L directement.')
      );
    };
  }

  // ── Edit project button (always visible) ────────────────────────────────────

  document.getElementById('btn-edit-project')?.addEventListener('click', () => {
    showEditModal(project, async () => {
      project = await api.getProject(projectId);
      updateBreadcrumb();
    });
  });

  if (!project.hasRom) {
    const dz = document.getElementById('drop-zone');
    const fi = document.getElementById('rom-file-input');
    if (dz) {
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) importRom(file, /\.ols$/i.test(file.name));
      });
    }
    if (fi) fi.addEventListener('change', e => { const f = e.target.files[0]; if (f) importRom(f, /\.ols$/i.test(f.name)); });
    document.getElementById('btn-import-rom')?.addEventListener('click', () => fi?.click());
    document.getElementById('btn-import-ols')?.addEventListener('click', () => fi?.click());
  } else {
    await loadRom();
  }

  // ── Toolbar rebind (after ROM load) ─────────────────────────────────────────

  function rebindToolbar() {
    document.getElementById('btn-goto')?.addEventListener('click', gotoAddress);
    document.getElementById('goto-addr')?.addEventListener('keydown', e => { if (e.key === 'Enter') gotoAddress(); });
    document.getElementById('btn-auto-mods')?.addEventListener('click', () => {
      if (!romData) return;
      const am = new AutoMods({
        ecu: project.ecu,
        romData,
        projectId,
        onBytesChange: (offset, bytes) => {
          if (offset === 0 && bytes.length > 2) {
            // Full ROM reload (Stage 1 / Pop & Bang server-side write)
            const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            hexEditor?.load(ab);
            setStatus(`Auto-mod: ROM rechargée (${bytes.length} bytes)`);
          } else {
            hexEditor?.patchBytes(offset, bytes);
            setStatus(`Auto-mod: 0x${offset.toString(16).toUpperCase()} modifié (${bytes.length} byte(s))`);
          }
        }
      });
      am.open();
    });

    document.getElementById('btn-map-finder')?.addEventListener('click', () => {
      if (!romData) return;
      const mf = new MapFinder({
        projectId,
        onGoto: ({ address, blockSize, name }) => {
          if (!hexEditor) return;
          hexEditor.scrollToOffset(address);
          hexEditor.setHighlights([{
            start: address,
            end: address + blockSize,
            color: 'rgba(255, 170, 40, 0.45)',
            label: name || `Auto-found ${blockSize}B`
          }]);
          setStatus(`Map auto-detect: 0x${address.toString(16).toUpperCase()} (${blockSize} bytes)`);
        }
      });
      mf.open();
    });

    document.getElementById('btn-import-replace')?.addEventListener('click', () => {
      const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.bin,.BIN,.hex,.ols';
      fi.addEventListener('change', e => { const f = e.target.files[0]; if (f) importRom(f); });
      fi.click();
    });
    document.getElementById('btn-import-ols')?.addEventListener('click', () => {
      const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.bin,.BIN,.hex,.ols';
      fi.addEventListener('change', e => { const f = e.target.files[0]; if (f) importRom(f, true); });
      fi.click();
    });

    const a2lInput = document.getElementById('a2l-file-input');
    document.getElementById('btn-a2l-upload')?.addEventListener('click', () => a2lInput?.click());
    a2lInput?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setStatus(`Import A2L: ${f.name}…`);
      try {
        const info = await api.uploadA2l(projectId, f);
        project = await api.getProject(projectId);
        updateBreadcrumb();
        await paramPanel.refresh();
        setStatus(`A2L "${info.fileName}" chargé — ${info.characteristicsCount} caractéristiques`);
      } catch (err) {
        alert('Import A2L échoué : ' + err.message);
        setStatus('Erreur import A2L');
      }
      a2lInput.value = '';
    });
  }

  function gotoAddress() {
    if (!hexEditor) return;
    const raw = document.getElementById('goto-addr')?.value.trim();
    if (!raw) return;
    const addr = parseInt(raw, 16);
    if (!isNaN(addr)) {
      // The input uses whatever address system the hex editor displays, so
      // subtract the display base to get a file offset.
      const fileOff = (addr - (hexEditor.displayBase || 0)) >>> 0;
      hexEditor.scrollToOffset(fileOff);
    }
  }

  // ── Param Panel ─────────────────────────────────────────────────────────────

  const paramPanel = new ParamPanel(document.getElementById('param-sidebar'), {
    projectId,
    onSelect: async (param) => {
      if (hexEditor) {
        const sz = param.byteSize || 2;
        hexEditor.scrollToOffset(param.address);
        hexEditor.setHighlights([{
          start: param.address,
          end: param.address + sz * ((param.axisDefs?.[0]?.maxAxisPoints || 1) * (param.axisDefs?.[1]?.maxAxisPoints || 1) + (param.axisDefs?.length || 0) * (param.axisDefs?.[0]?.maxAxisPoints || 0)),
          color: 'rgba(83,52,131,0.6)',
          label: param.name
        }]);
      }
      if (mapEditor && romData) {
        // Fetch full param details (axisDefs, record layout) — the summary from
        // the sidebar is not enough to render axes correctly, and undo/redo
        // needs the full param to re-render after a revert.
        try {
          const full = await api.getProjectParam(projectId, param.name);
          currentParam = full;
          mapEditor.show(full, romData);
        } catch (e) {
          currentParam = param;
          mapEditor.show(param, romData);
        }
      } else {
        currentParam = param;
      }
      setStatus(`Paramètre: ${param.name} | 0x${param.address.toString(16).toUpperCase()} | ${param.type} | ${param.dataType || ''} | ${param.unit || ''}`);
    }
  });

  // ── Git Panel ────────────────────────────────────────────────────────────────

  const gitPanel = new GitPanel(document.getElementById('git-panel'), {
    projectId,
    onRestore: async () => {
      if (project.hasRom) await loadRom();
    },
    onMapClick: async (name, commit) => {
      try {
        const full = await api.getProjectParam(projectId, name);
        currentParam = full;
        let compareRom = null;
        let compareLabel = null;
        if (commit?.compareFile) {
          // "Comparer avec un fichier" mode: the reference ROM is the one the
          // user just uploaded, kept in server memory under the project id.
          try {
            const otherBuf = await api.getCompareRom(projectId);
            compareRom = new Uint8Array(otherBuf);
            compareLabel = `fichier ${commit.fileName}`;
          } catch {}
        } else if (commit?.parents?.[0]) {
          // Show deltas vs the PARENT of the clicked commit — i.e. what this
          // commit changed on this map compared to its previous state.
          try {
            const parentBuf = await api.getRom(projectId, commit.parents[0]);
            compareRom = new Uint8Array(parentBuf);
            const label = commit.message.length > 40 ? commit.message.slice(0, 40) + '…' : commit.message;
            compareLabel = `avant "${label}"`;
          } catch {}
        }
        if (mapEditor && romData) {
          if (compareRom) {
            mapEditor.showCompare(full, romData, compareRom, compareLabel);
          } else {
            mapEditor.show(full, romData);
          }
        }
        if (hexEditor) {
          const sz = full.byteSize || 2;
          const xPts = full.axisDefs?.[0]?.maxAxisPoints || 1;
          const yPts = full.axisDefs?.[1]?.maxAxisPoints || 1;
          hexEditor.scrollToOffset(full.address);
          hexEditor.setHighlights([{
            start: full.address,
            end: full.address + 4 + xPts * 2 + yPts * 2 + xPts * yPts * sz,
            color: 'rgba(83,52,131,0.6)',
            label: full.name
          }]);
        }
        setStatus(compareRom
          ? `Compare : ${name} vs ${compareLabel}`
          : `Ouvert depuis le diff git : ${name} | 0x${full.address.toString(16).toUpperCase()}`);
      } catch (e) {
        setStatus(`Erreur chargement ${name}: ${e.message}`);
      }
    }
  });

  // ── Branch switcher ──────────────────────────────────────────────────────────

  const branchSwitcher = new BranchSwitcher(document.getElementById('branch-switcher-slot'), {
    projectId,
    hasDirtyEditor: () => !!hexEditor?.modified?.size,
    onSwitch: async (name, info) => {
      if (hexEditor) hexEditor.clearModified?.();
      if (project.hasRom) await loadRom();
      await gitPanel.refresh();
      const suffix = info?.autoCommitted ? ' (changements auto-commités avant switch)' : info?.created ? ' (nouvelle branche)' : '';
      setStatus(`Branche : ${name}${suffix}`);
    }
  });

  // ── Commit shortcut ──────────────────────────────────────────────────────────

  document.addEventListener('keydown', async (e) => {
    // Undo / redo at ROM level. If the focus is inside a map-cell <input>
    // that still holds un-committed text, let the browser's native Ctrl-Z
    // handle text editing — otherwise the ROM-level undo fires.
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      const inInput = document.activeElement?.tagName === 'INPUT'
        && document.activeElement?.dataset?.xi !== undefined;
      if (inInput) return; // native undo on the input's text
      if (!hexEditor) return;
      e.preventDefault();
      undo();
      return;
    }
    if (ctrl && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
      if (!hexEditor) return;
      e.preventDefault();
      redo();
      return;
    }

    // Copy / paste of map selections (even across maps). If the map editor
    // has a live cell selection we always hijack Ctrl-C/V, even when focus is
    // inside a cell input — the user's intent after selecting cells is clearly
    // to copy the values, not the text inside the last-clicked input.
    if (ctrl && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      const clip = mapEditor?.getSelectionValues?.();
      if (!clip) return;
      mapClipboard = clip;
      e.preventDefault();
      setStatus(`📋 Copié : ${clip.w}×${clip.h} cellule(s)`);
      return;
    }
    if (ctrl && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      if (!mapEditor?.pasteValues || !mapClipboard) return;
      if (!mapEditor.getSelectionValues?.()) return; // needs a target selection
      e.preventDefault();
      const n = mapEditor.pasteValues(mapClipboard);
      if (n > 0) setStatus(`📋 Collé : ${n} cellule(s) depuis ${mapClipboard.w}×${mapClipboard.h}`);
      else setStatus('📋 Rien à coller : sélectionnez au moins une cellule dans la carte cible');
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!hexEditor || !hexEditor.modified.size) return;

      // Patch all modified bytes to server
      const mods = hexEditor.getModifiedBytes();
      if (!mods.length) return;

      // Group consecutive bytes
      const patches = [];
      let cur = [mods[0]];
      for (let i = 1; i < mods.length; i++) {
        if (mods[i].offset === cur[cur.length-1].offset + 1) cur.push(mods[i]);
        else { patches.push(cur); cur = [mods[i]]; }
      }
      patches.push(cur);

      setStatus('Sauvegarde des modifications…');
      for (const patch of patches) {
        await api.patchBytes(projectId, patch[0].offset, patch.map(m => m.value));
      }
      hexEditor.clearModified();
      setStatus('Modifications sauvegardées — Ouvrez le panel Git pour committer');
    }
  });

  // ── Resizer ──────────────────────────────────────────────────────────────────

  makeResizer('resizer-left', 'param-sidebar', 'width', 180, 500);
  makeResizer('resizer-right', 'git-panel', 'width', 200, 500, true);
}

function makeResizer(resizerId, targetId, prop, min, max, fromRight = false) {
  const resizer = document.getElementById(resizerId);
  const target = document.getElementById(targetId);
  if (!resizer || !target) return;

  let startX, startSize;
  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startSize = target.getBoundingClientRect().width;
    const onMove = (e) => {
      const dx = fromRight ? startX - e.clientX : e.clientX - startX;
      const newSize = Math.max(min, Math.min(max, startSize + dx));
      target.style.width = newSize + 'px';
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}
