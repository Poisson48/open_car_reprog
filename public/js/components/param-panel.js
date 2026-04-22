import { api } from '../api.js';

export class ParamPanel {
  constructor(el, { projectId, onSelect }) {
    this.el = el;
    this.projectId = projectId;
    this.onSelect = onSelect;
    this.items = [];
    this.total = 0;
    this.offset = 0;
    this.limit = 100;
    this.search = '';
    this.typeFilter = '';
    this.activeParam = null;

    this._build();
    this._load();
  }

  _build() {
    this.el.innerHTML = `
      <div class="sidebar-header">
        <span>Paramètres A2L</span>
      </div>
      <input type="search" id="param-search" placeholder="Rechercher...">
      <div class="param-type-filter">
        <button data-type="" class="active">Tous</button>
        <button data-type="VALUE">VAL</button>
        <button data-type="CURVE">CUR</button>
        <button data-type="MAP">MAP</button>
      </div>
      <div class="param-list" id="param-list"></div>
      <div class="param-load-more" id="param-more" style="display:none">
        <button id="btn-load-more">Charger plus…</button>
      </div>
    `;

    this.listEl = this.el.querySelector('#param-list');
    this.moreEl = this.el.querySelector('#param-more');

    this.el.querySelector('#param-search').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.offset = 0;
      this.items = [];
      this._load();
    });

    this.el.querySelectorAll('.param-type-filter button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.el.querySelectorAll('.param-type-filter button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.typeFilter = btn.dataset.type;
        this.offset = 0;
        this.items = [];
        this._load();
      });
    });

    this.el.querySelector('#btn-load-more').addEventListener('click', () => this._loadMore());
  }

  async _load() {
    this.listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
      const res = await api.getProjectParams(this.projectId, {
        search: this.search,
        type: this.typeFilter,
        offset: 0,
        limit: this.limit
      });
      this.items = res.items;
      this.total = res.total;
      this.offset = res.items.length;
      this._renderList();
    } catch (e) {
      this.listEl.innerHTML = `<div class="empty-state">Erreur: ${e.message}</div>`;
    }
  }

  async _loadMore() {
    const res = await api.getProjectParams(this.projectId, {
      search: this.search,
      type: this.typeFilter,
      offset: this.offset,
      limit: this.limit
    });
    this.items = this.items.concat(res.items);
    this.offset += res.items.length;
    this.total = res.total;
    this._renderList();
  }

  // Reload from scratch — used after the project's custom A2L is replaced.
  async refresh() {
    this.offset = 0;
    this.items = [];
    await this._load();
  }

  _renderList() {
    const frag = document.createDocumentFragment();

    for (const param of this.items) {
      const div = document.createElement('div');
      div.className = 'param-item' + (this.activeParam === param.name ? ' active' : '');
      div.innerHTML = `
        <span class="param-type-badge badge-${param.type}">${param.type}</span>
        <div class="param-name">${param.name}</div>
        <div class="param-desc">${param.description || ''}</div>
      `;
      div.addEventListener('click', () => this._select(param, div));
      frag.appendChild(div);
    }

    this.listEl.innerHTML = '';
    this.listEl.appendChild(frag);

    if (this.offset < this.total) {
      this.moreEl.style.display = '';
      this.moreEl.querySelector('button').textContent = `Charger plus… (${this.total - this.offset} restants)`;
    } else {
      this.moreEl.style.display = 'none';
    }
  }

  _select(param, el) {
    this.activeParam = param.name;
    this.listEl.querySelectorAll('.param-item').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    if (this.onSelect) this.onSelect(param);
  }

  setActive(name) {
    this.activeParam = name;
    this.listEl.querySelectorAll('.param-item').forEach(e => {
      e.classList.toggle('active', e.querySelector('.param-name')?.textContent === name);
    });
  }
}
