// Email Management JavaScript

let currentTemplateId = null;
let allStages = [];
let allTemplates = [];

// Auth helper
function getAuthToken() {
    return localStorage.getItem('token');
}

async function authFetch(url, options = {}) {
    const token = getAuthToken();
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    if (response.status === 401) {
        localStorage.removeItem('token');
        window.location.href = 'login.html';
        return;
    }

    return response;
}

// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('role');
    window.location.href = 'login.html';
}

// Load user info
function loadUserInfo() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const userNameDisplay = document.getElementById('userNameDisplay');
    if (userNameDisplay) {
        userNameDisplay.textContent = user.name || 'User';
    }
}

// Load templates
async function loadTemplates() {
    try {
        const res = await authFetch('/api/email-templates');
        if (res && res.ok) {
            allTemplates = await res.json();
            renderTemplates(allTemplates);
        } else {
            console.error('Failed to load templates');
        }
    } catch (err) {
        console.error('Error loading templates:', err);
    }
}

// Load stages for dropdown
async function loadStages() {
    try {
        const res = await authFetch('/api/stages');
        if (res && res.ok) {
            allStages = await res.json();
            const stageSelect = document.getElementById('templateStage');
            if (stageSelect) {
                stageSelect.innerHTML = '<option value="">Select Stage...</option>';
                allStages.forEach(stage => {
                    stageSelect.innerHTML += `<option value="${stage.name}">${stage.name}</option>`;
                });
            }
        }
    } catch (err) {
        console.error('Error loading stages:', err);
    }
}

// Render templates
function renderTemplates(templates) {
    const container = document.getElementById('templatesContainer');
    if (!container) return;

    if (!templates || templates.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-12">
                <i class="fa-solid fa-envelope text-6xl text-gray-300 mb-4"></i>
                <p class="text-gray-400 text-lg mb-4">No email templates yet</p>
                <button onclick="openCreateTemplateModal()" class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition shadow-md">
                    <i class="fa-solid fa-plus mr-2"></i>Create Your First Template
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = templates.map(template => {
        const automationBadge = template.isAutomated 
            ? `<span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                <i class="fa-solid fa-robot mr-1"></i>${template.triggerType === 'on_lead_create' ? 'Auto: New Lead' : template.triggerType === 'on_stage_change' ? `Auto: ${template.stage || 'Stage'}` : 'Automated'}
            </span>`
            : '';
        
        const statusBadge = template.isActive
            ? '<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">Active</span>'
            : '<span class="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium">Inactive</span>';

        return `
            <div class="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition border border-gray-200">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex-1">
                        <h3 class="text-lg font-bold text-gray-800 mb-2">${escapeHtml(template.name)}</h3>
                        <p class="text-sm text-gray-600 mb-3 line-clamp-2">${escapeHtml(template.subject)}</p>
                    </div>
                    <div class="ml-4">
                        ${template.attachments && template.attachments.length > 0 
                            ? `<span class="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">
                                <i class="fa-solid fa-paperclip mr-1"></i>${template.attachments.length}
                            </span>`
                            : ''}
                    </div>
                </div>
                
                <div class="flex flex-wrap gap-2 mb-4">
                    ${automationBadge}
                    ${statusBadge}
                </div>
                
                <div class="flex gap-2 pt-4 border-t border-gray-200">
                    <button onclick="viewTemplate('${template._id}')" 
                        class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                        <i class="fa-solid fa-eye mr-1"></i>View
                    </button>
                    <button onclick="editTemplate('${template._id}')" 
                        class="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                        <i class="fa-solid fa-edit mr-1"></i>Edit
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Open create template modal
function openCreateTemplateModal() {
    currentTemplateId = null;
    document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-envelope"></i> Create Email Template';
    document.getElementById('templateForm').reset();
    document.getElementById('templateIsActive').checked = true;
    document.getElementById('templateIsAutomated').checked = false;
    toggleAutomationSettings();
    document.getElementById('templateModal').classList.remove('hidden');
    document.getElementById('templateModal').classList.add('flex');
    loadStages();
}

// Close template modal
function closeTemplateModal() {
    document.getElementById('templateModal').classList.add('hidden');
    document.getElementById('templateModal').classList.remove('flex');
    currentTemplateId = null;
}

// Toggle automation settings
function toggleAutomationSettings() {
    const isAutomated = document.getElementById('templateIsAutomated').checked;
    const automationSettings = document.getElementById('automationSettings');
    const stageSelector = document.getElementById('stageSelector');
    const triggerType = document.getElementById('templateTriggerType');
    
    if (isAutomated) {
        automationSettings.classList.remove('hidden');
        if (triggerType.value === 'on_stage_change') {
            stageSelector.classList.remove('hidden');
        } else {
            stageSelector.classList.add('hidden');
        }
    } else {
        automationSettings.classList.add('hidden');
        stageSelector.classList.add('hidden');
    }
}

// Trigger type change handler (moved to main DOMContentLoaded to avoid duplicates)

// Save template
async function saveTemplate(event) {
    event.preventDefault();
    
    const name = document.getElementById('templateName').value.trim();
    const subject = document.getElementById('templateSubject').value.trim();
    const body = document.getElementById('templateBody').value.trim();
    const isActive = document.getElementById('templateIsActive').checked;
    const isAutomated = document.getElementById('templateIsAutomated').checked;
    const triggerType = document.getElementById('templateTriggerType').value;
    const stage = document.getElementById('templateStage').value || null;

    if (!name || !subject || !body) {
        alert('Please fill in all required fields');
        return;
    }

    try {
        const url = currentTemplateId 
            ? `/api/email-templates/${currentTemplateId}`
            : '/api/email-templates';
        
        const method = currentTemplateId ? 'PUT' : 'POST';
        
        const res = await authFetch(url, {
            method: method,
            body: JSON.stringify({
                name,
                subject,
                body,
                isActive,
                isAutomated: isAutomated ? true : false,
                triggerType: isAutomated ? triggerType : 'manual',
                stage: (isAutomated && triggerType === 'on_stage_change') ? stage : null
            })
        });

        if (res && res.ok) {
            closeTemplateModal();
            await loadTemplates();
            alert(currentTemplateId ? 'Template updated successfully!' : 'Template created successfully!');
        } else {
            const error = await res.json();
            alert(error.message || 'Failed to save template');
        }
    } catch (err) {
        console.error('Error saving template:', err);
        alert('Error saving template');
    }
}

// View template
async function viewTemplate(id) {
    try {
        const res = await authFetch(`/api/email-templates/${id}`);
        if (res && res.ok) {
            const template = await res.json();
            currentTemplateId = id;
            showTemplateDetails(template);
        }
    } catch (err) {
        console.error('Error loading template:', err);
        alert('Error loading template');
    }
}

// Show template details
function showTemplateDetails(template) {
    document.getElementById('templateDetailsTitle').textContent = template.name;
    document.getElementById('templateDetailsSubtitle').textContent = template.subject;
    
    const content = document.getElementById('templateDetailsContent');
    content.innerHTML = `
        <div class="bg-white rounded-lg p-4 border border-gray-200 space-y-4">
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Subject</label>
                <p class="text-sm text-gray-700">${escapeHtml(template.subject)}</p>
            </div>
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Body</label>
                <div class="text-sm text-gray-700 bg-gray-50 p-4 rounded-lg border border-gray-200 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    ${template.body}
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">Status</label>
                    <span class="px-2 py-1 ${template.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'} text-xs rounded-full font-medium">
                        ${template.isActive ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">Automation</label>
                    <span class="px-2 py-1 ${template.isAutomated ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'} text-xs rounded-full font-medium">
                        ${template.isAutomated ? template.triggerType === 'on_lead_create' ? 'Auto: New Lead' : template.triggerType === 'on_stage_change' ? `Auto: ${template.stage || 'Stage'}` : 'Automated' : 'Manual'}
                    </span>
                </div>
            </div>
        </div>
    `;
    
    // Load attachments
    renderAttachments(template.attachments || []);
    
    document.getElementById('templateDetailsModal').classList.remove('hidden');
    document.getElementById('templateDetailsModal').classList.add('flex');
}

// Render attachments
function renderAttachments(attachments) {
    const container = document.getElementById('attachmentsList');
    if (!attachments || attachments.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No attachments</p>';
        return;
    }
    
    container.innerHTML = attachments.map(att => `
        <div class="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
            <div class="flex items-center gap-3">
                <i class="fa-solid fa-file text-blue-500"></i>
                <div>
                    <p class="text-sm font-medium text-gray-700">${escapeHtml(att.originalName || att.filename)}</p>
                    <p class="text-xs text-gray-500">${formatFileSize(att.size || 0)}</p>
                </div>
            </div>
            <button onclick="removeAttachment('${att._id}')" class="text-red-500 hover:text-red-700 transition">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Close template details modal
function closeTemplateDetailsModal() {
    document.getElementById('templateDetailsModal').classList.add('hidden');
    document.getElementById('templateDetailsModal').classList.remove('flex');
    currentTemplateId = null;
}

// Edit template
async function editTemplate(id) {
    closeTemplateDetailsModal();
    currentTemplateId = id;
    
    try {
        const res = await authFetch(`/api/email-templates/${id}`);
        if (res && res.ok) {
            const template = await res.json();
            
            document.getElementById('templateModalTitle').innerHTML = '<i class="fa-solid fa-edit"></i> Edit Email Template';
            document.getElementById('templateName').value = template.name;
            document.getElementById('templateSubject').value = template.subject;
            document.getElementById('templateBody').value = template.body;
            document.getElementById('templateIsActive').checked = template.isActive;
            document.getElementById('templateIsAutomated').checked = template.isAutomated;
            document.getElementById('templateTriggerType').value = template.triggerType || 'manual';
            if (template.stage) {
                document.getElementById('templateStage').value = template.stage;
            }
            
            toggleAutomationSettings();
            loadStages();
            
            document.getElementById('templateModal').classList.remove('hidden');
            document.getElementById('templateModal').classList.add('flex');
        }
    } catch (err) {
        console.error('Error loading template:', err);
        alert('Error loading template');
    }
}

// Edit current template
function editCurrentTemplate() {
    if (currentTemplateId) {
        editTemplate(currentTemplateId);
        closeTemplateDetailsModal();
    }
}

// Delete template
async function deleteCurrentTemplate() {
    if (!currentTemplateId) return;
    
    if (!confirm('Are you sure you want to delete this template? This action cannot be undone.')) {
        return;
    }
    
    try {
        const res = await authFetch(`/api/email-templates/${currentTemplateId}`, {
            method: 'DELETE'
        });
        
        if (res && res.ok) {
            closeTemplateDetailsModal();
            await loadTemplates();
            alert('Template deleted successfully!');
        } else {
            const error = await res.json();
            alert(error.message || 'Failed to delete template');
        }
    } catch (err) {
        console.error('Error deleting template:', err);
        alert('Error deleting template');
    }
}

// Open attachment upload modal
function openAttachmentUpload() {
    document.getElementById('attachmentFiles').value = '';
    document.getElementById('attachmentModal').classList.remove('hidden');
    document.getElementById('attachmentModal').classList.add('flex');
}

// Close attachment modal
function closeAttachmentModal() {
    document.getElementById('attachmentModal').classList.add('hidden');
    document.getElementById('attachmentModal').classList.remove('flex');
}

// Upload attachments
async function uploadAttachments(event) {
    event.preventDefault();
    
    if (!currentTemplateId) {
        alert('No template selected');
        return;
    }
    
    const fileInput = document.getElementById('attachmentFiles');
    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Please select at least one file');
        return;
    }
    
    try {
        const formData = new FormData();
        for (let i = 0; i < fileInput.files.length; i++) {
            formData.append('attachments', fileInput.files[i]);
        }
        
        const token = getAuthToken();
        const res = await fetch(`/api/email-templates/${currentTemplateId}/attachments`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            body: formData
        });
        
        if (res.ok) {
            const template = await res.json();
            renderAttachments(template.attachments || []);
            closeAttachmentModal();
            alert('Files uploaded successfully!');
        } else {
            const error = await res.json();
            alert(error.message || 'Failed to upload files');
        }
    } catch (err) {
        console.error('Error uploading files:', err);
        alert('Error uploading files');
    }
}

// Remove attachment
async function removeAttachment(attachmentId) {
    if (!currentTemplateId) return;
    
    if (!confirm('Are you sure you want to remove this attachment?')) {
        return;
    }
    
    try {
        const token = getAuthToken();
        const res = await fetch(`/api/email-templates/${currentTemplateId}/attachments`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ attachmentId })
        });
        
        if (res.ok) {
            const template = await res.json();
            renderAttachments(template.attachments || []);
            alert('Attachment removed successfully!');
        } else {
            const error = await res.json();
            alert(error.message || 'Failed to remove attachment');
        }
    } catch (err) {
        console.error('Error removing attachment:', err);
        alert('Error removing attachment');
    }
}

// ==================== ANALYTICS & INBOX ====================

let currentInboxPage = 1;
let inboxPageSize = 50;
let inboxFilters = {
    status: '',
    isAutomated: '',
    search: ''
};

// Load analytics
async function loadAnalytics() {
    try {
        const res = await authFetch('/api/email-logs/analytics');
        if (res && res.ok) {
            const analytics = await res.json();
            updateAnalytics(analytics);
        }
    } catch (err) {
        console.error('Error loading analytics:', err);
    }
}

// Update analytics display
function updateAnalytics(analytics) {
    document.getElementById('sentTodayCount').textContent = analytics.today.sent || 0;
    document.getElementById('failedTodayCount').textContent = analytics.today.failed || 0;
    document.getElementById('sentThisMonthCount').textContent = analytics.thisMonth.sent || 0;
    document.getElementById('automatedSentTodayCount').textContent = analytics.today.automated.sent || 0;
}

// Track current tab to prevent duplicate loads
let currentTab = 'templates';

// Switch tab
function switchTab(tab) {
    // Prevent duplicate calls if clicking the same tab
    if (currentTab === tab) return;
    currentTab = tab;
    
    const templatesTab = document.getElementById('templatesTab');
    const inboxTab = document.getElementById('inboxTab');
    const settingsTab = document.getElementById('settingsTab');
    const templatesView = document.getElementById('templatesView');
    const inboxView = document.getElementById('inboxView');
    const settingsView = document.getElementById('settingsView');
    const newTemplateBtn = document.getElementById('newTemplateBtn');
    
    // Reset all tabs
    [templatesTab, inboxTab, settingsTab].forEach(t => {
        if (t) {
            t.classList.add('border-transparent', 'text-gray-600');
            t.classList.remove('border-red-500', 'text-red-600');
        }
    });
    
    // Hide all views
    [templatesView, inboxView, settingsView].forEach(v => {
        if (v) v.classList.add('hidden');
    });
    
    if (tab === 'templates') {
        if (templatesTab) {
            templatesTab.classList.add('border-red-500', 'text-red-600');
            templatesTab.classList.remove('border-transparent', 'text-gray-600');
        }
        if (templatesView) templatesView.classList.remove('hidden');
        if (newTemplateBtn) newTemplateBtn.classList.remove('hidden');
        // Templates are already loaded on page load, no need to reload
    } else if (tab === 'inbox') {
        if (inboxTab) {
            inboxTab.classList.add('border-red-500', 'text-red-600');
            inboxTab.classList.remove('border-transparent', 'text-gray-600');
        }
        if (inboxView) inboxView.classList.remove('hidden');
        if (newTemplateBtn) newTemplateBtn.classList.add('hidden');
        // Only load inbox if not already loaded
        if (inboxView && !inboxView.classList.contains('loaded')) {
            inboxView.classList.add('loaded');
            loadInbox();
        } else {
            loadInbox(); // Always load fresh data when switching to inbox
        }
    } else if (tab === 'settings') {
        if (settingsTab) {
            settingsTab.classList.add('border-red-500', 'text-red-600');
            settingsTab.classList.remove('border-transparent', 'text-gray-600');
        }
        if (settingsView) settingsView.classList.remove('hidden');
        if (newTemplateBtn) newTemplateBtn.classList.add('hidden');
        // Always load config when switching to settings tab
        loadEmailConfig();
    }
}

// Load inbox with loading state
async function loadInbox() {
    const tbody = document.getElementById('inboxTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-8 text-center text-gray-400">
                    <i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading emails...
                </td>
            </tr>
        `;
    }
    
    try {
        const params = new URLSearchParams({
            page: currentInboxPage,
            limit: inboxPageSize,
            ...(inboxFilters.status && { status: inboxFilters.status }),
            ...(inboxFilters.isAutomated && { isAutomated: inboxFilters.isAutomated }),
            ...(inboxFilters.search && { search: inboxFilters.search })
        });
        
        const res = await authFetch(`/api/email-logs/logs?${params}`);
        if (res && res.ok) {
            const data = await res.json();
            renderInbox(data.logs || [], data.pagination || {});
        } else {
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="px-6 py-8 text-center text-red-400">Failed to load emails</td>
                    </tr>
                `;
            }
        }
    } catch (err) {
        console.error('Error loading inbox:', err);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="px-6 py-8 text-center text-red-400">Error loading emails</td>
                </tr>
            `;
        }
    }
}

// Render inbox
function renderInbox(logs, pagination) {
    const tbody = document.getElementById('inboxTableBody');
    
    if (!logs || logs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="px-6 py-8 text-center text-gray-400">No emails found</td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = logs.map(log => {
        const statusBadge = log.status === 'sent'
            ? '<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">Sent</span>'
            : '<span class="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">Failed</span>';
        
        const typeBadge = log.isAutomated
            ? '<span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">Auto</span>'
            : '<span class="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium">Manual</span>';
        
        const date = new Date(log.sentAt).toLocaleString();
        const subjectPreview = log.subject ? (log.subject.length > 50 ? log.subject.substring(0, 50) + '...' : log.subject) : 'No subject';
        
        return `
            <tr class="hover:bg-gray-50 cursor-pointer" onclick="viewEmailLog('${log._id}')">
                <td class="px-6 py-4 text-sm text-gray-700">${escapeHtml(log.to)}</td>
                <td class="px-6 py-4 text-sm text-gray-700 font-medium">${escapeHtml(subjectPreview)}</td>
                <td class="px-6 py-4 text-sm">${statusBadge}</td>
                <td class="px-6 py-4 text-sm">${typeBadge}</td>
                <td class="px-6 py-4 text-sm text-gray-600">${date}</td>
                <td class="px-6 py-4 text-sm">
                    <button onclick="event.stopPropagation(); viewEmailLog('${log._id}')" 
                        class="text-blue-600 hover:text-blue-800 transition">
                        <i class="fa-solid fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Update pagination
    updateInboxPagination(pagination);
}

// Update inbox pagination
function updateInboxPagination(pagination) {
    const pageInfo = document.getElementById('inboxPageInfo');
    const prevBtn = document.getElementById('prevInboxBtn');
    const nextBtn = document.getElementById('nextInboxBtn');
    
    if (pageInfo) {
        pageInfo.textContent = `Page ${pagination.page || 1} of ${pagination.pages || 1} (${pagination.total || 0} total)`;
    }
    
    if (prevBtn) {
        prevBtn.disabled = !pagination.page || pagination.page <= 1;
    }
    
    if (nextBtn) {
        nextBtn.disabled = !pagination.page || pagination.page >= (pagination.pages || 1);
    }
}

// Load inbox page
function loadInboxPage(direction) {
    if (direction === 'prev' && currentInboxPage > 1) {
        currentInboxPage--;
        loadInbox();
    } else if (direction === 'next') {
        currentInboxPage++;
        loadInbox();
    }
}

// Filter emails
function filterEmails() {
    inboxFilters.status = document.getElementById('statusFilter').value;
    inboxFilters.isAutomated = document.getElementById('automationFilter').value;
    currentInboxPage = 1;
    loadInbox();
}

// Search emails
function searchEmails() {
    inboxFilters.search = document.getElementById('emailSearch').value;
    currentInboxPage = 1;
    loadInbox();
}

// View email log
async function viewEmailLog(id) {
    try {
        const res = await authFetch(`/api/email-logs/logs/${id}`);
        if (res && res.ok) {
            const log = await res.json();
            showEmailLogDetails(log);
        }
    } catch (err) {
        console.error('Error loading email log:', err);
        alert('Error loading email details');
    }
}

// Show email log details
function showEmailLogDetails(log) {
    document.getElementById('emailLogSubtitle').textContent = log.subject || 'Email Details';
    
    const content = document.getElementById('emailLogContent');
    const statusBadge = log.status === 'sent'
        ? '<span class="px-3 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">Sent</span>'
        : '<span class="px-3 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">Failed</span>';
    
    const typeBadge = log.isAutomated
        ? '<span class="px-3 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">Automated</span>'
        : '<span class="px-3 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium">Manual</span>';
    
    const date = new Date(log.sentAt).toLocaleString();
    const attachmentsHtml = log.attachments && log.attachments.length > 0
        ? log.attachments.map(att => `
            <div class="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                <i class="fa-solid fa-file text-blue-500"></i>
                <div>
                    <p class="text-sm font-medium text-gray-700">${escapeHtml(att.originalName || att.filename)}</p>
                    <p class="text-xs text-gray-500">${formatFileSize(att.size || 0)}</p>
                </div>
            </div>
        `).join('')
        : '<p class="text-sm text-gray-400">No attachments</p>';
    
    content.innerHTML = `
        <div class="bg-white rounded-lg p-6 border border-gray-200 space-y-6">
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">Status</label>
                    ${statusBadge}
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">Type</label>
                    ${typeBadge}
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">To</label>
                    <p class="text-sm text-gray-700">${escapeHtml(log.to)}</p>
                </div>
                <div>
                    <label class="block text-xs font-bold text-gray-500 mb-1">Date</label>
                    <p class="text-sm text-gray-700">${date}</p>
                </div>
            </div>
            
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Subject</label>
                <p class="text-sm text-gray-700 font-medium">${escapeHtml(log.subject)}</p>
            </div>
            
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Body</label>
                <div class="text-sm text-gray-700 bg-gray-50 p-4 rounded-lg border border-gray-200 whitespace-pre-wrap max-h-64 overflow-y-auto">
                    ${log.body}
                </div>
            </div>
            
            ${log.status === 'failed' && log.error ? `
            <div>
                <label class="block text-xs font-bold text-red-600 mb-1">Error</label>
                <p class="text-sm text-red-700 bg-red-50 p-3 rounded-lg border border-red-200">${escapeHtml(log.error)}</p>
            </div>
            ` : ''}
            
            ${log.messageId ? `
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Message ID</label>
                <p class="text-sm text-gray-600 font-mono">${escapeHtml(log.messageId)}</p>
            </div>
            ` : ''}
            
            <div>
                <label class="block text-xs font-bold text-gray-500 mb-1">Attachments</label>
                <div class="space-y-2">${attachmentsHtml}</div>
            </div>
        </div>
    `;
    
    document.getElementById('emailLogModal').classList.remove('hidden');
    document.getElementById('emailLogModal').classList.add('flex');
}

// Close email log modal
function closeEmailLogModal() {
    document.getElementById('emailLogModal').classList.add('hidden');
    document.getElementById('emailLogModal').classList.remove('flex');
}

// ==========================================
// EMAIL CONFIGURATION FUNCTIONS
// ==========================================

// Load email configuration
async function loadEmailConfig() {
    try {
        const res = await authFetch('/api/email/config');
        if (res && res.ok) {
            const config = await res.json();
            
            // Fill form fields
            document.getElementById('configEmailUser').value = config.emailUser || '';
            document.getElementById('configEmailFromName').value = config.emailFromName || '';
            
            // Update status
            const statusIcon = document.getElementById('configStatusIcon');
            const statusText = document.getElementById('configStatusText');
            
            if (config.isConfigured) {
                statusIcon.innerHTML = '<i class="fa-solid fa-check-circle text-green-500"></i>';
                statusText.textContent = `Email configured: ${config.emailUser}`;
                statusText.classList.remove('text-gray-500');
                statusText.classList.add('text-green-600', 'font-medium');
            } else {
                statusIcon.innerHTML = '<i class="fa-solid fa-exclamation-circle text-yellow-500"></i>';
                statusText.textContent = 'Email not configured. Please configure your email settings.';
                statusText.classList.remove('text-green-600', 'font-medium');
                statusText.classList.add('text-gray-500');
            }
        } else {
            console.error('Failed to load email config');
        }
    } catch (err) {
        console.error('Error loading email config:', err);
    }
}

// Save email configuration
async function saveEmailConfig(event) {
    event.preventDefault();
    
    const emailUser = document.getElementById('configEmailUser').value.trim();
    const emailPassword = document.getElementById('configEmailPassword').value;
    const emailFromName = document.getElementById('configEmailFromName').value.trim();
    
    const statusDiv = document.getElementById('emailConfigStatus');
    statusDiv.classList.add('hidden');
    statusDiv.innerHTML = '';
    
    try {
        const res = await authFetch('/api/email/config', {
            method: 'PUT',
            body: JSON.stringify({
                emailUser,
                emailPassword,
                emailFromName
            })
        });
        
        if (res && res.ok) {
            const data = await res.json();
            
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-green-50 border border-green-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-green-700">
                    <i class="fa-solid fa-check-circle"></i>
                    <span class="font-medium">${data.message || 'Email configuration saved successfully!'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
            
            // Clear password field
            document.getElementById('configEmailPassword').value = '';
            
            // Reload config to update status
            loadEmailConfig();
        } else {
            const error = await res.json();
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-red-700">
                    <i class="fa-solid fa-exclamation-circle"></i>
                    <span>${error.message || 'Failed to save email configuration'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Error saving email config:', err);
        statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
        statusDiv.innerHTML = `
            <div class="flex items-center gap-2 text-red-700">
                <i class="fa-solid fa-exclamation-circle"></i>
                <span>Error saving email configuration. Please try again.</span>
            </div>
        `;
        statusDiv.classList.remove('hidden');
    }
}

// Test email configuration
async function testEmailConfig() {
    const emailUser = document.getElementById('configEmailUser').value.trim();
    const emailPassword = document.getElementById('configEmailPassword').value;
    const emailFromName = document.getElementById('configEmailFromName').value.trim();
    
    const statusDiv = document.getElementById('emailConfigStatus');
    statusDiv.classList.add('hidden');
    statusDiv.innerHTML = '';
    
    if (!emailUser || !emailPassword) {
        statusDiv.className = 'p-4 rounded-lg mb-4 bg-yellow-50 border border-yellow-200';
        statusDiv.innerHTML = `
            <div class="flex items-center gap-2 text-yellow-700">
                <i class="fa-solid fa-exclamation-circle"></i>
                <span>Please enter email address and password first</span>
            </div>
        `;
        statusDiv.classList.remove('hidden');
        return;
    }
    
    // Show loading
    statusDiv.className = 'p-4 rounded-lg mb-4 bg-blue-50 border border-blue-200';
    statusDiv.innerHTML = `
        <div class="flex items-center gap-2 text-blue-700">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span>Sending test email...</span>
        </div>
    `;
    statusDiv.classList.remove('hidden');
    
    try {
        const res = await authFetch('/api/email/config/test', {
            method: 'POST',
            body: JSON.stringify({
                emailUser,
                emailPassword,
                emailFromName
            })
        });
        
        if (res && res.ok) {
            const data = await res.json();
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-green-50 border border-green-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-green-700">
                    <i class="fa-solid fa-check-circle"></i>
                    <span class="font-medium">${data.message || 'Test email sent successfully! Please check your inbox.'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
        } else {
            const error = await res.json();
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-red-700">
                    <i class="fa-solid fa-exclamation-circle"></i>
                    <span>${error.message || 'Failed to send test email. Please check your credentials.'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Error testing email config:', err);
        statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
        statusDiv.innerHTML = `
            <div class="flex items-center gap-2 text-red-700">
                <i class="fa-solid fa-exclamation-circle"></i>
                <span>Error testing email configuration. Please try again.</span>
            </div>
        `;
        statusDiv.classList.remove('hidden');
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check authentication first
    if (!getAuthToken()) {
        window.location.href = 'login.html';
        return;
    }
    
    // Load user info
    loadUserInfo();
    
    // Load initial data
    loadTemplates();
    loadAnalytics();
    
    // Setup trigger type change handler
    const triggerType = document.getElementById('templateTriggerType');
    if (triggerType) {
        triggerType.addEventListener('change', () => {
            const stageSelector = document.getElementById('stageSelector');
            if (triggerType.value === 'on_stage_change') {
                if (stageSelector) stageSelector.classList.remove('hidden');
            } else {
                if (stageSelector) stageSelector.classList.add('hidden');
            }
        });
    }
    
    // Optimized polling: Only refresh when tab is visible, and less frequently (2 minutes)
    let analyticsInterval = null;
    
    const startAnalyticsPolling = () => {
        // Clear any existing interval
        if (analyticsInterval) {
            clearInterval(analyticsInterval);
        }
        // Refresh analytics every 2 minutes (120000ms) instead of 30 seconds
        analyticsInterval = setInterval(() => {
            // Only poll if tab is visible
            if (!document.hidden) {
                loadAnalytics();
            }
        }, 120000); // 2 minutes
    };
    
    const stopAnalyticsPolling = () => {
        if (analyticsInterval) {
            clearInterval(analyticsInterval);
            analyticsInterval = null;
        }
    };
    
    // Start polling
    startAnalyticsPolling();
    
    // Pause polling when tab is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAnalyticsPolling();
        } else {
            // Reload immediately when tab becomes visible, then resume polling
            loadAnalytics();
            startAnalyticsPolling();
        }
    });
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        stopAnalyticsPolling();
    });
});
