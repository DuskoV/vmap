import crypto from 'crypto';
import path from 'path';

export class LanceDBManager {
  constructor(config, logger) {
    this.configRoot = config.configRoot;
    if (!this.configRoot) throw new Error('configRoot is required for LanceDBManager');
    this.logger = logger;
    this.db = null;
    this.tables = {};
    this._writeQueue = Promise.resolve(); // serializes all table mutations
    
    const defaults = {
      type: 'HNSW_SQ',
      distanceType: 'cosine',
      m: 32,
      efConstruction: 300,
      numPartitions: 1,
      minRows: 256,
      ef: 100,
      refineFactor: null
    };
    
    this.indexConfig = config.index
      ? { ...defaults, ...config.index }
      : defaults;
  }

  /** Convert absolute path to relative (for storage) — always forward slashes */
  toRel(absPath) { return path.relative(this.configRoot, absPath).replace(/\\/g, '/'); }
  /** Convert relative path to absolute (for return) */
  toAbs(relPath) { return path.join(this.configRoot, relPath); }

  /** Serialize a write operation to prevent concurrent LanceDB mutations */
  _serialWrite(fn) {
    this._writeQueue = this._writeQueue.then(fn, fn);
    return this._writeQueue;
  }

  async getDb() {
    if (!this.db) {
      const lancedb = await import('@lancedb/lancedb');
      const resolved = path.join(this.configRoot, '.vmap', 'db');
      this.logger?.debug(`LanceDB connecting to: ${resolved}`);
      this.db = await lancedb.connect(resolved);
    }
    return this.db;
  }

  async getTable(name) {
    if (!this.tables[name]) {
      const db = await this.getDb();
      const existing = await db.tableNames();
      if (existing.includes(name)) {
        this.tables[name] = await db.openTable(name);
      }
    }
    return this.tables[name] || null;
  }

  async ensureCollection(name, vectorSize) {
    const db = await this.getDb();
    const existing = await db.tableNames();
    
    if (existing.includes(name)) {
      this.tables[name] = await db.openTable(name);
      this.logger?.info(`Collection ${name} exists`);
    } else {
      this.logger?.info(`Creating collection ${name}`);
      const dummyVector = new Array(vectorSize).fill(0);
      this.tables[name] = await db.createTable(name, [{
        id: '__init__',
        vector: dummyVector,
        file: '',
        chunkIndex: 0,
        text: '',
        metadata: '{}'
      }]);
      await this.tables[name].delete("id = '__init__'");
    }

    // Ensure _meta table for file hashes
    const metaName = `${name}_meta`;
    if (existing.includes(metaName)) {
      this.tables[metaName] = await db.openTable(metaName);
    } else {
      this.logger?.info(`Creating meta table ${metaName}`);
      this.tables[metaName] = await db.createTable(metaName, [{
        id: '__init__',
        vector: [0],
        file: '',
        contentHash: '',
        chunks: 0
      }]);
      await this.tables[metaName].delete("id = '__init__'");
    }
  }

  async dropCollection(name) {
    const db = await this.getDb();
    const existing = await db.tableNames();
    for (const tableName of existing.filter(t => t === name || t === `${name}_meta`)) {
      await db.dropTable(tableName);
      delete this.tables[tableName];
      this.logger?.info(`Dropped ${tableName}`);
    }
  }

  // --- File hash tracking (_meta table) ---

  async getFileHash(collectionName, filePath) {
    const metaName = `${collectionName}_meta`;
    const table = await this.getTable(metaName);
    if (!table) return null;
    
    const fileId = this.hashFilePath(filePath);
    try {
      const results = await table.query()
        .where(`id = '${fileId}'`)
        .limit(1)
        .toArray();
      return results[0]?.contentHash || null;
    } catch {
      return null;
    }
  }

  async upsertFileHashes(collectionName, fileHashes) {
    return this._serialWrite(async () => {
      const metaName = `${collectionName}_meta`;
      const table = await this.getTable(metaName);
      if (!table) return;
      
      const ids = fileHashes.map(fh => this.hashFilePath(fh.file));
      if (ids.length > 0) {
        const idList = ids.map(id => `'${id}'`).join(', ');
        try {
          await table.delete(`id IN (${idList})`);
        } catch { /* may not exist */ }
      }
      
      const rows = fileHashes.map(({ file, hash, chunks }) => ({
        id: this.hashFilePath(file),
        vector: [0],
        file: this.toRel(file),
        contentHash: hash,
        chunks: chunks || 0
      }));
      
      await table.add(rows);
    });
  }

  async getAllFileHashes(collectionName) {
    const metaName = `${collectionName}_meta`;
    const table = await this.getTable(metaName);
    if (!table) return {};
    
    try {
      const results = await table.query()
        .limit(100000)
        .toArray();
      
      const hashMap = {};
      for (const row of results) {
        if (row.file && row.contentHash) {
          hashMap[this.toAbs(row.file)] = row.contentHash;
        }
      }
      return hashMap;
    } catch {
      return {};
    }
  }

  async getAllIndexedFiles(collectionName) {
    const metaName = `${collectionName}_meta`;
    const table = await this.getTable(metaName);
    if (!table) return [];
    
    try {
      const results = await table.query()
        .limit(100000)
        .toArray();
      
      return results.filter(r => r.file).map(r => this.toAbs(r.file));
    } catch {
      return [];
    }
  }

  async deleteFilePoints(collectionName, filePath) {
    return this._serialWrite(async () => {
      // Delete from meta
      const metaName = `${collectionName}_meta`;
      const metaTable = await this.getTable(metaName);
      if (metaTable) {
        const fileId = this.hashFilePath(filePath);
        try { await metaTable.delete(`id = '${fileId}'`); } catch { /* ok */ }
      }
      
      // Delete chunks from main table
      const table = await this.getTable(collectionName);
      if (table) {
        const escaped = this.toRel(filePath).replace(/'/g, "''");
        try { await table.delete(`file = '${escaped}'`); } catch { /* ok */ }
      }
    });
  }

  // --- Vector index ---

  async buildIndex(collectionName) {
    if (this.indexConfig.type === 'none') return;
    
    const table = await this.getTable(collectionName);
    if (!table) return;
    
    const count = await table.countRows();
    const minRows = this.indexConfig.minRows || 256;
    if (count < minRows) {
      this.logger?.info(`Skipping index for ${collectionName} (${count} rows < ${minRows} minimum)`);
      return;
    }
    
    const lancedb = await import('@lancedb/lancedb');
    const type = this.indexConfig.type;
    const distanceType = this.indexConfig.distanceType;
    
    this.logger?.info(`Building ${type} index on ${collectionName} (${count} rows)...`);
    const start = Date.now();
    
    try {
      if (type === 'HNSW_SQ' || type === 'IVF_HNSW_SQ') {
        await table.createIndex("vector", {
          config: lancedb.Index.hnswSq({
            distanceType,
            efConstruction: this.indexConfig.efConstruction,
            m: this.indexConfig.m
          })
        });
      } else if (type === 'IVF_PQ') {
        await table.createIndex("vector", {
          config: lancedb.Index.ivfPq({
            distanceType,
            numPartitions: this.indexConfig.numPartitions,
            numSubVectors: this.indexConfig.numSubVectors || undefined
          })
        });
      } else if (type === 'HNSW_PQ') {
        await table.createIndex("vector", {
          config: lancedb.Index.hnswPq({
            distanceType,
            efConstruction: this.indexConfig.efConstruction,
            m: this.indexConfig.m
          })
        });
      } else if (type === 'IVF_FLAT') {
        await table.createIndex("vector", {
          config: lancedb.Index.ivfFlat({
            distanceType,
            numPartitions: this.indexConfig.numPartitions
          })
        });
      }
      
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      this.logger?.info(`Index built on ${collectionName} in ${elapsed}s`);
    } catch (e) {
      this.logger?.error(`Index build failed on ${collectionName}: ${e.message}`);
    }
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
        sanitized[key] = JSON.stringify(value);
      }
    }
    return sanitized;
  }

  async upsertPoints(collectionName, points) {
    return this._serialWrite(async () => {
      this.logger?.debug(`Upserting ${points.length} points to ${collectionName}`);
      const table = await this.getTable(collectionName);
      if (!table) return;
      
      const files = [...new Set(points.map(p => p.payload?.file).filter(Boolean))];
      for (const file of files) {
        const escaped = this.toRel(file).replace(/'/g, "''");
        try {
          await table.delete(`file = '${escaped}'`);
        } catch { /* may not exist yet */ }
      }
      
      const rows = points.map(point => {
        const payload = this.sanitizePayload(point.payload);
        const { file, chunkIndex, text, ...extra } = payload;
        return {
          id: point.id,
          vector: point.vector,
          file: file ? this.toRel(file) : '',
          chunkIndex: chunkIndex ?? 0,
          text: text || '',
          metadata: JSON.stringify(extra)
        };
      });
      
      await table.add(rows);
      this.logger?.debug(`Successfully upserted ${points.length} points`);
    });
  }

  async deletePoints(collectionName, pointIds) {
    return this._serialWrite(async () => {
      const table = await this.getTable(collectionName);
      if (!table) return;
      
      const idList = pointIds.map(id => `'${id}'`).join(', ');
      await table.delete(`id IN (${idList})`);
    });
  }

  async search(collectionName, vector, limit = 5, filter = null) {
    const table = await this.getTable(collectionName);
    if (!table) return [];
    
    let query = table.vectorSearch(vector).limit(limit);
    
    if (this.indexConfig?.ef) {
      query = query.ef(this.indexConfig.ef);
    }
    if (this.indexConfig?.refineFactor) {
      query = query.refineFactor(this.indexConfig.refineFactor);
    }
    
    if (filter) {
      const whereClause = this.convertFilter(filter);
      if (whereClause) {
        query = query.where(whereClause);
      }
    }
    
    const results = await query.toArray();
    
    return results.map(row => {
      const { vector: _v, _distance, id, metadata: metaJson, ...coreFields } = row;
      let extra = {};
      try { extra = JSON.parse(metaJson || '{}'); } catch { /* ok */ }
      return {
        id,
        score: _distance != null ? 1 - _distance : 1,
        payload: { ...coreFields, ...extra, file: coreFields.file ? this.toAbs(coreFields.file) : '' }
      };
    });
  }

  convertFilter(filter) {
    if (!filter) return null;
    if (typeof filter === 'string') return filter;
    
    if (filter.must && Array.isArray(filter.must)) {
      const clauses = filter.must.map(condition => {
        if (condition.key && condition.match?.value != null) {
          const val = String(condition.match.value).replace(/'/g, "''");
          return `${condition.key} = '${val}'`;
        }
        return null;
      }).filter(Boolean);
      
      return clauses.length > 0 ? clauses.join(' AND ') : null;
    }
    
    return null;
  }

  async getCollectionInfo(name) {
    const table = await this.getTable(name);
    if (!table) return null;
    
    try {
      const count = await table.countRows();
      return {
        points_count: count,
        config: {
          params: {
            vectors: {
              size: null
            }
          }
        }
      };
    } catch {
      return null;
    }
  }

  async deleteCollection(name) {
    const db = await this.getDb();
    await db.dropTable(name);
    delete this.tables[name];
  }
}

export function createLanceDBManager(config, logger) {
  return new LanceDBManager(config, logger);
}
