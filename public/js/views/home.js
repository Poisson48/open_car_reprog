import { api } from '../api.js';

export function renderHome(container, { onOpenProject }) {
  container.innerHTML = `
    <div class="home-view">
      <div class="home-header">
        <h2>Projets</h2>
        <input type="search" class="home-search" id="project-search" placeholder="Rechercher un projet, un véhicule, une immat…">
        <button class="btn btn-primary" id="btn-new">+ Nouveau projet</button>
      </div>
      <div class="project-grid" id="project-grid">
        <div class="empty-state"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  container.querySelector('#btn-new').addEventListener('click', () => showNewProjectModal());

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

    card.innerHTML = `
      <div class="project-card-top">
        <h3>${p.name}</h3>
        ${immatHtml}
      </div>
      <div><span class="ecu-badge">${p.ecu.toUpperCase()}</span></div>
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
    }
    function removeListeners() {
      document.getElementById('np-cancel').replaceWith(document.getElementById('np-cancel').cloneNode(true));
      document.getElementById('np-create').replaceWith(document.getElementById('np-create').cloneNode(true));
      modal.removeEventListener('click', onOverlay);
    }
  }
}

function showEditModal(project, onSaved) {
  const modal = document.getElementById('modal-edit-project');
  modal.classList.remove('hidden');

  document.getElementById('ep-name').value = project.name || '';
  document.getElementById('ep-vehicle').value = project.vehicle || '';
  document.getElementById('ep-immat').value = project.immat || '';
  document.getElementById('ep-year').value = project.year || '';
  document.getElementById('ep-desc').value = project.description || '';
  document.getElementById('ep-name').focus();

  const onCancel = () => { modal.classList.add('hidden'); removeListeners(); };
  const onSave = async () => {
    const name = document.getElementById('ep-name').value.trim();
    if (!name) { document.getElementById('ep-name').focus(); return; }
    try {
      await api.updateProject(project.id, {
        name,
        vehicle: document.getElementById('ep-vehicle').value.trim(),
        immat: document.getElementById('ep-immat').value.trim().toUpperCase(),
        year: document.getElementById('ep-year').value.trim(),
        description: document.getElementById('ep-desc').value.trim()
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

export { showEditModal };
