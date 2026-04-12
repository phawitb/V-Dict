/**
 * One-time script: import CEFR vocabulary into MongoDB vocab_levels collection
 * Run: node server/importCEFR.js
 */
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// ── CEFR Word Lists ───────────────────────────────────────────────────────────
const CEFR = {
  A1: [
    'apple','bag','ball','bed','big','bird','book','boy','brother','bus',
    'cake','car','cat','chair','child','city','class','cold','come','cup',
    'day','desk','dog','door','drink','eat','egg','eight','eye','face',
    'family','father','fish','five','floor','flower','food','foot','four','friend',
    'game','girl','give','go','good','green','hand','happy','hat','have',
    'hello','help','home','house','hungry','ice','jacket','job','key','kitchen',
    'lamp','learn','left','leg','like','listen','look','love','lunch','make',
    'man','map','milk','money','moon','morning','mother','mouth','name','new',
    'night','nine','nose','number','old','one','open','orange','park','pen',
    'pencil','phone','play','rain','read','red','rice','right','room','run',
    'sad','school','see','seven','shirt','shoes','sister','sit','six','sky',
    'sleep','slow','small','smile','snow','son','sorry','sun','swim','table',
    'tall','ten','three','time','tired','today','tree','two','walk','want',
    'water','white','window','woman','work','write','year','yellow','yes','zero',
  ],
  A2: [
    'able','above','address','after','age','agree','airport','already','another','arrive',
    'ask','bad','begin','believe','below','borrow','both','bring','build','busy',
    'buy','call','careful','change','cheap','check','choose','cinema','clean','close',
    'clothes','cook','copy','cost','count','course','cut','decide','different','difficult',
    'dream','drive','each','earn','easy','enjoy','enter','even','every','example',
    'exciting','explain','fair','fall','far','feel','fill','find','fine','finish',
    'first','forget','full','garden','get','great','group','grow','hair','half',
    'health','hear','high','hold','hope','hotel','hour','interesting','invite','join',
    'keep','kind','last','late','laugh','leave','less','letter','little','live',
    'lose','low','match','mean','minute','miss','more','most','move','music',
    'next','nothing','often','once','only','order','park','part','past','pay',
    'place','plan','please','popular','possible','practice','problem','put','quite','rain',
    'ready','real','reason','remember','return','road','safe','same','save','send',
    'share','shop','short','show','simple','sing','spend','still','stop','story',
    'study','sure','sweet','teach','tell','think','together','tomorrow','too','try',
    'turn','understand','use','visit','wait','warm','watch','way','week','while',
    'wind','winter','without','word','world','worse','write','wrong','yesterday','young',
  ],
  B1: [
    'ability','achieve','activity','adult','advantage','advice','affect','afford','agree','allow',
    'amazing','appear','area','argue','arrange','article','attend','available','aware','basic',
    'become','benefit','career','cause','certainly','character','choice','comfortable','company','complete',
    'concern','condition','confident','consider','contain','continue','control','culture','deal','definitely',
    'describe','despite','develop','discuss','distance','during','effect','effort','either','entire',
    'environment','equal','event','experience','explain','express','feeling','finally','follow','freedom',
    'generally','generation','goal','government','guess','hardly','heart','include','inform','interest',
    'involve','issue','journey','leader','local','manage','method','modern','necessary','opinion',
    'opportunity','ordinary','original','pattern','physical','polite','previous','process','produce','progress',
    'project','protect','provide','quality','realize','recent','recognize','relationship','replace','require',
    'result','review','risk','role','situation','skill','social','solve','source','special',
    'standard','style','suggest','support','technology','therefore','traditional','typical','unlike','unusual',
    'value','variety','various','volunteer','vote','weather','welcome','whole','wonder','worth',
  ],
  B2: [
    'abstract','accessible','accurate','acknowledge','acquire','adapt','adequate','alternative','analyze','appropriate',
    'aspect','assess','assume','audience','authority','capable','challenge','commercial','commitment','complex',
    'compose','concept','conclude','conduct','consequence','considerable','consist','constant','context','contrast',
    'controversy','corporation','critical','crucial','debate','demonstrate','deny','design','determine','dominant',
    'emphasize','enable','encourage','establish','evaluate','eventually','evidence','evolve','factor','feature',
    'focus','framework','fundamental','generate','global','guarantee','impact','implement','imply','indicate',
    'individual','inevitable','influence','instance','integrate','intellectual','interaction','investigate','justify','logical',
    'maintain','major','mechanism','medium','minimize','motive','numerous','objective','obtain','outcome',
    'participate','perform','perspective','phenomenon','policy','potential','precise','predict','principle','professional',
    'propose','pursue','relevant','rely','research','resolve','reveal','sector','significant','similar',
    'specific','strategy','structure','sufficient','survey','sustain','technical','temporary','theory','transform',
    'trend','ultimate','unique','utilize','valid','vital','widespread','willing','withdraw','yield',
  ],
  C1: [
    'abrupt','acute','adjacent','affluent','aggravate','alleviate','ambiguous','ambivalent','analogous','anomaly',
    'anticipate','arbitrary','articulate','aspire','assertion','attribute','augment','autonomous','candid','catalyst',
    'chronic','circumvent','coherent','collaborate','compensate','compel','complacent','concede','condescend','connotation',
    'contend','contradict','convey','correlate','criterion','culminate','curtail','deduce','deter','deviate',
    'dilemma','diminish','discrepancy','disparity','dissent','distinction','diverge','elaborate','elicit','eloquent',
    'embody','encompass','enhance','enumerate','exemplify','explicit','facilitate','fluctuate','forthright','impede',
    'incentive','incompatible','indefinite','indifferent','inherent','integrity','invoke','manifest','meticulous','mitigate',
    'monotonous','negate','negligible','neutral','notable','oblige','obscure','obsolete','offset','ongoing',
    'ordeal','override','pervasive','plausible','pragmatic','premise','profound','proponent','rational','rectify',
    'relentless','resilient','reluctant','rigorous','scrutinize','speculation','subsequent','subtle','succumb','suppress',
    'susceptible','tentative','tolerate','unanimous','undermine','unify','verbose','wary','whereas','whereby',
  ],
  C2: [
    'abrogate','acrimonious','ameliorate','anachronism','anathema','apposite','arcane','arduous','assuage','auspicious',
    'axiom','belligerent','benevolent','brevity','byzantine','cacophony','capricious','categorical','cogent','compendium',
    'complacency','confound','corroborate','cumbersome','debilitate','delineate','demystify','deprecate','derogatory','disingenuous',
    'disparate','dissipate','dogmatic','duplicity','efficacious','egregious','elucidate','embroil','empirical','endemic',
    'ephemeral','equivocal','erudite','exacerbate','exculpate','expedient','extraneous','fallacious','fastidious','fervent',
    'frivolous','grandiose','hapless','hegemony','holistic','hyperbole','hypothesize','immutable','impartial','impetuous',
    'incessant','incongruous','indiscriminate','ineffable','insidious','intransigent','irrefutable','judicious','laconic','loquacious',
    'malleable','mundane','nefarious','nuanced','obfuscate','omnipotent','paradigm','paradox','parsimonious','pedantic',
    'perturb','precipitate','predicate','prevalent','probity','profligate','proliferate','propitious','prudent','recalcitrant',
    'reconcile','rectitude','reticent','sagacious','sanctimonious','sardonic','scrutiny','solipsistic','spurious','stoic',
    'stringent','succinct','supercilious','tenacious','terse','ubiquitous','vacillate','vehement','venerate','volatile',
  ],
};

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  console.log('✅ Connected to MongoDB');

  const db  = client.db('mydict');
  const col = db.collection('vocab_levels');

  await col.drop().catch(() => {});
  await col.createIndex({ word: 1, level: 1 }, { unique: true });
  await col.createIndex({ level: 1 });
  console.log('🗑️  Cleared vocab_levels, indexes ready');

  let total = 0;
  for (const [level, words] of Object.entries(CEFR)) {
    const docs = words.map(w => ({ word: w.toLowerCase(), level }));
    const result = await col.insertMany(docs, { ordered: false }).catch(e => ({
      insertedCount: docs.length - (e.writeErrors?.length || 0),
    }));
    total += result.insertedCount ?? docs.length;
    console.log(`  ${level}: ${docs.length} words`);
  }

  console.log(`\n✅ Done! Total imported: ${total} words across ${Object.keys(CEFR).length} levels`);
  await client.close();
}

run().catch(e => { console.error('\n❌', e.message); process.exit(1); });
