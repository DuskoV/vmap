import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const CONFIG_NAMES = ['.vmap.yaml', '.vmap.yml'];
const dirCache = new Map();    // dir → configRoot path (or null)
const configCache = new Map(); // configRoot → { config, configRoot }

/**
 * Walk up from filePath to find nearest .vmap.yaml/.yml.
 * Caches every directory walked for O(1) subsequent lookups.
 * Returns the directory containing the config, or null.
 */
export function findConfigRoot(filePath) {
  const walked = [];
  const resolved = path.resolve(filePath);
  let dir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);

  while (dir !== path.dirname(dir)) {
    if (dirCache.has(dir)) {
      const result = dirCache.get(dir);
      for (const d of walked) dirCache.set(d, result);
      return result;
    }

    walked.push(dir);

    if (CONFIG_NAMES.some(name => fs.existsSync(path.join(dir, name)))) {
      for (const d of walked) dirCache.set(d, dir);
      return dir;
    }

    dir = path.dirname(dir);
  }

  for (const d of walked) dirCache.set(d, null);
  return null;
}

/**
 * Load and parse the .vmap.yaml from a config root directory.
 * Cached — repeated calls for the same configRoot return the same object.
 * Returns { config, configRoot }.
 */
export function loadConfig(configRoot) {
  if (configCache.has(configRoot)) return configCache.get(configRoot);

  for (const name of CONFIG_NAMES) {
    const p = path.join(configRoot, name);
    if (fs.existsSync(p)) {
      const config = yaml.load(fs.readFileSync(p, 'utf8'));
      config._configRoot = configRoot;
      const entry = { config, configRoot };
      configCache.set(configRoot, entry);
      return entry;
    }
  }
  throw new Error(`No .vmap.yaml found in ${configRoot}`);
}

/**
 * Find config root from a file path, then load it.
 * Returns { config, configRoot } or throws.
 */
export function resolveConfig(filePath) {
  const configRoot = findConfigRoot(filePath);
  if (!configRoot) {
    throw new Error(`No .vmap.yaml found walking up from ${filePath}`);
  }
  return loadConfig(configRoot);
}

/**
 * Find which collection in a config handles a given file extension.
 * Returns { collectionKey, collectionConfig } or null.
 */
export function findCollectionForFile(config, filePath) {
  const ext = path.extname(filePath);
  if (!config.collections) return null;

  for (const [key, col] of Object.entries(config.collections)) {
    if (col.extensions && col.extensions.includes(ext)) {
      return { collectionKey: key, collectionConfig: mergeCollectionConfig(config, col) };
    }
  }
  return null;
}

/**
 * Get a specific collection by key from config.
 * Merges top-level embedder/vectorStore/logging into collection.
 */
export function getCollection(config, collectionKey) {
  const col = config.collections?.[collectionKey];
  if (!col) return null;
  return mergeCollectionConfig(config, col);
}

/**
 * Merge top-level config (embedder, vectorStore, logging) into a collection config.
 * Collection-level values REPLACE top-level entirely (no deep merge).
 */
function mergeCollectionConfig(config, col) {
  return {
    ...col,
    embedder: col.embedder || config.embedder,
    vectorStore: col.vectorStore || config.vectorStore,
    logging: col.logging || config.logging,
  };
}

/**
 * Clear all caches (for testing or after config file changes).
 */
export function clearCache() {
  dirCache.clear();
  configCache.clear();
}

/**
 * Load a specific YAML config file by path (for benchmarks).
 * Not cached — benchmark configs may be edited between runs.
 * Returns { config, configRoot, configFile }.
 */
export function loadConfigFile(filePath) {
  const resolved = path.resolve(filePath);
  const config = yaml.load(fs.readFileSync(resolved, 'utf8'));
  const configRoot = path.dirname(resolved);
  config._configRoot = configRoot;
  return { config, configRoot, configFile: resolved };
}
