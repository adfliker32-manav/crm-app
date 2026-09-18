const HelpVideo = require('../models/HelpVideo');
const auditLogger = require('../services/auditLogger');
const { escapeRegex, parseBoundedInteger, getRequestUserId } = require('../utils/controllerHelpers');
const { describeYouTubeUrl } = require('../utils/youtubeUrl');
const {
    HELP_CATALOG,
    MODULE_LEVEL_LABEL,
    normalizeHelpKey,
    moduleLabelFor,
    submoduleLabelFor
} = require('../constants/helpCatalog');

// How many "Related guides" the drawer is handed. Enough to cover a module with
// a full sub-module set, small enough that the panel never becomes a wall.
const MAX_RELATED = 8;

// ── Serialisation ───────────────────────────────────────────────────────────
// The client never parses a YouTube link: the API hands it the embed / watch /
// thumbnail URLs already built. `youtubeUrl` (the raw pasted link) is therefore
// deliberately ABSENT from this shape — the customer-facing drawer has no use
// for it, and keeping it out means there is exactly one place URLs are formed.
const toPublicVideo = (doc) => {
    const derived = describeYouTubeUrl(doc.videoId || doc.youtubeUrl);
    // A record whose link no longer resolves would render as a dead player.
    // Drop it instead — the drawer then shows its honest "coming soon" state.
    if (!derived) return null;
    return {
        id: String(doc._id),
        module: doc.module,
        submodule: doc.submodule || '',
        moduleLabel: moduleLabelFor(doc.module),
        submoduleLabel: submoduleLabelFor(doc.module, doc.submodule || ''),
        title: doc.title,
        description: doc.description || '',
        sortOrder: doc.sortOrder ?? 0,
        ...derived
    };
};

// The admin table needs the raw link (it is what they edit) plus the audit dates.
const toAdminVideo = (doc) => {
    const derived = describeYouTubeUrl(doc.videoId || doc.youtubeUrl);
    return {
        id: String(doc._id),
        module: doc.module,
        submodule: doc.submodule || '',
        moduleLabel: moduleLabelFor(doc.module),
        submoduleLabel: submoduleLabelFor(doc.module, doc.submodule || ''),
        title: doc.title,
        description: doc.description || '',
        youtubeUrl: doc.youtubeUrl,
        videoId: derived?.videoId || '',
        watchUrl: derived?.watchUrl || '',
        thumbnailUrl: derived?.thumbnailUrl || '',
        // Surfaces a record saved before its link broke, rather than letting it
        // fail silently in the customer's drawer.
        linkValid: Boolean(derived),
        isActive: doc.isActive !== false,
        sortOrder: doc.sortOrder ?? 0,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
    };
};

// ── Customer-facing: the one call the Help drawer makes ─────────────────────
//
// GET /api/help-videos?module=whatsapp&submodule=broadcasts
//
// Resolution order (predictable on purpose):
//   1. active videos for the exact { module, submodule }
//   2. …else the module-level videos (submodule: '') as a labelled fallback
//   3. …else nothing, and the drawer says "Help video coming soon."
// `related` is every OTHER active video in the same module, same-sub-module
// first — so Leads opens on "Lead Management" with Assignment / Status /
// Follow-up sitting underneath it.
const getHelpVideos = async (req, res) => {
    try {
        const moduleKey = normalizeHelpKey(req.query.module);
        const submoduleKey = normalizeHelpKey(req.query.submodule);

        if (!moduleKey) {
            return res.status(400).json({ success: false, message: 'module is required' });
        }

        // One query per open: the whole module, already in display order.
        const docs = await HelpVideo.find({ module: moduleKey, isActive: true })
            .sort({ sortOrder: 1, updatedAt: -1 })
            .limit(50)
            .lean();

        const videos = docs.map(toPublicVideo).filter(Boolean);

        const exact = videos.filter(v => v.submodule === submoduleKey);
        const moduleLevel = videos.filter(v => v.submodule === '');

        const chosen = exact.length ? exact : moduleLevel;
        const primary = chosen[0] || null;

        // True when we are showing the module overview because the requested
        // sub-module has nothing of its own — the drawer says so rather than
        // pretending the general guide is the Broadcast tutorial.
        const isFallback = Boolean(primary) && exact.length === 0 && submoduleKey !== '';

        const rest = videos.filter(v => v.id !== primary?.id);
        const related = [
            ...rest.filter(v => v.submodule === submoduleKey),
            ...rest.filter(v => v.submodule !== submoduleKey)
        ].slice(0, MAX_RELATED);

        res.json({
            success: true,
            module: { key: moduleKey, label: moduleLabelFor(moduleKey) },
            submodule: {
                key: submoduleKey,
                label: submoduleKey ? submoduleLabelFor(moduleKey, submoduleKey) : MODULE_LEVEL_LABEL
            },
            primary,
            related,
            isFallback
        });
    } catch (err) {
        console.error('[HelpVideo] getHelpVideos failed:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load help content' });
    }
};

// ── Super Admin: the module / sub-module vocabulary for the form dropdowns ──
//
// Seed catalog UNION whatever keys already exist in the collection, so a topic
// added by hand last month still appears in the dropdown this month. The admin
// form also accepts a free-typed key, which is what makes "add a module without
// touching code" actually true.
const getHelpCatalog = async (req, res) => {
    try {
        const existing = await HelpVideo.aggregate([
            { $group: { _id: { module: '$module', submodule: '$submodule' } } }
        ]);

        const byModule = new Map();
        const ensureModule = (key) => {
            if (!byModule.has(key)) {
                byModule.set(key, { key, label: moduleLabelFor(key), submodules: new Map() });
            }
            return byModule.get(key);
        };

        for (const m of HELP_CATALOG) {
            const entry = ensureModule(m.key);
            entry.icon = m.icon;
            for (const s of m.submodules || []) {
                entry.submodules.set(s.key, { key: s.key, label: s.label });
            }
        }

        for (const row of existing) {
            const moduleKey = normalizeHelpKey(row?._id?.module);
            if (!moduleKey) continue;
            const entry = ensureModule(moduleKey);
            const subKey = normalizeHelpKey(row?._id?.submodule);
            // '' is the module-level bucket — it is offered by the form as a
            // fixed option, not as a sub-module row.
            if (subKey && !entry.submodules.has(subKey)) {
                entry.submodules.set(subKey, { key: subKey, label: submoduleLabelFor(moduleKey, subKey) });
            }
        }

        const modules = [...byModule.values()].map(m => ({
            key: m.key,
            label: m.label,
            icon: m.icon || 'fa-circle-question',
            submodules: [...m.submodules.values()]
        }));

        res.json({ success: true, modules, moduleLevelLabel: MODULE_LEVEL_LABEL });
    } catch (err) {
        console.error('[HelpVideo] getHelpCatalog failed:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load help catalog' });
    }
};

// ── Super Admin: list with search + filters ─────────────────────────────────
const adminListHelpVideos = async (req, res) => {
    try {
        const { search, status } = req.query;
        const moduleKey = normalizeHelpKey(req.query.module);
        // `submodule` needs three states: not filtering, filtering on a real key,
        // and filtering on the module-level bucket. '__module__' is the sentinel
        // the form sends for the last one, because '' already means "no filter".
        const rawSub = typeof req.query.submodule === 'string' ? req.query.submodule : '';
        const submoduleKey = rawSub === '__module__' ? '' : normalizeHelpKey(rawSub);

        const filter = {};
        if (moduleKey) filter.module = moduleKey;
        if (rawSub) filter.submodule = submoduleKey;
        if (status === 'active') filter.isActive = true;
        if (status === 'inactive') filter.isActive = false;

        if (search && String(search).trim()) {
            const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
            filter.$or = [{ title: rx }, { description: rx }, { youtubeUrl: rx }];
        }

        const page = parseBoundedInteger(req.query.page, 1, { min: 1, max: 10000 });
        const limit = parseBoundedInteger(req.query.limit, 25, { min: 1, max: 100 });

        // Headline counts are for the whole library, not the filtered page — they
        // answer "how much help content exists?", which a filter shouldn't change
        // under the admin's feet.
        const [docs, total, libraryTotal, libraryActive] = await Promise.all([
            HelpVideo.find(filter)
                .sort({ module: 1, submodule: 1, sortOrder: 1, title: 1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            HelpVideo.countDocuments(filter),
            HelpVideo.countDocuments({}),
            HelpVideo.countDocuments({ isActive: true })
        ]);

        res.json({
            success: true,
            videos: docs.map(toAdminVideo),
            total,
            page,
            limit,
            stats: { total: libraryTotal, active: libraryActive }
        });
    } catch (err) {
        console.error('[HelpVideo] adminListHelpVideos failed:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load help videos' });
    }
};

// ── Super Admin: validate a pasted link before saving ───────────────────────
// Lets the form show a thumbnail the moment a URL is pasted, using the SAME
// parser the save path uses — so "looks fine here" can never disagree with what
// actually gets stored.
const adminPreviewHelpVideoUrl = (req, res) => {
    const derived = describeYouTubeUrl(req.body.youtubeUrl);
    if (!derived) {
        return res.json({
            success: true,
            valid: false,
            message: 'That does not look like a YouTube video link. Paste a youtube.com/watch, youtu.be or youtube.com/shorts URL.'
        });
    }
    res.json({ success: true, valid: true, ...derived });
};

// ── Super Admin: create ─────────────────────────────────────────────────────
const adminCreateHelpVideo = async (req, res) => {
    try {
        const moduleKey = normalizeHelpKey(req.body.module);
        if (!moduleKey) {
            return res.status(400).json({ success: false, message: 'Module is required' });
        }

        const derived = describeYouTubeUrl(req.body.youtubeUrl);
        if (!derived) {
            return res.status(400).json({
                success: false,
                message: 'Enter a valid YouTube URL (youtube.com/watch, youtu.be or youtube.com/shorts).'
            });
        }

        const video = await HelpVideo.create({
            module: moduleKey,
            submodule: normalizeHelpKey(req.body.submodule),
            title: String(req.body.title).trim(),
            description: (req.body.description || '').trim(),
            youtubeUrl: String(req.body.youtubeUrl).trim(),
            videoId: derived.videoId,
            isActive: req.body.isActive !== false,
            sortOrder: Number(req.body.sortOrder) || 0,
            createdBy: getRequestUserId(req.user),
            updatedBy: getRequestUserId(req.user)
        });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'HELP_VIDEO_CREATED',
            targetType: 'HelpVideo',
            targetId: video._id,
            targetName: video.title,
            details: { module: video.module, submodule: video.submodule, videoId: video.videoId },
            req
        });

        res.status(201).json({ success: true, video: toAdminVideo(video.toObject()) });
    } catch (err) {
        console.error('[HelpVideo] adminCreateHelpVideo failed:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Super Admin: update ─────────────────────────────────────────────────────
const adminUpdateHelpVideo = async (req, res) => {
    try {
        const video = await HelpVideo.findById(req.params.id);
        if (!video) return res.status(404).json({ success: false, message: 'Help video not found' });

        if (req.body.module !== undefined) {
            const moduleKey = normalizeHelpKey(req.body.module);
            if (!moduleKey) return res.status(400).json({ success: false, message: 'Module is required' });
            video.module = moduleKey;
        }
        if (req.body.submodule !== undefined) video.submodule = normalizeHelpKey(req.body.submodule);
        if (req.body.title !== undefined) video.title = String(req.body.title).trim();
        if (req.body.description !== undefined) video.description = (req.body.description || '').trim();
        if (req.body.isActive !== undefined) video.isActive = Boolean(req.body.isActive);
        if (req.body.sortOrder !== undefined) video.sortOrder = Number(req.body.sortOrder) || 0;

        if (req.body.youtubeUrl !== undefined) {
            const derived = describeYouTubeUrl(req.body.youtubeUrl);
            if (!derived) {
                return res.status(400).json({
                    success: false,
                    message: 'Enter a valid YouTube URL (youtube.com/watch, youtu.be or youtube.com/shorts).'
                });
            }
            video.youtubeUrl = String(req.body.youtubeUrl).trim();
            // Kept in lockstep with the link — a stale videoId would keep serving
            // the OLD video after the admin swapped the URL.
            video.videoId = derived.videoId;
        }

        video.updatedBy = getRequestUserId(req.user);
        await video.save();

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'HELP_VIDEO_UPDATED',
            targetType: 'HelpVideo',
            targetId: video._id,
            targetName: video.title,
            details: { module: video.module, submodule: video.submodule, videoId: video.videoId, isActive: video.isActive },
            req
        });

        res.json({ success: true, video: toAdminVideo(video.toObject()) });
    } catch (err) {
        console.error('[HelpVideo] adminUpdateHelpVideo failed:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Super Admin: activate / deactivate ──────────────────────────────────────
const adminToggleHelpVideo = async (req, res) => {
    try {
        const video = await HelpVideo.findById(req.params.id);
        if (!video) return res.status(404).json({ success: false, message: 'Help video not found' });

        video.isActive = Boolean(req.body.isActive);
        video.updatedBy = getRequestUserId(req.user);
        await video.save();

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: video.isActive ? 'HELP_VIDEO_ACTIVATED' : 'HELP_VIDEO_DEACTIVATED',
            targetType: 'HelpVideo',
            targetId: video._id,
            targetName: video.title,
            details: { module: video.module, submodule: video.submodule },
            req
        });

        res.json({ success: true, video: toAdminVideo(video.toObject()) });
    } catch (err) {
        console.error('[HelpVideo] adminToggleHelpVideo failed:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Super Admin: delete ─────────────────────────────────────────────────────
// A hard delete is right here: the record is a pointer to a YouTube link, holds
// no tenant data and nothing references it. Deactivation is the reversible
// option and the UI leads with it.
const adminDeleteHelpVideo = async (req, res) => {
    try {
        const video = await HelpVideo.findByIdAndDelete(req.params.id);
        if (!video) return res.status(404).json({ success: false, message: 'Help video not found' });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'HELP_VIDEO_DELETED',
            targetType: 'HelpVideo',
            targetId: video._id,
            targetName: video.title,
            details: { module: video.module, submodule: video.submodule, youtubeUrl: video.youtubeUrl },
            req
        });

        res.json({ success: true });
    } catch (err) {
        console.error('[HelpVideo] adminDeleteHelpVideo failed:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    getHelpVideos,
    getHelpCatalog,
    adminListHelpVideos,
    adminPreviewHelpVideoUrl,
    adminCreateHelpVideo,
    adminUpdateHelpVideo,
    adminToggleHelpVideo,
    adminDeleteHelpVideo,
    // exported for tests
    toPublicVideo,
    toAdminVideo
};
