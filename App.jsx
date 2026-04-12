import React, { useState, useEffect, useMemo } from 'react';
import { Search, Volume2, Trash2, BookOpen, Layers, Edit3, Type, CheckCircle, RefreshCw, AlertCircle, Loader2, Sun, Book, Lightbulb, Clock, ChevronDown, User, Trophy, Delete, Sparkles, Flame, Brain, RotateCcw } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot } from 'firebase/firestore';

// --- Firebase Initialization ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Helper: Universal Gemini API Caller with Exponential Backoff ---
const callGeminiJSON = async (systemPrompt, userPrompt) => {
  const apiKey = "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { responseMimeType: "application/json" }
  };
  const delays = [1000, 2000, 4000, 8000, 16000];

  for (let i = 0; i < 5; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return JSON.parse(data.candidates[0].content.parts[0].text);
    } catch (e) {
      if (i === 4) throw e;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
};

// --- Helper for POS abbreviation ---
const getShortPOS = (pos) => {
  if (!pos) return '';
  const p = pos.toLowerCase();
  if (p.includes('noun')) return 'n.';
  if (p.includes('verb')) return 'v.';
  if (p.includes('adjective') || p === 'adj') return 'adj.';
  if (p.includes('adverb') || p === 'adv') return 'adv.';
  if (p.includes('preposition') || p === 'prep') return 'prep.';
  if (p.includes('pronoun') || p === 'pron') return 'pron.';
  if (p.includes('conjunction') || p === 'conj') return 'conj.';
  if (p.includes('interjection') || p === 'int') return 'int.';
  return pos;
};

// --- SM-2 Spaced Repetition Algorithm ---
const calculateSRS = (currentSrs, quality) => {
  // quality: 1=Again, 2=Hard, 4=Good, 5=Easy  (SM-2 scale)
  let { repetitions = 0, easiness = 2.5, interval = 1 } = currentSrs || {};

  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easiness);
    repetitions++;
    easiness = easiness + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    easiness = Math.max(1.3, Math.round(easiness * 100) / 100);
  } else {
    // Failed — reset streak but keep easiness penalty
    repetitions = 0;
    interval = 1;
    easiness = Math.max(1.3, easiness - 0.2);
  }

  return {
    repetitions,
    easiness,
    interval,
    nextReview: Date.now() + interval * 24 * 60 * 60 * 1000,
    lastReview: Date.now(),
  };
};

// Get projected interval label for a given quality without mutating state
const getProjectedLabel = (currentSrs, quality) => {
  const { interval } = calculateSRS(currentSrs, quality);
  if (interval <= 1) return '1 วัน';
  if (interval < 30) return `${interval} วัน`;
  if (interval < 365) return `${Math.round(interval / 30)} เดือน`;
  return `${Math.round(interval / 365)} ปี`;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [words, setWords] = useState([]);
  const [activeTab, setActiveTab] = useState('find');
  const [isInitializing, setIsInitializing] = useState(true);

  // --- Auth & Data Fetching ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsInitializing(false);
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    const wordsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'words');
    const unsubscribeWords = onSnapshot(wordsRef, (snapshot) => {
      const wordsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      wordsData.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setWords(wordsData);
    }, (error) => {
      console.error("Firestore error:", error);
    });

    return () => unsubscribeWords();
  }, [user]);

  const saveWordToDb = async (wordData) => {
    if (!user) return;
    const wordsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'words');
    const wordDoc = doc(wordsRef, wordData.word.toLowerCase());
    // Initialize SRS for new words — due immediately
    const srsInit = wordData.srs || {
      repetitions: 0,
      easiness: 2.5,
      interval: 1,
      nextReview: Date.now(),
      lastReview: null,
    };
    await setDoc(wordDoc, { ...wordData, srs: srsInit, timestamp: Date.now() });
  };

  const updateWordInDb = async (wordId, updates) => {
    if (!user) return;
    const wordDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'words', wordId);
    await updateDoc(wordDoc, updates);
  };

  const deleteWordFromDb = async (wordId) => {
    if (!user) return;
    const wordDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'words', wordId);
    await deleteDoc(wordDoc);
  };

  // Count words due for SRS review
  const dueCount = useMemo(() => {
    const now = Date.now();
    return words.filter(w => !w.srs || w.srs.nextReview <= now).length;
  }, [words]);

  if (isInitializing) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-24 md:pb-0 flex flex-col">
      {/* Header */}
      <header className="bg-indigo-600 text-white p-3 shadow-md sticky top-0 z-10 flex-none">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            My Dict
          </h1>
          <div className="text-indigo-100 text-xs hidden md:block font-medium">
            {words.length} saved words
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto p-4 md:mt-4 w-full flex-1 flex flex-col">
        {activeTab === 'find' && <FindView onSave={saveWordToDb} words={words} />}
        {activeTab === 'vocabs' && <MyVocabsView words={words} onDelete={deleteWordFromDb} />}
        {activeTab === 'learning' && <LearningView words={words} onUpdateWord={updateWordInDb} dueCount={dueCount} />}
        {activeTab === 'wotd' && <WordOfTheDayView onSave={saveWordToDb} savedWords={words} />}
        {activeTab === 'profile' && <ProfileView words={words} user={user} />}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 md:relative md:bg-transparent md:border-none md:mt-6 md:max-w-4xl md:mx-auto z-20 flex-none">
        <div className="flex justify-around items-center md:justify-center md:gap-6 p-2 md:p-0">
          <NavButton icon={<Book />} label="Vocabs" active={activeTab === 'vocabs'} onClick={() => setActiveTab('vocabs')} />
          <NavButton icon={<Layers />} label="Learn" active={activeTab === 'learning'} onClick={() => setActiveTab('learning')} badge={dueCount > 0 ? dueCount : null} />

          <button
            onClick={() => setActiveTab('find')}
            className={`flex items-center justify-center px-6 py-2.5 md:px-8 md:py-3 rounded-2xl shadow-sm transition-all duration-200 mx-1 ${
              activeTab === 'find'
                ? 'bg-indigo-600 text-white scale-105 shadow-indigo-200'
                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
            }`}
          >
            <Search className="w-6 h-6 md:w-7 md:h-7" />
          </button>

          <NavButton icon={<Sun />} label="Daily" active={activeTab === 'wotd'} onClick={() => setActiveTab('wotd')} />
          <NavButton icon={<User />} label="Profile" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </div>
      </nav>
    </div>
  );
}

// --- Components ---

function NavButton({ icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center w-full md:w-auto md:flex-row md:px-4 md:py-2.5 md:rounded-xl md:shadow-sm transition-all duration-200 ${
        active
          ? 'text-indigo-600 md:bg-indigo-600 md:text-white scale-105'
          : 'text-slate-500 hover:text-indigo-500 md:bg-white md:hover:bg-slate-50'
      } py-1.5`}
    >
      <div className="md:mr-2 w-5 h-5 relative">
        {React.cloneElement(icon, { size: active ? 22 : 18, className: "mx-auto" })}
        {badge != null && (
          <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
      <span className="text-[10px] md:text-xs font-medium">{label}</span>
    </button>
  );
}

function HighlightedText({ text }) {
  if (!text) return null;
  if (typeof text !== 'string') return <span>{String(text)}</span>;
  const parts = text.split(/<b>(.*?)<\/b>/gi);
  return (
    <span>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-indigo-600 font-bold underline decoration-2 underline-offset-4">{part}</span>
        ) : (
          part
        )
      )}
    </span>
  );
}

const playAudio = (wordText) => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(wordText);
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  }
};

// --- Views ---

function FindView({ onSave, words }) {
  const [queryText, setQueryText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const inputRef = React.useRef(null);

  useEffect(() => {
    if (!result) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [result]);

  const handleSearch = async (e, directWord = null) => {
    if (e) e.preventDefault();
    const wordToSearch = directWord || queryText;
    if (!wordToSearch.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const systemPrompt = `You are an English-Thai dictionary. Return ONLY a valid JSON object with this exact schema:
    {
      "word": "string (the word)",
      "phonetic": "string (pronunciation like /wɜːrd/)",
      "partOfSpeech": "string (e.g., noun, verb)",
      "thaiTranslation": "string (short thai meaning)",
      "examples": [
        {"en": "string (example sentence 1, wrap the vocabulary word in <b> tags)", "th": "string (thai translation 1)"},
        {"en": "string (example sentence 2, wrap the vocabulary word in <b> tags)", "th": "string (thai translation 2)"}
      ]
    }.
    Provide exactly 2 examples. If the input is not a valid word, try to find the closest match or return an error JSON {"error": "Invalid word"}.`;

    try {
      const data = await callGeminiJSON(systemPrompt, `Provide dictionary details for the English word: "${wordToSearch.trim()}".`);
      if (data.error) {
        setError("Word not found. Please try another word.");
      } else {
        setResult(data);
        onSave(data);
        if (!directWord) setQueryText('');
      }
    } catch (err) {
      console.error(err);
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setQueryText(e.target.value);
    if (e.target.value.trim() === '') {
      setResult(null);
      setError(null);
    }
  };

  return (
    <div className="w-full flex-1 flex flex-col pt-2 animate-in fade-in">
      <div className="w-full max-w-xl mx-auto mb-6">
        <form onSubmit={handleSearch} className="relative shadow-md rounded-2xl overflow-hidden bg-white border-2 border-slate-100 hover:border-indigo-300 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-50 transition-all">
          <input
            ref={inputRef}
            type="text"
            value={queryText}
            onChange={handleInputChange}
            placeholder="Type an English word here..."
            className="w-full py-3.5 pl-5 pr-14 text-lg outline-none bg-transparent"
          />
          <button
            type="submit"
            disabled={loading || !queryText.trim()}
            className="absolute right-2 top-2 bottom-2 bg-indigo-600 text-white px-4 rounded-xl hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors shadow-sm flex items-center justify-center"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          </button>
        </form>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 text-sm rounded-xl flex items-center gap-2 mt-4 animate-in fade-in">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="animate-in fade-in slide-in-from-bottom-4 w-full max-w-xl mx-auto">
          <WordCard result={result} />
        </div>
      )}

      {!result && !loading && words.length > 0 && (
        <div className="w-full max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4 delay-100">
          <div className="flex items-center gap-2 mb-4 justify-center">
            <div className="h-px bg-slate-200 flex-1"></div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 px-2">
              <Clock className="w-3.5 h-3.5" /> Recent Searches
            </h3>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <div className="space-y-2.5">
            {words.slice(0, 10).map(word => {
              const isExpanded = expandedId === word.id;
              return (
                <div key={word.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all">
                  <div
                    className="p-3.5 cursor-pointer flex justify-between items-center hover:bg-slate-50 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : word.id)}
                  >
                    <div className="flex-1 overflow-hidden pr-2">
                      <div className="font-bold text-base text-slate-800 capitalize flex items-baseline gap-2 mb-0.5 truncate">
                        {word.word}
                        <span className="text-xs text-slate-400 font-mono font-normal tracking-tight">{word.phonetic}</span>
                      </div>
                      <div className="text-slate-600 text-sm truncate">
                        <span className="text-indigo-500 italic font-medium mr-1.5">{getShortPOS(word.partOfSpeech)}</span>
                        {word.thaiTranslation}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); playAudio(word.word); }} className="p-1.5 text-indigo-500 hover:bg-indigo-100 rounded-lg transition-colors">
                        <Volume2 className="w-4 h-4" />
                      </button>
                      <div className="p-1 text-slate-300">
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-indigo-400' : ''}`} />
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="p-3 bg-slate-50 border-t border-slate-100 animate-in slide-in-from-top-1 fade-in">
                      <WordCard result={word} hideHeader={true} />
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
      <h2 className="text-lg font-bold text-slate-800 flex justify-between items-center mb-4">
        <span>My Vocabs</span>
        <span className="text-xs font-medium bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full">
          {words.length} words
        </span>
      </h2>

      <div className="space-y-2.5">
        {words.map((word) => {
          const isExpanded = expandedId === word.id;
          const now = Date.now();
          const isDue = !word.srs || word.srs.nextReview <= now;
          return (
            <div key={word.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all">
              <div
                className="p-3.5 cursor-pointer flex justify-between items-center hover:bg-slate-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : word.id)}
              >
                <div className="flex-1 overflow-hidden pr-2">
                  <div className="font-bold text-base text-slate-800 capitalize flex items-baseline gap-2 mb-0.5 truncate">
                    {word.word}
                    <span className="text-xs text-slate-400 font-mono font-normal tracking-tight">{word.phonetic}</span>
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
                  <button onClick={(e) => { e.stopPropagation(); playAudio(word.word); }} className="p-1.5 text-indigo-500 hover:bg-indigo-100 rounded-lg transition-colors">
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onDelete(word.id); }} className="p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="p-1 text-slate-300">
                    <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180 text-indigo-400' : ''}`} />
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="p-3 bg-slate-50 border-t border-slate-100 animate-in slide-in-from-top-1 fade-in">
                  <WordCard result={word} hideHeader={true} />
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

function LearningView({ words, onUpdateWord, dueCount }) {
  const [subTab, setSubTab] = useState('srs');

  return (
    <div className="space-y-5 animate-in fade-in flex flex-col h-full max-w-xl mx-auto w-full">
      <div className="flex overflow-x-auto gap-2 pb-1.5 hide-scrollbar flex-none">
        <SubTabButton label="🧠 SRS Review" active={subTab === 'srs'} onClick={() => setSubTab('srs')} badge={dueCount > 0 ? dueCount : null} />
        <SubTabButton label="✨ AI Story" active={subTab === 'story'} onClick={() => setSubTab('story')} />
        <SubTabButton label="Flashcards" active={subTab === 'flashcard'} onClick={() => setSubTab('flashcard')} />
        <SubTabButton label="Matching" active={subTab === 'matching'} onClick={() => setSubTab('matching')} />
        <SubTabButton label="Choices" active={subTab === 'choice'} onClick={() => setSubTab('choice')} />
        <SubTabButton label="Typing" active={subTab === 'typing'} onClick={() => setSubTab('typing')} />
      </div>

      <div className="mt-2 flex-1">
        {subTab === 'srs' && <SRSReview words={words} onUpdateWord={onUpdateWord} />}
        {subTab === 'story' && <AIStoryGame words={words} />}
        {subTab === 'flashcard' && <FlashcardGame words={words} />}
        {subTab === 'matching' && <MatchingGame words={words} />}
        {subTab === 'choice' && <MultipleChoiceGame words={words} />}
        {subTab === 'typing' && <TypingGame words={words} />}
      </div>
    </div>
  );
}

// ─── SRS Review Component ────────────────────────────────────────────────────

function SRSReview({ words, onUpdateWord }) {
  const now = Date.now();

  const dueWords = useMemo(() =>
    words
      .filter(w => !w.srs || w.srs.nextReview <= now)
      .sort(() => Math.random() - 0.5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words.length]
  );

  const [sessionWords] = useState(() => dueWords.slice(0, 20));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [done, setDone] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  if (words.length === 0) return <NoWordsMessage />;

  // All caught up
  if (sessionWords.length === 0) {
    const nextDue = words.reduce((min, w) => {
      if (!w.srs?.nextReview) return min;
      return w.srs.nextReview < min ? w.srs.nextReview : min;
    }, Infinity);

    return (
      <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-sm animate-in zoom-in-95">
        <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
          <CheckCircle className="w-10 h-10" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">ทบทวนครบแล้ว!</h3>
        <p className="text-sm text-slate-500 mb-1">ไม่มีคำที่ต้องทบทวนในตอนนี้</p>
        {nextDue !== Infinity && (
          <p className="text-xs text-indigo-500 font-medium mt-2 bg-indigo-50 px-4 py-2 rounded-full inline-block">
            ทบทวนครั้งต่อไป: {new Date(nextDue).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    );
  }

  // Session complete
  if (done) {
    const total = stats.again + stats.hard + stats.good + stats.easy;
    const correct = stats.good + stats.easy;
    return (
      <div className="max-w-sm mx-auto text-center py-10 px-5 bg-white rounded-2xl shadow-sm border border-slate-200 animate-in zoom-in-95 w-full space-y-5">
        <div className="relative w-28 h-28 mx-auto">
          <svg className="w-full h-full transform -rotate-90">
            <circle cx="56" cy="56" r="48" className="text-slate-100 stroke-current" strokeWidth="10" fill="transparent" />
            <circle
              cx="56" cy="56" r="48"
              className={`${correct / total >= 0.5 ? 'text-green-500' : 'text-amber-500'} stroke-current transition-all duration-1000 ease-out`}
              strokeWidth="10" strokeLinecap="round" fill="transparent"
              strokeDasharray={301.59}
              strokeDashoffset={301.59 - (301.59 * correct) / total}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center flex-col">
            <span className="text-2xl font-bold text-slate-800">{correct}</span>
            <span className="text-xs text-slate-500">/ {total}</span>
          </div>
        </div>

        <div>
          <h3 className="text-xl font-bold text-slate-800 mb-1">
            {correct === total ? 'สมบูรณ์แบบ!' : correct / total >= 0.5 ? 'ทำได้ดีมาก!' : 'ฝึกต่อไปนะ!'}
          </h3>
          <p className="text-sm text-slate-500">ทบทวน {total} คำ · จำได้ {correct} คำ</p>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          {[
            { label: 'Again', count: stats.again, color: 'bg-red-50 text-red-600' },
            { label: 'Hard', count: stats.hard, color: 'bg-orange-50 text-orange-600' },
            { label: 'Good', count: stats.good, color: 'bg-green-50 text-green-600' },
            { label: 'Easy', count: stats.easy, color: 'bg-blue-50 text-blue-600' },
          ].map(({ label, count, color }) => (
            <div key={label} className={`rounded-xl py-2 font-bold ${color}`}>
              <div className="text-lg">{count}</div>
              <div className="text-[10px] font-medium opacity-70">{label}</div>
            </div>
          ))}
        </div>

        <button
          onClick={() => { setCurrentIndex(0); setIsRevealed(false); setStats({ again: 0, hard: 0, good: 0, easy: 0 }); setDone(false); }}
          className="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
        >
          ทบทวนอีกครั้ง
        </button>
      </div>
    );
  }

  const currentWord = sessionWords[currentIndex];
  const remaining = sessionWords.length - currentIndex;

  const handleRate = async (quality, statKey) => {
    if (isUpdating) return;
    setIsUpdating(true);
    const newSrs = calculateSRS(currentWord.srs, quality);
    try {
      await onUpdateWord(currentWord.id, { srs: newSrs });
    } catch (e) {
      console.error(e);
    }
    setStats(prev => ({ ...prev, [statKey]: prev[statKey] + 1 }));

    if (currentIndex + 1 >= sessionWords.length) {
      setDone(true);
    } else {
      setCurrentIndex(i => i + 1);
      setIsRevealed(false);
    }
    setIsUpdating(false);
  };

  const isNewWord = !currentWord.srs || currentWord.srs.repetitions === 0;

  return (
    <div className="max-w-xl mx-auto w-full space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(currentIndex / sessionWords.length) * 100}%` }}
          />
        </div>
        <span className="text-xs text-slate-500 font-semibold whitespace-nowrap">
          {remaining} เหลือ
        </span>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {isRevealed ? 'คำตอบ' : 'ความหมายคืออะไร?'}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            isNewWord
              ? 'bg-blue-50 text-blue-600'
              : currentWord.srs.interval >= 7
                ? 'bg-green-50 text-green-600'
                : 'bg-amber-50 text-amber-600'
          }`}>
            {isNewWord ? 'คำใหม่' : `interval ${currentWord.srs.interval}d`}
          </span>
        </div>

        <div className="px-5 pb-5">
          {!isRevealed ? (
            /* ── Front: show Thai, hide English ── */
            <div className="space-y-4 animate-in fade-in">
              <div className="text-center py-6">
                <p className="text-3xl font-bold text-slate-800 mb-2">{currentWord.thaiTranslation}</p>
                <p className="text-sm text-indigo-500 italic font-medium">{getShortPOS(currentWord.partOfSpeech)}</p>
              </div>

              {currentWord.examples?.[0] && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-center">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    "{currentWord.examples[0].en
                      .replace(/<\/?b>/gi, '')
                      .replace(new RegExp(`\\b${currentWord.word}\\b`, 'gi'), '______')}"
                  </p>
                  <p className="text-xs text-slate-400 mt-2">{currentWord.examples[0].th}</p>
                </div>
              )}

              <button
                onClick={() => setIsRevealed(true)}
                className="w-full py-3.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm text-sm"
              >
                แสดงคำตอบ
              </button>
            </div>
          ) : (
            /* ── Back: reveal full word + rating ── */
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="text-center py-2">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <h2 className="text-3xl font-bold text-slate-800 capitalize">{currentWord.word}</h2>
                  <button onClick={() => playAudio(currentWord.word)} className="p-1.5 bg-indigo-50 text-indigo-500 rounded-full hover:bg-indigo-100">
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2 mt-1">
                  <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-sm text-slate-600">{currentWord.phonetic}</span>
                  <span className="text-indigo-600 text-sm italic font-medium">{getShortPOS(currentWord.partOfSpeech)}</span>
                </div>
                <p className="text-slate-700 mt-2 font-semibold">{currentWord.thaiTranslation}</p>
              </div>

              {currentWord.examples?.[0] && (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                  <p className="text-sm text-slate-800 mb-1.5 leading-relaxed">
                    <HighlightedText text={currentWord.examples[0].en} />
                  </p>
                  <p className="text-xs text-slate-500">{currentWord.examples[0].th}</p>
                </div>
              )}

              {/* Rating Buttons */}
              <div className="pt-1">
                <p className="text-center text-xs text-slate-400 mb-2 font-medium">ให้คะแนนความจำของคุณ</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Again', statKey: 'again', quality: 1, color: 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100' },
                    { label: 'Hard', statKey: 'hard', quality: 2, color: 'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100' },
                    { label: 'Good', statKey: 'good', quality: 4, color: 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100' },
                    { label: 'Easy', statKey: 'easy', quality: 5, color: 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100' },
                  ].map(({ label, statKey, quality, color }) => (
                    <button
                      key={label}
                      onClick={() => handleRate(quality, statKey)}
                      disabled={isUpdating}
                      className={`py-3 rounded-xl border-2 text-xs font-bold transition-all flex flex-col items-center gap-0.5 disabled:opacity-50 ${color}`}
                    >
                      <span>{label}</span>
                      <span className="text-[10px] font-normal opacity-60">
                        {getProjectedLabel(currentWord.srs, quality)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Skip button */}
      <button
        onClick={() => { setCurrentIndex(i => Math.min(i + 1, sessionWords.length - 1)); setIsRevealed(false); }}
        className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mx-auto"
      >
        <RotateCcw className="w-3 h-3" /> ข้ามคำนี้
      </button>
    </div>
  );
}

// ─── Profile View ────────────────────────────────────────────────────────────

function ProfileView({ words, user }) {
  const streak = useMemo(() => {
    if (!words || words.length === 0) return 0;
    const uniqueDates = [...new Set(words.map(w => new Date(w.timestamp).toISOString().split('T')[0]))]
      .sort((a, b) => b.localeCompare(a));
    const today = new Date().toISOString().split('T')[0];
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split('T')[0];
    if (!uniqueDates.includes(today) && !uniqueDates.includes(yesterday)) return 0;
    let currentStreak = 0;
    let dateToCheck = new Date(uniqueDates.includes(today) ? today : yesterday);
    while (true) {
      const dateString = dateToCheck.toISOString().split('T')[0];
      if (uniqueDates.includes(dateString)) { currentStreak++; dateToCheck.setDate(dateToCheck.getDate() - 1); }
      else break;
    }
    return currentStreak;
  }, [words]);

  const tier = useMemo(() => {
    if (streak < 3) return { name: 'Starter', max: 3, color: 'text-amber-500', bg: 'bg-amber-500', base: 0 };
    if (streak < 7) return { name: 'On Fire', max: 7, color: 'text-orange-500', bg: 'bg-orange-500', base: 3 };
    if (streak < 14) return { name: 'Unstoppable', max: 14, color: 'text-rose-500', bg: 'bg-rose-500', base: 7 };
    if (streak < 30) return { name: 'Legendary', max: 30, color: 'text-violet-500', bg: 'bg-violet-500', base: 14 };
    const cycle = Math.floor(streak / 30);
    return { name: `Mythic x${cycle}`, max: (cycle + 1) * 30, color: 'text-fuchsia-500', bg: 'bg-fuchsia-500', base: cycle * 30 };
  }, [streak]);

  const progressPercent = Math.min(((streak - tier.base) / (tier.max - tier.base)) * 100, 100);

  // SRS stats
  const srsStats = useMemo(() => {
    const now = Date.now();
    const withSrs = words.filter(w => w.srs);
    const due = words.filter(w => !w.srs || w.srs.nextReview <= now).length;
    const mature = withSrs.filter(w => w.srs.interval >= 21).length;
    const young = withSrs.filter(w => w.srs.interval > 0 && w.srs.interval < 21).length;
    return { due, mature, young, newWords: words.length - withSrs.length };
  }, [words]);

  return (
    <div className="animate-in fade-in space-y-6 max-w-xl mx-auto w-full">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-r from-indigo-500 to-violet-600 opacity-10"></div>
        <div className="w-20 h-20 bg-indigo-100 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm relative z-10">
          <User className="w-10 h-10" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 relative z-10">My Profile</h2>
        <p className="text-sm text-slate-500 mt-1 font-mono bg-slate-50 inline-block px-3 py-1 rounded-full border border-slate-100 relative z-10">
          ID: {user?.uid?.slice(0, 8) || 'Guest'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center">
          <Book className="w-7 h-7 text-indigo-500 mb-2" />
          <span className="text-3xl font-black text-slate-800">{words.length}</span>
          <span className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-widest text-center">Saved Words</span>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center">
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
            { label: 'Due', value: srsStats.due, color: 'text-red-500', bg: 'bg-red-50' },
            { label: 'Young', value: srsStats.young, color: 'text-amber-500', bg: 'bg-amber-50' },
            { label: 'Mature', value: srsStats.mature, color: 'text-green-500', bg: 'bg-green-50' },
            { label: 'New', value: srsStats.newWords, color: 'text-blue-500', bg: 'bg-blue-50' },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-xl py-3`}>
              <div className={`text-xl font-black ${color}`}>{value}</div>
              <div className="text-[10px] text-slate-400 font-bold mt-0.5">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-400 mt-3 text-center">Mature = interval ≥ 21 วัน</p>
      </div>

      {/* Streak */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-end mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-full bg-slate-50 ${tier.color} border border-slate-100 shadow-sm`}>
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
          <div className={`h-2.5 rounded-full ${tier.bg} transition-all duration-1000 ease-out`} style={{ width: `${progressPercent}%` }}></div>
        </div>
      </div>
    </div>
  );
}

// ─── Word of the Day View ─────────────────────────────────────────────────────

function WordOfTheDayView({ onSave, savedWords }) {
  const [wotdData, setWotdData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dailyTab, setDailyTab] = useState('words');
  const [expandedIdx, setExpandedIdx] = useState(null);

  useEffect(() => {
    const fetchWordOfTheDay = async () => {
      const today = new Date().toISOString().split('T')[0];
      const cacheKey = `wotd_5words_${today}`;
      const cached = localStorage.getItem(cacheKey);

      if (cached) {
        setWotdData(JSON.parse(cached).map(w => ({ ...w, id: w.id || w.word })));
        setLoading(false);
        return;
      }

      const systemPrompt = `You are an English-Thai dictionary. Return ONLY a valid JSON object containing an array of 5 words with this exact schema:
      {
        "words": [
          {
            "word": "string",
            "phonetic": "string",
            "partOfSpeech": "string",
            "thaiTranslation": "string",
            "examples": [
              {"en": "string (wrap the vocabulary word in <b> tags)", "th": "string"},
              {"en": "string (wrap the vocabulary word in <b> tags)", "th": "string"}
            ]
          }
        ]
      }. Provide exactly 2 examples per word. Make words useful for daily learning.`;

      try {
        const result = await callGeminiJSON(systemPrompt, `Generate 5 random, useful, and interesting English vocabulary words for a daily lesson.`);
        if (result?.words) {
          const wordsWithId = result.words.map(w => ({ ...w, id: w.word }));
          localStorage.setItem(cacheKey, JSON.stringify(wordsWithId));
          setWotdData(wordsWithId);
        }
      } catch (err) {
        console.error("Failed to fetch WOTD", err);
      } finally {
        setLoading(false);
      }
    };
    fetchWordOfTheDay();
  }, []);

  if (loading) return <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;
  if (!wotdData || wotdData.length === 0) return <div className="text-center py-20 text-slate-500 text-sm">Failed to load. Please try again later.</div>;

  return (
    <div className="space-y-5 animate-in fade-in flex flex-col h-full max-w-xl mx-auto w-full">
      <div className="flex items-center gap-2 mb-2 flex-none">
        <Sun className="text-amber-500 w-5 h-5" />
        <h2 className="text-lg font-bold text-slate-800">5 Words of the Day</h2>
      </div>
      <div className="flex overflow-x-auto gap-2 pb-1.5 hide-scrollbar flex-none">
        <SubTabButton label="Words" active={dailyTab === 'words'} onClick={() => setDailyTab('words')} />
        <SubTabButton label="Practice" active={dailyTab === 'practice'} onClick={() => setDailyTab('practice')} />
        <SubTabButton label="Wordle" active={dailyTab === 'wordle'} onClick={() => setDailyTab('wordle')} />
      </div>

      <div className="mt-4 flex-1">
        {dailyTab === 'words' && (
          <div className="space-y-2.5 animate-in fade-in slide-in-from-right-4">
            {wotdData.map((wordObj, idx) => {
              const isSaved = savedWords.some(w => w.word.toLowerCase() === wordObj.word.toLowerCase());
              const isExpanded = expandedIdx === idx;
              return (
                <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all">
                  <div className="p-3.5 cursor-pointer flex justify-between items-center hover:bg-slate-50 transition-colors" onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                    <div className="flex-1 overflow-hidden pr-2">
                      <div className="font-bold text-base text-slate-800 capitalize flex items-baseline gap-2 mb-0.5 truncate">
                        {wordObj.word}
                        <span className="text-xs text-slate-400 font-mono font-normal tracking-tight">{wordObj.phonetic}</span>
                      </div>
                      <div className="text-slate-600 text-sm truncate">
                        <span className="text-indigo-500 italic font-medium mr-1.5">{getShortPOS(wordObj.partOfSpeech)}</span>
                        {wordObj.thaiTranslation}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); playAudio(wordObj.word); }} className="p-1.5 text-indigo-500 hover:bg-indigo-100 rounded-lg transition-colors">
                        <Volume2 className="w-4 h-4" />
                      </button>
                      <ChevronDown className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? 'rotate-180 text-indigo-400' : ''}`} />
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="p-3 bg-slate-50 border-t border-slate-100 animate-in slide-in-from-top-1 fade-in">
                      <WordCard result={wordObj} hideHeader={true} />
                      <div className="px-1 pb-1 mt-3">
                        <button onClick={() => onSave(wordObj)} disabled={isSaved} className={`w-full py-2.5 text-sm font-bold rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5 ${isSaved ? 'bg-green-50 text-green-600 border border-green-200 cursor-default' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
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
        {dailyTab === 'wordle' && <DailyWordle words={wotdData} />}
      </div>
    </div>
  );
}

function DailyPracticeFlow({ words }) {
  const [stage, setStage] = useState(0);
  const handleNext = () => setStage(s => s + 1);

  const stages = [
    { label: 'Step 1: Review Flashcards', icon: <Layers className="w-4 h-4" />, component: <FlashcardGame words={words} onNext={handleNext} /> },
    { label: 'Step 2: Match the Words', icon: <RefreshCw className="w-4 h-4" />, component: <MatchingGame words={words} onNext={handleNext} /> },
    { label: 'Step 3: Multiple Choice', icon: <CheckCircle className="w-4 h-4" />, component: <MultipleChoiceGame words={words} onNext={handleNext} /> },
    { label: 'Step 4: Typing Master', icon: <Edit3 className="w-4 h-4" />, component: <TypingGame words={words} onNext={handleNext} /> },
  ];

  if (stage < stages.length) {
    const { label, icon, component } = stages[stage];
    return (
      <div className="animate-in slide-in-from-right-4 fade-in">
        <div className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl text-center text-sm font-bold mb-4 border border-indigo-100 shadow-sm flex items-center justify-center gap-2">
          {icon} {label}
        </div>
        {component}
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

function SubTabButton({ label, active, onClick, badge }) {
  const isAI = label.includes('✨') || label.includes('🧠');
  return (
    <button
      onClick={onClick}
      className={`relative whitespace-nowrap px-4 py-1.5 text-sm rounded-full font-bold transition-all shadow-sm ${
        active && !isAI ? 'bg-indigo-600 text-white border border-indigo-600' :
        active && isAI ? 'bg-gradient-to-r from-violet-500 to-indigo-600 text-white border border-transparent' :
        isAI ? 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100' :
        'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
      {badge != null && (
        <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function WordCard({ result, hideHeader = false }) {
  const [mnemonic, setMnemonic] = useState(null);
  const [loadingMnemonic, setLoadingMnemonic] = useState(false);

  const handleGenerateMnemonic = async () => {
    setLoadingMnemonic(true);
    const systemPrompt = `You are a creative language tutor. Create a very short, clever, and highly memorable mnemonic device or trick (in Thai or mixed English/Thai) to help remember the English word and its meaning.
    Return ONLY a valid JSON object: { "mnemonic": "string" }. Make it fun and easy to remember.`;
    try {
      const data = await callGeminiJSON(systemPrompt, `Word: "${result.word}", Meaning: "${result.thaiTranslation}"`);
      if (data?.mnemonic) setMnemonic(data.mnemonic);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMnemonic(false);
    }
  };

  return (
    <div className={`bg-white shadow-sm border border-slate-200 animate-in fade-in slide-in-from-bottom-2 ${hideHeader ? 'p-3 rounded-xl border-none shadow-none' : 'rounded-2xl p-5'}`}>
      {!hideHeader && (
        <div className="flex justify-between items-start mb-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 capitalize">{result.word}</h2>
            <div className="flex items-center gap-2 mt-1.5 text-slate-600">
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs tracking-tight">{result.phonetic}</span>
              <span className="italic text-indigo-600 text-sm font-medium">{getShortPOS(result.partOfSpeech)}</span>
            </div>
          </div>
          <button onClick={() => playAudio(result.word)} className="p-2.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors">
            <Volume2 className="w-5 h-5" />
          </button>
        </div>
      )}
      {!hideHeader && (
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-slate-800 border-l-4 border-indigo-500 pl-2.5 leading-snug">{result.thaiTranslation}</h3>
        </div>
      )}
      <div className="space-y-3">
        <h4 className="font-semibold text-slate-600 text-sm flex items-center gap-1.5"><Type className="w-4 h-4" /> Example Sentences</h4>
        {result.examples?.map((ex, idx) => (
          <div key={idx} className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <p className="text-slate-800 text-sm mb-1.5 leading-relaxed"><HighlightedText text={ex.en} /></p>
            <p className="text-slate-500 text-xs">{ex.th}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-slate-100 pt-4">
        {!mnemonic && !loadingMnemonic && (
          <button onClick={handleGenerateMnemonic} className="text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-indigo-100 transition-colors">
            <Sparkles className="w-3.5 h-3.5" /> ✨ Create AI Memory Hook
          </button>
        )}
        {loadingMnemonic && (
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

// ─── Games ────────────────────────────────────────────────────────────────────

function AIStoryGame({ words }) {
  const [selectedWords, setSelectedWords] = useState([]);
  const [storyData, setStoryData] = useState(null);
  const [loading, setLoading] = useState(false);

  if (words.length < 3) return <NoWordsMessage min={3} />;

  const toggleWord = (w) => {
    if (selectedWords.includes(w.word)) setSelectedWords(selectedWords.filter(word => word !== w.word));
    else if (selectedWords.length < 5) setSelectedWords([...selectedWords, w.word]);
  };

  const handleGenerateStory = async () => {
    if (selectedWords.length < 2) return;
    setLoading(true);
    setStoryData(null);
    const systemPrompt = `You are a creative storyteller. Write a very short, engaging story (3-4 sentences) that uses exactly all requested words. Wrap vocabulary words in <b> tags in English. Provide Thai translation (no <b> tags).
    Return ONLY: { "title": "string", "englishStory": "string", "thaiTranslation": "string" }`;
    try {
      const data = await callGeminiJSON(systemPrompt, `Create a story using: ${selectedWords.join(', ')}`);
      if (data?.englishStory) setStoryData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-slate-200 max-w-2xl mx-auto w-full">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-violet-100 to-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
          <Sparkles className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">✨ AI Story Time</h2>
        <p className="text-sm text-slate-500 mt-1">เลือก 2–5 คำเพื่อสร้างเรื่องราวแบบ AI!</p>
      </div>

      {!storyData && !loading && (
        <div className="animate-in fade-in">
          <div className="flex flex-wrap gap-2 mb-6 justify-center max-h-48 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-100">
            {words.map((w) => {
              const isSelected = selectedWords.includes(w.word);
              const isDisabled = !isSelected && selectedWords.length >= 5;
              return (
                <button key={w.id} onClick={() => toggleWord(w)} disabled={isDisabled}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm capitalize border ${isSelected ? 'bg-indigo-600 text-white border-indigo-600 scale-105' : isDisabled ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                  {w.word}
                </button>
              );
            })}
          </div>
          <button onClick={handleGenerateStory} disabled={selectedWords.length < 2}
            className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-bold rounded-xl disabled:opacity-50 shadow-md hover:shadow-lg transition-all flex justify-center items-center gap-2">
            ✨ Generate Magic Story ({selectedWords.length}/5)
          </button>
        </div>
      )}

      {loading && (
        <div className="py-12 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto mb-4" />
          <p className="text-indigo-600 font-bold animate-pulse">✨ AI กำลังเขียนเรื่องของคุณ...</p>
        </div>
      )}

      {storyData && (
        <div className="space-y-4 animate-in zoom-in-95 fade-in">
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 p-5 rounded-2xl border border-indigo-100 shadow-inner">
            <h3 className="text-lg font-bold text-indigo-800 text-center mb-4 pb-3 border-b border-indigo-200/50 flex items-center justify-center gap-2">
              <BookOpen className="w-5 h-5" /> {storyData.title}
            </h3>
            <p className="text-slate-800 text-base leading-relaxed mb-4"><HighlightedText text={storyData.englishStory} /></p>
            <div className="bg-white/60 p-4 rounded-xl border border-indigo-100/50">
              <p className="text-slate-600 text-sm leading-relaxed">{storyData.thaiTranslation}</p>
            </div>
          </div>
          <button onClick={() => { setStoryData(null); setSelectedWords([]); }}
            className="w-full py-3 border-2 border-indigo-200 text-indigo-700 text-sm font-bold rounded-xl hover:bg-indigo-50 transition-colors">
            Create Another Story
          </button>
        </div>
      )}
    </div>
  );
}

function FlashcardGame({ words, onNext }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  if (words.length === 0) return <NoWordsMessage />;

  const currentWord = words[currentIndex];
  const isLastCard = currentIndex === words.length - 1;

  const handleNext = () => {
    if (isLastCard && onNext) { onNext(); return; }
    setIsFlipped(false);
    setCurrentIndex(prev => (prev + 1) % words.length);
  };

  const handlePrev = () => { setIsFlipped(false); setCurrentIndex(prev => (prev - 1 + words.length) % words.length); };

  const onTouchStart = (e) => { setTouchEnd(null); setTouchStart(e.targetTouches[0].clientX); };
  const onTouchMove = (e) => setTouchEnd(e.targetTouches[0].clientX);
  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    if (distance < -50) handleNext();
    else if (distance > 50) handlePrev();
    setTouchStart(null); setTouchEnd(null);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] max-w-sm mx-auto mt-2 w-full">
      <div className="mb-3 text-slate-500 text-sm font-medium">Card {currentIndex + 1} / {words.length}</div>

      <div className="relative w-full aspect-[4/3] perspective-1000 cursor-pointer group select-none"
        onClick={() => setIsFlipped(!isFlipped)} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className={`w-full h-full transition-transform duration-500 transform-style-3d shadow-md rounded-3xl ${isFlipped ? 'rotate-y-180' : ''}`}>
          <div className="absolute inset-0 backface-hidden bg-white border-2 border-indigo-100 rounded-3xl flex flex-col items-center justify-center p-6 text-center group-hover:border-indigo-300 transition-colors">
            <h2 className="text-3xl font-bold text-slate-800 capitalize mb-2">{currentWord.word}</h2>
            <p className="text-base text-slate-400 font-mono">{currentWord.phonetic}</p>
            <p className="text-xs text-slate-300 mt-4 italic flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Tap to reveal meaning</p>
          </div>
          <div className="absolute inset-0 backface-hidden bg-indigo-600 text-white rounded-3xl flex flex-col items-center justify-center p-6 text-center rotate-y-180">
            <h3 className="text-2xl font-bold mb-2">{currentWord.thaiTranslation}</h3>
            <span className="bg-indigo-500 px-2.5 py-0.5 rounded-full text-xs font-medium mb-4">{getShortPOS(currentWord.partOfSpeech)}</span>
            <div className="text-xs bg-indigo-700/50 p-3 rounded-xl w-full">
              <p className="italic mb-1 opacity-90 text-left line-clamp-3">"{currentWord.examples?.[0]?.en.replace(/<\/?b>/g, '')}"</p>
            </div>
            <p className="text-[10px] text-indigo-200 mt-3 italic">Tap to flip back</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5 mt-6 w-full justify-center">
        <button onClick={handlePrev} className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-sm font-medium text-slate-600 shadow-sm">Prev</button>
        <button onClick={() => playAudio(currentWord.word)} className="p-3.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 shadow-sm"><Volume2 className="w-5 h-5" /></button>
        <button onClick={handleNext} className={`px-5 py-2.5 rounded-xl text-sm font-medium shadow-sm ${isLastCard && onNext ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
          {isLastCard && onNext ? 'Finish Step 1' : 'Next'}
        </button>
      </div>
      <p className="mt-5 text-xs text-slate-400">💡 Swipe Right for Next</p>
    </div>
  );
}

function MatchingGame({ words, onNext }) {
  if (words.length < 4) return <NoWordsMessage min={4} />;

  const [gameItems, setGameItems] = useState({ en: [], th: [] });
  const [selectedEn, setSelectedEn] = useState(null);
  const [selectedTh, setSelectedTh] = useState(null);
  const [matched, setMatched] = useState([]);
  const [mistakes, setMistakes] = useState(0);

  const initGame = () => {
    const shuffled = [...words].sort(() => 0.5 - Math.random()).slice(0, Math.min(6, words.length));
    setGameItems({
      en: shuffled.map(w => ({ id: w.id || w.word, text: String(w.word) })).sort(() => 0.5 - Math.random()),
      th: shuffled.map(w => ({ id: w.id || w.word, text: String(w.thaiTranslation) })).sort(() => 0.5 - Math.random()),
    });
    setMatched([]); setMistakes(0); setSelectedEn(null); setSelectedTh(null);
  };

  useEffect(() => { initGame(); }, [words]);

  useEffect(() => {
    if (selectedEn && selectedTh) {
      if (selectedEn.id === selectedTh.id) {
        setMatched(prev => [...prev, selectedEn.id]);
        setSelectedEn(null); setSelectedTh(null);
      } else {
        setMistakes(prev => prev + 1);
        setTimeout(() => { setSelectedEn(null); setSelectedTh(null); }, 800);
      }
    }
  }, [selectedEn, selectedTh]);

  const isComplete = gameItems.en.length > 0 && matched.length === gameItems.en.length;

  return (
    <div className="max-w-2xl mx-auto bg-white p-5 rounded-2xl shadow-sm border border-slate-200 w-full">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-bold text-slate-800">Match the Words</h2>
        <div className="text-xs font-medium text-slate-500">Matched: {matched.length}/{gameItems.en.length} · Mistakes: {mistakes}</div>
      </div>

      {isComplete ? (
        <div className="text-center py-10 animate-in zoom-in-95">
          <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-3"><CheckCircle className="w-8 h-8" /></div>
          <h3 className="text-xl font-bold text-slate-800 mb-1.5">Excellent!</h3>
          <p className="text-sm text-slate-500 mb-5">You matched all words!</p>
          <div className="flex gap-3">
            {!onNext && <button onClick={initGame} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-medium shadow-sm hover:bg-indigo-700 text-sm">Play Again</button>}
            {onNext && <button onClick={onNext} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-sm hover:bg-indigo-700 text-sm">Go to Step 3</button>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {['en', 'th'].map(side => (
            <div key={side} className="space-y-2.5">
              {gameItems[side].map((item) => {
                const isMatched = matched.includes(item.id);
                const isSelected = (side === 'en' ? selectedEn : selectedTh)?.id === item.id;
                const isError = selectedEn && selectedTh && (side === 'en' ? selectedEn : selectedTh)?.id === item.id && selectedEn.id !== selectedTh.id;
                return (
                  <button key={`${side}-${item.id}`} disabled={isMatched}
                    onClick={() => !isMatched && (side === 'en' ? setSelectedEn(item) : setSelectedTh(item))}
                    className={`w-full p-3 rounded-xl text-left text-sm font-bold capitalize transition-all border-2 ${
                      isMatched ? 'bg-slate-50 border-slate-100 text-slate-300 opacity-60' :
                      isError ? 'bg-red-50 border-red-400 text-red-600' :
                      isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-700' :
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

function MultipleChoiceGame({ words, onNext }) {
  if (words.length < 4) return <NoWordsMessage min={4} />;

  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState(null);

  useEffect(() => { generateQuestions(); }, [words]);

  const generateQuestions = () => {
    const selected = [...words].sort(() => 0.5 - Math.random()).slice(0, Math.min(5, words.length));
    const qs = selected.map(targetWord => {
      const exHtml = targetWord.examples?.[0]?.en || `This is a <b>${targetWord.word}</b>.`;
      const plain = exHtml.replace(/<\/?b>/gi, '');
      const blanked = plain.replace(new RegExp(`\\b${targetWord.word}\\b`, 'gi'), '________');
      const options = [targetWord.word, ...words.filter(w => w.word !== targetWord.word).sort(() => 0.5 - Math.random()).slice(0, 3).map(w => w.word)].sort(() => 0.5 - Math.random());
      return { targetWord, sentence: blanked, options };
    });
    setQuestions(qs); setCurrentIndex(0); setScore(0); setShowResult(false); setSelectedAnswer(null);
  };

  const handleAnswer = (option) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(option);
    if (option === questions[currentIndex].targetWord.word) setScore(s => s + 1);
    setTimeout(() => {
      if (currentIndex + 1 < questions.length) { setCurrentIndex(c => c + 1); setSelectedAnswer(null); }
      else setShowResult(true);
    }, 1500);
  };

  if (questions.length === 0) return null;
  if (showResult) return <ResultScreen score={score} total={questions.length} onRetry={generateQuestions} onNext={onNext} nextText="Go to Step 4" />;

  const currentQ = questions[currentIndex];
  const isAnswered = selectedAnswer !== null;

  return (
    <div className="max-w-xl mx-auto bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-slate-200 w-full">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-bold text-slate-800">Multiple Choice</h2>
        <div className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full text-xs font-bold">Q {currentIndex + 1} / {questions.length}</div>
      </div>
      <div className="bg-slate-50 p-5 rounded-xl border border-slate-100 mb-6 text-center">
        <p className="text-base md:text-lg text-slate-800 font-medium leading-relaxed">"{currentQ.sentence}"</p>
        <p className="text-slate-500 mt-3 text-xs">Translation: {currentQ.targetWord.examples?.[0]?.th}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {currentQ.options.map((opt, idx) => {
          let cls = "bg-white border-2 border-slate-200 text-slate-700 hover:border-indigo-400 hover:bg-indigo-50 shadow-sm";
          if (isAnswered) {
            if (opt === currentQ.targetWord.word) cls = "bg-green-100 border-green-500 text-green-700 font-bold";
            else if (opt === selectedAnswer) cls = "bg-red-100 border-red-500 text-red-700";
            else cls = "bg-slate-50 border-slate-100 text-slate-400 opacity-50";
          }
          return <button key={idx} disabled={isAnswered} onClick={() => handleAnswer(opt)} className={`p-3.5 rounded-xl text-base capitalize transition-all ${cls}`}>{opt}</button>;
        })}
      </div>
    </div>
  );
}

function TypingGame({ words, onNext }) {
  if (words.length < 1) return <NoWordsMessage min={1} />;

  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [inputText, setInputText] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => { generateQuestions(); }, [words]);

  const generateQuestions = () => {
    const selected = [...words].sort(() => 0.5 - Math.random()).slice(0, Math.min(5, words.length));
    const qs = selected.map(targetWord => {
      const exHtml = targetWord.examples?.[0]?.en || `This is a <b>${targetWord.word}</b>.`;
      const plain = exHtml.replace(/<\/?b>/gi, '');
      const blanked = plain.replace(new RegExp(`\\b${targetWord.word}\\b`, 'gi'), '________');
      return { targetWord, sentence: blanked };
    });
    setQuestions(qs); setCurrentIndex(0); setScore(0); setShowResult(false); setInputText(''); setFeedback(null); setShowHint(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (feedback !== null || !inputText.trim()) return;
    const isCorrect = inputText.toLowerCase().trim() === questions[currentIndex].targetWord.word.toLowerCase();
    setFeedback(isCorrect ? 'correct' : 'incorrect');
    if (isCorrect) setScore(s => s + 1);
    setTimeout(() => {
      if (currentIndex + 1 < questions.length) { setCurrentIndex(c => c + 1); setInputText(''); setFeedback(null); setShowHint(false); }
      else setShowResult(true);
    }, 2000);
  };

  if (questions.length === 0) return null;
  if (showResult) return <ResultScreen score={score} total={questions.length} onRetry={generateQuestions} onNext={onNext} nextText="Finish Practice" />;

  const currentQ = questions[currentIndex];
  const targetW = currentQ.targetWord.word;

  return (
    <div className="max-w-xl mx-auto bg-white p-5 md:p-8 rounded-2xl shadow-sm border border-slate-200 w-full">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-1.5"><Edit3 className="w-4 h-4 text-indigo-600" /> Fill in the Blank</h2>
        <div className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full text-xs font-bold">Q {currentIndex + 1} / {questions.length}</div>
      </div>
      <div className="bg-slate-50 p-5 rounded-xl border border-slate-100 mb-6 text-center">
        <p className="text-base md:text-lg text-slate-800 font-medium leading-relaxed">"{currentQ.sentence}"</p>
        <div className="mt-4 h-8 flex items-center justify-center">
          {!showHint ? (
            <button type="button" onClick={() => setShowHint(true)} className="flex items-center gap-1 text-xs font-medium text-indigo-500 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg">
              <Lightbulb className="w-3.5 h-3.5" /> Show Hint
            </button>
          ) : (
            <p className="text-slate-500 text-xs bg-white inline-block px-3 py-1.5 rounded-lg border border-slate-200 animate-in fade-in">
              Hint: <span className="font-mono text-indigo-600 font-bold mr-1.5">{targetW.charAt(0)}...{targetW.slice(-1)}</span>
              <span className="font-semibold text-slate-700">({currentQ.targetWord.thaiTranslation})</span>
            </p>
          )}
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={feedback !== null}
          placeholder="Type the missing word..."
          className={`w-full py-3.5 px-5 text-lg text-center outline-none border-2 rounded-xl transition-all font-bold ${
            feedback === 'correct' ? 'border-green-500 bg-green-50 text-green-700' :
            feedback === 'incorrect' ? 'border-red-500 bg-red-50 text-red-700' :
            'border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 bg-white'
          }`} autoFocus />
        {feedback && (
          <div className={`mt-3 p-3 rounded-xl text-center font-bold text-base animate-in fade-in ${feedback === 'correct' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {feedback === 'correct' ? '✅ Correct!' : `❌ Answer is "${currentQ.targetWord.word}"`}
          </div>
        )}
        {!feedback && <button type="submit" disabled={!inputText.trim()} className="w-full mt-3 py-3.5 bg-indigo-600 text-white text-base font-bold rounded-xl hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors shadow-sm">Check Answer</button>}
      </form>
    </div>
  );
}

function DailyWordle({ words }) {
  const [targetWord, setTargetWord] = useState('');
  const [guesses, setGuesses] = useState([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameStatus, setGameStatus] = useState('playing');
  const maxGuesses = 6;

  useEffect(() => {
    if (words?.length > 0) {
      const valid = words.filter(w => /^[a-zA-Z]+$/.test(w.word));
      if (valid.length > 0) {
        const picked = valid.reduce((a, b) => Math.abs((b.word || '').length - 5) < Math.abs((a.word || '').length - 5) ? b : a);
        setTargetWord(picked.word.toLowerCase());
      } else setTargetWord("word");
      setGuesses([]); setCurrentGuess(''); setGameStatus('playing');
    }
  }, [words]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (gameStatus !== 'playing') return;
      if (e.key === 'Enter') handleKey('Enter');
      else if (e.key === 'Backspace') handleKey('Backspace');
      else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentGuess, gameStatus, targetWord]);

  const handleKey = (key) => {
    if (gameStatus !== 'playing') return;
    if (key === 'Enter') {
      if (currentGuess.length === targetWord.length) {
        const newGuesses = [...guesses, currentGuess.toLowerCase()];
        setGuesses(newGuesses);
        if (currentGuess.toLowerCase() === targetWord) setGameStatus('won');
        else if (newGuesses.length >= maxGuesses) setGameStatus('lost');
        setCurrentGuess('');
      }
    } else if (key === 'Backspace') {
      setCurrentGuess(prev => prev.slice(0, -1));
    } else if (currentGuess.length < targetWord.length) {
      setCurrentGuess(prev => prev + key.toLowerCase());
    }
  };

  const getColors = (guessStr) => {
    const colors = Array(targetWord.length).fill('bg-slate-200 text-slate-700 border-slate-300');
    const targetArr = targetWord.split('');
    // First pass: mark correct (green)
    for (let i = 0; i < guessStr.length; i++) {
      if (guessStr[i] === targetArr[i]) {
        colors[i] = 'bg-green-500 text-white border-green-600';
        targetArr[i] = null;
      }
    }
    // Second pass: mark present (yellow)
    for (let i = 0; i < guessStr.length; i++) {
      if (colors[i] === 'bg-green-500 text-white border-green-600') continue;
      const idx = targetArr.indexOf(guessStr[i]);
      if (idx !== -1) {
        colors[i] = 'bg-amber-500 text-white border-amber-600';
        targetArr[idx] = null;
      } else {
        colors[i] = 'bg-slate-500 text-white border-slate-600';
      }
    }
    return colors;
  };

  // Build keyboard color map
  const keyColors = useMemo(() => {
    const map = {};
    guesses.forEach(g => {
      const colors = getColors(g);
      g.split('').forEach((ch, i) => {
        const c = colors[i];
        const priority = { 'bg-green-500 text-white border-green-600': 3, 'bg-amber-500 text-white border-amber-600': 2, 'bg-slate-500 text-white border-slate-600': 1 };
        if (!map[ch] || (priority[c] || 0) > (priority[map[ch]] || 0)) map[ch] = c;
      });
    });
    return map;
  }, [guesses]);

  if (!targetWord) return null;

  return (
    <div className="max-w-md mx-auto bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 animate-in fade-in w-full">
      <div className="text-center mb-6">
        <h3 className="font-bold text-xl text-slate-800">Wordle</h3>
        <p className="text-xs text-slate-500">Guess the {targetWord.length}-letter word from today's list.</p>
      </div>

      <div className="flex flex-col gap-1.5 mb-8 w-full max-w-[16rem] mx-auto items-center">
        {Array.from({ length: maxGuesses }).map((_, rowIndex) => {
          const isCurrentRow = rowIndex === guesses.length;
          const guess = guesses[rowIndex] || (isCurrentRow ? currentGuess : '');
          const colors = guesses[rowIndex] ? getColors(guess) : [];
          return (
            <div key={rowIndex} className="flex gap-1.5 justify-center w-full">
              {Array.from({ length: targetWord.length }).map((_, colIndex) => {
                const char = guess[colIndex] || '';
                const colorClass = colors[colIndex] || 'bg-slate-50 border-slate-200 text-slate-800';
                return (
                  <div key={colIndex} className={`flex-1 aspect-square flex items-center justify-center font-bold text-lg sm:text-xl uppercase border-2 rounded-lg transition-all ${char && !colors.length ? 'border-indigo-400' : ''} ${colorClass}`}>
                    {char}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {gameStatus !== 'playing' && (
        <div className={`text-center p-4 rounded-xl mb-6 font-bold animate-in zoom-in-95 ${gameStatus === 'won' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {gameStatus === 'won' ? '🎉 Brilliant!' : `❌ Game Over! Word was ${targetWord.toUpperCase()}`}
        </div>
      )}

      <div className="space-y-1.5 w-full px-1">
        {['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row, i) => (
          <div key={i} className="flex justify-center gap-1">
            {i === 2 && <button onClick={() => handleKey('Enter')} className="px-2 sm:px-3 py-3.5 bg-slate-200 text-slate-700 text-[10px] sm:text-xs font-bold rounded shadow-sm hover:bg-slate-300">ENTER</button>}
            {row.split('').map(key => (
              <button key={key} onClick={() => handleKey(key)}
                className={`flex-1 py-3.5 sm:py-4 text-xs sm:text-sm font-bold uppercase rounded shadow-sm transition-colors ${keyColors[key] || 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}>
                {key}
              </button>
            ))}
            {i === 2 && <button onClick={() => handleKey('Backspace')} className="px-2 sm:px-3 py-3.5 bg-slate-200 text-slate-700 text-[10px] font-bold rounded shadow-sm hover:bg-slate-300"><Delete className="w-4 h-4 mx-auto" /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function NoWordsMessage({ min = 1 }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="bg-indigo-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
        <BookOpen className="w-10 h-10 text-indigo-300" />
      </div>
      <h3 className="text-xl font-bold text-slate-700 mb-1.5">Not Ready</h3>
      <p className="text-slate-500 text-sm max-w-xs mx-auto">
        Save at least {min} word(s) in the "Find" tab to unlock this game.
      </p>
    </div>
  );
}

function ResultScreen({ score, total, onRetry, onNext, nextText = "Next Game" }) {
  const percentage = (score / total) * 100;
  return (
    <div className="max-w-sm mx-auto text-center py-10 px-5 bg-white rounded-2xl shadow-sm border border-slate-200 animate-in zoom-in-95 w-full">
      <div className="relative w-28 h-28 mx-auto mb-5">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="56" cy="56" r="48" className="text-slate-100 stroke-current" strokeWidth="10" fill="transparent" />
          <circle cx="56" cy="56" r="48" className={`${percentage >= 50 ? 'text-green-500' : 'text-amber-500'} stroke-current transition-all duration-1000 ease-out`}
            strokeWidth="10" strokeLinecap="round" fill="transparent" strokeDasharray={301.59}
            strokeDashoffset={301.59 - (301.59 * percentage) / 100} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <span className="text-2xl font-bold text-slate-800">{score}</span>
          <span className="text-xs text-slate-500">/ {total}</span>
        </div>
      </div>
      <h3 className="text-xl font-bold text-slate-800 mb-1.5">{percentage === 100 ? 'Perfect!' : percentage >= 50 ? 'Well Done!' : 'Keep Trying!'}</h3>
      <p className="text-sm text-slate-500 mb-6">You got {score} out of {total} correct.</p>
      <div className="flex gap-3">
        {!onNext && <button onClick={onRetry} className="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-sm">Play Again</button>}
        {onNext && (
          <>
            <button onClick={onRetry} className="flex-1 py-3 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 shadow-sm">Retry</button>
            <button onClick={onNext} className="flex-1 py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-sm">{nextText}</button>
          </>
        )}
      </div>
    </div>
  );
}

// Global CSS
const style = document.createElement('style');
style.textContent = `
  .perspective-1000 { perspective: 1000px; }
  .transform-style-3d { transform-style: preserve-3d; }
  .backface-hidden { backface-visibility: hidden; }
  .rotate-y-180 { transform: rotateY(180deg); }
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;
document.head.appendChild(style);
