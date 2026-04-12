/**
 * One-time script: import eng_vocabs_all.csv → MongoDB vocab_bank collection
 * Run: node server/importVocabs.js
 */
import { MongoClient } from 'mongodb';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const CSV_PATH   = join(__dirname, '..', 'eng_vocabs_all.csv');
const BATCH_SIZE = 2000;

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  console.log('✅ Connected to MongoDB');

  const db  = client.db('mydict');
  const col = db.collection('vocab_bank');

  // Drop existing data & recreate index
  await col.drop().catch(() => {});
  await col.createIndex({ word: 1 }, { unique: true });
  console.log('🗑️  Cleared vocab_bank, index ready');

  const rl = createInterface({ input: createReadStream(CSV_PATH), crlfDelay: Infinity });

  let lineNum  = 0;
  let imported = 0;
  let skipped  = 0;
  let batch    = [];

  const flush = async () => {
    if (!batch.length) return;
    const result = await col.insertMany(batch, { ordered: false }).catch(e => {
      // ignore duplicate key errors
      return { insertedCount: batch.length - (e.writeErrors?.length || 0) };
    });
    imported += result.insertedCount ?? batch.length;
    batch = [];
    process.stdout.write(`\r📥 Imported: ${imported.toLocaleString()} | Skipped: ${skipped}`);
  };

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // header

    // Word is always the first column — grab text before the first comma
    const firstComma = line.indexOf(',');
    if (firstComma === -1) { skipped++; continue; }

    const raw = line.substring(0, firstComma).trim();
    if (!raw || raw.length > 60 || !/^[a-zA-Z]/.test(raw)) { skipped++; continue; }

    // Extract PartofSpeech (second column)
    const rest = line.substring(firstComma + 1);
    const secondComma = rest.indexOf(',');
    const pos = (secondComma !== -1 ? rest.substring(0, secondComma) : rest).trim() || null;

    batch.push({ word: raw.toLowerCase(), pos: pos || null });

    if (batch.length >= BATCH_SIZE) await flush();
  }

  await flush();
  console.log(`\n✅ Done! Total imported: ${imported.toLocaleString()}`);
  await client.close();
}

run().catch(e => { console.error('\n❌', e.message); process.exit(1); });
