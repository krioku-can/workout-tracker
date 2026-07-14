const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3456;
const DATA_DIR = path.join(os.homedir(), '.hermes', 'workout-data');
const DATA_FILE = path.join(DATA_DIR, 'workouts.json');
const HTML_FILE = path.join(__dirname, 'index.html');

// ─── Data Layer ────────────────────────────────────────────
const DEFAULT_DATA = {
  names: { chris: 'Chris', chey: 'Chey' },
  workouts: {},
  streaks: {
    chris: { streak: 0, total: 0, today: false },
    chey: { streak: 0, total: 0, today: false }
  }
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function recalcStreaks(data) {
  const today = new Date();
  const todayStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  for (const user of ['chris', 'chey']) {
    const userWorkouts = data.workouts[user] || {};
    const dates = Object.keys(userWorkouts)
      .filter(d => userWorkouts[d] === true)
      .sort()
      .reverse();

    data.streaks[user] = { streak: 0, total: dates.length, today: false };

    if (dates.length > 0) {
      data.streaks[user].today = dates[0] === todayStr;

      let streak = 0;
      const current = new Date();
      for (let i = 0; i < dates.length; i++) {
        const d = new Date(dates[i] + 'T12:00:00');
        const expected = new Date(current);
        expected.setDate(current.getDate() - i);
        if (d.toDateString() === expected.toDateString()) {
          streak++;
        } else {
          break;
        }
      }
      data.streaks[user].streak = streak;
    }
  }
  return data;
}

// ─── MIME Types ─────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ─── Server ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── API Route ──────────────────────────────────────────
  if (pathname === '/api/workout' || pathname === '/api/workouts') {
    if (req.method === 'GET') {
      const data = loadData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { user, date } = JSON.parse(body);
          if (!user || !date) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing user or date' }));
            return;
          }
          if (!['chris', 'chey'].includes(user)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid user' }));
            return;
          }

          const data = loadData();
          if (!data.workouts[user]) data.workouts[user] = {};

          if (data.workouts[user][date] === true) {
            delete data.workouts[user][date];
          } else {
            data.workouts[user][date] = true;
          }

          recalcStreaks(data);
          saveData(data);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  // ─── Static Files ───────────────────────────────────────
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = HTML_FILE;
  } else {
    filePath = path.join(__dirname, pathname);
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Fallback to index.html for SPA-like routing
      fs.readFile(HTML_FILE, (err2, content2) => {
        if (err2) {
          res.writeHead(500);
          res.end('Internal server error');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

// ─── Start ──────────────────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  🏋️  Workout Tracker is running!');
  console.log('');
  console.log('  Local:    http://localhost:' + PORT);
  console.log('  Network:  http://' + ip + ':' + PORT + '  (open this on your phone)');
  console.log('');
  console.log('  Data stored at: ' + DATA_FILE);
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
