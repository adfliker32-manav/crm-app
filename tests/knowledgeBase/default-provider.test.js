// Chatbot (hydrated doc) and knowledge base (lean, no defaults) must agree on an unset provider, or retrieval searches the wrong model.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');
const mongoose = require('mongoose');

const resolverPath = require.resolve(path.join(__dirname, '..', '..', 'src/utils/aiKeyResolver.js'));
require.cache[resolverPath] = new Module(resolverPath, null);
require.cache[resolverPath].filename = resolverPath;
require.cache[resolverPath].loaded = true;
require.cache[resolverPath].exports = { getGlobalAIKey: async () => 'test-key' };

const IntegrationConfig = require('../../src/models/IntegrationConfig');
const embeddings = require('../../src/services/embeddingService');

const realFindOne = IntegrationConfig.findOne;
const withStoredAi = (ai) => {
    IntegrationConfig.findOne = () => ({ select: () => ({ lean: async () => (ai === undefined ? null : { ai }) }) });
};
const newTenantId = () => new mongoose.Types.ObjectId();

describe('default AI provider', () => {
    after(() => { IntegrationConfig.findOne = realFindOne; });

    test('a new client starts on OpenAI gpt-4o-mini (Adfliker Advance)', () => {
        const config = new IntegrationConfig({ userId: newTenantId() });
        assert.strictEqual(config.ai.provider, 'openai');
        assert.strictEqual(config.ai.model, 'gpt-4o-mini');
    });

    test('an unset provider resolves to the same vendor for the knowledge base as for the chatbot', async () => {
        const chatbotSees = new IntegrationConfig({ userId: newTenantId() }).ai.provider;

        withStoredAi({});
        const ctx = await embeddings.resolveEmbeddingContext(newTenantId());
        assert.strictEqual(ctx.provider, chatbotSees);
        assert.strictEqual(ctx.model, embeddings.EMBEDDING_MODELS[chatbotSees].model);

        withStoredAi(undefined);
        assert.strictEqual((await embeddings.resolveEmbeddingContext(newTenantId())).provider, chatbotSees);
    });

    test('a client explicitly saved on Gemini keeps Gemini embeddings', async () => {
        withStoredAi({ provider: 'gemini', model: 'gemini-2.5-flash' });
        const ctx = await embeddings.resolveEmbeddingContext(newTenantId());
        assert.strictEqual(ctx.provider, 'gemini');
        assert.strictEqual(ctx.model, embeddings.EMBEDDING_MODELS.gemini.model);
    });
});
