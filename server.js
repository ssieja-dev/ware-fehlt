'use strict';

process.on('uncaughtException', err => {
  console.error('\n  FEHLER:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error(`  Port ${err.port} ist bereits belegt. Bitte das andere Programm beenden.\n`);
  }
  console.error('\n  Druecke Enter zum Beenden...');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Im pkg-Build liegt lager.json neben der .exe, sonst im Projektordner
const DB_FILE = process.pkg
  ? path.join(path.dirname(process.execPath), 'lager.json')
  : path.join(__dirname, 'lager.json');

// ── Datenbank (JSON-Datei) ─────────────────────────────────
function ladeDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch {}
  return { artikel: [], nextId: 1 };
}

function speichereDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let db = ladeDB();

// ── Middleware ─────────────────────────────────────────────
app.use(express.json());
const PUBLIC_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'public')
  : path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ── API ────────────────────────────────────────────────────
// Alle Artikel
app.get('/api/artikel', (req, res) => {
  const sorted = [...db.artikel].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'offen' ? -1 : 1;
    return new Date(b.erstellt_am) - new Date(a.erstellt_am);
  });
  res.json(sorted);
});

// Neuen Artikel hinzufügen
app.post('/api/artikel', (req, res) => {
  const { artikelname, artikelnummer, lagerort, menge, einheit, gemeldet_von, notiz } = req.body;
  if (!artikelname?.trim() || !lagerort?.trim() || !gemeldet_von?.trim()) {
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  }
  const artikel = {
    id: db.nextId++,
    artikelname: artikelname.trim(),
    artikelnummer: (artikelnummer || '').trim(),
    lagerort: lagerort.trim(),
    menge: Number(menge) || 1,
    einheit: einheit || 'Stk.',
    gemeldet_von: gemeldet_von.trim(),
    erstellt_am: new Date().toISOString(),
    status: 'offen',
    erledigt_von: null,
    erledigt_am: null,
    notiz: (notiz || '').trim(),
  };
  db.artikel.push(artikel);
  speichereDB(db);
  io.emit('artikel_neu', artikel);
  res.json(artikel);
});

// Als erledigt markieren
app.patch('/api/artikel/:id/erledigt', (req, res) => {
  const id = parseInt(req.params.id);
  const { erledigt_von } = req.body;
  if (!erledigt_von?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  const artikel = db.artikel.find(a => a.id === id);
  if (!artikel) return res.status(404).json({ error: 'Nicht gefunden' });
  artikel.status = 'erledigt';
  artikel.erledigt_von = erledigt_von.trim();
  artikel.erledigt_am = new Date().toISOString();
  speichereDB(db);
  io.emit('artikel_erledigt', artikel);
  res.json(artikel);
});

// Erledigung rückgängig
app.patch('/api/artikel/:id/offen', (req, res) => {
  const id = parseInt(req.params.id);
  const artikel = db.artikel.find(a => a.id === id);
  if (!artikel) return res.status(404).json({ error: 'Nicht gefunden' });
  artikel.status = 'offen';
  artikel.erledigt_von = null;
  artikel.erledigt_am = null;
  speichereDB(db);
  io.emit('artikel_offen', artikel);
  res.json(artikel);
});

// Löschen
app.delete('/api/artikel/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = db.artikel.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  db.artikel.splice(idx, 1);
  speichereDB(db);
  io.emit('artikel_geloescht', { id });
  res.json({ ok: true });
});

// Artikelkatalog aus CSV
function parseCSV(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = lines[0];
  const delimiter = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ',';
  const headers = header.split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] || ''; });
    if (Object.values(obj).some(v => v)) result.push(obj);
  }
  return result;
}

const KATALOG_FILE = process.pkg
  ? path.join(path.dirname(process.execPath), 'katalog.csv')
  : path.join(__dirname, 'katalog.csv');

app.get('/api/katalog', (req, res) => {
  try {
    if (!fs.existsSync(KATALOG_FILE)) return res.json([]);
    const content = fs.readFileSync(KATALOG_FILE, 'latin1');
    res.json(parseCSV(content));
  } catch {
    res.json([]);
  }
});

// Lagerbestand aus JTL-CSV
const BESTAND_FILE = process.pkg
  ? path.join(path.dirname(process.execPath), 'lagerbestand.csv')
  : path.join(__dirname, 'lagerbestand.csv');

let bestandMap = {};

function ladeBestand() {
  try {
    if (!fs.existsSync(BESTAND_FILE)) return;
    const content = fs.readFileSync(BESTAND_FILE, 'latin1');
    const eintraege = parseCSV(content);
    const neu = {};
    for (const e of eintraege) {
      const nr = (e.artikelnummer || e.artnr || e['artikel-nr'] || '').trim();
      const raw = (e.bestand || e.lagerbestand || e.verfuegbar || e['verfügbar'] ||
        e['lagerbestand lager [im hasseldamm]'] || '0').replace(',', '.');
      const bestand = parseFloat(raw) || 0;
      if (nr) neu[nr] = bestand;
    }
    bestandMap = neu;
    io.emit('lagerbestand_update', bestandMap);
    console.log(`Lagerbestand aktualisiert: ${Object.keys(bestandMap).length} Artikel`);
  } catch (e) {
    console.error('Fehler beim Laden des Lagerbestands:', e.message);
  }
}

ladeBestand();
setInterval(ladeBestand, 5 * 60 * 1000);

app.get('/api/lagerbestand', (req, res) => res.json(bestandMap));

// Statistik
app.get('/api/statistik', (req, res) => {
  const gesamt = db.artikel.length;
  const offen = db.artikel.filter(a => a.status === 'offen').length;
  const erledigt = db.artikel.filter(a => a.status === 'erledigt').length;
  const lagerorte = new Set(db.artikel.filter(a => a.status === 'offen').map(a => a.lagerort)).size;
  res.json({ gesamt, offen, erledigt, lagerorte });
});

// ── Socket.IO ──────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Nutzer verbunden:', socket.id);
  socket.on('disconnect', () => console.log('Nutzer getrennt:', socket.id));
});

// ── Firewall-Regel (nur im pkg-Build, einmalig) ────────────
if (process.pkg) {
  const { execSync } = require('child_process');
  try {
    execSync('netsh advfirewall firewall add rule name="Ware-Fehlt" dir=in action=allow protocol=TCP localport=3000', { stdio: 'ignore' });
  } catch {}
}

// ── Server starten ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║     Lager - Ware fehlt  v1.0        ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log(`\n  Lokal:    http://localhost:${PORT}`);
  console.log(`  Netzwerk: http://${localIP}:${PORT}`);
  console.log('\n  Andere Geraete im WLAN einfach die');
  console.log('  Netzwerk-Adresse im Browser oeffnen.');
  console.log('\n  Zum Beenden: Strg+C\n');

  // Browser automatisch öffnen
  setTimeout(() => {
    const { exec } = require('child_process');
    exec(`start http://localhost:${PORT}`);
  }, 500);
});
