#!/usr/bin/env node
/**
 * vmap File Watcher
 * 
 * Watches for file changes and auto-indexes them.
 * 
 * Usage:
 *   node watcher.mjs <path> [path2] [...]
 * 
 * Examples:
 *   node watcher.mjs /path/to/www
 *   node watcher.mjs /path/to/www /path/to/md
 */
import chokidar from 'chokidar';
import path from 'path';
import { spawn } from 'child_process';
import { findConfigRoot, loadConfig, getCollection } from './lib/config.mjs';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node watcher.mjs <path> [path2] [...]');
  console.error('Example: node watcher.mjs /path/to/www');
  process.exit(1);
}

const watchPaths = args.map(p => path.resolve(p));

// Discover configs for each path
const configs = new Map(); // configRoot → config
for (const p of watchPaths) {
  const configRoot = findConfigRoot(p);
  if (!configRoot) {
    console.error(`No .vmap.yaml found for ${p}, skipping`);
    continue;
  }
  if (!configs.has(configRoot)) {
    const { config } = loadConfig(configRoot);
    configs.set(configRoot, config);
  }
}

if (configs.size === 0) {
  console.error('No valid .vmap.yaml configs found');
  process.exit(1);
}

console.log('🧭 vmap File Watcher');
console.log(`Watching ${configs.size} config root(s):`);
for (const [root, config] of configs) {
  const keys = Object.keys(config.collections || {});
  console.log(`  ${root} → collections: ${keys.join(', ')}`);
}
console.log('');

const pendingIndexes = new Map();
const scriptDir = path.dirname(new URL(import.meta.url).pathname);

function scheduleIndex(configRoot) {
  if (pendingIndexes.has(configRoot)) {
    clearTimeout(pendingIndexes.get(configRoot));
  }
  
  const timeout = setTimeout(async () => {
    console.log(`\n📝 Re-indexing ${configRoot}...\n`);
    
    const indexer = spawn('node', [
      path.join(scriptDir, 'indexer.mjs'), configRoot, 'all'
    ], { cwd: scriptDir });
    
    indexer.stdout.on('data', (data) => process.stdout.write(data));
    indexer.stderr.on('data', (data) => process.stderr.write(data));
    
    indexer.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${configRoot} re-indexed\n`);
      } else {
        console.error(`❌ Failed to re-index ${configRoot} (exit code ${code})\n`);
      }
      pendingIndexes.delete(configRoot);
    });
  }, 5000);
  
  pendingIndexes.set(configRoot, timeout);
}

// Initial index
console.log('🔄 Running initial index...\n');
for (const [configRoot] of configs) {
  await new Promise((resolve, reject) => {
    const indexer = spawn('node', [
      path.join(scriptDir, 'indexer.mjs'), configRoot, 'all'
    ], { cwd: scriptDir });
    
    indexer.stdout.on('data', (data) => process.stdout.write(data));
    indexer.stderr.on('data', (data) => process.stderr.write(data));
    
    indexer.on('close', (code) => {
      if (code === 0) { console.log(`\n✅ ${configRoot} indexed\n`); resolve(); }
      else { reject(new Error(`Indexer exited with code ${code}`)); }
    });
  });
}

console.log('\n✅ Initial index complete. Starting watchers...\n');

// Collect all extensions across all configs for each root
for (const [configRoot, config] of configs) {
  const allExtensions = new Set();
  const excludePatterns = [];

  for (const [key, col] of Object.entries(config.collections || {})) {
    for (const ext of col.extensions || []) allExtensions.add(ext);
    for (const ex of col.exclude || []) excludePatterns.push(ex);
  }

  console.log(`👀 Watching ${configRoot}`);
  console.log(`   Extensions: ${[...allExtensions].join(', ')}\n`);

  const watcher = chokidar.watch(configRoot, {
    ignored: excludePatterns.map(pattern =>
      pattern.replace(/\*\*/g, '*').replace(/\//g, path.sep)
    ),
    persistent: true,
    ignoreInitial: true
  });

  const changeHandler = (file) => {
    if ([...allExtensions].some(ext => file.endsWith(ext))) {
      console.log(`✏️  Changed: ${path.relative(configRoot, file)}`);
      scheduleIndex(configRoot);
    }
  };

  watcher
    .on('add', changeHandler)
    .on('change', changeHandler)
    .on('unlink', file => {
      if ([...allExtensions].some(ext => file.endsWith(ext))) {
        console.log(`🗑️  Deleted: ${path.relative(configRoot, file)}`);
        scheduleIndex(configRoot);
      }
    });
}

console.log('✅ Watching for changes...');
console.log('Press Ctrl+C to stop\n');

process.on('SIGINT', () => {
  console.log('\n\n👋 Stopping watcher...');
  process.exit(0);
});
