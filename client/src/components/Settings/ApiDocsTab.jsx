import React from 'react';

const ApiDocsTab = ({ apiKey }) => {
    const API_BASE = typeof window !== 'undefined'
        ? `${window.location.origin}/api/v1`
        : 'https://app.adfliker.com/api/v1';

    const renderCode = (code) => (
        <div style={styles.codeBlock}>
            <pre style={styles.pre}>{code}</pre>
        </div>
    );

    const Endpoint = ({ method, path, title, description, body, response }) => (
        <div style={styles.endpointCard}>
            <div style={styles.endpointHeader}>
                <span style={{
                    ...styles.methodBadge,
                    background: METHOD_COLORS[method]?.bg || '#f1f5f9',
                    color: METHOD_COLORS[method]?.color || '#475569',
                    borderColor: METHOD_COLORS[method]?.border || '#cbd5e1'
                }}>{method}</span>
                <code style={styles.endpointPath}>{API_BASE}{path}</code>
            </div>
            <div style={styles.endpointBody}>
                <h4 style={styles.endpointTitle}>{title}</h4>
                <p style={styles.endpointDesc}>{description}</p>
                
                {body && (
                    <div style={styles.section}>
                        <div style={styles.sectionTitle}>Request Body</div>
                        {renderCode(body)}
                    </div>
                )}
                
                {response && (
                    <div style={styles.section}>
                        <div style={styles.sectionTitle}>Example Response</div>
                        {renderCode(response)}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div style={styles.container}>
            <div style={styles.headerBox}>
                <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#1e293b' }}>API Reference</h2>
                <p style={{ margin: 0, color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
                    The External API allows you to connect third-party CRMs (like HubSpot or Salesforce), custom applications, and websites directly to this workspace. You can programmatically create leads, trigger automations, and send WhatsApp messages.
                </p>
            </div>

            <div style={styles.infoGrid}>
                <div style={styles.infoBox}>
                    <h4 style={styles.infoTitle}>🔐 Authentication</h4>
                    <p style={styles.infoText}>
                        Pass your API key in the header of every request:
                    </p>
                    <code style={styles.inlineCode}>x-api-key: {apiKey || 'ext_xxxxxxxxxxxxxxxx'}</code>
                </div>
                <div style={styles.infoBox}>
                    <h4 style={styles.infoTitle}>⚡ Rate Limits</h4>
                    <ul style={styles.list}>
                        <li>30 requests per minute</li>
                        <li>500 requests per day</li>
                    </ul>
                    <p style={styles.infoText}>Exceeding this returns HTTP 429.</p>
                </div>
            </div>

            <h3 style={styles.subHeading}>Endpoints</h3>

            <Endpoint
                method="POST"
                path="/leads"
                title="Create a Lead"
                description="Creates a new lead. Note: This automatically triggers any active automation rules (like welcome WhatsApps)."
                body={`{
  "name": "John Doe",
  "phone": "+1234567890",
  "email": "john@example.com",
  "status": "New",
  "source": "Facebook Ads",
  "dealValue": 1500,
  "tags": ["urgent", "b2b"]
}`}
                response={`{
  "success": true,
  "data": {
    "id": "60d5ecb54...2b2",
    "name": "John Doe",
    "status": "New",
    "source": "Facebook Ads"
  }
}`}
            />

            <Endpoint
                method="GET"
                path="/leads?page=1&limit=25"
                title="List Leads"
                description="Fetch a paginated list of leads. You can filter by status, source, or search by name."
                response={`{
  "success": true,
  "data": [ ... ],
  "total": 150,
  "page": 1,
  "limit": 25,
  "pages": 6
}`}
            />

            <Endpoint
                method="PUT"
                path="/leads/:id"
                title="Update a Lead"
                description="Update specific fields or move a lead to a new stage in your pipeline."
                body={`{
  "status": "Follow Up",
  "dealValue": 2000
}`}
            />

            <Endpoint
                method="POST"
                path="/whatsapp/send"
                title="Send WhatsApp Message (Text)"
                description="Send a direct WhatsApp text message to a lead or a specific phone number."
                body={`{
  "phone": "+1234567890",
  "message": "Hi John, are we still on for our meeting today?"
}`}
            />

            <Endpoint
                method="POST"
                path="/whatsapp/template"
                title="Send WhatsApp Template"
                description="Send a pre-approved Meta WhatsApp template. Variables are auto-resolved if you provide a leadId."
                body={`{
  "phone": "+1234567890",
  "templateName": "appointment_reminder",
  "languageCode": "en_US"
}`}
            />

            <Endpoint
                method="POST"
                path="/appointments"
                title="Create Appointment"
                description="Schedule a new appointment on the calendar."
                body={`{
  "customerName": "Jane Smith",
  "customerPhone": "+1987654321",
  "appointmentDate": "2026-07-15",
  "appointmentTime": "14:30",
  "serviceType": "Consultation"
}`}
            />

            <div style={{ marginTop: 40 }}>
                <h3 style={styles.subHeading}>Error Handling</h3>
                <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
                    Failed requests return standard HTTP status codes (400, 401, 403, 404, 429, 500) and a structured JSON error payload.
                </p>
                {renderCode(`{
  "success": false,
  "error": "invalid_api_key",
  "message": "Missing or invalid API key. Set the x-api-key header."
}`)}
            </div>
        </div>
    );
};

const METHOD_COLORS = {
    GET:    { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
    POST:   { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
    PUT:    { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
    DELETE: { bg: '#fce4ec', color: '#b71c1c', border: '#f48fb1' },
};

const styles = {
    container: {
        padding: '0 8px 32px'
    },
    headerBox: {
        marginBottom: 24
    },
    infoGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
        marginBottom: 32
    },
    infoBox: {
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: 20
    },
    infoTitle: {
        margin: '0 0 12px',
        fontSize: 15,
        color: '#1e293b'
    },
    infoText: {
        margin: '0 0 12px',
        fontSize: 13,
        color: '#64748b',
        lineHeight: 1.5
    },
    inlineCode: {
        fontFamily: 'monospace',
        background: '#e2e8f0',
        padding: '4px 8px',
        borderRadius: 6,
        fontSize: 12,
        color: '#334155',
        display: 'inline-block',
        wordBreak: 'break-all'
    },
    list: {
        margin: '0 0 12px',
        paddingLeft: 20,
        fontSize: 13,
        color: '#64748b',
        lineHeight: 1.6
    },
    subHeading: {
        margin: '0 0 20px',
        fontSize: 18,
        color: '#1e293b',
        borderBottom: '2px solid #f1f5f9',
        paddingBottom: 8
    },
    endpointCard: {
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        marginBottom: 20,
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
    },
    endpointHeader: {
        background: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12
    },
    methodBadge: {
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: 'monospace',
        border: '1px solid'
    },
    endpointPath: {
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#334155',
        wordBreak: 'break-all'
    },
    endpointBody: {
        padding: 20
    },
    endpointTitle: {
        margin: '0 0 8px',
        fontSize: 15,
        color: '#1e293b'
    },
    endpointDesc: {
        margin: '0 0 20px',
        fontSize: 14,
        color: '#64748b',
        lineHeight: 1.5
    },
    section: {
        marginBottom: 16
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: 600,
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: 8
    },
    codeBlock: {
        background: '#1e293b',
        borderRadius: 8,
        overflow: 'hidden'
    },
    pre: {
        margin: 0,
        padding: 16,
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#e2e8f0',
        lineHeight: 1.5,
        overflowX: 'auto'
    }
};

export default ApiDocsTab;
