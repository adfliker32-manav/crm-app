// ─────────────────────────────────────────────────────────────────────────────
// stageRename.js — cascade a pipeline stage rename into the automations that
// reference that stage BY NAME.
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT BUG-08 FIX.
//
// Stages are referenced by their NAME, not their id, everywhere in the workflow
// engine: `Lead.status` is the stage name, `triggerConfig.toStage` is the stage
// name, `update_stage`'s config is the stage name. Renaming a stage rewrote
// `Stage.name` and bulk-rewrote every `Lead.status`, then stopped — leaving every
// automation pointing at a string that no longer exists anywhere.
//
// The failure is completely silent:
//   - `filterMatches` compares the stored filter against the lead's NEW status, so
//     a STAGE_CHANGED workflow stops firing the moment the rename lands and never
//     resumes. It still displays as Published.
//   - an `update_stage` node keeps writing the DEAD name back onto leads, quietly
//     recreating a stage that is no longer in the pipeline.
//   - a `find_leads` node filtered on the old name matches nothing, so a scheduled
//     campaign reports "No Matches" forever.
//
// Only unambiguous references are rewritten. A condition's literal is touched only
// when it is compared against `lead.status`, so a rule matching some other field to
// a string that happens to equal the stage name is left alone.
// ─────────────────────────────────────────────────────────────────────────────

const STAGE_CONFIG_KEYS = ['toStage', 'fromStage', 'stage'];
const STAGE_NODE_TYPES  = new Set(['update_stage', 'find_leads']);

/** Rewrite one filter value, which may be a scalar or an array of names. */
const renameFilterValue = (value, oldName, newName) => {
    if (typeof value === 'string') {
        return value === oldName ? { value: newName, touched: true } : { value, touched: false };
    }
    if (Array.isArray(value)) {
        let touched = false;
        const next = value.map(v => {
            if (v === oldName) { touched = true; return newName; }
            return v;
        });
        return { value: next, touched };
    }
    return { value, touched: false };
};

/**
 * Rewrite every stage reference inside one workflow definition (live fields or a
 * draft). Mutates `def` in place and reports whether anything changed.
 *
 * @param {{triggerConfig?: object, nodes?: Array}} def
 * @returns {boolean} true when at least one reference was rewritten
 */
const renameStageInDefinition = (def, oldName, newName) => {
    if (!def) return false;
    let touched = false;

    const cfg = def.triggerConfig;
    if (cfg && typeof cfg === 'object') {
        for (const key of STAGE_CONFIG_KEYS) {
            if (cfg[key] === undefined || cfg[key] === null) continue;
            const result = renameFilterValue(cfg[key], oldName, newName);
            if (result.touched) { cfg[key] = result.value; touched = true; }
        }
    }

    for (const node of (def.nodes || [])) {
        const data = node?.data;
        if (!data || typeof data !== 'object') continue;

        // update_stage / find_leads both configure a stage by name.
        if (STAGE_NODE_TYPES.has(node.type) && data.stageName === oldName) {
            data.stageName = newName;
            touched = true;
        }

        // A condition or switch comparing lead.status against the old name. Scoped to
        // that variable so an unrelated literal is never rewritten.
        for (const clause of [...(data.conditions || []), ...(data.cases || [])]) {
            if (!clause || clause.variable !== 'lead.status') continue;
            const result = renameFilterValue(clause.value, oldName, newName);
            if (result.touched) { clause.value = result.value; touched = true; }
        }
    }

    return touched;
};

/**
 * Apply the rename across every workflow in a workspace — live definition and any
 * unpublished draft. Never throws: a rename must not fail because a cascade did.
 *
 * @returns {Promise<{scanned:number, updated:number}>}
 */
const cascadeStageRename = async (tenantId, oldName, newName) => {
    const stats = { scanned: 0, updated: 0 };
    if (!tenantId || !oldName || !newName || oldName === newName) return stats;

    try {
        const Workflow = require('../models/Workflow');
        const workflows = await Workflow.find({ tenantId })
            .select('name triggerConfig nodes draft');

        for (const wf of workflows) {
            stats.scanned++;
            const liveTouched  = renameStageInDefinition(wf, oldName, newName);
            const draftTouched = renameStageInDefinition(wf.draft, oldName, newName);
            if (!liveTouched && !draftTouched) continue;

            // triggerConfig and node.data are Mixed — Mongoose cannot see in-place
            // edits to them, so without markModified the save is a silent no-op.
            if (liveTouched) {
                wf.markModified('triggerConfig');
                wf.markModified('nodes');
            }
            if (draftTouched) wf.markModified('draft');

            await wf.save();
            stats.updated++;
            console.log(`[stageRename] Workflow "${wf.name}" updated: "${oldName}" → "${newName}"`);
        }
    } catch (err) {
        console.error('[stageRename] Cascade failed (non-blocking):', err.message);
    }

    return stats;
};

module.exports = { cascadeStageRename, renameStageInDefinition };
