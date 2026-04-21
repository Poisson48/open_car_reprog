import { api } from '../api.js';

export class BranchSwitcher {
  constructor(el, { projectId, onSwitch, hasDirtyEditor }) {
    this.el = el;
    this.projectId = projectId;
    this.onSwitch = onSwitch;
    this.hasDirtyEditor = hasDirtyEditor;
    this.current = null;
    this.all = [];
    this.popover = null;
    this._build();
    this.refresh();
  }

  _build() {
    this.el.innerHTML = `
      <button class="btn btn-sm branch-btn" id="branch-btn" title="Branche git">
        <span class="branch-icon">⎇</span>
        <span class="branch-name" id="branch-name">…</span>
        <span class="branch-caret">▾</span>
      </button>
    `;
    this.btn = this.el.querySelector('#branch-btn');
    this.nameEl = this.el.querySelector('#branch-name');
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.popover ? this._closePopover() : this._openPopover();
    });
  }

  async refresh() {
    try {
      const { current, all } = await api.gitBranches(this.projectId);
      this.current = current;
      this.all = all;
      this.nameEl.textContent = current || '(aucune)';
    } catch {
      this.nameEl.textContent = 'erreur';
    }
  }

  _openPopover() {
    const rect = this.btn.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'branch-popover';
    pop.style.top = (rect.bottom + 4) + 'px';
    pop.style.left = Math.max(8, rect.left) + 'px';

    let html = '<div class="branch-pop-header">Branches</div><ul class="branch-list">';
    for (const b of this.all) {
      const isCurrent = b === this.current;
      html += `<li class="branch-item${isCurrent ? ' current' : ''}" data-name="${b}">
        <span class="branch-marker">${isCurrent ? '●' : ''}</span>
        <span class="branch-label">${b}</span>
        ${!isCurrent ? `<button class="branch-del" data-name="${b}" title="Supprimer">🗑</button>` : ''}
      </li>`;
    }
    html += '</ul>';
    html += `<div class="branch-new">
      <input type="text" id="branch-new-name" placeholder="nouvelle branche depuis ${this.current || '…'}">
      <button class="btn btn-sm btn-success" id="branch-new-btn">+</button>
    </div>`;
    pop.innerHTML = html;
    document.body.appendChild(pop);
    this.popover = pop;

    pop.querySelectorAll('.branch-item').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.classList.contains('branch-del')) return;
        const name = li.dataset.name;
        if (name !== this.current) this._switch(name);
      });
    });
    pop.querySelectorAll('.branch-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        if (!confirm(`Supprimer la branche "${name}" ?\nL'historique de cette branche sera perdu.`)) return;
        try {
          await api.gitDeleteBranch(this.projectId, name);
          await this.refresh();
          this._closePopover();
          this._openPopover();
        } catch (err) {
          alert('Suppression échouée : ' + err.message);
        }
      });
    });

    const input = pop.querySelector('#branch-new-name');
    const btn = pop.querySelector('#branch-new-btn');
    const create = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        await api.gitCreateBranch(this.projectId, name);
        await this.refresh();
        this._closePopover();
        if (this.onSwitch) this.onSwitch(name, { created: true });
      } catch (err) {
        alert('Création échouée : ' + err.message);
      }
    };
    btn.addEventListener('click', create);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
    input.focus();

    setTimeout(() => {
      this._outsideHandler = (e) => {
        if (!pop.contains(e.target) && !this.btn.contains(e.target)) this._closePopover();
      };
      document.addEventListener('click', this._outsideHandler);
    }, 0);
  }

  _closePopover() {
    if (this.popover) { this.popover.remove(); this.popover = null; }
    if (this._outsideHandler) {
      document.removeEventListener('click', this._outsideHandler);
      this._outsideHandler = null;
    }
  }

  async _switch(name) {
    if (this.hasDirtyEditor && this.hasDirtyEditor()) {
      if (!confirm('Modifications non sauvegardées dans l\'éditeur — elles seront perdues en changeant de branche.\n\nContinuer ?')) return;
    }
    try {
      const res = await api.gitSwitchBranch(this.projectId, name);
      await this.refresh();
      this._closePopover();
      if (this.onSwitch) this.onSwitch(name, res);
    } catch (err) {
      alert('Changement de branche échoué : ' + err.message);
    }
  }
}
