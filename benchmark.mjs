#!/usr/bin/env node
/**
 * vmap Benchmark Runner
 * 
 * Reads benchmark spec from .vmap YAML config and runs accuracy/speed tests.
 * When no collection key is given, benchmarks ALL collections.
 * 
 * Usage:
 *   node benchmark.mjs <path-or-yaml> [collection-key]
 * 
 * Examples:
 *   node benchmark.mjs benchmarks              # all collections
 *   node benchmark.mjs benchmarks code          # just code
 *   node benchmark.mjs benchmarks/.vmap_bge.yaml
 */
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import yaml from 'js-yaml';
import { createEmbedder } from './lib/embedder.mjs';
import { loadConfigFile, findConfigRoot, loadConfig, getCollection } from './lib/config.mjs';
import { createLogger } from './lib/logger.mjs';
import { createVectorStore } from './lib/vector-store.mjs';
import os from 'os';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node benchmark.mjs <path-or-yaml> [collection-key]');
  console.error('  Omit collection-key to benchmark all collections.');
  process.exit(1);
}

// --- Load config ---
const targetPath = path.resolve(args[0]);
let config, configRoot, configFile;

if (targetPath.endsWith('.yaml') || targetPath.endsWith('.yml')) {
  const result = loadConfigFile(targetPath);
  config = result.config; configRoot = result.configRoot; configFile = result.configFile;
} else {
  const root = findConfigRoot(targetPath);
  if (!root) { console.error(`No .vmap.yaml found walking up from ${targetPath}`); process.exit(1); }
  const result = loadConfig(root);
  config = result.config; configRoot = result.configRoot;
}

config.logging = config.logging || {};
config.logging.console = false;
config.logging.file = false;
config._configRoot = configRoot;
const logger = createLogger(config);
const store = await createVectorStore(config, logger);

// --- Load baseline from config ---
const benchRoot = config.benchmark || {};
let baseline = null;
if (benchRoot.baseline) {
  try {
    baseline = yaml.load(await fs.readFile(path.resolve(configRoot, benchRoot.baseline), 'utf8'));
  } catch (e) {
    console.error(`Baseline not found: ${benchRoot.baseline}`);
  }
}

// --- Determine collections to benchmark ---
const collectionKeys = args[1]
  ? [args[1]]
  : Object.keys(config.collections || {});

console.log('\n=== vmap Benchmark ===\n');
console.log(`Config: ${configFile || configRoot}`);
console.log(`Collections: ${collectionKeys.join(', ')}\n`);

const allCollectionResults = {};
const BENCH_PREFIX = 'bench__';

for (const colKey of collectionKeys) {
  const collectionConfig = getCollection(config, colKey);
  if (!collectionConfig) {
    console.error(`Collection "${colKey}" not found, skipping.`);
    continue;
  }

  const bench = benchRoot[colKey] || benchRoot;
  const sampleSize = bench.sampleSize || 10;
  const prefixes = bench.prefixes || ['default', 'code', 'docs'];
  const customQueries = bench.queries || null;
  const model = collectionConfig.embedder[collectionConfig.embedder.provider]?.model || '?';
  const storeProvider = config.vectorStore?.provider || 'lancedb';
  const chunkerStrategy = collectionConfig.chunking?.strategy || '?';

  console.log(`${'═'.repeat(60)}`);
  console.log(`  Collection: ${colKey}`);
  console.log(`  Extensions: ${collectionConfig.extensions.join(', ')}`);
  console.log(`  Embedder:   ${model}`);
  console.log(`  Prefixes:   ${prefixes.join(', ')}`);
  console.log(`${'═'.repeat(60)}\n`);

  // --- Discover files ---
  const allFiles = [];
  for (const ext of collectionConfig.extensions) {
    const matches = await glob(`**/*${ext}`, { ignore: collectionConfig.exclude || [], cwd: configRoot, absolute: true });
    allFiles.push(...matches);
  }
  const contentFiles = allFiles.filter(f => !f.toLowerCase().includes('readme.md'));
  if (contentFiles.length === 0) { console.log('  No files found, skipping.\n'); continue; }

  // --- Select samples ---
  const fileStats = await Promise.all(contentFiles.map(async f => ({ path: f, size: (await fs.stat(f)).size })));
  fileStats.sort((a, b) => a.size - b.size);
  const step = Math.max(1, Math.floor(fileStats.length / sampleSize));
  const samples = [];
  for (let i = 0; i < sampleSize && i * step < fileStats.length; i++) samples.push(fileStats[i * step]);

  // --- Queries ---
  let queries;
  if (customQueries?.length > 0) {
    queries = customQueries.map(q => ({ query: q, expectedFile: null }));
  } else {
    queries = await generateQueries(samples);
  }
  console.log(`  ${contentFiles.length} files, ${samples.length} samples, ${queries.length} queries\n`);

  // --- Baseline lookup for this collection ---
  const baselineMap = {};
  if (baseline?.collections?.[colKey]?.results) {
    for (const br of baseline.collections[colKey].results) baselineMap[br.prefix] = br;
  } else if (baseline?.results) {
    // Legacy: flat results (single-collection baseline)
    for (const br of baseline.results) baselineMap[br.prefix] = br;
  }
  const hasBaseline = Object.keys(baselineMap).length > 0;

  // --- Run per prefix ---
  const results = [];
  for (const prefix of prefixes) {
    const testConfig = { ...collectionConfig, embedder: { ...collectionConfig.embedder, prefix } };
    const embedder = createEmbedder(testConfig, logger);
    const benchCol = `${BENCH_PREFIX}${colKey}_${prefix}`;

    console.log(`  --- ${prefix} ---`);

    const sampleTexts = await Promise.all(samples.map(s => fs.readFile(s.path, 'utf8')));

    const embedStart = Date.now();
    const sampleEmbeddings = await Promise.all(sampleTexts.map(text => embedder.embed([text.slice(0, 3000)], 'index')));
    const embedMs = Date.now() - embedStart;

    const vectorSize = sampleEmbeddings[0][0].length;
    await store.dropCollection(benchCol);
    await store.ensureCollection(benchCol, vectorSize);
    const points = sampleEmbeddings.map((emb, i) => ({
      id: `bench_${i}`, vector: emb[0],
      payload: { file: samples[i].path, chunkIndex: 0, text: sampleTexts[i].slice(0, 500) }
    }));
    const writeStart = Date.now();
    await store.upsertPoints(benchCol, points);
    const writeMs = Date.now() - writeStart;

    let top1 = 0, top3 = 0;
    const queryStart = Date.now();
    for (const { query, expectedFile } of queries) {
      const qEmb = await embedder.embed([query], 'query');
      const sr = await store.search(benchCol, qEmb[0], Math.min(samples.length, 10));
      if (expectedFile) {
        const rank = sr.findIndex(r => r.payload.file === expectedFile) + 1;
        if (rank === 1) top1++;
        if (rank <= 3) top3++;
      } else {
        const kw = query.toLowerCase().split(' ').filter(k => k.length > 3);
        if (sr[0] && kw.some(k => sr[0].payload.text?.toLowerCase().includes(k))) top1++;
        if (sr.slice(0, 3).some(r => kw.some(k => r.payload.text?.toLowerCase().includes(k)))) top3++;
      }
    }
    const queryMs = Date.now() - queryStart;

    await store.dropCollection(benchCol);

    const result = {
      prefix,
      top1: top1 / queries.length,
      top3: top3 / queries.length,
      embedMs, embedAvgMs: Math.round(embedMs / samples.length),
      writeMs,
      queryMs, queryAvgMs: Math.round(queryMs / queries.length),
      totalMs: embedMs + writeMs + queryMs,
    };
    results.push(result);
    console.log(`      Accuracy: ${(result.top1 * 100).toFixed(1)}% / ${(result.top3 * 100).toFixed(1)}%  |  Embed: ${embedMs}ms  Write: ${writeMs}ms  Query: ${queryMs}ms  Total: ${result.totalMs}ms`);
  }

  // --- Collection summary ---
  results.sort((a, b) => b.top1 - a.top1);
  console.log(`\n  --- ${colKey} Summary ---\n`);

  if (hasBaseline) {
    const bModel = baseline.config?.model || baseline.collections?.[colKey]?.model || '?';
    const bStore = baseline.config?.store || storeProvider;
    const bChunker = baseline.config?.chunker || '?';
    console.log(`  Base:         ${bChunker} + ${bModel} + ${bStore}`);
    console.log(`  Benchmarked:  ${chunkerStrategy} + ${model} + ${storeProvider}`);
    console.log('');
  }

  for (const r of results) {
    const icon = r.top1 >= 0.85 ? '✅' : r.top1 >= 0.7 ? '⚠️ ' : '❌';
    const br = baselineMap[r.prefix];
    console.log(`  ${icon} Prefix: ${r.prefix}`);
    if (br) {
      console.log(`    Accuracy (1st result):   ${(r.top1 * 100).toFixed(1)}%   (base: ${(br.top1 * 100).toFixed(1)}%,  ${pctDelta(r.top1, br.top1)})`);
      console.log(`    Accuracy (top 3):        ${(r.top3 * 100).toFixed(1)}%   (base: ${(br.top3 * 100).toFixed(1)}%,  ${pctDelta(r.top3, br.top3)})`);
      console.log(`    Embed speed:             ${r.embedMs}ms   (base: ${br.embedMs}ms,  ${speedDelta(r.embedMs, br.embedMs)})`);
      console.log(`    Write speed:             ${r.writeMs}ms   (base: ${br.writeMs}ms,  ${speedDelta(r.writeMs, br.writeMs)})`);
      console.log(`    Query speed:             ${r.queryMs}ms   (base: ${br.queryMs}ms,  ${speedDelta(r.queryMs, br.queryMs)})`);
      console.log(`    Total:                   ${r.totalMs}ms   (base: ${br.totalMs}ms,  ${speedDelta(r.totalMs, br.totalMs)})`);
    } else {
      if (hasBaseline) console.log(`    ⚠ No matching prefix in baseline`);
      console.log(`    Accuracy (1st result):   ${(r.top1 * 100).toFixed(1)}%`);
      console.log(`    Accuracy (top 3):        ${(r.top3 * 100).toFixed(1)}%`);
      console.log(`    Embed: ${r.embedMs}ms (${r.embedAvgMs}ms/doc)  Write: ${r.writeMs}ms  Query: ${r.queryMs}ms (${r.queryAvgMs}ms/q)  Total: ${r.totalMs}ms`);
    }
    console.log('');
  }

  const best = results.filter(r => r.top1 >= 0.7).sort((a, b) => a.totalMs - b.totalMs)[0] || results[0];
  console.log(`  🏆 Best for ${colKey}: "${best.prefix}" (${chunkerStrategy} + ${model} + ${storeProvider}) — ${(best.top1 * 100).toFixed(1)}% accuracy, ${best.totalMs}ms\n`);

  allCollectionResults[colKey] = { model, chunker: chunkerStrategy, store: storeProvider, results, best: best.prefix };
}

// --- Save results ---
const machine = {
  platform: os.platform(), arch: os.arch(),
  cpu: os.cpus()[0]?.model || 'unknown', cores: os.cpus().length,
  ram: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
};

const output = {
  timestamp: new Date().toISOString(),
  machine,
  config: {
    model: config.embedder?.[config.embedder?.provider]?.model,
    provider: config.embedder?.provider,
    chunker: null,
    store: config.vectorStore?.provider || 'lancedb',
  },
  collections: allCollectionResults,
};

const outPath = configFile
  ? configFile.replace(/\.ya?ml$/, '.results.yaml')
  : path.join(configRoot, '.vmap.results.yaml');

await fs.writeFile(outPath, yaml.dump(output, { lineWidth: 120 }));
console.log(`📄 Results: ${outPath}\n`);

// --- Helpers ---

function pctDelta(current, base) {
  if (base === 0) return current === 0 ? 'same' : '+∞';
  const diff = ((current - base) / base * 100);
  const abs = Math.abs(diff).toFixed(0);
  return abs == 0 ? 'same' : diff > 0 ? `+${abs}%` : `-${abs}%`;
}

function speedDelta(current, base) {
  if (base === 0) return 'n/a';
  const diff = ((current - base) / base * 100);
  const abs = Math.abs(diff).toFixed(0);
  return abs == 0 ? 'same' : diff > 0 ? `${abs}% slower` : `${abs}% faster`;
}

async function generateQueries(samples) {
  const all = [];
  for (const sample of samples) {
    const content = await fs.readFile(sample.path, 'utf8');
    const headers = [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim());
    const bold = [...content.matchAll(/^\*\*(.+?)\*\*$/gm)].map(m => m[1].trim());
    const candidates = [...headers, ...bold];
    if (candidates.length > 0) {
      all.push({ query: candidates[0], expectedFile: sample.path });
      if (candidates.length > 1) all.push({ query: candidates[1], expectedFile: sample.path });
    } else {
      const sentences = content.split(/[.!?]\s+/).filter(s => s.length > 20 && s.length < 100);
      if (sentences.length > 0) all.push({ query: sentences[0].trim(), expectedFile: sample.path });
    }
  }
  return all;
}
