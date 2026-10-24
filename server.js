// Serveur du site : sert la page, enregistre les réservations dans PostgreSQL
// et prévient le propriétaire par WhatsApp (Node >= 22.13, dépendance : pg).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* pas de .env : variables du système */ }
const { pool, initSchema } = require('./db');
const { notifyOwner } = require('./whatsapp');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

// Base de données
const insertResa = (r) => pool.query(
  'INSERT INTO reservations (name, phone, service, day, slot) VALUES ($1, $2, $3, $4, $5) RETURNING id',
  [r.name, r.phone, r.service, r.day, r.slot]);
const markNotified = (ok, err, id) => pool.query('UPDATE reservations SET notified = $1, notify_error = $2 WHERE id = $3', [ok, err, id]);
const listResas = () => pool.query('SELECT * FROM reservations ORDER BY id DESC LIMIT 200');

const SLOTS = ['Matin (avant 12h)', 'Après-midi (12h–17h)', 'Fin de journée (après 17h)'];

// Validation d'une demande ; renvoie { data } ou { error }
function validate(body) {
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const service = String(body.service || '').trim();
  const day = String(body.date || '').trim();
  const slot = String(body.slot || '').trim();

  if (!name || name.length > 60) return { error: 'Indiquez votre prénom.' };
  if (phone.replace(/\D/g, '').length < 8 || phone.length > 25) return { error: 'Indiquez un numéro WhatsApp valide.' };
  if (!service || service.length > 80) return { error: 'Choisissez une prestation.' };
  if (!SLOTS.includes(slot)) return { error: 'Choisissez un moment de la journée.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Choisissez un jour.' };

  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (isNaN(date) || date < today) return { error: 'Choisissez un jour à venir.' };
  if (date.getDay() === 1) return { error: 'Le salon est fermé le lundi. Choisissez un autre jour.' };

  return { data: { name, phone, service, day, slot, date } };
}

// Anti-abus très simple : 5 demandes max par IP toutes les 10 minutes
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10000) { reject(new Error('trop gros')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function createReservation(req, res) {
  // En ligne (Render), la requête passe par un proxy : l'IP du client est dans X-Forwarded-For
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  if (tooMany(ip)) return sendJson(res, 429, { error: 'Trop de demandes. Réessayez dans quelques minutes.' });

  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'Requête invalide.' }); }
  if (body.website) return sendJson(res, 201, { ok: true }); // champ piège rempli par les robots

  const { data, error } = validate(body);
  if (error) return sendJson(res, 400, { error });

  const { rows } = await insertResa(data);
  const id = rows[0].id;
  sendJson(res, 201, { ok: true, id });

  // Notification après la réponse : le client n'attend pas WhatsApp
  const label = data.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const text = `Nouvelle réservation n°${id}\n` +
    `${data.name} · ${data.phone}\n` +
    `${data.service}\n` +
    `Le ${label}, ${data.slot.toLowerCase()}`;
  try {
    await notifyOwner(text);
    await markNotified(true, null, id);
  } catch (e) {
    console.error(`WhatsApp non envoyé pour la réservation ${id} :`, e.message);
    await markNotified(false, e.message, id);
  }
}

async function listReservations(req, res) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) return sendJson(res, 401, { error: 'Non autorisé.' });
  const { rows } = await listResas();
  sendJson(res, 200, rows);
}

// Fichiers statiques : uniquement la page et les images
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
function serveStatic(pathname, res) {
  let file;
  if (pathname === '/' || pathname === '/index.html') file = 'index.html';
  else if (/^\/img\/[\w-]+\.(jpe?g|png|webp)$/.test(pathname)) file = pathname.slice(1);
  if (!file) { res.writeHead(404); return res.end('Page introuvable'); }

  fs.readFile(path.join(ROOT, file), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Page introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/reservations' && req.method === 'POST') return createReservation(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Erreur du serveur.' });
  });
  if (pathname === '/api/reservations' && req.method === 'GET') return listReservations(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Erreur du serveur.' });
  });
  if (req.method === 'GET') return serveStatic(pathname, res);
  res.writeHead(405); res.end();
});

initSchema().then(() => {
  server.listen(PORT, () => {
    console.log(`Le Fil du Rasoir : http://localhost:${PORT}`);
    console.log(`WhatsApp : ${process.env.WHATSAPP_PROVIDER || 'aucun'} → ${process.env.OWNER_WHATSAPP || '(numéro non configuré)'}`);
  });
}).catch((e) => {
  console.error('Connexion à PostgreSQL impossible :', e.message);
  console.error('Vérifiez PGHOST, PGUSER, PGPASSWORD et PGDATABASE dans .env (voir README.md).');
  process.exit(1);
});
