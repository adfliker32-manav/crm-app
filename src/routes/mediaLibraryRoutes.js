const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const mediaLibraryController = require('../controllers/mediaLibraryController');
const validateObjectId = require('../middleware/validateObjectId');
const { validate, schemas } = require('../middleware/validateRequest');

// Uploads land on disk first, then stream to object storage. Buffering a
// 100 MB document in memory would risk OOM under concurrent uploads.
const tempDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, tempDir),
        // Extension comes from the accepted MIME allowlist in the controller,
        // never from the client filename — the temp name is opaque on purpose.
        filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.upload')
    }),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 } // matches Meta's document ceiling
});

// Multer errors (file too large, too many files) are thrown in middleware, so
// the controller's try/catch never sees them — translate them to clean JSON
// instead of letting a raw 500 reach the UI.
const handleUpload = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                const message = err.code === 'LIMIT_FILE_SIZE'
                    ? 'File is too large. Maximum size is 100 MB.'
                    : `Upload rejected: ${err.message}`;
                return res.status(413).json({ success: false, message });
            }
            return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
        }

        // Guarantee the temp file is removed however the request ends — the
        // controller's own cleanup never runs when a later middleware (body
        // validation) short-circuits with a 400. Unlinking twice is harmless.
        if (req.file?.path) {
            res.on('finish', () => fs.unlink(req.file.path, () => {}));
        }
        next();
    });
};

router.get('/', mediaLibraryController.listAssets);
// multer must run first — it is what populates req.body for multipart requests.
router.post('/upload', handleUpload, validate(schemas.uploadMediaAsset), mediaLibraryController.uploadAsset);
router.get('/:id/raw', validateObjectId('id'), mediaLibraryController.streamAsset);
router.patch('/:id',   validateObjectId('id'), validate(schemas.updateMediaAsset), mediaLibraryController.updateAsset);
router.delete('/:id',  validateObjectId('id'), mediaLibraryController.deleteAsset);

module.exports = router;
