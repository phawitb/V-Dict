import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const app  = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
}));
app.use(express.json());

// ── MongoDB ──────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI, {
  tls: true,
  serverSelectionTimeoutMS: 5000,
});
let wordsCol;
let vocabBankCol;
let dailyCol;
let vocabLevelsCol;
let wordCacheCol;
let configCol;
let adminsCol;
let wordleScoresCol;
let storiesCol;

const INITIAL_ADMIN = 'phawit.boo@gmail.com';

async function connectDB() {
  await client.connect();
  const db         = client.db('mydict');
  wordsCol         = db.collection('words');
  vocabBankCol     = db.collection('vocab_bank');
  dailyCol         = db.collection('daily');
  vocabLevelsCol   = db.collection('vocab_levels');
  wordCacheCol     = db.collection('word_cache');
  configCol        = db.collection('config');
  adminsCol        = db.collection('admins');

  wordleScoresCol  = db.collection('wordle_scores');
  storiesCol       = db.collection('stories');

  await wordsCol.createIndex({ userId: 1, word: 1 }, { unique: true });
  await wordCacheCol.createIndex({ word: 1 }, { unique: true });
  await vocabBankCol.createIndex({ word: 1 }, { unique: true }).catch(() => {});
  await dailyCol.createIndex({ date: 1 }, { unique: true });
  await adminsCol.createIndex({ email: 1 }, { unique: true });
  await wordleScoresCol.createIndex({ date: 1, userId: 1 }, { unique: true });
  await storiesCol.createIndex({ key: 1 }, { unique: true });
  await wordleScoresCol.createIndex({ date: 1, score: 1 });

  // Seed initial admin
  await adminsCol.updateOne(
    { email: INITIAL_ADMIN },
    { $setOnInsert: { email: INITIAL_ADMIN, addedAt: Date.now() } },
    { upsert: true },
  );

  console.log('✅ Connected to MongoDB');
}

// ── Gemini config from DB (fallback to env) ───────────────────────────────────
async function getGeminiConfig() {
  try {
    const doc = await configCol.findOne({ _id: 'gemini' });
    return {
      apiKey: doc?.apiKey || process.env.VITE_GEMINI_API_KEY,
      model:  doc?.model  || 'gemini-2.5-flash',
    };
  } catch {
    return { apiKey: process.env.VITE_GEMINI_API_KEY, model: 'gemini-2.5-flash' };
  }
}

// ── Gemini helper (server-side) ───────────────────────────────────────────────
async function callGeminiServer(systemPrompt, userPrompt) {
  const { apiKey, model } = await getGeminiConfig();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

// ── Helper ────────────────────────────────────────────────────────────────────
const toClient = (doc) => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
};

// ── Admin middleware ──────────────────────────────────────────────────────────
const requireAdmin = async (req, res, next) => {
  const email = req.query.email || req.body.email;
  if (!email) return res.status(401).json({ error: 'email required' });
  try {
    const admin = await adminsCol.findOne({ email });
    if (!admin) return res.status(403).json({ error: 'Not authorized' });
    req.adminEmail = email;
    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/words?userId=xxx
app.get('/api/words', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  try {
    const docs = await wordsCol.find({ userId }).sort({ timestamp: -1 }).toArray();
    res.json(docs.map(toClient));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/words — upsert by (userId, word)
app.post('/api/words', async (req, res) => {
  const { userId, ...wordData } = req.body;
  if (!userId || !wordData.word) return res.status(400).json({ error: 'userId and word required' });

  const srsInit = wordData.srs || {
    repetitions: 0, easiness: 2.5, interval: 1,
    nextReview: Date.now(), lastReview: null,
  };

  try {
    const result = await wordsCol.findOneAndUpdate(
      { userId, word: wordData.word.toLowerCase() },
      { $set: { userId, ...wordData, word: wordData.word.toLowerCase(), srs: srsInit, timestamp: Date.now() } },
      { upsert: true, returnDocument: 'after' },
    );
    res.json(toClient(result));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/words/:id — partial update (used for SRS)
app.patch('/api/words/:id', async (req, res) => {
  const { userId, ...updates } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const result = await wordsCol.findOneAndUpdate(
      { _id: new ObjectId(req.params.id), userId },
      { $set: updates },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ error: 'Word not found' });
    res.json(toClient(result));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/suggest?q=xxx — autocomplete from vocab_bank
app.get('/api/suggest', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (q.length < 1) return res.json([]);
  try {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const docs = await vocabBankCol
      .find({ word: { $regex: `^${escaped}`, $options: 'i' } })
      .limit(8)
      .project({ word: 1, pos: 1, _id: 0 })
      .toArray();
    res.json(docs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/words/:id
app.delete('/api/words/:id', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    await wordsCol.deleteOne({ _id: new ObjectId(req.params.id), userId });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/level-words/:lesson?userId=xxx
app.get('/api/level-words/:lesson', async (req, res) => {
  const { lesson } = req.params;
  const { userId } = req.query;
  const validLessons = ['word100', 'word300', 'kru_somsri'];
  if (!validLessons.includes(lesson)) return res.status(400).json({ error: 'Invalid lesson' });
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const lessonDocs  = await vocabLevelsCol.find({ lesson }).sort({ order: 1 }).toArray();
    const lessonWords = lessonDocs.map(d => d.word);
    const lowerWords  = lessonWords.map(w => w.toLowerCase());
    const userWords   = await wordsCol.find({ userId, word: { $in: lowerWords } }).toArray();
    const savedSet    = new Set(userWords.map(w => w.word.toLowerCase()));
    const unsavedWords = lessonWords.filter(w => !savedSet.has(w.toLowerCase()));
    res.json({ saved: userWords.map(toClient), unsavedWords, total: lessonWords.length, lessonWords });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/word-cache?words=word1,word2,...
app.get('/api/word-cache', async (req, res) => {
  const words = (req.query.words || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return res.json({ found: {}, missing: [] });
  try {
    const docs = await wordCacheCol.find({ word: { $in: words } }).toArray();
    const found = {};
    docs.forEach(d => { const { _id, ...rest } = d; found[d.word] = rest; });
    const missing = words.filter(w => !found[w]);
    res.json({ found, missing });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// POST /api/word-cache — save one or many word entries
app.post('/api/word-cache', async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words) || !words.length) return res.status(400).json({ error: 'words[] required' });
  try {
    const ops = words
      .filter(w => w.word)
      .map(w => ({
        updateOne: {
          filter: { word: w.word.toLowerCase() },
          update: { $setOnInsert: { ...w, word: w.word.toLowerCase(), cachedAt: Date.now() } },
          upsert: true,
        },
      }));
    await wordCacheCol.bulkWrite(ops, { ordered: false });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/daily — global 5 words + wordle word (generated once/day, shared by all)
app.get('/api/daily', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    const existing = await dailyCol.findOne({ date: today });
    if (existing) return res.json({ words: existing.words, wordle: existing.wordle });

    const sys = `You are an English-Thai dictionary. Return ONLY valid JSON:
    {"words":[{"word":"string","phonetic":"string","partOfSpeech":"string","thaiTranslation":"string","examples":[{"en":"string (wrap word in <b> tags)","th":"string"},{"en":"string (wrap word in <b> tags)","th":"string"}]}]}
    Exactly 5 interesting/useful English vocabulary words, 2 examples each.`;
    const result = await callGeminiServer(sys, 'Generate 5 useful English vocabulary words for daily learning.');
    const words = (result.words || []).map(w => ({ ...w, id: w.word }));

    const seed = parseInt(today.replace(/-/g, '')) % 9973;
    const [wordleDoc] = await vocabBankCol
      .find({ word: { $regex: '^[a-z]{5}$' } })
      .skip(seed)
      .limit(1)
      .toArray();
    const wordle = wordleDoc?.word || words.find(w => w.word.length === 5)?.word || 'study';

    await dailyCol.updateOne(
      { date: today },
      { $setOnInsert: { date: today, words, wordle, createdAt: Date.now() } },
      { upsert: true },
    );

    res.json({ words, wordle });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/gemini — proxy all Gemini calls from frontend
app.post('/api/gemini', async (req, res) => {
  const { systemPrompt, userPrompt } = req.body;
  if (!systemPrompt || !userPrompt) return res.status(400).json({ error: 'systemPrompt and userPrompt required' });
  try {
    const result = await callGeminiServer(systemPrompt, userPrompt);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/story?key=word1,word2,...  (shared AI story cache)
app.get('/api/story', async (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const doc = await storiesCol.findOne({ key });
    if (!doc) return res.json({});
    const { _id, ...story } = doc;
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/story  { key, title, englishStory, thaiTranslation }
app.post('/api/story', async (req, res) => {
  const { key, title, englishStory, thaiTranslation } = req.body;
  if (!key || !englishStory) return res.status(400).json({ error: 'key and englishStory required' });
  try {
    await storiesCol.updateOne(
      { key },
      { $setOnInsert: { key, title, englishStory, thaiTranslation, createdAt: Date.now() } },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/wordle/history?limit=7
app.get('/api/wordle/history', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || 7), 30);
  try {
    const days = await dailyCol.find({ wordle: { $exists: true } })
      .sort({ date: -1 })
      .limit(limit)
      .project({ date: 1, wordle: 1, _id: 0 })
      .toArray();
    res.json(days);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/wordle/score
app.post('/api/wordle/score', async (req, res) => {
  const { date, userId, userName, userPicture, guesses, won } = req.body;
  if (!date || !userId) return res.status(400).json({ error: 'date and userId required' });
  try {
    await wordleScoresCol.updateOne(
      { date, userId },
      { $setOnInsert: { date, userId, userName, userPicture, guesses: parseInt(guesses), won: !!won, savedAt: Date.now() } },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/wordle/leaderboard?date=xxx
app.get('/api/wordle/leaderboard', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const scores = await wordleScoresCol.find({ date }).toArray();
    const sorted = scores.sort((a, b) => {
      if (a.won && !b.won) return -1;
      if (!a.won && b.won) return 1;
      if (a.won && b.won) return a.guesses - b.guesses;
      return b.guesses - a.guesses;
    });
    res.json(sorted.map(({ _id, ...rest }) => rest));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/admin/check?email=xxx
app.get('/api/admin/check', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.json({ isAdmin: false });
  try {
    const admin = await adminsCol.findOne({ email });
    res.json({ isAdmin: !!admin });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/settings?email=xxx
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const cfg    = await configCol.findOne({ _id: 'gemini' });
    const admins = await adminsCol.find({}).toArray();
    res.json({
      apiKeySet: !!cfg?.apiKey,
      apiKeyHint: cfg?.apiKey ? '***' + cfg.apiKey.slice(-4) : '(using env default)',
      model: cfg?.model || 'gemini-2.5-flash',
      admins: admins.map(a => a.email),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/settings
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const { apiKey, model } = req.body;
  try {
    const update = {};
    if (apiKey !== undefined) update.apiKey = apiKey;
    if (model  !== undefined) update.model  = model;
    await configCol.updateOne({ _id: 'gemini' }, { $set: update }, { upsert: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/models?email=xxx — list available Gemini models
app.get('/api/admin/models', requireAdmin, async (req, res) => {
  try {
    const { apiKey } = await getGeminiConfig();
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    const data = await r.json();
    const models = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'))
      .map(m => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name.replace('models/', '') }))
      .sort((a, b) => {
        const score = id => (id.includes('pro') ? 10 : 0) + parseFloat((id.match(/(\d+\.\d+)/) || [0, 0])[1]);
        return score(a.id) - score(b.id);
      });
    res.json({ models });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/admins — add admin email
app.post('/api/admin/admins', requireAdmin, async (req, res) => {
  const { newEmail } = req.body;
  if (!newEmail) return res.status(400).json({ error: 'newEmail required' });
  try {
    await adminsCol.updateOne(
      { email: newEmail },
      { $setOnInsert: { email: newEmail, addedAt: Date.now() } },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/admins/:email
app.delete('/api/admin/admins/:email', requireAdmin, async (req, res) => {
  const target = decodeURIComponent(req.params.email);
  if (target === req.adminEmail) return res.status(400).json({ error: 'Cannot remove yourself' });
  try {
    await adminsCol.deleteOne({ email: target });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
}).catch(e => {
  console.error('❌ MongoDB connection failed:', e.message);
  process.exit(1);
});
