require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'duckadmin';

// DATA_DIR lets Fly.io point this at a persistent volume (e.g. DATA_DIR=/data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'ducks.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const SHIPS_FILE = path.join(DATA_DIR, 'ships.json');
const DEFAULT_SHIPS_FILE = path.join(__dirname, 'config', 'ships.json');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer — save uploaded images to DATA_DIR/uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const sseClients = new Set();

function readDucks() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function writeDucks(ducks) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(ducks, null, 2));
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

function requireAdmin(req, res) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// SSE stream
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  sseClients.add(res);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

app.get('/api/ships', (req, res) => {
  try {
    // Prefer volume copy so it can be updated without redeploying
    const file = fs.existsSync(SHIPS_FILE) ? SHIPS_FILE : DEFAULT_SHIPS_FILE;
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    res.json([]);
  }
});

app.get('/api/ducks', (req, res) => {
  res.json(readDucks());
});

app.post('/api/ducks', upload.single('image'), (req, res) => {
  const { city, finderName, ship } = req.body;
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);

  if (!city || isNaN(lat) || isNaN(lng)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const ducks = readDucks();
  const duck = {
    id: Date.now().toString(),
    city: city.trim(),
    finderName: (finderName || 'Anonymous').trim(),
    ship: ship ? ship.trim() : null,
    lat,
    lng,
    image: req.file ? `/uploads/${req.file.filename}` : null,
    foundAt: new Date().toISOString()
  };
  ducks.push(duck);
  writeDucks(ducks);
  broadcast('duck', duck);
  res.status(201).json(duck);
});

app.get('/api/admin/verify', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true });
});

app.delete('/api/ducks/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const ducks = readDucks();
  const idx = ducks.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [duck] = ducks.splice(idx, 1);
  writeDucks(ducks);
  if (duck.image) {
    const imgPath = path.join(UPLOADS_DIR, path.basename(duck.image));
    fs.unlink(imgPath, () => {});
  }
  broadcast('delete', { id: duck.id });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🦆 DuckMap running at http://localhost:${PORT}`);
  console.log(`   Admin key: ${ADMIN_KEY}  (set ADMIN_KEY env var to change)`);
});
