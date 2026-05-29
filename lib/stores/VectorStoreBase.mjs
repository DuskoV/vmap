import crypto from 'crypto';
import path from 'path';

/**
 * Abstract base class for vector store backends.
 *
 * Subclasses must implement all methods that throw below.
 * Shared utilities (hashFilePath, toRel, toAbs) are provided here.
 *
 * To add a new backend:
 *   1. Create MyBackendManager.mjs extending VectorStoreBase
 *   2. Implement all abstract methods
 *   3. Register in index.mjs
 */
export class VectorStoreBase {
  constructor(config, logger) {
    this.configRoot = config.configRoot;
    if (!this.configRoot) throw new Error('configRoot is required');
    this.logger = logger;
  }

  // --- Shared utilities ---

  /** MD5 hash of a file path — used as a stable point ID */
  hashFilePath(filePath) {
    return crypto.createHash('md5').update(filePath).digest('hex');
  }

  /** Convert absolute path to relative (for storage) — always forward slashes */
  toRel(absPath) { return path.relative(this.configRoot, absPath).replace(/\\/g, '/'); }

  /** Convert relative path to absolute (for return) */
  toAbs(relPath) { return path.join(this.configRoot, relPath); }

  // --- Abstract: collection lifecycle ---

  /** Create collection if it doesn't exist. */
  async ensureCollection(name, vectorSize) { throw new Error(`${this.constructor.name}.ensureCollection() not implemented`); }

  /** Drop collection and all its data. */
  async dropCollection(name) { throw new Error(`${this.constructor.name}.dropCollection() not implemented`); }

  /** Return collection metadata, or null if not found. */
  async getCollectionInfo(name) { throw new Error(`${this.constructor.name}.getCollectionInfo() not implemented`); }

  /** Hard-delete a collection (alias used by some callers). */
  async deleteCollection(name) { throw new Error(`${this.constructor.name}.deleteCollection() not implemented`); }

  // --- Abstract: points ---

  /** Upsert vectors + payloads. */
  async upsertPoints(collectionName, points) { throw new Error(`${this.constructor.name}.upsertPoints() not implemented`); }

  /** Delete points by ID array. */
  async deletePoints(collectionName, ids) { throw new Error(`${this.constructor.name}.deletePoints() not implemented`); }

  /** Delete all points belonging to a file. */
  async deleteFilePoints(collectionName, filePath) { throw new Error(`${this.constructor.name}.deleteFilePoints() not implemented`); }

  /** Vector similarity search. Returns [{id, score, payload}]. */
  async search(collectionName, vector, limit, filter) { throw new Error(`${this.constructor.name}.search() not implemented`); }

  // --- Abstract: file hash tracking ---

  /** Return stored content hash for a file, or null. */
  async getFileHash(collectionName, filePath) { throw new Error(`${this.constructor.name}.getFileHash() not implemented`); }

  /** Persist content hashes for a batch of files. */
  async upsertFileHashes(collectionName, fileHashes) { throw new Error(`${this.constructor.name}.upsertFileHashes() not implemented`); }

  /** Return all indexed file paths for a collection. */
  async getAllIndexedFiles(collectionName) { throw new Error(`${this.constructor.name}.getAllIndexedFiles() not implemented`); }

  /** Return map of { absolutePath → contentHash } for a collection. */
  async getAllFileHashes(collectionName) { throw new Error(`${this.constructor.name}.getAllFileHashes() not implemented`); }

  // --- Abstract: payload sanitization ---

  /**
   * Strip null bytes, truncate strings, handle nested objects.
   * Each backend may differ (e.g. LanceDB JSON-stringifies nested objects).
   */
  sanitizePayload(payload) { throw new Error(`${this.constructor.name}.sanitizePayload() not implemented`); }
}
