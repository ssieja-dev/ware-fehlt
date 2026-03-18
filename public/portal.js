'use strict';

const APPS = [
  {
    id: 'ware-fehlt',
    name: 'Ware fehlt',
    sub: 'Fehlende Artikel melden & verwalten',
    url: '/',
    iconClass: 'icon-blue',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>`,
  },
  {
    id: 'etiketten',
    name: 'Etikettenaufträge',
    sub: 'Etiketten für den Vertrieb bestellen',
    url: '/etiketten.html',
    iconClass: 'icon-yellow',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  },
  {
    id: 'reklamationen',
    name: 'Reklamationen',
    sub: 'Kundenreklamationen erfassen & verfolgen',
    url: '/reklamationen.html',
    iconClass: 'icon-red',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    soon: true,
  },
  {
    id: 'inventur',
    name: 'Inventur',
    sub: 'Bestände erfassen und prüfen',
    url: '/inventur.html',
    iconClass: 'icon-green',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    soon: true,
  },
];

let currentUser = null;

window.addEventListener('DOMContentLoaded', () => {
  checkSession();

  document.getElementById('portal-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('portal-passwort').focus();
  });
  document.getElementById('portal-passwort').addEventListener('keydown', e => {
    if (e.key === 'Enter') portalLogin();
  });
});

async function checkSession() {
  try {
    const res = await fetch('/api/portal/me');
    if (res.ok) {
      const user = await res.json();
      zeigeDashboard(user);
    }
  } catch {}
}

async function portalLogin() {
  const name = document.getElementById('portal-name').value.trim();
  const passwort = document.getElementById('portal-passwort').value;
  const err = document.getElementById('login-error');
  err.classList.remove('visible');

  if (!name || !passwort) {
    const field = !name
      ? document.getElementById('portal-name')
      : document.getElementById('portal-passwort');
    shake(field);
    return;
  }

  try {
    const res = await fetch('/api/portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, passwort }),
    });
    if (res.ok) {
      const user = await res.json();
      zeigeDashboard(user);
    } else {
      err.classList.add('visible');
      shake(document.getElementById('portal-passwort'));
    }
  } catch {
    err.classList.add('visible');
  }
}

function zeigeDashboard(user) {
  currentUser = user;
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('dashboard').classList.add('active');
  document.getElementById('portal-user-name').textContent = user.name;
  document.getElementById('dashboard-greeting').textContent = `Hallo, ${user.name}!`;
  renderApps(user.apps || []);
}

function renderApps(erlaubteApps) {
  const grid = document.getElementById('apps-grid');
  grid.innerHTML = APPS
    .filter(app => erlaubteApps.includes(app.id))
    .map(app => `
      <div class="app-tile${app.soon ? ' soon' : ''}" ${app.soon ? '' : `onclick="oeffneApp('${app.url}')"`}>
        <div class="app-tile-icon ${app.iconClass}">${app.icon}</div>
        <div class="app-tile-name">${app.name}</div>
        <div class="app-tile-sub">${app.sub}</div>
        ${app.soon ? '<span class="soon-badge">Bald</span>' : ''}
      </div>
    `).join('');
}

function oeffneApp(url) {
  window.location.href = url;
}

async function portalLogout() {
  try {
    await fetch('/api/portal/logout', { method: 'POST' });
  } catch {}
  currentUser = null;
  document.getElementById('dashboard').classList.remove('active');
  document.getElementById('login-page').style.display = '';
  document.getElementById('portal-passwort').value = '';
  document.getElementById('login-error').classList.remove('visible');
}

function shake(el) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.focus();
  setTimeout(() => el.classList.remove('shake'), 400);
}
