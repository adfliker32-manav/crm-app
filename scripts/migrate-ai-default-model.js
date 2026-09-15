// Moves existing clients onto the default AI model (OpenAI gpt-4o-mini, "Adfliker Advance") and flags their knowledge base for re-index.
// Usage: node scripts/migrate-ai-default-model.js [--dry-run] [--reindex] [--email client@example.com]

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const OpenAI = require('openai');

const IntegrationConfig = require('../src/models/IntegrationConfig');
const GlobalSetting = require('../src/models/GlobalSetting');
const AiModelRate = require('../src/models/AiModelRate');
const KnowledgeDocument = require('../src/models/KnowledgeDocument');
const User = require('../src/models/User');
const { decryptToken } = require('../src/utils/encryptionUtils');
const aiCreditService = require('../src/services/aiCreditService');
const { EMBEDDING_MODELS } = require('../src/services/embeddingService');
const kb = require('../src/services/knowledgeBaseService');

// Pinned rather than read from constants/aiDefaults, so re-running this later can never migrate somewhere else.
const TARGET_PROVIDER = 'openai';
const TARGET_MODEL = 'gpt-4o-mini';
// Clients who deliberately picked an OpenAI tier (Advance or Ultra) keep it.
const KEEP_OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o'];

const NEEDS_MOVE = {
    $or: [
        { 'ai.provider': { $ne: TARGET_PROVIDER } },
        { 'ai.model': { $nin: KEEP_OPENAI_MODELS } }
    ]
};

const isDryRun = process.argv.includes('--dry-run');
const reindex = process.argv.includes('--reindex');
const emailFlagIndex = process.argv.indexOf('--email');
const onlyEmail = emailFlagIndex !== -1 ? process.argv[emailFlagIndex + 1] : null;

async function checkOpenAiKey() {
    // The chatbot reads only this DB setting (no env fallback), so this is the key that has to work.
    const setting = await GlobalSetting.findOne({ key: 'global_openai_api_key' }).lean();
    const apiKey = setting?.value ? decryptToken(setting.value) : null;
    if (!apiKey) return 'no OpenAI API key is saved in Super Admin > Global Settings';
    try {
        await new OpenAI({ apiKey, timeout: 15000, maxRetries: 1 }).models.retrieve(TARGET_MODEL);
        return null;
    } catch (err) {
        return `the saved OpenAI key cannot use ${TARGET_MODEL} (${err.status || 'network error'}: ${err.message})`;
    }
}

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGO_URI is not set in .env - cannot connect.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected' + (isDryRun ? '  (DRY RUN - no writes)' : '') + '\n');

    const scope = {};
    if (onlyEmail) {
        const owner = await User.findOne({ email: String(onlyEmail).toLowerCase().trim() }).select('_id email').lean();
        if (!owner) {
            console.error(`No user found with email ${onlyEmail}`);
            await mongoose.disconnect();
            process.exit(1);
        }
        scope.userId = owner._id;
        console.log(`Limited to ${owner.email}\n`);
    }

    // ── 1. preflight ────────────────────────────────────────────────────────
    const keyProblem = await checkOpenAiKey();
    if (keyProblem) {
        console.error(`OpenAI key check FAILED: ${keyProblem}.`);
        console.error('Moving clients now would silence every moved chatbot. Fix the key in Global Settings, then re-run.');
        if (!isDryRun) {
            await mongoose.disconnect();
            process.exit(1);
        }
        console.log('(Dry run continues so you can see the impact.)');
    } else {
        console.log(`OpenAI key check: OK (${TARGET_MODEL} is reachable)`);
    }

    const rate = await AiModelRate.findOne({ model: TARGET_MODEL }).lean();
    if (rate) {
        console.log(`Credit rate: ${TARGET_MODEL} = ${rate.creditsPer1kTokens} credits / 1k tokens`);
    } else {
        // Without a row every reply bills at the generic fallback instead of this model's own price.
        const seed = aiCreditService.DEFAULT_RATES.find(r => r.model === TARGET_MODEL);
        console.log(
            `Credit rate: ${TARGET_MODEL} has no AiModelRate row (replies would bill at the ` +
            `${aiCreditService.DEFAULT_RATE_PER_1K}/1k fallback) - ${isDryRun ? 'would seed' : 'seeding'} ${seed.creditsPer1kTokens}/1k`
        );
        if (!isDryRun) {
            await AiModelRate.updateOne(
                { model: TARGET_MODEL },
                { $setOnInsert: { ...seed, active: true } },
                { upsert: true }
            );
        }
    }

    // ── 2. who moves ────────────────────────────────────────────────────────
    const [total, toMove] = await Promise.all([
        IntegrationConfig.countDocuments(scope),
        IntegrationConfig.find({ ...scope, ...NEEDS_MOVE }).select('_id userId ai.provider ai.model').lean()
    ]);

    console.log(`\nClients scanned        : ${total}`);
    console.log(`Already on OpenAI tier : ${total - toMove.length}`);
    console.log(`To move to ${TARGET_MODEL} : ${toMove.length}`);

    const byCurrent = {};
    for (const c of toMove) {
        const label = `${c.ai?.provider || '(unset)'} / ${c.ai?.model || '(unset)'}`;
        byCurrent[label] = (byCurrent[label] || 0) + 1;
    }
    for (const [label, n] of Object.entries(byCurrent)) console.log(`   from ${label}: ${n}`);

    const openaiEmbeddingModel = EMBEDDING_MODELS.openai.model;
    const kbAffected = toMove.length
        ? await KnowledgeDocument.countDocuments({
            userId: { $in: toMove.map(c => c.userId) },
            deletedAt: null,
            status: 'ready',
            embeddingModel: { $nin: [openaiEmbeddingModel, null] }
        })
        : 0;
    console.log(`Knowledge base documents that will need a re-index: ${kbAffected}`);

    // ── 3. apply ────────────────────────────────────────────────────────────
    if (!isDryRun) {
        if (toMove.length) {
            // Each client's previous choice, so the move can be reverted client by client.
            const backupPath = path.join(__dirname, 'backups', `ai-model-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
            fs.mkdirSync(path.dirname(backupPath), { recursive: true });
            fs.writeFileSync(backupPath, JSON.stringify(toMove.map(c => ({
                configId: c._id,
                userId: c.userId,
                provider: c.ai?.provider ?? null,
                model: c.ai?.model ?? null
            })), null, 2));
            console.log(`\nPrevious settings backed up to ${backupPath}`);
        }

        let moved = 0;
        for (const c of toMove) {
            // NEEDS_MOVE is re-checked so a client who changes model while this runs keeps their choice.
            const res = await IntegrationConfig.updateOne(
                { _id: c._id, ...NEEDS_MOVE },
                { $set: { 'ai.provider': TARGET_PROVIDER, 'ai.model': TARGET_MODEL } }
            );
            moved += res.modifiedCount;
        }
        console.log(`\nMoved ${moved} client(s) to ${TARGET_PROVIDER} / ${TARGET_MODEL}.`);

        // Same hook AI Settings runs on a provider change; it checks each client's CURRENT provider, so it also heals an interrupted run.
        const kbTenants = await KnowledgeDocument.distinct('userId', {
            ...scope,
            deletedAt: null,
            status: 'ready',
            embeddingModel: { $nin: [openaiEmbeddingModel, null] }
        });
        let markedStale = 0;
        for (const tenantId of kbTenants) markedStale += await kb.markStaleForProviderChange(tenantId);
        console.log(`Marked ${markedStale} knowledge base document(s) as "needs re-index".`);
    }

    // ── 4. re-index ─────────────────────────────────────────────────────────
    const staleFilter = { ...scope, deletedAt: null, status: 'stale' };
    // A dry run marked nothing, so add the documents step 3 would have marked.
    const pending = await KnowledgeDocument.countDocuments(staleFilter) + (isDryRun ? kbAffected : 0);

    if (!reindex || isDryRun) {
        if (pending > 0) {
            console.log(`\n${pending} knowledge base document(s) ${reindex ? 'would be re-indexed' : 'need a re-index'}.`);
            if (!reindex) {
                console.log('Clients can click re-index themselves, or run this again with --reindex to rebuild them now');
                console.log('(charged to each client\'s AI credits, exactly like a manual re-index).');
            }
        }
    } else {
        const stale = await KnowledgeDocument.find(staleFilter).select('_id userId originalName').lean();
        console.log(`\nRe-indexing ${stale.length} document(s)...`);
        let rebuilt = 0;
        let failed = 0;
        let noCredits = 0;
        for (const doc of stale) {
            if (!(await aiCreditService.hasCredits(doc.userId))) {
                noCredits++;
                continue;
            }
            await kb.processDocument(doc._id);
            const after = await KnowledgeDocument.findById(doc._id).select('status errorMessage').lean();
            if (after?.status === 'ready') {
                rebuilt++;
            } else {
                failed++;
                console.log(`   failed: "${doc.originalName}" (${doc._id}) - ${after?.errorMessage || after?.status}`);
            }
        }
        console.log(`Re-indexed ${rebuilt}, failed ${failed}, skipped ${noCredits} (client has no AI credits).`);
    }

    console.log('\n' + (isDryRun ? 'DRY RUN - no writes were performed.' : 'Done.'));
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Migration failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
