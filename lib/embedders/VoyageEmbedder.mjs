import axios from 'axios';
import { HttpsAgent } from 'agentkeepalive';
import { EmbedderBase } from './EmbedderBase.mjs';

const httpsAgent = new HttpsAgent({
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  freeSocketTimeout: 30000,
  keepAlive: true
});

export class VoyageEmbedder extends EmbedderBase {
  async _callProvider(texts, config) {
    const startTime = Date.now();

    try {
      const response = await axios.post(
        'https://api.voyageai.com/v1/embeddings',
        { model: config.model, input: texts, input_type: 'document' },
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: config.timeout || 30000,
          httpsAgent
        }
      );

      const duration = Date.now() - startTime;
      this.logger?.debug(`Voyage API: ${texts.length} texts, ${texts[0]?.length || 0} chars → ${duration}ms`);

      return response.data.data.map(item => item.embedding);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger?.error(`Voyage API failed after ${duration}ms: ${error.message}`, {
        status: error.response?.status,
        code: error.code,
        textCount: texts.length,
        firstTextLength: texts[0]?.length
      });
      throw error;
    }
  }
}
