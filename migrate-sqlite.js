// Copie les réservations de l'ancienne base SQLite (data/reservations.db) vers PostgreSQL.
// Sans risque à relancer : les réservations déjà copiées (même id) sont ignorées.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* pas de .env : variables du système */ }
const { Client } = require('pg');

const SQLITE_FILE = path.join(__dirname, 'data', 'reservations.db');

// En local, crée la base PGDATABASE si elle n'existe pas encore
async function ensureDatabase() {
  if (process.env.DATABASE_URL) return;
  const name = process.env.PGDATABASE;
  if (!name) throw new Error('PGDATABASE manquant dans .env');
  if (!process.env.PGPASSWORD) throw new Error('PGPASSWORD est vide dans .env : mettez le mot de passe choisi à l\'installation de PostgreSQL');
  const admin = new Client({ database: 'postgres' });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) {
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`Base « ${name} » créée.`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  if (!fs.existsSync(SQLITE_FILE)) throw new Error(`${SQLITE_FILE} introuvable`);
  await ensureDatabase();

  const { pool, initSchema } = require('./db');
  await initSchema();

  const sqlite = new DatabaseSync(SQLITE_FILE, { readOnly: true });
  const rows = sqlite.prepare('SELECT * FROM reservations ORDER BY id').all();
  sqlite.close();

  let copied = 0;
  for (const r of rows) {
    const { rowCount } = await pool.query(
      `INSERT INTO reservations (id, created_at, name, phone, service, day, slot, status, notified, notify_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.created_at, r.name, r.phone, r.service, r.day, r.slot, r.status, Boolean(r.notified), r.notify_error]);
    copied += rowCount;
  }

  // Les prochaines réservations reprennent la numérotation après le plus grand id
  await pool.query(`SELECT setval(pg_get_serial_sequence('reservations', 'id'), GREATEST((SELECT MAX(id) FROM reservations), 1))`);

  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*)::int AS count FROM reservations');
  console.log(`${rows.length} réservation(s) dans SQLite, ${copied} copiée(s), ${rows.length - copied} déjà présente(s).`);
  console.log(`Total dans PostgreSQL : ${count}.`);
  await pool.end();
}

main().catch((e) => {
  console.error('Migration impossible :', e.message);
  process.exit(1);
});
