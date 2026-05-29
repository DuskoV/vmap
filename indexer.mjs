#!/usr/bin/env node
/**
 * vmap Indexer
 * 
 * Usage:
 *   node indexer.mjs <path> [collection-key|all] [--force]
 * 
 * Examples:
 *   node indexer.mjs /path/to/www all
 *   node indexer.mjs /path/to/www code
 *   node indexer.mjs /path/to/md docs --force
 */
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { createLogger } from './lib/logger.mjs';
import { createEmbedder } from './lib/embedder.mjs';
import { createChunker } from './lib/chunker.mjs';
import { createVectorStore } from './lib/vector-store.mjs';
import { setupCollection, indexFile } from './lib/indexing.mjs';
import { findConfigRoot, loadConfig, getCollection } from './lib/config.mjs';
import { ProcessLock } from './lib/process-lock.mjs';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node indexer.mjs <path> [collection-key|all] [--force]');
  console.error('Example: node indexer.mjs /path/to/www code');
  console.error('  --force: Re-index all files regardless of hash');
  process.exit(1);
}

const targetPath = path.resolve(process.env['vmap.root'] || args[0]);
const targetCollection = args[1] || 'all';
const force = args.includes('--force');

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

async function indexCollection(collectionKey, force = false) {
  const collectionConfig = getCollection(config, collectionKey);
  if (!collectionConfig) {
    console.error(`Collection "${collectionKey}" not found in config`);
    process.exit(1);
  }
  
  logger.info(`Starting indexing for ${collectionKey} (root: ${configRoot})`);
  
  const embedder = createEmbedder(collectionConfig, logger);
  const chunker = createChunker(collectionConfig, logger);
  
  if (force) {
    // Remove lance directories at filesystem level to avoid corruption
    for (const suffix of [`${collectionKey}.lance`, `${collectionKey}_meta.lance`]) {
      const lanceDir = path.join(configRoot, '.vmap', 'db', suffix);
      try { await fs.rm(lanceDir, { recursive: true, force: true }); } catch { /* may not exist */ }
    }
    delete store.tables?.[collectionKey];
    delete store.tables?.[`${collectionKey}_meta`];
  }
  
  await setupCollection(store, embedder, collectionKey);
  
  // Discover files by extension under configRoot
  const files = [];
  for (const ext of collectionConfig.extensions) {
    const pattern = `**/*${ext}`;
    const matches = await glob(pattern, {
      ignore: collectionConfig.exclude || [],
      cwd: configRoot
    });
    files.push(...matches.map(f => path.join(configRoot, f)));
  }
  
  logger.info(`Found ${files.length} files`);
  
  // Sync deletions
  const indexedFiles = await store.getAllIndexedFiles(collectionKey);
  const filesSet = new Set(files);
  const deletedFiles = indexedFiles.filter(f => !filesSet.has(f));
  
  if (deletedFiles.length > 0) {
    logger.info(`Removing ${deletedFiles.length} deleted files from index`);
    for (const file of deletedFiles) {
      await store.deleteFilePoints(collectionKey, file);
      logger.debug(`Removed ${file}`);
    }
  }
  
  const fileHashBatch = [];
  const concurrency = collectionConfig.embedder[collectionConfig.embedder.provider]?.concurrency || 1;
  const rateLimitConfig = collectionConfig.embedder[collectionConfig.embedder.provider]?.rateLimit;
  
  logger.info(`Processing ${files.length} files with concurrency ${concurrency}`);
  
  const storedHashes = force ? {} : await store.getAllFileHashes(collectionKey);
  
  let fileIndex = 0;
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  const activePromises = new Set();
  
  const processFile = async (file) => {
    try {
      const content = await fs.readFile(file, 'utf8');
      const crypto = await import('crypto');
      const currentHash = crypto.createHash('sha256').update(content).digest('hex');
      
      if (!force) {
        const storedHash = storedHashes[file];
        if (storedHash === currentHash) {
          skipped++;
          logger.debug(`Skipped ${file} (unchanged)`);
          return;
        }
      }
      
      const { hash, chunks } = await indexFile(file, collectionKey, {
        embedder, chunker, store, logger, rateLimitConfig
      });
      
      fileHashBatch.push({ file, hash, chunks });
      indexed++;
      logger.info(`Indexed ${file} (${chunks} chunks)`);
      
      if (fileHashBatch.length >= 100) {
        await store.upsertFileHashes(collectionKey, fileHashBatch);
        fileHashBatch.length = 0;
      }
      
    } catch (error) {
      failed++;
      
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        console.error(`\n❌ AUTHENTICATION ERROR: ${error.message}`);
        throw error;
      }
      if (status === 402 || error.message?.toLowerCase().includes('quota exceeded')) {
        console.error(`\n❌ QUOTA/BILLING ERROR: ${error.message}`);
        throw error;
      }
      
      console.error(`\nDETAIL: ${file}\n`, error.message);
      logger.error(`Failed to index ${file}`, { error: error.message });
    }
  };
  
  while (fileIndex < files.length || activePromises.size > 0) {
    while (fileIndex < files.length && activePromises.size < concurrency) {
      const file = files[fileIndex++];
      const promise = processFile(file).finally(() => activePromises.delete(promise));
      activePromises.add(promise);
    }
    if (activePromises.size > 0) {
      await Promise.race(activePromises);
    }
  }
  
  if (fileHashBatch.length > 0) {
    await store.upsertFileHashes(collectionKey, fileHashBatch);
  }
  
  if (typeof store.buildIndex === 'function') {
    await store.buildIndex(collectionKey);
  }
  
  logger.info(`Indexing complete: ${indexed} indexed, ${skipped} skipped, ${failed} failed, ${deletedFiles.length} deleted`);
}

const lock = new ProcessLock(path.join(configRoot, '.vmap', 'db'));
await lock.acquire(120000);
try {
  if (targetCollection === 'all') {
    for (const key of Object.keys(config.collections || {})) {
      await indexCollection(key, force);
    }
  } else {
    if (!config.collections?.[targetCollection]) {
      console.error(`Collection "${targetCollection}" not found in config`);
      console.error(`Available: ${Object.keys(config.collections || {}).join(', ')}, all`);
      process.exit(1);
    }
    await indexCollection(targetCollection, force);
  }
} finally {
  lock.release();
}
