'use strict';

const socket = io();
let alleArtikel = [];
let katalog = [];
let lagerbestand = {};
let lagerorteExtra = {};
let aktuellerFilter = 'offen';
let pendingErledigtId = null;
let userName = localStorage.getItem('lager_username') || '';

// ── INITIALISIERUNG ──────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  pruefSession();
  const backBtn = document.getElementById('portal-back-btn');
  if (backBtn) {
    fetch('/api/config').then(r => r.json()).then(cfg => {
      backBtn.href = `http://${window.location.hostname}:${cfg.portalPort}`;
    });
  }

  // Enter-Taste im Login-Modal
  document.getElementById('user-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('user-passwort-input').focus();
  });
  document.getElementById('user-passwort-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') setUserName();
  });

  // Touch-Fix fuer mobile: Tastatur schliesst sonst den ersten Tap
  document.getElementById('user-name-btn').addEventListener('touchend', e => {
    e.preventDefault();
    setUserName();
  });
  // Katalog-Dropdown
  const fArtikel = document.getElementById('f-artikel');
  const fArtikelClear = document.getElementById('f-artikel-clear');
  fArtikel.addEventListener('input', () => {
    document.getElementById('f-name').value = '';
    document.getElementById('f-nummer').value = '';
    document.getElementById('f-artikel-etikett').classList.add('hidden');
    zeigKatalogDropdown(fArtikel.value.trim());
    fArtikelClear.classList.toggle('hidden', !fArtikel.value);
  });
  fArtikel.addEventListener('focus', () => { if (fArtikel.value.trim()) zeigKatalogDropdown(fArtikel.value.trim()); });
  fArtikel.addEventListener('blur', () => setTimeout(versteckeKatalogDropdown, 200));
  fArtikelClear.addEventListener('mousedown', e => { e.preventDefault(); clearArtikel(); });
  fArtikelClear.addEventListener('touchend', e => { e.preventDefault(); clearArtikel(); });

  const fArtikelEtikett = document.getElementById('f-artikel-etikett');
  fArtikelEtikett.addEventListener('click', async () => {
    const artikelname = document.getElementById('f-name').value.trim();
    const artikelnummer = document.getElementById('f-nummer').value.trim();
    const lagerort = document.getElementById('f-lagerort').value.trim();
    if (!artikelname) return;
    await fetch('/api/lagerorte-etiketten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artikelname, artikelnummer, lagerort }),
    });
    fArtikelEtikett.classList.add('hinzugefuegt');
    setTimeout(() => fArtikelEtikett.classList.remove('hinzugefuegt'), 1500);
  });

  // Form-Felder: Enter -> Submit (f-artikel: zuerst GTIN-Scan prüfen)
  fArtikel.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = fArtikel.value.trim();
    const nurZiffern = s => (s || '').replace(/\D/g, '');
    const valN = nurZiffern(val);
    const treffer = valN.length >= 8 && (
      katalog.find(k => { const g = nurZiffern(k.ean || k.gtin); return g && (g === valN || g === '0' + valN || '0' + g === valN); })
    );
    if (treffer) {
      waehlKatalogEintrag(treffer);
      const bestand = lagerbestand[treffer.artikelnummer]?.bestand;
      if (bestand !== undefined && bestand <= 1) {
        const b = `Bestand: ${bestand}`;
        document.getElementById('bestand-niedrig-text').textContent = `${treffer.artikelname} – ${b}. Wirklich auffüllen?`;
        document.getElementById('bestand-niedrig-modal').classList.remove('hidden');
      } else {
        await submitArtikel();
      }
    } else {
      submitArtikel();
    }
  });
  ['f-lagerort','f-notiz'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitArtikel();
    });
  });

  setupEtStepper('et-stepper-minus', -1);
  setupEtStepper('et-stepper-plus', 1);
});

// ── DRUM PICKER ──────────────────────────────────────────────
const DRUM_ITEM_H = 26;
const DRUM_PADDING = 2;

function initDrumPicker(id, items, onChange) {
  const container = document.getElementById(id);
  const itemsEl   = document.getElementById(id + '-items');
  let idx = 0, translateY = 0;
  let startY = 0, startTranslate = 0, dragging = false;
  let lastY = 0, lastTime = 0, velocity = 0;

  const padded = [...Array(DRUM_PADDING).fill(''), ...items, ...Array(DRUM_PADDING).fill('')];
  itemsEl.innerHTML = padded.map(v => `<div class="picker-item">${v}</div>`).join('');
  const allEls = itemsEl.querySelectorAll('.picker-item');

  function snap(i, animate) {
    idx = Math.max(0, Math.min(items.length - 1, i));
    translateY = -idx * DRUM_ITEM_H;
    itemsEl.style.transition = animate ? 'transform .25s cubic-bezier(.2,.8,.4,1)' : 'none';
    itemsEl.style.transform = `translateY(${translateY}px)`;
    allEls.forEach((el, j) => el.classList.toggle('active', j === idx + DRUM_PADDING));
    onChange(items[idx]);
  }

  function onStart(y) {
    dragging = true;
    startY = lastY = y; lastTime = Date.now(); velocity = 0;
    startTranslate = translateY;
    itemsEl.style.transition = 'none';
  }
  function onMove(y) {
    if (!dragging) return;
    const now = Date.now();
    velocity = (y - lastY) / Math.max(1, now - lastTime);
    lastY = y; lastTime = now;
    translateY = startTranslate + (y - startY);
    itemsEl.style.transform = `translateY(${translateY}px)`;
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    snap(Math.round(-(translateY + velocity * 80) / DRUM_ITEM_H), true);
  }

  container.addEventListener('mousedown', e => { e.preventDefault(); onStart(e.clientY); });
  window.addEventListener('mousemove', e => onMove(e.clientY));
  window.addEventListener('mouseup', () => onEnd());
  container.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientY); }, { passive: false });
  container.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e.touches[0].clientY); }, { passive: false });
  container.addEventListener('touchend',   e => { e.preventDefault(); onEnd(); }, { passive: false });

  snap(0, false);
  return { reset: () => snap(0, true), getValue: () => items[idx] };
}

let allePalettenLieferungen = [];

function getKW(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

async function ladeLieferanten() {
  try {
    const res = await fetch('/api/lieferanten');
    if (!res.ok) return;
    const liste = (await res.json()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const sel = document.getElementById('et-ld-lieferant');
    liste.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.kuerzel;
      opt.textContent = `${l.kuerzel} · ${l.name}`;
      sel.appendChild(opt);
    });
  } catch {}
}

async function ladePalettenLieferungen() {
  try {
    const r = await fetch('/api/palettenlieferungen');
    if (!r.ok) return;
    const data = await r.json();
    allePalettenLieferungen = data.lieferungen || [];
  } catch {}
}

function sucheEtLieferung() {
  const nr = parseInt(document.getElementById('et-lief-nr').value);
  const badge = document.getElementById('et-lief-badge');
  const preview = document.getElementById('et-lieferung-preview');

  if (!nr) {
    badge.textContent = '–'; badge.style.opacity = '.4'; badge.style.color = '';
    preview.textContent = '–';
    document.getElementById('etiketten-lieferung').value = '';
    return;
  }

  const l = allePalettenLieferungen.find(x => x.id === nr);
  if (!l) {
    badge.textContent = 'Nicht gefunden'; badge.style.opacity = '1'; badge.style.color = '#f87171';
    preview.textContent = '–';
    document.getElementById('etiketten-lieferung').value = '';
    return;
  }

  const [y, m, d] = l.datum.split('-');
  const datumFormatted = `${d}.${m}.${y}`;
  const info = `${l.kw}KW ${datumFormatted} ${l.id} ${l.lieferant}`;

  badge.textContent = `KW ${l.kw}`; badge.style.opacity = '1'; badge.style.color = '';
  const lieferantAnzeige = l.lieferantName && l.lieferantName !== l.lieferant
    ? `${escHtml(l.lieferantName)} | ${escHtml(l.lieferant)}`
    : escHtml(l.lieferant);
  preview.textContent = `${l.id} · KW ${l.kw} · ${datumFormatted} · ${lieferantAnzeige}`;
  document.getElementById('etiketten-lieferung').value = info;
}

// ── KATALOG UPLOAD ───────────────────────────────────────────
function oeffneKatalogUpload() {
  document.getElementById('katalog-file-input').value = '';
  document.getElementById('katalog-datei-name').textContent = 'Datei auswählen (.csv)';
  document.getElementById('katalog-upload-status').textContent = '';
  const btn = document.getElementById('katalog-upload-btn');
  btn.disabled = true; btn.style.opacity = '.5';
  document.getElementById('katalog-upload-modal').classList.remove('hidden');
}

function schliesseKatalogUpload() {
  document.getElementById('katalog-upload-modal').classList.add('hidden');
}

function katalogDateiGewaehlt(input) {
  const file = input.files[0];
  const btn = document.getElementById('katalog-upload-btn');
  document.getElementById('katalog-datei-name').textContent = file ? file.name : 'Datei auswählen (.csv)';
  btn.disabled = !file; btn.style.opacity = file ? '1' : '.5';
  document.getElementById('katalog-upload-status').textContent = '';
}

async function uploadKatalog() {
  const input = document.getElementById('katalog-file-input');
  const status = document.getElementById('katalog-upload-status');
  const btn = document.getElementById('katalog-upload-btn');
  if (!input.files[0]) return;
  btn.disabled = true; btn.style.opacity = '.5';
  status.style.color = 'var(--text2)';
  status.textContent = 'Wird hochgeladen...';
  try {
    const res = await fetch('/api/katalog/upload', {
      method: 'POST',
      body: input.files[0],
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    const data = await res.json();
    if (data.ok) {
      schliesseKatalogUpload();
      await ladeKatalog();
      toast(`Katalog aktualisiert: ${data.artikel} Artikel`, 'success');
    } else {
      status.style.color = '#ef4444';
      status.textContent = 'Fehler: ' + (data.error || 'Unbekannt');
      btn.disabled = false; btn.style.opacity = '1';
    }
  } catch {
    status.style.color = '#ef4444';
    status.textContent = 'Verbindungsfehler';
    btn.disabled = false; btn.style.opacity = '1';
  }
}

// ── KATALOG ──────────────────────────────────────────────────
async function ladeLagerbestand() {
  try {
    const res = await fetch('/api/lagerbestand');
    lagerbestand = await res.json();
    renderListe();
  } catch {}
}

async function ladeLagerorteExtra() {
  try {
    const res = await fetch('/api/lagerorte-extra');
    lagerorteExtra = await res.json();
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
  const lower = val.toLowerCase();
  const treffer = katalog.filter(k =>
    k.artikelname.toLowerCase().includes(lower) ||
    (k.artikelnummer || '').toLowerCase().includes(lower)
  ).slice(0, 8);
  if (treffer.length === 0) { versteckeKatalogDropdown(); return; }

  let dd = document.getElementById('katalog-dropdown');
  const anker = document.getElementById('f-artikel').closest('.form-group');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'katalog-dropdown';
    dd.className = 'katalog-dropdown';
    anker.appendChild(dd);
  } else if (dd.parentElement !== anker) {
    anker.appendChild(dd);
  }

  dd.innerHTML = treffer.map((k, i) =>
    `<div class="katalog-dropdown-item" data-i="${i}">
      <span class="kd-name">${escHtml(k.artikelname)}</span>
      <span class="kd-meta">${escHtml(k.artikelnummer)}${k.lagerort ? ' · ' + escHtml(k.lagerort) : ''}</span>
      ${k.anmerkung ? `<span class="kd-anmerkung">${formatAnmerkung(k.anmerkung)}</span>` : ''}
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
  document.getElementById('f-artikel').value = k.artikelname + (k.artikelnummer ? ' · ' + k.artikelnummer : '');
  document.getElementById('f-artikel-clear').classList.remove('hidden');
  document.getElementById('f-artikel-etikett').classList.remove('hidden');
  document.getElementById('f-lagerort').value = k.lagerort || k['eigene id'] || '';
  zeigAnmerkung(k.anmerkung || '');
  zeigBestandInfo(k.artikelnummer || '');
  versteckeKatalogDropdown();
  document.getElementById('f-notiz').focus();
}

function zeigBestandInfo(artikelnummer) {
  const box = document.getElementById('bestand-info');
  if (!artikelnummer || !(artikelnummer in lagerbestand)) {
    box.classList.add('hidden'); return;
  }
  const b = lagerbestand[artikelnummer].bestand;
  const warnIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  const okIcon   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
  box.className = 'bestand-info ' + (b === 0 ? 'leer' : b <= 3 ? 'niedrig' : 'ok');
  box.innerHTML = `Bestand: <strong>${b}</strong>`;
}

function formatAnmerkung(text) {
  const teile = text.split('--').map(t => t.trim()).filter(t => t);
  return teile.map(escHtml).join('<br>');
}

function zeigAnmerkung(text) {
  const box = document.getElementById('anmerkung-info');
  const span = document.getElementById('anmerkung-text');
  if (text && text.trim()) {
    span.innerHTML = formatAnmerkung(text);
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
    span.innerHTML = '';
  }
}

function versteckeKatalogDropdown() {
  const dd = document.getElementById('katalog-dropdown');
  if (dd) dd.style.display = 'none';
}

function clearArtikel() {
  document.getElementById('f-artikel').value = '';
  document.getElementById('f-artikel-clear').classList.add('hidden');
  document.getElementById('f-artikel-etikett').classList.add('hidden');
  document.getElementById('f-name').value = '';
  document.getElementById('f-nummer').value = '';
  versteckeKatalogDropdown();
  zeigAnmerkung('');
  document.getElementById('bestand-info').classList.add('hidden');
  document.getElementById('f-artikel').focus();
}

// ── LOGIN ────────────────────────────────────────────────────
async function pruefSession() {
  try {
    // Portal-Session prüfen → Name automatisch übernehmen
    const portalRes = await fetch('/api/portal/me');
    if (portalRes.ok) {
      const portalUser = await portalRes.json();
      if (portalUser?.name) {
        userName = portalUser.name;
        localStorage.setItem('lager_username', userName);
      }
      if (portalUser?.admin) {
        document.getElementById('katalog-upload-btn-header').classList.remove('hidden');
      }
    }
  } catch {}

  try {
    const res = await fetch('/api/artikel');
    if (res.status === 401) {
      zeigeLoginModal();
    } else {
      alleArtikel = await res.json();
      if (userName) closenNameModal();
      else zeigeLoginModal();
      aktualisiereLagerorte();
      renderListe();
      ladeStatistik();
      ladeKatalog();
      ladeLagerbestand();
      ladePalettenLieferungen();
      ladeLieferanten();
      ladeLagerorteExtra();
      ladeEtikettenFertig();
      updateUserDisplay();
    }
  } catch {
    zeigeLoginModal();
  }
}

function zeigeLoginModal() {
  document.getElementById('name-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('user-name-input').focus(), 50);
}

async function setUserName() {
  const name = document.getElementById('user-name-input').value.trim();
  const pw   = document.getElementById('user-passwort-input').value;
  if (!name) { shake(document.getElementById('user-name-input')); return; }
  if (!pw)   { shake(document.getElementById('user-passwort-input')); return; }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passwort: pw }),
    });
    if (!res.ok) {
      shake(document.getElementById('user-passwort-input'));
      document.getElementById('user-passwort-input').value = '';
      toast('Falsches Passwort', 'error');
      return;
    }
  } catch {
    toast('Verbindungsfehler', 'error');
    return;
  }

  userName = name;
  localStorage.setItem('lager_username', userName);
  closenNameModal();
  updateUserDisplay();
  ladeArtikel();
  ladeStatistik();
  ladeKatalog();
  ladeLagerbestand();
  ladeLagerorteExtra();
  ladeEtikettenFertig();
}

async function logout() {
  // Bei Portal-Session: zurück zum Portal
  try {
    const portalRes = await fetch('/api/portal/me');
    if (portalRes.ok) {
      await fetch('/api/portal/logout', { method: 'POST' });
      window.location.href = '/portal.html';
      return;
    }
  } catch {}
  await fetch('/api/logout', { method: 'POST' });
  userName = '';
  localStorage.removeItem('lager_username');
  alleArtikel = [];
  renderListe();
  zeigeLoginModal();
}

function closenNameModal() {
  document.getElementById('name-modal').classList.add('hidden');
}

function updateUserDisplay() {
  document.getElementById('current-user-name').textContent = userName || '?';
}

function changeUser() {
  document.getElementById('user-name-input').value = userName;
  document.getElementById('user-passwort-input').value = '';
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
socket.on('artikel_etiketten', artikel => {
  updateArtikelInListe(artikel);
  ladeStatistik();
});
socket.on('artikel_etiketten_fertig', artikel => {
  updateArtikelInListe(artikel);
  ladeStatistik();
});
socket.on('etikett_erledigt', eintrag => {
  ladeEtikettenFertig();
  toast(`Etiketten fertig: ${eintrag.artikelname}`, 'success');
  spieleEtikettenFertigTon();
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

async function ladeEtikettenFertig() {
  try {
    const res = await fetch('/api/etiketten');
    const alle = await res.json();
    const fertig = alle.filter(e => e.status === 'erledigt');
    renderEtikettenFertig(fertig);
  } catch {}
}

function renderEtikettenFertig(liste) {
  const container = document.getElementById('etiketten-fertig-liste');
  const badge = document.getElementById('fertig-count-badge');
  if (!container) return;

  if (liste.length === 0) {
    badge.style.display = 'none';
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
        <p>Keine fertigen Etiketten</p>
      </div>`;
    return;
  }

  badge.style.display = 'inline-flex';
  badge.textContent = liste.length;

  const locIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const timeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const userIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  container.innerHTML = liste.map(e => `
    <div class="fertig-item">
      <div class="fertig-body">
        <div class="fertig-name">${escHtml(e.artikelname)}</div>
        ${e.artikelnummer ? `<span class="fertig-nummer">${escHtml(e.artikelnummer)}</span>` : ''}
        <span class="fertig-menge">${escHtml(e.menge)} Etiketten</span>
        ${e.typ === 'mhd' ? `<span class="fertig-typ-badge mhd">MHD am Artikel</span>` : ''}
        ${e.typ === 'lieferung' && e.lieferung ? `<span class="fertig-typ-badge lieferung">📦 ${escHtml(e.lieferung)}</span>` : ''}
        <div class="fertig-meta">
          ${e.lagerort ? `<span>${locIcon} ${escHtml(e.lagerort)}</span>` : ''}
          <span>${userIcon} Fertig von <strong>${escHtml(e.erledigt_von)}</strong></span>
          <span>${timeIcon} ${formatDatum(e.erledigt_am)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

async function ladeStatistik() {
  try {
    const res = await fetch('/api/statistik');
    const d = await res.json();
    animateNum('stat-offen', d.offen);
    animateNum('stat-etiketten', alleArtikel.filter(a => a.status === 'etiketten').length);
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
  if (!name) { shake(document.getElementById('f-artikel')); return; }
  if (!nummer) { shake(document.getElementById('f-artikel')); return; }
  if (!lagerort) { shake(document.getElementById('f-lagerort')); return; }

  const duplikat = alleArtikel.find(a =>
    (a.status === 'offen' || a.status === 'etiketten') &&
    a.artikelnummer.toLowerCase() === nummer.toLowerCase()
  );
  if (duplikat) {
    document.getElementById('bereits-gemeldet-text').textContent = duplikat.artikelname;
    document.getElementById('bereits-gemeldet-modal').classList.remove('hidden');
    return;
  }

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
    document.getElementById('f-artikel').value = '';
    document.getElementById('f-artikel-clear').classList.add('hidden');
    document.getElementById('f-artikel-etikett').classList.add('hidden');
    zeigAnmerkung('');
    document.getElementById('bestand-info').classList.add('hidden');
    document.getElementById('f-artikel').focus();
    toast(`"${name}" gemeldet`, 'success');
  } catch {
    toast('Fehler beim Speichern', 'error');
  }
}

// ── ERLEDIGT-MODAL ───────────────────────────────────────────
function openErledigtModal(id) {
  pendingErledigtId = id;
  document.getElementById('erledigt-frage').textContent = `Ware aufgefüllt, ${userName}?`;
  document.getElementById('erledigt-modal').classList.remove('hidden');
}

function closeErledigtModal() {
  pendingErledigtId = null;
  document.getElementById('erledigt-modal').classList.add('hidden');
}

async function bestaetigeErledigt() {
  if (!pendingErledigtId) return;

  try {
    const res = await fetch(`/api/artikel/${pendingErledigtId}/erledigt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ erledigt_von: userName }),
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

let pendingLoescheId = null;

function loescheArtikel(id, name) {
  pendingLoescheId = id;
  document.getElementById('delete-modal-text').textContent = `"${name}" wird unwiderruflich gelöscht.`;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  pendingLoescheId = null;
  document.getElementById('delete-modal').classList.add('hidden');
}

function bereitsGemeldetSchliessen() {
  document.getElementById('bereits-gemeldet-modal').classList.add('hidden');
  document.getElementById('f-artikel').focus();
}

function bestandNiedrigNein() {
  document.getElementById('bestand-niedrig-modal').classList.add('hidden');
  document.getElementById('f-artikel').focus();
}

async function bestandNiedrigJa() {
  document.getElementById('bestand-niedrig-modal').classList.add('hidden');
  await submitArtikel();
}

async function bestaetigeLoeschen() {
  if (!pendingLoescheId) return;
  const id = pendingLoescheId;
  closeDeleteModal();
  try {
    const res = await fetch(`/api/artikel/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    toast('Artikel gelöscht', 'info');
  } catch {
    toast('Fehler beim Löschen', 'error');
  }
}

// ── SIGNALTON LAGER ───────────────────────────────────────────
let _audioCtx = null;
function _initAudio() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
}
document.addEventListener('touchstart', _initAudio, { passive: true });
document.addEventListener('click', _initAudio, { passive: true });

function spieleEtikettenFertigTon() {
  try {
    _initAudio();
    if (!_audioCtx || _audioCtx.state !== 'running') return;
    const t = _audioCtx.currentTime;
    [[660, 0], [880, 0.2], [1100, 0.4], [1320, 0.6]].forEach(([freq, delay]) => {
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.connect(gain); gain.connect(_audioCtx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(0.45, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, t + delay + 0.22);
      osc.start(t + delay); osc.stop(t + delay + 0.25);
    });
  } catch {}
}

// ── ETIKETTEN ────────────────────────────────────────────────
let pendingEtikettenArtikel = null;
let etAuftragTyp = 'lieferung';
let etAuftragGroesse = null;

let stepperWert = 1;

function stepperAendern(delta) {
  stepperWert = Math.max(1, stepperWert + delta);
  document.getElementById('etiketten-menge-display').textContent = stepperWert;
}

function setupEtStepper(btnId, dir) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  let holdTimer = null, repeatTimer = null;
  function start() {
    stepperAendern(dir);
    holdTimer = setTimeout(() => {
      btn.classList.add('longpress');
      repeatTimer = setInterval(() => stepperAendern(dir * 10), 150);
    }, 600);
  }
  function stop() {
    clearTimeout(holdTimer); clearInterval(repeatTimer);
    btn.classList.remove('longpress');
  }
  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
}

function openEtikettenModal(id) {
  pendingEtikettenArtikel = alleArtikel.find(a => a.id === id);
  if (!pendingEtikettenArtikel) return;
  const a2 = pendingEtikettenArtikel;
  document.getElementById('etiketten-artikel-info').innerHTML =
    `${escHtml(a2.artikelname)}${a2.artikelnummer ? '<br><span style="font-size:.85rem;color:#6b7280;font-weight:400;">' + escHtml(a2.artikelnummer) + '</span>' : ''}`;
  stepperWert = 1;
  document.getElementById('etiketten-menge-display').textContent = 1;
  etAuftragGroesse = null;
  setEtAuftragTyp('lieferung');
  setEtAuftragGroesse(null);
  document.getElementById('et-lief-nr').value = '';
  document.getElementById('et-lief-badge').textContent = '–';
  document.getElementById('et-lief-badge').style.opacity = '.4';
  document.getElementById('et-lief-badge').style.color = '';
  document.getElementById('et-lieferung-preview').textContent = '–';
  document.getElementById('etiketten-lieferung').value = '';
  document.getElementById('et-ld-datum').value = '';
  document.getElementById('et-ld').value = '';
  document.getElementById('et-ld-badge').textContent = 'kein Datum';
  document.getElementById('et-ld-badge').style.opacity = '.4';
  document.getElementById('et-ld-lieferant').value = '';
  [2026, 2027, 2028].forEach(j => document.getElementById(`et-year-btn-${j}`)?.classList.remove('active'));
  document.getElementById('etiketten-modal').classList.remove('hidden');
}

function setEtAuftragTyp(typ) {
  etAuftragTyp = typ;
  document.getElementById('et-toggle-lieferung').classList.toggle('active', typ === 'lieferung');
  document.getElementById('et-toggle-mhd').classList.toggle('active', typ === 'mhd');
  document.getElementById('et-toggle-ld').classList.toggle('active', typ === 'lieferung-datum');
  document.getElementById('et-feld-lieferung').classList.toggle('hidden', typ !== 'lieferung');
  document.getElementById('et-feld-ld').classList.toggle('hidden', typ !== 'lieferung-datum');
}

function setEtAuftragGroesse(groesse) {
  etAuftragGroesse = groesse;
  document.getElementById('et-toggle-klein').classList.toggle('active', groesse === 'klein');
  document.getElementById('et-toggle-gross').classList.toggle('active', groesse === 'gross');
}

function setEtLDJahr(jahr) {
  const cur = document.getElementById('et-ld-datum').value;
  let m, d;
  if (cur) {
    [, m, d] = cur.split('-');
  } else {
    const heute = new Date();
    let monat = heute.getMonth() + 1 - 2;
    if (monat <= 0) monat += 12;
    m = String(monat).padStart(2, '0');
    d = String(heute.getDate()).padStart(2, '0');
  }
  document.getElementById('et-ld-datum').value = `${jahr}-${m}-${d}`;
  [2026, 2027, 2028].forEach(j => document.getElementById(`et-year-btn-${j}`).classList.toggle('active', j === jahr));
  updateEtLDPreview();
}

function updateEtLDPreview() {
  const val = document.getElementById('et-ld-datum').value;
  const badge = document.getElementById('et-ld-badge');
  const lieferantSel = document.getElementById('et-ld-lieferant');
  const lieferantText = lieferantSel && lieferantSel.selectedIndex > 0
    ? lieferantSel.options[lieferantSel.selectedIndex].textContent : '';
  if (val) {
    const [y, m, d] = val.split('-');
    const formatted = `${d}.${m}.${y}`;
    const kw = getKW(val);
    const kwText = `KW${kw}`;
    badge.textContent = lieferantText ? `${kwText} ${formatted} · ${lieferantText}` : `${kwText} ${formatted}`;
    badge.style.opacity = '1';
    document.getElementById('et-ld').value = lieferantText ? `${kwText} ${formatted} | ${lieferantText}` : `${kwText} ${formatted}`;
    const jahr = parseInt(y);
    [2026, 2027, 2028].forEach(j => document.getElementById(`et-year-btn-${j}`).classList.toggle('active', j === jahr));
  } else {
    badge.textContent = 'kein Datum';
    badge.style.opacity = '.4';
    document.getElementById('et-ld').value = '';
    [2026, 2027, 2028].forEach(j => document.getElementById(`et-year-btn-${j}`).classList.remove('active'));
  }
}

function closeEtikettenModal() {
  pendingEtikettenArtikel = null;
  document.getElementById('etiketten-modal').classList.add('hidden');
}

async function bestaetigeEtikettenAuftrag() {
  const a = pendingEtikettenArtikel;
  if (!etAuftragGroesse) {
    shake(document.getElementById('et-toggle-klein'));
    toast('Bitte Größe wählen', 'error');
    return;
  }
  const info = etAuftragTyp === 'lieferung'
    ? document.getElementById('etiketten-lieferung').value.trim()
    : etAuftragTyp === 'lieferung-datum'
    ? document.getElementById('et-ld').value.trim()
    : '';
  if (etAuftragTyp === 'lieferung' && !info) {
    shake(document.getElementById('et-lief-nr'));
    toast('Bitte gültige Lieferungsnummer eingeben', 'error');
    return;
  }
  if (etAuftragTyp === 'lieferung-datum' && !info) {
    shake(document.getElementById('et-ld-datum'));
    toast('Bitte Datum wählen', 'error');
    return;
  }
  try {
    const res = await fetch('/api/etikett-auftrag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artikel_id: a.id,
        artikelname: a.artikelname,
        artikelnummer: a.artikelnummer,
        lagerort: a.lagerort,
        menge: stepperWert,
        typ: etAuftragTyp,
        groesse: etAuftragGroesse,
        info,
        mhd: '',
        bestellt_von: userName,
      }),
    });
    if (!res.ok) throw new Error();
    await fetch(`/api/artikel/${a.id}/etiketten`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menge: String(stepperWert) }),
    });
    closeEtikettenModal();
    toast('Etikettenauftrag an Vertrieb gesendet', 'success');
  } catch {
    toast('Fehler beim Senden', 'error');
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

function getAnmerkung(artikelnummer) {
  if (!artikelnummer || !(artikelnummer in lagerbestand)) return '';
  return lagerbestand[artikelnummer].anmerkung || '';
}

function bestandBadge(artikelnummer) {
  if (!artikelnummer || !(artikelnummer in lagerbestand)) return '';
  const b = lagerbestand[artikelnummer].bestand;
  const cls = b === 0 ? 'bestand-leer' : b <= 3 ? 'bestand-niedrig' : 'bestand-ok';
  return `<span class="badge-bestand ${cls}">Bestand: ${b}</span>`;
}

function renderArtikelItem(a) {
  const erledigt = a.status === 'erledigt';
  const hatEtiketten = a.etiketten_bestellt === true;
  const erstelltDatum = formatDatum(a.erstellt_am);
  const erledigtDatum = a.erledigt_am ? formatDatum(a.erledigt_am) : '';

  const checkIcon    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
  const undoIcon     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
  const trashIcon    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const etikettenIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
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
        </div>
        <div class="artikel-sub">
          ${a.artikelnummer ? `<span class="artikel-nummer">${escHtml(a.artikelnummer)}</span>` : ''}
          <span class="badge-menge">${escHtml(a.einheit)}</span>
          ${!erledigt ? bestandBadge(a.artikelnummer) : ''}
        </div>
        <div class="artikel-meta">
          <span class="meta-item">${userIcon} ${escHtml(a.gemeldet_von)}</span>
          <span class="meta-item">${timeIcon} ${erstelltDatum}</span>
        </div>
        ${(() => {
          const extra = a.artikelnummer ? lagerorteExtra[a.artikelnummer] : null;
          if (!extra || !extra.stellplaetze?.length) return '';
          const spChips = extra.stellplaetze.map(s => `<div class="pd-chip pd-chip-stell"><span class="pd-chip-label">Palettenplatz</span><span class="pd-chip-stell-val">${escHtml(s.stellplatz)}${s.menge ? `<span class="pd-chip-menge-small">${s.menge}K</span>` : ''}</span></div>`).join('');
          return `<div class="wf-paletten-block">
            <div class="wf-paletten-chips">${spChips}</div>
          </div>`;
        })()}
        ${a.notiz ? `<div class="notiz-text">${escHtml(a.notiz)}</div>` : ''}

        ${hatEtiketten ? `<div class="etiketten-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Etiketten bestellt${a.etiketten_menge ? ` &mdash; <strong>${escHtml(a.etiketten_menge)} Stk.</strong>` : ''}</div>` : ''}
        ${a.etiketten_fertig ? `<div class="etiketten-fertig-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Etiketten fertig von ${escHtml(a.etiketten_fertig_von || 'Vertrieb')}</div>` : ''}
        ${erledigt ? `<div class="erledigt-info">${checkFillIcon} Aufgefuellt von ${escHtml(a.erledigt_von)} &mdash; ${erledigtDatum}</div>` : ''}
      </div>

      <div class="top-chips">
        ${(() => { const extra = a.artikelnummer ? lagerorteExtra[a.artikelnummer] : null; return extra?.reservelager ? `<div class="pd-chip pd-chip-reserve"><span class="pd-chip-label">Reservelager</span>${escHtml(extra.reservelager)}</div>` : ''; })()}
        <div class="lagerort-chip"><span class="pd-chip-label">Lagerort</span>${escHtml(a.lagerort)}</div>
      </div>

      <div class="artikel-actions">
        ${!erledigt ? `<button class="action-btn etikett" title="Etiketten bestellen" onclick="openEtikettenModal(${a.id})">${etikettenIcon}</button>` : ''}
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

// ── EAN Scanner ──────────────────────────────────────────────────────────────
let _scanStream = null;
let _scanAnimFrame = null;
let _scanDetector = null;   // BarcodeDetector
let _scanReader = null;     // ZXing fallback
let _scanActive = false;
let _zxingLoaded = false;

async function _ladeZXing() {
  if (_zxingLoaded) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@zxing/library@0.20.0/umd/index.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  _zxingLoaded = true;
}

async function oeffneScanner() {
  if (_scanActive) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Kamera nicht verfügbar – Seite muss über HTTPS geöffnet werden', 'error');
    return;
  }
  _scanActive = true;
  const video = document.getElementById('scan-video');
  document.getElementById('scan-overlay').style.display = 'flex';

  if ('BarcodeDetector' in window) {
    try {
      _scanDetector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'code_39']
      });
      _scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      video.srcObject = _scanStream;
      await video.play();
      _scanSchleife();
    } catch (e) {
      schliesseScanner();
      toast('Kamera konnte nicht geöffnet werden', 'error');
    }
  } else {
    try {
      await _ladeZXing();
      _scanReader = new ZXing.BrowserMultiFormatReader();
      await _scanReader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        video,
        (result, err) => {
          if (!_scanActive) return;
          if (result) _handleScanResult(result.getText());
        }
      );
    } catch (e) {
      schliesseScanner();
      toast('Kamera konnte nicht geöffnet werden', 'error');
    }
  }
}

function _scanSchleife() {
  const video = document.getElementById('scan-video');
  if (!video || !_scanActive) return;
  _scanDetector.detect(video).then(codes => {
    if (!_scanActive) return;
    if (codes.length > 0) {
      _handleScanResult(codes[0].rawValue);
    } else {
      _scanAnimFrame = requestAnimationFrame(_scanSchleife);
    }
  }).catch(() => {
    if (_scanActive) _scanAnimFrame = requestAnimationFrame(_scanSchleife);
  });
}

function _handleScanResult(ean) {
  schliesseScanner();
  const nurZiffern = s => (s || '').replace(/\D/g, '');
  const eanN = nurZiffern(ean);
  
  const matchEAN = k => {
    const g = nurZiffern(k.ean || k.gtin);
    return g && (g === eanN || g === '0' + eanN || '0' + g === eanN);
  };
  const treffer = katalog.find(matchEAN)
    || katalog.find(k => (k.artikelnummer || '').trim() === ean.trim());
  if (treffer) {
    waehlKatalogEintrag(treffer);
    toast(`Artikel gefunden: ${treffer.artikelname}`, 'success');
  } else {
    const input = document.getElementById('f-artikel');
    input.value = ean;
    input.dispatchEvent(new Event('input'));
    toast(`EAN ${ean} – nicht im Katalog, bitte manuell wählen`, 'info');
  }
}

function schliesseScanner() {
  _scanActive = false;
  cancelAnimationFrame(_scanAnimFrame);
  if (_scanReader) { _scanReader.reset(); _scanReader = null; }
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
  document.getElementById('scan-overlay').style.display = 'none';
}
