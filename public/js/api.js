const BASE = '';

async function req(method, url, body, isBlob = false) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + url, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  if (isBlob) return r.arrayBuffer();
  if (r.status === 204 || r.headers.get('content-length') === '0') return null;
  return r.json();
}

export const api = {
  // App
  getVersion: () => req('GET', '/api/version'),
  getEcuList: () => req('GET', '/api/ecu'),

  // Projects
  listProjects: () => req('GET', '/api/projects'),
  listTemplates: () => req('GET', '/api/templates'),
  createProject: (data) => req('POST', '/api/projects', data),
  getProject: (id) => req('GET', `/api/projects/${id}`),
  updateProject: (id, data) => req('PATCH', `/api/projects/${id}`, data),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),

  // ROM
  importRom: (id, file) => {
    const fd = new FormData();
    fd.append('rom', file);
    return req('POST', `/api/projects/${id}/rom`, fd);
  },
  getRom: (id, commit) => req('GET', `/api/projects/${id}/rom${commit ? '?commit=' + encodeURIComponent(commit) : ''}`, undefined, true),
  patchBytes: (id, offset, bytes) => req('PATCH', `/api/projects/${id}/rom/bytes`, {
    offset,
    data: btoa(String.fromCharCode(...bytes))
  }),

  // Compare-with-file
  uploadCompareFile: (id, file) => {
    const fd = new FormData();
    fd.append('rom', file);
    return req('POST', `/api/projects/${id}/compare-file`, fd);
  },
  getCompareRom: (id) => req('GET', `/api/projects/${id}/compare-file`, undefined, true),
  clearCompareFile: (id) => req('DELETE', `/api/projects/${id}/compare-file`),

  // Multi-ROM slots
  listRomSlots: (id) => req('GET', `/api/projects/${id}/roms`),
  addRomSlot: (id, file, name) => {
    const fd = new FormData();
    fd.append('rom', file);
    if (name) fd.append('name', name);
    return req('POST', `/api/projects/${id}/roms`, fd);
  },
  deleteRomSlot: (id, slug) => req('DELETE', `/api/projects/${id}/roms/${encodeURIComponent(slug)}`),
  compareFromSlot: (id, slug) => req('POST', `/api/projects/${id}/compare-file-from-slot/${encodeURIComponent(slug)}`),

  // Per-map notes
  getMapNotes: (id) => req('GET', `/api/projects/${id}/notes`),
  setMapNote: (id, mapName, text) => req('PATCH', `/api/projects/${id}/notes/${encodeURIComponent(mapName)}`, { text }),

  // Project-scoped A2L (custom per project or ECU default)
  getProjectParams: (id, opts = {}) => {
    const p = new URLSearchParams();
    if (opts.search) p.set('search', opts.search);
    if (opts.type) p.set('type', opts.type);
    if (opts.offset) p.set('offset', opts.offset);
    if (opts.limit) p.set('limit', opts.limit);
    return req('GET', `/api/projects/${id}/parameters?${p}`);
  },
  getProjectParam: (id, name) => req('GET', `/api/projects/${id}/parameters/${encodeURIComponent(name)}`),
  uploadA2l: (id, file) => {
    const fd = new FormData();
    fd.append('a2l', file);
    return req('POST', `/api/projects/${id}/a2l`, fd);
  },
  getA2lInfo: (id) => req('GET', `/api/projects/${id}/a2l/info`),
  deleteA2l: (id) => req('DELETE', `/api/projects/${id}/a2l`),

  // WinOLS
  importWinols: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return req('POST', `/api/projects/${id}/import-winols`, fd);
  },

  // Git
  gitCommit: (id, message) => req('POST', `/api/projects/${id}/git/commit`, { message }),
  gitLog: (id) => req('GET', `/api/projects/${id}/git/log`),
  gitDiff: (id, hash) => req('GET', `/api/projects/${id}/git/diff/${hash}`),
  gitDiffMaps: (id, hash) => req('GET', `/api/projects/${id}/git/diff-maps/${hash}`),
  gitDiffMapsHead: (id) => req('GET', `/api/projects/${id}/git/diff-maps-head`),
  gitRestore: (id, hash) => req('POST', `/api/projects/${id}/git/restore/${hash}`),
  gitBranches: (id) => req('GET', `/api/projects/${id}/git/branches`),
  gitCreateBranch: (id, name) => req('POST', `/api/projects/${id}/git/branches`, { name }),
  gitSwitchBranch: (id, name) => req('PUT', `/api/projects/${id}/git/branches/${encodeURIComponent(name)}`),
  gitDeleteBranch: (id, name) => req('DELETE', `/api/projects/${id}/git/branches/${encodeURIComponent(name)}`),

  // ECU Parameters
  getParams: (id, opts = {}) => {
    const p = new URLSearchParams();
    if (opts.search) p.set('search', opts.search);
    if (opts.type) p.set('type', opts.type);
    if (opts.offset) p.set('offset', opts.offset);
    if (opts.limit) p.set('limit', opts.limit);
    return req('GET', `/api/ecu/${id}/parameters?${p}`);
  },
  getParam: (ecu, name) => req('GET', `/api/ecu/${ecu}/parameters/${encodeURIComponent(name)}`)
};
