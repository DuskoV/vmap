import { resolvePrefix } from '../prefix-templates.mjs';

/**
 * Abstract base class for embedding providers.
 *
 * Handles prefix resolution, retry logic, and error classification.
 * Subclasses implement only _callProvider(texts, config).
 *
 * To add a new provider:
 *   1. Create MyProviderEmbedder.mjs extending EmbedderBase
 *   2. Implement _callProvider(texts, config) → Promise<number[][]>
 *   3. Register in index.mjs
 */
export class EmbedderBase {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.provider = config.provider;
    this.prefix = resolvePrefix(config.prefix);
  }

  async embed(texts, mode = 'index') {
    const prefix = mode === 'query' ? this.prefix.query : this.prefix.index;
    const prefixedTexts = prefix ? texts.map(t => prefix + t) : texts;

    const providerConfig = this.config[this.provider];
    const maxRetries = providerConfig.maxRetries || 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this._callProvider(prefixedTexts, providerConfig);
      } catch (error) {
        if (this.isNonRetryableError(error)) {
          this.logger?.error('Non-retryable error', {
            error: error.message,
            status: error.response?.status,
            provider: this.provider
          });
          throw error;
        }

        const isRateLimit = error.response?.status === 429;
        const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
        const backoffMs = isRateLimit ? 5000 * (attempt + 1) : 1000 * (attempt + 1);
        const reason = isRateLimit ? 'Rate limit (429)' : isTimeout ? 'Timeout' : error.message;

        this.logger?.info(`Embed attempt ${attempt + 1}/${maxRetries} failed: ${reason}, retrying in ${backoffMs}ms`);

        if (attempt === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  isNonRetryableError(error) {
    const status = error.response?.status;
    const message = error.message?.toLowerCase() || '';

    if (status === 401) return true;
    if (status === 403) return true;
    if (status === 429) return false;
    if (status === 402) return true;

    if (message.includes('quota exceeded')) return true;
    if (message.includes('insufficient funds')) return true;
    if (message.includes('invalid api key')) return true;
    if (message.includes('unauthorized')) return true;

    return false;
  }

  /** @abstract */
  async _callProvider(texts, config) {
    throw new Error(`${this.constructor.name}._callProvider() not implemented`);
  }
}
