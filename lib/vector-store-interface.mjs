/**
 * Vector Store Interface
 * 
 * Both LanceDBManager and QdrantManager must implement these methods.
 * 
 * Collection lifecycle:
 *   ensureCollection(name, vectorSize)
 *   dropCollection(name)
 *   getCollectionInfo(name)
 *   deleteCollection(name)
 * 
 * Points (vectors + payload):
 *   upsertPoints(collectionName, points)
 *   deletePoints(collectionName, ids)
 *   deleteFilePoints(collectionName, filePath)
 *   search(collectionName, vector, limit, filter)
 * 
 * File tracking (marker rows, chunkIndex = -1):
 *   getFileHash(collectionName, filePath)
 *   upsertFileHashes(collectionName, fileHashes)
 *   getAllIndexedFiles(collectionName)
 *   getAllFileHashes(collectionName)
 * 
 * Index (optional, LanceDB only):
 *   buildIndex(collectionName)
 */
export const REQUIRED_METHODS = [
  'ensureCollection',
  'dropCollection',
  'getCollectionInfo',
  'upsertPoints',
  'deletePoints',
  'deleteFilePoints',
  'search',
  'getFileHash',
  'upsertFileHashes',
  'getAllIndexedFiles',
  'getAllFileHashes',
  'hashFilePath',
  'sanitizePayload'
];
