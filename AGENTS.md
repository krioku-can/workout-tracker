# AGENTS.md — Workout Tracker (Chris & Chey)

## What this is
Shared nightly workout web app for **Chris + Chey**:
- Bodyweight weekly plan + timer + streaks
- Couch to 5K tab (localStorage for run checkoffs)
- Mark Complete persists to shared backend

**Production URL:** https://workout-tracker-tau-blush.vercel.app  
**Repo:** https://github.com/krioku-can/workout-tracker  
**Users:** `chris` | `chey` only

## Stack
| Piece | Role |
|-------|------|
| `index.html` | Entire frontend (HTML/CSS/JS, no framework) |
| `api/workout.js` | Vercel serverless API — GET/POST workouts |
| `data/workouts.json` | Durable store via GitHub Contents API |
| `server.js` | Optional **local** server (port 3456, writes `~/.hermes/workout-data/`) |
| `vercel.json` | Rewrites for SPA + API |

## Run / deploy
```bash
# Local UI + local JSON store
node server.js
# → http://localhost:3456

# Production
vercel deploy --prod
# Env required on Vercel: GITHUB_TOKEN (repo write to krioku-can/workout-tracker)
```

## Data model (`data/workouts.json`)
```json
{
  "names": { "chris": "Chris", "chey": "Chey" },
  "workouts": { "chris": { "YYYY-MM-DD": true }, "chey": {} },
  "streaks": {
    "chris": { "streak": 0, "total": 0, "today": false },
    "chey": { "streak": 0, "total": 0, "today": false }
  }
}
```
- POST toggles a date for a user, recalculates streaks, commits to GitHub.
- 5K run progress is **browser localStorage** (`workoutTracker5k`) — not shared via API yet.

## Conventions
- Mobile-first, single-column (~500px), dark theme
- Keep as one `index.html` unless complexity forces a split
- API path the frontend uses: `/api/workout`
- String concat carefully in `index.html` (no bare `</div>` outside quotes — that blanked the page once)
- Prefer durable GitHub storage for shared bodyweight data; local server is fallback/dev only

## Never do
- Don’t wipe `data/workouts.json` without backup
- Don’t store secrets in the repo (token = Vercel env only)
- Don’t add auth complexity unless Chris asks — privacy is “shared couple app,” not public multi-tenant SaaS
- Don’t put employer/work content in this project
- Don’t auto-deploy half-broken JS — run a syntax check on the script block after edits

## Known next ideas (optional)
- Visual exercise demos (YouTube Shorts) on each exercise card
- Share 5K progress via same API as bodyweight
- PWA / home-screen install

## Who owns decisions
Chris (product). Lumi/Hermes implements and ships in one session when asked.
