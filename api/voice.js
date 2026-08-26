const https = require("https");

const OWNER = "krioku-can";
const REPO = "lumi-voice-memos"; // PRIVATE relay repo
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
        "User-Agent": "lumi-voice",
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

// Upload a base64 audio blob to inbox/<ts>.m4a
async function uploadAudio(ts, b64) {
  const path = "/contents/inbox/" + ts + ".m4a";
  const body = { message: "voice memo " + ts, content: b64, branch: BRANCH };
  const res = await githubRequest("PUT", path, body);
  return res.status === 200 || res.status === 201;
}

// List files in a folder (inbox or reviews)
async function listFolder(folder) {
  const res = await githubRequest("GET", "/contents/" + folder + "?ref=" + BRANCH);
  if (res.status !== 200) return [];
  if (!Array.isArray(res.data)) return [];
  return res.data
    .filter((f) => f.type === "file")
    .map((f) => ({ name: f.name, path: f.path, size: f.size, sha: f.sha }));
}

// Read a file's content (base64)
async function readFile(path) {
  const res = await githubRequest("GET", "/contents/" + path + "?ref=" + BRANCH);
  if (res.status !== 200) return null;
  return res.data.content; // base64
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method === "POST") {
    // Two modes:
    // 1) Upload a voice memo: { audio: <base64>, ts: <timestamp> }
    // 2) Write a review: { kind: "review", name: <stem>, review: <markdown>, transcript: <text> }
    const kind = req.body && req.body.kind;
    if (kind === "review") {
      const name = req.body.name;
      const review = req.body.review;
      const transcript = req.body.transcript || "";
      if (!name || !review) {
        res.status(400).json({ error: "Missing name or review" });
        return;
      }
      const path = "/contents/reviews/" + name + ".md";
      const content = Buffer.from(review).toString("base64");
      const body = { message: "review " + name, content: content, branch: BRANCH };
      const r = await githubRequest("PUT", path, body);
      if (r.status !== 200 && r.status !== 201) {
        res.status(500).json({ error: "Review write failed" });
        return;
      }
      // Also stash the transcript alongside
      if (transcript) {
        const tpath = "/contents/transcripts/" + name + ".txt";
        const tbody = { message: "transcript " + name, content: Buffer.from(transcript).toString("base64"), branch: BRANCH };
        await githubRequest("PUT", tpath, tbody);
      }
      res.status(200).json({ ok: true, name: name + ".md" });
      return;
    }
    const audio = req.body && req.body.audio;
    const ts = req.body && req.body.ts;
    if (!audio || !ts) {
      res.status(400).json({ error: "Missing audio or ts" });
      return;
    }
    const ok = await uploadAudio(ts, audio);
    if (!ok) {
      res.status(500).json({ error: "Upload failed (token may lack access to private repo)" });
      return;
    }
    res.status(200).json({ ok: true, name: ts + ".m4a" });
    return;
  }

  if (req.method === "GET") {
    // ?folder=inbox|reviews|transcripts  → list files
    // ?file=<path>  → read file content (base64)
    if (req.query.file) {
      const content = await readFile(req.query.file);
      if (content === null) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      res.status(200).json({ content: content });
      return;
    }
    const folder = req.query.folder === "reviews" ? "reviews" : (req.query.folder === "transcripts" ? "transcripts" : "inbox");
    const files = await listFolder(folder);
    res.status(200).json({ files: files });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
