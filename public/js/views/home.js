import { api } from '../api.js';

export function renderHome(container, { onOpenProject }) {
  container.innerHTML = `
    <div class="home-view">
      <div class="home-header">
        <h2>Projets de reprogrammation</h2>
        <button class="btn btn-primary" id="btn-new">+ Nouveau projet</button>
      </div>
      <div class="project-grid" id="project-grid">
        <div class="empty-state"><div class="spinner"></div></div>
      </div>
    </div>
  `;

  container.querySelector('#btn-new').addEventListener('click', showNewProjectModal);

  loadProjects();

  async function loadProjects() {
    const grid = container.querySelector('#project-grid');
    try {
      const projects = await api.listProjects();
      renderGrid(projects, grid);
    } catch (e) {
      grid.innerHTML = `<div class="empty-state">Erreur: ${e.message}</div>`;
    }
  }

  function renderGrid(projects, grid) {
    if (!projects.length) {
      grid.innerHTML = `
        <div class="new-project-card" id="card-new">
          <span>＋ Créer un premier projet</span>
        </div>
      `;
      grid.querySelector('#card-new').addEventListener('click', showNewProjectModal);
      return;
    }

    grid.innerHTML = '';

    for (const p of projects) {
      const card = document.createElement('div');
      card.className = 'project-card';
      const date = new Date(p.createdAt).toLocaleDateString('fr-FR');
      card.innerHTML = `
        <div class="ecu-badge">${p.ecu.toUpperCase()}</div>
        <h3>${p.name}</h3>
        <p>${p.description || '<em style="opacity:.5">Pas de description</em>'}</p>
        <div class="meta">Créé le ${date}</div>
        <div class="${p.hasRom ? 'has-rom' : 'no-rom'}" style="margin-top:6px">
          ${p.hasRom ? `✓ ROM: ${p.romName} (${(p.romSize/1024).toFixed(0)} KB)` : '⚠ Pas de ROM importée'}
        </div>
        <div style="margin-top:10px;display:flex;gap:6px">
          <button class="btn btn-primary btn-sm open-btn">Ouvrir</button>
          <button class="btn btn-danger btn-sm del-btn">Supprimer</button>
        </div>
      `;
      card.querySelector('.open-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        onOpenProject(p.id);
      });
      card.querySelector('.del-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Supprimer "${p.name}" ? Cette action est irréversible.`)) return;
        await api.deleteProject(p.id);
        loadProjects();
      });
      card.addEventListener('click', () => onOpenProject(p.id));
      grid.appendChild(card);
    }

    // Add "new" card at end
    const newCard = document.createElement('div');
    newCard.className = 'new-project-card';
    newCard.innerHTML = '<span>＋ Nouveau projet</span>';
    newCard.addEventListener('click', showNewProjectModal);
    grid.appendChild(newCard);
  }

  function showNewProjectModal() {
    const modal = document.getElementById('modal-new-project');
    modal.classList.remove('hidden');
    document.getElementById('np-name').focus();

    const onCancel = () => {
      modal.classList.add('hidden');
      cleanup();
    };
    const onCreate = async () => {
      const name = document.getElementById('np-name').value.trim();
      const ecu = document.getElementById('np-ecu').value;
      const desc = document.getElementById('np-desc').value.trim();
      if (!name) { document.getElementById('np-name').focus(); return; }
      try {
        const project = await api.createProject({ name, ecu, description: desc });
        modal.classList.add('hidden');
        cleanup();
        onOpenProject(project.id);
      } catch (e) {
        alert('Erreur: ' + e.message);
      }
    };

    document.getElementById('np-cancel').addEventListener('click', onCancel);
    document.getElementById('np-create').addEventListener('click', onCreate);
    document.getElementById('np-name').addEventListener('keydown', e => { if (e.key === 'Enter') onCreate(); });
    modal.addEventListener('click', e => { if (e.target === modal) onCancel(); });

    function cleanup() {
      document.getElementById('np-name').value = '';
      document.getElementById('np-desc').value = '';
    }
  }
}
