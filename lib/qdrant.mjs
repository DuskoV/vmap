import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';
import path from 'path';

export class QdrantManager {
  constructor(config, logger) {
    this.configRoot = config.configRoot;
    if (!this.configRoot) throw new Error('configRoot is required for QdrantManager');
    this.client = new QdrantClient({ url: config.url || 'http://localhost:6333' });
    this.logger = logger;
  }

  /** Convert absolute path to relative (for storage) — always forward slashes */
  toRel(absPath) { return path.relative(this.configRoot, absPath).replace(/\\/g, '/'); }
  /** Convert relative path to absolute (for return) */
  toAbs(relPath) { return path.join(this.configRoot, relPath); }

  async ensureCollection(name, vectorSize) {
    try {
      await this.client.getCollection(name);
      this.logger?.info(`Collection ${name} exists`);
    } catch {
      this.logger?.info(`Creating collection ${name}`);
      await this.client.createCollection(name, {
        vectors: { size: vectorSize, distance: 'Cosine' }
      });
      // Create payload index on chunkIndex for marker row filtering
      await this.client.createPayloadIndex(name, {
        field_name: 'chunkIndex',
        field_schema: 'integer'
      });
      await this.client.createPayloadIndex(name, {
        field_name: 'file',
        field_schema: 'keyword'
      });
    }
  }

  async dropCollection(name) {
    try {
      await this.client.deleteCollection(name);
      this.logger?.info(`Dropped ${name}`);
    } catch { /* ok */ }
  }

  async getCollectionInfo(name) {
    try {
      return await this.client.getCollection(name);
    } catch {
      return null;
    }
  }

  async deleteCollection(name) {
    await this.client.deleteCollection(name);
  }

  // --- File hash via marker rows (chunkIndex = -1) ---

  async getFileHash(collectionName, filePath) {
    const relPath = this.toRel(filePath);
    try {
      const results = await this.client.scroll(collectionName, {
        limit: 1,
        filter: {
          must: [
            { key: 'file', match: { value: relPath } },
            { key: 'chunkIndex', match: { value: -1 } }
          ]
        },
        with_payload: true
      });
      return results.points[0]?.payload?.contentHash || null;
    } catch {
      return null;
    }
  }

  async upsertFileHashes(collectionName, fileHashes) {
    // Delete existing marker rows
    for (const { file } of fileHashes) {
      const relPath = this.toRel(file);
      try {
        await this.client.delete(collectionName, {
          wait: true,
          filter: {
            must: [
              { key: 'file', match: { value: relPath } },
              { key: 'chunkIndex', match: { value: -1 } }
            ]
          }
        });
      } catch { /* may not exist */ }
    }

    // Get vector size from collection info
    const info = await this.getCollectionInfo(collectionName);
    const vectorSize = info?.config?.params?.vectors?.size;
    if (!vectorSize) return;

    const zeroVector = new Array(vectorSize).fill(0);
    const points = fileHashes.map(({ file, hash, chunks }) => ({
      id: this.hashFilePath(file),
      vector: zeroVector,
      payload: {
        file: this.toRel(file),
        chunkIndex: -1,
        text: '',
        contentHash: hash,
        chunks
      }
    }));

    await this.client.upsert(collectionName, { wait: true, points });
  }

  async getAllFileHashes(collectionName) {
    try {
      const result = await this.client.scroll(collectionName, {
        limit: 100000,
        filter: { must: [{ key: 'chunkIndex', match: { value: -1 } }] },
        with_payload: true
      });

      const hashMap = {};
      for (const point of result.points) {
        if (point.payload?.file && point.payload?.contentHash) {
          hashMap[this.toAbs(point.payload.file)] = point.payload.contentHash;
        }
      }
      return hashMap;
    } catch {
      return {};
    }
  }

  async getAllIndexedFiles(collectionName) {
    try {
      const result = await this.client.scroll(collectionName, {
        limit: 100000,
        filter: { must: [{ key: 'chunkIndex', match: { value: -1 } }] },
        with_payload: true
      });

      return result.points
        .filter(p => p.payload?.file)
        .map(p => this.toAbs(p.payload.file));
    } catch {
      return [];
    }
  }

  async deleteFilePoints(collectionName, filePath) {
    const relPath = this.toRel(filePath);
    await this.client.delete(collectionName, {
      wait: true,
      filter: { must: [{ key: 'file', match: { value: relPath } }] }
    });
  }

  // --- Core operations ---

  hashFilePath(filePath) {
    return crypto.createHash('md5').update(filePath).digest('hex');
  }

  sanitizePayload(payload) {
    if (!payload) return {};

    const sanitized = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue;
      if (typeof value === 'string') {
        sanitized[key] = value.replace(/\0/g, '').substring(0, 65535);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[key] = value;
      } else if (Array.isArray(value)) {
        sanitized[key] = value.filter(v => v != null);
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizePayload(value);
      }
    }
    return sanitized;
  }

  async upsertPoints(collectionName, points) {
    this.logger?.debug(`Upserting ${points.length} points to ${collectionName}`);

    // Delete existing chunk rows for these files
    const files = [...new Set(points.map(p => p.payload?.file).filter(Boolean))];
    for (const file of files) {
      const relPath = this.toRel(file);
      try {
        await this.client.delete(collectionName, {
          wait: true,
          filter: {
            must: [
              { key: 'file', match: { value: relPath } },
              { key: 'chunkIndex', range: { gte: 0 } }
            ]
          }
        });
      } catch { /* may not exist */ }
    }

    const sanitizedPoints = points.map(point => {
      const payload = this.sanitizePayload(point.payload);
      return {
        id: point.id,
        vector: point.vector,
        payload: {
          ...payload,
          file: payload.file ? this.toRel(payload.file) : '',
        }
      };
    });

    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.client.upsert(collectionName, { wait: true, points: sanitizedPoints });
        this.logger?.debug(`Successfully upserted ${points.length} points`);
        return;
      } catch (error) {
        if (attempt === maxRetries - 1) throw error;
        const backoffMs = 1000 * (attempt + 1);
        this.logger?.info(`Qdrant upsert failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${backoffMs}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  async deletePoints(collectionName, pointIds) {
    await this.client.delete(collectionName, { wait: true, points: pointIds });
  }

  async search(collectionName, vector, limit = 5, filter = null) {
    const searchFilter = filter || {
      must: [{ key: 'chunkIndex', range: { gte: 0 } }]
    };

    // If custom filter provided, add chunkIndex >= 0 to exclude markers
    if (filter && !JSON.stringify(filter).includes('chunkIndex')) {
      searchFilter.must = [
        ...(filter.must || []),
        { key: 'chunkIndex', range: { gte: 0 } }
      ];
    }

    const results = await this.client.search(collectionName, {
      vector, limit, filter: searchFilter, with_payload: true
    });

    return results.map(r => ({
      id: r.id,
      score: r.score,
      payload: {
        ...r.payload,
        file: r.payload?.file ? this.toAbs(r.payload.file) : ''
      }
    }));
  }
}

export function createQdrantManager(config, logger) {
  return new QdrantManager(config, logger);
}
