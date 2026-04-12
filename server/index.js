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
  process.env.FRONTEND_URL, // set this on Render to your Vercel URL
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
}));
app.use(express.json());

// ── MongoDB ──────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
let wordsCol;
let vocabBankCol;
let dailyCol;
let vocabLevelsCol;
let wordCacheCol;

async function connectDB() {
  await client.connect();
  const db         = client.db('mydict');
  wordsCol         = db.collection('words');
  vocabBankCol     = db.collection('vocab_bank');
  dailyCol         = db.collection('daily');
  vocabLevelsCol   = db.collection('vocab_levels');
  wordCacheCol     = db.collection('word_cache');
  await wordsCol.createIndex({ userId: 1, word: 1 }, { unique: true });
  await wordCacheCol.createIndex({ word: 1 }, { unique: true });
  await vocabBankCol.createIndex({ word: 1 }, { unique: true }).catch(() => {});
  await dailyCol.createIndex({ date: 1 }, { unique: true });
  console.log('✅ Connected to MongoDB');
}

// ── Gemini helper (server-side) ───────────────────────────────────────────────
async function callGeminiServer(systemPrompt, userPrompt) {
  const apiKey = process.env.VITE_GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
    // Escape regex special chars
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
// Returns { saved: [full word docs], unsavedWords: [word strings], total: N }
app.get('/api/level-words/:lesson', async (req, res) => {
  const { lesson } = req.params;
  const { userId } = req.query;
  const validLessons = ['word100', 'word300', 'kru_somsri'];
  if (!validLessons.includes(lesson)) return res.status(400).json({ error: 'Invalid lesson' });
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const lessonDocs  = await vocabLevelsCol.find({ lesson }).sort({ order: 1 }).toArray();
    const lessonWords = lessonDocs.map(d => d.word);
    // case-insensitive match: store words lowercased in user collection
    const lowerWords  = lessonWords.map(w => w.toLowerCase());
    const userWords   = await wordsCol.find({ userId, word: { $in: lowerWords } }).toArray();
    const savedSet    = new Set(userWords.map(w => w.word.toLowerCase()));
    const unsavedWords = lessonWords.filter(w => !savedSet.has(w.toLowerCase()));
    res.json({ saved: userWords.map(toClient), unsavedWords, total: lessonWords.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/word-cache?words=word1,word2,...
// Batch lookup — returns cached word data for known words
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
  const { words } = req.body; // array of word objects
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

// GET /api/daily — global 5 words + wordle word for today (generated once, shared by all users)
app.get('/api/daily', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  try {
    // Return cached if already generated today
    const existing = await dailyCol.findOne({ date: today });
    if (existing) return res.json({ words: existing.words, wordle: existing.wordle });

    // Generate 5 words via Gemini
    const sys = `You are an English-Thai dictionary. Return ONLY valid JSON:
    {"words":[{"word":"string","phonetic":"string","partOfSpeech":"string","thaiTranslation":"string","examples":[{"en":"string (wrap word in <b> tags)","th":"string"},{"en":"string (wrap word in <b> tags)","th":"string"}]}]}
    Exactly 5 interesting/useful English vocabulary words, 2 examples each.`;
    const result = await callGeminiServer(sys, 'Generate 5 useful English vocabulary words for daily learning.');
    const words = (result.words || []).map(w => ({ ...w, id: w.word }));

    // Pick a deterministic 5-letter wordle word from vocab_bank using today's date as seed
    const seed = parseInt(today.replace(/-/g, '')) % 9973; // prime mod for distribution
    const [wordleDoc] = await vocabBankCol
      .find({ word: { $regex: '^[a-z]{5}$' } })
      .skip(seed)
      .limit(1)
      .toArray();
    const wordle = wordleDoc?.word || words.find(w => w.word.length === 5)?.word || 'study';

    // Save globally (upsert in case of race condition)
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

// ── Start ─────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
}).catch(e => {
  console.error('❌ MongoDB connection failed:', e.message);
  process.exit(1);
});
