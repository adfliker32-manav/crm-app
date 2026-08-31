/**
 * Server-rendered HTML for the OAuth authorization page.
 *
 * When Claude.ai's browser connector redirects the user here, they see a
 * branded page asking for their MCP API key. On submit, the server validates
 * the key and redirects back to Claude.ai with an authorization code.
 *
 * This is a plain HTML template — no React needed since it's a one-time
 * server-side flow, not part of the SPA.
 */

const renderAuthorizePage = ({ error, clientName, client_id, redirect_uri, state, code_challenge, code_challenge_method } = {}) => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authorize — adfliker CRM</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            color: #e2e8f0;
        }

        .card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 20px;
            padding: 40px 36px;
            max-width: 440px;
            width: 100%;
            box-shadow: 0 25px 60px rgba(0,0,0,0.4);
        }

        .logo {
            width: 56px;
            height: 56px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            font-size: 24px;
            color: white;
            font-weight: 800;
        }

        h1 {
            text-align: center;
            font-size: 22px;
            font-weight: 700;
            color: #f1f5f9;
            margin-bottom: 6px;
        }

        .subtitle {
            text-align: center;
            font-size: 14px;
            color: #94a3b8;
            margin-bottom: 28px;
            line-height: 1.5;
        }

        .client-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #334155;
            border: 1px solid #475569;
            padding: 6px 14px;
            border-radius: 100px;
            font-size: 12px;
            color: #cbd5e1;
            margin: 0 auto 24px;
            width: fit-content;
        }

        .client-badge::before {
            content: '🤖';
        }

        label {
            display: block;
            font-size: 13px;
            font-weight: 600;
            color: #cbd5e1;
            margin-bottom: 8px;
        }

        input[type="password"], input[type="text"] {
            width: 100%;
            padding: 14px 16px;
            border: 1px solid #475569;
            border-radius: 12px;
            background: #0f172a;
            color: #e2e8f0;
            font-size: 14px;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        input:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        input::placeholder {
            color: #64748b;
            font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        }

        .hint {
            font-size: 11px;
            color: #64748b;
            margin-top: 8px;
            line-height: 1.5;
        }

        .btn {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            margin-top: 20px;
            transition: all 0.2s;
        }

        .btn-primary {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: white;
            box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
        }

        .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
        }

        .btn-primary:active {
            transform: translateY(0);
        }

        .error-box {
            background: #451a1a;
            border: 1px solid #7f1d1d;
            color: #fca5a5;
            padding: 12px 16px;
            border-radius: 12px;
            font-size: 13px;
            margin-bottom: 20px;
            line-height: 1.5;
        }

        .error-box::before {
            content: '⚠️ ';
        }

        .security-note {
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid #334155;
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }

        .security-note .icon {
            flex-shrink: 0;
            font-size: 16px;
            margin-top: 1px;
        }

        .security-note p {
            font-size: 11px;
            color: #64748b;
            line-height: 1.6;
        }

        .toggle-visibility {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: #64748b;
            cursor: pointer;
            font-size: 14px;
            padding: 4px;
        }

        .input-wrapper {
            position: relative;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">A</div>
        <h1>Authorize Connection</h1>
        <p class="subtitle">
            Allow Claude AI to access your CRM data<br>through the adfliker MCP server.
        </p>

        ${clientName ? `<div style="text-align:center"><div class="client-badge">${escapeHtml(clientName)}</div></div>` : ''}

        ${error ? `<div class="error-box">${escapeHtml(error)}</div>` : ''}

        <form method="POST" action="/oauth/authorize" autocomplete="off">
            <input type="hidden" name="client_id" value="${escapeHtml(client_id || '')}">
            <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri || '')}">
            <input type="hidden" name="state" value="${escapeHtml(state || '')}">
            <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge || '')}">
            <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method || 'S256')}">

            <label for="mcp_api_key">MCP API Key</label>
            <div class="input-wrapper">
                <input
                    type="password"
                    id="mcp_api_key"
                    name="mcp_api_key"
                    placeholder="mcp_xxxxxxxxxxxxxxxx..."
                    required
                    autofocus
                    minlength="52"
                    maxlength="52"
                >
            </div>
            <p class="hint">
                Find this in your CRM → Settings → Claude AI → Generate Key.
            </p>

            <button type="submit" class="btn btn-primary">
                Authorize Claude AI
            </button>
        </form>

        <div class="security-note">
            <span class="icon">🔒</span>
            <p>
                Your API key is sent securely and is never stored by Claude.ai.
                You can revoke access any time from your CRM settings.
            </p>
        </div>
    </div>

    <script>
        // Prevent double-submit
        document.querySelector('form').addEventListener('submit', function(e) {
            const btn = this.querySelector('button[type="submit"]');
            if (btn.disabled) { e.preventDefault(); return; }
            btn.disabled = true;
            btn.textContent = 'Authorizing...';
        });
    </script>
</body>
</html>`;
};

/** Escape HTML entities to prevent XSS in server-rendered template. */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = { renderAuthorizePage };
