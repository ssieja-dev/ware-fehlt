'use strict';

const socket = io();
let alleEtiketten = [];
let aktuellerFilter = 'offen';
let userName = '';

window.addEventListener('DOMContentLoaded', async () => {
  const backBtn = document.getElementById('portal-back-btn');
  if (backBtn) backBtn.href = `http://${window.location.hostname}:3003`;

  try {
    const res = await fetch('/api/portal/me');
    if (res.ok) {
      const user = await res.json();
      userName = user.name || '';
    }
  } catch {}

  zeigeNameBar();
  ladeEtiketten();
});

function zeigeNameBar() {
  if (!userName) return;
  document.getElementById('current-user-name').textContent = userName;
}

// ── SOCKET.IO ─────────────────────────────────────────────────
socket.on('connect', () => setConnectionStatus(true));
socket.on('disconnect', () => setConnectionStatus(false));
socket.on('etikett_neu', e => {
  alleEtiketten.unshift(e);
  renderListe();
  updateStats();
  toast(`Neuer Auftrag: ${e.artikelname} · ${e.menge} Etiketten`, 'info');
  spieleSignalton();
});
socket.on('etikett_erledigt', e => {
  const idx = alleEtiketten.findIndex(x => x.id === e.id);
  if (idx !== -1) alleEtiketten[idx] = e;
  renderListe();
  updateStats();
});
socket.on('etikett_geloescht', ({ id }) => {
  alleEtiketten = alleEtiketten.filter(e => e.id !== id);
  renderListe();
  updateStats();
});

function setConnectionStatus(connected) {
  const dot = document.querySelector('.dot');
  const label = document.querySelector('.conn-label');
  dot.classList.toggle('connected', connected);
  label.classList.toggle('connected', connected);
  label.textContent = connected ? 'Verbunden' : 'Getrennt';
}

// ── DATEN ─────────────────────────────────────────────────────
async function ladeEtiketten() {
  try {
    const res = await fetch('/api/etiketten');
    alleEtiketten = await res.json();
    renderListe();
    updateStats();
  } catch {
    toast('Fehler beim Laden', 'error');
  }
}

function updateStats() {
  document.getElementById('stat-offen').textContent = alleEtiketten.filter(e => e.status === 'offen').length;
  document.getElementById('stat-erledigt').textContent = alleEtiketten.filter(e => e.status === 'erledigt').length;
}

let pendingErledigtId = null;
let etStepperWert = 1;
let etStepperInterval = null;

function etStepperAendern(delta) {
  etStepperWert = Math.max(1, etStepperWert + delta);
  document.getElementById('erledigt-menge-display').textContent = etStepperWert;
}
function etStepperStart(delta) {
  etStepperAendern(delta);
  etStepperInterval = setTimeout(() => {
    etStepperInterval = setInterval(() => etStepperAendern(delta * 10), 100);
  }, 500);
}
function etStepperStop() {
  clearTimeout(etStepperInterval);
  clearInterval(etStepperInterval);
  etStepperInterval = null;
}

function markiereErledigt(id) {
  const eintrag = alleEtiketten.find(e => e.id === id);
  if (!eintrag) return;
  pendingErledigtId = id;
  document.getElementById('erledigt-artikel-info').innerHTML =
    `${escHtml(eintrag.artikelname)}${eintrag.artikelnummer ? '<br><span style="font-size:.85rem;color:#6b7280;font-weight:400;">' + escHtml(eintrag.artikelnummer) + '</span>' : ''}`;
  document.getElementById('erledigt-modal').classList.remove('hidden');
}

function closeErledigtModal() {
  pendingErledigtId = null;
  document.getElementById('erledigt-modal').classList.add('hidden');
}

async function bestaetigeErledigt() {
  if (!pendingErledigtId) return;
  const id = pendingErledigtId;
  closeErledigtModal();
  try {
    const res = await fetch(`/api/etiketten/${id}/erledigt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ erledigt_von: userName, menge: etStepperWert }),
    });
    if (!res.ok) throw new Error();
    toast('Erledigt!', 'success');
  } catch {
    toast('Fehler', 'error');
  }
}

let pendingLoescheId = null;

function loescheEtikett(id, name) {
  pendingLoescheId = id;
  document.getElementById('delete-modal-text').textContent = `"${name}" wird gelöscht.`;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeLöscheModal() {
  pendingLoescheId = null;
  document.getElementById('delete-modal').classList.add('hidden');
}

async function bestaetigeLoesche() {
  if (!pendingLoescheId) return;
  const id = pendingLoescheId;
  closeLöscheModal();
  try {
    const res = await fetch(`/api/etiketten/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    toast('Auftrag gelöscht', 'info');
  } catch {
    toast('Fehler beim Löschen', 'error');
  }
}

// ── FILTER & RENDERING ────────────────────────────────────────
function setFilter(filter, btn) {
  aktuellerFilter = filter;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderListe();
}

function renderListe() {
  const gefiltert = alleEtiketten.filter(e =>
    aktuellerFilter === 'alle' || e.status === aktuellerFilter
  );

  const container = document.getElementById('etikett-liste');
  if (gefiltert.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
        <p>${aktuellerFilter === 'offen' ? 'Keine offenen Aufträge' : 'Keine Einträge'}</p>
      </div>`;
    return;
  }

  const locIcon   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const userIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const timeIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
  const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
  const doneIcon  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

  container.innerHTML = gefiltert.map(e => {
    const erledigt = e.status === 'erledigt';
    return `
      <div class="etikett-item ${erledigt ? 'erledigt' : ''}">
        <button class="check-btn-et ${erledigt ? 'checked' : ''}"
          title="${erledigt ? 'Bereits erledigt' : 'Als erledigt markieren'}"
          onclick="${erledigt ? '' : `markiereErledigt(${e.id})`}"
          ${erledigt ? 'disabled' : ''}
        >${checkIcon}</button>
        <div class="etikett-body">
          <div class="etikett-name">${escHtml(e.artikelname)}</div>
          ${e.artikelnummer ? `<span class="etikett-nummer">${escHtml(e.artikelnummer)}</span>` : ''}
          <div><span class="etikett-menge">${escHtml(e.menge)} Etiketten</span></div>
          ${e.typ === 'mhd' ? `<div style="margin-top:.4rem;"><span style="background:#fef9c3;border:1px solid #fde047;color:#854d0e;border-radius:8px;padding:.3rem .75rem;font-size:1.15rem;font-weight:700;letter-spacing:.04em;display:inline-block;">MHD am Artikel</span></div>` : ''}
          ${(e.typ === 'lieferung' || e.typ === 'lieferung-datum') && e.lieferung ? `<div style="margin-top:.4rem;"><span style="background:#f1f5f9;border:1px solid #cbd5e1;color:#374151;border-radius:8px;padding:.3rem .75rem;font-size:1.15rem;font-weight:700;display:inline-block;">📦 ${escHtml(e.lieferung)}</span></div>` : ''}
          ${erledigt ? `<div class="erledigt-badge">${doneIcon} Erledigt von ${escHtml(e.erledigt_von)} &mdash; ${formatDatum(e.erledigt_am)}</div>` : ''}
          <div class="etikett-meta">
            ${e.lagerort ? `<span>${locIcon} ${escHtml(e.lagerort)}</span>` : ''}
            <span>${userIcon} ${escHtml(e.gemeldet_von)}</span>
            <span>${timeIcon} ${formatDatum(e.erstellt_am)}</span>
            ${e.quelle ? `<span style="margin-left:auto;font-size:.72rem;font-weight:500;padding:.15rem .5rem;border-radius:5px;${e.quelle === 'Etiketten bestellen' ? 'background:rgba(168,85,247,.15);color:#c084fc;border:1px solid rgba(168,85,247,.3);' : 'background:rgba(59,130,246,.12);color:#93c5fd;border:1px solid rgba(59,130,246,.25);'}">${escHtml(e.quelle)}</span>` : ''}
          </div>
        </div>
        <button class="action-btn delete" title="Löschen" onclick="loescheEtikett(${e.id}, '${escHtml(e.artikelname).replace(/'/g, "\\'")}')" style="flex-shrink:0;width:32px;height:32px;padding:0;">
          ${trashIcon}
        </button>
      </div>`;
  }).join('');
}

// ── SIGNALTON ─────────────────────────────────────────────────
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

// AudioContext beim ersten Tippen/Klick entsperren
document.addEventListener('touchstart', initAudio, { once: false, passive: true });
document.addEventListener('click', initAudio, { once: false, passive: true });

function spieleSignalton() {
  try {
    initAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t = audioCtx.currentTime;
    [[880, 0], [1100, 0.2], [1320, 0.4]].forEach(([freq, delay]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + delay);
      gain.gain.linearRampToValueAtTime(0.5, t + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, t + delay + 0.25);
      osc.start(t + delay);
      osc.stop(t + delay + 0.3);
    });
  } catch {}
}

// ── HILFSFUNKTIONEN ───────────────────────────────────────────
function formatDatum(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const heute = new Date();
  const gestern = new Date(heute); gestern.setDate(heute.getDate() - 1);
  let prefix = '';
  if (d.toDateString() === heute.toDateString()) prefix = 'Heute';
  else if (d.toDateString() === gestern.toDateString()) prefix = 'Gestern';
  else prefix = d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' });
  return `${prefix} ${d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' })}`;
}

function formatMHD(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shake(el) {
  el.style.animation = 'none'; el.offsetHeight;
  el.style.animation = 'shake .3s ease'; el.focus();
  setTimeout(() => el.style.animation = '', 400);
}

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
    el.style.opacity = '0'; el.style.transform = 'translateX(10px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }`;
document.head.appendChild(shakeStyle);
