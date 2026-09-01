'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

// ---------- config ----------
const PORT = Number(process.env.PORT) || 7703;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const TG_MAX_AGE = 24 * 60 * 60; // сколько секунд initData считается свежим

// Кто админ. Задаётся через окружение, без правки кода.
const ADMIN_USERS = (process.env.ADMIN_USERS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const UNITS = ['раз', 'сек'];

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ---------- db ----------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE,
  password_hash TEXT,
  telegram_id   INTEGER UNIQUE,
  display_name  TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name TEXT
);
CREATE TABLE IF NOT EXISTS exercises (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT,
  category_id INTEGER,
  min_reps    INTEGER,
  max_reps    INTEGER,
  unit        TEXT DEFAULT 'раз',
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL,
  reps        INTEGER NOT NULL,
  unit        TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (exercise_id) REFERENCES exercises(id)
);
`);

// ---------- migrations ----------
const userCols = db.prepare('PRAGMA table_info(users)').all();
if (!userCols.some((c) => c.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
}

// ---------- seed ----------
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM exercises').get().c;
  if (count > 0) return;

  const cats = [
    ['push', 'Грудь и руки'],
    ['legs', 'Ноги'],
    ['core', 'Пресс'],
    ['back', 'Спина'],
    ['cardio', 'Кардио'],
  ];
  const insCat = db.prepare('INSERT INTO categories (slug, name) VALUES (?, ?)');
  const catId = {};
  for (const [slug, name] of cats) catId[slug] = insCat.run(slug, name).lastInsertRowid;

  const ex = [
    // name, category, min, max, unit
    ['Отжимания', 'push', 10, 30, 'раз'],
    ['Отжимания с колен', 'push', 8, 20, 'раз'],
    ['Алмазные отжимания', 'push', 6, 15, 'раз'],
    ['Отжимания уголком', 'push', 5, 12, 'раз'],
    ['Обратные отжимания', 'push', 8, 20, 'раз'],

    ['Приседания', 'legs', 15, 40, 'раз'],
    ['Выпады', 'legs', 10, 24, 'раз'],
    ['Приседания-пистолетик', 'legs', 4, 10, 'раз'],
    ['Прыжки из приседа', 'legs', 10, 20, 'раз'],
    ['Подъёмы на носки', 'legs', 20, 40, 'раз'],

    ['Скручивания', 'core', 15, 35, 'раз'],
    ['Планка', 'core', 20, 60, 'сек'],
    ['Подъёмы ног лёжа', 'core', 10, 25, 'раз'],
    ['Русский твист', 'core', 20, 40, 'раз'],
    ['Велосипед', 'core', 20, 50, 'раз'],

    ['Супермен', 'back', 12, 25, 'раз'],
    ['Подтягивания', 'back', 3, 12, 'раз'],
    ['Лодочка', 'back', 15, 40, 'сек'],

    ['Бёрпи', 'cardio', 8, 20, 'раз'],
    ['Прыжки «звёздочка»', 'cardio', 20, 50, 'раз'],
    ['Скалолаз', 'cardio', 20, 50, 'раз'],
    ['Прыжки на месте', 'cardio', 30, 80, 'раз'],
  ];
  const insEx = db.prepare(
    'INSERT INTO exercises (name, category_id, min_reps, max_reps, unit) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((rows) => {
    for (const [name, cat, min, max, unit] of rows) insEx.run(name, catId[cat], min, max, unit);
  });
  tx(ex);
  console.log('Seeded categories and exercises');
}
seed();

// ---------- helpers ----------
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function signToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '90d' });
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    telegram: !!u.telegram_id,
    is_admin: !!u.is_admin,
  };
}

// Права админа считаются из окружения и синхронизируются в БД при каждом запросе,
// поэтому добавить/убрать админа можно просто переменной ADMIN_USERS/ADMIN_TELEGRAM_IDS.
function computeAdmin(u) {
  const byUser = u.username && ADMIN_USERS.includes(String(u.username).toLowerCase());
  const byTg = u.telegram_id && ADMIN_TELEGRAM_IDS.includes(String(u.telegram_id));
  return byUser || byTg ? 1 : 0;
}
function syncAdmin(u) {
  const want = computeAdmin(u);
  if ((u.is_admin ? 1 : 0) !== want) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(want, u.id);
    u.is_admin = want;
  }
  return u;
}

// Проверка подписи Telegram Mini App (initData).
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calcHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // сравнение в постоянное время
  const a = Buffer.from(calcHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > TG_MAX_AGE) return null;

  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

// ---------- auth middleware ----------
function auth(required) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      if (required) return res.status(401).json({ error: 'Нужна авторизация' });
      req.user = null;
      return next();
    }
    try {
      const { uid } = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (!user) throw new Error('no user');
      req.user = syncAdmin(user);
      next();
    } catch {
      if (required) return res.status(401).json({ error: 'Сессия недействительна' });
      req.user = null;
      next();
    }
  };
}

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- auth: register (web) ---
app.post('/api/auth/register', (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  if (username.length < 3 || username.length > 32 || !/^[a-z0-9_.]+$/.test(username)) {
    return res.status(400).json({ error: 'Логин: 3–32 символа, латиница/цифры/_/.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Такой логин уже занят' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
    .run(username, hash, username);
  const user = syncAdmin(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
  res.json({ token: signToken(user), user: publicUser(user) });
});

// --- auth: login (web) ---
app.post('/api/auth/login', (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  syncAdmin(user);
  res.json({ token: signToken(user), user: publicUser(user) });
});

// --- auth: telegram mini app ---
app.post('/api/auth/telegram', (req, res) => {
  if (!BOT_TOKEN) return res.status(503).json({ error: 'BOT_TOKEN не настроен на сервере' });
  const tgUser = verifyTelegramInitData((req.body || {}).initData, BOT_TOKEN);
  if (!tgUser || !tgUser.id) return res.status(401).json({ error: 'Не удалось проверить данные Telegram' });

  const displayName =
    [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
    tgUser.username ||
    `tg_${tgUser.id}`;

  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (!user) {
    const info = db
      .prepare('INSERT INTO users (telegram_id, display_name, username) VALUES (?, ?, ?)')
      .run(tgUser.id, displayName, tgUser.username ? tgUser.username.toLowerCase() : null);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  } else if (user.display_name !== displayName) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, user.id);
    user.display_name = displayName;
  }
  syncAdmin(user);
  res.json({ token: signToken(user), user: publicUser(user) });
});

// --- me ---
app.get('/api/me', auth(true), (req, res) => res.json({ user: publicUser(req.user) }));

// --- categories ---
app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT slug, name FROM categories ORDER BY id').all();
  const totals = db.prepare('SELECT COUNT(*) AS c FROM exercises').get().c;
  res.json({
    categories: [{ slug: 'all', name: 'Все упражнения', count: totals }, ...cats.map((c) => ({
      ...c,
      count: db.prepare('SELECT COUNT(*) AS c FROM exercises e JOIN categories cc ON cc.id = e.category_id WHERE cc.slug = ?').get(c.slug).c,
    }))],
  });
});

// --- random exercise ---
app.get('/api/roll', (req, res) => {
  const slug = String(req.query.category || 'all');
  let row;
  if (slug === 'all') {
    row = db
      .prepare(
        `SELECT e.*, c.name AS category_name, c.slug AS category_slug
         FROM exercises e JOIN categories c ON c.id = e.category_id
         ORDER BY RANDOM() LIMIT 1`
      )
      .get();
  } else {
    row = db
      .prepare(
        `SELECT e.*, c.name AS category_name, c.slug AS category_slug
         FROM exercises e JOIN categories c ON c.id = e.category_id
         WHERE c.slug = ? ORDER BY RANDOM() LIMIT 1`
      )
      .get(slug);
  }
  if (!row) return res.status(404).json({ error: 'Категория пуста' });
  const reps = randInt(row.min_reps, row.max_reps);
  res.json({
    exercise: {
      id: row.id,
      name: row.name,
      category: row.category_name,
      category_slug: row.category_slug,
      min_reps: row.min_reps,
      max_reps: row.max_reps,
      unit: row.unit,
    },
    reps,
    unit: row.unit,
  });
});

// --- save a completed set ---
app.post('/api/logs', auth(true), (req, res) => {
  const { exercise_id, reps } = req.body || {};
  const ex = db.prepare('SELECT * FROM exercises WHERE id = ?').get(exercise_id);
  const n = Number(reps);
  if (!ex) return res.status(400).json({ error: 'Упражнение не найдено' });
  if (!Number.isInteger(n) || n <= 0 || n > 100000) {
    return res.status(400).json({ error: 'Некорректное число повторений' });
  }
  const info = db
    .prepare('INSERT INTO logs (user_id, exercise_id, reps, unit) VALUES (?, ?, ?, ?)')
    .run(req.user.id, ex.id, n, ex.unit);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// --- stats ---
app.get('/api/stats', auth(true), (req, res) => {
  const uid = req.user.id;
  const totals = db
    .prepare('SELECT COUNT(*) AS sets, COALESCE(SUM(reps),0) AS reps FROM logs WHERE user_id = ?')
    .get(uid);

  const byExercise = db
    .prepare(
      `SELECT e.name, e.unit, COUNT(*) AS sets, SUM(l.reps) AS reps
       FROM logs l JOIN exercises e ON e.id = l.exercise_id
       WHERE l.user_id = ?
       GROUP BY e.id ORDER BY reps DESC`
    )
    .all(uid);

  const recent = db
    .prepare(
      `SELECT e.name, l.reps, l.unit, l.created_at
       FROM logs l JOIN exercises e ON e.id = l.exercise_id
       WHERE l.user_id = ?
       ORDER BY l.id DESC LIMIT 20`
    )
    .all(uid);

  const days = db
    .prepare(
      `SELECT DISTINCT date(created_at) AS d FROM logs WHERE user_id = ? ORDER BY d DESC`
    )
    .all(uid)
    .map((r) => r.d);

  // текущая серия дней подряд (по локальной дате сервера)
  let streak = 0;
  if (days.length) {
    const oneDay = 86400000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let cursor = new Date(today);
    const set = new Set(days);
    const fmt = (d) => d.toISOString().slice(0, 10);
    if (!set.has(fmt(cursor))) cursor = new Date(cursor.getTime() - oneDay); // допускаем «вчера»
    while (set.has(fmt(cursor))) {
      streak += 1;
      cursor = new Date(cursor.getTime() - oneDay);
    }
  }

  res.json({
    totals: { sets: totals.sets, reps: totals.reps, activeDays: days.length, streak },
    byExercise,
    recent,
  });
});

// ---------- admin ----------
function adminOnly(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }
  next();
}

function validateExercise(body) {
  const name = String((body && body.name) || '').trim();
  const category_id = Number(body && body.category_id);
  const min = Number(body && body.min_reps);
  const max = Number(body && body.max_reps);
  const unit = String((body && body.unit) || 'раз');
  if (name.length < 2 || name.length > 60) return { error: 'Название: 2–60 символов' };
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) {
    return { error: 'Категория не найдена' };
  }
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < 1) {
    return { error: 'Повторы — целые числа ≥ 1' };
  }
  if (min > max) return { error: 'Минимум не может быть больше максимума' };
  if (max > 100000) return { error: 'Слишком большое число повторов' };
  if (!UNITS.includes(unit)) return { error: 'Единица: «раз» или «сек»' };
  return { value: { name, category_id, min, max, unit } };
}

// список категорий (с id — для админки)
app.get('/api/admin/categories', auth(true), adminOnly, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, slug, name,
        (SELECT COUNT(*) FROM exercises e WHERE e.category_id = categories.id) AS count
       FROM categories ORDER BY id`
    )
    .all();
  res.json({ categories: rows });
});

// создать категорию
app.post('/api/admin/categories', auth(true), adminOnly, (req, res) => {
  let { slug, name } = req.body || {};
  slug = String(slug || '').trim().toLowerCase();
  name = String(name || '').trim();
  if (!/^[a-z0-9_]{2,20}$/.test(slug)) return res.status(400).json({ error: 'slug: 2–20 символов a-z, 0-9, _' });
  if (slug === 'all') return res.status(400).json({ error: 'slug «all» зарезервирован' });
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Название: 2–40 символов' });
  if (db.prepare('SELECT 1 FROM categories WHERE slug = ?').get(slug)) {
    return res.status(409).json({ error: 'Категория с таким slug уже есть' });
  }
  const info = db.prepare('INSERT INTO categories (slug, name) VALUES (?, ?)').run(slug, name);
  res.json({ id: info.lastInsertRowid, slug, name, count: 0 });
});

// удалить категорию (только пустую)
app.delete('/api/admin/categories/:id', auth(true), adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!cat) return res.status(404).json({ error: 'Категория не найдена' });
  const used = db.prepare('SELECT COUNT(*) AS c FROM exercises WHERE category_id = ?').get(id).c;
  if (used > 0) return res.status(409).json({ error: `Сначала уберите упражнения (${used}) из категории` });
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

// список всех упражнений (с числом записанных подходов)
app.get('/api/admin/exercises', auth(true), adminOnly, (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.min_reps, e.max_reps, e.unit,
        c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
        (SELECT COUNT(*) FROM logs l WHERE l.exercise_id = e.id) AS logs
       FROM exercises e JOIN categories c ON c.id = e.category_id
       ORDER BY c.id, e.name`
    )
    .all();
  res.json({ exercises: rows });
});

// создать упражнение
app.post('/api/admin/exercises', auth(true), adminOnly, (req, res) => {
  const { error, value } = validateExercise(req.body);
  if (error) return res.status(400).json({ error });
  const info = db
    .prepare('INSERT INTO exercises (name, category_id, min_reps, max_reps, unit) VALUES (?, ?, ?, ?, ?)')
    .run(value.name, value.category_id, value.min, value.max, value.unit);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// изменить упражнение
app.put('/api/admin/exercises/:id', auth(true), adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM exercises WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Упражнение не найдено' });
  }
  const { error, value } = validateExercise(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(
    'UPDATE exercises SET name = ?, category_id = ?, min_reps = ?, max_reps = ?, unit = ? WHERE id = ?'
  ).run(value.name, value.category_id, value.min, value.max, value.unit, id);
  res.json({ ok: true });
});

// удалить упражнение (только без записанных подходов, чтобы не терять историю)
app.delete('/api/admin/exercises/:id', auth(true), adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const ex = db.prepare('SELECT * FROM exercises WHERE id = ?').get(id);
  if (!ex) return res.status(404).json({ error: 'Упражнение не найдено' });
  const logs = db.prepare('SELECT COUNT(*) AS c FROM logs WHERE exercise_id = ?').get(id).c;
  if (logs > 0) {
    return res.status(409).json({ error: `Нельзя удалить: есть ${logs} записанных подходов. Отредактируйте вместо удаления.` });
  }
  db.prepare('DELETE FROM exercises WHERE id = ?').run(id);
  res.json({ ok: true });
});

// health
app.get('/api/health', (req, res) => res.json({ ok: true, telegram: !!BOT_TOKEN }));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`RandomFitness на http://0.0.0.0:${PORT}`));
