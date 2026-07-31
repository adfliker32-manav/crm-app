const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Legacy tree. Nothing is written here any more — attachments now go to object
// storage — but it is still read for files uploaded before that change, and
// still removed when a ticket is deleted.
const SUPPORT_UPLOAD_ROOT = path.join('uploads', 'support');

// Uploads land here only long enough to be streamed into object storage; the
// controller removes them in every exit path.
const SUPPORT_TEMP_DIR = path.join('uploads', 'temp');

if (!fs.existsSync(SUPPORT_TEMP_DIR)) {
    fs.mkdirSync(SUPPORT_TEMP_DIR, { recursive: true });
}

const IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES];

// The stored extension is derived from the accepted MIME type, never from the
// client's filename. `payload.html` uploaded as `image/png` satisfied the MIME
// filter and used to be written as `<uuid>.html`; served back from our own origin
// under /uploads, that executes as same-origin script.
const EXT_FOR_MIME = {
    'image/jpeg': '.jpg',
    'image/jpg':  '.jpg',
    'image/png':  '.png',
    'image/gif':  '.gif',
    'image/webp': '.webp',
    'video/mp4':  '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov'
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB — video cap; images naturally smaller

// Everything stages in one flat temp dir — the destination no longer depends on
// a URL-supplied ticket id, so there is no path to build from untrusted input
// and no per-ticket directory to create before authorisation has run.
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, SUPPORT_TEMP_DIR),
    filename: (req, file, cb) => {
        const ext = EXT_FOR_MIME[file.mimetype] || '.bin';
        cb(null, `${uuidv4()}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only images (jpg/png/gif/webp) and short videos (mp4/webm/mov) are allowed.'), false);
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE, files: 3 }
});

const classifyAttachment = (mime) => (IMAGE_MIMES.includes(mime) ? 'image' : 'video');

module.exports = {
    uploadSupportMedia: upload.array('files', 3),
    SUPPORT_UPLOAD_ROOT,
    SUPPORT_TEMP_DIR,
    classifyAttachment
};
