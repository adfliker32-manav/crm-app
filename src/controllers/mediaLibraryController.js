// ============================================================
// MEDIA LIBRARY CONTROLLER
// ============================================================
// Tenant-scoped CRUD over MediaAsset. Bytes go straight to object storage
// (R2); the application server keeps only a short-lived temp file during the
// upload itself, which is always removed in a finally block.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const MediaAsset = require('../models/MediaAsset');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const storage = require('../services/storageService');

// Per-type ceilings from Meta's Cloud API media limits.
const MB = 1024 * 1024;
const TYPE_RULES = [
    { mediaType: 'IMAGE',    maxBytes: 5 * MB,   mimes: ['image/jpeg', 'image/png'],                        ext: { 'image/jpeg': '.jpg', 'image/png': '.png' } },
    { mediaType: 'VIDEO',    maxBytes: 16 * MB,  mimes: ['video/mp4', 'video/3gpp'],                        ext: { 'video/mp4': '.mp4', 'video/3gpp': '.3gp' } },
    { mediaType: 'AUDIO',    maxBytes: 16 * MB,  mimes: ['audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/mp4'], ext: { 'audio/aac': '.aac', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' } },
    {
        mediaType: 'DOCUMENT',
        maxBytes: 100 * MB,
        mimes: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain'
        ],
        ext: {
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/vnd.ms-excel': '.xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'application/vnd.ms-powerpoint': '.ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
            'text/plain': '.txt'
        }
    }
];

function classify(mimeType) {
    return TYPE_RULES.find(r => r.mimes.includes(mimeType)) || null;
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', d => hash.update(d));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

const toDto = (a) => ({
    id:         a._id,
    label:      a.label || a.fileName,
    fileName:   a.fileName,
    mimeType:   a.mimeType,
    mediaType:  a.mediaType,
    size:       a.size,
    url:        a.publicUrl,
    folder:     a.folder,
    usageCount: a.usageCount,
    lastUsedAt: a.lastUsedAt,
    createdAt:  a.createdAt
});

// ── GET /api/media-library ───────────────────────────────────────────────────
exports.listAssets = async (req, res) => {
    try {
        const query = { userId: req.tenantId };
        if (req.query.type) {
            const t = String(req.query.type).toUpperCase();
            if (TYPE_RULES.some(r => r.mediaType === t)) query.mediaType = t;
        }
        if (req.query.search) {
            const safe = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [{ fileName: new RegExp(safe, 'i') }, { label: new RegExp(safe, 'i') }];
        }

        const limit = Math.min(parseInt(req.query.limit) || 60, 200);
        const page = Math.max(parseInt(req.query.page) || 1, 1);

        const [assets, total, usage] = await Promise.all([
            MediaAsset.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            MediaAsset.countDocuments(query),
            MediaAsset.aggregate([
                { $match: { userId: req.tenantId, deletedAt: null } },
                { $group: { _id: null, bytes: { $sum: '$size' }, count: { $sum: 1 } } }
            ])
        ]);

        const workspace = await WorkspaceSettings.findOne({ userId: req.tenantId }).select('planFeatures.storageLimitMb').lean();
        const limitMb = workspace?.planFeatures?.storageLimitMb ?? 1024;

        res.json({
            success: true,
            assets: assets.map(toDto),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            storage: {
                usedBytes: usage[0]?.bytes || 0,
                fileCount: usage[0]?.count || 0,
                limitMb,
                unlimited: !(limitMb > 0)
            }
        });
    } catch (err) {
        console.error('[MediaLibrary] list error:', err);
        res.status(500).json({ success: false, message: 'Failed to load media library' });
    }
};

// ── POST /api/media-library/upload ───────────────────────────────────────────
exports.uploadAsset = async (req, res) => {
    const tempPath = req.file?.path;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const { mimetype, originalname, size } = req.file;

        const rule = classify(mimetype);
        if (!rule) {
            return res.status(400).json({
                success: false,
                message: 'Unsupported file type. Allowed: JPG, PNG, MP4, PDF, DOC(X), XLS(X), PPT(X), TXT, MP3.'
            });
        }
        if (size > rule.maxBytes) {
            return res.status(400).json({
                success: false,
                message: `${rule.mediaType.toLowerCase()} must be under ${Math.round(rule.maxBytes / MB)} MB`
            });
        }

        // ── Storage quota ────────────────────────────────────────────────
        const workspace = await WorkspaceSettings.findOne({ userId: req.tenantId })
            .select('planFeatures.storageLimitMb').lean();
        const limitMb = workspace?.planFeatures?.storageLimitMb ?? 1024;
        if (limitMb > 0) {
            const usage = await MediaAsset.aggregate([
                { $match: { userId: req.tenantId, deletedAt: null } },
                { $group: { _id: null, bytes: { $sum: '$size' } } }
            ]);
            const used = usage[0]?.bytes || 0;
            if (used + size > limitMb * MB) {
                return res.status(413).json({
                    success: false,
                    message: `Storage limit reached (${limitMb} MB). Delete unused media or upgrade your plan.`
                });
            }
        }

        // ── Dedup: identical bytes already stored for this tenant ────────
        const sha256 = await sha256File(tempPath);
        const existing = await MediaAsset.findOne({ userId: req.tenantId, sha256 });
        if (existing) {
            return res.json({ success: true, asset: toDto(existing), deduped: true });
        }

        // ── Push to object storage ───────────────────────────────────────
        const ext = rule.ext[mimetype] || path.extname(originalname).slice(0, 10) || '.bin';
        const storageKey = `${req.tenantId}/${uuidv4()}${ext}`;
        const stream = fs.createReadStream(tempPath);
        const { url } = await storage.putObject(storageKey, stream, mimetype, { contentLength: size });

        const asset = await MediaAsset.create({
            userId:     req.tenantId,
            uploadedBy: req.user?.userId || req.user?.id || null,
            fileName:   String(originalname).slice(0, 255),
            label:      (req.body?.label ? String(req.body.label).slice(0, 120) : null),
            folder:     (req.body?.folder ? String(req.body.folder).slice(0, 60) : null),
            mimeType:   mimetype,
            size,
            mediaType:  rule.mediaType,
            storageKey,
            publicUrl:  url,
            sha256
        });

        res.status(201).json({ success: true, asset: toDto(asset) });
    } catch (err) {
        // Unique-index race: another request stored the same bytes first.
        if (err?.code === 11000) {
            const existing = await MediaAsset.findOne({ userId: req.tenantId, sha256: err.keyValue?.sha256 });
            if (existing) return res.json({ success: true, asset: toDto(existing), deduped: true });
        }
        console.error('[MediaLibrary] upload error:', err);
        res.status(500).json({ success: false, message: 'Upload failed' });
    } finally {
        if (tempPath) fs.unlink(tempPath, () => {});
    }
};

// ── GET /api/media-library/:id/raw ───────────────────────────────────────────
// Ownership-checked preview stream. Used by the library UI for thumbnails and
// previews so it works identically under both storage drivers, and so nothing
// has to be served from a blanket public /uploads mount (which this codebase
// deliberately removed — an authenticated user could read another tenant's file).
exports.streamAsset = async (req, res) => {
    try {
        const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.tenantId }).lean();
        if (!asset) return res.status(404).json({ success: false, message: 'Media not found' });

        const stream = await storage.getStream(asset.storageKey);

        res.setHeader('Content-Type', asset.mimeType);
        res.setHeader('Content-Length', asset.size);
        // Never let a stored file be sniffed into something executable.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asset.fileName)}"`);
        res.setHeader('Cache-Control', 'private, max-age=3600');

        stream.on('error', (err) => {
            console.error('[MediaLibrary] stream error:', err.message);
            if (!res.headersSent) res.status(500).end();
            else res.destroy();
        });
        stream.pipe(res);
    } catch (err) {
        console.error('[MediaLibrary] streamAsset error:', err);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Could not load media' });
    }
};

// ── PATCH /api/media-library/:id ─────────────────────────────────────────────
exports.updateAsset = async (req, res) => {
    try {
        const updates = {};
        if (req.body.label !== undefined)  updates.label  = String(req.body.label).slice(0, 120) || null;
        if (req.body.folder !== undefined) updates.folder = String(req.body.folder).slice(0, 60) || null;

        const asset = await MediaAsset.findOneAndUpdate(
            { _id: req.params.id, userId: req.tenantId },
            { $set: updates },
            { new: true }
        );
        if (!asset) return res.status(404).json({ success: false, message: 'Media not found' });

        res.json({ success: true, asset: toDto(asset) });
    } catch (err) {
        console.error('[MediaLibrary] update error:', err);
        res.status(500).json({ success: false, message: 'Update failed' });
    }
};

// ── DELETE /api/media-library/:id ────────────────────────────────────────────
exports.deleteAsset = async (req, res) => {
    try {
        const asset = await MediaAsset.findOne({ _id: req.params.id, userId: req.tenantId });
        if (!asset) return res.status(404).json({ success: false, message: 'Media not found' });

        // Refuse while a template still points at it — deleting would leave the
        // template unsendable with no indication why.
        const inUse = await WhatsAppTemplate.countDocuments({
            userId: req.tenantId,
            'components.mediaAssetId': asset._id
        });
        if (inUse > 0) {
            return res.status(409).json({
                success: false,
                message: `This file is used by ${inUse} template(s). Remove it from them first.`
            });
        }

        await storage.deleteObject(asset.storageKey);
        await MediaAsset.deleteOne({ _id: asset._id });

        res.json({ success: true, message: 'Media deleted' });
    } catch (err) {
        console.error('[MediaLibrary] delete error:', err);
        res.status(500).json({ success: false, message: 'Delete failed' });
    }
};
