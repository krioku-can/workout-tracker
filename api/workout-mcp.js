// MCP server for the workout tracker. Direct JSON-RPC transport (Transport C
// from the mcp-server-authoring skill) — no SDK, no session state, no SSE.
// Reuses loadData/saveData/recalcStreaks/applySet/todayLocal from api/workout.js
// so the contract stays in one place.
//
// Endpoints:
//   GET  /api/workout-mcp            → health check
//   POST /api/workout-mcp            → JSON-RPC 2.0
//   POST /api/workout-mcp/sse (alt)  → JSON-RPC (xAI sometimes tries /sse suffix)
//
// Tools exposed:
//   log_pushups(user, date, count)   → set absolute count for a date
//   add_to_today(user, delta)        → read current, add delta, write back
//   get_today(user)                  → read today's entry + day context
//   get_streak(user)                 → read streak + total + today
//   get_week(user)                   → Mon–Sun rep counts for the current week
//
// user ∈ {chris, chey}. Anything else returns -32602 invalid params.

const { loadData, saveData, applySet, todayLocal } = require('./workout.js');

const TOOLS = [
  {
    name: 'log_pushups',
    description:
      'Set the pushup count for a specific date. Pass a positive integer count to set, 0 to clear, or omit count to delete the entry. Replaces whatever is stored for that date (does not add).',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', enum: ['chris', 'chey'], description: 'Whose log to write to.' },
        date: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to today if omitted.' },
        count: { type: 'number', description: 'Positive integer = set. 0 = clear. Omit = delete.' },
      },
      required: ['user'],
    },
  },
  {
    name: 'add_to_today',
    description:
      'Read the current pushup count for today, add the given delta, and write the new total back. Use this when the user says "I just did 20 more" — log_pushups would overwrite. delta is a positive or negative integer.',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', enum: ['chris', 'chey'] },
        delta: { type: 'number', description: 'How many to add (negative subtracts).' },
      },
      required: ['user', 'delta'],
    },
  },
  {
    name: 'get_today',
    description:
      "Return today's date, the user's stored count (or false if not logged), and the user's current streak/total.",
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', enum: ['chris', 'chey'] },
      },
      required: ['user'],
    },
  },
  {
    name: 'get_streak',
    description:
      "Return the user's current streak length, total logged days, and whether today is logged.",
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', enum: ['chris', 'chey'] },
      },
      required: ['user'],
    },
  },
  {
    name: 'get_week',
    description:
      'Return pushup counts for each day Monday through Sunday of the current week (server local time). Days with no entry come back as null.',
    inputSchema: {
      type: 'object',
      properties: {
        user: { type: 'string', enum: ['chris', 'chey'] },
      },
      required: ['user'],
    },
  },
];

function asCount(v) {
  // Stored values are either a positive number (the new contract) or boolean
  // true (legacy "did the workout" shape). Anything else means "not logged."
  if (typeof v === 'number' && v > 0) return v;
  if (v === true) return true; // preserve "done but no count" as boolean
  return false;
}

function isoDate(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function weekDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    out.push(d);
  }
  return out;
}

async function handleToolCall(name, args) {
  args = args || {};
  const data = await loadData();
  const today = todayLocal();

  if (name === 'log_pushups') {
    if (!args.user) throw new Error('user is required');
    const date = args.date || today;
    applySet(data, { user: args.user, date, count: args.count });
    const saved = await saveData(data);
    if (!saved) throw new Error('Failed to save');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          user: args.user,
          date,
          stored: asCount(data.workouts[args.user][date]),
        }),
      }],
    };
  }

  if (name === 'add_to_today') {
    if (!args.user) throw new Error('user is required');
    if (typeof args.delta !== 'number') throw new Error('delta (number) is required');
    const current = data.workouts[args.user] && data.workouts[args.user][today];
    const base = typeof current === 'number' ? current : 0;
    const next = Math.max(0, base + args.delta);
    applySet(data, { user: args.user, date: today, count: next });
    const saved = await saveData(data);
    if (!saved) throw new Error('Failed to save');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          user: args.user,
          date: today,
          previous: base,
          delta: args.delta,
          stored: next,
        }),
      }],
    };
  }

  if (name === 'get_today') {
    if (!args.user) throw new Error('user is required');
    const v = data.workouts[args.user] && data.workouts[args.user][today];
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          user: args.user,
          date: today,
          logged: asCount(v),
          streak: (data.streaks[args.user] || {}).streak || 0,
          total: (data.streaks[args.user] || {}).total || 0,
        }),
      }],
    };
  }

  if (name === 'get_streak') {
    if (!args.user) throw new Error('user is required');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data.streaks[args.user] || { streak: 0, total: 0, today: false }),
      }],
    };
  }

  if (name === 'get_week') {
    if (!args.user) throw new Error('user is required');
    const userData = data.workouts[args.user] || {};
    const days = weekDates();
    const out = days.map(d => {
      const iso = isoDate(d);
      return {
        date: iso,
        count: userData[iso] != null ? asCount(userData[iso]) : null,
      };
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ user: args.user, days: out }),
      }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleMessage(body) {
  const { id, method, params } = body || {};
  const err = (code, msg) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'workout-tracker-mcp', version: '1.0.0' },
      },
    };
  }

  if (method === 'notifications/initialized') return null;

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    try {
      const result = await handleToolCall(params && params.name, params && params.arguments);
      return { jsonrpc: '2.0', id, result };
    } catch (e) {
      return { jsonrpc: '2.0', id, error: { code: -32603, message: e.message } };
    }
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  return err(-32601, `Method not found: ${method}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ status: 'ok', server: 'workout-tracker-mcp', tools: TOOLS.map(t => t.name) });
    return;
  }

  if (req.method === 'POST') {
    let body;
    try { body = await readBody(req); }
    catch (e) { res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }); return; }

    try {
      const response = await handleMessage(body);
      if (response === null) { res.status(202).end(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(response);
    } catch (e) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: e.message } });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
