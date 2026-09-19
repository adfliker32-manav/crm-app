// ============================================================
// EMAIL ATTACHMENT LIMITS (client)
// ============================================================
// Mirrors src/utils/emailAttachments.js and the multer guards on the send and
// upload routes. Enforced here too so an oversized file is refused instantly
// instead of after a 25 MB upload.
//
// These are MAIL limits, not storage limits: the Media Library holds documents
// up to 100 MB, but mail servers commonly reject anything past ~25 MB.
// ============================================================

const MB = 1024 * 1024;

export const MAX_FILE_BYTES = 10 * MB;   // per file
export const MAX_TOTAL_BYTES = 25 * MB;  // across one email
export const MAX_FILES = 10;             // per template

// Matches EXT_FOR_MIME in emailTemplateController and ATTACHMENT_MIME_TYPES on
// the send route. Wider than the Media Library allows (GIF/WEBP/CSV are fine in
// an email but are not WhatsApp media), which is exactly why direct upload
// exists alongside the library picker.
export const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
];

export const ACCEPT_ATTR = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv';

export const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const iconForMime = (mimetype = '') => {
    if (mimetype.startsWith('image/')) return 'fa-file-image';
    if (mimetype.includes('pdf')) return 'fa-file-pdf';
    if (mimetype.includes('word') || mimetype.includes('document')) return 'fa-file-word';
    if (mimetype.includes('excel') || mimetype.includes('sheet')) return 'fa-file-excel';
    if (mimetype.includes('presentation') || mimetype.includes('powerpoint')) return 'fa-file-powerpoint';
    if (mimetype.includes('csv')) return 'fa-file-csv';
    if (mimetype.startsWith('text/')) return 'fa-file-lines';
    return 'fa-file';
};

/**
 * Shared guard for "can I add these files/assets to this list?".
 *
 * @param {Array} current  rows already attached or staged ({ size })
 * @param {Array} incoming rows being added ({ name, size, mimetype })
 * @param {object} opts    { checkMime } — MIME is checked for direct uploads,
 *                         not for library picks (the library validated them).
 * @returns {string|null}  an error message, or null when the add is allowed
 */
export const validateAddition = (current, incoming, { checkMime = false } = {}) => {
    if (current.length + incoming.length > MAX_FILES) {
        return `You can attach at most ${MAX_FILES} files.`;
    }
    for (const item of incoming) {
        if (checkMime && item.mimetype && !ALLOWED_MIME_TYPES.includes(item.mimetype)) {
            return `"${item.name}" is not a supported file type. Allowed: PDF, Word, Excel, images, TXT and CSV.`;
        }
        if (item.size > MAX_FILE_BYTES) {
            return `"${item.name}" is ${formatBytes(item.size)} — each file must be under ${MAX_FILE_BYTES / MB} MB.`;
        }
    }
    const total = [...current, ...incoming].reduce((sum, i) => sum + (i.size || 0), 0);
    if (total > MAX_TOTAL_BYTES) {
        return `Attachments would total ${formatBytes(total)}. Keep them under ${MAX_TOTAL_BYTES / MB} MB — most mail servers reject anything larger.`;
    }
    return null;
};
