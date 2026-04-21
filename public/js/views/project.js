import { api } from '../api.js';
import { HexEditor } from '../components/hex-editor.js';
import { ParamPanel } from '../components/param-panel.js';
import { MapEditor } from '../components/map-editor.js';
import { GitPanel } from '../components/git-panel.js';
import { AutoMods } from '../components/auto-mods.js';
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
    document.getElementById('breadcrumb').textContent = `→ ${parts.join(' · ')} (${project.ecu.toUpperCase()})`;
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

    const wrap = document.getElementById('hex-wrap');
    wrap.innerHTML = '';
    hexEditor = new HexEditor(wrap);
    hexEditor.load(buf);

    hexEditor.onByteChange = (offset, value) => {
      setStatus(`Modifié: 0x${offset.toString(16).toUpperCase()} = 0x${value.toString(16).toUpperCase().padStart(2, '0')} | ${hexEditor.modified.size} byte(s) non sauvegardé(s)`);
    };

    // Initialize map editor
    const mapPane = document.getElementById('map-editor-pane');
    mapEditor = new MapEditor(mapPane, {
      onBytesChange: (offset, bytes) => {
        // Sync changes to hex editor
        hexEditor.patchBytes(offset, bytes);
        setStatus(`Carte modifiée à 0x${offset.toString(16).toUpperCase()} | ${hexEditor.modified.size} byte(s) non sauvegardé(s)`);
      }
    });

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
  }

  function gotoAddress() {
    if (!hexEditor) return;
    const raw = document.getElementById('goto-addr')?.value.trim();
    if (!raw) return;
    const addr = raw.startsWith('0x') || raw.startsWith('0X') ? parseInt(raw, 16) : parseInt(raw, 16);
    if (!isNaN(addr)) hexEditor.scrollToOffset(addr);
  }

  // ── Param Panel ─────────────────────────────────────────────────────────────

  const paramPanel = new ParamPanel(document.getElementById('param-sidebar'), {
    ecu: project.ecu,
    onSelect: async (param) => {
      currentParam = param;
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
        // Fetch full param details
        try {
          const full = await api.getParam(project.ecu, param.name);
          mapEditor.show(full, romData);
        } catch (e) {
          mapEditor.show(param, romData);
        }
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
    onMapClick: async (name) => {
      try {
        const full = await api.getParam(project.ecu, name);
        if (mapEditor && romData) mapEditor.show(full, romData);
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
        setStatus(`Ouvert depuis le diff git : ${name} | 0x${full.address.toString(16).toUpperCase()}`);
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
