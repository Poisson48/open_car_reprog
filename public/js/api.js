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
  getRom: (id) => req('GET', `/api/projects/${id}/rom`, undefined, true),
  patchBytes: (id, offset, bytes) => req('PATCH', `/api/projects/${id}/rom/bytes`, {
    offset,
    data: btoa(String.fromCharCode(...bytes))
  }),

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
  gitRestore: (id, hash) => req('POST', `/api/projects/${id}/git/restore/${hash}`),

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
