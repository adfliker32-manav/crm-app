const express = require('express');
const router = express.Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const knowledgeBaseController = require('../controllers/knowledgeBaseController');
const { MAX_FILE_BYTES, MAX_FILE_MB } = require('../services/knowledgeBaseService');
const validateObjectId = require('../middleware/validateObjectId');
const { validate, schemas } = require('../middleware/validateRequest');

// Uploads stage on disk, not in memory: a 25 MB spreadsheet buffered per
// concurrent request is a straightforward path to OOM, and every parser here
// (exceljs, pdfjs, mammoth) reads from a path anyway.
const tempDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, tempDir),
        // Opaque temp name: the extension is decided later from the verified MIME
        // and magic bytes, never from the client's filename.
        filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.upload')
    }),
    limits: { fileSize: MAX_FILE_BYTES, files: 1 }
});

// Multer throws inside middleware, so the controller's try/catch never sees a
// too-large file — translate those into clean JSON instead of a raw 500.
const handleUpload = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                const message = err.code === 'LIMIT_FILE_SIZE'
                    ? `File is too large. Maximum size is ${MAX_FILE_MB} MB.`
                    : `Upload rejected: ${err.message}`;
                return res.status(413).json({ success: false, message });
            }
            return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        }

        // The happy path hands the temp file to the background indexer, which
        // unlinks it when done. This guard covers the OTHER exits — a validation
        // 400 below, or a handler that never reaches the indexer — so a rejected
        // upload cannot leave bytes in uploads/temp forever. Unlinking twice is
        // harmless; the second call just gets ENOENT.
        if (req.file?.path) {
            res.on('finish', () => {
                if (res.statusCode >= 400) fs.unlink(req.file.path, () => {});
            });
        }
        next();
    });
};

// ⚠️ Both limiters below guard SPEND, not just load. Every test query and every
// upload makes a billed embedding call against the platform's provider key, so an
// unthrottled loop here costs real money rather than merely CPU.
const testQueryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,   // a person trying questions in the UI never approaches this
    message: { success: false, error: 'rate_limit', message: 'Too many test queries. Please wait a minute.' }
});

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, error: 'rate_limit', message: 'Too many uploads. Please wait 15 minutes.' }
});

router.get('/stats', knowledgeBaseController.getStats);
router.get('/documents', knowledgeBaseController.listDocuments);

// multer must run BEFORE validate() — it is what populates req.body on a
// multipart request. Reversed, the description field would always be empty.
router.post('/upload', uploadLimiter, handleUpload, validate(schemas.uploadKnowledgeDocument), knowledgeBaseController.uploadDocument);

router.post('/test-query', testQueryLimiter, validate(schemas.testKnowledgeQuery), knowledgeBaseController.testQuery);

router.get('/documents/:id', validateObjectId('id'), knowledgeBaseController.getDocument);
router.patch('/documents/:id/toggle', validateObjectId('id'), validate(schemas.toggleKnowledgeDocument), knowledgeBaseController.toggleDocument);
// Reads nothing from the body — pinned to noBody so the ratchet in
// tests/security/validation-coverage.test.js stays satisfied and any future
// field added here is forced to declare a schema first.
router.post('/documents/:id/reprocess', uploadLimiter, validateObjectId('id'), validate(schemas.noBody), knowledgeBaseController.reprocessDocument);
router.delete('/documents/:id', validateObjectId('id'), knowledgeBaseController.deleteDocument);

module.exports = router;
