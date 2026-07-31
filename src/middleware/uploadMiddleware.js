// ⚠️ DEPRECATED — NOT WIRED TO ANY ROUTE.
// Attachments no longer touch the application server's disk:
//   • ad-hoc email attachments  → emailRoutes.js uses multer.memoryStorage()
//   • email template attachments → emailTemplateController streams to object
//     storage (email-attachments/<ownerId>/…) via storageService
// Do NOT mount this middleware. Reintroducing it would put tenant files back on
// local disk, where they survive no redeploy and are never cleaned up.
// Retained only because the security test suite asserts on its source.
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directory exists
const uploadDir = 'uploads/email-attachments';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Single source of truth for what may be stored and what it is named on disk.
// The keys double as the MIME allowlist used by fileFilter below.
const EXT_FOR_MIME = {
    'application/pdf':  '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'image/jpeg': '.jpg',
    'image/jpg':  '.jpg',
    'image/png':  '.png',
    'image/gif':  '.gif',
    'text/plain': '.txt',
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip'
};

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Partition per tenant. The JWT payload carries `userId`, NOT `id`, so the
        // old `req.user?.id` was undefined on every request and every tenant's
        // attachments were written into a single shared `default/` bucket — the
        // per-user separation this code intends never actually existed.
        const rawId = req.tenantId || req.user?.userId || req.user?.id;

        // The id becomes a path segment, so never trust it verbatim.
        const tenantDir = /^[a-f\d]{24}$/i.test(String(rawId || '')) ? String(rawId) : 'shared';
        const userDir = path.join(uploadDir, tenantDir);

        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename: uuid-timestamp-originalname
        const uniqueId = uuidv4();
        const timestamp = Date.now();
        // ⚠️ The extension is derived from the ACCEPTED MIME type, never from the
        // client's filename. mimetype is itself client-supplied, so `payload.html`
        // sent as `image/png` passed the filter and used to be stored as `.html`
        // — and since /uploads is served from our own origin, that file then
        // executed as same-origin script. Mapping through the allowlist means the
        // worst case is a mislabelled file, not an executable one.
        const ext = EXT_FOR_MIME[file.mimetype] || '.bin';
        const nameWithoutExt = path.basename(file.originalname, path.extname(file.originalname));
        const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80);
        const filename = `${uniqueId}-${timestamp}-${sanitizedName}${ext}`;

        cb(null, filename);
    }
});

// File filter - allowed types
const fileFilter = (req, file, cb) => {
    const allowedMimes = Object.keys(EXT_FOR_MIME);

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type not allowed. Allowed types: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, GIF, TXT, ZIP`), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 5 // Max 5 files
    }
});

module.exports = {
    uploadAttachments: upload.array('files', 5), // Field name: 'files', max 5 files
    uploadSingle: upload.single('file')
};
