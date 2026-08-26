const https = require('https');

const OWNER = 'krioku-can';
const REPO = 'workout-tracker';
const FILE_PATH = 'data/workouts.json';
const BRANCH = 'main';

// GitHub token from environment
const TOKEN = process.env.GITHUB_TOKEN || '';

const DEFAULT_DATA = {
  names: { chris: 'Chris', chey: 'Chey' },
  workouts: {},
  streaks: {
    chris: { streak: 0, total: 0, today: false },
    chey: { streak: 0, total: 0, today: false }
  }
};

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/' + OWNER + '/' + REPO + path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'User-Agent': 'workout-tracker',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadData() {
  try {
    const res = await githubRequest('GET', '/contents/' + FILE_PATH + '?ref=' + BRANCH);
    if (res.status === 200) {
      const content = Buffer.from(res.data.content, 'base64').toString('utf8');
      const parsed = JSON.parse(content);
      // Merge with defaults to handle empty or partial data
      const defaults = JSON.parse(JSON.stringify(DEFAULT_DATA));
      if (parsed.names) defaults.names = parsed.names;
      if (parsed.workouts) defaults.workouts = parsed.workouts;
      if (parsed.streaks) defaults.streaks = parsed.streaks;
      return defaults;
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

async function saveData(data) {
  try {
    // Get current file info (for sha)
    const current = await githubRequest('GET', '/contents/' + FILE_PATH + '?ref=' + BRANCH);
    const sha = current.status === 200 ? current.data.sha : null;

    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

    const body = {
      message: 'Workout update: ' + new Date().toISOString().slice(0, 10),
      content: content,
      branch: BRANCH,
    };
    if (sha) body.sha = sha;

    const res = await githubRequest('PUT', '/contents/' + FILE_PATH, body);
    if (res.status === 200 || res.status === 201) {
      return true;
    }
    console.error('GitHub save error:', res.status, JSON.stringify(res.data).slice(0, 200));
    return false;
  } catch (e) {
    console.error('Error saving data:', e.message);
    return false;
  }
}

function recalcStreaks(data) {
  const today = new Date();
  const todayStr = today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');

  for (const user of ['chris', 'chey']) {
    const userWorkouts = data.workouts[user] || {};
    const dates = Object.keys(userWorkouts)
      .filter(d => userWorkouts[d] === true || userWorkouts[d] > 0)
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

// Shared core: read state, mutate via the canonical contract, write, return.
// Used by both the REST API (api/workout.js) and the MCP server (api/workout-mcp.js).
// Contract: POST-style mutations go through `applySet(data, {user, date, count})`.
//   - count > 0   → workouts[user][date] = count
//   - count === 0 → delete workouts[user][date]
//   - count null/undefined → delete workouts[user][date]  (backward compat)
function applySet(data, { user, date, count }) {
  if (!user || !date) throw new Error('Missing user or date');
  if (!['chris', 'chey'].includes(user)) throw new Error('Invalid user');
  if (!data.workouts[user]) data.workouts[user] = {};
  if (typeof count === 'number') {
    if (count > 0) data.workouts[user][date] = count;
    else delete data.workouts[user][date];
  } else {
    delete data.workouts[user][date];
  }
  return recalcStreaks(data);
}

// Today as YYYY-MM-DD in the server's local timezone (matches recalcStreaks).
function todayLocal() {
  const today = new Date();
  return today.getFullYear() + '-' +
    String(today.getMonth() + 1).padStart(2, '0') + '-' +
    String(today.getDate()).padStart(2, '0');
}

module.exports = {
  loadData,
  saveData,
  recalcStreaks,
  applySet,
  todayLocal,
  // The default export remains the Vercel handler so the existing /api/workout
  // route keeps working unchanged.
  default: async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    if (req.method === 'GET') {
      const data = await loadData();
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(data);
      return;
    }

    if (req.method === 'POST') {
      const { user, date, count } = req.body;
      try {
        const data = await loadData();
        applySet(data, { user, date, count });
        const saved = await saveData(data);
        if (!saved) { res.status(500).json({ error: 'Failed to save data' }); return; }
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(data);
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  }
};

