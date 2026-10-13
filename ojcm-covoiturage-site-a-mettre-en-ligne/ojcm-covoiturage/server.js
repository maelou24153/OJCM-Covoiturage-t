'use strict';
/*
 * OJCM Covoiturage : serveur sans dépendance externe (Node.js 18 ou plus récent).
 * Données : un fichier JSON dans le dossier data/ (ou DATA_DIR).
 * Lancement : node server.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ---------- configuration ---------- */
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
})();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const TZ_NAME = process.env.CLUB_TZ || 'Europe/Paris';

fs.mkdirSync(DATA_DIR, { recursive: true });

const SECRET = (function () {
  if (process.env.SECRET && process.env.SECRET.length >= 16) return process.env.SECRET;
  const f = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();

/* ---------- données ---------- */
const DB_FILE = path.join(DATA_DIR, 'data.json');
let db = { events: [], trips: [], bookings: [], settings: { announcement: '' } };
if (fs.existsSync(DB_FILE)) {
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {
    console.error('data.json illisible : copie de sécurité puis démarrage à vide.');
    fs.copyFileSync(DB_FILE, DB_FILE + '.corrompu-' + Date.now());
  }
}
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- utilitaires ---------- */
const CITIES = ['Sigean', 'Narbonne', 'Autre'];
const KINDS = ['competition', 'entrainement', 'stage', 'autre'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newId = (p) => p + crypto.randomBytes(5).toString('hex');
function newCode() {
  let s = '';
  for (const b of crypto.randomBytes(6)) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}
const hmac = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const hashCode = (c) => hmac('code:' + String(c || '').trim().toUpperCase());
function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_NAME });
}
function displayName(full) {
  const t = String(full).trim().split(/\s+/);
  return t.length > 1 ? t[0] + ' ' + t[1][0].toUpperCase() + '.' : t[0];
}
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const x = new Date(d + 'T12:00:00Z');
  return !isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}
const validPhone = (p) => /^[0-9+().\s-]{8,20}$/.test(p) && (p.match(/\d/g) || []).length >= 8;

const eventById = (id) => db.events.find((e) => e.id === id);
const tripById = (id) => db.trips.find((t) => t.id === id);
const bookingsOf = (tid) => db.bookings.filter((b) => b.tripId === tid);
const takenSeats = (tid) => bookingsOf(tid).reduce((a, b) => a + b.seats, 0);

function publicTrip(t) {
  return {
    id: t.id, eventId: t.eventId, driver: displayName(t.name), from: t.from, meet: t.meet,
    time: t.time, seats: t.seats, left: Math.max(0, t.seats - takenSeats(t.id)), note: t.note,
  };
}
function fullTrip(t) {
  return Object.assign(publicTrip(t), {
    name: t.name, phone: t.phone, createdAt: t.createdAt,
    passengers: bookingsOf(t.id).map((b) => ({ id: b.id, name: b.name, phone: b.phone, seats: b.seats, judoka: b.judoka })),
  });
}
function validateEvent(b) {
  const e = {
    title: clean(b.title, 90), kind: KINDS.includes(b.kind) ? b.kind : 'autre',
    date: clean(b.date, 10), time: clean(b.time, 5), place: clean(b.place, 90), info: clean(b.info, 200),
  };
  if (e.title.length < 2) return { error: 'Indiquez un intitulé.' };
  if (!validDate(e.date)) return { error: 'Date invalide.' };
  if (e.time && !validTime(e.time)) return { error: 'Heure invalide.' };
  if (e.place.length < 2) return { error: 'Indiquez le lieu.' };
  return { value: e };
}

/* ---------- limitation de débit ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
  a.push(now);
  hits.set(key, a);
  return a.length > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of hits) if (!a.some((t) => now - t < 900000)) hits.delete(k);
}, 600000).unref();
function clientIp(req) {
  if (TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || 'inconnu';
}

/* ---------- session administrateur ---------- */
function makeSession() {
  const p = String(Date.now() + 12 * 3600 * 1000);
  return p + '.' + hmac('session:' + p);
}
function isAdmin(req) {
  const m = /(?:^|;\s*)ojcm_admin=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [p, sig] = m[1].split('.');
  if (!p || !sig || !/^\d+$/.test(p)) return false;
  return safeEq(sig, hmac('session:' + p)) && Number(p) > Date.now();
}
function cookieFlags(req) {
  const https = COOKIE_SECURE || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
  return 'Path=/; HttpOnly; SameSite=Strict' + (https ? '; Secure' : '');
}

/* ---------- HTTP ---------- */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({}, SEC_HEADERS, headers));
  res.end(body);
}
function json(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20000) { reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('JSON invalide'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  let file;
  try { file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname))); } catch (e) { return send(res, 400, 'Requête invalide'); }
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Page introuvable', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const ext = path.extname(file).toLowerCase();
  const cache = ext === '.png' ? 'public, max-age=86400' : 'no-cache';
  send(res, 200, req.method === 'HEAD' ? undefined : fs.readFileSync(file), {
    'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache,
  });
}

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/* ---------- API publique ---------- */
async function publicApi(req, res, pathname) {
  const ip = clientIp(req);
  if (req.method === 'GET' && pathname === '/api/events') {
    const t0 = today();
    const events = db.events.filter((e) => e.date >= t0)
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
      .map((e) => Object.assign({}, e, {
        trips: db.trips.filter((t) => t.eventId === e.id).sort((a, b) => a.time.localeCompare(b.time)).map(publicTrip),
      }));
    return json(res, 200, { today: t0, announcement: (db.settings && db.settings.announcement) || '', events });
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'Introuvable' });
  if (limited('pub:' + ip, 40, 10 * 60 * 1000)) return json(res, 429, { error: 'Trop de demandes. Réessayez dans quelques minutes.' });
  const b = await readBody(req);
  if (b.website) return json(res, 200, { ok: true }); // piège à robots

  if (pathname === '/api/trips') {
    const ev = eventById(clean(b.eventId, 40));
    if (!ev || ev.date < today()) return json(res, 400, { error: 'Ce rendez-vous n’est plus ouvert.' });
    const t = {
      id: newId('t'), eventId: ev.id, name: clean(b.name, 60), phone: clean(b.phone, 20),
      from: CITIES.includes(b.from) ? b.from : '', meet: clean(b.meet, 80), time: clean(b.time, 5),
      seats: parseInt(b.seats, 10), note: clean(b.note, 200), createdAt: Date.now(),
    };
    if (t.name.length < 2) return json(res, 400, { error: 'Indiquez votre nom.' });
    if (!validPhone(t.phone)) return json(res, 400, { error: 'Indiquez un numéro de téléphone valide.' });
    if (!t.from) return json(res, 400, { error: 'Choisissez la ville de départ.' });
    if (t.from === 'Autre' && !t.meet) return json(res, 400, { error: 'Précisez le point de départ.' });
    if (!validTime(t.time)) return json(res, 400, { error: 'Indiquez l’heure de départ.' });
    if (!(t.seats >= 1 && t.seats <= 8)) return json(res, 400, { error: 'Le nombre de places doit être compris entre 1 et 8.' });
    const code = newCode();
    t.codeHash = hashCode(code);
    db.trips.push(t);
    save();
    return json(res, 201, { ok: true, trip: publicTrip(t), code });
  }

  if (pathname === '/api/bookings') {
    const t = tripById(clean(b.tripId, 40));
    const ev = t && eventById(t.eventId);
    if (!t || !ev || ev.date < today()) return json(res, 400, { error: 'Ce trajet n’est plus disponible.' });
    const seats = parseInt(b.seats, 10);
    const bk = { id: newId('b'), tripId: t.id, name: clean(b.name, 60), phone: clean(b.phone, 20), seats, judoka: clean(b.judoka, 100), createdAt: Date.now() };
    if (bk.name.length < 2) return json(res, 400, { error: 'Indiquez votre nom.' });
    if (!validPhone(bk.phone)) return json(res, 400, { error: 'Indiquez un numéro de téléphone valide.' });
    if (!(seats >= 1 && seats <= 8)) return json(res, 400, { error: 'Nombre de places invalide.' });
    if (seats > t.seats - takenSeats(t.id)) return json(res, 409, { error: 'Il ne reste plus assez de places sur ce trajet.' });
    const code = newCode();
    bk.codeHash = hashCode(code);
    db.bookings.push(bk);
    save();
    return json(res, 201, { ok: true, booking: { id: bk.id, seats }, code, trip: publicTrip(t), driver: { name: t.name, phone: t.phone } });
  }

  if (pathname === '/api/manage' || pathname === '/api/delete') {
    if (limited('code:' + ip, 40, 15 * 60 * 1000)) return json(res, 429, { error: 'Trop d’essais. Réessayez plus tard.' });
    const h = hashCode(b.code);
    let kind, item;
    if (b.id) {
      kind = b.kind === 'booking' ? 'booking' : 'trip';
      item = kind === 'trip' ? tripById(clean(b.id, 40)) : db.bookings.find((x) => x.id === clean(b.id, 40));
    } else {
      kind = 'trip';
      item = db.trips.find((x) => safeEq(x.codeHash, h));
      if (!item) { kind = 'booking'; item = db.bookings.find((x) => safeEq(x.codeHash, h)); }
    }
    if (!item || !safeEq(item.codeHash, h)) return json(res, 404, { error: 'Code introuvable. Vérifiez qu’il est bien saisi.' });
    if (pathname === '/api/delete') {
      if (kind === 'trip') {
        db.bookings = db.bookings.filter((x) => x.tripId !== item.id);
        db.trips = db.trips.filter((x) => x.id !== item.id);
      } else {
        db.bookings = db.bookings.filter((x) => x.id !== item.id);
      }
      save();
      return json(res, 200, { ok: true });
    }
    if (kind === 'trip') {
      const ev = eventById(item.eventId);
      return json(res, 200, { kind, event: ev || null, trip: fullTrip(item) });
    }
    const t = tripById(item.tripId);
    return json(res, 200, {
      kind, event: t ? eventById(t.eventId) || null : null, trip: t ? publicTrip(t) : null,
      driver: t ? { name: t.name, phone: t.phone } : null,
      booking: { id: item.id, seats: item.seats, name: item.name, judoka: item.judoka },
    });
  }
  return json(res, 404, { error: 'Introuvable' });
}

/* ---------- API administrateur ---------- */
async function adminApi(req, res, pathname) {
  const ip = clientIp(req);
  if (pathname === '/api/admin/me' && req.method === 'GET') {
    return json(res, 200, { admin: isAdmin(req), configured: !!ADMIN_PASSWORD });
  }
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    if (!ADMIN_PASSWORD) return json(res, 503, { error: 'Le mot de passe administrateur n’est pas configuré sur le serveur (variable ADMIN_PASSWORD).' });
    if (limited('login:' + ip, 8, 15 * 60 * 1000)) return json(res, 429, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    const b = await readBody(req);
    if (!safeEq(hmac('pw:' + String(b.password || '')), hmac('pw:' + ADMIN_PASSWORD))) {
      return json(res, 401, { error: 'Mot de passe incorrect.' });
    }
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'ojcm_admin=' + makeSession() + '; Max-Age=43200; ' + cookieFlags(req) });
  }
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'ojcm_admin=; Max-Age=0; ' + cookieFlags(req) });
  }
  if (!isAdmin(req)) return json(res, 401, { error: 'Connexion administrateur requise.' });
  if (req.method !== 'GET' && req.headers['x-ojcm'] !== '1') return json(res, 403, { error: 'Requête refusée.' });

  if (pathname === '/api/admin/data' && req.method === 'GET') {
    return json(res, 200, {
      today: today(), settings: db.settings, events: db.events,
      trips: db.trips.map(fullTrip),
    });
  }
  if (pathname === '/api/admin/export.csv' && req.method === 'GET') {
    const rows = [['Rendez-vous', 'Date', 'Ville de départ', 'Heure', 'Conducteur', 'Téléphone conducteur', 'Places offertes', 'Places réservées', 'Passager', 'Téléphone passager', 'Places', 'Judoka']];
    db.trips.forEach((t) => {
      const ev = eventById(t.eventId) || { title: '(supprimé)', date: '' };
      const base = [ev.title, ev.date, t.from === 'Autre' ? t.meet : t.from, t.time, t.name, t.phone, t.seats, takenSeats(t.id)];
      const bs = bookingsOf(t.id);
      if (!bs.length) rows.push(base.concat(['', '', '', '']));
      bs.forEach((b) => rows.push(base.concat([b.name, b.phone, b.seats, b.judoka])));
    });
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
    return send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="ojcm-covoiturage-' + today() + '.csv"',
    });
  }

  let m;
  if (pathname === '/api/admin/events' && req.method === 'POST') {
    const v = validateEvent(await readBody(req));
    if (v.error) return json(res, 400, { error: v.error });
    const e = Object.assign({ id: newId('e') }, v.value);
    db.events.push(e);
    save();
    return json(res, 201, { ok: true, event: e });
  }
  if ((m = /^\/api\/admin\/events\/([A-Za-z0-9]+)$/.exec(pathname))) {
    const e = eventById(m[1]);
    if (!e) return json(res, 404, { error: 'Rendez-vous introuvable.' });
    if (req.method === 'PUT') {
      const v = validateEvent(await readBody(req));
      if (v.error) return json(res, 400, { error: v.error });
      Object.assign(e, v.value);
      save();
      return json(res, 200, { ok: true, event: e });
    }
    if (req.method === 'DELETE') {
      const ids = db.trips.filter((t) => t.eventId === e.id).map((t) => t.id);
      db.bookings = db.bookings.filter((b) => !ids.includes(b.tripId));
      db.trips = db.trips.filter((t) => t.eventId !== e.id);
      db.events = db.events.filter((x) => x.id !== e.id);
      save();
      return json(res, 200, { ok: true, removedTrips: ids.length });
    }
  }
  if ((m = /^\/api\/admin\/trips\/([A-Za-z0-9]+)$/.exec(pathname)) && req.method === 'DELETE') {
    if (!tripById(m[1])) return json(res, 404, { error: 'Trajet introuvable.' });
    db.bookings = db.bookings.filter((b) => b.tripId !== m[1]);
    db.trips = db.trips.filter((t) => t.id !== m[1]);
    save();
    return json(res, 200, { ok: true });
  }
  if ((m = /^\/api\/admin\/bookings\/([A-Za-z0-9]+)$/.exec(pathname)) && req.method === 'DELETE') {
    db.bookings = db.bookings.filter((b) => b.id !== m[1]);
    save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/settings' && req.method === 'PUT') {
    const b = await readBody(req);
    db.settings = Object.assign({}, db.settings, { announcement: clean(b.announcement, 400) });
    save();
    return json(res, 200, { ok: true, settings: db.settings });
  }
  return json(res, 404, { error: 'Introuvable' });
}

/* Suppression automatique des rendez-vous terminés depuis longtemps (noms et téléphones compris). */
function purge() {
  const days = parseInt(process.env.PURGE_DAYS, 10) || 90;
  const limit = new Date(Date.now() - days * 864e5).toLocaleDateString('en-CA', { timeZone: TZ_NAME });
  const old = db.events.filter((e) => e.date < limit).map((e) => e.id);
  if (!old.length) return;
  const tids = db.trips.filter((t) => old.includes(t.eventId)).map((t) => t.id);
  db.bookings = db.bookings.filter((b) => !tids.includes(b.tripId));
  db.trips = db.trips.filter((t) => !old.includes(t.eventId));
  db.events = db.events.filter((e) => !old.includes(e.id));
  save();
  console.log('Nettoyage : ' + old.length + ' ancien(s) rendez-vous supprimé(s).');
}
purge();
setInterval(purge, 864e5).unref();

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    if (pathname.startsWith('/api/admin/')) return await adminApi(req, res, pathname);
    if (pathname.startsWith('/api/')) return await publicApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Méthode non autorisée');
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Erreur interne du serveur.' });
    if (!e.status) console.error(e);
  }
});
server.listen(PORT, HOST, () => {
  console.log('OJCM Covoiturage : http://localhost:' + PORT + '  (administration : /admin)');
  if (!ADMIN_PASSWORD) console.warn('ATTENTION : ADMIN_PASSWORD n’est pas défini, l’espace administrateur est désactivé.');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
