// ─────────────────────────────────────────────────────────────────────────────
// voiceOutcomePorts.js — SINGLE SOURCE OF TRUTH for AI Voice Call outcome ports
// ─────────────────────────────────────────────────────────────────────────────
// BUG #8 FIX: The voice webhook (VoiceEngineService) writes free-form outcome
// strings such as 'No Answer / Failed' and 'Disconnection: dial_no_answer', then
// passed them straight through as the `resolvedPort` when resolving the VOICE_OUTCOME
// wait signal. WorkflowEngine.resolveWaitSignal matches ports EXACTLY (no fallback),
// so those strings matched no canvas port and the execution silently completed —
// the "No Answer" / "Busy" / "Call Failed" branches never fired on real calls.
//
// This module defines the canonical port ids (consumed by VoiceCallNode.ports())
// and a mapper that normalises any raw outcome/status into one of those ports.
// ─────────────────────────────────────────────────────────────────────────────

// Canonical output port ids for the VoiceCallNode. Order/labels rendered by the canvas.
const VOICE_OUTCOME_PORTS = [
    { id: 'Appointment Booked', label: 'Appointment Booked' },
    { id: 'Interested',         label: 'Interested' },
    { id: 'Not Interested',     label: 'Not Interested' },
    { id: 'Busy',               label: 'Busy / Retry' },
    { id: 'No Answer',          label: 'No Answer' },
    { id: 'error',              label: 'Call Failed' }
];

const VALID_PORT_IDS = VOICE_OUTCOME_PORTS.map(p => p.id);

/**
 * Normalise a raw voice outcome string (from the AI structured data OR a
 * code-generated status fallback) into one of the canonical VoiceCallNode ports.
 * Always returns a valid port id so the workflow branch actually fires.
 *
 * @param {string} [rawOutcome] — e.g. 'Interested', 'No Answer / Failed', 'Disconnection: dial_no_answer'
 * @returns {string} one of VALID_PORT_IDS
 */
const mapVoiceOutcomeToPort = (rawOutcome) => {
    if (!rawOutcome) return 'No Answer';

    const trimmed = String(rawOutcome).trim();

    // 1. Exact (case-insensitive) match to a real port — the happy path where the
    //    AI already returned a valid category like 'Interested'.
    const exact = VALID_PORT_IDS.find(id => id.toLowerCase() === trimmed.toLowerCase());
    if (exact) return exact;

    // 2. Keyword mapping for free-form / code-generated strings.
    //    NOTE: check 'not interested' BEFORE 'interested' (substring collision).
    const o = trimmed.toLowerCase();
    if (o.includes('appointment') || o.includes('booked'))          return 'Appointment Booked';
    if (o.includes('not interested') || o.includes('uninterested')) return 'Not Interested';
    if (o.includes('interested'))                                   return 'Interested';
    if (o.includes('busy'))                                         return 'Busy';
    if (o.includes('no answer') || o.includes('no-answer') ||
        o.includes('voicemail') || o.includes('disconnection'))     return 'No Answer';
    if (o.includes('fail') || o.includes('error'))                  return 'error';

    // 3. Unknown outcome — route to 'No Answer' (the node's own timeout default)
    //    rather than dropping the execution silently.
    return 'No Answer';
};

module.exports = { VOICE_OUTCOME_PORTS, VALID_PORT_IDS, mapVoiceOutcomeToPort };
