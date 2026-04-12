import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search, Volume2, Trash2, BookOpen, Layers, Edit3, Type, CheckCircle,
  RefreshCw, AlertCircle, Loader2, Sun, Book, Lightbulb, Clock, ChevronDown,
  User, Trophy, Delete, Sparkles, Flame, Brain, RotateCcw, LogOut,
  Settings, Shield, Eye, EyeOff, Plus, X, Bookmark, BookmarkCheck,
} from 'lucide-react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const getStoredUser = () => {
  try { return JSON.parse(localStorage.getItem('dict_google_user')); }
  catch { return null; }
};

const decodeJWT = (token) => {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
};

// ─── API base URL (empty in dev → Vite proxy; set VITE_API_URL in production) ──
const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── API helpers ──────────────────────────────────────────────────────────────
const api = {
  getWords: async (userId) => {
    const res = await fetch(`${API_BASE}/api/words?userId=${userId}`);
    if (!res.ok) throw new Error('Failed to load words');
    return res.json();
  },
  saveWord: async (userId, wordData) => {
    const res = await fetch(`${API_BASE}/api/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...wordData }),
    });
    if (!res.ok) throw new Error('Failed to save word');
    return res.json();
  },
  updateWord: async (userId, wordId, updates) => {
    const res = await fetch(`${API_BASE}/api/words/${wordId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...updates }),
    });
    if (!res.ok) throw new Error('Failed to update word');
    return res.json();
  },
  deleteWord: async (userId, wordId) => {
    await fetch(`${API_BASE}/api/words/${wordId}?userId=${userId}`, { method: 'DELETE' });
  },
  checkCache: async (words) => {
    const q = words.map(w => encodeURIComponent(w)).join(',');
    const res = await fetch(`${API_BASE}/api/word-cache?words=${q}`);
    return res.json(); // { found: {word: data}, missing: [words] }
  },
  saveCache: async (words) => {
    await fetch(`${API_BASE}/api/word-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words }),
    });
  },
};

// ─── Gemini helper (calls backend, never exposes key to browser) ─────────────
const callGeminiJSON = async (systemPrompt, userPrompt) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`${API_BASE}/api/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt, userPrompt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (i === 4) throw e;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
};

// ─── POS abbreviation ─────────────────────────────────────────────────────────
const getShortPOS = (pos) => {
  if (!pos) return '';
  const p = pos.toLowerCase();
  if (p.includes('noun'))        return 'n.';
  if (p.includes('verb'))        return 'v.';
  if (p.includes('adjective') || p === 'adj') return 'adj.';
  if (p.includes('adverb')    || p === 'adv') return 'adv.';
  if (p.includes('preposition')|| p === 'prep') return 'prep.';
  if (p.includes('pronoun')   || p === 'pron') return 'pron.';
  if (p.includes('conjunction')|| p === 'conj') return 'conj.';
  if (p.includes('interjection')|| p === 'int') return 'int.';
  return pos;
};

// ─── SM-2 Spaced Repetition ───────────────────────────────────────────────────
const calculateSRS = (currentSrs, quality) => {
  // quality: 1=Again(fail), 3=Hard(barely pass), 4=Good, 5=Easy
  let { repetitions = 0, easiness = 2.5, interval = 1 } = currentSrs || {};

  if (quality >= 3) {
    if      (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easiness);
    repetitions++;
    easiness = easiness + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    easiness = Math.max(1.3, Math.round(easiness * 100) / 100);
  } else {
    repetitions = 0;
    interval    = 1;
    easiness    = Math.max(1.3, easiness - 0.2);
  }

  return {
    repetitions,
    easiness,
    interval,
    nextReview: Date.now() + interval * 86400000,
    lastReview: Date.now(),
  };
};

const getProjectedLabel = (currentSrs, quality) => {
  const { interval } = calculateSRS(currentSrs, quality);
  if (interval <= 1)   return '1d';
  if (interval < 30)   return `${interval}d`;
  if (interval < 365)  return `${Math.round(interval / 30)}mo`;
  return `${Math.round(interval / 365)}yr`;
};

// ─── Audio ────────────────────────────────────────────────────────────────────
const playAudio = (word) => {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = 'en-US';
  window.speechSynthesis.speak(u);
};

// ═════════════════════════════════════════════════════════════════════════════
// LoginView
// ═════════════════════════════════════════════════════════════════════════════
function LoginView({ onLogin }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-violet-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8 max-w-sm w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
            <BookOpen className="w-10 h-10 text-white" />
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-800">My Dict</h1>
          <p className="text-sm text-slate-500 mt-1">Your personal English-Thai dictionary</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Sign in with</p>
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={(cred) => {
                const info = decodeJWT(cred.credential);
                const user = { sub: info.sub, name: info.name, email: info.email, picture: info.picture };
                localStorage.setItem('dict_google_user', JSON.stringify(user));
                onLogin(user);
              }}
              onError={() => alert('Google login failed. Please try again.')}
              useOneTap
              shape="pill"
              text="signin_with"
              locale="th"
            />
          </div>
        </div>
        <p className="text-xs text-slate-300">Save your vocabulary to the cloud</p>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// App
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser]           = useState(getStoredUser);
  const [words, setWords]         = useState([]);
  const [activeTab, setActiveTab] = useState('find');
  const [loading, setLoading]     = useState(true);
  const [isAdmin, setIsAdmin]     = useState(false);
  const [headerTitle, setHeaderTitle] = useState(null);

  const TAB_TITLES = { find: 'Find Word', vocabs: 'My Vocabs', learning: 'Learn', wotd: 'Daily', profile: 'Profile', admin: 'Admin' };
  const switchTab = (tab) => { setActiveTab(tab); setHeaderTitle(null); };

  // Load words when user is available
  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api.getWords(user.sub)
      .then(data => setWords(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.sub]);

  // Check admin status
  useEffect(() => {
    if (!user?.email) { setIsAdmin(false); return; }
    fetch(`${API_BASE}/api/admin/check?email=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(d => setIsAdmin(!!d.isAdmin))
      .catch(() => setIsAdmin(false));
  }, [user?.email]);

  const handleLogout = () => {
    googleLogout();
    localStorage.removeItem('dict_google_user');
    setUser(null);
    setWords([]);
  };

  const saveWordToDb = async (wordData) => {
    try {
      const saved = await api.saveWord(user.sub, wordData);
      setWords(prev => {
        const filtered = prev.filter(w => w.word !== saved.word);
        return [saved, ...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      });
      return saved;
    } catch (e) { console.error(e); return null; }
  };

  const updateWordInDb = async (wordId, updates) => {
    try {
      const updated = await api.updateWord(user.sub, wordId, updates);
      setWords(prev => prev.map(w => w.id === wordId ? updated : w));
    } catch (e) { console.error(e); }
  };

  const deleteWordFromDb = async (wordId) => {
    try {
      await api.deleteWord(user.sub, wordId);
      setWords(prev => prev.filter(w => w.id !== wordId));
    } catch (e) { console.error(e); }
  };

  const dueCount = useMemo(() => {
    const now = Date.now();
    return words.filter(w => !w.srs || w.srs.nextReview <= now).length;
  }, [words]);

  if (!user) return <LoginView onLogin={(u) => { setUser(u); setLoading(true); }} />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-24 flex flex-col">
      {/* Header */}
      <header className="bg-indigo-600 text-white p-3 shadow-md sticky top-0 z-10 flex-none">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            {headerTitle || TAB_TITLES[activeTab] || 'My Dict'}
          </h1>
          <div className="flex items-center gap-2">
            {user.picture && (
              <img src={user.picture} alt={user.name} className="w-7 h-7 rounded-full border-2 border-indigo-400 object-cover" />
            )}
            <span className="text-indigo-200 text-xs font-medium hidden md:block max-w-[120px] truncate">{user.name}</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-4xl mx-auto p-4 md:mt-4 w-full flex-1 flex flex-col">
        {activeTab === 'find'     && <FindView    onSave={saveWordToDb} words={words} />}
        {activeTab === 'vocabs'   && <MyVocabsView words={words} onDelete={deleteWordFromDb} />}
        {activeTab === 'learning' && <LearningView words={words} onUpdateWord={updateWordInDb} onSaveWord={saveWordToDb} dueCount={dueCount} userId={user.sub} onTitleChange={setHeaderTitle} />}
        {activeTab === 'wotd'     && <WordOfTheDayView onSave={saveWordToDb} savedWords={words} user={user} />}
        {activeTab === 'profile'  && <ProfileView words={words} user={user} onLogout={handleLogout} isAdmin={isAdmin} onAdminClick={() => switchTab('admin')} />}
        {activeTab === 'admin'    && isAdmin && <AdminView user={user} />}
      </main>

      {/* Bottom Nav — always fixed */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-20 safe-bottom">
        <div className="flex justify-around items-center max-w-4xl mx-auto p-2">
          <NavButton icon={<Book />}   label="Vocabs"  active={activeTab === 'vocabs'}   onClick={() => switchTab('vocabs')} />
          <NavButton icon={<Layers />} label="Learn"   active={activeTab === 'learning'} onClick={() => switchTab('learning')} badge={dueCount > 0 ? dueCount : null} />

          <button
            onClick={() => switchTab('find')}
            className={`flex items-center justify-center px-6 py-2.5 md:px-8 md:py-3 rounded-2xl shadow-sm transition-all duration-200 mx-1 ${
              activeTab === 'find' ? 'bg-indigo-600 text-white scale-105 shadow-indigo-200' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
            }`}
          >
            <Search className="w-6 h-6 md:w-7 md:h-7" />
          </button>

          <NavButton icon={<Sun />}  label="Daily"   active={activeTab === 'wotd'}    onClick={() => switchTab('wotd')} />
          <NavButton icon={<User />} label="Profile" active={activeTab === 'profile' || activeTab === 'admin'} onClick={() => switchTab('profile')} />
        </div>
      </nav>
    </div>
  );
}

// ─── NavButton ────────────────────────────────────────────────────────────────
function NavButton({ icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center flex-1 transition-all duration-200 py-1.5 ${
        active ? 'text-indigo-600 scale-105' : 'text-slate-500 hover:text-indigo-500'
      }`}
    >
      <div className="relative md:mr-2 w-5 h-5">
        {React.cloneElement(icon, { size: active ? 22 : 18, className: 'mx-auto' })}
        {badge != null && (
          <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span className="text-[10px] md:text-xs font-medium">{label}</span>
    </button>
  );
}

// ─── HighlightedText ──────────────────────────────────────────────────────────
function HighlightedText({ text }) {
  if (!text) return null;
  if (typeof text !== 'string') return <span>{String(text)}</span>;
  const parts = text.split(/<b>(.*?)<\/b>/gi);
  return (
    <span>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <span key={i} className="text-indigo-600 font-bold underline decoration-2 underline-offset-4">{part}</span>
          : part
      )}
    </span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// FindView
// ═════════════════════════════════════════════════════════════════════════════
function FindView({ onSave, words }) {
  const [queryText, setQueryText]       = useState('');
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState(null);
  const [error, setError]               = useState(null);
  const [expandedId, setExpandedId]     = useState(null);
  const [suggestions, setSuggestions]   = useState([]);
  const [showSugs, setShowSugs]         = useState(false);
  const [activeSug, setActiveSug]       = useState(-1);
  const inputRef   = useRef(null);
  const sugTimer   = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!result) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [result]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handler = (e) => { if (!wrapperRef.current?.contains(e.target)) setShowSugs(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = (q) => {
    clearTimeout(sugTimer.current);
    if (!q.trim() || q.length < 1) { setSuggestions([]); setShowSugs(false); return; }
    sugTimer.current = setTimeout(async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSuggestions(data);
        setShowSugs(data.length > 0);
        setActiveSug(-1);
      } catch { /* ignore */ }
    }, 150);
  };

  const handleSearch = async (e, directWord = null) => {
    if (e) e.preventDefault();
    const word = directWord || queryText;
    if (!word.trim()) return;
    setShowSugs(false);
    setSuggestions([]);
    setLoading(true); setError(null); setResult(null);

    const sys = `You are an English-Thai dictionary. Return ONLY a valid JSON object:
    {
      "word": "string",
      "phonetic": "string (e.g. /wɜːrd/)",
      "partOfSpeech": "string",
      "thaiTranslation": "string (short Thai meaning)",
      "examples": [
        {"en": "string (wrap the word in <b> tags)", "th": "string"},
        {"en": "string (wrap the word in <b> tags)", "th": "string"}
      ]
    }
    Provide exactly 2 examples. If invalid, return {"error": "Invalid word"}.`;

    try {
      const key = word.trim().toLowerCase();

      // Check global cache first
      const { found } = await api.checkCache([key]);
      let data = found[key] || null;

      if (!data) {
        // Check vocab_bank — only look up words that exist in our list
        const sugRes = await fetch(`${API_BASE}/api/suggest?q=${encodeURIComponent(key)}`);
        const sugs   = await sugRes.json();
        const inBank = sugs.some(s => s.word.toLowerCase() === key);
        if (!inBank) {
          setError('Word not in vocabulary list. Try another word.');
          setLoading(false);
          return;
        }
        data = await callGeminiJSON(sys, `Dictionary details for: "${word.trim()}"`);
        if (!data.error) api.saveCache([data]);
      }

      if (data.error) {
        setError('Word not found. Please try another word.');
      } else {
        setResult(data);
        onSave(data);
        if (!directWord) setQueryText('');
      }
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQueryText(val);
    if (!val.trim()) { setResult(null); setError(null); setSuggestions([]); setShowSugs(false); return; }
    fetchSuggestions(val);
  };

  const handleKeyDown = (e) => {
    if (!showSugs || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSug(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSug(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Escape') { setShowSugs(false); }
    else if (e.key === 'Enter' && activeSug >= 0) {
      e.preventDefault();
      const w = suggestions[activeSug].word;
      setQueryText(w);
      setShowSugs(false);
      handleSearch(null, w);
    }
  };

  const pickSuggestion = (w) => {
    setQueryText(w);
    setShowSugs(false);
    setSuggestions([]);
    handleSearch(null, w);
  };

  return (
    <div className="w-full flex-1 flex flex-col pt-2 animate-in fade-in">
      {/* Search bar */}
      <div className="w-full max-w-xl mx-auto mb-6" ref={wrapperRef}>
        <form onSubmit={handleSearch} className="relative">
          <div className="shadow-md rounded-2xl overflow-hidden bg-white border-2 border-slate-100 hover:border-indigo-300 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-50 transition-all">
            <input
              ref={inputRef}
              type="text"
              value={queryText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => suggestions.length > 0 && setShowSugs(true)}
              placeholder="Type an English word here..."
              className="w-full py-3.5 pl-5 pr-14 text-lg outline-none bg-transparent"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={loading || !queryText.trim()}
              className="absolute right-2 top-2 bottom-2 bg-indigo-600 text-white px-4 rounded-xl hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors shadow-sm flex items-center justify-center"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </button>
          </div>

          {/* Suggestions dropdown */}
          {showSugs && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-2xl shadow-xl mt-1.5 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
              {suggestions.map((s, i) => (
                <button
                  key={s.word}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s.word); }}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                    i === activeSug ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                  } ${i !== 0 ? 'border-t border-slate-100' : ''}`}
                >
                  <Search className="w-3.5 h-3.5 text-slate-300 flex-none" />
                  <span className="font-medium capitalize">{s.word}</span>
                  {s.pos && <span className="text-xs text-slate-400 italic ml-auto">{s.pos}</span>}
                </button>
              ))}
            </div>
          )}
        </form>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 text-sm rounded-xl flex items-center gap-2 mt-4 animate-in fade-in">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="animate-in fade-in slide-in-from-bottom-4 w-full max-w-xl mx-auto">
          <WordCard result={result} />
        </div>
      )}

      {/* Recent searches */}
      {!result && !loading && words.length > 0 && (
        <div className="w-full max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 mb-4 justify-center">
            <div className="h-px bg-slate-200 flex-1" />
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 px-2">
              <Clock className="w-3.5 h-3.5" /> Recent Searches
            </h3>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <div className="space-y-2.5">
            {words.slice(0, 10).map(word => {
              const isExpanded = expandedId === word.id;
              return (
                <div key={word.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div
                    className="p-3.5 cursor-pointer flex justify-between items-center hover:bg-slate-50 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : word.id)}
                  >
                    <div className="flex-1 overflow-hidden pr-2">
                      <div className="font-bold text-base text-slate-800 capitalize flex items-baseline gap-2 mb-0.5 truncate">
                        {word.word}
                        <span className="text-xs text-slate-400 font-mono font-normal">{word.phonetic}</span>
                      </div>
                      <div className="text-slate-600 text-sm truncate">
                        <span className="text-indigo-500 italic font-medium mr-1.5">{getShortPOS(word.partOfSpeech)}</span>
                        {word.thaiTranslation}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={e => { e.stopPropagation(); playAudio(word.word); }} className="p-1.5 text-indigo-500 hover:bg-indigo-100 rounded-lg">
                        <Volume2 className="w-4 h-4" />
                      </button>
                      <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? 'rotate-180 text-indigo-400' : ''}`} />
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="p-3 bg-slate-50 border-t border-slate-100 animate-in slide-in-from-top-1 fade-in">
                      <WordCard result={word} hideHeader />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MyVocabsView
// ═════════════════════════════════════════════════════════════════════════════
function MyVocabsView({ words, onDelete }) {
  const [expandedId, setExpandedId] = useState(null);

  if (words.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
        <p className="text-base font-medium text-slate-500">No vocabulary saved yet.</p>
        <p className="text-xs mt-1.5">Words you search in the 'Find' tab will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in max-w-xl mx-auto w-full">
      <div className="flex justify-end">
        <span className="text-xs font-medium bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full">
          {words.length} words
        </span>
      </div>

      <div className="space-y-2.5">
        {words.map(word => {
          const isExpanded = expandedId === word.id;
          const isDue = !word.srs || word.srs.nextReview <= Date.now();
          return (
            <div key={word.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div
                className="p-3.5 cursor-pointer flex justify-between items-center hover:bg-slate-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : word.id)}
              >
                <div className="flex-1 overflow-hidden pr-2">
                  <div className="font-bold text-base text-slate-800 capitalize flex items-baseline gap-2 mb-0.5 truncate flex-wrap">
                    {word.word}
                    <span className="text-xs text-slate-400 font-mono font-normal">{word.phonetic}</span>
                    {isDue && (
                      <span className="text-[9px] font-bold bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full">Due</span>
                    )}
                  </div>
                  <div className="text-slate-600 text-sm truncate">
                    <span className="text-indigo-500 italic font-medium mr-1.5">{getShortPOS(word.partOfSpeech)}</span>
                    {word.thaiTranslation}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={e => { e.stopPropagation(); playAudio(word.word); }} className="p-1.5 text-indigo-500 hover:bg-indigo-100 rounded-lg">
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button onClick={e => { e.stopPropagation(); onDelete(word.id); }} className="p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? 'rotate-180 text-indigo-400' : ''}`} />
                </div>
              </div>
              {isExpanded && (
                <div className="p-3 bg-slate-50 border-t border-slate-100 animate-in slide-in-from-top-1 fade-in">
                  <WordCard result={word} hideHeader />
                  {word.srs && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-400 px-1">
                      <Brain className="w-3.5 h-3.5" />
                      <span>Interval: {word.srs.interval}d · EF: {word.srs.easiness} · Reps: {word.srs.repetitions}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LearningView — group selector + study session
// ═════════════════════════════════════════════════════════════════════════════
const LESSONS = [
  { key: 'word100',    label: 'Word 100',    desc: 'Business & Work',    sub: '99 words',  color: 'from-blue-500   to-indigo-600', bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   icon: '💼' },
  { key: 'word300',    label: 'Word 300',    desc: 'Essential English',  sub: '238 words', color: 'from-green-500  to-teal-600',   bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  icon: '📖' },
  { key: 'kru_somsri', label: 'Kru Somsri', desc: 'Advanced Synonyms',  sub: '720 words', color: 'from-violet-500 to-purple-600', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: '⭐' },
];

function LearningView({ words, onUpdateWord, onSaveWord, dueCount, userId, onTitleChange }) {
  const [group, setGroup]   = useState(null);
  const [subTab, setSubTab] = useState('srs');

  const selectGroup = (g) => {
    setGroup(g);
    setSubTab('flashcard');
    const meta = LESSONS.find(l => l.key === g);
    onTitleChange?.(meta ? meta.label : 'My Vocabs');
  };
  const goBack = () => { setGroup(null); onTitleChange?.(null); };

  if (!group) {
    return (
      <div className="animate-in fade-in max-w-xl mx-auto w-full space-y-5">

        {/* My Vocabs */}
        <button
          onClick={() => selectGroup('my_vocabs')}
          className="w-full bg-white rounded-2xl shadow-sm border-2 border-indigo-200 hover:border-indigo-400 p-3 text-left transition-all hover:shadow-md group"
        >
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md flex-none">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-800">My Vocabs</span>
                {dueCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5">{dueCount} due</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Saved vocabulary · Personal SRS · {words.length} words</p>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 group-hover:text-indigo-400 flex-none" />
          </div>
        </button>

        {/* Lessons */}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Lessons</p>
          <div className="flex flex-col gap-2">
            {LESSONS.map(ls => (
              <button
                key={ls.key}
                onClick={() => selectGroup(ls.key)}
                className={`rounded-2xl border-2 ${ls.border} ${ls.bg} p-3 text-left transition-all hover:shadow-md hover:scale-[1.01] group flex items-center gap-3`}
              >
                <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${ls.color} flex items-center justify-center shadow-sm flex-none`}>
                  <span className="text-xl">{ls.icon}</span>
                </div>
                <div className="flex-1">
                  <p className={`font-black text-sm ${ls.text}`}>{ls.label}</p>
                  <p className={`text-xs mt-0.5 ${ls.text} opacity-70`}>{ls.desc} · {ls.sub}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 group-hover:text-slate-400 flex-none" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Study session ──────────────────────────────────────────────────────────
  const levelMeta = LESSONS.find(l => l.key === group);

  if (group !== 'my_vocabs') {
    return (
      <LevelStudySession
        key={group}
        level={group}
        levelMeta={levelMeta}
        userId={userId}
        onSaveWord={onSaveWord}
        onUpdateWord={onUpdateWord}
        onBack={goBack}
      />
    );
  }

  // My Vocabs: keep existing tabs
  return (
    <div className="space-y-4 animate-in fade-in flex flex-col h-full max-w-xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 flex-none">
        <button onClick={goBack} className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 shadow-sm">
          <ChevronDown className="w-4 h-4 text-slate-500 rotate-90" />
        </button>
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-600" />
          <span className="font-bold text-slate-800">My Vocabs</span>
          <span className="text-xs text-slate-400">({words.length} words)</span>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="overflow-x-auto hide-scrollbar flex-none">
        <div className="flex gap-2 pt-2 pb-1">
          <SubTabButton label="Flashcards"    active={subTab === 'flashcard'} onClick={() => setSubTab('flashcard')} />
          <SubTabButton label="Matching"      active={subTab === 'matching'}  onClick={() => setSubTab('matching')} />
          <SubTabButton label="Choices"       active={subTab === 'choice'}    onClick={() => setSubTab('choice')} />
          <SubTabButton label="Typing"        active={subTab === 'typing'}    onClick={() => setSubTab('typing')} />
          <SubTabButton label="✨ AI Story"   active={subTab === 'story'}     onClick={() => setSubTab('story')} />
          <SubTabButton label="🧠 SRS Review" active={subTab === 'srs'}       onClick={() => setSubTab('srs')} badge={dueCount > 0 ? dueCount : null} />
        </div>
      </div>

      {/* Content */}
      <div className="mt-1 flex-1">
        {subTab === 'srs'       && <SRSReview words={words} onUpdateWord={onUpdateWord} />}
        {subTab === 'story'     && <AIStoryGame words={words} />}
        {subTab === 'flashcard' && <FlashcardGame words={words} />}
        {subTab === 'matching'  && <MatchingGame words={words} />}
        {subTab === 'choice'    && <MultipleChoiceGame words={words} />}
        {subTab === 'typing'    && <TypingGame words={words} />}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LevelStudySession — CEFR level study (sub-group navigation)
// ═════════════════════════════════════════════════════════════════════════════
function LevelStudySession({ level, levelMeta, userId, onSaveWord, onUpdateWord, onBack }) {
  const [lessonWords, setLessonWords]   = useState([]);
  const [savedSet, setSavedSet]         = useState(new Set());
  const [savedWords, setSavedWords]     = useState([]);
  const [total, setTotal]               = useState(0);
  const [loading, setLoading]           = useState(true);
  const [activeGroup, setActiveGroup]   = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/level-words/${level}?userId=${userId}`);
      const data = await res.json();
      setLessonWords(data.lessonWords || []);
      setSavedWords(data.saved || []);
      setSavedSet(new Set((data.saved || []).map(w => w.word.toLowerCase())));
      setTotal(data.total || 0);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [level, userId]);

  const subGroups = useMemo(() => {
    const groups = [];
    for (let i = 0; i < lessonWords.length; i += 5) {
      groups.push(lessonWords.slice(i, i + 5));
    }
    return groups;
  }, [lessonWords]);

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  if (activeGroup !== null) {
    return (
      <SubGroupPractice
        key={`${level}-${activeGroup}`}
        groupWords={subGroups[activeGroup]}
        groupIdx={activeGroup}
        lessonKey={level}
        levelMeta={levelMeta}
        userId={userId}
        savedWords={savedWords}
        onSaveWord={async (w) => {
          const saved = await onSaveWord(w);
          if (saved) {
            setSavedWords(prev => {
              const filtered = prev.filter(p => p.word !== saved.word);
              return [...filtered, saved];
            });
            setSavedSet(prev => new Set([...prev, saved.word.toLowerCase()]));
          }
          return saved;
        }}
        onBack={() => setActiveGroup(null)}
      />
    );
  }

  const pct = total > 0 ? Math.round((savedSet.size / total) * 100) : 0;

  return (
    <div className="space-y-4 animate-in fade-in max-w-xl mx-auto w-full">
      {/* Header with back */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 shadow-sm flex-none">
          <ChevronDown className="w-4 h-4 text-slate-500 rotate-90" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`px-2.5 py-1 rounded-xl bg-gradient-to-br ${levelMeta.color} text-white font-black text-sm shadow-sm flex-none`}>
            {levelMeta.icon}
          </span>
          <div className="min-w-0">
            <p className="font-bold text-slate-800 text-sm">{levelMeta.label}</p>
            <p className="text-xs text-slate-400">{savedSet.size}/{total} words · {pct}%</p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className={`rounded-xl border ${levelMeta.border} ${levelMeta.bg} p-3`}>
        <div className="w-full bg-white rounded-full h-2 overflow-hidden border border-white/50">
          <div className={`h-2 rounded-full bg-gradient-to-r ${levelMeta.color} transition-all duration-700`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Sub-group list */}
      <div className="space-y-2">
        {subGroups.map((group, idx) => {
          const savedCount    = group.filter(w => savedSet.has(w.toLowerCase())).length;
          const practiceData  = (() => { try { return JSON.parse(localStorage.getItem(`sg_${level}_${idx}_${userId}`)); } catch { return null; } })();
          const today         = new Date().toISOString().split('T')[0];
          const doneToday     = practiceData?.date === today;

          return (
            <button
              key={idx}
              onClick={() => setActiveGroup(idx)}
              className={`w-full rounded-xl border p-3 text-left transition-all hover:shadow-md flex items-center gap-3 ${doneToday ? `${levelMeta.bg} ${levelMeta.border}` : 'bg-white border-slate-200 hover:border-indigo-200'}`}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-black flex-none ${doneToday ? `bg-gradient-to-br ${levelMeta.color} text-white` : 'bg-slate-100 text-slate-500'}`}>
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-700 truncate">
                  {group[0]} – {group[group.length - 1]}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {group.map(w => (
                    <span key={w} className={`w-1.5 h-1.5 rounded-full ${savedSet.has(w.toLowerCase()) ? 'bg-green-400' : 'bg-slate-200'}`} />
                  ))}
                  {practiceData && (
                    <span className={`text-[10px] font-bold ml-1 ${doneToday ? levelMeta.text : 'text-slate-400'}`}>
                      {doneToday ? '✓ Today' : practiceData.date}
                    </span>
                  )}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-300 -rotate-90 flex-none" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SubGroupPractice — practice a group of 5 words through 4 stages
// ═════════════════════════════════════════════════════════════════════════════
function SubGroupPractice({ groupWords, groupIdx, lessonKey, levelMeta, userId, savedWords, onSaveWord, onBack }) {
  const [words, setWords]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [stage, setStage]     = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const keys          = groupWords.map(w => w.toLowerCase());
        const { found, missing } = await api.checkCache(keys);
        let geminiWords     = [];

        if (missing.length) {
          const sys = `You are an English-Thai dictionary. Return ONLY valid JSON:
          {"words":[{"word":"string","phonetic":"string","partOfSpeech":"string","thaiTranslation":"string","examples":[{"en":"string (wrap word in <b> tags)","th":"string"},{"en":"string (wrap word in <b> tags)","th":"string"}]}]}
          Provide entries for exactly these words (preserve original casing).`;
          const result = await callGeminiJSON(sys, `Dictionary entries for: ${missing.join(', ')}`);
          geminiWords  = result?.words || [];
          if (geminiWords.length) api.saveCache(geminiWords);
        }

        const allData = [...Object.values(found), ...geminiWords];
        const finalWords = [];
        for (const w of allData) {
          const existing = savedWords.find(s => s.word.toLowerCase() === w.word.toLowerCase());
          if (existing) {
            finalWords.push(existing);
          } else {
            const saved = await onSaveWord({ ...w, level: lessonKey });
            if (saved) finalWords.push(saved);
            else finalWords.push(w);
          }
        }
        setWords(finalWords.filter(Boolean));
      } catch (e) { console.error(e); setError('Failed to load words. Please try again.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const onComplete = () => {
    localStorage.setItem(`sg_${lessonKey}_${groupIdx}_${userId}`, JSON.stringify({
      date: new Date().toISOString().split('T')[0],
    }));
    onBack();
  };

  const next = () => setStage(s => s + 1);

  if (loading) return (
    <div className="py-20 flex flex-col items-center gap-3">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      <p className="text-sm text-slate-500">Loading words…</p>
    </div>
  );

  if (error) return (
    <div className="text-center py-12 text-red-500 bg-red-50 rounded-2xl border border-red-100 p-6">
      <p className="font-medium">{error}</p>
      <button onClick={onBack} className="mt-4 px-4 py-2 bg-white border border-red-200 text-red-600 rounded-xl text-sm font-bold">Go Back</button>
    </div>
  );

  if (!words?.length) return null;

  const stages = [
    { label: 'Step 1: Flashcards',      icon: <Layers className="w-4 h-4" />,       el: <FlashcardGame      words={words} onNext={next} /> },
    { label: 'Step 2: Match',           icon: <RefreshCw className="w-4 h-4" />,     el: <MatchingGame       words={words} onNext={next} /> },
    { label: 'Step 3: Multiple Choice', icon: <CheckCircle className="w-4 h-4" />,   el: <MultipleChoiceGame words={words} onNext={next} /> },
    { label: 'Step 4: Fill in Blank',   icon: <Edit3 className="w-4 h-4" />,         el: <TypingGame         words={words} onNext={onComplete} /> },
  ];

  return (
    <div className="space-y-4 animate-in fade-in max-w-xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 shadow-sm flex-none">
          <ChevronDown className="w-4 h-4 text-slate-500 rotate-90" />
        </button>
        <div>
          <p className="text-sm font-bold text-slate-800">{levelMeta.label} — Group {groupIdx + 1}</p>
          <p className="text-xs text-slate-400">{groupWords.join(', ')}</p>
        </div>
      </div>

      {stage < stages.length ? (
        <div className="animate-in slide-in-from-right-4 fade-in">
          <div className={`${levelMeta.bg} ${levelMeta.text} px-4 py-2 rounded-xl text-center text-sm font-bold mb-4 border ${levelMeta.border} shadow-sm flex items-center justify-center gap-2`}>
            {stages[stage].icon} {stages[stage].label}
          </div>
          {stages[stage].el}
        </div>
      ) : (
        <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-sm animate-in zoom-in-95">
          <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
            <Trophy className="w-10 h-10" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Group Complete!</h2>
          <p className="text-sm text-slate-500 mb-6">You've practiced all {words.length} words in this group.</p>
          <button onClick={onBack} className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 text-sm">Back to Groups</button>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SRS Review
// ═════════════════════════════════════════════════════════════════════════════
function SRSReview({ words, onUpdateWord }) {
  const now = Date.now();
  const dueWords = useMemo(
    () => words.filter(w => !w.srs || w.srs.nextReview <= now).sort(() => Math.random() - 0.5),
    // intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const sessionWords = useMemo(() => dueWords.slice(0, 20), [dueWords]);

  const [idx, setIdx]           = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats]       = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [done, setDone]         = useState(false);
  const [busy, setBusy]         = useState(false);

  if (words.length === 0) return <NoWordsMessage />;

  // ── All caught up ──
  if (sessionWords.length === 0) {
    const next = words.reduce((m, w) => (w.srs?.nextReview && w.srs.nextReview < m ? w.srs.nextReview : m), Infinity);
    return (
      <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-sm animate-in zoom-in-95">
        <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
          <CheckCircle className="w-10 h-10" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">All Caught Up! 🎉</h3>
        <p className="text-sm text-slate-500">Nothing to review right now</p>
        {next !== Infinity && (
          <p className="text-xs text-indigo-500 font-medium mt-3 bg-indigo-50 px-4 py-2 rounded-full inline-block">
            Next review: {new Date(next).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    );
  }

  // ── Session done ──
  if (done) {
    const total   = stats.again + stats.hard + stats.good + stats.easy;
    const correct = stats.good + stats.easy;
    const pct     = total > 0 ? (correct / total) * 100 : 0;
    return (
      <div className="max-w-sm mx-auto text-center py-10 px-5 bg-white rounded-2xl shadow-sm border border-slate-200 animate-in zoom-in-95 w-full space-y-5">
        {/* Circular progress */}
        <div className="relative w-28 h-28 mx-auto">
          <svg className="w-full h-full -rotate-90">
            <circle cx="56" cy="56" r="48" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-slate-100" />
            <circle cx="56" cy="56" r="48" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="transparent"
              className={pct >= 50 ? 'text-green-500' : 'text-amber-500'}
              strokeDasharray="301.59"
              strokeDashoffset={301.59 - (301.59 * pct) / 100}
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-slate-800">{correct}</span>
            <span className="text-xs text-slate-500">/ {total}</span>
          </div>
        </div>

        <div>
          <h3 className="text-xl font-bold text-slate-800 mb-1">
            {pct === 100 ? 'Perfect! 🏆' : pct >= 50 ? 'Well done! 👍' : 'Keep practicing! 💪'}
          </h3>
          <p className="text-sm text-slate-500">Reviewed {total} · Recalled {correct}</p>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          {[
            { label: 'Again', count: stats.again, color: 'bg-red-50 text-red-600' },
            { label: 'Hard',  count: stats.hard,  color: 'bg-orange-50 text-orange-600' },
            { label: 'Good',  count: stats.good,  color: 'bg-green-50 text-green-600' },
            { label: 'Easy',  count: stats.easy,  color: 'bg-blue-50 text-blue-600' },
          ].map(({ label, count, color }) => (
            <div key={label} className={`rounded-xl py-2.5 font-bold ${color}`}>
              <div className="text-xl">{count}</div>
              <div className="text-[10px] font-medium opacity-70">{label}</div>
            </div>
          ))}
        </div>

        <button
          onClick={() => { setIdx(0); setRevealed(false); setStats({ again: 0, hard: 0, good: 0, easy: 0 }); setDone(false); }}
          className="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-sm"
        >
          Review Again
        </button>
      </div>
    );
  }

  const current   = sessionWords[idx];
  const remaining = sessionWords.length - idx;
  const isNew     = !current.srs || current.srs.repetitions === 0;

  const handleRate = async (quality, statKey) => {
    if (busy) return;
    setBusy(true);
    try {
      await onUpdateWord(current.id, { srs: calculateSRS(current.srs, quality) });
    } catch (e) { console.error(e); }
    setStats(s => ({ ...s, [statKey]: s[statKey] + 1 }));
    if (idx + 1 >= sessionWords.length) { setDone(true); }
    else { setIdx(i => i + 1); setRevealed(false); }
    setBusy(false);
  };

  return (
    <div className="max-w-xl mx-auto w-full space-y-4">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
          <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300" style={{ width: `${(idx / sessionWords.length) * 100}%` }} />
        </div>
        <span className="text-xs text-slate-500 font-semibold whitespace-nowrap">{remaining} left</span>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {revealed ? 'Answer' : 'What does it mean?'}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            isNew ? 'bg-blue-50 text-blue-600' : current.srs.interval >= 21 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
          }`}>
            {isNew ? 'New' : `interval ${current.srs.interval}d`}
          </span>
        </div>

        <div className="px-5 pb-5">
          {!revealed ? (
            /* Front */
            <div className="space-y-4 animate-in fade-in">
              <div className="text-center py-6">
                <p className="text-3xl font-bold text-slate-800 mb-2">{current.thaiTranslation}</p>
                <p className="text-sm text-indigo-500 italic font-medium">{getShortPOS(current.partOfSpeech)}</p>
              </div>

              {current.examples?.[0] && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    "{current.examples[0].en
                      .replace(/<\/?b>/gi, '')
                      .replace(new RegExp(`\\b${current.word}\\b`, 'gi'), '______')}"
                  </p>
                  <p className="text-xs text-slate-400 mt-2">{current.examples[0].th}</p>
                </div>
              )}

              <button
                onClick={() => setRevealed(true)}
                className="w-full py-3.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm text-sm"
              >
                Reveal Answer
              </button>
            </div>
          ) : (
            /* Back */
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="text-center py-2">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <h2 className="text-3xl font-bold text-slate-800 capitalize">{current.word}</h2>
                  <button onClick={() => playAudio(current.word)} className="p-1.5 bg-indigo-50 text-indigo-500 rounded-full hover:bg-indigo-100">
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 mt-1">
                  <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-sm text-slate-600">{current.phonetic}</span>
                  <span className="text-indigo-600 text-sm italic font-medium">{getShortPOS(current.partOfSpeech)}</span>
                </div>
                <p className="text-slate-700 mt-2 font-semibold">{current.thaiTranslation}</p>
              </div>

              {current.examples?.[0] && (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <p className="text-sm text-slate-800 mb-1.5 leading-relaxed"><HighlightedText text={current.examples[0].en} /></p>
                  <p className="text-xs text-slate-500">{current.examples[0].th}</p>
                </div>
              )}

              {/* Rating */}
              <div>
                <p className="text-center text-xs text-slate-400 mb-2 font-medium">Rate your recall</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Again', key: 'again', quality: 1, cls: 'bg-red-50    border-red-200    text-red-600    hover:bg-red-100' },
                    { label: 'Hard',  key: 'hard',  quality: 3, cls: 'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100' },
                    { label: 'Good',  key: 'good',  quality: 4, cls: 'bg-green-50  border-green-200  text-green-600  hover:bg-green-100' },
                    { label: 'Easy',  key: 'easy',  quality: 5, cls: 'bg-blue-50   border-blue-200   text-blue-600   hover:bg-blue-100' },
                  ].map(({ label, key, quality, cls }) => (
                    <button
                      key={label}
                      onClick={() => handleRate(quality, key)}
                      disabled={busy}
                      className={`py-3 rounded-xl border-2 text-xs font-bold transition-all flex flex-col items-center gap-0.5 disabled:opacity-50 ${cls}`}
                    >
                      <span>{label}</span>
                      <span className="text-[10px] font-normal opacity-60">{getProjectedLabel(current.srs, quality)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Skip */}
      <button
        onClick={() => { if (idx + 1 < sessionWords.length) { setIdx(i => i + 1); setRevealed(false); } else setDone(true); }}
        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto"
      >
        <RotateCcw className="w-3 h-3" /> Skip
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ProfileView
// ═════════════════════════════════════════════════════════════════════════════
function ProfileView({ words, user, onLogout, isAdmin, onAdminClick }) {
  const streak = useMemo(() => {
    if (!words.length) return 0;
    const uniqueDates = [...new Set(words.map(w => new Date(w.timestamp).toISOString().split('T')[0]))].sort((a, b) => b.localeCompare(a));
    const today = new Date().toISOString().split('T')[0];
    const yd    = new Date(); yd.setDate(yd.getDate() - 1);
    const yesterday = yd.toISOString().split('T')[0];
    if (!uniqueDates.includes(today) && !uniqueDates.includes(yesterday)) return 0;
    let count = 0;
    let d     = new Date(uniqueDates.includes(today) ? today : yesterday);
    while (uniqueDates.includes(d.toISOString().split('T')[0])) { count++; d.setDate(d.getDate() - 1); }
    return count;
  }, [words]);

  const tier = useMemo(() => {
    if (streak < 3)  return { name: 'Starter',     max: 3,  color: 'text-amber-500',  bg: 'bg-amber-500',  base: 0 };
    if (streak < 7)  return { name: 'On Fire',     max: 7,  color: 'text-orange-500', bg: 'bg-orange-500', base: 3 };
    if (streak < 14) return { name: 'Unstoppable', max: 14, color: 'text-rose-500',   bg: 'bg-rose-500',   base: 7 };
    if (streak < 30) return { name: 'Legendary',   max: 30, color: 'text-violet-500', bg: 'bg-violet-500', base: 14 };
    const cycle = Math.floor(streak / 30);
    return { name: `Mythic x${cycle}`, max: (cycle + 1) * 30, color: 'text-fuchsia-500', bg: 'bg-fuchsia-500', base: cycle * 30 };
  }, [streak]);

  const srsStats = useMemo(() => {
    const now  = Date.now();
    const with_ = words.filter(w => w.srs);
    return {
      due:      words.filter(w => !w.srs || w.srs.nextReview <= now).length,
      mature:   with_.filter(w => w.srs.interval >= 21).length,
      young:    with_.filter(w => w.srs.interval > 0 && w.srs.interval < 21).length,
      newWords: words.length - with_.length,
    };
  }, [words]);

  const progress = Math.min(((streak - tier.base) / (tier.max - tier.base)) * 100, 100);

  return (
    <div className="animate-in fade-in space-y-6 max-w-xl mx-auto w-full">
      {/* Identity card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-r from-indigo-500 to-violet-600 opacity-10" />
        {user.picture
          ? <img src={user.picture} alt={user.name} className="w-20 h-20 rounded-full mx-auto mb-4 border-4 border-white shadow-sm relative z-10 object-cover" />
          : <div className="w-20 h-20 bg-indigo-100 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm relative z-10"><User className="w-10 h-10" /></div>
        }
        <h2 className="text-xl font-bold text-slate-800 relative z-10">{user.name}</h2>
        <p className="text-sm text-slate-500 mt-1 relative z-10">{user.email}</p>
        <button
          onClick={onLogout}
          className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 text-sm text-red-500 bg-red-50 hover:bg-red-100 rounded-xl transition-colors font-medium relative z-10"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>

      {/* Word count + rank */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center">
          <Book className="w-7 h-7 text-indigo-500 mb-2" />
          <span className="text-3xl font-black text-slate-800">{words.length}</span>
          <span className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-widest text-center">Saved Words</span>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center">
          <Trophy className="w-7 h-7 text-amber-500 mb-2" />
          <span className="text-lg font-black text-slate-800 mt-1 mb-1">
            {words.length > 50 ? 'Scholar' : words.length > 10 ? 'Learner' : 'Beginner'}
          </span>
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-widest text-center">Current Rank</span>
        </div>
      </div>

      {/* SRS Stats */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-4">
          <Brain className="w-4 h-4 text-indigo-500" /> SRS Statistics
        </h3>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Due',    value: srsStats.due,      color: 'text-red-500',   bg: 'bg-red-50' },
            { label: 'Young',  value: srsStats.young,    color: 'text-amber-500', bg: 'bg-amber-50' },
            { label: 'Mature', value: srsStats.mature,   color: 'text-green-500', bg: 'bg-green-50' },
            { label: 'New',    value: srsStats.newWords, color: 'text-blue-500',  bg: 'bg-blue-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl py-3`}>
              <div className={`text-xl font-black ${color}`}>{value}</div>
              <div className="text-[10px] text-slate-400 font-bold mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-3 text-center">Mature = interval ≥ 21 days</p>
      </div>

      {/* Streak */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-end mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-full bg-slate-50 border border-slate-100 shadow-sm ${tier.color}`}>
              <Flame className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Day Streak</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-slate-800">{streak}</span>
                <span className="text-sm text-slate-500 font-medium">days</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className={`text-sm font-bold ${tier.color}`}>{tier.name}</span>
            <p className="text-xs text-slate-400 mt-0.5">Next at {tier.max} days</p>
          </div>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
          <div className={`h-2.5 rounded-full ${tier.bg} transition-all duration-1000 ease-out`} style={{ width: `${progress}%` }} />
        </div>
      </div>

      {isAdmin && (
        <button
          onClick={onAdminClick}
          className="w-full py-3 flex items-center justify-center gap-2 text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-2xl border border-indigo-100 transition-colors"
        >
          <Shield className="w-4 h-4" /> Admin Panel
        </button>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// AdminView
// ═════════════════════════════════════════════════════════════════════════════
function AdminView({ user }) {
  const [settings, setSettings]   = useState(null);
  const [models, setModels]       = useState([]);
  const [apiKey, setApiKey]       = useState('');
  const [showKey, setShowKey]     = useState(false);
  const [model, setModel]         = useState('');
  const [newAdmin, setNewAdmin]   = useState('');
  const [saving, setSaving]       = useState(false);
  const [loadingM, setLoadingM]   = useState(false);
  const [msg, setMsg]             = useState('');
  const email = user.email;

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000); };

  useEffect(() => {
    fetch(`${API_BASE}/api/admin/settings?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => { setSettings(d); setModel(d.model); })
      .catch(() => {});
  }, [email]);

  const fetchModels = async () => {
    setLoadingM(true);
    try {
      const r = await fetch(`${API_BASE}/api/admin/models?email=${encodeURIComponent(email)}`);
      const d = await r.json();
      setModels(d.models || []);
    } catch { flash('Failed to load models'); }
    finally { setLoadingM(false); }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const body = { email, model };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await fetch(`${API_BASE}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      setApiKey('');
      // Refresh settings
      const updated = await fetch(`${API_BASE}/api/admin/settings?email=${encodeURIComponent(email)}`).then(r => r.json());
      setSettings(updated);
      flash('Saved!');
    } catch { flash('Save failed'); }
    finally { setSaving(false); }
  };

  const addAdmin = async () => {
    if (!newAdmin.trim()) return;
    try {
      const r = await fetch(`${API_BASE}/api/admin/admins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, newEmail: newAdmin.trim() }),
      });
      if (!r.ok) throw new Error();
      setSettings(s => ({ ...s, admins: [...(s?.admins || []), newAdmin.trim()] }));
      setNewAdmin('');
    } catch { flash('Failed to add admin'); }
  };

  const removeAdmin = async (target) => {
    try {
      const r = await fetch(`${API_BASE}/api/admin/admins/${encodeURIComponent(target)}?email=${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error();
      setSettings(s => ({ ...s, admins: s.admins.filter(a => a !== target) }));
    } catch { flash('Failed to remove admin'); }
  };

  if (!settings) return <div className="py-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

  return (
    <div className="animate-in fade-in space-y-6 max-w-xl mx-auto w-full">
      <p className="text-xs text-slate-400 -mt-2">{email}</p>

      {msg && (
        <div className="bg-indigo-50 text-indigo-700 text-sm font-medium px-4 py-2.5 rounded-xl border border-indigo-100 animate-in fade-in">
          {msg}
        </div>
      )}

      {/* Gemini Config */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <Settings className="w-4 h-4 text-indigo-500" /> Gemini Configuration
        </h3>

        <div className="text-xs px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 font-mono text-slate-500">
          Current key: {settings.apiKeyHint}
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">
            New API Key <span className="normal-case font-normal text-slate-400">(leave blank to keep current)</span>
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="AIza..."
              className="w-full px-3 py-2.5 pr-10 text-sm border border-slate-200 rounded-xl outline-none focus:border-indigo-400 font-mono"
            />
            <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Model</label>
            <button onClick={fetchModels} disabled={loadingM} className="text-xs text-indigo-600 flex items-center gap-1 hover:underline disabled:opacity-50">
              {loadingM ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Load models
            </button>
          </div>
          {models.length > 0 ? (
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:border-indigo-400 bg-white"
            >
              {models.map((m, i) => (
                <option key={m.id} value={m.id}>{m.label}{i === 0 ? ' (smallest)' : ''}</option>
              ))}
            </select>
          ) : (
            <div className="px-3 py-2.5 text-sm border border-slate-100 rounded-xl bg-slate-50 text-slate-600 font-mono">
              {settings.model}
            </div>
          )}
        </div>

        <button
          onClick={saveSettings}
          disabled={saving}
          className="w-full py-2.5 text-sm font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Configuration
        </button>
      </div>

      {/* Admin Management */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4 overflow-hidden">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-500" /> Admin Accounts
        </h3>

        <div className="space-y-2">
          {(settings.admins || []).map(a => (
            <div key={a} className="flex items-center justify-between bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-100">
              <span className="text-sm text-slate-700 font-medium truncate flex-1">{a}</span>
              {a !== email && (
                <button onClick={() => removeAdmin(a)} className="ml-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg flex-none">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {a === email && <span className="text-[10px] text-indigo-500 font-bold ml-2">you</span>}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="email"
            value={newAdmin}
            onChange={e => setNewAdmin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addAdmin()}
            placeholder="email@example.com"
            className="flex-1 px-3 py-2.5 text-sm border border-slate-200 rounded-xl outline-none focus:border-indigo-400"
          />
          <button
            onClick={addAdmin}
            className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 flex items-center gap-1.5 text-sm font-bold"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// WordOfTheDayView
// ═════════════════════════════════════════════════════════════════════════════
function WordOfTheDayView({ onSave, savedWords, user }) {
  const [wotdData, setWotdData]   = useState([]);
  const [wordleWord, setWordleWord] = useState('');
  const [loading, setLoading]     = useState(true);
  const [dailyTab, setDailyTab]   = useState('words');
  const [expandedIdx, setExp]     = useState(null);
  const fetchingRef               = useRef(false);

  useEffect(() => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    (async () => {
      const today    = new Date().toISOString().split('T')[0];
      const cacheKey = `wotd_global_${today}`;
      const cached   = localStorage.getItem(cacheKey);

      if (cached) {
        const { words, wordle } = JSON.parse(cached);
        setWotdData(words);
        setWordleWord(wordle);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/daily`);
        if (!res.ok) throw new Error('Failed to load daily');
        const { words, wordle } = await res.json();
        localStorage.setItem(cacheKey, JSON.stringify({ words, wordle }));
        setWotdData(words);
        setWordleWord(wordle);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading)             return <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;
  if (!wotdData.length)    return <div className="text-center py-20 text-slate-500 text-sm">Failed to load. Please try again later.</div>;

  return (
    <div className="space-y-5 animate-in fade-in flex flex-col h-full max-w-xl mx-auto w-full">
      <div className="flex overflow-x-auto gap-2 pb-1.5 hide-scrollbar flex-none">
        <SubTabButton label="Words"    active={dailyTab === 'words'}    onClick={() => setDailyTab('words')} />
        <SubTabButton label="Practice" active={dailyTab === 'practice'} onClick={() => setDailyTab('practice')} />
        <SubTabButton label="Wordle"   active={dailyTab === 'wordle'}   onClick={() => setDailyTab('wordle')} />
      </div>

      <div className="mt-4 flex-1">
        {dailyTab === 'words' && (
          <div className="space-y-2.5 animate-in fade-in slide-in-from-right-4">
            {wotdData.map((w, i) => {
              const isSaved  = savedWords.some(s => s.word.toLowerCase() === w.word.toLowerCase());
              const isExpanded = expandedIdx === i;
              return (
                <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div
                    className="p-3.5 cursor-pointer flex justify-between items-center hover:bg-slate-50 transition-colors"
                    onClick={() => setExp(isExpanded ? null : i)}
                  >
                    <div className="flex-1 overflow-hidden pr-2">
                      <div className="font-bold text-base text-slate-800 capitalize flex items-baseline gap-2 mb-0.5 truncate">
                        {w.word} <span className="text-xs text-slate-400 font-mono font-normal">{w.phonetic}</span>
                      </div>
                      <div className="text-slate-600 text-sm truncate">
                        <span className="text-indigo-500 italic font-medium mr-1.5">{getShortPOS(w.partOfSpeech)}</span>
                        {w.thaiTranslation}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => { e.stopPropagation(); if (!isSaved) onSave(w); }}
                        className={`p-1.5 rounded-lg transition-colors ${isSaved ? 'text-green-500' : 'text-slate-400 hover:text-indigo-500 hover:bg-indigo-50'}`}
                        title={isSaved ? 'Saved' : 'Save to My Vocabs'}
                      >
                        {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); playAudio(w.word); }} className="p-1.5 text-indigo-500 hover:bg-indigo-100 rounded-lg">
                        <Volume2 className="w-4 h-4" />
                      </button>
                      <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? 'rotate-180 text-indigo-400' : ''}`} />
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="p-3 bg-slate-50 border-t border-slate-100 animate-in slide-in-from-top-1 fade-in">
                      <WordCard result={w} hideHeader />
                      <div className="px-1 pb-1 mt-3">
                        <button
                          onClick={() => onSave(w)}
                          disabled={isSaved}
                          className={`w-full py-2.5 text-sm font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5 ${
                            isSaved ? 'bg-green-50 text-green-600 border border-green-200 cursor-default' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          }`}
                        >
                          {isSaved ? <><CheckCircle className="w-4 h-4" /> Saved</> : 'Save to My Vocabs'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {dailyTab === 'practice' && <DailyPracticeFlow words={wotdData} />}
        {dailyTab === 'wordle'   && <DailyWordle word={wordleWord} user={user} />}
      </div>
    </div>
  );
}

function DailyPracticeFlow({ words }) {
  const [stage, setStage] = useState(0);
  const next = () => setStage(s => s + 1);

  const stages = [
    { label: 'Step 1: Review Flashcards', icon: <Layers className="w-4 h-4" />,      el: <FlashcardGame      words={words} onNext={next} /> },
    { label: 'Step 2: Match the Words',   icon: <RefreshCw className="w-4 h-4" />,    el: <MatchingGame       words={words} onNext={next} /> },
    { label: 'Step 3: Multiple Choice',   icon: <CheckCircle className="w-4 h-4" />,  el: <MultipleChoiceGame words={words} onNext={next} /> },
    { label: 'Step 4: Typing Master',     icon: <Edit3 className="w-4 h-4" />,        el: <TypingGame         words={words} onNext={next} /> },
  ];

  if (stage < stages.length) {
    const { label, icon, el } = stages[stage];
    return (
      <div className="animate-in slide-in-from-right-4 fade-in">
        <div className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl text-center text-sm font-bold mb-4 border border-indigo-100 shadow-sm flex items-center justify-center gap-2">
          {icon} {label}
        </div>
        {el}
      </div>
    );
  }

  return (
    <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-sm animate-in zoom-in-95 mt-4">
      <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
        <Trophy className="w-10 h-10" />
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">Daily Practice Complete!</h2>
      <p className="text-sm text-slate-500 mb-8">You've successfully practiced all 5 words of the day.</p>
      <button onClick={() => setStage(0)} className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 text-sm">Review Again</button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SubTabButton
// ═════════════════════════════════════════════════════════════════════════════
function SubTabButton({ label, active, onClick, badge }) {
  const isSpecial = label.includes('✨') || label.includes('🧠');
  return (
    <button
      onClick={onClick}
      className={`relative whitespace-nowrap px-4 py-1.5 text-sm rounded-full font-bold transition-all shadow-sm ${
        active && isSpecial  ? 'bg-gradient-to-r from-violet-500 to-indigo-600 text-white border border-transparent' :
        active               ? 'bg-indigo-600 text-white border border-indigo-600' :
        isSpecial            ? 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100' :
                               'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
      {badge != null && (
        <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// WordCard
// ═════════════════════════════════════════════════════════════════════════════
function WordCard({ result, hideHeader = false }) {
  const [mnemonic, setMnemonic]     = useState(null);
  const [loadingMn, setLoadingMn]   = useState(false);

  const genMnemonic = async () => {
    setLoadingMn(true);
    const sys = `You are a creative language tutor. Create a short, memorable mnemonic (Thai or mixed EN/TH) to help remember the word.
    Return ONLY: { "mnemonic": "string" }`;
    try {
      const d = await callGeminiJSON(sys, `Word: "${result.word}", Meaning: "${result.thaiTranslation}"`);
      if (d?.mnemonic) setMnemonic(d.mnemonic);
    } catch (e) { console.error(e); }
    finally { setLoadingMn(false); }
  };

  return (
    <div className={`bg-white shadow-sm border border-slate-200 animate-in fade-in slide-in-from-bottom-2 ${hideHeader ? 'p-3 rounded-xl border-none shadow-none' : 'rounded-2xl p-5'}`}>
      {!hideHeader && (
        <>
          <div className="flex justify-between items-start mb-3">
            <div>
              <h2 className="text-2xl font-bold text-slate-800 capitalize">{result.word}</h2>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs">{result.phonetic}</span>
                <span className="italic text-indigo-600 text-sm font-medium">{getShortPOS(result.partOfSpeech)}</span>
              </div>
            </div>
            <button onClick={() => playAudio(result.word)} className="p-2.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100">
              <Volume2 className="w-5 h-5" />
            </button>
          </div>
          <div className="mb-5">
            <h3 className="text-lg font-semibold text-slate-800 border-l-4 border-indigo-500 pl-2.5 leading-snug">{result.thaiTranslation}</h3>
          </div>
        </>
      )}

      <div className="space-y-3">
        <h4 className="font-semibold text-slate-600 text-sm flex items-center gap-1.5"><Type className="w-4 h-4" /> Example Sentences</h4>
        {result.examples?.map((ex, i) => (
          <div key={i} className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <p className="text-slate-800 text-sm mb-1.5 leading-relaxed"><HighlightedText text={ex.en} /></p>
            <p className="text-slate-500 text-xs">{ex.th}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        {!mnemonic && !loadingMn && (
          <button onClick={genMnemonic} className="text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-indigo-100">
            <Sparkles className="w-3.5 h-3.5" /> ✨ Create AI Memory Hook
          </button>
        )}
        {loadingMn && (
          <div className="text-xs font-bold text-indigo-400 flex items-center gap-1.5 px-1 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating memory hook...
          </div>
        )}
        {mnemonic && (
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 p-3 rounded-xl border border-indigo-100 animate-in fade-in">
            <h4 className="text-xs font-bold text-indigo-700 flex items-center gap-1.5 mb-1"><Sparkles className="w-3.5 h-3.5" /> AI Memory Hook</h4>
            <p className="text-sm text-indigo-900 font-medium leading-relaxed">{mnemonic}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// AIStoryGame
// ═════════════════════════════════════════════════════════════════════════════
function AIStoryGame({ words }) {
  const [selected, setSelected] = useState([]);
  const [story, setStory]       = useState(null);
  const [loading, setLoading]   = useState(false);

  if (words.length < 3) return <NoWordsMessage min={3} />;

  const toggle = (w) => {
    if (selected.includes(w.word)) setSelected(selected.filter(x => x !== w.word));
    else if (selected.length < 5)  setSelected([...selected, w.word]);
  };

  const generate = async () => {
    if (selected.length < 2) return;
    setLoading(true); setStory(null);
    const sys = `You are a creative storyteller. Write a short story (3-4 sentences) using exactly all requested words.
    Wrap vocab words in <b> tags in English. Thai translation needs no tags.
    Return ONLY: { "title": "string", "englishStory": "string", "thaiTranslation": "string" }`;
    try {
      const d = await callGeminiJSON(sys, `Story using: ${selected.join(', ')}`);
      if (d?.englishStory) setStory(d);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-slate-200 max-w-2xl mx-auto w-full">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-violet-100 to-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
          <Sparkles className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">✨ AI Story Time</h2>
        <p className="text-sm text-slate-500 mt-1">Pick 2–5 words to create an AI story!</p>
      </div>

      {!story && !loading && (
        <div className="animate-in fade-in">
          <div className="flex flex-wrap gap-2 mb-6 justify-center max-h-48 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-100">
            {words.map(w => {
              const isSel = selected.includes(w.word);
              const isDis = !isSel && selected.length >= 5;
              return (
                <button key={w.id || w.word} onClick={() => toggle(w)} disabled={isDis}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize border transition-all shadow-sm ${
                    isSel ? 'bg-indigo-600 text-white border-indigo-600 scale-105' :
                    isDis ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' :
                            'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                  }`}>
                  {w.word}
                </button>
              );
            })}
          </div>
          <button onClick={generate} disabled={selected.length < 2}
            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 shadow-md hover:shadow-lg transition-all flex justify-center items-center gap-2">
            ✨ Generate Magic Story ({selected.length}/5)
          </button>
        </div>
      )}

      {loading && (
        <div className="py-12 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto mb-4" />
          <p className="text-indigo-600 font-bold animate-pulse">✨ AI is writing your story...</p>
        </div>
      )}

      {story && (
        <div className="space-y-4 animate-in zoom-in-95 fade-in">
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 p-5 rounded-2xl border border-indigo-100 shadow-inner">
            <h3 className="text-lg font-bold text-indigo-800 text-center mb-4 pb-3 border-b border-indigo-200/50 flex items-center justify-center gap-2">
              <BookOpen className="w-5 h-5" /> {story.title}
            </h3>
            <p className="text-slate-800 text-base leading-relaxed mb-4"><HighlightedText text={story.englishStory} /></p>
            <div className="bg-white/60 p-4 rounded-xl border border-indigo-100/50">
              <p className="text-slate-600 text-sm leading-relaxed">{story.thaiTranslation}</p>
            </div>
          </div>
          <button onClick={() => { setStory(null); setSelected([]); }}
            className="w-full py-3 border-2 border-indigo-200 text-indigo-700 text-sm font-bold rounded-xl hover:bg-indigo-50">
            Create Another Story
          </button>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// FlashcardGame
// ═════════════════════════════════════════════════════════════════════════════
function FlashcardGame({ words, onNext }) {
  const [idx, setIdx]         = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [ts, setTs]           = useState(null);
  const [te, setTe]           = useState(null);

  if (!words.length) return <NoWordsMessage />;

  const w         = words[idx];
  const isLast    = idx === words.length - 1;
  const goNext    = () => { if (isLast && onNext) { onNext(); return; } setFlipped(false); setIdx(i => (i + 1) % words.length); };
  const goPrev    = () => { setFlipped(false); setIdx(i => (i - 1 + words.length) % words.length); };
  const onTStart  = e => { setTe(null); setTs(e.targetTouches[0].clientX); };
  const onTMove   = e => setTe(e.targetTouches[0].clientX);
  const onTEnd    = () => { if (ts && te) { const d = ts - te; if (d < -50) goNext(); else if (d > 50) goPrev(); } setTs(null); setTe(null); };

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] max-w-sm mx-auto mt-2 w-full">
      <div className="mb-3 text-slate-500 text-sm font-medium">Card {idx + 1} / {words.length}</div>

      <div
        className="relative w-full aspect-[4/3] perspective-1000 cursor-pointer group select-none"
        onClick={() => setFlipped(!flipped)}
        onTouchStart={onTStart} onTouchMove={onTMove} onTouchEnd={onTEnd}
      >
        <div className={`w-full h-full transition-transform duration-500 transform-style-3d shadow-md rounded-3xl ${flipped ? 'rotate-y-180' : ''}`}>
          {/* Front */}
          <div className="absolute inset-0 backface-hidden bg-white border-2 border-indigo-100 rounded-3xl flex flex-col items-center justify-center p-6 text-center group-hover:border-indigo-300 transition-colors">
            <h2 className="text-3xl font-bold text-slate-800 capitalize mb-2">{w.word}</h2>
            <p className="text-base text-slate-400 font-mono">{w.phonetic}</p>
            <p className="text-xs text-slate-300 mt-4 italic flex items-center gap-1 justify-center"><RefreshCw className="w-3.5 h-3.5" /> Tap to reveal meaning</p>
          </div>
          {/* Back */}
          <div className="absolute inset-0 backface-hidden bg-indigo-600 text-white rounded-3xl flex flex-col items-center justify-center p-6 text-center rotate-y-180">
            <h3 className="text-2xl font-bold mb-2">{w.thaiTranslation}</h3>
            <span className="bg-indigo-500 px-2.5 py-0.5 rounded-full text-xs font-medium mb-4">{getShortPOS(w.partOfSpeech)}</span>
            <div className="text-xs bg-indigo-700/50 p-3 rounded-xl w-full">
              <p className="italic opacity-90 text-left line-clamp-3">"{w.examples?.[0]?.en.replace(/<\/?b>/g, '')}"</p>
            </div>
            <p className="text-[10px] text-indigo-200 mt-3 italic">Tap to flip back</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5 mt-6 w-full justify-center">
        <button onClick={goPrev} className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-600 shadow-sm">Prev</button>
        <button onClick={() => playAudio(w.word)} className="p-3.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 shadow-sm"><Volume2 className="w-5 h-5" /></button>
        <button onClick={goNext} className={`px-5 py-2.5 rounded-xl text-sm font-medium shadow-sm ${isLast && onNext ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
          {isLast && onNext ? 'Finish Step 1' : 'Next'}
        </button>
      </div>
      <p className="mt-5 text-xs text-slate-400">💡 Swipe Right for Next</p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MatchingGame
// ═════════════════════════════════════════════════════════════════════════════
function MatchingGame({ words, onNext }) {
  if (words.length < 4) return <NoWordsMessage min={4} />;

  const [items, setItems]       = useState({ en: [], th: [] });
  const [selEn, setSelEn]       = useState(null);
  const [selTh, setSelTh]       = useState(null);
  const [matched, setMatched]   = useState([]);
  const [mistakes, setMistakes] = useState(0);

  const init = () => {
    const pool = [...words].sort(() => 0.5 - Math.random()).slice(0, Math.min(6, words.length));
    setItems({
      en: pool.map(w => ({ id: w.id || w.word, text: String(w.word) })).sort(() => 0.5 - Math.random()),
      th: pool.map(w => ({ id: w.id || w.word, text: String(w.thaiTranslation) })).sort(() => 0.5 - Math.random()),
    });
    setMatched([]); setMistakes(0); setSelEn(null); setSelTh(null);
  };

  useEffect(init, [words]);

  useEffect(() => {
    if (!selEn || !selTh) return;
    if (selEn.id === selTh.id) {
      setMatched(m => [...m, selEn.id]);
      setSelEn(null); setSelTh(null);
    } else {
      setMistakes(m => m + 1);
      setTimeout(() => { setSelEn(null); setSelTh(null); }, 800);
    }
  }, [selEn, selTh]);

  const done = items.en.length > 0 && matched.length === items.en.length;

  return (
    <div className="max-w-2xl mx-auto bg-white p-5 rounded-2xl shadow-sm border border-slate-200 w-full">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-bold text-slate-800">Match the Words</h2>
        <span className="text-xs text-slate-500">Matched: {matched.length}/{items.en.length} · Mistakes: {mistakes}</span>
      </div>

      {done ? (
        <div className="text-center py-10 animate-in zoom-in-95">
          <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3"><CheckCircle className="w-8 h-8" /></div>
          <h3 className="text-xl font-bold text-slate-800 mb-1.5">Excellent!</h3>
          <p className="text-sm text-slate-500 mb-5">You matched all words!</p>
          <div className="flex gap-3">
            {!onNext && <button onClick={init} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-medium text-sm shadow-sm hover:bg-indigo-700">Play Again</button>}
            {onNext  && <button onClick={onNext} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl text-sm shadow-sm hover:bg-indigo-700">Go to Step 3</button>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {['en', 'th'].map(side => (
            <div key={side} className="space-y-2.5">
              {items[side].map(item => {
                const isMatch = matched.includes(item.id);
                const isSel   = (side === 'en' ? selEn : selTh)?.id === item.id;
                const isErr   = isSel && selEn && selTh && selEn.id !== selTh.id;
                return (
                  <button key={`${side}-${item.id}`} disabled={isMatch}
                    onClick={() => !isMatch && (side === 'en' ? setSelEn(item) : setSelTh(item))}
                    className={`w-full p-3 rounded-xl text-left text-sm font-bold capitalize transition-all border-2 ${
                      isMatch ? 'bg-slate-50 border-slate-100 text-slate-300 opacity-60' :
                      isErr   ? 'bg-red-50 border-red-400 text-red-600' :
                      isSel   ? 'bg-indigo-50 border-indigo-500 text-indigo-700' :
                                'bg-white border-slate-200 text-slate-700 hover:border-indigo-300 shadow-sm'
                    }`}>
                    {item.text}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MultipleChoiceGame
// ═════════════════════════════════════════════════════════════════════════════
function MultipleChoiceGame({ words, onNext }) {
  if (words.length < 4) return <NoWordsMessage min={4} />;

  const [questions, setQs]    = useState([]);
  const [cidx, setCidx]       = useState(0);
  const [score, setScore]     = useState(0);
  const [showRes, setShowRes] = useState(false);
  const [selAns, setSelAns]   = useState(null);

  const gen = () => {
    const picked = [...words].sort(() => 0.5 - Math.random()).slice(0, Math.min(5, words.length));
    setQs(picked.map(tw => {
      const exHtml  = tw.examples?.[0]?.en || `This is a <b>${tw.word}</b>.`;
      const plain   = exHtml.replace(/<\/?b>/gi, '');
      const blanked = plain.replace(new RegExp(`\\b${tw.word}\\b`, 'gi'), '________');
      const opts    = [tw.word, ...words.filter(w => w.word !== tw.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(w => w.word)].sort(() => 0.5 - Math.random());
      return { tw, sentence: blanked, opts };
    }));
    setCidx(0); setScore(0); setShowRes(false); setSelAns(null);
  };

  useEffect(gen, [words]);

  const answer = (opt) => {
    if (selAns) return;
    setSelAns(opt);
    if (opt === questions[cidx].tw.word) setScore(s => s + 1);
    setTimeout(() => {
      if (cidx + 1 < questions.length) { setCidx(c => c + 1); setSelAns(null); }
      else setShowRes(true);
    }, 1500);
  };

  if (!questions.length) return null;
  if (showRes) return <ResultScreen score={score} total={questions.length} onRetry={gen} onNext={onNext} nextText="Go to Step 4" />;

  const q  = questions[cidx];
  const ok = selAns !== null;

  return (
    <div key={cidx} className="max-w-xl mx-auto bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-slate-200 w-full">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-bold text-slate-800">Multiple Choice</h2>
        <div className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full text-xs font-bold">Q {cidx + 1} / {questions.length}</div>
      </div>
      <div className="bg-slate-50 p-5 rounded-xl border border-slate-100 mb-6 text-center">
        <p className="text-base md:text-lg text-slate-800 font-medium leading-relaxed">"{q.sentence}"</p>
        <p className="text-slate-500 mt-3 text-xs">Translation: {q.tw.examples?.[0]?.th}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {q.opts.map((opt, i) => {
          let cls = 'bg-white border-2 border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 shadow-sm';
          if (ok) {
            if (opt === q.tw.word)   cls = 'bg-green-100 border-green-500 text-green-700 font-bold';
            else if (opt === selAns) cls = 'bg-red-100 border-red-500 text-red-700';
            else                     cls = 'bg-slate-50 border-slate-100 text-slate-400 opacity-50';
          }
          return <button key={i} disabled={ok} onClick={() => answer(opt)} className={`p-3.5 rounded-xl text-base capitalize transition-all ${cls}`}>{opt}</button>;
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TypingGame
// ═════════════════════════════════════════════════════════════════════════════
function TypingGame({ words, onNext }) {
  if (!words.length) return <NoWordsMessage />;

  const [questions, setQs]    = useState([]);
  const [cidx, setCidx]       = useState(0);
  const [score, setScore]     = useState(0);
  const [showRes, setShowRes] = useState(false);
  const [input, setInput]     = useState('');
  const [fb, setFb]           = useState(null);
  const [hint, setHint]       = useState(false);

  const gen = () => {
    const picked = [...words].sort(() => 0.5 - Math.random()).slice(0, Math.min(5, words.length));
    setQs(picked.map(tw => {
      const exHtml  = tw.examples?.[0]?.en || `This is a <b>${tw.word}</b>.`;
      const plain   = exHtml.replace(/<\/?b>/gi, '');
      const blanked = plain.replace(new RegExp(`\\b${tw.word}\\b`, 'gi'), '________');
      return { tw, sentence: blanked };
    }));
    setCidx(0); setScore(0); setShowRes(false); setInput(''); setFb(null); setHint(false);
  };

  useEffect(gen, [words]);

  const submit = e => {
    e.preventDefault();
    if (fb || !input.trim()) return;
    const correct = input.toLowerCase().trim() === questions[cidx].tw.word.toLowerCase();
    setFb(correct ? 'correct' : 'incorrect');
    if (correct) setScore(s => s + 1);
    setTimeout(() => {
      if (cidx + 1 < questions.length) { setCidx(c => c + 1); setInput(''); setFb(null); setHint(false); }
      else setShowRes(true);
    }, 2000);
  };

  if (!questions.length) return null;
  if (showRes) return <ResultScreen score={score} total={questions.length} onRetry={gen} onNext={onNext} nextText="Finish Practice" />;

  const q = questions[cidx];

  return (
    <div className="max-w-xl mx-auto bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-slate-200 w-full">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-1.5"><Edit3 className="w-4 h-4 text-indigo-600" /> Fill in the Blank</h2>
        <div className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full text-xs font-bold">Q {cidx + 1} / {questions.length}</div>
      </div>
      <div className="bg-slate-50 p-5 rounded-xl border border-slate-100 mb-6 text-center">
        <p className="text-base md:text-lg text-slate-800 font-medium leading-relaxed">"{q.sentence}"</p>
        <div className="mt-4 h-8 flex items-center justify-center">
          {!hint ? (
            <button type="button" onClick={() => setHint(true)} className="flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg">
              <Lightbulb className="w-3.5 h-3.5" /> Show Hint
            </button>
          ) : (
            <p className="text-slate-500 text-xs bg-white inline-block px-3 py-1.5 rounded-lg border border-slate-200 animate-in fade-in">
              Hint: <span className="font-mono text-indigo-600 font-bold mr-1.5">{q.tw.word[0]}...{q.tw.word.slice(-1)}</span>
              <span className="font-semibold text-slate-700">({q.tw.thaiTranslation})</span>
            </p>
          )}
        </div>
      </div>
      <form onSubmit={submit}>
        <input
          type="text" value={input} onChange={e => setInput(e.target.value)} disabled={!!fb}
          placeholder="Type the missing word..."
          className={`w-full py-3.5 px-5 text-lg text-center outline-none border-2 rounded-xl transition-all font-bold ${
            fb === 'correct'   ? 'border-green-500 bg-green-50 text-green-700' :
            fb === 'incorrect' ? 'border-red-500 bg-red-50 text-red-700' :
                                 'border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 bg-white'
          }`}
          autoFocus
        />
        {fb && (
          <div className={`mt-3 p-3 rounded-xl text-center font-bold animate-in fade-in ${fb === 'correct' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {fb === 'correct' ? '✅ Correct!' : `❌ Answer is "${q.tw.word}"`}
          </div>
        )}
        {!fb && <button type="submit" disabled={!input.trim()} className="w-full mt-3 py-3.5 bg-indigo-600 text-white text-base font-bold rounded-xl hover:bg-indigo-700 disabled:bg-indigo-300 shadow-sm">Check Answer</button>}
      </form>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// DailyWordle
// ═════════════════════════════════════════════════════════════════════════════
function DailyWordle({ word, user }) {
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [history, setHistory]           = useState([]);  // [{date, wordle}]
  const [leaderboard, setLeaderboard]   = useState([]);
  const [lbTab, setLbTab]               = useState('play'); // 'play' | 'rank'
  const [scoreSaved, setScoreSaved]     = useState(false);

  // Load history (last 7 days)
  useEffect(() => {
    fetch(`${API_BASE}/api/wordle/history?limit=7`)
      .then(r => r.json())
      .then(days => setHistory(days))
      .catch(() => {});
  }, []);

  // Load leaderboard for selected date
  useEffect(() => {
    fetch(`${API_BASE}/api/wordle/leaderboard?date=${selectedDate}`)
      .then(r => r.json())
      .then(scores => setLeaderboard(Array.isArray(scores) ? scores : []))
      .catch(() => {});
  }, [selectedDate, scoreSaved]);

  const selectedWord = selectedDate === today ? word : (history.find(h => h.date === selectedDate)?.wordle || '');

  // Save score when game ends
  const handleGameEnd = (guesses, won) => {
    if (!user || scoreSaved) return;
    setScoreSaved(true);
    fetch(`${API_BASE}/api/wordle/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: selectedDate,
        userId: user.sub,
        userName: user.name,
        userPicture: user.picture,
        guesses,
        won,
      }),
    }).then(() => setScoreSaved(s => s)).catch(() => {});
  };

  return (
    <div className="space-y-3 max-w-md mx-auto w-full">
      {/* Day picker */}
      <div className="flex overflow-x-auto gap-1.5 pb-1 hide-scrollbar">
        {history.map(h => (
          <button
            key={h.date}
            onClick={() => { setSelectedDate(h.date); setLbTab('play'); setScoreSaved(false); }}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-bold transition-all flex-none ${
              selectedDate === h.date
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {h.date === today ? 'Today' : new Date(h.date + 'T00:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}
          </button>
        ))}
      </div>

      {/* Play / Rank tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setLbTab('play')}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${lbTab === 'play' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          Play
        </button>
        <button
          onClick={() => setLbTab('rank')}
          className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${lbTab === 'rank' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          Ranking
        </button>
      </div>

      {lbTab === 'play' && selectedWord && (
        <WordleGame
          key={selectedDate}
          word={selectedWord}
          date={selectedDate}
          onGameEnd={handleGameEnd}
        />
      )}
      {lbTab === 'rank' && (
        <WordleLeaderboard leaderboard={leaderboard} date={selectedDate} user={user} />
      )}
    </div>
  );
}

function WordleGame({ word, date, onGameEnd }) {
  const MAX = 6;
  const stateKey = `wordle_state_${date}`;
  const [target] = useState(word.toLowerCase());

  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(stateKey)) || {};
      return s.word === word.toLowerCase() ? s : {};
    } catch { return {}; }
  };
  const saved = load();
  const [guesses, setGuesses] = useState(saved.guesses || []);
  const [curr, setCurr]       = useState('');
  const [status, setStatus]   = useState(saved.status || 'playing');
  const [reported, setReported] = useState(saved.status === 'won' || saved.status === 'lost');

  // Persist state
  useEffect(() => {
    localStorage.setItem(stateKey, JSON.stringify({ word: target, guesses, status }));
  }, [guesses, status]);

  // Report score once
  useEffect(() => {
    if ((status === 'won' || status === 'lost') && !reported) {
      setReported(true);
      onGameEnd?.(guesses.length, status === 'won');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const getColors = (g) => {
    const colors = Array(target.length).fill('bg-slate-500 text-white border-slate-600');
    const arr    = target.split('');
    for (let i = 0; i < g.length; i++) {
      if (g[i] === arr[i]) { colors[i] = 'bg-green-500 text-white border-green-600'; arr[i] = null; }
    }
    for (let i = 0; i < g.length; i++) {
      if (colors[i].includes('green')) continue;
      const j = arr.indexOf(g[i]);
      if (j !== -1) { colors[i] = 'bg-amber-500 text-white border-amber-600'; arr[j] = null; }
    }
    return colors;
  };

  const keyColors = useMemo(() => {
    const map = {};
    const pri = { 'bg-green-500 text-white border-green-600': 3, 'bg-amber-500 text-white border-amber-600': 2 };
    guesses.forEach(g => getColors(g).forEach((c, i) => {
      const ch = g[i];
      if (!map[ch] || (pri[c] ?? 1) > (pri[map[ch]] ?? 1)) map[ch] = c;
    }));
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guesses]);

  useEffect(() => {
    const handler = (e) => {
      if (status !== 'playing') return;
      if (e.key === 'Enter') handleKey('Enter');
      else if (e.key === 'Backspace') handleKey('Backspace');
      else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curr, status, target]);

  const handleKey = (key) => {
    if (status !== 'playing') return;
    if (key === 'Enter') {
      if (curr.length !== target.length) return;
      const ng = [...guesses, curr.toLowerCase()];
      setGuesses(ng);
      if (curr.toLowerCase() === target)  setStatus('won');
      else if (ng.length >= MAX)          setStatus('lost');
      setCurr('');
    } else if (key === 'Backspace') {
      setCurr(p => p.slice(0, -1));
    } else if (curr.length < target.length) {
      setCurr(p => p + key.toLowerCase());
    }
  };

  if (!target) return null;

  return (
    <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 w-full">
      {/* Grid */}
      <div className="flex flex-col gap-1.5 mb-6 w-full max-w-[260px] mx-auto">
        {Array.from({ length: MAX }).map((_, row) => {
          const isCurr = row === guesses.length;
          const guess  = guesses[row] ?? (isCurr ? curr : '');
          const colors = guesses[row] ? getColors(guess) : [];
          return (
            <div key={row} className="flex gap-1.5 justify-center">
              {Array.from({ length: target.length }).map((_, col) => {
                const ch = guess[col] ?? '';
                const cl = colors[col] ?? 'bg-slate-50 border-slate-200 text-slate-800';
                return (
                  <div key={col} className={`flex-1 aspect-square flex items-center justify-center font-bold text-lg uppercase border-2 rounded-lg ${ch && !colors.length ? 'border-indigo-400' : ''} ${cl}`}>
                    {ch}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {status !== 'playing' && (
        <div className={`text-center p-4 rounded-xl mb-5 font-bold animate-in zoom-in-95 ${status === 'won' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {status === 'won' ? `🎉 Won in ${guesses.length}!` : `❌ Word was ${target.toUpperCase()}`}
        </div>
      )}

      {/* Keyboard */}
      <div className="space-y-1.5 px-1">
        {['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row, i) => (
          <div key={i} className="flex justify-center gap-1">
            {i === 2 && <button onClick={() => handleKey('Enter')} className="px-2 py-3.5 bg-slate-200 text-slate-700 text-[10px] font-bold rounded hover:bg-slate-300">ENTER</button>}
            {row.split('').map(k => (
              <button key={k} onClick={() => handleKey(k)} className={`flex-1 py-3.5 text-xs font-bold uppercase rounded shadow-sm transition-colors ${keyColors[k] ?? 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}>{k}</button>
            ))}
            {i === 2 && <button onClick={() => handleKey('Backspace')} className="px-2 py-3.5 bg-slate-200 text-slate-700 font-bold rounded hover:bg-slate-300"><Delete className="w-4 h-4 mx-auto" /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function WordleLeaderboard({ leaderboard, date, user }) {
  const medals = ['🥇', '🥈', '🥉'];
  const today  = new Date().toISOString().split('T')[0];
  const dateLabel = date === today ? 'Today' : new Date(date + 'T00:00:00').toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' });

  if (!leaderboard.length) {
    return (
      <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 shadow-sm">
        <Trophy className="w-10 h-10 text-slate-200 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No scores yet for {dateLabel}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-3">
        <p className="text-xs font-bold text-indigo-700 uppercase tracking-wider">{dateLabel} · {leaderboard.length} players</p>
      </div>
      <div className="divide-y divide-slate-100">
        {leaderboard.map((entry, i) => {
          const isMe = user?.sub === entry.userId;
          return (
            <div key={entry.userId} className={`flex items-center gap-3 px-4 py-3 ${isMe ? 'bg-indigo-50' : ''}`}>
              <span className="text-lg w-7 text-center flex-none">
                {medals[i] || <span className="text-sm font-bold text-slate-400">#{i + 1}</span>}
              </span>
              {entry.userPicture
                ? <img src={entry.userPicture} className="w-8 h-8 rounded-full object-cover flex-none" alt="" />
                : <div className="w-8 h-8 rounded-full bg-indigo-100 flex-none" />
              }
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold truncate ${isMe ? 'text-indigo-700' : 'text-slate-800'}`}>
                  {entry.userName}{isMe ? ' (you)' : ''}
                </p>
              </div>
              <div className={`text-right flex-none ${entry.won ? 'text-green-600' : 'text-red-500'}`}>
                <p className="text-sm font-black">
                  {entry.won ? `${entry.guesses} guess${entry.guesses !== 1 ? 'es' : ''}` : 'Lost'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Shared
// ═════════════════════════════════════════════════════════════════════════════
function NoWordsMessage({ min = 1 }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="bg-indigo-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
        <BookOpen className="w-10 h-10 text-indigo-300" />
      </div>
      <h3 className="text-xl font-bold text-slate-700 mb-1.5">Not Ready</h3>
      <p className="text-slate-500 text-sm max-w-xs mx-auto">Save at least {min} word(s) via the "Find" tab to unlock this game.</p>
    </div>
  );
}

function ResultScreen({ score, total, onRetry, onNext, nextText = 'Next Game' }) {
  const pct = total > 0 ? (score / total) * 100 : 0;
  return (
    <div className="max-w-sm mx-auto text-center py-10 px-5 bg-white rounded-2xl shadow-sm border border-slate-200 animate-in zoom-in-95 w-full">
      <div className="relative w-28 h-28 mx-auto mb-5">
        <svg className="w-full h-full -rotate-90">
          <circle cx="56" cy="56" r="48" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-slate-100" />
          <circle cx="56" cy="56" r="48" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="transparent"
            className={pct >= 50 ? 'text-green-500' : 'text-amber-500'}
            strokeDasharray="301.59"
            strokeDashoffset={301.59 - (301.59 * pct) / 100}
            style={{ transition: 'stroke-dashoffset 1s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-slate-800">{score}</span>
          <span className="text-xs text-slate-500">/ {total}</span>
        </div>
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-1.5">{pct === 100 ? 'Perfect!' : pct >= 50 ? 'Well Done!' : 'Keep Trying!'}</h3>
      <p className="text-sm text-slate-500 mb-6">You got {score} out of {total} correct.</p>
      <div className="flex gap-3">
        {!onNext && <button onClick={onRetry} className="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-sm">Play Again</button>}
        {onNext && (
          <>
            <button onClick={onRetry} className="flex-1 py-3 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 shadow-sm">Retry</button>
            <button onClick={onNext}  className="flex-1 py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-sm">{nextText}</button>
          </>
        )}
      </div>
    </div>
  );
}
