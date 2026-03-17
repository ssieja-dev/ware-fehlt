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
const https = require('https');
const { Server } = require('socket.io');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PASSWORT = '02154';

app.use(session({
  secret: 'ware-fehlt-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Portal-Nutzer ───────────────────────────────────────────
const PORTAL_USERS_FILE = process.pkg
  ? path.join(path.dirname(process.execPath), 'portal-users.json')
  : path.join(__dirname, 'portal-users.json');

function ladePortalUsers() {
  try {
    if (fs.existsSync(PORTAL_USERS_FILE)) {
      return JSON.parse(fs.readFileSync(PORTAL_USERS_FILE, 'utf8')).users || [];
    }
  } catch {}
  return [];
}

app.post('/api/portal/login', (req, res) => {
  const { name, passwort } = req.body;
  const users = ladePortalUsers();
  const user = users.find(u =>
    u.name.toLowerCase() === (name || '').toLowerCase() &&
    u.passwort === passwort
  );
  if (user) {
    req.session.angemeldet = true;
    req.session.portalUser = { name: user.name, apps: user.apps || [] };
    res.json({ name: user.name, apps: user.apps || [] });
  } else {
    res.status(401).json({ error: 'Falsche Zugangsdaten' });
  }
});

app.get('/api/portal/me', (req, res) => {
  if (req.session?.portalUser) {
    res.json(req.session.portalUser);
  } else {
    res.status(401).json({ error: 'Nicht angemeldet' });
  }
});

app.post('/api/portal/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Auth-Middleware für alle API-Routen außer /api/login und /api/portal/*
app.use('/api', (req, res, next) => {
  if (req.path === '/login') return next();
  if (req.path.startsWith('/portal/')) return next();
  if (req.path.startsWith('/etiketten')) return next(); // Vertrieb: kein Login nötig
  if (req.path === '/lagerbestand/upload') return next(); // BAT-Skript: kein Login nötig
  if (req.session?.angemeldet) return next();
  res.status(401).json({ error: 'Nicht angemeldet' });
});

app.post('/api/login', (req, res) => {
  if (req.body.passwort === PASSWORT) {
    req.session.angemeldet = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Falsches Passwort' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

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

// ── Portal-Token Login ──────────────────────────────────────
const PORTAL_PORT = process.env.PORTAL_PORT || 3003;
const ETIKETTEN_PORT = process.env.ETIKETTEN_PORT || 3004;

function validierePortalToken(token) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORTAL_PORT}/api/app-token/${token}`, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data));
        else reject(new Error('Ungültig'));
      });
    }).on('error', reject);
  });
}

// ── Middleware ─────────────────────────────────────────────
const PUBLIC_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'public')
  : path.join(__dirname, 'public');

// Portal-Token abfangen bevor statische Dateien
app.get('/', async (req, res, next) => {
  const token = req.query.portal_token;
  if (!token) {
    if (!req.session?.portalUser) return res.redirect(`http://${req.hostname}:${PORTAL_PORT}/`);
    return next();
  }
  try {
    const user = await validierePortalToken(token);
    req.session.angemeldet = true;
    req.session.portalUser = { name: user.name };
    res.redirect('/');
  } catch {
    res.redirect('/');
  }
});

app.use(express.static(PUBLIC_DIR));

// ── API ────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json({ portalPort: PORTAL_PORT }));

// Proxy: Etikettenauftrag an etiketten-bestellen weiterleiten
app.post('/api/etikett-auftrag', (req, res) => {
  const payload = JSON.stringify(req.body);
  const options = {
    hostname: 'localhost', port: ETIKETTEN_PORT, path: '/api/auftraege/intern',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  };
  const r = http.request(options, r2 => {
    let data = '';
    r2.on('data', d => data += d);
    r2.on('end', () => {
      if (r2.statusCode === 200) res.json(JSON.parse(data));
      else res.status(r2.statusCode).json({ error: 'Fehler bei Etiketten-App' });
    });
  });
  r.on('error', () => res.status(500).json({ error: 'Etiketten-App nicht erreichbar' }));
  r.write(payload);
  r.end();
});

// Alle Artikel
app.get('/api/artikel', (req, res) => {
  const rang = { offen: 0, etiketten: 1, erledigt: 2 };
  const sorted = [...db.artikel].sort((a, b) => {
    const r = (rang[a.status] ?? 1) - (rang[b.status] ?? 1);
    if (r !== 0) return r;
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

// Etiketten bestellt → Status wechseln
app.patch('/api/artikel/:id/etiketten', (req, res) => {
  const id = parseInt(req.params.id);
  const artikel = db.artikel.find(a => a.id === id);
  if (!artikel) return res.status(404).json({ error: 'Nicht gefunden' });
  artikel.etiketten_bestellt = true;
  artikel.etiketten_menge = (req.body.menge || '').toString().trim();
  speichereDB(db);
  io.emit('artikel_etiketten', artikel);
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

// Artikelkatalog aus CSV (unterstützt mehrzeilige gequotete Felder)
function parseCSV(content) {
  const firstLine = content.split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

  // Tokenizer: zerlegt den gesamten CSV-Text korrekt inkl. "..."-Felder mit Zeilenumbrüchen
  function tokenize(text) {
    const rows = [];
    let row = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === '"') {
        // gequotetes Feld
        let val = '';
        i++; // öffnendes "
        while (i < text.length) {
          if (text[i] === '"' && text[i + 1] === '"') { val += '"'; i += 2; }
          else if (text[i] === '"') { i++; break; }
          else { val += text[i++]; }
        }
        row.push(val);
        // überspringt Delimiter oder Zeilenende nach dem schließenden "
        if (text[i] === delimiter) i++;
        else if (text[i] === '\r') { i++; if (text[i] === '\n') i++; rows.push(row); row = []; }
        else if (text[i] === '\n') { i++; rows.push(row); row = []; }
      } else {
        // ungequotetes Feld
        let val = '';
        while (i < text.length && text[i] !== delimiter && text[i] !== '\n' && text[i] !== '\r') {
          val += text[i++];
        }
        row.push(val.trim());
        if (text[i] === delimiter) i++;
        else if (text[i] === '\r') { i++; if (text[i] === '\n') i++; rows.push(row); row = []; }
        else if (text[i] === '\n') { i++; rows.push(row); row = []; }
      }
    }
    if (row.length) rows.push(row);
    return rows;
  }

  const rows = tokenize(content);
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.replace(/^"|"$/g, '').toLowerCase());
  const result = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (!values.some(v => v)) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] !== undefined ? values[idx] : ''; });
    result.push(obj);
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
      const anmerkung = (e.anmerkung || '').trim();
      if (nr) neu[nr] = { bestand, anmerkung };
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

app.get('/api/lagerorte-extra', (req, res) => {
  try {
    const reservelagerFile = path.join(__dirname, '..', 'artikel-lagerorte', 'reservelager.csv');
    const palettenFile     = path.join(__dirname, '..', 'artikel-lagerorte', 'paletten-data.json');
    const result = {};

    if (fs.existsSync(reservelagerFile)) {
      fs.readFileSync(reservelagerFile, 'utf8').split('\n').slice(1).forEach(line => {
        const [nr, wert] = line.split(';').map(s => s.trim());
        if (nr && wert) { if (!result[nr]) result[nr] = {}; result[nr].reservelager = wert; }
      });
    }
    if (fs.existsSync(palettenFile)) {
      const pd = JSON.parse(fs.readFileSync(palettenFile, 'utf8'));
      Object.entries(pd).forEach(([nr, eintraege]) => {
        if (!Array.isArray(eintraege) || eintraege.length === 0) return;
        if (!result[nr]) result[nr] = {};
        result[nr].stellplaetze = eintraege.filter(e => e.stellplatz).map(e => ({ stellplatz: e.stellplatz, menge: e.menge || 0 }));
      });
    }
    res.json(result);
  } catch (e) {
    res.json({});
  }
});


app.post('/api/lagerbestand/upload', (req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(BESTAND_FILE, buf);
      ladeBestand();
      res.json({ ok: true, artikel: Object.keys(bestandMap).length });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
});

// ── Etiketten-Aufträge ─────────────────────────────────────
const ETIKETTEN_FILE = process.pkg
  ? path.join(path.dirname(process.execPath), 'etiketten.json')
  : path.join(__dirname, 'etiketten.json');

function ladeEtikettenDB() {
  try {
    if (fs.existsSync(ETIKETTEN_FILE)) return JSON.parse(fs.readFileSync(ETIKETTEN_FILE, 'utf8'));
  } catch {}
  return { eintraege: [], nextId: 1 };
}
function speichereEtikettenDB(db) {
  fs.writeFileSync(ETIKETTEN_FILE, JSON.stringify(db, null, 2), 'utf8');
}
let etikettenDB = ladeEtikettenDB();

app.get('/api/etiketten', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sorted = [...etikettenDB.eintraege].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'offen' ? -1 : 1;
    return new Date(b.erstellt_am) - new Date(a.erstellt_am);
  });
  res.json(sorted);
});

app.post('/api/etiketten', (req, res) => {
  const { artikel_id, artikelname, artikelnummer, lagerort, menge, gemeldet_von, typ, lieferung, mhd, quelle, ref_auftrag_id } = req.body;
  if (!artikelname?.trim()) return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  const eintrag = {
    id: etikettenDB.nextId++,
    artikel_id: artikel_id || null,
    artikelname: artikelname.trim(),
    artikelnummer: (artikelnummer || '').trim(),
    lagerort: (lagerort || '').trim(),
    menge: (menge || '').toString().trim(),
    gemeldet_von: (gemeldet_von || '').trim(),
    typ: typ || 'lieferung',
    lieferung: (lieferung || '').trim(),
    mhd: (mhd || '').trim(),
    quelle: (quelle || '').trim(),
    ref_auftrag_id: ref_auftrag_id || null,
    erstellt_am: new Date().toISOString(),
    status: 'offen',
    erledigt_von: null,
    erledigt_am: null,
  };
  etikettenDB.eintraege.push(eintrag);
  speichereEtikettenDB(etikettenDB);
  io.emit('etikett_neu', eintrag);
  res.json(eintrag);
});

app.patch('/api/etiketten/:id/erledigt', (req, res) => {
  const id = parseInt(req.params.id);
  const { erledigt_von } = req.body;
  const eintrag = etikettenDB.eintraege.find(e => e.id === id);
  if (!eintrag) return res.status(404).json({ error: 'Nicht gefunden' });
  eintrag.status = 'erledigt';
  eintrag.erledigt_von = (erledigt_von || '').trim();
  eintrag.erledigt_am = new Date().toISOString();
  speichereEtikettenDB(etikettenDB);
  io.emit('etikett_erledigt', eintrag);

  // Verknüpften Lager-Artikel markieren
  if (eintrag.artikel_id) {
    const artikel = db.artikel.find(a => a.id === eintrag.artikel_id);
    if (artikel) {
      artikel.etiketten_fertig = true;
      artikel.etiketten_fertig_von = eintrag.erledigt_von;
      speichereDB(db);
      io.emit('artikel_etiketten_fertig', artikel);
    }
  }

  res.json(eintrag);
});

app.patch('/api/etiketten/:id/abschliessen', (req, res) => {
  const id = parseInt(req.params.id);
  const eintrag = etikettenDB.eintraege.find(e => e.id === id);
  if (!eintrag) return res.status(404).json({ error: 'Nicht gefunden' });
  eintrag.abgeschlossen = true;
  speichereEtikettenDB(etikettenDB);
  res.json(eintrag);
});

app.delete('/api/etiketten/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = etikettenDB.eintraege.findIndex(e => e.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Nicht gefunden' });
  etikettenDB.eintraege.splice(idx, 1);
  speichereEtikettenDB(etikettenDB);
  io.emit('etikett_geloescht', { id });
  res.json({ ok: true });
});

// Palettenlieferungen
const PALETTEN_LIEF_FILE      = path.join(__dirname, '..', 'palettenlieferungen', 'lieferungen.json');
const PALETTEN_LIEFERANT_FILE = path.join(__dirname, '..', 'palettenlieferungen', 'lieferanten.json');
app.get('/api/palettenlieferungen', (req, res) => {
  try {
    const { lieferungen } = JSON.parse(fs.readFileSync(PALETTEN_LIEF_FILE, 'utf8'));
    const lieferanten = JSON.parse(fs.readFileSync(PALETTEN_LIEFERANT_FILE, 'utf8'));
    const map = Object.fromEntries(lieferanten.map(l => [l.kuerzel, l.name]));
    const result = lieferungen.map(l => ({ ...l, lieferantName: map[l.lieferant] || l.lieferant }));
    res.json({ lieferungen: result });
  } catch { res.status(500).json({ error: 'Fehler beim Lesen' }); }
});

app.get('/api/lieferanten', (req, res) => {
  try {
    const alle = JSON.parse(fs.readFileSync(PALETTEN_LIEFERANT_FILE, 'utf8'));
    res.json(alle.filter(l => l.name));
  } catch { res.json([]); }
});

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
