// ─────────────────────────────────────────────────────────────────────────────
// NodeRegistry
// ─────────────────────────────────────────────────────────────────────────────
// A singleton Map that holds all registered node implementations.
// The Workflow Engine ONLY calls methods defined by this registry.
//
// Every node must implement:
//   execute(context)   — async, performs the action, returns { output, nextPort }
//   validate(data)     — synchronous, returns { valid: bool, errors: [] }
//   schema()           — returns JSON schema for the config sidebar (UI-only)
//   ports()            — returns { inputs: [], outputs: [] } for canvas rendering
//   meta()             — returns { type, name, icon, category, color }
//
// Adding a new node type: just call NodeRegistry.register(new MyNode())
// The engine itself NEVER needs to be modified to support new node types.
// ─────────────────────────────────────────────────────────────────────────────

class NodeRegistry {
    constructor() {
        this._nodes = new Map(); // key: node.type → value: node instance
    }

    /**
     * Register a node implementation.
     * @param {object} nodeImpl - Must have: type, execute, validate, schema, ports, meta
     */
    register(nodeImpl) {
        if (!nodeImpl.type) throw new Error(`[NodeRegistry] Cannot register node without a 'type' property`);
        if (this._nodes.has(nodeImpl.type)) {
            console.warn(`[NodeRegistry] Overwriting existing node type: ${nodeImpl.type}`);
        }
        this._nodes.set(nodeImpl.type, nodeImpl);
        console.log(`[NodeRegistry] Registered node: ${nodeImpl.type}`);
    }

    /**
     * Get a node implementation by type string.
     * @param {string} type - e.g. 'send_whatsapp'
     * @returns {object} node implementation
     */
    get(type) {
        const node = this._nodes.get(type);
        if (!node) throw new Error(`[NodeRegistry] Unknown node type: "${type}". Did you forget to register it?`);
        return node;
    }

    /**
     * Check if a node type is registered.
     */
    has(type) {
        return this._nodes.has(type);
    }

    /**
     * Return all registered node types with their metadata.
     * Used by the frontend API to build the node panel.
     */
    getAllMeta() {
        const result = [];
        for (const [, node] of this._nodes) {
            result.push(node.meta());
        }
        return result;
    }

    /**
     * Return the JSON schema for a specific node type.
     * Used by the config sidebar to render the appropriate form.
     */
    getSchema(type) {
        return this.get(type).schema();
    }

    /**
     * Return the port definitions for a specific node type.
     */
    getPorts(type) {
        return this.get(type).ports();
    }

    /**
     * Validate a node's data object. Returns { valid, errors }.
     */
    validate(type, data) {
        try {
            return this.get(type).validate(data);
        } catch (err) {
            return { valid: false, errors: [err.message] };
        }
    }
}

// Export singleton — the entire app uses one shared registry
const registry = new NodeRegistry();
module.exports = registry;
