#!/usr/bin/env node
/**
 * vmap Updater
 * 
 * Updates specific file paths. Existing files are re-indexed; missing files
 * remove stale indexed chunks and hash metadata for that path.
 * 
 * Usage:
 *   node updater.mjs <file1> <file2> [...]
 * 
 * Example:
 *   node updater.mjs /path/to/old-file.md /path/to/new-file.md
 */
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './lib/logger.mjs';
import { createEmbedder } from './lib/embedder.mjs';
import { createChunker } from './lib/chunker.mjs';
import { createVectorStore } from './lib/vector-store.mjs';
import { setupCollection, indexFile } from './lib/indexing.mjs';
import { findConfigRoot, loadConfig, getCollection } from './lib/config.mjs';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node updater.mjs <file1> [file2] [...]');
  console.error('Example: node updater.mjs /path/to/old-file.md /path/to/new-file.md');
  console.error('Missing file paths delete stale indexed records for that path.');
  process.exit(1);
}

const files = args.map(f => path.resolve(f));

// Group files by config root
const grouped = new Map();
for (const file of files) {
  const configRoot = findConfigRoot(file);
  if (!configRoot) {
    console.error(`No .vmap.yaml found for ${file}`);
    continue;
  }
  if (!grouped.has(configRoot)) grouped.set(configRoot, []);
  grouped.get(configRoot).push(file);
}

let totalIndexed = 0;
let totalDeleted = 0;
let totalFailed = 0;

for (const [configRoot, groupFiles] of grouped) {
  const { config } = loadConfig(configRoot);
  config._configRoot = configRoot;

  const logger = createLogger(config);
  await logger.init();

  const store = await createVectorStore(config, logger);

  for (const file of groupFiles) {
    const ext = path.extname(file);
    let collectionKey = null;
    let collectionConfig = null;

    if (config.collections) {
      for (const [key, col] of Object.entries(config.collections)) {
        if (col.extensions?.includes(ext)) {
          collectionKey = key;
          collectionConfig = getCollection(config, key);
          break;
        }
      }
    }

    if (!collectionKey) {
      console.error(`No collection for extension ${ext} (file: ${file})`);
      totalFailed++;
      continue;
    }

    try {
      if (!(await fileExists(file))) {
        const info = await store.getCollectionInfo(collectionKey);
        if (info) {
          await store.deleteFilePoints(collectionKey, file);
        }

        totalDeleted++;
        logger.info(`Removed indexed records for missing file ${file}`);
        continue;
      }

      const embedder = createEmbedder(collectionConfig, logger);
      const chunker = createChunker(collectionConfig, logger);
      await setupCollection(store, embedder, collectionKey);

      const rateLimitConfig = collectionConfig.embedder[collectionConfig.embedder.provider]?.rateLimit;

      const result = await indexFile(file, collectionKey, {
        embedder, chunker, store, logger, rateLimitConfig
      });

      if (result.skipped) {
        console.log(`Skipped ${file} (chunking failed)`);
        continue;
      }

      await store.upsertFileHashes(collectionKey, [{ file, hash: result.hash, chunks: result.chunks }]);
      totalIndexed++;
      logger.info(`Indexed ${file} (${result.chunks} chunks)`);
    } catch (error) {
      totalFailed++;
      console.error(`Failed to index ${file}:`, error.message);
    }
  }
}

console.log(`Complete: ${totalIndexed} indexed, ${totalDeleted} deleted, ${totalFailed} failed`);

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}
