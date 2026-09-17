// AI Voice module authorization (audit 2026-09-16).
//
// Two gaps, both of the class settings-authorization.test.js was written to
// prevent — voice was simply never included in that pass:
//
//   1. PUT /api/voice-calls/config took only authMiddleware. It writes the
//      tenant's Vapi/Retell API key, outbound number and webhook secret. The
//      `accessSettings` permission defaults to FALSE for agents, so any agent
//      could rotate the webhook secret and then forge call outcomes into their
//      tenant's workflows, or repoint outbound calls at another provider
//      account. The sidebar only shows AI Voice to managers, but that is a UX
//      affordance — the API is reachable with any valid JWT.
//
//   2. featureRegistry declares `voice` with enforced:true, which means "a plan
//      gate already backs this toggle". No voice route mounted requireModule,
//      so switching AI Voice off for a client hid the sidebar entry and nothing
//      else: the whole API stayed open.
//
// Like the other route-gate tests here, these read the route sources rather
// than mounting Express.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const readRoute = (f) => fs.readFileSync(path.join(SRC, 'routes', f), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const routeLines = (src) => stripComments(src)
    .split('\n')
    .filter(l => /^router\.(get|post|put|patch|delete)/.test(l.trim()));

describe('AI Voice route authorization', () => {
    test('the credential routes are gated by accessSettings', () => {
        const src = stripComments(readRoute('voiceCallRoutes.js'));

        // The gate may be mounted inline or through a local array of middleware,
        // so assert on the whole file plus the specific config lines.
        assert.match(src, /checkPermission\('accessSettings'\)/,
            'voiceCallRoutes must import and mount the accessSettings gate');

        const configLines = routeLines(src).filter(l => l.includes("'/config'"));
        assert.strictEqual(configLines.length, 2, 'expected a GET and a PUT /config route');

        const ungated = configLines.filter(l =>
            !/checkPermission\('accessSettings'\)|voiceSettings/.test(l));
        assert.deepStrictEqual(ungated, [],
            `ungated voice credential routes:\n${ungated.join('\n')}`);
    });

    test('accessSettings still defaults to false, so the gate means something', () => {
        const User = require(path.join(SRC, 'models', 'User.js'));
        assert.strictEqual(User.schema.path('permissions.accessSettings').options.default, false);
    });

    test('the VoiceHub routers enforce the voice module', () => {
        // Every router the VoiceHub page talks to. The lead-scoped call history is
        // deliberately excluded — see the comment in voiceCallRoutes.js.
        for (const file of ['voiceCallRoutes.js', 'voiceAnalyticsRoutes.js', 'voiceTemplateRoutes.js']) {
            const src = stripComments(readRoute(file));
            assert.match(src, /requireModule\('voice'\)/,
                `${file} must enforce the 'voice' module — the feature registry declares it enforced`);
        }
    });

    test("the registry's enforced:true claim is backed by a real gate", () => {
        const { FEATURE_REGISTRY } = require(path.join(SRC, 'constants', 'featureRegistry.js'));
        const voice = FEATURE_REGISTRY.find(n => n.key === 'voice');

        assert.ok(voice, 'the voice node disappeared from the feature registry');
        assert.strictEqual(voice.enforced, true);
        assert.strictEqual(voice.storage.id, 'voice',
            'the module id the gate mounts must match the id the registry stores');
    });

    test('the lead-scoped call history validates its id instead of 500ing', () => {
        const src = stripComments(readRoute('voiceCallRoutes.js'));
        const leadRoute = routeLines(src).find(l => l.includes('/lead/'))
            // The route spans several lines, so fall back to a whole-file check.
            || src;
        assert.match(leadRoute + src, /validateObjectId\(\{ params: \['leadId'\] \}\)/,
            'a malformed leadId casts to a CastError and is reported as a 500');
    });

    test('the provider webhooks are NOT module-gated (they have no req.user)', () => {
        // requireModule reads req.workspace, which only authMiddleware populates.
        // Mounting it on a public provider callback would 404 every real webhook.
        const src = stripComments(readRoute('voiceWebhookRoutes.js'));
        assert.doesNotMatch(src, /requireModule|checkPermission|authMiddleware/,
            'voice webhooks are public provider callbacks authenticated by signature');
    });

    test('voice webhooks fail closed when no credential is configured', () => {
        const { verifyVapi, verifyRetell } = require(path.join(SRC, 'utils', 'voiceWebhookAuth.js'));
        const req = { headers: {}, rawBody: Buffer.from('{}') };

        delete process.env.VOICE_WEBHOOK_ALLOW_UNSIGNED;
        delete process.env.VAPI_WEBHOOK_SECRET;

        assert.strictEqual(verifyVapi(req, null).ok, false);
        assert.strictEqual(verifyRetell(req, null).ok, false);
    });
});
