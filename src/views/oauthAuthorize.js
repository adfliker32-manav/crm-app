/**
 * Server-rendered sign-in + consent page for the MCP OAuth flow.
 *
 * Claude (web, desktop or Claude Code) opens this page in the user's browser.
 * The workspace owner signs in with their normal CRM email + password — or, for
 * Google-login accounts that have no password, their MCP API key — and approves
 * the connection. The server then redirects back to Claude with a one-time code.
 *
 * Plain HTML on purpose: it is a one-off server-side step, not part of the SPA,
 * and must work with no JS bundle loaded. Every interpolated value is escaped.
 */

function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const STYLES = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
        background: #f1f5f9; min-height: 100vh; display: flex; align-items: center;
        justify-content: center; padding: 24px 16px; color: #0f172a;
    }
    .card {
        background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 32px 28px;
        max-width: 420px; width: 100%; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
    }
    .logo {
        width: 48px; height: 48px; border-radius: 14px; margin: 0 auto 16px;
        background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff;
        display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800;
    }
    h1 { text-align: center; font-size: 20px; font-weight: 700; margin-bottom: 6px; }
    .subtitle { text-align: center; font-size: 14px; color: #475569; line-height: 1.5; margin-bottom: 20px; }
    .subtitle strong { color: #0f172a; }
    .perm { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; margin-bottom: 20px; }
    .perm p { font-size: 12px; color: #475569; line-height: 1.6; }
    .perm p + p { margin-top: 4px; }
    .tabs { display: flex; gap: 6px; background: #f1f5f9; padding: 4px; border-radius: 10px; margin-bottom: 16px; }
    .tabs label {
        flex: 1; text-align: center; font-size: 13px; font-weight: 600; padding: 8px; border-radius: 8px;
        cursor: pointer; color: #475569; margin: 0;
    }
    .tabs input { position: absolute; opacity: 0; pointer-events: none; }
    .tabs input:checked + span { color: #0f172a; }
    .tabs label:has(input:checked) { background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,0.1); color: #0f172a; }
    .tabs input:focus-visible + span { outline: 2px solid #2563eb; outline-offset: 2px; border-radius: 4px; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px; }
    .field input {
        width: 100%; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 10px;
        font-size: 14px; color: #0f172a; background: #fff; outline: none;
    }
    .field input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
    .mono { font-family: 'SF Mono', 'Fira Code', Consolas, monospace; }
    .hint { font-size: 12px; color: #64748b; margin-top: 6px; line-height: 1.5; }
    .error-box {
        background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 10px 14px;
        border-radius: 10px; font-size: 13px; margin-bottom: 16px; line-height: 1.5;
    }
    .actions { display: flex; gap: 10px; margin-top: 18px; }
    .btn { flex: 1; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; border: 1px solid transparent; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-primary:disabled { opacity: 0.7; cursor: wait; }
    .btn-secondary { background: #fff; color: #334155; border-color: #cbd5e1; }
    .btn-secondary:hover { background: #f8fafc; }
    .note { margin-top: 18px; font-size: 11px; color: #64748b; line-height: 1.6; text-align: center; }
    [hidden] { display: none !important; }
`;

const shell = (body) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer">
    <title>Connect Claude — Adfliker CRM</title>
    <style>${STYLES}</style>
</head>
<body>
    <div class="card">
        <div class="logo">A</div>
        ${body}
    </div>
</body>
</html>`;

const renderAuthorizePage = (model = {}) => {
    if (model.fatal) {
        return shell(`
        <h1>Can't connect</h1>
        <div class="error-box" role="alert">${escapeHtml(model.fatal)}</div>
        <p class="note">You can close this window.</p>`);
    }

    const {
        error, clientName, redirectHost, email,
        client_id, redirect_uri, response_type, state, code_challenge, code_challenge_method, scope, resource
    } = model;
    const authMethod = model.authMethod === 'api_key' ? 'api_key' : 'password';
    const hidden = (name, value) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

    return shell(`
        <h1>Connect to Adfliker CRM</h1>
        <p class="subtitle">
            <strong>${escapeHtml(clientName || 'An MCP client')}</strong> wants to access your CRM workspace.
        </p>

        <div class="perm">
            <p>It will be able to read and update leads, pipeline, tasks, appointments and campaigns in <strong>your workspace only</strong>, and send messages after you confirm them.</p>
            ${redirectHost ? `<p>You will be returned to <strong>${escapeHtml(redirectHost)}</strong>.</p>` : ''}
        </div>

        ${error ? `<div class="error-box" role="alert">${escapeHtml(error)}</div>` : ''}

        <form method="POST" action="/oauth/authorize" autocomplete="on">
            ${hidden('client_id', client_id)}
            ${hidden('redirect_uri', redirect_uri)}
            ${hidden('response_type', response_type || 'code')}
            ${hidden('state', state)}
            ${hidden('code_challenge', code_challenge)}
            ${hidden('code_challenge_method', code_challenge_method || 'S256')}
            ${hidden('scope', scope)}
            ${hidden('resource', resource)}

            <div class="tabs" role="radiogroup" aria-label="Sign-in method">
                <label><input type="radio" name="auth_method" value="password" ${authMethod === 'password' ? 'checked' : ''}><span>Email &amp; password</span></label>
                <label><input type="radio" name="auth_method" value="api_key" ${authMethod === 'api_key' ? 'checked' : ''}><span>API key</span></label>
            </div>

            <div data-method="password" ${authMethod === 'password' ? '' : 'hidden'}>
                <div class="field">
                    <label for="email">Email</label>
                    <input type="email" id="email" name="email" value="${escapeHtml(email)}" autocomplete="username" ${authMethod === 'password' ? 'autofocus' : ''}>
                </div>
                <div class="field">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" autocomplete="current-password">
                </div>
                <p class="hint">Use the workspace owner's CRM login. Team members can't connect Claude.</p>
            </div>

            <div data-method="api_key" ${authMethod === 'api_key' ? '' : 'hidden'}>
                <div class="field">
                    <label for="mcp_api_key">MCP API key</label>
                    <input type="password" id="mcp_api_key" name="mcp_api_key" class="mono" placeholder="mcp_…" autocomplete="off" ${authMethod === 'api_key' ? 'autofocus' : ''}>
                </div>
                <p class="hint">For accounts that sign in with Google. Find it in CRM → Settings → Claude AI.</p>
            </div>

            <div class="actions">
                <button type="submit" name="action" value="deny" class="btn btn-secondary" formnovalidate>Cancel</button>
                <button type="submit" name="action" value="allow" class="btn btn-primary" id="allow">Allow access</button>
            </div>
        </form>

        <p class="note">You can disconnect any time from CRM → Settings → Claude AI.</p>

    <script>
        (function () {
            var form = document.querySelector('form');
            var panels = document.querySelectorAll('[data-method]');
            form.querySelectorAll('input[name="auth_method"]').forEach(function (radio) {
                radio.addEventListener('change', function () {
                    panels.forEach(function (p) { p.hidden = p.getAttribute('data-method') !== radio.value; });
                    var focus = panels[radio.value === 'api_key' ? 1 : 0].querySelector('input');
                    if (focus) focus.focus();
                });
            });
            form.addEventListener('submit', function (e) {
                var allow = document.getElementById('allow');
                if (allow.disabled) { e.preventDefault(); return; }
                if (e.submitter === allow) {
                    // Keep the clicked button's value — a disabled submitter is not sent.
                    var h = document.createElement('input');
                    h.type = 'hidden'; h.name = 'action'; h.value = 'allow';
                    form.appendChild(h);
                    allow.disabled = true;
                    allow.textContent = 'Connecting…';
                }
            });
        })();
    </script>`);
};

module.exports = { renderAuthorizePage, escapeHtml };
