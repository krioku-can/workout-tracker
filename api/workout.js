const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join('/tmp', 'workout-data.json');

const DEFAULT_DATA = {
  names: { chris: 'Chris', chey: 'Chey' },
  workouts: {},
  streaks: {
    chris: { streak: 0, total: 0, today: false },
    chey: { streak: 0, total: 0, today: false }
  }
};

function loadData() {
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

      // Calculate current streak
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    const data = loadData();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);
    return;
  }

  if (req.method === 'POST') {
    const { user, date } = req.body;
    if (!user || !date) {
      res.status(400).json({ error: 'Missing user or date' });
      return;
    }
    if (!['chris', 'chey'].includes(user)) {
      res.status(400).json({ error: 'Invalid user' });
      return;
    }

    const data = loadData();
    if (!data.workouts[user]) data.workouts[user] = {};

    // Toggle: if already done, undo it
    if (data.workouts[user][date] === true) {
      delete data.workouts[user][date];
    } else {
      data.workouts[user][date] = true;
    }

    recalcStreaks(data);
    saveData(data);

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
