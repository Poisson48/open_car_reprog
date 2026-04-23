import { api } from '../api.js';

// ECU list cache — loaded once at startup
let _ecuList = [];

async function ensureEcuList() {
  if (_ecuList.length) return _ecuList;
  _ecuList = await api.getEcuList();
  return _ecuList;
}

function populateEcuSelect(selectEl, currentId) {
  const byFamily = {};
  for (const e of _ecuList) {
    (byFamily[e.family] = byFamily[e.family] || []).push(e);
  }
  selectEl.innerHTML = '';
  for (const [family, ecus] of Object.entries(byFamily)) {
    const grp = document.createElement('optgroup');
    grp.label = family;
    for (const e of ecus) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.name}  —  ${e.application}`;
      if (e.id === currentId) opt.selected = true;
      grp.appendChild(opt);
    }
    selectEl.appendChild(grp);
  }
}

export async function renderHome(container, { onOpenProject }) {
  container.innerHTML = `
    <div class="home-view">
      <div class="home-header">
        <h2>Projets</h2>
        <input type="search" class="home-search" id="project-search" placeholder="Rechercher un projet, un véhicule, une immat…">
        <button class="btn btn-sm" id="btn-batch-apply" title="Appliquer un template véhicule à plusieurs projets en une passe">⚡ Batch apply…</button>
        <button class="btn btn-primary" id="btn-new">+ Nouveau projet</button>
      </div>
      <div class="project-grid" id="project-grid">
        <div class="empty-state"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  await ensureEcuList();
  populateEcuSelect(document.getElementById('np-ecu'), 'edc16c34');

  container.querySelector('#btn-new').addEventListener('click', () => showNewProjectModal());
  container.querySelector('#btn-batch-apply').addEventListener('click', () => showBatchApplyModal(() => loadProjects()));

  let allProjects = [];

  container.querySelector('#project-search').addEventListener('input', (e) => {
    renderGrid(filterProjects(allProjects, e.target.value));
  });

  loadProjects();

  async function loadProjects() {
    const grid = container.querySelector('#project-grid');
    try {
      allProjects = await api.listProjects();
      const q = container.querySelector('#project-search').value;
      renderGrid(filterProjects(allProjects, q));
    } catch (e) {
      grid.innerHTML = `<div class="empty-state">Erreur: ${e.message}</div>`;
    }
  }

  function filterProjects(projects, query) {
    if (!query.trim()) return projects;
    const q = query.toLowerCase();
    return projects.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.vehicle?.toLowerCase().includes(q) ||
      p.immat?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.ecu?.toLowerCase().includes(q) ||
      p.year?.toString().includes(q)
    );
  }

  function renderGrid(projects) {
    const grid = container.querySelector('#project-grid');
    grid.innerHTML = '';

    if (!projects.length) {
      if (!allProjects.length) {
        const newCard = document.createElement('div');
        newCard.className = 'new-project-card';
        newCard.innerHTML = '<span>＋ Créer un premier projet</span>';
        newCard.addEventListener('click', () => showNewProjectModal());
        grid.appendChild(newCard);
      } else {
        grid.innerHTML = '<div class="empty-state">Aucun projet ne correspond à la recherche.</div>';
      }
      return;
    }

    for (const p of projects) {
      grid.appendChild(buildCard(p));
    }

    const newCard = document.createElement('div');
    newCard.className = 'new-project-card';
    newCard.innerHTML = '<span>＋ Nouveau projet</span>';
    newCard.addEventListener('click', () => showNewProjectModal());
    grid.appendChild(newCard);
  }

  function buildCard(p) {
    const card = document.createElement('div');
    card.className = 'project-card';

    const date = new Date(p.createdAt).toLocaleDateString('fr-FR');
    const immatHtml = p.immat
      ? `<span class="immat-badge">${p.immat.toUpperCase()}</span>`
      : '';
    const vehicleHtml = p.vehicle
      ? `<div class="vehicle-line">${p.vehicle}${p.year ? ' · ' + p.year : ''}</div>`
      : '';
    const descHtml = p.description
      ? `<p>${p.description}</p>`
      : '';

    // Show capability badges
    const ecuEntry = _ecuList.find(e => e.id === p.ecu);
    const capBadges = ecuEntry ? [
      ecuEntry.hasA2l    ? '<span class="cap-badge cap-a2l" title="Paramètres A2L disponibles">A2L</span>' : '',
      ecuEntry.hasStage1 ? '<span class="cap-badge cap-stage1" title="Stage 1 automatique disponible">S1</span>' : '',
    ].filter(Boolean).join('') : '';

    card.innerHTML = `
      <div class="project-card-top">
        <h3>${p.name}</h3>
        ${immatHtml}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <span class="ecu-badge">${p.ecu.toUpperCase()}</span>
        ${capBadges}
      </div>
      ${vehicleHtml}
      ${descHtml}
      <div class="meta">Créé le ${date}</div>
      <div class="${p.hasRom ? 'has-rom' : 'no-rom'}">
        ${p.hasRom
          ? `✓ ROM: ${p.romName} (${(p.romSize / 1024).toFixed(0)} KB)`
          : '⚠ Pas de ROM importée'}
      </div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn btn-primary btn-sm open-btn">Ouvrir</button>
        <button class="btn btn-sm edit-btn">Modifier</button>
        <button class="btn btn-danger btn-sm del-btn">Supprimer</button>
      </div>
    `;

    card.querySelector('.open-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      onOpenProject(p.id);
    });
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showEditModal(p, () => loadProjects());
    });
    card.querySelector('.del-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Supprimer "${p.name}" ? Cette action est irréversible.`)) return;
      await api.deleteProject(p.id);
      allProjects = allProjects.filter(x => x.id !== p.id);
      const q = container.querySelector('#project-search').value;
      renderGrid(filterProjects(allProjects, q));
    });
    card.addEventListener('click', () => onOpenProject(p.id));
    return card;
  }

  function showNewProjectModal() {
    const modal = document.getElementById('modal-new-project');
    modal.classList.remove('hidden');
    document.getElementById('np-name').focus();

    const onCancel = () => { modal.classList.add('hidden'); cleanup(); removeListeners(); };
    const onCreate = async () => {
      const name = document.getElementById('np-name').value.trim();
      if (!name) { document.getElementById('np-name').focus(); return; }
      try {
        const project = await api.createProject({
          name,
          ecu: document.getElementById('np-ecu').value,
          description: document.getElementById('np-desc').value.trim(),
          vehicle: document.getElementById('np-vehicle').value.trim(),
          immat: document.getElementById('np-immat').value.trim().toUpperCase(),
          year: document.getElementById('np-year').value.trim()
        });
        modal.classList.add('hidden');
        cleanup();
        removeListeners();
        onOpenProject(project.id);
      } catch (e) {
        alert('Erreur: ' + e.message);
      }
    };

    const onKey = (e) => { if (e.key === 'Enter') onCreate(); if (e.key === 'Escape') onCancel(); };
    const onOverlay = (e) => { if (e.target === modal) onCancel(); };

    document.getElementById('np-cancel').addEventListener('click', onCancel);
    document.getElementById('np-create').addEventListener('click', onCreate);
    document.getElementById('np-name').addEventListener('keydown', onKey);
    modal.addEventListener('click', onOverlay);

    function cleanup() {
      ['np-name', 'np-vehicle', 'np-immat', 'np-year', 'np-desc'].forEach(id => {
        document.getElementById(id).value = '';
      });
      populateEcuSelect(document.getElementById('np-ecu'), 'edc16c34');
    }
    function removeListeners() {
      document.getElementById('np-cancel').replaceWith(document.getElementById('np-cancel').cloneNode(true));
      document.getElementById('np-create').replaceWith(document.getElementById('np-create').cloneNode(true));
      modal.removeEventListener('click', onOverlay);
    }
  }
}

export async function showEditModal(project, onSaved) {
  await ensureEcuList();

  const modal = document.getElementById('modal-edit-project');
  modal.classList.remove('hidden');

  document.getElementById('ep-name').value = project.name || '';
  document.getElementById('ep-vehicle').value = project.vehicle || '';
  document.getElementById('ep-immat').value = project.immat || '';
  document.getElementById('ep-year').value = project.year || '';
  document.getElementById('ep-desc').value = project.description || '';
  document.getElementById('ep-addr-base').value = project.displayAddressBase
    ? '0x' + project.displayAddressBase.toString(16).toUpperCase()
    : '';
  populateEcuSelect(document.getElementById('ep-ecu'), project.ecu);
  document.getElementById('ep-name').focus();

  const onCancel = () => { modal.classList.add('hidden'); removeListeners(); };
  const onSave = async () => {
    const name = document.getElementById('ep-name').value.trim();
    if (!name) { document.getElementById('ep-name').focus(); return; }
    try {
      const rawBase = document.getElementById('ep-addr-base').value.trim();
      const displayAddressBase = rawBase ? (parseInt(rawBase, 16) >>> 0) : 0;
      await api.updateProject(project.id, {
        name,
        ecu: document.getElementById('ep-ecu').value,
        vehicle: document.getElementById('ep-vehicle').value.trim(),
        immat: document.getElementById('ep-immat').value.trim().toUpperCase(),
        year: document.getElementById('ep-year').value.trim(),
        description: document.getElementById('ep-desc').value.trim(),
        displayAddressBase
      });
      modal.classList.add('hidden');
      removeListeners();
      if (onSaved) onSaved();
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); };
  const onOverlay = (e) => { if (e.target === modal) onCancel(); };

  document.getElementById('ep-cancel').addEventListener('click', onCancel);
  document.getElementById('ep-save').addEventListener('click', onSave);
  document.getElementById('ep-name').addEventListener('keydown', onKey);
  modal.addEventListener('click', onOverlay);

  function removeListeners() {
    modal.removeEventListener('click', onOverlay);
    document.getElementById('ep-cancel').replaceWith(document.getElementById('ep-cancel').cloneNode(true));
    document.getElementById('ep-save').replaceWith(document.getElementById('ep-save').cloneNode(true));
  }
}

async function showBatchApplyModal(onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-batch-apply';
  overlay.innerHTML = `
    <div class="modal" style="min-width:560px;max-width:760px;max-height:85vh;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;margin-bottom:12px">
        <h2 style="flex:1">⚡ Batch apply — appliquer un template à plusieurs projets</h2>
        <button class="btn btn-sm" id="ba-close">✕</button>
      </div>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px">Template véhicule</label>
        <select id="ba-template" style="width:100%;padding:5px 8px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-size:12px"></select>
      </div>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px">Projets cibles</label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <button class="btn btn-sm" id="ba-all">Tout cocher</button>
          <button class="btn btn-sm" id="ba-none">Rien cocher</button>
          <span id="ba-count" style="font-size:11px;color:var(--text-dim)"></span>
        </div>
        <div id="ba-projects" style="max-height:240px;overflow-y:auto;border:1px solid var(--border);padding:6px"></div>
      </div>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:11px;color:var(--text-dim);margin-bottom:4px">Message de commit (optionnel)</label>
        <input type="text" id="ba-msg" placeholder="batch: Stage 1 flotte 2026" style="width:100%;padding:5px 8px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-size:12px">
      </div>
      <div class="modal-actions">
        <button class="btn" id="ba-cancel">Annuler</button>
        <button class="btn btn-primary" id="ba-apply">Appliquer</button>
      </div>
      <div id="ba-results" style="margin-top:12px;max-height:240px;overflow-y:auto;font-size:11px;font-family:monospace"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#ba-close').addEventListener('click', close);
  overlay.querySelector('#ba-cancel').addEventListener('click', close);

  const [templates, projects] = await Promise.all([
    api.listTemplates(),
    api.listProjects()
  ]);

  const selTpl = overlay.querySelector('#ba-template');
  selTpl.innerHTML = templates.map(t => `<option value="${t.id}" data-applies="${(t.appliesTo || []).join(',')}">${t.name} — ${(t.appliesTo || []).join(', ')}</option>`).join('');

  const listEl = overlay.querySelector('#ba-projects');
  const countEl = overlay.querySelector('#ba-count');

  function renderProjectList() {
    const applies = selTpl.selectedOptions[0]?.dataset.applies?.split(',') || [];
    const compatible = projects.filter(p => p.hasRom && applies.includes(p.ecu));
    listEl.innerHTML = compatible.length
      ? compatible.map(p => `
        <label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer">
          <input type="checkbox" class="ba-chk" data-id="${p.id}" checked>
          <span style="flex:1">${p.name} <span style="color:var(--text-dim)">(${p.ecu?.toUpperCase()})</span></span>
          <span style="color:var(--text-dim);font-size:10px">${p.vehicle || ''}</span>
        </label>`).join('')
      : '<div style="padding:12px;color:var(--text-dim);font-style:italic">Aucun projet compatible avec ce template.</div>';
    updateCount();
    listEl.querySelectorAll('.ba-chk').forEach(c => c.addEventListener('change', updateCount));
  }
  function updateCount() {
    const n = listEl.querySelectorAll('.ba-chk:checked').length;
    const total = listEl.querySelectorAll('.ba-chk').length;
    countEl.textContent = `${n} / ${total} projet(s) coché(s)`;
  }
  selTpl.addEventListener('change', renderProjectList);
  overlay.querySelector('#ba-all').addEventListener('click', () => {
    listEl.querySelectorAll('.ba-chk').forEach(c => { c.checked = true; });
    updateCount();
  });
  overlay.querySelector('#ba-none').addEventListener('click', () => {
    listEl.querySelectorAll('.ba-chk').forEach(c => { c.checked = false; });
    updateCount();
  });
  renderProjectList();

  overlay.querySelector('#ba-apply').addEventListener('click', async () => {
    const ids = Array.from(listEl.querySelectorAll('.ba-chk:checked')).map(c => c.dataset.id);
    if (!ids.length) { alert('Aucun projet sélectionné'); return; }
    const tid = selTpl.value;
    const msg = overlay.querySelector('#ba-msg').value.trim();
    const resEl = overlay.querySelector('#ba-results');
    resEl.innerHTML = '<div>En cours…</div>';
    try {
      const r = await fetch(`/api/templates/${tid}/batch-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: ids, commitMessage: msg })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'batch failed');
      resEl.innerHTML = data.outcomes.map(o => {
        const icon = o.ok ? '✓' : '✗';
        const color = o.ok ? 'var(--accent2)' : 'var(--danger)';
        const detail = o.ok
          ? `${o.result.stage1?.length || 0} maps · ${o.result.autoMods?.length || 0} mods · commit ${o.commit ? o.commit.slice(0, 8) : '—'}`
          : o.error;
        return `<div style="color:${color};padding:2px 0">${icon} <strong>${o.name || o.projectId}</strong> — ${detail}</div>`;
      }).join('');
      if (onDone) onDone();
    } catch (e) {
      resEl.innerHTML = `<div style="color:var(--danger)">Erreur : ${e.message}</div>`;
    }
  });
}
