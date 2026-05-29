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

export class OpenAIEmbedder extends EmbedderBase {
  async _callProvider(texts, config) {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      { model: config.model, input: texts },
      {
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
        timeout: config.timeout,
        httpsAgent
      }
    );
    return response.data.data.map(item => item.embedding);
  }
}
