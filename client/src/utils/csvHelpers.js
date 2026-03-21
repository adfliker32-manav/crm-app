// Determines the most likely CRM field for a given CSV header string
export const autoMapColumn = (header, currentMappings) => {
    const h = (header || '').toString().toLowerCase().trim();
    
    if (h.includes('name') && !currentMappings.name) return 'name';
    if ((h.includes('phone') || h.includes('mobile')) && !currentMappings.phone) return 'phone';
    if ((h.includes('email') || h.includes('e-mail')) && !currentMappings.email) return 'email';
    if (h.includes('source') && !currentMappings.source) return 'source';
    if ((h.includes('status') || h.includes('stage')) && !currentMappings.status) return 'status';
    
    return null;
};

// Normalises phone number by stripping all non-numeric characters except a leading +
export const normalizePhoneNumber = (phone) => {
    if (!phone) return '';
    const phoneStr = phone.toString();
    // Allow leading plus, strip all other non-digits
    const isPlus = phoneStr.startsWith('+');
    const digitsOnly = phoneStr.replace(/\D/g, '');
    return isPlus ? `+${digitsOnly}` : digitsOnly;
};

// Transforms and validates a raw CSV row into a format ready for the CRM API
export const transformLeadRow = (row, mappings, stages = []) => {
    const lead = {
        name: row[mappings.name] ? row[mappings.name].trim() : 'Unknown',
        phone: row[mappings.phone] || '',
        email: mappings.email && row[mappings.email] ? row[mappings.email].trim() : '',
        source: mappings.source && row[mappings.source] ? row[mappings.source].trim() : 'CSV Import',
        status: mappings.status && row[mappings.status] ? row[mappings.status].trim() : 'New',
        customData: {} // Future stub for custom field mapped extraction
    };

    lead.phone = normalizePhoneNumber(lead.phone);

    // Validate stage against existing CRM stages
    // We optionally keep standard stages to avoid creating garbage strings 
    if (lead.status !== 'New' && stages.length > 0) {
        const isValidStage = stages.some(s => s.name.toLowerCase() === lead.status.toLowerCase());
        // If the backend accepts any string, we can let it pass, else default to 'New'
        // Currently leaving it as the user mapped it to support dynamic mapping
    }

    return lead;
};
