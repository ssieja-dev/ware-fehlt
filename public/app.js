'use strict';

const socket = io();
let alleArtikel = [];
let katalog = [];
let lagerbestand = {};
let aktuellerFilter = 'offen';
let pendingErledigtId = null;
let userName = localStorage.getItem('lager_username') || '';

// ── INITIALISIERUNG ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (userName) {
    closenNameModal();
  }
  updateUserDisplay();
  ladeArtikel();
  ladeStatistik();
  ladeKatalog();
  ladeLagerbestand();

  // Enter-Taste im Name-Modal
  document.getElementById('user-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') setUserName();
  });

  // Touch-Fix fuer mobile: Tastatur schliesst sonst den ersten Tap
  document.getElementById('user-name-btn').addEventListener('touchend', e => {
    e.preventDefault();
    setUserName();
  });
  document.getElementById('erledigt-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') bestaetigeErledigt();
  });

  // Katalog-Dropdown
  const fName = document.getElementById('f-name');
  const fNameClear = document.getElementById('f-name-clear');
  fName.addEventListener('input', () => {
    zeigKatalogDropdown(fName.value.trim());
    fNameClear.classList.toggle('hidden', !fName.value);
  });
  fName.addEventListener('focus', () => { if (fName.value.trim()) zeigKatalogDropdown(fName.value.trim()); });
  fName.addEventListener('blur', () => setTimeout(versteckeKatalogDropdown, 200));
  fNameClear.addEventListener('mousedown', e => { e.preventDefault(); clearArtikelName(); });
  fNameClear.addEventListener('touchend', e => { e.preventDefault(); clearArtikelName(); });

  // Form-Felder: Enter -> Submit
  ['f-name','f-nummer','f-lagerort','f-notiz'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitArtikel();
    });
  });
});

// ── KATALOG ──────────────────────────────────────────────────
async function ladeLagerbestand() {
  try {
    const res = await fetch('/api/lagerbestand');
    lagerbestand = await res.json();
    renderListe();
  } catch {}
}

async function ladeKatalog() {
  try {
    const res = await fetch('/api/katalog');
    katalog = await res.json();
  } catch {}
}

function zeigKatalogDropdown(val) {
  if (!val) { versteckeKatalogDropdown(); return; }
  const treffer = katalog.filter(k =>
    k.artikelname.toLowerCase().includes(val.toLowerCase())
  ).slice(0, 8);
  if (treffer.length === 0) { versteckeKatalogDropdown(); return; }

  let dd = document.getElementById('katalog-dropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'katalog-dropdown';
    dd.className = 'katalog-dropdown';
    document.getElementById('f-name').closest('.form-group').appendChild(dd);
  }

  dd.innerHTML = treffer.map((k, i) =>
    `<div class="katalog-dropdown-item" data-i="${i}">
      <span class="kd-name">${escHtml(k.artikelname)}</span>
      <span class="kd-meta">${escHtml(k.artikelnummer)}${k.lagerort ? ' · ' + escHtml(k.lagerort) : ''}</span>
    </div>`
  ).join('');

  dd.querySelectorAll('.katalog-dropdown-item').forEach((el, i) => {
    const k = treffer[i];
    let touchStartY = 0;
    el.addEventListener('mousedown', e => { e.preventDefault(); waehlKatalogEintrag(k); });
    el.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', e => {
      if (Math.abs(e.changedTouches[0].clientY - touchStartY) < 8) {
        e.preventDefault();
        waehlKatalogEintrag(k);
      }
    });
  });
  dd.style.display = 'block';
}

function waehlKatalogEintrag(k) {
  document.getElementById('f-name').value = k.artikelname;
  document.getElementById('f-nummer').value = k.artikelnummer || '';
  document.getElementById('f-lagerort').value = k.lagerort || '';
  versteckeKatalogDropdown();
  document.getElementById('f-notiz').focus();
}

function versteckeKatalogDropdown() {
  const dd = document.getElementById('katalog-dropdown');
  if (dd) dd.style.display = 'none';
}

function clearArtikelName() {
  const fName = document.getElementById('f-name');
  fName.value = '';
  document.getElementById('f-name-clear').classList.add('hidden');
  versteckeKatalogDropdown();
  fName.focus();
}

// ── NUTZERNAME ──────────────────────────────────────────────
function setUserName() {
  const val = document.getElementById('user-name-input').value.trim();
  if (!val) {
    document.getElementById('user-name-input').focus();
    shake(document.getElementById('user-name-input'));
    return;
  }
  userName = val;
  localStorage.setItem('lager_username', userName);
  closenNameModal();
  updateUserDisplay();
}

function closenNameModal() {
  document.getElementById('name-modal').classList.add('hidden');
}

function updateUserDisplay() {
  document.getElementById('current-user-name').textContent = userName || '?';
}

function changeUser() {
  document.getElementById('user-name-input').value = userName;
  document.getElementById('name-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('user-name-input').focus(), 50);
}

// ── SOCKET.IO EVENTS ─────────────────────────────────────────
socket.on('connect', () => {
  setConnectionStatus(true);
});
socket.on('disconnect', () => {
  setConnectionStatus(false);
});
socket.on('artikel_neu', artikel => {
  alleArtikel.unshift(artikel);
  aktualisiereLagerorte();
  renderListe();
  ladeStatistik();
  if (artikel.gemeldet_von !== userName) {
    toast(`Neu gemeldet: ${artikel.artikelname} (${artikel.lagerort})`, 'info');
  }
});
socket.on('artikel_erledigt', artikel => {
  updateArtikelInListe(artikel);
  ladeStatistik();
  if (artikel.erledigt_von !== userName) {
    toast(`Erledigt: ${artikel.artikelname} von ${artikel.erledigt_von}`, 'success');
  }
});
socket.on('artikel_offen', artikel => {
  updateArtikelInListe(artikel);
  ladeStatistik();
});
socket.on('lagerbestand_update', data => {
  lagerbestand = data;
  renderListe();
});
socket.on('artikel_geloescht', ({ id }) => {
  alleArtikel = alleArtikel.filter(a => a.id !== id);
  renderListe();
  ladeStatistik();
});

function setConnectionStatus(connected) {
  const dot = document.querySelector('.dot');
  const label = document.querySelector('.conn-label');
  if (connected) {
    dot.classList.add('connected');
    label.classList.add('connected');
    label.textContent = 'Verbunden';
  } else {
    dot.classList.remove('connected');
    label.classList.remove('connected');
    label.textContent = 'Getrennt';
  }
}

function updateArtikelInListe(artikel) {
  const idx = alleArtikel.findIndex(a => a.id === artikel.id);
  if (idx !== -1) alleArtikel[idx] = artikel;
  renderListe();
}

// ── DATEN LADEN ──────────────────────────────────────────────
async function ladeArtikel() {
  try {
    const res = await fetch('/api/artikel');
    alleArtikel = await res.json();
    aktualisiereLagerorte();
    renderListe();
  } catch {
    toast('Fehler beim Laden der Artikel', 'error');
  }
}

async function ladeStatistik() {
  try {
    const res = await fetch('/api/statistik');
    const d = await res.json();
    animateNum('stat-offen', d.offen);
    animateNum('stat-erledigt', d.erledigt);
    animateNum('stat-lagerorte', d.lagerorte);
    animateNum('stat-gesamt', d.gesamt);
  } catch {}
}

function animateNum(id, ziel) {
  const el = document.getElementById(id);
  const start = parseInt(el.textContent) || 0;
  if (start === ziel) return;
  const steps = 12;
  let i = 0;
  const iv = setInterval(() => {
    i++;
    el.textContent = Math.round(start + (ziel - start) * (i / steps));
    if (i >= steps) clearInterval(iv);
  }, 20);
}

// ── FORMULAR ─────────────────────────────────────────────────
function toggleForm() {
  const body = document.getElementById('form-body');
  const btn = document.getElementById('toggle-form-btn');
  body.classList.toggle('hidden');
  btn.classList.toggle('collapsed');
}

async function submitArtikel() {
  if (!userName) {
    document.getElementById('name-modal').classList.remove('hidden');
    return;
  }
  const name = document.getElementById('f-name').value.trim();
  const nummer = document.getElementById('f-nummer').value.trim();
  const lagerort = document.getElementById('f-lagerort').value.trim();
  if (!name) { shake(document.getElementById('f-name')); return; }
  if (!nummer) { shake(document.getElementById('f-nummer')); return; }
  if (!lagerort) { shake(document.getElementById('f-lagerort')); return; }

  const payload = {
    artikelname: name,
    artikelnummer: document.getElementById('f-nummer').value.trim(),
    lagerort,
    einheit: document.getElementById('f-einheit').value,
    gemeldet_von: userName,
    notiz: document.getElementById('f-notiz').value.trim(),
  };

  try {
    const res = await fetch('/api/artikel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    // Formular leeren
    ['f-name','f-nummer','f-lagerort','f-notiz'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('f-name').focus();
    toast(`"${name}" gemeldet`, 'success');
  } catch {
    toast('Fehler beim Speichern', 'error');
  }
}

// ── ERLEDIGT-MODAL ───────────────────────────────────────────
function openErledigtModal(id) {
  pendingErledigtId = id;
  const input = document.getElementById('erledigt-name-input');
  input.value = userName;
  document.getElementById('erledigt-modal').classList.remove('hidden');
  setTimeout(() => input.select(), 50);
}

function closeErledigtModal() {
  pendingErledigtId = null;
  document.getElementById('erledigt-modal').classList.add('hidden');
}

async function bestaetigeErledigt() {
  const name = document.getElementById('erledigt-name-input').value.trim();
  if (!name) { shake(document.getElementById('erledigt-name-input')); return; }
  if (!pendingErledigtId) return;

  // Name merken
  userName = name;
  localStorage.setItem('lager_username', userName);
  updateUserDisplay();

  try {
    const res = await fetch(`/api/artikel/${pendingErledigtId}/erledigt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ erledigt_von: name }),
    });
    if (!res.ok) throw new Error();
    closeErledigtModal();
    toast('Artikel als erledigt markiert', 'success');
  } catch {
    toast('Fehler beim Aktualisieren', 'error');
    closeErledigtModal();
  }
}

async function markiereOffen(id) {
  try {
    const res = await fetch(`/api/artikel/${id}/offen`, { method: 'PATCH' });
    if (!res.ok) throw new Error();
    toast('Artikel wieder geoeffnet', 'info');
  } catch {
    toast('Fehler beim Aktualisieren', 'error');
  }
}

async function loescheArtikel(id, name) {
  if (!confirm(`"${name}" wirklich loeschen?`)) return;
  try {
    const res = await fetch(`/api/artikel/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    toast(`"${name}" geloescht`, 'info');
  } catch {
    toast('Fehler beim Loeschen', 'error');
  }
}

// ── FILTER & RENDERING ───────────────────────────────────────
function setFilter(filter, btn) {
  aktuellerFilter = filter;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderListe();
}

function renderListe() {
  const suchtext = (document.getElementById('search-input')?.value || '').toLowerCase();
  let gefiltert = alleArtikel.filter(a => {
    if (aktuellerFilter !== 'alle' && a.status !== aktuellerFilter) return false;
    if (suchtext) {
      const haystack = `${a.artikelname} ${a.artikelnummer} ${a.lagerort} ${a.gemeldet_von} ${a.notiz}`.toLowerCase();
      if (!haystack.includes(suchtext)) return false;
    }
    return true;
  });

  const container = document.getElementById('artikel-liste');
  if (gefiltert.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
        <p>${suchtext ? 'Keine Ergebnisse gefunden' : aktuellerFilter === 'offen' ? 'Keine offenen Eintraege' : 'Keine Eintraege'}</p>
      </div>`;
    return;
  }

  container.innerHTML = gefiltert.map(a => renderArtikelItem(a)).join('');
}

function bestandBadge(artikelnummer) {
  if (!artikelnummer || !(artikelnummer in lagerbestand)) return '';
  const b = lagerbestand[artikelnummer];
  const cls = b === 0 ? 'bestand-leer' : b <= 3 ? 'bestand-niedrig' : 'bestand-ok';
  return `<span class="badge-bestand ${cls}">Bestand: ${b}</span>`;
}

function renderArtikelItem(a) {
  const erledigt = a.status === 'erledigt';
  const erstelltDatum = formatDatum(a.erstellt_am);
  const erledigtDatum = a.erledigt_am ? formatDatum(a.erledigt_am) : '';

  const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
  const undoIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const locIcon   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const userIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const timeIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const checkFillIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;

  return `
    <div class="artikel-item ${erledigt ? 'erledigt' : ''}" id="item-${a.id}">
      <button
        class="check-btn ${erledigt ? 'checked' : ''}"
        title="${erledigt ? 'Erledigung rueckgaengig machen' : 'Als aufgefuellt markieren'}"
        onclick="${erledigt ? `markiereOffen(${a.id})` : `openErledigtModal(${a.id})`}"
      >${checkIcon}</button>

      <div class="artikel-body">
        <div class="artikel-top">
          <span class="artikel-name">${escHtml(a.artikelname)}</span>
          ${a.artikelnummer ? `<span class="artikel-nummer">${escHtml(a.artikelnummer)}</span>` : ''}
          <span class="badge-menge">${a.menge} ${escHtml(a.einheit)}</span>
          ${!erledigt ? bestandBadge(a.artikelnummer) : ''}
        </div>
        <div class="artikel-meta">
          <span class="meta-item meta-lagerort">${locIcon} ${escHtml(a.lagerort)}</span>
          <span class="meta-item">${userIcon} ${escHtml(a.gemeldet_von)}</span>
          <span class="meta-item">${timeIcon} ${erstelltDatum}</span>
        </div>
        ${a.notiz ? `<div class="notiz-text">${escHtml(a.notiz)}</div>` : ''}
        ${erledigt ? `<div class="erledigt-info">${checkFillIcon} Aufgefuellt von ${escHtml(a.erledigt_von)} &mdash; ${erledigtDatum}</div>` : ''}
      </div>

      <div class="artikel-actions">
        ${erledigt ? `<button class="action-btn" title="Wieder oeffnen" onclick="markiereOffen(${a.id})">${undoIcon}</button>` : ''}
        <button class="action-btn delete" title="Loeschen" onclick="loescheArtikel(${a.id}, '${escHtml(a.artikelname).replace(/'/g,"\\'")}')">
          ${trashIcon}
        </button>
      </div>
    </div>`;
}

// ── LAGERORTE AUTOCOMPLETE ───────────────────────────────────
function aktualisiereLagerorte() {
  const orte = [...new Set(alleArtikel.map(a => a.lagerort))].sort();
  const dl = document.getElementById('lagerorte-list');
  if (dl) dl.innerHTML = orte.map(o => `<option value="${escHtml(o)}"></option>`).join('');
}

// ── HILFSFUNKTIONEN ──────────────────────────────────────────
function formatDatum(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const heute = new Date();
  const gestern = new Date(heute); gestern.setDate(heute.getDate() - 1);
  const isoDate = d.toDateString();
  let prefix = '';
  if (isoDate === heute.toDateString()) prefix = 'Heute';
  else if (isoDate === gestern.toDateString()) prefix = 'Gestern';
  else prefix = d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
  return `${prefix} ${d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake .3s ease';
  el.focus();
  setTimeout(() => el.style.animation = '', 400);
}

// Shake-Animation in CSS injizieren
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake {
  0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)}
}`;
document.head.appendChild(shakeStyle);

function toast(msg, type = 'info') {
  const icons = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || icons.info}<span>${escHtml(msg)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(10px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
