#!/usr/bin/env node
import path from 'path';
import { createLogger } from './lib/logger.mjs';
import { createVectorStore } from './lib/vector-store.mjs';
import { findConfigRoot, loadConfig } from './lib/config.mjs';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node cli.mjs <path> <command> [args]');
  console.error('Example: node cli.mjs /path/to/www status');
  process.exit(1);
}

const targetPath = path.resolve(process.env['vmap.root'] || args[0]);
const command = args[1];

const configRoot = findConfigRoot(targetPath);
if (!configRoot) {
  console.error(`No .vmap.yaml found walking up from ${targetPath}`);
  process.exit(1);
}

const { config } = loadConfig(configRoot);
config._configRoot = configRoot;

const logger = createLogger(config);
await logger.init();

const store = await createVectorStore(config, logger);

if (command === 'status') {
  console.log('\n=== Collection Status ===\n');
  console.log(`Config root: ${configRoot}\n`);
  
  for (const [key, col] of Object.entries(config.collections || {})) {
    const info = await store.getCollectionInfo(key);
    
    console.log(`${key.toUpperCase()}:`);
    console.log(`  Description: ${col.description || '(none)'}`);
    console.log(`  Extensions: ${(col.extensions || []).join(', ')}`);
    if (info) {
      console.log(`  Points: ${info.points_count}`);
    } else {
      console.log(`  Status: Not created`);
    }
    console.log('');
  }
  
} else if (command === 'reset') {
  const target = args[2];
  
  if (!target) {
    console.error('Usage: node cli.mjs <path> reset <collection-key|all>');
    process.exit(1);
  }
  
  const collections = target === 'all' 
    ? Object.keys(config.collections || {})
    : [target];
  
  for (const key of collections) {
    console.log(`Deleting collection ${key}...`);
    try {
      await store.deleteCollection(key);
      console.log(`✓ Deleted ${key}`);
    } catch (error) {
      console.log(`✗ Failed to delete ${key}: ${error.message}`);
    }
  }
  
} else if (command === 'health') {
  try {
    const collectionKeys = [];
    for (const key of Object.keys(config.collections || {})) {
      const info = await store.getCollectionInfo(key);
      if (info) collectionKeys.push(key);
    }
    const provider = config.vectorStore?.provider || 'lancedb';
    console.log(`✓ Vector store (${provider}) is healthy`);
    console.log(`Config root: ${configRoot}`);
    console.log(`Collections: ${collectionKeys.length > 0 ? collectionKeys.join(', ') : '(none)'}`);
  } catch (error) {
    console.error('✗ Vector store is not accessible:', error.message);
    process.exit(1);
  }
  
} else {
  console.log(`
vmap CLI

Commands:
  node cli.mjs <path> status              Show collection status
  node cli.mjs <path> reset <key|all>     Delete collection
  node cli.mjs <path> health              Check vector store connectivity

Examples:
  node cli.mjs /path/to/www status
  node cli.mjs /path/to/www reset code
  node cli.mjs /path/to/md health
  `);
}
