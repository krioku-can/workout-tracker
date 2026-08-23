const https = require("https");

const OWNER = "krioku-can";
const REPO = "workout-tracker";
const FILE_PATH = "data/operator-book.json";
const BRANCH = "main";
const TOKEN = process.env.GITHUB_TOKEN || "";
const MAX = 200;

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.github.com",
      path: "/repos/" + OWNER + "/" + REPO + path,
      method: method,
      headers: {
        Authorization: "Bearer " + TOKEN,
        "User-Agent": "lumi-operator-book",
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadData() {
  try {
    const res = await githubRequest("GET", "/contents/" + FILE_PATH + "?ref=" + BRANCH);
    if (res.status === 200) {
      const content = Buffer.from(res.data.content, "base64").toString("utf8");
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed.changes)) parsed.changes = [];
      if (!parsed.records || typeof parsed.records !== "object") parsed.records = {};
      if (!Array.isArray(parsed.rels)) parsed.rels = [];
      return { data: parsed, sha: res.data.sha };
    }
  } catch (e) {
    console.error("operator load", e.message);
  }
  return { data: { updated: null, changes: [] }, sha: null };
}

async function saveData(data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
  const body = {
    message: "Operator book: " + (data.updated || "update"),
    content: content,
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await githubRequest("PUT", "/contents/" + FILE_PATH, body);
  return res.status === 200 || res.status === 201;
}

function clean(s, n) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, n || 240);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method === "GET") {
    const loaded = await loadData();
    res.setHeader("Content-Type", "application/json");
    res.status(200).json(loaded.data);
    return;
  }

  if (req.method === "POST") {
    const kind = clean(req.body && req.body.kind, 32);
    const id = clean(req.body && req.body.id, 64);
    const name = clean(req.body && req.body.name, 80);
    const text = clean(req.body && req.body.text, 400);
    if (!kind || !id) {
      res.status(400).json({ error: "Missing kind or id" });
      return;
    }
    const loaded = await loadData();
    const data = loaded.data;
    if (!data.records) data.records = {};
    if (!Array.isArray(data.rels)) data.rels = [];
    if (kind === "rel-option" && text && data.rels.indexOf(text) === -1) {
      data.rels.push(text);
      if (data.rels.length > 80) data.rels = data.rels.slice(-80);
    }
    const raw = req.body && req.body.patch;
    if (raw && typeof raw === "object") {
      const allowed = ["name", "role", "blurb", "biz", "where", "note", "nextWhat", "nextWhen", "at"];
      const rec = Object.assign({}, data.records[id] || {});
      allowed.forEach((k) => {
        if (raw[k] != null && String(raw[k]).trim()) rec[k] = clean(raw[k], k === "nextWhat" || k === "note" || k === "blurb" ? 240 : 80);
      });
      if (Array.isArray(raw.facts)) {
        rec.facts = raw.facts
          .filter((f) => Array.isArray(f) && f[0] && f[1])
          .slice(-20)
          .map((f) => [clean(f[0], 40), clean(f[1], 160)]);
        rec.factsReplace = true;
      }
      rec.at = new Date().toISOString();
      data.records[id] = rec;
    }
    data.changes.push({
      at: new Date().toISOString(),
      kind: kind,
      id: id,
      name: name,
      text: text,
    });
    if (data.changes.length > MAX) data.changes = data.changes.slice(-MAX);
    data.updated = new Date().toISOString();
    const saved = await saveData(data, loaded.sha);
    if (!saved) {
      res.status(500).json({ error: "Failed to save" });
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({ ok: true, n: data.changes.length });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
