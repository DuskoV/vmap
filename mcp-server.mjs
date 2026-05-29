#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './lib/logger.mjs';
import { createEmbedder } from './lib/embedder.mjs';
import { createChunker } from './lib/chunker.mjs';
import { createVectorStore } from './lib/vector-store.mjs';
import { setupCollection, indexFile } from './lib/indexing.mjs';
import { PREFIX_TEMPLATES, suggestTemplate } from './lib/prefix-templates.mjs';
import { findConfigRoot, loadConfig, getCollection } from './lib/config.mjs';

try {
  // Known config roots — populated lazily as files are processed
  // Map<configRoot, Promise<{ config, store, logger }>>
  const roots = new Map();

  async function getRoot(configRoot) {
    if (roots.has(configRoot)) return roots.get(configRoot);

    // Store the promise immediately to prevent duplicate init from concurrent calls
    const promise = (async () => {
      const { config } = loadConfig(configRoot);
      config._configRoot = configRoot;
      config.logging = config.logging || { level: 'info', console: false, file: false };
      config.logging.console = false; // MCP uses stdout for JSON-RPC

      const logger = createLogger(config);
      await logger.init();

      const store = await createVectorStore(config, logger);
      return { config, store, logger };
    })();

    roots.set(configRoot, promise);
    return promise;
  }

  /**
   * Resolve configRoot from a file path or explicit path arg.
   */
  function resolveRoot(filePath) {
    const configRoot = findConfigRoot(filePath);
    if (!configRoot) throw new Error(`No .vmap.yaml found walking up from ${filePath}`);
    return configRoot;
  }

  /**
   * Find all collections across all known roots that match a collection key.
   */
  async function findCollectionsByKey(key) {
    const matches = [];
    for (const [configRoot, promise] of roots) {
      const { config, store, logger } = await promise;
      if (!config.collections?.[key]) continue;
      matches.push({
        configRoot, collectionKey: key,
        collectionConfig: getCollection(config, key),
        store, logger, config
      });
    }
    return matches;
  }

  /**
   * Find all collections across all known roots that match an extension.
   */
  async function findCollectionsForExtension(ext) {
    const matches = [];
    for (const [configRoot, promise] of roots) {
      const { config, store, logger } = await promise;
      if (!config.collections) continue;
      for (const [key, col] of Object.entries(config.collections)) {
        if (col.extensions?.includes(ext)) {
          matches.push({
            configRoot, collectionKey: key,
            collectionConfig: getCollection(config, key),
            store, logger, config
          });
        }
      }
    }
    return matches;
  }

const server = new Server(
  { name: 'vmap', version: '0.0.2' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'vmap_search_collection',
        description: '[vmap] Semantically search indexed content. Returns relevant chunks with file paths and metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            collection: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } }
              ],
              description: 'Collection key, file extension, or array of extensions to search',
            },
            query: {
              type: 'string',
              description: 'Natural language query describing what you are looking for',
            },
            path: {
              type: 'string',
              description: 'Required when searching by collection key (e.g. "docs", "code"). Omit only when searching by file extension.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results (default: 5)',
              default: 5,
            },
          },
          required: ['collection', 'query'],
        },
      },
      {
        name: 'vmap_update_collection',
        description: '[vmap] Update specific file paths. Existing files are re-indexed. Missing/deleted file paths remove all indexed chunks and hash metadata for that old path, so use this for deletes and moves instead of reindexing the whole collection.',
        inputSchema: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of absolute file paths to update. Include old paths that no longer exist to delete stale vector records; for moved files include both the old missing path and the new existing path.',
            },
          },
          required: ['files'],
        },
      },
      {
        name: 'vmap_get_collections',
        description: '[vmap] Returns available collection keys, extensions, and descriptions for a path. Use before search or reindex when you need to target a specific collection.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory or file path to discover collections for',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'vmap_reindex_collection',
        description: '[vmap] Re-index a path. If collection key is omitted, ALL collections are re-indexed. Returns output after completion — for live terminal progress, run the vmap indexer CLI directly.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to re-index (config is auto-discovered)',
            },
            collection: {
              type: 'string',
              description: 'Collection key from get_collections (e.g. "code", "docs"). Omit to re-index ALL collections.',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'vmap_list_prefix_templates',
        description: '[vmap] List available embedding prefix templates with descriptions and use cases',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'vmap_suggest_prefix_template',
        description: '[vmap] Analyze files and suggest the best prefix template for a path',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to analyze (config is auto-discovered)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'vmap_analyze_prefix',
        description: 'Test different prefix templates against sample documents. Returns accuracy metrics.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to analyze (config is auto-discovered)',
            },
            sample_size: {
              type: 'number',
              description: 'Number of documents to test (default: 5)',
              default: 5,
            },
            queries_per_doc: {
              type: 'number',
              description: 'Queries to generate per document (default: 3)',
              default: 3,
            },
          },
          required: ['path'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'vmap_search_collection') {
      return await searchCollection(args.collection, args.query, args.limit || 5, args.path);
    }
    
    if (name === 'vmap_update_collection') {
      return await updateIndex(args.files);
    }
    
    if (name === 'vmap_get_collections') {
      return await getCollections(args.path);
    }
    
    if (name === 'vmap_reindex_collection') {
      return await reindexCollection(args.path, args.collection);
    }
    
    if (name === 'vmap_list_prefix_templates') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ templates: PREFIX_TEMPLATES }, null, 2) }],
      };
    }
    
    if (name === 'vmap_suggest_prefix_template') {
      return await suggestPrefixTemplate(args.path);
    }
    
    if (name === 'vmap_analyze_prefix') {
      return await analyzePrefix(args.path, args.sample_size || 5, args.queries_per_doc || 3);
    }
    
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
      isError: true,
    };
  }
});

// --- Tool implementations ---

async function searchCollection(collectionParam, query, limit, scopePath) {
  const params = Array.isArray(collectionParam) ? collectionParam : [collectionParam];

  // If scopePath given, ensure that root is loaded
  if (scopePath) {
    const configRoot = findConfigRoot(scopePath);
    if (!configRoot) {
      throw new Error(`No .vmap.yaml found for path "${scopePath}".`);
    }
    await getRoot(configRoot);
  }

  // Collect all matching collections across all params
  const allCollections = [];
  for (const p of params) {
    const isExtension = p.startsWith('.');
    const found = isExtension
      ? await findCollectionsForExtension(p)
      : await findCollectionsByKey(p);
    allCollections.push(...found);
  }

  if (allCollections.length === 0) {
    throw new Error(`No indexed collection matches "${collectionParam}". If searching by collection key, include the "path" argument so vmap can locate the config.`);
  }

  // If scopePath, filter to that root
  const targets = scopePath
    ? allCollections.filter(c => scopePath.startsWith(c.configRoot) || c.configRoot.startsWith(path.resolve(scopePath)))
    : allCollections;

  if (targets.length === 0) {
    throw new Error(`No collection for "${ext}" found under path "${scopePath}"`);
  }

  // Search all matching collections, merge results
  const allResults = [];
  for (const { collectionKey, collectionConfig, store, logger } of targets) {
    const embedder = createEmbedder(collectionConfig, logger);
    const queryEmbedding = await embedder.embed([query], 'query');
    const results = await store.search(collectionKey, queryEmbedding[0], limit);
    allResults.push(...results);
  }

  // Sort by score, take top N
  allResults.sort((a, b) => b.score - a.score);
  const topResults = allResults.slice(0, limit);

  const formatted = topResults.map(result => ({
    score: result.score.toFixed(3),
    file: result.payload.file,
    content: result.payload.text,
    metadata: {
      chunkIndex: result.payload.chunkIndex,
      ...Object.fromEntries(
        Object.entries(result.payload).filter(([k]) => !['file', 'text', 'chunkIndex'].includes(k))
      ),
    },
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
  };
}

async function updateIndex(files) {
  const results = { indexed: 0, deleted: 0, failed: 0, files: [] };

  // Group files by config root
  const grouped = new Map();
  for (const file of files) {
    let configRoot;
    try {
      configRoot = resolveRoot(file);
    } catch (e) {
      results.failed++;
      results.files.push({ file, status: 'failed', error: e.message });
      continue;
    }
    if (!grouped.has(configRoot)) grouped.set(configRoot, []);
    grouped.get(configRoot).push(file);
  }

  for (const [configRoot, groupFiles] of grouped) {
    const { config, store, logger } = await getRoot(configRoot);

    // Process files in parallel (DB writes are serialized by _serialWrite)
    const concurrency = 5;
    const fileQueue = [...groupFiles];
    const active = new Set();

    const processFile = async (file) => {
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
        results.failed++;
        results.files.push({ file, status: 'failed', error: `No collection for extension ${ext}` });
        return;
      }

      try {
        if (!(await fileExists(file))) {
          const info = await store.getCollectionInfo(collectionKey);
          if (info) {
            await store.deleteFilePoints(collectionKey, file);
          }

          results.deleted++;
          results.files.push({
            file,
            status: 'deleted',
            collection: collectionKey,
            note: info ? 'missing file; removed indexed records' : 'missing file; collection does not exist',
          });
          logger.info(`Removed indexed records for missing file ${file}`);
          return;
        }

        const embedder = createEmbedder(collectionConfig, logger);
        const chunker = createChunker(collectionConfig, logger);
        await setupCollection(store, embedder, collectionKey);

        const rateLimitConfig = collectionConfig.embedder[collectionConfig.embedder.provider]?.rateLimit;

        const timeoutMs = 60000;
        const indexPromise = indexFile(file, collectionKey, {
          embedder, chunker, store, logger, rateLimitConfig
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        );

        const result = await Promise.race([indexPromise, timeoutPromise]);

        if (result.skipped) {
          results.files.push({ file, status: 'skipped' });
          return;
        }

        await store.upsertFileHashes(collectionKey, [{ file, hash: result.hash, chunks: result.chunks }]);

        results.indexed++;
        results.files.push({ file, chunks: result.chunks, status: 'success' });
        logger.info(`Indexed ${file} (${result.chunks} chunks)`);
      } catch (error) {
        results.failed++;
        results.files.push({ file, status: 'failed', error: error.message });
      }
    };

    let idx = 0;
    while (idx < fileQueue.length || active.size > 0) {
      while (idx < fileQueue.length && active.size < concurrency) {
        const p = processFile(fileQueue[idx++]).finally(() => active.delete(p));
        active.add(p);
      }
      if (active.size > 0) await Promise.race(active);
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
  };
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function getCollections(targetPath) {
  const configRoot = resolveRoot(targetPath);
  const { config, store } = await getRoot(configRoot);

  const collections = [];
  for (const [key, col] of Object.entries(config.collections || {})) {
    const info = await store.getCollectionInfo(key);
    collections.push({
      key,
      extensions: col.extensions || [],
      description: col.description || '',
      pointsCount: info?.points_count || 0,
    });
  }

  return {
    content: [{ type: 'text', text: JSON.stringify({ root: configRoot, collections }, null, 2) }],
  };
}

async function reindexCollection(targetPath, collectionParam) {
  const { spawn } = await import('child_process');
  const configRoot = resolveRoot(targetPath);

  const target = collectionParam || 'all';

  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const indexerPath = path.join(scriptDir, 'indexer.mjs');

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [indexerPath, configRoot, target, '--force']);

    let issues = [];
    let summary = [];
    let stderr = '';

    proc.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const l = line.trim();
        if (!l) continue;
        if (/skip|fail|error|warn|missing|cannot|unable|found \d/i.test(l)) {
          issues.push(l);
        }
        summary.push(l);
        if (summary.length > 3) summary.shift();
      }
    });

    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      // Refresh the cached root after reindex
      roots.delete(configRoot);
      const report = [...new Set([...issues, ...summary])].join('\n');
      if (code !== 0) {
        reject(new Error(`Indexer failed (exit ${code}): ${stderr || report}`));
      } else {
        resolve({
          content: [{ type: 'text', text: report || `Re-indexed ${configRoot} successfully` }],
        });
      }
    });

    proc.on('error', (error) => { reject(error); });
  });
}

async function suggestPrefixTemplate(targetPath) {
  const configRoot = resolveRoot(targetPath);
  const { config } = await getRoot(configRoot);
  const { glob } = await import('glob');

  const files = [];
  if (config.collections) {
    for (const [key, col] of Object.entries(config.collections)) {
      for (const ext of col.extensions || []) {
        const pattern = `**/*${ext}`;
        const matches = await glob(pattern, {
          ignore: col.exclude || [], cwd: configRoot
        });
        files.push(...matches.slice(0, 100));
      }
    }
  }

  const suggestion = suggestTemplate(files);
  const template = PREFIX_TEMPLATES[suggestion.template];

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        suggestion: suggestion.template,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        template: {
          index: template.index,
          query: template.query,
          description: template.description,
          useCase: template.useCase
        },
      }, null, 2),
    }],
  };
}

async function analyzePrefix(targetPath, sampleSize, queriesPerDoc) {
  const { spawn } = await import('child_process');
  const configRoot = resolveRoot(targetPath);

  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const analyzerPath = path.join(scriptDir, 'analyze-prefix.mjs');

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      analyzerPath, configRoot,
      '--sample-size', sampleSize.toString(),
      '--queries-per-doc', queriesPerDoc.toString()
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Analyzer failed: ${stderr}`));
      } else {
        resolve({ content: [{ type: 'text', text: stdout }] });
      }
    });

    proc.on('error', (error) => { reject(error); });
  });
}

// --- Bootstrap: pre-load roots from CLI args ---
const initPaths = (process.env['vmap.root'] || process.argv[2] || '').split(',').filter(Boolean);
for (const p of initPaths) {
  try {
    const configRoot = resolveRoot(path.resolve(p));
    await getRoot(configRoot);
  } catch (e) {
    console.error(`Warning: could not load config from ${p}: ${e.message}`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);

} catch (error) {
  console.error('MCP Server initialization failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
