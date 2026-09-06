// Proper scope analysis: find identifiers that are READ but never declared in any
// enclosing scope and are not known globals. This is what catches a variable
// stranded when a function is split in two — `node --check` only sees syntax.
const acorn = require('acorn');
const fs = require('fs');

const GLOBALS = new Set([
    'require','module','exports','process','console','Buffer','__dirname','__filename',
    'setTimeout','clearTimeout','setInterval','clearInterval','setImmediate','queueMicrotask',
    'Promise','Object','Array','String','Number','Boolean','Date','Math','JSON','Map','Set',
    'WeakMap','WeakSet','Error','TypeError','RangeError','ReferenceError','SyntaxError',
    'RegExp','Symbol','Proxy','Reflect','BigInt','Infinity','NaN','undefined','globalThis',
    'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
    'URL','URLSearchParams','TextEncoder','TextDecoder','AbortController','fetch','structuredClone',
    'Intl','Float32Array','Float64Array','Int8Array','Uint8Array','Int32Array','Uint32Array','ArrayBuffer'
]);

function analyse(file) {
    const src = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true });

    const problems = [];

    // A scope = { parent, names:Set, node }
    const mkScope = (parent) => ({ parent, names: new Set() });
    const root = mkScope(null);

    const declare = (scope, name) => { if (name) scope.names.add(name); };

    const declarePattern = (scope, pat) => {
        if (!pat) return;
        switch (pat.type) {
            case 'Identifier': declare(scope, pat.name); break;
            case 'ObjectPattern':
                for (const p of pat.properties) {
                    if (p.type === 'RestElement') declarePattern(scope, p.argument);
                    else declarePattern(scope, p.value);
                }
                break;
            case 'ArrayPattern':
                for (const e of pat.elements) if (e) declarePattern(scope, e);
                break;
            case 'AssignmentPattern': declarePattern(scope, pat.left); break;
            case 'RestElement': declarePattern(scope, pat.argument); break;
        }
    };

    // Pass 1: hoist all declarations into their scopes.
    const scopeOf = new Map();

    const walk = (node, scope) => {
        if (!node || typeof node.type !== 'string') return;
        scopeOf.set(node, scope);

        let inner = scope;
        if (node.type === 'FunctionDeclaration') {
            declare(scope, node.id && node.id.name);
            inner = mkScope(scope);
            for (const p of node.params) declarePattern(inner, p);
            declare(inner, 'arguments');
        } else if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
            inner = mkScope(scope);
            if (node.id) declare(inner, node.id.name);
            for (const p of node.params) declarePattern(inner, p);
            if (node.type !== 'ArrowFunctionExpression') declare(inner, 'arguments');
        } else if (node.type === 'BlockStatement' || node.type === 'ForStatement' ||
                   node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
            inner = mkScope(scope);
        } else if (node.type === 'CatchClause') {
            inner = mkScope(scope);
            declarePattern(inner, node.param);
        } else if (node.type === 'ClassDeclaration') {
            declare(scope, node.id && node.id.name);
        }

        if (node.type === 'VariableDeclaration') {
            for (const d of node.declarations) declarePattern(scope, d.id);
        }

        for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
            const child = node[key];
            if (Array.isArray(child)) child.forEach(c => walk(c, inner));
            else if (child && typeof child.type === 'string') walk(child, inner);
        }
    };
    walk(ast, root);

    // Pass 2: resolve every read.
    const resolve = (scope, name) => {
        let s = scope;
        while (s) { if (s.names.has(name)) return true; s = s.parent; }
        return GLOBALS.has(name);
    };

    const check = (node, parent) => {
        if (!node || typeof node.type !== 'string') return;

        if (node.type === 'Identifier') {
            const skip =
                (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
                (parent && parent.type === 'Property' && parent.key === node && !parent.computed) ||
                (parent && (parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' ||
                            parent.type === 'ArrowFunctionExpression' || parent.type === 'ClassDeclaration') &&
                 (parent.id === node || (parent.params || []).includes(node))) ||
                (parent && parent.type === 'VariableDeclarator' && parent.id === node) ||
                (parent && parent.type === 'MethodDefinition');

            if (!skip) {
                const sc = scopeOf.get(node) || root;
                if (!resolve(sc, node.name)) {
                    problems.push(`${node.name} (line ${node.loc.start.line})`);
                }
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue;
            const child = node[key];
            if (Array.isArray(child)) child.forEach(c => check(c, node));
            else if (child && typeof child.type === 'string') check(child, node);
        }
    };
    check(ast, null);

    return [...new Set(problems)];
}

module.exports = { analyse };
