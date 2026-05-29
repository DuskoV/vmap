#!/usr/bin/env node
/**
 * vmap vs codecompass benchmark
 * Indexes both from scratch (2 collections each), compares speed and search quality.
 * 
 * codecompass: benchcode + benchdocs (in .codecompass/config.json)
 * vmap:        code + docs           (in www/.vmap.yaml)
 */
import * as lancedb from '@lancedb/lancedb';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import yaml from 'js-yaml';

const PROJECT = '/Users/duskov/Projects/IIT';
const VMAP_DIR = `${PROJECT}/scripts/vmap`;
const CC_DIR = `${PROJECT}/scripts/codecompass`;

const CODE_QUERIES = [
  'taxonomy lookup search',
  'database transaction rollback',
  'user authentication login',
  'job posting controller',
  'email sending queue',
  'resume parsing extraction',
  'skill chain model',
  'backfill cascade creation',
];

const DOCS_QUERIES = [
  'taxonomy chain model',
  'backfill cascade protocol',
  'enrichment pipeline steps',
  'database schema tables',
  'testing protocols',
  'deployment docker setup',
  'queue worker configuration',
  'email forwarding intake',
];

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => out += d.toString());
    proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out.slice(-500)}`)));
  });
}

async function benchSearch(table, embeddings, queries, filter) {
  // Cold run (first query, no warmup)
  const coldStart = performance.now();
  let q0 = table.vectorSearch(embeddings[queries[0]]).limit(5);
  if (filter) q0 = q0.where(filter);
  await q0.toArray();
  const coldMs = performance.now() - coldStart;

  // Warmup (10 rounds)
  for (let i = 0; i < 10; i++) {
    let q = table.vectorSearch(embeddings[queries[0]]).limit(5);
    if (filter) q = q.where(filter);
    await q.toArray();
  }

  // Warm runs — 3 passes per query, take median
  const results = {};
  let total = 0;
  for (const query of queries) {
    const times = [];
    for (let r = 0; r < 3; r++) {
      const start = performance.now();
      let q = table.vectorSearch(embeddings[query]).limit(5);
      if (filter) q = q.where(filter);
      const rows = await q.toArray();
      times.push({ ms: performance.now() - start, rows });
    }
    times.sort((a, b) => a.ms - b.ms);
    const median = times[Math.floor(times.length / 2)];
    total += median.ms;
    results[query] = { ms: median.ms, topFile: median.rows[0]?.file?.split('/').pop() || '?' };
  }
  return { results, total, avg: total / queries.length, coldMs };
}

// --- Embedder ---
const { createEmbedder } = await import('./lib/embedder.mjs');
const embedder = createEmbedder({
  embedder: { provider: 'lmstudio', lmstudio: { url: 'http://localhost:1234', model: 'nomic-embed-text-v2-moe' } }
}, null);

console.log('=== vmap vs codecompass Benchmark ===\n');

// --- Phase 1: Index vmap ---
console.log('Phase 1: Index vmap (www/ code + docs)...');
await fs.rm(`${PROJECT}/www/.vmap/db`, { recursive: true, force: true }).catch(() => {});
await fs.mkdir(`${PROJECT}/www/.vmap/db`, { recursive: true });

const vmStart = Date.now();
await run('node', ['indexer.mjs', `${PROJECT}/www`, 'all'], VMAP_DIR);
const vmIndexMs = Date.now() - vmStart;
console.log(`  Done in ${(vmIndexMs / 1000).toFixed(1)}s\n`);

// --- Phase 2: Index codecompass benchcode + benchdocs ---
console.log('Phase 2: Index codecompass (benchcode + benchdocs)...');
const ccStart = Date.now();
try {
  await run('node', ['indexer.mjs', PROJECT, 'bench-code', '--force'], CC_DIR);
  console.log('  bench-code indexed');
} catch (e) {
  console.log(`  ⚠ bench-code failed: ${e.message.slice(0, 200)}`);
}
try {
  await run('node', ['indexer.mjs', PROJECT, 'bench-docs', '--force'], CC_DIR);
  console.log('  bench-docs indexed');
} catch (e) {
  console.log(`  ⚠ bench-docs failed: ${e.message.slice(0, 200)}`);
}
const ccIndexMs = Date.now() - ccStart;
console.log(`  Done in ${(ccIndexMs / 1000).toFixed(1)}s\n`);

// --- Phase 3: Record counts ---
console.log('Phase 3: Record counts\n');

const vmDb = await lancedb.connect(`${PROJECT}/www/.vmap/db`);
const vmTables = await vmDb.tableNames();

const ccDb = await lancedb.connect(`${PROJECT}/.codecompass/db`);
const ccTables = await ccDb.tableNames();

const counts = {};
for (const [label, db, tables, pairs] of [
  ['vmap', vmDb, vmTables, [['code', 'code'], ['docs', 'docs']]],
  ['codecompass', ccDb, ccTables, [
    ['code', ccTables.includes('bench-code') ? 'bench-code' : 'b2-code'],
    ['docs', ccTables.includes('bench-docs') ? 'bench-docs' : 'b2-docs']
  ]],
]) {
  counts[label] = {};
  for (const [key, tableName] of pairs) {
    if (tables.includes(tableName)) {
      const t = await db.openTable(tableName);
      counts[label][key] = { table: tableName, rows: await t.countRows() };
    } else {
      counts[label][key] = { table: tableName, rows: 0 };
    }
  }
}

console.log('  Collection'.padEnd(15), 'vmap'.padStart(10), 'codecompass'.padStart(15));
console.log('  ' + '-'.repeat(40));
for (const key of ['code', 'docs']) {
  console.log(
    `  ${key}`.padEnd(15),
    `${counts.vmap[key].rows}`.padStart(10),
    `${counts.codecompass[key].rows}`.padStart(15)
  );
}

// --- Phase 4: Search speed ---
console.log('\nPhase 4: Search speed\n');

// Embed all queries
const allQueries = [...new Set([...CODE_QUERIES, ...DOCS_QUERIES])];
const embeddings = {};
for (const q of allQueries) {
  embeddings[q] = (await embedder.embed([q], 'query'))[0];
}

for (const [key, queries] of [['code', CODE_QUERIES], ['docs', DOCS_QUERIES]]) {
  const vmTable = vmTables.includes(key) ? await vmDb.openTable(key) : null;
  const ccTableName = counts.codecompass[key].table;
  const ccTable = ccTables.includes(ccTableName) ? await ccDb.openTable(ccTableName) : null;

  if (!vmTable || !ccTable) {
    console.log(`  Skipping ${key} — missing table`);
    continue;
  }

  const vmBench = await benchSearch(vmTable, embeddings, queries);
  const ccBench = await benchSearch(ccTable, embeddings, queries);

  console.log(`  --- ${key} ---`);
  console.log('  Query'.padEnd(37), 'vmap'.padStart(8), 'CC'.padStart(8), 'Winner'.padStart(8), 'Same #1?');
  console.log('  ' + '-'.repeat(70));

  let sameTop = 0;
  for (const q of queries) {
    const vm = vmBench.results[q];
    const cc = ccBench.results[q];
    const same = vm.topFile === cc.topFile;
    if (same) sameTop++;
    console.log(
      `  ${q}`.padEnd(37),
      (vm.ms.toFixed(1) + 'ms').padStart(8),
      (cc.ms.toFixed(1) + 'ms').padStart(8),
      (vm.ms < cc.ms ? 'vmap' : 'CC').padStart(8),
      same ? '✅' : `⚠️  ${vm.topFile} vs ${cc.topFile}`
    );
  }
  console.log('  ' + '-'.repeat(70));
  console.log(
    '  WARM TOTAL'.padEnd(37),
    (vmBench.total.toFixed(1) + 'ms').padStart(8),
    (ccBench.total.toFixed(1) + 'ms').padStart(8),
    (vmBench.total < ccBench.total ? 'vmap' : 'CC').padStart(8),
    `${sameTop}/${queries.length} match`
  );
  console.log(
    '  COLD (1st query)'.padEnd(37),
    (vmBench.coldMs.toFixed(1) + 'ms').padStart(8),
    (ccBench.coldMs.toFixed(1) + 'ms').padStart(8),
    (vmBench.coldMs < ccBench.coldMs ? 'vmap' : 'CC').padStart(8),
  );
  console.log(`  (median of 3 runs per query, 10-round warmup)`);
  console.log('');
}

// --- Phase 5: Update speed (re-index 5 files) ---
console.log('Phase 5: Update speed (5 files)\n');

const updateFiles = [
  'components/taxonomy/TaxonomyLookup.php',
  'models/User.php',
  'controllers/SiteController.php',
  'components/job/JobFactory.php',
  'components/resume/ResumeParser.php',
];

// vmap update
const vmUpdateStart = Date.now();
for (const f of updateFiles) {
  const absPath = `${PROJECT}/www/${f}`;
  try {
    await run('node', ['updater.mjs', absPath], VMAP_DIR);
  } catch {}
}
const vmUpdateMs = Date.now() - vmUpdateStart;

// CC update — uses old updater with project-root + collection-name + files
const ccUpdateStart = Date.now();
for (const f of updateFiles) {
  const absPath = `${PROJECT}/www/${f}`;
  try {
    await run('node', ['updater.mjs', PROJECT, 'bench-code', absPath], CC_DIR);
  } catch {}
}
const ccUpdateMs = Date.now() - ccUpdateStart;

console.log(`  vmap: ${(vmUpdateMs / 1000).toFixed(1)}s (${Math.round(vmUpdateMs / updateFiles.length)}ms/file)`);
console.log(`  CC:   ${(ccUpdateMs / 1000).toFixed(1)}s (${Math.round(ccUpdateMs / updateFiles.length)}ms/file)`);
console.log(`  Winner: ${vmUpdateMs < ccUpdateMs ? 'vmap' : 'CC'}\n`);

// --- Phase 6: Result quality deep comparison ---
console.log('Phase 6: Result quality (top-3 comparison)\n');

for (const [key, queries] of [['code', CODE_QUERIES]]) {
  const vmTable = await vmDb.openTable(key);
  const ccTableName = counts.codecompass[key].table;
  const ccTable = await ccDb.openTable(ccTableName);

  console.log(`  --- ${key} ---`);
  for (const query of queries) {
    const emb = embeddings[query];
    const vmResults = await vmTable.vectorSearch(emb).limit(3).toArray();
    const ccResults = await ccTable.vectorSearch(emb).limit(3).toArray();

    const vmFiles = vmResults.map(r => r.file?.split('/').pop() || '?');
    const ccFiles = ccResults.map(r => r.file?.split('/').pop() || '?');

    const allMatch = vmFiles.every((f, i) => f === ccFiles[i]);
    const icon = allMatch ? '✅' : vmFiles[0] === ccFiles[0] ? '🔄' : '⚠️';
    // ✅ = all 3 same, 🔄 = #1 same but #2/#3 differ, ⚠️ = #1 different

    console.log(`  ${icon} ${query}`);
    if (!allMatch) {
      console.log(`     vmap: ${vmFiles.join(', ')}`);
      console.log(`     CC:   ${ccFiles.join(', ')}`);
    }
  }
  console.log('');
}

// --- Summary ---
console.log('=== Summary ===\n');
console.log(`  Index time:   vmap ${(vmIndexMs/1000).toFixed(1)}s  vs  CC ${(ccIndexMs/1000).toFixed(1)}s  (${vmIndexMs < ccIndexMs ? 'vmap faster' : 'CC faster'})`);
console.log(`  Update time:  vmap ${(vmUpdateMs/1000).toFixed(1)}s  vs  CC ${(ccUpdateMs/1000).toFixed(1)}s  (${vmUpdateMs < ccUpdateMs ? 'vmap faster' : 'CC faster'})`);
console.log(`  Chunks:       vmap code=${counts.vmap.code.rows} docs=${counts.vmap.docs.rows}  vs  CC code=${counts.codecompass.code.rows} docs=${counts.codecompass.docs.rows}`);
console.log('');
