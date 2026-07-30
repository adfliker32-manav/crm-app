// tests/email/helpers/stub.js
//
// Minimal module-stubbing + fake-model helpers so the email services can be
// exercised without Mongo, Redis, SMTP or IMAP. Uses require.cache injection —
// no test framework or extra dependency required.

const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

/**
 * Replaces a module's exports before the module under test requires it.
 * Must be called BEFORE requiring the subject.
 */
function stub(relativeFromSrc, exports) {
    const resolved = require.resolve(path.join(SRC, relativeFromSrc));
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports
    };
    return exports;
}

/** Drops a module from the cache so the next require re-evaluates it. */
function unstub(relativeFromSrc) {
    const resolved = require.resolve(path.join(SRC, relativeFromSrc));
    delete require.cache[resolved];
}

// ── Tiny query-matcher supporting the operators these services actually use ──
function matches(doc, query) {
    return Object.entries(query || {}).every(([key, cond]) => {
        const value = key.split('.').reduce((o, k) => (o == null ? o : o[k]), doc);

        if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
            if ('$gt' in cond)  return String(value) > String(cond.$gt);
            if ('$gte' in cond) return value >= cond.$gte;
            if ('$lt' in cond)  return value < cond.$lt;
            if ('$in' in cond)  return cond.$in.some(v => String(v) === String(value));
            if ('$nin' in cond) return !cond.$nin.some(v => String(v) === String(value));
            if ('$ne' in cond)  return String(value) !== String(cond.$ne);
            if ('$exists' in cond) return (value !== undefined) === cond.$exists;
        }
        if (cond instanceof RegExp) return cond.test(String(value ?? ''));
        if (value && value.equals && cond) return String(value) === String(cond);
        return String(value) === String(cond);
    });
}

function applyUpdate(doc, update) {
    if (update.$set) Object.entries(update.$set).forEach(([k, v]) => setDeep(doc, k, v));
    if (update.$setOnInsert) { /* only on insert — handled by caller */ }
    if (update.$inc) {
        Object.entries(update.$inc).forEach(([k, v]) => {
            const cur = k.split('.').reduce((o, key) => (o == null ? o : o[key]), doc) || 0;
            setDeep(doc, k, cur + v);
        });
    }
    return doc;
}

function setDeep(obj, dotted, value) {
    const parts = dotted.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

let idCounter = 0;
const nextId = () => `id_${++idCounter}_${'0'.repeat(10)}`.slice(0, 24);

/**
 * Builds a fake mongoose model backed by an array.
 * Supports the subset of the API the email services use.
 */
function makeModel(seed = []) {
    const store = seed.map(d => ({ ...d, _id: d._id || nextId() }));

    // Chainable query object — sort/skip/limit/select/populate/lean all no-op
    // except for ordering and slicing, then resolve to the result array.
    const chain = (resultFn) => {
        const q = {
            _sort: null, _limit: null, _skip: 0,
            sort(s) { q._sort = s; return q; },
            limit(n) { q._limit = n; return q; },
            skip(n) { q._skip = n; return q; },
            select() { return q; },
            populate() { return q; },
            lean() { return q; },
            then(res, rej) { return q.exec().then(res, rej); },
            catch(rej) { return q.exec().catch(rej); },
            exec() {
                let out = resultFn();
                if (q._sort) {
                    const [key, dir] = Object.entries(q._sort)[0];
                    out = [...out].sort((a, b) => {
                        const av = key.split('.').reduce((o, k) => o?.[k], a);
                        const bv = key.split('.').reduce((o, k) => o?.[k], b);
                        if (av === bv) return 0;
                        return (av > bv ? 1 : -1) * (dir === -1 ? -1 : 1);
                    });
                }
                if (q._skip) out = out.slice(q._skip);
                if (q._limit != null) out = out.slice(0, q._limit);
                return Promise.resolve(out);
            }
        };
        return q;
    };

    function Model(doc) {
        Object.assign(this, doc);
        if (!this._id) this._id = nextId();
        this.save = async () => {
            const existing = store.findIndex(d => String(d._id) === String(this._id));
            const plain = { ...this };
            delete plain.save;
            delete plain.toObject;
            if (existing >= 0) store[existing] = plain; else store.push(plain);
            return this;
        };
        this.toObject = () => {
            const o = { ...this };
            delete o.save; delete o.toObject;
            return o;
        };
    }

    Model.__store = store;
    Model.find = (q = {}) => chain(() => store.filter(d => matches(d, q)));
    // Mongoose returns hydrated documents with .save(); the store holds plain
    // objects. Attach save non-enumerably so assertions on __store stay clean.
    const hydrate = (doc) => {
        if (!doc || typeof doc.save === 'function') return doc;
        Object.defineProperty(doc, 'save', {
            value: async () => doc, // store holds the same reference — already written
            enumerable: false,
            configurable: true
        });
        Object.defineProperty(doc, 'toObject', {
            value: () => ({ ...doc }),
            enumerable: false,
            configurable: true
        });
        return doc;
    };

    // findOne resolves to a single document (or null) — not an array — so it
    // needs its own thenable rather than reusing the list chain.
    Model.findOne = (q = {}) => {
        const found = hydrate(store.find(d => matches(d, q)) || null);
        const c = {
            sort: () => c,
            select: () => c,
            populate: () => c,
            lean: () => c,
            exec: () => Promise.resolve(found),
            then: (res, rej) => Promise.resolve(found).then(res, rej),
            catch: (rej) => Promise.resolve(found).catch(rej)
        };
        return c;
    };
    Model.findById = (id) => Model.findOne({ _id: id });
    Model.exists = async (q) => {
        const d = store.find(x => matches(x, q));
        return d ? { _id: d._id } : null;
    };
    Model.countDocuments = async (q = {}) => store.filter(d => matches(d, q)).length;
    Model.create = async (doc) => {
        const created = { ...doc, _id: doc._id || nextId() };
        store.push(created);
        return { ...created, toObject: () => created };
    };
    Model.updateOne = async (q, update, opts = {}) => {
        const idx = store.findIndex(d => matches(d, q));
        if (idx >= 0) { applyUpdate(store[idx], update); return { matchedCount: 1, modifiedCount: 1 }; }
        if (opts.upsert) {
            const doc = { _id: nextId(), ...(update.$setOnInsert || {}), ...(update.$set || {}) };
            store.push(doc);
            return { matchedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
    };
    Model.updateMany = async (q, update) => {
        let n = 0;
        store.forEach(d => { if (matches(d, q)) { applyUpdate(d, update); n++; } });
        return { modifiedCount: n };
    };
    Model.findOneAndUpdate = async (q, update, opts = {}) => {
        let idx = store.findIndex(d => matches(d, q));
        if (idx < 0 && opts.upsert) {
            const doc = { _id: nextId(), ...(update.$setOnInsert || {}) };
            store.push(doc);
            idx = store.length - 1;
        }
        if (idx < 0) return null;
        applyUpdate(store[idx], update);
        const result = store[idx];
        return { ...result, toObject: () => result };
    };
    Model.findByIdAndUpdate = async (id, update, opts) => Model.findOneAndUpdate({ _id: id }, update, opts);
    Model.deleteOne = async (q) => {
        const idx = store.findIndex(d => matches(d, q));
        if (idx < 0) return { deletedCount: 0 };
        store.splice(idx, 1);
        return { deletedCount: 1 };
    };

    return Model;
}

module.exports = { stub, unstub, makeModel, matches, nextId };
