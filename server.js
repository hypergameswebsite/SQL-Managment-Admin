import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const serversFile = path.join(dataDir, 'servers.json');
const supportedTypes = ['mysql', 'postgres', 'sqlite'];

function ensureDataFolder() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(serversFile)) {
    fs.writeFileSync(serversFile, JSON.stringify({ servers: [] }, null, 2));
  }
}

function loadServers() {
  ensureDataFolder();
  const raw = fs.readFileSync(serversFile, 'utf8');
  return JSON.parse(raw).servers || [];
}

function saveServers(servers) {
  ensureDataFolder();
  fs.writeFileSync(serversFile, JSON.stringify({ servers }, null, 2));
}

function findServer(id) {
  const servers = loadServers();
  return servers.find((server) => server.id === id);
}

function normalizeServer(server) {
  return {
    ...server,
    port: server.port || (server.type === 'postgres' ? 5432 : 3306),
    database: server.database || undefined,
  };
}

function getSqlitePath(server) {
  const defaultFile = `sqlite-${server.id}.db`;
  const filePath = server.filePath ? String(server.filePath).trim() : defaultFile;
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(dataDir, filePath);
}

function openSqlite(server) {
  const sqlitePath = getSqlitePath(server);
  const sqliteDir = path.dirname(sqlitePath);
  if (!fs.existsSync(sqliteDir)) {
    fs.mkdirSync(sqliteDir, { recursive: true });
  }
  return new Database(sqlitePath);
}

async function createConnection(server) {
  const normalized = normalizeServer(server);
  if (normalized.type === 'mysql') {
    return mysql.createConnection({
      host: normalized.host,
      port: normalized.port,
      user: normalized.user,
      password: normalized.password,
      database: normalized.database,
      connectTimeout: 10000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
    });
  }

  if (normalized.type === 'postgres') {
    const client = new PgClient({
      host: normalized.host,
      port: normalized.port,
      user: normalized.user,
      password: normalized.password,
      database: normalized.database,
      connectionTimeoutMillis: 10000,
    });
    await client.connect();
    return client;
  }

  if (normalized.type === 'sqlite') {
    return openSqlite(normalized);
  }

  throw new Error(`Unsupported server type: ${normalized.type}`);
}

function rowsToPlain(rows) {
  return JSON.parse(JSON.stringify(rows));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/servers', (req, res) => {
  const servers = loadServers();
  res.json({ servers });
});

app.post('/api/servers', async (req, res) => {
  const type = String(req.body.type || 'mysql').trim();
  const name = String(req.body.name || `New ${type} server`).trim();
  const host = String(req.body.host || '').trim();
  const port = Number(req.body.port || (type === 'postgres' ? 5432 : 3306));
  const user = String(req.body.user || '').trim();
  const password = String(req.body.password || '');
  const database = String(req.body.database || '').trim();
  const filePath = String(req.body.filePath || '').trim();

  if (!supportedTypes.includes(type)) {
    return res.status(400).json({ error: `Unsupported server type. Supported: ${supportedTypes.join(', ')}.` });
  }

  if (!name) {
    return res.status(400).json({ error: 'Server name is required.' });
  }

  if (type !== 'sqlite' && (!host || !user)) {
    return res.status(400).json({ error: 'Host and user are required for MySQL/PostgreSQL.' });
  }

  const servers = loadServers();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const server = { id, type, name, host, port, user, password, database, filePath, createdAt: new Date().toISOString() };

  try {
    const connection = await createConnection(server);

    if (type === 'sqlite') {
      connection.close();
    } else if (type === 'postgres') {
      await connection.end();
    } else {
      await connection.query('SELECT 1');
      await connection.end();
    }
  } catch (error) {
    return res.status(400).json({ error: `Unable to connect: ${error.message}` });
  }

  servers.push(server);
  saveServers(servers);

  res.status(201).json({ server });
});

app.delete('/api/servers/:id', (req, res) => {
  const id = req.params.id;
  const servers = loadServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  servers.splice(index, 1);
  saveServers(servers);

  res.json({ success: true });
});

app.get('/api/servers/:id/status', async (req, res) => {
  const server = findServer(req.params.id);
  if (!server) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  try {
    if (server.type === 'sqlite') {
      const db = openSqlite(server);
      const row = db.prepare('SELECT sqlite_version() AS version').get();
      db.close();
      return res.json({ type: server.type, version: row.version, host: server.host || 'local', database: server.database || server.filePath || 'local file' });
    }

    const connection = await createConnection(server);
    const query = server.type === 'postgres' ? 'SELECT version() AS version' : 'SELECT VERSION() AS version';
    const result = await connection.query(query);

    let version = '';
    if (server.type === 'postgres') {
      version = result.rows?.[0]?.version || '';
      await connection.end();
    } else {
      version = result[0]?.[0]?.version || result[0]?.version || '';
      await connection.end();
    }

    return res.json({ type: server.type, version, host: server.host, database: server.database || 'default' });
  } catch (error) {
    return res.status(400).json({ error: `Unable to query server status: ${error.message}` });
  }
});

app.get('/api/servers/:id/tables', async (req, res) => {
  const server = findServer(req.params.id);
  if (!server) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  try {
    if (server.type === 'sqlite') {
      const db = openSqlite(server);
      const tables = db
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;")
        .all();
      db.close();
      return res.json({ tables });
    }

    const connection = await createConnection(server);
    if (server.type === 'postgres') {
      const result = await connection.query(`SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`);
      await connection.end();
      return res.json({ tables: rowsToPlain(result.rows) });
    }

    const [rows] = await connection.query("SHOW FULL TABLES WHERE Table_type IN ('BASE TABLE','VIEW')");
    await connection.end();

    const tableKey = rows.length > 0 ? Object.keys(rows[0]).find((key) => key.toLowerCase().startsWith('tables_in')) : 'Tables_in_database';
    const tables = rows.map((row) => ({
      name: row[tableKey],
      type: row.Table_type,
    }));

    res.json({ tables });
  } catch (error) {
    res.status(400).json({ error: `Unable to load tables: ${error.message}` });
  }
});

app.post('/api/servers/:id/query', async (req, res) => {
  const server = findServer(req.params.id);
  if (!server) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  const sql = String(req.body.sql || '').trim();
  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required.' });
  }

  try {
    if (server.type === 'sqlite') {
      const db = openSqlite(server);
      const statement = db.prepare(sql);

      if (sql.toUpperCase().startsWith('SELECT') || sql.toUpperCase().startsWith('PRAGMA') || sql.toUpperCase().startsWith('EXPLAIN')) {
        const rows = statement.all();
        db.close();
        return res.json({ rows: rowsToPlain(rows), columns: rows.length ? Object.keys(rows[0]) : [] });
      }

      const info = statement.run();
      db.close();
      return res.json({ changes: info.changes, lastInsertRowid: info.lastInsertRowid });
    }

    const connection = await createConnection(server);

    if (server.type === 'postgres') {
      const result = await connection.query(sql);
      await connection.end();
      const rows = result.rows || [];
      const fields = result.fields || [];
      if (Array.isArray(rows)) {
        return res.json({ rows: rowsToPlain(rows), columns: fields.map((field) => field.name) });
      }
      return res.json({ changes: result.rowCount, command: result.command });
    }

    const [rows, fields] = await connection.query(sql);
    await connection.end();
    if (Array.isArray(rows)) {
      return res.json({ rows: rowsToPlain(rows), columns: fields ? fields.map((field) => field.name) : [] });
    }
    return res.json({ changes: rows.affectedRows ?? 0, lastInsertRowid: rows.insertId ?? null });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  ensureDataFolder();
  console.log(`SQL dashboard running at http://localhost:${port}`);
});
