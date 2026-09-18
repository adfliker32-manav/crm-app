// Contextual Help video system — the parts that are easy to get quietly wrong.
//
// WHY THESE TESTS EXIST
//   Three invariants hold the feature together, and all three fail silently:
//
//   1. ONE PARSER. A help video is stored as whatever link the super admin
//      pasted — watch?v=, youtu.be, /shorts/. If extraction disagrees anywhere,
//      the drawer shows a dead player and nothing logs an error.
//   2. ONE KEY SHAPE. A page asks for a topic by key; a super admin saves one
//      by typing a key. Both go through the same normaliser. If it mangles
//      either side, every lookup misses and the module reports "Help video
//      coming soon" forever — with no error logged anywhere.
//   3. NO YOUTUBE URLS IN THE FRONTEND. The whole point of the feature is that
//      a super admin can change a video without a deploy. A URL pasted into a
//      React file would work — right up until someone needs it changed.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));

const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

const { parseYouTubeId, describeYouTubeUrl } = require(path.join(ROOT, 'src', 'utils', 'youtubeUrl'));
const { normalizeHelpKey, submoduleLabelFor } = require(path.join(ROOT, 'src', 'constants', 'helpCatalog'));

// ─────────────────────────────────────────────────────────────────────────────
// 1 — YouTube link shapes
// ─────────────────────────────────────────────────────────────────────────────

describe('YouTube URL parsing', () => {
    const ID = 'dQw4w9WgXcQ';

    test('accepts every link shape an admin realistically pastes', () => {
        const accepted = [
            'https://www.youtube.com/watch?v=' + ID,
            'http://youtube.com/watch?v=' + ID,
            'https://youtu.be/' + ID,
            'https://youtu.be/' + ID + '?t=42',
            'https://www.youtube.com/shorts/' + ID,
            'https://m.youtube.com/watch?v=' + ID + '&list=PLxyz',
            'https://www.youtube-nocookie.com/embed/' + ID,
            'https://www.youtube.com/live/' + ID,
            'youtube.com/watch?v=' + ID,          // no scheme — pasted from the address bar
            '  https://youtu.be/' + ID + '  ',    // stray whitespace
            ID                                     // bare id, copied out of Studio
        ];
        for (const url of accepted) {
            assert.strictEqual(parseYouTubeId(url), ID, `should have parsed: ${url}`);
        }
    });

    test('rejects anything that is not a YouTube video', () => {
        const rejected = [
            'https://vimeo.com/123456789',
            'https://www.loom.com/share/abcdef',
            // Look-alike hosts: the whole point of matching on the dot boundary.
            'https://evil-youtube.com/watch?v=' + ID,
            'https://youtube.com.attacker.net/watch?v=' + ID,
            'javascript:alert(1)',
            'https://www.youtube.com/watch?v=tooshort',
            'https://www.youtube.com/@somechannel',
            'not a url at all',
            '',
            null,
            undefined,
            42
        ];
        for (const url of rejected) {
            assert.strictEqual(parseYouTubeId(url), null, `should have rejected: ${String(url)}`);
        }
    });

    test('derived URLs never autoplay and use the privacy-enhanced host', () => {
        const d = describeYouTubeUrl('https://youtu.be/' + ID);
        assert.ok(d, 'a valid link must describe');
        assert.match(d.embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
        assert.ok(!/autoplay=1/.test(d.embedUrl), 'the drawer must never start a video by itself');
        assert.strictEqual(d.watchUrl, 'https://www.youtube.com/watch?v=' + ID);
        assert.ok(d.thumbnailUrl.includes(ID));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — key normalisation must be identical on read and on write
// ─────────────────────────────────────────────────────────────────────────────

describe('help key normalisation', () => {
    test('casing and separators never change which record is found', () => {
        // Left = what someone types or a page passes; right = the stored key.
        const pairs = [
            ['broadcasts', 'broadcasts'],
            ['agent-detail', 'agent-detail'],
            ['  Lead  Assignment  ', 'lead-assignment'],
            ['Getting Started', 'getting-started'],
            ['lead_assignment', 'lead-assignment'],
            ['LEAD-ASSIGNMENT', 'lead-assignment']
        ];
        for (const [typed, stored] of pairs) {
            assert.strictEqual(
                normalizeHelpKey(typed), normalizeHelpKey(stored),
                `"${typed}" and "${stored}" must resolve to one key, or the lookup silently misses`
            );
        }
    });

    // REGRESSION: the normaliser used to split camelCase so a page tab id like
    // `customFields` became `custom-fields`. The same rule turned the "WhatsApp"
    // a super admin types into `whats-app` — a key no page ever asks for, so the
    // video they just saved was invisible forever with no error anywhere.
    // A page with camelCase tab ids declares its topic explicitly instead.
    test('a brand name typed by a human is not mangled', () => {
        assert.strictEqual(normalizeHelpKey('WhatsApp'), 'whatsapp');
        assert.strictEqual(normalizeHelpKey('OpenAI'), 'openai');
        assert.strictEqual(normalizeHelpKey('WhatsApp Broadcast'), 'whatsapp-broadcast');
    });

    test('empty / missing sub-module is the module-level bucket, not a crash', () => {
        for (const v of ['', null, undefined, '   ', '///']) {
            assert.strictEqual(normalizeHelpKey(v), '');
        }
    });

    test('an unknown key still gets a readable label', () => {
        assert.strictEqual(submoduleLabelFor('whatsapp', 'broadcasts'), 'WhatsApp Broadcast');
        // A topic a super admin invented after this code shipped.
        assert.strictEqual(submoduleLabelFor('whatsapp', 'new-feature-tour'), 'New Feature Tour');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — resolution: which video the drawer actually opens with
// ─────────────────────────────────────────────────────────────────────────────

describe('help video resolution', () => {
    let DB = [];

    // find().sort().limit().lean() is the exact chain the controller uses.
    const chain = (get) => {
        const p = Promise.resolve().then(get);
        p.sort = (spec) => {
            p._sort = spec;
            return p;
        };
        p.limit = () => p;
        p.lean = () => p;
        return p;
    };

    stub('src/models/HelpVideo.js', {
        find: (q) => chain(() => DB
            .filter(v => v.module === q.module && (q.isActive === undefined || v.isActive === q.isActive))
            .slice()
            .sort((a, b) => (a.sortOrder - b.sortOrder) || 0)),
        aggregate: async () => [],
        countDocuments: async () => 0
    });
    stub('src/services/auditLogger.js', { log: () => {} });

    const { getHelpVideos } = require(path.join(ROOT, 'src', 'controllers', 'helpVideoController'));

    const mockRes = () => {
        const res = { statusCode: 200, body: null };
        res.status = (c) => { res.statusCode = c; return res; };
        res.json = (b) => { res.body = b; return res; };
        return res;
    };

    const call = async (module, submodule) => {
        const res = mockRes();
        await getHelpVideos({ query: { module, submodule } }, res);
        return res;
    };

    const video = (over) => ({
        _id: over.id,
        module: 'whatsapp',
        submodule: '',
        title: over.id,
        description: '',
        youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        videoId: 'dQw4w9WgXcQ',
        isActive: true,
        sortOrder: 0,
        ...over
    });

    test('sortOrder picks the primary when a topic has several videos', async () => {
        DB = [
            video({ id: 'advanced',        submodule: 'broadcasts', sortOrder: 2 }),
            video({ id: 'getting-started', submodule: 'broadcasts', sortOrder: 0 }),
            video({ id: 'troubleshooting', submodule: 'broadcasts', sortOrder: 1 })
        ];
        const res = await call('whatsapp', 'broadcasts');
        assert.strictEqual(res.body.primary.title, 'getting-started');
        assert.deepStrictEqual(
            res.body.related.map(v => v.title),
            ['troubleshooting', 'advanced'],
            'the rest of the topic must stay available, in order'
        );
        assert.strictEqual(res.body.isFallback, false);
    });

    test('a sub-module with no video of its own falls back to the module overview, and says so', async () => {
        DB = [
            video({ id: 'wa-overview', submodule: '', sortOrder: 0 }),
            video({ id: 'wa-inbox',    submodule: 'inbox', sortOrder: 0 })
        ];
        const res = await call('whatsapp', 'broadcasts');
        assert.strictEqual(res.body.primary.title, 'wa-overview');
        assert.strictEqual(res.body.isFallback, true, 'the drawer must be able to tell the user this is the general guide');
        assert.strictEqual(res.body.submodule.label, 'WhatsApp Broadcast');
    });

    test('the exact sub-module always beats the module overview', async () => {
        DB = [
            video({ id: 'wa-overview',  submodule: '',           sortOrder: 0 }),
            video({ id: 'wa-broadcast', submodule: 'broadcasts', sortOrder: 5 })
        ];
        const res = await call('whatsapp', 'broadcasts');
        assert.strictEqual(res.body.primary.title, 'wa-broadcast');
        assert.strictEqual(res.body.isFallback, false);
    });

    test('an empty library answers cleanly instead of erroring', async () => {
        DB = [];
        const res = await call('whatsapp', 'broadcasts');
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.body.primary, null);
        assert.deepStrictEqual(res.body.related, []);
        assert.strictEqual(res.body.module.label, 'WhatsApp', 'the breadcrumb still has to render');
    });

    test('inactive videos are never served', async () => {
        DB = [video({ id: 'switched-off', submodule: 'broadcasts', isActive: false })];
        const res = await call('whatsapp', 'broadcasts');
        assert.strictEqual(res.body.primary, null);
    });

    test('a record whose link stopped resolving is dropped, not rendered dead', async () => {
        DB = [
            video({ id: 'broken', submodule: 'broadcasts', videoId: '', youtubeUrl: 'https://vimeo.com/1' }),
            video({ id: 'good',   submodule: 'broadcasts', sortOrder: 1 })
        ];
        const res = await call('whatsapp', 'broadcasts');
        assert.strictEqual(res.body.primary.title, 'good');
        assert.strictEqual(res.body.related.length, 0);
    });

    test('the query is normalised on read, so casing and separators do not matter', async () => {
        DB = [video({ id: 'cf', module: 'settings', submodule: 'custom-fields' })];
        const res = await call('Settings', 'Custom_Fields');
        assert.strictEqual(res.body.primary.title, 'cf');
    });

    test('a missing module is a 400, not an unfiltered dump', async () => {
        DB = [video({ id: 'x' })];
        const res = await call('', '');
        assert.strictEqual(res.statusCode, 400);
    });

    test('the customer payload carries built URLs, never the raw stored link', async () => {
        DB = [video({ id: 'wa', submodule: 'broadcasts' })];
        const res = await call('whatsapp', 'broadcasts');
        const primary = res.body.primary;
        assert.ok(primary.embedUrl && primary.watchUrl && primary.thumbnailUrl);
        assert.strictEqual(
            primary.youtubeUrl, undefined,
            'the drawer has no use for the raw link — one place builds URLs'
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — the frontend must stay free of video URLs
// ─────────────────────────────────────────────────────────────────────────────

describe('no hardcoded video URLs in the client', () => {
    const CLIENT_SRC = path.join(ROOT, 'client', 'src');

    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
    });

    // A form placeholder like "https://youtube.com/watch?v=..." is fine — it
    // points at no video. What must never appear is a link that actually
    // RESOLVES, so the check asks the real parser rather than matching on host.
    const resolvesToAVideo = (url) =>
        Boolean(parseYouTubeId(url)) || /\/vi\/[A-Za-z0-9_-]{11}\//.test(url);

    test('no React source embeds a playable YouTube link', () => {
        const offenders = [];
        for (const file of walk(CLIENT_SRC)) {
            const src = fs.readFileSync(file, 'utf8');
            // Any youtube/youtu.be/ytimg host, however it is spelled.
            const hits = (src.match(/https?:\/\/[^\s'"`]*(?:youtube\.com|youtu\.be|ytimg\.com)[^\s'"`]*/gi) || [])
                .filter(resolvesToAVideo);
            if (hits.length) offenders.push(`${path.relative(ROOT, file)} → ${hits.join(', ')}`);
        }
        assert.deepStrictEqual(
            offenders, [],
            'Help videos are managed from the Super Admin panel. A URL in React means a deploy to change a video:\n' + offenders.join('\n')
        );
    });
});
