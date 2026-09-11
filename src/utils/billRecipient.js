// src/utils/billRecipient.js
//
// Resolves "who is this agency bill for".
//
// WHY THIS EXISTS
//   AgencyPayment.agencyClientId is null on a custom bill raised for a one-off
//   customer who was never saved as an AgencyClient. Two things then go wrong if
//   callers look the client up themselves:
//
//   1. `AgencyClient.findById(undefined)` does NOT return null — Mongoose drops the
//      empty filter and returns the FIRST document in the collection. A client-less
//      bill would silently resolve to an unrelated client and be emailed to them.
//   2. Every caller that guards with `if (!client) return` would simply skip the
//      one-off bill, so it could never be emailed, chased or receipted.
//
//   Both are solved in one place here: the id is null-checked before the query, and
//   a custom bill falls back to the contact details captured on the bill itself.

const AgencyClient = require('../models/AgencyClient');

/**
 * Look up an AgencyClient without the findById(undefined) footgun.
 * @param {*} id            agencyClientId, possibly null/undefined
 * @param {string} [select] optional projection
 * @returns {Promise<object|null>}
 */
const findClientById = async (id, select = null) => {
    if (!id) return null;
    const q = AgencyClient.findById(id);
    if (select) q.select(select);
    return q.lean();
};

/**
 * The billing contact for a payment: the saved client when there is one, otherwise
 * the details typed onto a custom bill. Shaped like an AgencyClient so existing
 * callers (billing emails, WhatsApp reminders, receipts) need no other change.
 *
 * Returns null only when there is genuinely nobody to bill — a non-custom payment
 * whose client row has been deleted.
 *
 * @param {object} payment AgencyPayment (lean or hydrated)
 * @returns {Promise<object|null>}
 */
const resolveBillRecipient = async (payment) => {
    if (!payment) return null;

    const client = await findClientById(payment.agencyClientId);
    if (client) return client;

    if (!payment.isCustomBill) return null;

    return {
        _id:            null,
        name:           payment.clientName || '',
        company:        payment.clientCompany || '',
        email:          payment.clientEmail || '',
        phone:          payment.clientPhone || '',
        billingAddress: payment.billingAddressSnapshot || '',
        gstNumber:      payment.gstNumberSnapshot || '',
        serviceType:    payment.clientServiceType || 'other',
        // Marks a synthesised recipient, so a caller that wants to write back to the
        // client record knows there is no row to write to.
        isOneOff:       true
    };
};

module.exports = { findClientById, resolveBillRecipient };
