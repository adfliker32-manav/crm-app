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
        schema.pre(type, function(next) {
            // Check if user specifically requested to ignore soft deletes via .setOptions({ includeDeleted: true })
            if (this.getOptions().includeDeleted !== true) {
                // If they didn't explicitly query deletedAt, hide deleted documents to prevent data leakage
                if (this.getFilter().deletedAt === undefined) {
                    this.where({ deletedAt: null });
                }
            }
            next();
        });
    });

    // Pre-aggregate middleware to filter soft deletes from complex pipelines
    schema.pre('aggregate', function(next) {
        // Exclude soft-deleted records from standard aggregations if not explicitly included
        if (!this.options.includeDeleted) {
            this.pipeline().unshift({ $match: { deletedAt: null } });
        }
        next();
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
