#!/usr/bin/env node
/**
 * Analyze prefix effectiveness for a directory
 * 
 * Usage:
 *   node analyze-prefix.mjs <path> [options]
 * 
 * Options:
 *   --sample-size N    Number of documents to test (default: 5)
 *   --queries-per-doc N  Queries per document (default: 3)
 * 
 * Examples:
 *   node analyze-prefix.mjs /path/to/md
 *   node analyze-prefix.mjs /path/to/www --sample-size 10
 */
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { createLogger } from './lib/logger.mjs';
import { createEmbedder } from './lib/embedder.mjs';
import { PREFIX_TEMPLATES, TEMPLATE_ALIASES } from './lib/prefix-templates.mjs';
import { findConfigRoot, loadConfig, getCollection } from './lib/config.mjs';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node analyze-prefix.mjs <path> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --sample-size N           Number of documents to test (default: 5)');
  console.error('  --queries-per-doc N       Queries per document (default: 3)');
  console.error('  --test-prefix INDEX:QUERY Test specific prefix combination');
  console.error('');
  console.error('Examples:');
  console.error('  node analyze-prefix.mjs /path/to/md');
  console.error('  node analyze-prefix.mjs /path/to/www --test-prefix code:docs');
  process.exit(1);
}

const targetPath = path.resolve(process.env['vmap.root'] || args[0]);
const sampleSize = parseInt(args.find((a, i) => args[i - 1] === '--sample-size')) || 5;
const queriesPerDoc = parseInt(args.find((a, i) => args[i - 1] === '--queries-per-doc')) || 3;
const testPrefixArg = args.find((a, i) => args[i - 1] === '--test-prefix');

const configRoot = findConfigRoot(targetPath);
if (!configRoot) {
  console.error(`No .vmap.yaml found walking up from ${targetPath}`);
  process.exit(1);
}

const { config } = loadConfig(configRoot);
config._configRoot = configRoot;

// Disable console logging
config.logging = config.logging || {};
config.logging.console = false;
config.logging.file = false;
const logger = createLogger(config);
await logger.init();

console.log('\n=== Prefix Effectiveness Analyzer ===\n');
console.log(`Config root: ${configRoot}`);
console.log(`Sample size: ${sampleSize} documents`);
console.log(`Queries per doc: ${queriesPerDoc}`);
console.log('\nScanning files...\n');

// Get all files across all collections
const allFiles = [];
const firstCollectionKey = Object.keys(config.collections || {})[0];
if (!firstCollectionKey) {
  console.error('No collections found in config');
  process.exit(1);
}

const collectionConfig = getCollection(config, firstCollectionKey);

for (const ext of collectionConfig.extensions) {
  const pattern = `**/*${ext}`;
  const matches = await glob(pattern, {
    ignore: collectionConfig.exclude || [],
    cwd: configRoot
  });
  allFiles.push(...matches.map(f => path.join(configRoot, f)));
}

const contentFiles = allFiles.filter(f => !f.toLowerCase().includes('readme.md'));

if (contentFiles.length === 0) {
  console.error('No content files found (excluding README.md)');
  process.exit(1);
}

console.log(`Found ${contentFiles.length} content files`);

const samples = await selectSamples(contentFiles, sampleSize);
console.log(`\nSelected ${samples.length} samples:\n`);
samples.forEach((s, i) => {
  const relPath = path.relative(configRoot, s.path);
  console.log(`  ${i + 1}. ${relPath} (${s.size} bytes)`);
});

console.log('\nGenerating queries...\n');
const queries = await generateQueries(samples, queriesPerDoc);
console.log(`Generated ${queries.length} queries total\n`);

const templatesToTest = ['default', 'code', 'docs', 'design'];

let customPrefix = null;
if (testPrefixArg) {
  customPrefix = parseCustomPrefix(testPrefixArg);
  console.log(`\nCustom prefix test: index="${customPrefix.index}", query="${customPrefix.query}"\n`);
}

console.log(`Testing ${templatesToTest.length} templates${customPrefix ? ' + 1 custom' : ''} in parallel...\n`);

const results = await Promise.all(
  templatesToTest.map(template => testTemplate(template, samples, queries, collectionConfig, logger))
);

if (customPrefix) {
  const customResult = await testCustomPrefix(customPrefix, samples, queries, collectionConfig, logger);
  results.push(customResult);
}

displayResults(results, samples.length, queries.length);

// --- Helper functions ---

function parseCustomPrefix(arg) {
  const parts = arg.split(':');
  if (parts.length !== 2) {
    console.error('Invalid --test-prefix format. Use: INDEX:QUERY');
    process.exit(1);
  }
  const [indexPart, queryPart] = parts;
  const indexPrefix = PREFIX_TEMPLATES[indexPart] ? PREFIX_TEMPLATES[indexPart].index : indexPart;
  const queryPrefix = PREFIX_TEMPLATES[queryPart] ? PREFIX_TEMPLATES[queryPart].query : queryPart;
  return { name: `${indexPart}:${queryPart}`, index: indexPrefix, query: queryPrefix };
}

async function selectSamples(files, count) {
  const fileStats = await Promise.all(
    files.map(async f => ({ path: f, size: (await fs.stat(f)).size, dir: path.dirname(f) }))
  );
  fileStats.sort((a, b) => a.size - b.size);
  const step = Math.floor(fileStats.length / count);
  const samples = [];
  for (let i = 0; i < count && i * step < fileStats.length; i++) {
    samples.push(fileStats[i * step]);
  }
  return samples.slice(0, count);
}

async function generateQueries(samples, queriesPerDoc) {
  const allQueries = [];
  for (const sample of samples) {
    const content = await fs.readFile(sample.path, 'utf8');
    const queries = extractQueries(content, queriesPerDoc);
    queries.forEach(q => allQueries.push({ query: q, expectedFile: sample.path }));
  }
  return allQueries;
}

function extractQueries(content, count) {
  const queries = [];
  const headerRegex = /^#{1,6}\s+(.+)$/gm;
  const headers = [];
  let match;
  while ((match = headerRegex.exec(content)) !== null) headers.push(match[1].trim());

  const boldRegex = /^\*\*(.+?)\*\*$/gm;
  const boldLines = [];
  while ((match = boldRegex.exec(content)) !== null) boldLines.push(match[1].trim());

  const candidates = [...headers, ...boldLines];
  for (let i = 0; i < Math.min(count, candidates.length); i++) queries.push(candidates[i]);

  if (queries.length < count) {
    const sentences = content.split(/[.!?]\s+/).filter(s => s.length > 20 && s.length < 100);
    for (let i = 0; i < Math.min(count - queries.length, sentences.length); i++) {
      queries.push(sentences[i].trim());
    }
  }
  return queries;
}

async function testTemplate(templateName, samples, queries, collectionConfig, logger) {
  const testCollectionConfig = {
    ...collectionConfig,
    embedder: { ...collectionConfig.embedder, prefix: templateName }
  };
  const embedder = createEmbedder(testCollectionConfig, logger);

  console.log(`\nTesting "${templateName}" template:`);
  console.log(`  Index prefix: "${embedder.prefix.index}"`);
  console.log(`  Query prefix: "${embedder.prefix.query}"`);

  const sampleTexts = await Promise.all(samples.map(s => fs.readFile(s.path, 'utf8')));
  const sampleEmbeddings = await Promise.all(
    sampleTexts.map(text => embedder.embed([text.slice(0, 2000)], 'index'))
  );

  let correctAt1 = 0, correctAt3 = 0, totalRank = 0, totalScore = 0;

  for (const { query, expectedFile } of queries) {
    const queryEmbedding = await embedder.embed([query], 'query');
    const similarities = sampleEmbeddings.map((sampleEmb, idx) => ({
      file: samples[idx].path,
      score: cosineSimilarity(queryEmbedding[0], sampleEmb[0])
    }));
    similarities.sort((a, b) => b.score - a.score);
    const rank = similarities.findIndex(s => s.file === expectedFile) + 1;
    if (rank === 1) correctAt1++;
    if (rank <= 3) correctAt3++;
    if (rank > 0) totalRank += 1 / rank;
    totalScore += similarities[0].score;
  }

  return {
    template: templateName,
    accuracy: correctAt1 / queries.length,
    recall3: correctAt3 / queries.length,
    mrr: totalRank / queries.length,
    avgScore: totalScore / queries.length,
    correctAt1, correctAt3, total: queries.length
  };
}

async function testCustomPrefix(customPrefix, samples, queries, collectionConfig, logger) {
  const testCollectionConfig = {
    ...collectionConfig,
    embedder: { ...collectionConfig.embedder, prefix: { index: customPrefix.index, query: customPrefix.query } }
  };
  const embedder = createEmbedder(testCollectionConfig, logger);

  console.log(`\nTesting custom "${customPrefix.name}":`);
  console.log(`  Index prefix: "${embedder.prefix.index}"`);
  console.log(`  Query prefix: "${embedder.prefix.query}"`);

  const sampleTexts = await Promise.all(samples.map(s => fs.readFile(s.path, 'utf8')));
  const sampleEmbeddings = await Promise.all(
    sampleTexts.map(text => embedder.embed([text.slice(0, 2000)], 'index'))
  );

  let correctAt1 = 0, correctAt3 = 0, totalRank = 0, totalScore = 0;

  for (const { query, expectedFile } of queries) {
    const queryEmbedding = await embedder.embed([query], 'query');
    const similarities = sampleEmbeddings.map((sampleEmb, idx) => ({
      file: samples[idx].path,
      score: cosineSimilarity(queryEmbedding[0], sampleEmb[0])
    }));
    similarities.sort((a, b) => b.score - a.score);
    const rank = similarities.findIndex(s => s.file === expectedFile) + 1;
    if (rank === 1) correctAt1++;
    if (rank <= 3) correctAt3++;
    if (rank > 0) totalRank += 1 / rank;
    totalScore += similarities[0].score;
  }

  return {
    template: customPrefix.name,
    accuracy: correctAt1 / queries.length,
    recall3: correctAt3 / queries.length,
    mrr: totalRank / queries.length,
    avgScore: totalScore / queries.length,
    correctAt1, correctAt3, total: queries.length
  };
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function displayResults(results, sampleCount, queryCount) {
  results.sort((a, b) => b.accuracy - a.accuracy);
  const best = results[0];
  const defaultResult = results.find(r => r.template === 'default');
  const improvement = ((best.accuracy - defaultResult.accuracy) / defaultResult.accuracy * 100).toFixed(1);

  console.log('=== Results ===\n');
  console.log(`Tested: ${sampleCount} documents, ${queryCount} queries\n`);
  console.log('Accuracy (Recall@1):\n');

  results.forEach(r => {
    const pct = (r.accuracy * 100).toFixed(1);
    const icon = r.accuracy >= 0.85 ? '✅' : r.accuracy >= 0.75 ? '⚠️ ' : '❌';
    const label = r.template.includes(':') ? `[${r.template}]` : r.template;
    console.log(`  ${icon} ${label.padEnd(20)} → ${pct}% (${r.correctAt1}/${r.total} queries)`);
  });

  console.log(`\nRecommendation: "${best.template}" template`);
  console.log(`Improvement: ${improvement > 0 ? '+' : ''}${improvement}% vs no prefix`);
  console.log(`Confidence: ${best.accuracy >= 0.85 ? 'High' : best.accuracy >= 0.75 ? 'Medium' : 'Low'}`);
  console.log();
}
