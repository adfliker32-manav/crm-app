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

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB — video cap; images naturally smaller

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const ticketId = req.params.id || 'inbox';
        const dir = path.join(SUPPORT_UPLOAD_ROOT, ticketId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).slice(0, 8);
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
