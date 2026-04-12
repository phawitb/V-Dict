/**
 * Import lesson vocabulary from list_vocabs.py → MongoDB vocab_levels collection
 * Run: node server/importLessons.js
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// ── Data from list_vocabs.py ──────────────────────────────────────────────────

const word_100 = [
  "Initiative","Effectiveness","Delegation","Expert","Tactic","Proposal","Selection","Praise","Observation",
  "Workload","Goods","Replacement","Matter","Confirmation","Figures","Requirement","Deadline","Opportunity","Objective",
  "Overview","Attention","Assumption","Point","Survey","Feature","Analysis","Notice","Assign to","Maximize",
  "Occupy","Compare","Launch","Implement","Perceive","Receive","Deserve","Admire","Pressure","Expect",
  "Hinder","Deliver","Update","Abandon","Disapprove","Send","Assent","Estimate","Assume","Demand",
  "Specific","Attend","Present","Elaborate","Require","Inform","Reasonable","Effective","Face-to-face","Troublesome",
  "Collaborative","Groundbreaking","Uninspired","Productive","Faulty","Final","Urgent","Up-to-date","In particular","Extra",
  "Formal","Informal","Hectic","Genuine","Annual","Essential","Necessary","Full-time","Part-time","Unique",
  "Accessible","Flexible","Properly","Absolutely","Unfortunately","Approximately","Especially","Incredibly","Quarterly","Monthly",
  "Hourly","Daily","Weekly","Easily","Effectively","Strictly","Professionally","Significantly","Gradually","Sharply",
];

const word_300 = [
  "a","about","act","add","after","again","air","all","also","always",
  "animal","answer","any","ask","at","back","base","be","before","begin",
  "big","book","both","boy","build","but","by","call","can","car",
  "care","carry","cause","change","children","city","close","color","come","country",
  "cut","day","do","door","down","draw","each","earth","eat","end",
  "even","every","example","eye","face","far","father","find","first","fish",
  "follow","food","for","friend","from","get","give","go","good","great",
  "group","grow","hand","hard","have","he","head","hear","help","her",
  "here","high","home","house","how","idea","if","in","is","it",
  "just","keep","kind","know","land","large","last","learn","letter","life",
  "light","like","little","live","long","look","low","make","man","many",
  "may","me","mean","men","might","money","more","most","mother","move",
  "much","must","my","name","near","need","never","new","next","night",
  "no","now","number","of","off","often","old","on","once","one",
  "only","open","or","other","our","out","over","page","paper","part",
  "people","picture","place","plant","play","point","put","read","real","right",
  "river","room","run","said","same","say","school","sea","second","see",
  "sentence","set","she","show","small","some","sound","spell","stand","start",
  "still","study","such","take","tell","than","that","the","them","then",
  "there","these","they","thing","think","this","those","thought","three","through",
  "time","to","too","tree","try","turn","two","under","until","up",
  "us","use","very","walk","want","watch","water","way","we","well",
  "went","were","what","when","where","which","while","who","why","will",
  "with","word","work","world","write","year","you","your",
];

const kru_somsri = [
  "abandon","desert","ability","capability","proficiency","efficiency","abnormal","irregular","abruptly","suddenly",
  "absolutely","completely","absurd","ridiculous","abundant","abounding","accelerate","expedite","accept","admit",
  "access","approach","accommodation","residence","accomplish","succeed","accumulate","collect","accurate","precise",
  "accuse","blame","achieve","acknowledge","acquire","attain","activate","stimulate","active","energetic",
  "dynamic","adapt","adjust","add","increase","supplement","addict","drunkard","adolescent","youngster",
  "adult","grown-up","advantage","benefit","advise","suggest","recommend","affair","business","affection",
  "fondness","affluent","prosperous","aggravate","exasperate","agriculture","farming","aim","goal","purpose",
  "allocate","distribute","alternative","option","choice","ambiguous","vague","ambition","inspiration","analyze",
  "synthesize","ancestor","forefather","ancient","archaic","annoy","harass","apparent","obvious","application",
  "appropriate","suitable","fitting","archaeology","argue","debate","dispute","artificial","copied","duplicated",
  "aspire","wish","assemble","congregate","assess","appraise","assign","appoint","assumption","presumption",
  "assure","ensure","astronaut","spaceman","attach","join","enclose","attention","heed","attendance",
  "presence","automation","available","awkward","inert","inept","beat","defeat","behavior","conduct",
  "bereaved","besides","moreover","furthermore","brittle","fragile","build","construct","establish","capacity",
  "category","classification","cessation","stop","challenge","defy","circumstance","occurrence","collapse","relapse",
  "collide","clash","commodity","merchandise","communicate","convey","companion","friend","compare","correlate",
  "compensate","redeem","competitor","opposer","complete","complex","complicated","component","constituent","concentrate",
  "focus","conclude","infer","condolence","sympathy","conference","convention","conform","agree","confidence",
  "assurance","confidential","secret","confirm","affirm","conscious","aware","considerable","great","consist of",
  "constant","consistent","contain","comprise","consult","confer","consumption","exhaustion","contaminate","adulterate",
  "contradiction","controversy","contradict","contend","convert","alter","convince","persuade","cooperate","collaborate",
  "coordinate","organize","counteract","neutralize","critical","vital","criticism","comment","crucial","essential",
  "damage","destruction","disaster","dangerous","hazardous","deal with","cope with","declare","announce","decline",
  "decrease","dedicate","devote","defend","protect","definite","exact","destroy","decay","demonstrate",
  "deny","department","section","depend on","rely on","depress","deject","deprive","bereave","detest",
  "hate","despise","detrimental","perilous","devastate","demolish","determine","device","tool","gadget",
  "devious","indirect","diagnosis","analysis","die","expire","perish","extinct","diminutive","miniature",
  "disgust","abhorrence","disorder","disorganize","distinguish","discriminate","distract","deviate","dominance","influence",
  "drought","shortage","dwelling","residence","ecology","ecosystem","effective","efficient","effort","attempt",
  "elegant","splendid","eliminate","enormous","colossal","gigantic","enthusiastic","zealous","entire","whole",
  "total","entrepreneur","investor","envious","jealous","erase","delete","erode","decompose","escape",
  "evade","elude","evidence","proof","exaggerate","overstate","examine","scrutinize","excessive","surplus",
  "excuse","explanation","exhaust","fatigue","exhibit","expose","existence","expense","payment","explosion",
  "eruption","extinguish","extreme","supreme","utmost","famine","starvation","fascinate","captivate","enchant",
  "fatal","mortal","fee","fare","flexible","elastic","forbid","prohibit","restrict","force","coerce",
  "oblige","foremost","foundation","basement","fruitful","fertile","function","duty","generation","species",
  "genetic","genuine","authentic","geology","get","gain","global","universal","gloom","mourning",
  "graceful","gradually","grief","affliction","guarantee","warrant","endorse","habitat","harvest","cultivate",
  "hatch","brood","haunting","unforgettable","heed","hibernation","ignorant","negligent","illegible","unreadable",
  "illiterate","uneducated","illustrate","elucidate","illness","ailment","inactive","passive","incessant","unceasing",
  "incidence","accident","incredible","unbelievable","independent","self-sufficient","indicate","specify","infant","newborn",
  "inferior","secondary","inflammation","ingredient","element","inhabit","reside","dwell","innate","inborn",
  "intelligent","intellectual","initiate","originate","inquire","investigate","insist on","persist in","instantly","promptly",
  "instinctive","intuitive","integrate","unite","intensity","concentration","invade","invalidate","invalid","disabled",
  "investment","ironic","sarcastic","jeopardize","endanger","justify","prove","legal","lawful","legitimate",
  "literally","virtually","luxury","extravagance","maintenance","sustenance","manipulate","control","means","method",
  "migrate","immigrate","emigrate","mild","gentle","tender","miraculous","marvelous","miscellaneous","assorted",
  "misery","agony","mobile","movable","moderate","intermediate","modify","mysterious","puzzling","neglect",
  "ignore","negotiate","bargain","nevertheless","however","notable","celebrated","numerous","numberless","nutrition",
  "nourishment","oblivious","unmindful","observe","notice","obstacle","obstruction","occupy","engage","offspring",
  "descendant","operation","treatment","opinion","attitude","oppose","object","outstanding","striking","overcome",
  "particular","specific","pension","perceive","understand","perform","act","permanent","everlasting","persuade",
  "induce","plan","policy","scheme","possess","own","potential","talent","practical","pragmatic",
  "prevalence","pervasive","previous","foregoing","primitive","primary","priority","precedence","proceed","continue",
  "progress","advancement","proliferate","spread","prominent","eminent","property","asset","proportion","ratio",
  "prosperous","provide","supply","purchase","buy","qualification","feature","rare","scarce","rational",
  "logical","recall","remind","recover","recuperate","reform","revolution","regenerate","reproduce","release",
  "liberate","relieve","reluctant","unwilling","remarkable","remedy","therapy","remote","distant","repel",
  "eject","replace","substitute","representative","delegate","require","demand","research","study","reserve",
  "conserve","preserve","resolve","determine","resource","riches","restless","retire","resign","reveal",
  "confess","sentimental","settle down","significance","importance","slothful","sluggish","solution","answer","soothe",
  "alleviate","sophisticated","experienced","stop","quit","cease","pause","strike","protest","stubborn",
  "obstinate","submit","succumb","subscribe","register","substance","matter","suburb","rural","sufficient",
  "enough","adequate","suffocate","stifle","superior","senior","supervise","oversee","suppress","oppress",
  "surplus","superfluous","surroundings","environment","surveillance","patrol","suspect","doubt","suspicious","doubtful",
  "tactful","diplomatic","take over","inherit","take part in","tease","harass","technique","device","temporary",
  "momentary","tempt","allure","terminal","final","terminate","territory","border","terror","horror",
  "threaten","intimidate","tolerate","endure","tough","enduring","tradition","convention","tragedy","suffering",
  "transfer","relocate","transmit","broadcast","trial","experiment","undergo","experience","urge","request",
  "urgent","express","vacant","empty","vague","obscure","valid","reasonable","variable","changeable",
  "various","assorted","victim","prey","vigorous","forceful","violence","severity","virtue","integrity",
  "visible","apparent","vital","crucial","vulnerable","weak","wander","roam","warn","caution",
  "welfare","win","vanquish","withdraw","remove","wither","dry","withhold","withstand","resist",
  "worth","value","wound","injury",
];

// Deduplicate keeping original casing
const unique = (arr) => [...new Map(arr.map(w => [w.toLowerCase(), w])).values()];

const LESSONS = {
  word100:    unique(word_100),
  word300:    unique(word_300),
  kru_somsri: unique(kru_somsri),
};

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  console.log('✅ Connected to MongoDB');

  const db  = client.db('mydict');
  const col = db.collection('vocab_levels');

  await col.drop().catch(() => {});
  await col.createIndex({ word: 1, lesson: 1 }, { unique: true });
  await col.createIndex({ lesson: 1 });
  console.log('🗑️  Cleared vocab_levels');

  let total = 0;
  for (const [lesson, words] of Object.entries(LESSONS)) {
    const docs = words.map((w, i) => ({ word: w, lesson, order: i }));
    const result = await col.insertMany(docs, { ordered: false }).catch(e => ({
      insertedCount: docs.length - (e.writeErrors?.length || 0),
    }));
    total += result.insertedCount ?? docs.length;
    console.log(`  ${lesson}: ${docs.length} words`);
  }

  console.log(`\n✅ Done! Total: ${total} words`);
  await client.close();
}

run().catch(e => { console.error('\n❌', e.message); process.exit(1); });
