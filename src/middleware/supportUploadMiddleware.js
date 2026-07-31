const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const SUPPORT_UPLOAD_ROOT = path.join('uploads', 'support');

if (!fs.existsSync(SUPPORT_UPLOAD_ROOT)) {
    fs.mkdirSync(SUPPORT_UPLOAD_ROOT, { recursive: true });
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

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // The id lands in a filesystem path, so it must be a strict ObjectId and
        // never whatever the URL happened to contain. Routes also mount
        // authorizeTicketAccess ahead of this middleware, so by the time we run
        // the caller is already proven to own the ticket.
        const raw = req.params.id;
        const ticketId = /^[a-f\d]{24}$/i.test(String(raw || '')) ? String(raw) : 'inbox';
        const dir = path.join(SUPPORT_UPLOAD_ROOT, ticketId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
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
    classifyAttachment
};
