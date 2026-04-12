# My Dict — Project Overview for Claude Code

## What is this?
Personal English vocabulary learning app (PWA) with AI-powered features.
Built by: phawit.boo@gmail.com (also the initial admin account)

---

## Tech Stack

| Layer | Tech | Deploy |
|-------|------|--------|
| Frontend | React 18 + Vite 5 + Tailwind CSS | Vercel |
| Backend | Express.js (Node) | Render (Web Service, not Docker) |
| Database | MongoDB Atlas | `mydict` database |
| Auth | Google OAuth via `@react-oauth/google` | `decodeJWT()` |
| AI | Gemini API (key stored in MongoDB, never in browser) | via `/api/gemini` proxy |

**Dev:** `npm run dev` (runs both server + Vite concurrently)  
**Build:** `npm run build`  
**Server start:** `node server/index.js`

---

## Repository
- GitHub: `https://github.com/phawitb/V-Dict.git` (branch: `main`)
- Frontend env var: `VITE_API_URL` (Vercel) — empty in dev (Vite proxy)
- Backend env vars: `MONGODB_URI`, `PORT`, `FRONTEND_URL`, `VITE_GEMINI_API_KEY` (fallback only)

---

## File Structure

```
/
├── src/
│   ├── App.jsx          # Entire frontend (~2600+ lines, single file)
│   ├── main.jsx         # React entry + Google OAuth provider + SW registration
│   └── index.css        # Tailwind + custom CSS (safe-area, scrollbar, 3D flip)
├── server/
│   └── index.js         # Express API + MongoDB + Gemini proxy
├── public/
│   ├── sw.js            # Service Worker (mydict-v3, network-first for HTML)
│   ├── manifest.json    # PWA manifest
│   └── icon.svg         # App icon (indigo rounded rect + book + "AI")
├── index.html           # viewport-fit=cover + PWA meta tags
└── vercel.json          # COOP header + SPA rewrite rules
```

---

## MongoDB Collections (`mydict` db)

| Collection | Purpose |
|------------|---------|
| `words` | User's saved vocabulary (per userId) |
| `vocab_bank` | Master word list for search suggestions |
| `vocab_levels` | CEFR lesson words with `level` + `order` fields |
| `word_cache` | Gemini dictionary lookups cache (shared) |
| `daily` | Daily words + wordle word (`{date, words[], wordle}`) |
| `config` | Gemini API key + model (`{_id: 'gemini', apiKey, model}`) |
| `admins` | Admin emails (`{email}`) |
| `wordle_scores` | Wordle results per day per user |
| `stories` | AI story cache per word set (`{key: "w1,w2,w3", title, englishStory, thaiTranslation}`) |

---

## App Structure (src/App.jsx)

### Navigation Tabs
- **Find** (`find`) — search vocab, calls `/api/suggest` first, then Gemini if not in vocab_bank
- **My Vocabs** (`vocabs`) — list of saved words
- **Learn** (`learning`) — lesson groups + My Vocabs sub-groups
- **Daily** (`wotd`) — Word of the Day + Practice + Wordle
- **Profile** (`profile`) — streak, SRS stats, logout, Admin button (if admin)
- **Admin** (`admin`) — Gemini config, model picker, admin management (via Profile)

### Key Components
- `FindView` — search with autocomplete, Gemini fallback, auto-focus on magnifier tap
- `LearningView` — lesson selector → `LevelStudySession` or `MyVocabsSession`
- `LevelStudySession` — lesson sub-groups (5 words each), score dots
- `MyVocabsSession` — same structure as LevelStudySession but uses saved words
- `SubGroupPractice` — 6-stage practice flow per group:
  1. Flashcards → 2. Matching → 3. Multiple Choice → 4. Fill in Blank → 5. AI Story → 6. SRS Review
- `SubGroupAIStory` — auto-generates + caches story per word set in DB (shared for all users)
- `DailyWordle` — day picker (20 days), Play/Ranking tabs
- `WordleGame` — validates guess via `api.dictionaryapi.dev` before accepting
- `WordleLeaderboard` — medals + win % display
- `SRSReview` — SM-2 spaced repetition (supports `forceAll` prop + `onNext` prop)
- `AIStoryGame` — free-form story (my_vocabs tab, user picks 2-5 words)
- `AdminView` — Gemini settings + admin management
- `ProfileView` — streak tier, SRS stats, Admin Panel button

### Shared Helpers
- `callGeminiJSON(system, user)` — POST to `/api/gemini`, retries 5x with backoff
- `HighlightedText({ text })` — renders `<b>word</b>` as indigo bold text
- `ResultScreen` — score circle + retry/next buttons (used by MC, Typing)
- `getShortPOS(pos)` — abbreviates part of speech

---

## Learn Sub-Groups
- Words split into groups of 5 (ordered by `order` field for lessons, index for My Vocabs)
- Score dots (5 dots): green count = `level` field from localStorage
- localStorage key: `sg_${lessonKey}_${groupIdx}_${userId}` → `{date, score, total, level}`
- Score calculated from MultipleChoice + TypingGame combined (passed via `onNext(score, total)`)
- `lessonKey` = CEFR level code (e.g., `a1`) or `my_vocabs`

---

## Wordle
- Daily word from `daily` collection
- Scores saved to `wordle_scores` with `$setOnInsert` (first attempt only counts)
- Guess validation: `api.dictionaryapi.dev` (skipped if guess === target)
- History: last 20 days, fetched from `/api/wordle/history?limit=20`
- Keyboard: Delete left, ENTER right (row 3)

---

## Auth & Admin
- Google OAuth popup → `decodeJWT()` → stored in localStorage as `dict_google_user`
- Admin check: `GET /api/admin/check?email=...`
- Initial admin: `phawit.boo@gmail.com` (seeded on DB connect)
- Gemini API key stored in `config` collection, never exposed to browser

---

## PWA
- `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style: black-translucent`
- Header is `position: fixed` + `padding-top: env(safe-area-inset-top)` to fill status bar
- Main content: `padding-top: calc(52px + env(safe-area-inset-top, 0px) + 1rem)`
- SW `mydict-v3`: network-first for HTML, cache-first for hashed assets, skip `/api/`
- `html { background-color: #4f46e5 }` prevents white overscroll flash

---

## Backend API Routes (server/index.js)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/words?userId=` | Get user's saved words |
| POST | `/api/words` | Save a word |
| PATCH | `/api/words/:id` | Update word (SRS data etc.) |
| DELETE | `/api/words/:id` | Delete word |
| GET | `/api/word-cache?words=` | Check cache for word data |
| POST | `/api/word-cache` | Save to cache |
| GET | `/api/suggest?q=` | Autocomplete from vocab_bank |
| GET | `/api/level-words/:lesson?userId=` | Get lesson words + user's saved |
| GET | `/api/daily` | Today's words + wordle word |
| POST | `/api/gemini` | Gemini proxy (key from DB) |
| GET | `/api/story?key=` | Cached AI story lookup |
| POST | `/api/story` | Save AI story to cache |
| GET | `/api/wordle/history?limit=` | Last N days (max 30) |
| POST | `/api/wordle/score` | Save wordle result (first only) |
| GET | `/api/wordle/leaderboard?date=` | Rankings for a date |
| GET | `/api/admin/check?email=` | Is email an admin? |
| GET | `/api/admin/settings?email=` | Get Gemini config |
| PUT | `/api/admin/settings` | Update Gemini key/model |
| GET | `/api/admin/models?email=` | List available Gemini models |
| POST | `/api/admin/admins` | Add admin |
| DELETE | `/api/admin/admins/:email` | Remove admin |
| GET | `/api/health` | Health check (for UptimeRobot) |

---

## Known Issues / Things to Watch
- Render free tier sleeps → UptimeRobot pings `/api/health` every 5 min
- MongoDB requires `tls: true, serverSelectionTimeoutMS: 5000` in MongoClient options
- Render uses dynamic IPs → MongoDB Atlas Network Access set to `0.0.0.0/0`
- Google OAuth popup needs `Cross-Origin-Opener-Policy: same-origin-allow-popups` (set in vercel.json)
- `.claude/` is in `.gitignore` — never commit it
