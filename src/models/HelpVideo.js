const mongoose = require('mongoose');

// A contextual help / tutorial video, managed entirely from
// Super Admin → Support → Video Management.
//
// NOTE: intentionally does NOT use saasPlugin — same reasoning as SupportTicket
// and AuditLog. Help content is PLATFORM-level: one library authored by the
// super admin and read by every tenant. Adding agencyId would scope it per
// reseller and leave every client with an empty Help drawer.
//
// MULTIPLE VIDEOS PER TOPIC IS THE DESIGN, NOT AN EDGE CASE.
// There is deliberately no unique index on { module, submodule }: a topic may
// carry a "Getting Started", an "Advanced Guide" and a "Troubleshooting" clip
// at once. `sortOrder` (ascending) picks which one is the primary video the
// drawer opens with; the rest surface as "Related guides". Ties fall back to
// most-recently-updated so a fresh upload is never buried by an old one.
const helpVideoSchema = new mongoose.Schema({
    // Normalised keys — see normalizeHelpKey in src/constants/helpCatalog.js.
    // The controller normalises on BOTH write and read, so a page declaring
    // `customFields` always matches the record stored as `custom-fields`.
    module: {
        type: String,
        required: true,
        trim: true,
        maxlength: 60
    },
    // '' means the record is the module-level overview. That is the fallback the
    // drawer serves when the specific tab has no video of its own yet.
    submodule: {
        type: String,
        default: '',
        trim: true,
        maxlength: 60
    },

    title:       { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, default: '', trim: true, maxlength: 1000 },

    // The complete link exactly as the super admin pasted it. Kept verbatim so
    // the panel shows them what they entered; everything the client renders is
    // derived from `videoId` instead.
    youtubeUrl:  { type: String, required: true, trim: true, maxlength: 500 },

    // Derived from youtubeUrl at write time by src/utils/youtubeUrl.js. Cached
    // here so a read never has to re-parse, and so a record whose link somehow
    // stopped resolving is easy to spot.
    videoId:     { type: String, default: '', trim: true, maxlength: 20 },

    isActive:  { type: Boolean, default: true },
    sortOrder: { type: Number,  default: 0, min: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

// The one query the Help drawer makes on every open: active videos for a module,
// in display order. submodule is matched in memory from this same result set so
// the fallback to the module-level video costs no extra round trip.
//
// `updatedAt` is part of the key on purpose. The query sorts by
// { sortOrder: 1, updatedAt: -1 }, and a sort is only served by an index when it
// matches the keys that follow the equality predicates — so an index ending at
// sortOrder left MongoDB adding a blocking in-memory SORT stage on every open.
// Harmless on a library this size, but the index costs nothing on a collection
// measured in tens of kilobytes, and this keeps it covered however large the
// library grows.
helpVideoSchema.index({ module: 1, isActive: 1, sortOrder: 1, updatedAt: -1 });

// Admin list screen: browse/filter by topic.
helpVideoSchema.index({ module: 1, submodule: 1, sortOrder: 1 });

module.exports = mongoose.model('HelpVideo', helpVideoSchema);
