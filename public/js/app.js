import { renderHome } from './views/home.js';
import { renderProject } from './views/project.js';
import { api } from './api.js';

const container = document.getElementById('view-container');

// Load and display app version
api.getVersion().then(({ version }) => {
  const el = document.getElementById('version-badge');
  if (el) el.textContent = `v${version}`;
}).catch(() => {});

function navigate(hash) {
  const [, view, id] = hash.split('/');
  document.getElementById('breadcrumb').textContent = '';

  if (view === 'project' && id) {
    renderProject(container, {
      projectId: id,
      onBack: () => navigate('#/')
    });
  } else {
    renderHome(container, {
      onOpenProject: (id) => navigate(`#/project/${id}`)
    });
  }
}

document.getElementById('btn-home').addEventListener('click', () => {
  window.location.hash = '#/';
});

window.addEventListener('hashchange', () => navigate(window.location.hash));
navigate(window.location.hash || '#/');
