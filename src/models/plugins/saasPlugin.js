const mongoose = require('mongoose');

/**
 * Core SaaS Plugin for Mongoose Models.
 * Injects multi-tenancy reference (agencyId) and soft-delete architecture (deletedAt) globally.
 */
module.exports = function saasPlugin(schema, options) {
    // 1. Inject SaaS Fields into Schema
    schema.add({
        agencyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            index: true,
            default: null // Null means direct-to-platform (SuperAdmin/Grandfathered clients)
        },
        deletedAt: {
            type: Date,
            default: null,
            index: true
        }
    });

    // 2. Overload Query Mappers for Soft Delete Isolation
    const typesToOverride = ['find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'updateMany'];
    
    typesToOverride.forEach(type => {
        schema.pre(type, function() {
            // Check if user specifically requested to ignore soft deletes via .setOptions({ includeDeleted: true })
            if (this.getOptions().includeDeleted !== true) {
                // If they didn't explicitly query deletedAt, hide deleted documents to prevent data leakage
                if (this.getFilter().deletedAt === undefined) {
                    this.where({ deletedAt: null });
                }
            }
        });
    });

    // Pre-aggregate middleware to filter soft deletes from complex pipelines
    schema.pre('aggregate', function() {
        // FIX 4.2: In Mongoose 6.x/7.x, aggregate options live on `this._userOptions`, NOT `this.options`.
        // The old check `this.options.includeDeleted` always evaluates to undefined/falsy,
        // meaning soft-deleted records could leak into every analytics/report aggregation.
        // We check both accessors for full backward compatibility.
        const opts = this._userOptions || this.options || {};
        if (!opts.includeDeleted) {
            this.pipeline().unshift({ $match: { deletedAt: null } });
        }
    });

    // 3. Document Instance Methods
    schema.methods.softDelete = function() {
        this.deletedAt = new Date();
        return this.save();
    };
    
    schema.methods.restore = function() {
        this.deletedAt = null;
        return this.save();
    };
};
