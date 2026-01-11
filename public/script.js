// 🔒 SECURITY & USER
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user'));

if (!token) window.location.href = 'login.html';
else if(user) {
    const nameDisplay = document.getElementById('userNameDisplay');
    if(nameDisplay) nameDisplay.innerText = user.name;
}

// ==========================================
// 🔔 CUSTOM NOTIFICATION SYSTEM
// ==========================================

// Notification function to replace alert()
function showNotification(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notificationContainer');
    if (!container) {
        console.error('Notification container not found');
        return;
    }

    const notification = document.createElement('div');
    notification.className = `notification-item notification-${type} notification-enter`;
    
    const icons = {
        success: '<i class="fa-solid fa-check-circle"></i>',
        error: '<i class="fa-solid fa-exclamation-circle"></i>',
        warning: '<i class="fa-solid fa-exclamation-triangle"></i>',
        info: '<i class="fa-solid fa-info-circle"></i>'
    };

    notification.innerHTML = `
        <div class="text-2xl flex-shrink-0">${icons[type] || icons.info}</div>
        <div class="flex-1">
            <p class="font-medium text-sm leading-relaxed">${message}</p>
        </div>
        <button onclick="this.parentElement.remove()" class="text-white/80 hover:text-white ml-2 flex-shrink-0">
            <i class="fa-solid fa-times text-sm"></i>
        </button>
    `;

    container.appendChild(notification);

    // Auto remove after duration
    setTimeout(() => {
        notification.classList.remove('notification-enter');
        notification.classList.add('notification-exit');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }, duration);

    return notification;
}

// Confirm dialog to replace confirm()
let confirmResolve = null;
function showConfirm(message, title = 'Confirm Action', type = 'warning') {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        const modal = document.getElementById('confirmModal');
        const confirmTitle = document.getElementById('confirmTitle');
        const confirmMessage = document.getElementById('confirmMessage');
        const confirmIcon = document.getElementById('confirmIcon');
        const confirmOkBtn = document.getElementById('confirmOkBtn');

        if (!modal || !confirmTitle || !confirmMessage) {
            resolve(false);
            return;
        }

        confirmTitle.textContent = title;
        confirmMessage.textContent = message;

        // Set icon based on type
        const iconColors = {
            warning: { bg: 'bg-yellow-100', icon: 'fa-exclamation-triangle', color: 'text-yellow-600' },
            danger: { bg: 'bg-red-100', icon: 'fa-exclamation-circle', color: 'text-red-600' },
            info: { bg: 'bg-blue-100', icon: 'fa-question', color: 'text-blue-600' }
        };
        const iconStyle = iconColors[type] || iconColors.warning;
        confirmIcon.className = `w-12 h-12 rounded-full ${iconStyle.bg} flex items-center justify-center text-2xl`;
        confirmIcon.innerHTML = `<i class="fa-solid ${iconStyle.icon} ${iconStyle.color}"></i>`;

        // Set button color based on type
        if (type === 'danger') {
            confirmOkBtn.className = 'flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition';
        } else if (type === 'warning') {
            confirmOkBtn.className = 'flex-1 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition';
        } else {
            confirmOkBtn.className = 'flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition';
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // Focus on input/button for keyboard navigation
        setTimeout(() => {
            const cancelBtn = modal.querySelector('button[onclick="confirmCancel()"]');
            if (cancelBtn) cancelBtn.focus();
        }, 100);
    });
}

function confirmOk() {
    if (confirmResolve) {
        confirmResolve(true);
        confirmResolve = null;
    }
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function confirmCancel() {
    if (confirmResolve) {
        confirmResolve(false);
        confirmResolve = null;
    }
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// Prompt dialog to replace prompt()
let promptResolve = null;
function showPrompt(message, defaultValue = '', title = 'Enter Information') {
    return new Promise((resolve) => {
        promptResolve = resolve;
        const modal = document.getElementById('promptModal');
        const promptTitle = document.getElementById('promptTitle');
        const promptMessage = document.getElementById('promptMessage');
        const promptInput = document.getElementById('promptInput');

        if (!modal || !promptTitle || !promptMessage || !promptInput) {
            resolve(null);
            return;
        }

        promptTitle.textContent = title;
        promptMessage.textContent = message;
        promptInput.value = defaultValue;

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        // Focus on input for keyboard navigation
        setTimeout(() => {
            promptInput.focus();
            promptInput.select();
            
            // Handle Enter key
            const handleEnter = (e) => {
                if (e.key === 'Enter') {
                    promptOk();
                }
            };
            promptInput.addEventListener('keydown', handleEnter);
            promptInput._enterHandler = handleEnter;
        }, 100);
    });
}

function promptOk() {
    const promptInput = document.getElementById('promptInput');
    const value = promptInput ? promptInput.value : null;
    
    if (promptInput && promptInput._enterHandler) {
        promptInput.removeEventListener('keydown', promptInput._enterHandler);
        promptInput._enterHandler = null;
    }

    if (promptResolve) {
        promptResolve(value);
        promptResolve = null;
    }
    const modal = document.getElementById('promptModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function promptCancel() {
    const promptInput = document.getElementById('promptInput');
    if (promptInput && promptInput._enterHandler) {
        promptInput.removeEventListener('keydown', promptInput._enterHandler);
        promptInput._enterHandler = null;
    }

    if (promptResolve) {
        promptResolve(null);
        promptResolve = null;
    }
    const modal = document.getElementById('promptModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function logout() {
    showConfirm("Are you sure you want to logout?", "Logout", "warning").then(confirmed => {
        if (confirmed) {
            localStorage.clear();
            window.location.href = 'login.html';
        }
    });
}

// 🔥 AUTH FETCH
async function authFetch(url, options = {}) {
    // Bearer removed so backend accepts it
    options.headers = { ...options.headers, 'Authorization': token, 'Content-Type': 'application/json' };
    const res = await fetch(url, options);
    if(res.status === 401) { 
        showNotification("Session expired. Please login again.", "error", 5000);
        setTimeout(() => logout(), 2000);
    }
    return res;
}

// --- VARIABLES ---
let drake, currentLeadId = null, allLeadsCache = [];
let dashboardDataLoaded = false; // Cache flag to avoid redundant API calls

// TEAM MANAGEMENT DYNAMIC LOADER
document.addEventListener('DOMContentLoaded', () => {
    const teamBtn = document.getElementById('teamManagementBtn');
    const pipelineBtn = document.getElementById('pipelineBtn');
    
    if (teamBtn) {
        teamBtn.addEventListener('click', async () => {
            document.getElementById('dashboardViews').classList.add('hidden');
            document.getElementById('kanbanView').classList.add('hidden');
            const teamView = document.getElementById('teamManagementView');
            teamView.classList.remove('hidden');

            if (!teamView.innerHTML.trim()) {
                try {
                    const res = await fetch('team.html');
                    let html = await res.text();
                    const mainMatch = html.match(/<main[\s\S]*?<\/main>/);
                    teamView.innerHTML = mainMatch ? mainMatch[0] : html;
                } catch (err) {
                    teamView.innerHTML = '<div class="p-8 text-red-500">Failed to load Team Management.</div>';
                }
            }
            setupTeamManagement();
        });
    }
    
    
    // Pipeline/Kanban Button Handler
    if (pipelineBtn) {
        pipelineBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            // Hide other views
            document.getElementById('tableView').classList.add('hidden');
            document.getElementById('teamManagementView').classList.add('hidden');
            // Show kanban view (it's inside dashboardViews)
            const kanbanView = document.getElementById('kanbanView');
            const dashboardViews = document.getElementById('dashboardViews');
            if (kanbanView) {
                kanbanView.classList.remove('hidden');
                dashboardViews.classList.remove('hidden'); // Keep dashboardViews visible
            }
            // Load and setup kanban
            setupKanban();
        });
    }
});

// TEAM MANAGEMENT LOGIC
function setupTeamManagement() {
    const token = localStorage.getItem('token');
    if (!token) return window.location.href = 'login.html';

    // Fetch & Display Team
    async function loadTeam() {
        try {
            const res = await fetch('/api/auth/my-team', {
                headers: { 'Authorization': token }
            });
            const agents = await res.json();
            const tbody = document.getElementById('teamTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (agents.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400">No agents found. Add one above!</td></tr>`;
                return;
            }
            agents.forEach(agent => {
                const date = new Date(agent.createdAt).toLocaleDateString();
                tbody.innerHTML += `
                    <tr class="hover:bg-gray-50">
                        <td class="px-6 py-4 font-bold text-gray-800">${agent.name}</td>
                        <td class="px-6 py-4 text-purple-600">${agent.email}</td>
                        <td class="px-6 py-4">
                            <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold uppercase">
                                ${agent.role}
                            </span>
                        </td>
                        <td class="px-6 py-4">${date}</td>
                        <td class="px-6 py-4 text-green-600 font-bold">Active</td>
                    </tr>
                `;
            });
        } catch (err) {
            console.error(err);
            const tbody = document.getElementById('teamTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-red-500">Failed to load team.</td></tr>';
        }
    }

    // Handle Form Submit (Create Agent)
    const addAgentForm = document.getElementById('addAgentForm');
    if (addAgentForm) {
        addAgentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('agentName').value;
            const email = document.getElementById('agentEmail').value;
            const password = document.getElementById('agentPass').value;
            try {
                const res = await fetch('/api/auth/add-agent', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify({ name, email, password })
                });
                const data = await res.json();
                if (res.ok) {
                    showNotification('🎉 Agent Created Successfully!', 'success');
                    addAgentForm.reset();
                    loadTeam();
                } else {
                    showNotification('Error: ' + data.message, 'error');
                }
            } catch (err) {
                console.error(err);
                showNotification('Something went wrong', 'error');
            }
        });
    }

    // Logout function for team view
    const logoutBtn = document.querySelector('#teamManagementView button[onclick="logout()"]');
    if (logoutBtn) {
        logoutBtn.onclick = function() {
            localStorage.clear();
            window.location.href = 'login.html';
        };
    }

    // Initial load
    loadTeam();
}

// WHATSAPP SETUP LOGIC
function setupWhatsApp() {
    const token = localStorage.getItem('token');
    if (!token) return window.location.href = 'login.html';
    initWhatsApp();
}

// KANBAN SETUP LOGIC
function setupKanban() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    
    // Ensure kanbanBoard exists
    let board = document.getElementById('kanbanBoard');
    if (!board) {
        const kanbanView = document.getElementById('kanbanView');
        if (kanbanView) {
            kanbanView.innerHTML = '<div class="flex gap-6 h-full" id="kanbanBoard" style="min-width: 1000px;"></div>';
            board = document.getElementById('kanbanBoard');
        }
        if (!board) {
            console.error('kanbanBoard element not found and could not be created');
            return;
        }
    }
    
    // Fetch data and render kanban
    async function loadKanbanData() {
        try {
            board.innerHTML = '<div class="text-center p-8 text-gray-500">Loading Kanban board...</div>';
            const [stagesRes, leadsRes] = await Promise.all([
                authFetch('/api/stages'),
                authFetch('/api/leads')
            ]);
            
            if (!stagesRes.ok || !leadsRes.ok) {
                throw new Error('Failed to fetch data');
            }
            
            const stages = await stagesRes.json();
            const leads = await leadsRes.json();
            
            // Update cache
            allLeadsCache = leads;
            
            renderKanbanDynamic(stages, leads);
        } catch (err) {
            console.error("Kanban load error:", err);
            const board = document.getElementById('kanbanBoard');
            if (board) {
                board.innerHTML = `<div class="text-red-500 p-8 text-center">
                    Failed to load kanban: ${err.message || 'Unknown error'}
                    <br><button onclick="setupKanban()" class="mt-4 px-4 py-2 bg-blue-500 text-white rounded">Retry</button>
                </div>`;
            }
        }
    }
    
    loadKanbanData();
}

// KANBAN RENDERING (Dynamic Version)
function renderKanbanDynamic(stages, leads) {
    const board = document.getElementById('kanbanBoard');
    if(!board) return;
    board.innerHTML = '';
    const dragContainers = [];

    stages.forEach(stage => {
        const count = leads.filter(l => (l.status || 'New') === stage.name).length;
        board.innerHTML += `
            <div class="kanban-column w-72 flex-shrink-0 flex flex-col h-full">
                <div class="bg-slate-800 text-white p-3 rounded-t-xl font-bold flex justify-between items-center shadow-md">
                    <div class="flex items-center gap-3">
                        <span class="truncate">${stage.name}</span>
                        <span class="bg-slate-600 text-xs px-2 py-1 rounded-full">${count}</span>
                    </div>
                    ${stage.name !== 'New' ? `<button onclick="deleteStage('${stage._id}','${stage.name}')" class="ml-2 w-8 h-8 flex items-center justify-center rounded-full bg-red-600 hover:bg-red-500 text-white text-sm"><i class="fa-solid fa-trash"></i></button>` : ``}
                </div>
                <div class="column-body flex-1 bg-gray-200 p-3 rounded-b-xl overflow-y-auto space-y-3" id="${stage.name}"></div>
            </div>`;
    });

    setTimeout(() => {
        const stageNames = stages.map(s => s.name); // Store stage names for validation
        
        stages.forEach(stage => {
            const container = document.getElementById(stage.name);
            if (!container) {
                console.error(`Container not found for stage: ${stage.name}`);
                return;
            }
            dragContainers.push(container);
            const stageLeads = leads.filter(l => (l.status || 'New') === stage.name);
            
            stageLeads.forEach(lead => {
                const card = document.createElement('div');
                card.className = 'lead-card bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-400 cursor-grab hover:shadow-md transition';
                card.id = lead._id;
                card.draggable = false; // Let dragula handle dragging
                card.innerHTML = `<h4 class="font-bold text-gray-800">${lead.name}</h4><p class="text-xs text-gray-500 mt-1"><i class="fa-solid fa-phone"></i> ${lead.phone || '-'}</p>`;
                container.appendChild(card);
            });
        });

        if (drake) drake.destroy();
        if(window.dragula && dragContainers.length > 0) {
            drake = dragula(dragContainers, {
                revertOnSpill: false,
                copy: false
            });
            drake.on('drop', (el, target, source, sibling) => {
                // el is the dragged element (lead card)
                // target is the container where it was dropped (stage column)
                const leadId = el.id;
                // Get the stage name from the container's ID
                let newStatus = target.id;
                
                // If target doesn't have an ID or it's not a valid stage, try to find the parent container
                if (!newStatus || !stageNames.includes(newStatus)) {
                    let parent = target.parentElement;
                    let maxDepth = 5; // Prevent infinite loop
                    while (parent && maxDepth > 0 && !stageNames.includes(newStatus)) {
                        if (parent.id && stageNames.includes(parent.id)) {
                            newStatus = parent.id;
                            break;
                        }
                        parent = parent.parentElement;
                        maxDepth--;
                    }
                }
                
                if (leadId && newStatus && stageNames.includes(newStatus)) {
                    console.log(`Moving lead ${leadId} to stage: ${newStatus}`);
                    updateStatus(leadId, newStatus);
                } else {
                    console.error('Failed to get lead ID or status', { leadId, newStatus, target, stageNames });
                    // Revert the change by reloading
                    setupKanban();
                }
            });
            
            drake.on('dragend', (el) => {
                el.style.opacity = '';
            });
        } else {
            console.error('Dragula not available or no containers found', { dragula: !!window.dragula, containers: dragContainers.length });
        }
    }, 100);
}

// BACK TO DASHBOARD FUNCTION
function backToDashboard() {
    document.getElementById('dashboardViews').classList.remove('hidden');
    document.getElementById('teamManagementView').classList.add('hidden');
    document.getElementById('kanbanView').classList.add('hidden');
    document.getElementById('tableView').classList.remove('hidden');
    // Re-initialize dashboard
    if (typeof initDashboard === 'function') initDashboard();
}

// 🔥 PAGE LOAD CONTROLLER
document.addEventListener('DOMContentLoaded', () => {
    
    // Check which page we are on
    const isDashboard = document.getElementById('kanbanBoard');
    const isWhatsApp = document.getElementById('wa-contacts-list');

    if (isDashboard) {
        initDashboard();
    } else if (isWhatsApp) {
        initWhatsApp();
    }
});

// ==========================================
// 📊 DASHBOARD LOGIC
// ==========================================

async function initDashboard() {
    // Load Saved Sheet Link
    const currentUser = JSON.parse(localStorage.getItem('user'));
    if (currentUser?.id) {
        const savedLink = localStorage.getItem(`sheetLink_${currentUser.id}`);
        if(savedLink) {
            document.getElementById('sheetLink').value = savedLink;
            syncSheet(true); 
        }
    }
    // Only fetch data if not already loaded (avoid redundant API calls)
    if (!dashboardDataLoaded) {
        fetchData();
        dashboardDataLoaded = true;
    }
    
    // Optimized polling: Only sync when tab is visible, and less frequently (10 minutes)
    let sheetSyncInterval = null;
    
    const startSheetSyncPolling = () => {
        // Clear any existing interval
        if (sheetSyncInterval) {
            clearInterval(sheetSyncInterval);
        }
        // Sync sheet every 10 minutes (600000ms) instead of 5 minutes, and only if tab is visible
        sheetSyncInterval = setInterval(() => {
            // Only sync if tab is visible and sheet link exists
            if (!document.hidden) {
                const link = document.getElementById('sheetLink')?.value;
                if (link) {
                    syncSheet(true);
                }
            }
        }, 10 * 60 * 1000); // 10 minutes
    };
    
    const stopSheetSyncPolling = () => {
        if (sheetSyncInterval) {
            clearInterval(sheetSyncInterval);
            sheetSyncInterval = null;
        }
    };
    
    // Start polling
    startSheetSyncPolling();
    
    // Pause polling when tab is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopSheetSyncPolling();
        } else {
            // Resume polling when tab becomes visible
            startSheetSyncPolling();
        }
    });
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        stopSheetSyncPolling();
    });
}

async function fetchData() {
    try {
        const [leadsRes, stagesRes, statsRes, followUpRes] = await Promise.all([
            authFetch('/api/leads'), 
            authFetch('/api/stages'), 
            authFetch('/api/leads/analytics-data'),
            authFetch('/api/leads/follow-up-today')
        ]);
        if(!leadsRes) return;
        const leads = await leadsRes.json();
        allLeadsCache = leads;
        const stages = await stagesRes.json();
        const stats = await statsRes.json();
        const followUpLeads = await followUpRes.json();

        renderTable(leads, stages);
        renderKanban(stages, leads);
        renderChart(stats);
        
        // Update follow-up count only (don't render in main dashboard)
        const countElement = document.getElementById('followUpTodayCount');
        if (countElement) {
            countElement.innerText = followUpLeads.length;
        }
        
        // Store follow-up leads globally for modal
        window.followUpLeadsCache = followUpLeads;
    } catch (e) { console.error(e); }
}

function renderTable(leads, stages = []) {
    const container = document.getElementById('leadsTableBody');
    if(!container) return; // Safety check
    document.getElementById('totalCount').innerText = leads.length;
    container.innerHTML = '';

    // If no stages, ensure we at least have "New" as default
    if (stages.length === 0) {
        stages = [{ name: 'New' }];
    }

    leads.forEach(lead => {
        let dateDisplay = '-';
        if(lead.date) {
            const d = new Date(lead.date);
            if(!isNaN(d.getTime())) dateDisplay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        // Escape single quotes in lead data for JavaScript
        const safeLeadId = lead._id.replace(/'/g, "\\'");
        const safeLeadName = (lead.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const safeLeadPhone = (lead.phone || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

        const statusColors = {
            'New': 'bg-blue-100 text-blue-800', 'Contacted': 'bg-yellow-100 text-yellow-800',
            'Won': 'bg-green-100 text-green-800', 'Lost': 'bg-red-100 text-red-800'
        };
        const badgeClass = statusColors[lead.status] || 'bg-gray-100 text-gray-800';
        
        // Build stage options for this lead
        // If lead's status doesn't exist in stages, add it as an option
        const currentLeadStatus = lead.status || 'New';
        const stageNames = stages.map(s => s.name);
        const currentStageOptions = stages.map(stage => {
            const selected = currentLeadStatus === stage.name ? 'selected' : '';
            return `<option value="${stage.name}" ${selected}>${stage.name}</option>`;
        }).join('');
        
        // If lead's status is not in stages, add it as an option
        const statusOption = !stageNames.includes(currentLeadStatus) 
            ? `<option value="${currentLeadStatus}" selected>${currentLeadStatus}</option>` 
            : '';
        
        // Format follow-up date badge
        let followUpBadge = '';
        if (lead.nextFollowUpDate) {
            const followUpDate = new Date(lead.nextFollowUpDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const followUpDateOnly = new Date(followUpDate);
            followUpDateOnly.setHours(0, 0, 0, 0);
            const isToday = followUpDateOnly.getTime() === today.getTime();
            const isOverdue = followUpDateOnly.getTime() < today.getTime();
            const followUpDisplay = followUpDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const badgeColor = isToday ? 'text-orange-600 bg-orange-50' : (isOverdue ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50');
            const badgeText = isToday ? ' (Today!)' : (isOverdue ? ' (Overdue!)' : '');
            followUpBadge = `<span class="text-xs font-medium ${badgeColor} px-2 py-1 rounded-full"><i class="fa-solid fa-bell mr-1"></i> Follow-up: ${followUpDisplay}${badgeText}</span>`;
        }

        const card = `
        <div class="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition border-l-4 border-blue-500 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div class="flex-1 cursor-pointer" onclick="openModal('${safeLeadId}')">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold">
                        ${lead.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h3 class="font-bold text-gray-800 text-lg hover:text-blue-600 transition">${lead.name}</h3>
                        <p class="text-sm text-gray-500 flex items-center gap-3">
                            <span><i class="fa-solid fa-phone text-xs mr-1"></i> ${lead.phone || 'N/A'}</span>
                            <span class="hidden md:inline">|</span>
                            <span class="hidden md:inline"><i class="fa-solid fa-envelope text-xs mr-1"></i> ${lead.email || '-'}</span>
                        </p>
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-4 flex-wrap">
                <div class="flex items-center gap-2">
                    <label class="text-xs text-gray-500 font-medium hidden md:block">Stage:</label>
                    <select onchange="changeLeadStage('${safeLeadId}', this.value)" 
                            class="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer shadow-sm min-w-[140px]">
                        ${currentStageOptions}${statusOption}
                    </select>
                </div>
                <span class="text-xs text-gray-400 font-medium"><i class="fa-regular fa-calendar mr-1"></i> Created: ${dateDisplay}</span>
                ${followUpBadge}
            </div>
            <div class="flex items-center gap-2">
                <button onclick="event.stopPropagation(); openModal('${safeLeadId}')" class="flex items-center gap-1 bg-orange-50 hover:bg-orange-100 text-orange-600 px-3 py-2 rounded-lg text-sm font-medium transition border border-orange-200"><i class="fa-regular fa-note-sticky"></i> Note</button>
                <button onclick="event.stopPropagation(); editLead('${safeLeadId}')" class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-blue-100 hover:text-blue-600 transition text-gray-500" title="Edit Lead"><i class="fa-solid fa-pen"></i></button>
                <button onclick="event.stopPropagation(); deleteLead('${safeLeadId}')" class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-red-100 hover:text-red-600 transition text-gray-500"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
        container.innerHTML += card;
    });
}

function renderKanban(stages, leads) {
    const board = document.getElementById('kanbanBoard');
    if(!board) return;
    board.innerHTML = ''; 
    const dragContainers = []; 

    stages.forEach(stage => {
        const count = leads.filter(l => (l.status || 'New') === stage.name).length;
        board.innerHTML += `
            <div class="kanban-column w-72 flex-shrink-0 flex flex-col h-full">
                <div class="bg-slate-800 text-white p-3 rounded-t-xl font-bold flex justify-between items-center shadow-md">
                    <div class="flex items-center gap-3">
                        <span class="truncate">${stage.name}</span>
                        <span class="bg-slate-600 text-xs px-2 py-1 rounded-full">${count}</span>
                    </div>
                    ${stage.name !== 'New' ? `<button onclick="deleteStage('${stage._id}','${stage.name}')" class="ml-2 w-8 h-8 flex items-center justify-center rounded-full bg-red-600 hover:bg-red-500 text-white text-sm"><i class="fa-solid fa-trash"></i></button>` : ``}
                </div>
                <div class="column-body flex-1 bg-gray-200 p-3 rounded-b-xl overflow-y-auto space-y-3" id="${stage.name}"></div>
            </div>`;
    });

    setTimeout(() => {
        const stageNames = stages.map(s => s.name); // Store stage names for validation
        
        stages.forEach(stage => {
            const container = document.getElementById(stage.name);
            if (!container) {
                console.error(`Container not found for stage: ${stage.name}`);
                return;
            }
            dragContainers.push(container);
            const stageLeads = leads.filter(l => (l.status || 'New') === stage.name);
            
            stageLeads.forEach(lead => {
                const card = document.createElement('div');
                card.className = 'lead-card bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-400 cursor-grab hover:shadow-md transition';
                card.id = lead._id;
                card.draggable = false; // Let dragula handle dragging
                card.innerHTML = `<h4 class="font-bold text-gray-800">${lead.name}</h4><p class="text-xs text-gray-500 mt-1"><i class="fa-solid fa-phone"></i> ${lead.phone || '-'}</p>`;
                container.appendChild(card);
            });
        });

        if (drake) drake.destroy();
        if(window.dragula && dragContainers.length > 0) {
            drake = dragula(dragContainers, {
                revertOnSpill: false,
                copy: false
            });
            drake.on('drop', (el, target, source, sibling) => {
                // el is the dragged element (lead card)
                // target is the container where it was dropped (stage column)
                const leadId = el.id;
                // Get the stage name from the container's ID
                let newStatus = target.id;
                
                // If target doesn't have an ID or it's not a valid stage, try to find the parent container
                if (!newStatus || !stageNames.includes(newStatus)) {
                    let parent = target.parentElement;
                    let maxDepth = 5; // Prevent infinite loop
                    while (parent && maxDepth > 0 && !stageNames.includes(newStatus)) {
                        if (parent.id && stageNames.includes(parent.id)) {
                            newStatus = parent.id;
                            break;
                        }
                        parent = parent.parentElement;
                        maxDepth--;
                    }
                }
                
                if (leadId && newStatus && stageNames.includes(newStatus)) {
                    console.log(`Moving lead ${leadId} to stage: ${newStatus}`);
                    updateStatus(leadId, newStatus);
                } else {
                    console.error('Failed to get lead ID or status', { leadId, newStatus, target, stageNames });
                    // Revert the change by reloading
                    setupKanban();
                }
            });
            
            drake.on('dragend', (el) => {
                el.style.opacity = '';
            });
        } else {
            console.error('Dragula not available or no containers found', { dragula: !!window.dragula, containers: dragContainers.length });
        }
    }, 100);
}

// Chart Logic
let myChart;
function renderChart(stats) {
    const ctx = document.getElementById('myChart');
    if(!ctx) return;
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(stats),
            datasets: [{ data: Object.values(stats), backgroundColor: ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

// ==========================================
// 🟢 WHATSAPP LOGIC
// ==========================================

async function initWhatsApp() {
    await fetchWhatsAppLeads();
    loadWhatsAppAnalytics();
    
    // Optimized polling: Only refresh when tab is visible, and less frequently (2 minutes)
    let analyticsInterval = null;
    
    const startAnalyticsPolling = () => {
        if (analyticsInterval) {
            clearInterval(analyticsInterval);
        }
        analyticsInterval = setInterval(() => {
            if (!document.hidden) {
                loadWhatsAppAnalytics();
            }
        }, 120000); // 2 minutes
    };
    
    const stopAnalyticsPolling = () => {
        if (analyticsInterval) {
            clearInterval(analyticsInterval);
            analyticsInterval = null;
        }
    };
    
    startAnalyticsPolling();
    
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAnalyticsPolling();
        } else {
            loadWhatsAppAnalytics();
            startAnalyticsPolling();
        }
    });
    
    window.addEventListener('beforeunload', () => {
        stopAnalyticsPolling();
    });
}

// Load WhatsApp analytics
async function loadWhatsAppAnalytics() {
    try {
        const res = await authFetch('/api/whatsapp-logs/analytics');
        if (res && res.ok) {
            const analytics = await res.json();
            updateWhatsAppAnalytics(analytics);
        }
    } catch (err) {
        console.error('Error loading WhatsApp analytics:', err);
    }
}

// Update WhatsApp analytics display
function updateWhatsAppAnalytics(analytics) {
    const sentTodayEl = document.getElementById('waSentTodayCount');
    const failedTodayEl = document.getElementById('waFailedTodayCount');
    const sentThisMonthEl = document.getElementById('waSentThisMonthCount');
    const automatedSentTodayEl = document.getElementById('waAutomatedSentTodayCount');
    
    if (sentTodayEl) sentTodayEl.textContent = analytics.today.sent || 0;
    if (failedTodayEl) failedTodayEl.textContent = analytics.today.failed || 0;
    if (sentThisMonthEl) sentThisMonthEl.textContent = analytics.thisMonth.sent || 0;
    if (automatedSentTodayEl) automatedSentTodayEl.textContent = analytics.today.automated.sent || 0;
}

async function fetchWhatsAppLeads() {
    const listContainer = document.getElementById('wa-contacts-list');
    listContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">Syncing...</p>';

    try {
        const res = await authFetch('/api/whatsapp/leads');
        const leads = await res.json();
        allLeadsCache = leads; // Update cache for search logic
        
        listContainer.innerHTML = '';

        if(leads.length === 0) {
            listContainer.innerHTML = '<p class="text-center text-gray-400 mt-10 text-sm">No WhatsApp chats yet.</p>';
            return;
        }

        leads.forEach(lead => {
            const div = document.createElement('div');
            div.className = "flex items-center gap-3 p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition";
            div.onclick = () => openChat(lead);
            
            div.innerHTML = `
                <div class="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-lg flex-shrink-0">
                    ${lead.name.charAt(0).toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start">
                        <h4 class="font-semibold text-gray-800 truncate">${lead.name}</h4>
                        <span class="text-xs text-gray-400 whitespace-nowrap">Today</span>
                    </div>
                    <p class="text-sm text-gray-500 truncate flex items-center gap-1">
                        <i class="fa-solid fa-check-double text-blue-400 text-xs"></i> 
                        ${lead.phone}
                    </p>
                </div>
            `;
            listContainer.appendChild(div);
        });

    } catch (err) {
        console.error(err);
        listContainer.innerHTML = '<p class="text-center text-red-400 mt-10">Failed to load chats.</p>';
    }
}

// 👇 OPEN CHAT FUNCTION
function openChat(lead) {
    // 🔥 CRITICAL: Set the current Lead ID so Send Button knows who to message
    currentLeadId = lead._id;

    // 1. UI Elements Show
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('chat-header').classList.remove('hidden');
    document.getElementById('chat-input-area').classList.remove('hidden');

    // 2. Header Info Set
    document.getElementById('chat-name').innerText = lead.name;
    document.getElementById('chat-phone').innerText = lead.phone;
    document.getElementById('chat-avatar').innerText = lead.name.charAt(0).toUpperCase();

    // 3. Render Messages
    const msgContainer = document.getElementById('chat-messages');
    msgContainer.innerHTML = ''; 

    // Handle Empty Chat
    if (!lead.messages || lead.messages.length === 0) {
        msgContainer.innerHTML = '<p class="text-center text-gray-400 text-xs mt-4">No conversation yet.</p>';
        return;
    }

    // Loop through REAL messages from DB
    lead.messages.forEach(msg => {
        // Time Format
        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Determine Sender
        const isCustomer = msg.from === 'lead';

        // Create HTML
        const msgDiv = document.createElement('div');
        msgDiv.className = `flex ${isCustomer ? 'justify-start' : 'justify-end'} mb-2`;

        msgDiv.innerHTML = `
            <div class="${isCustomer ? 'bg-white text-gray-800' : 'bg-[#d9fdd3] text-gray-800'} p-2 px-3 rounded-lg shadow-sm max-w-xs text-sm ${isCustomer ? 'rounded-tl-none' : 'rounded-tr-none'}">
                <p>${msg.text}</p>
                <span class="text-[10px] ${isCustomer ? 'text-gray-400' : 'text-gray-500'} block text-right mt-1">
                    ${time}
                </span>
            </div>
        `;
        msgContainer.appendChild(msgDiv);
    });

    // 4. Scroll to Bottom
    msgContainer.scrollTop = msgContainer.scrollHeight;
}

// 👇 ENTER KEY HANDLER
function handleEnter(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// 👇 SEND MESSAGE FUNCTION
async function sendMessage() {
    // 🔥 Changed selector to match your new HTML ID
    const input = document.getElementById('msgInput');
    const message = input.value;
    
    // Validations
    if (!message.trim()) return;
    if (!currentLeadId) {
        showNotification("Please select a chat first!", "warning");
        return;
    }

    // UI se current Lead ka phone nikalo
    const currentLead = allLeadsCache.find(l => l._id === currentLeadId);
    if(!currentLead) return;

    // Button ko disable karo
    const btn = document.querySelector('#chat-input-area button'); // Can keep querySelector here or give button an ID too
    const originalIcon = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        // Backend API Call
        const res = await authFetch('/api/whatsapp/send', {
            method: 'POST',
            body: JSON.stringify({
                phone: currentLead.phone,
                message: message,
                leadId: currentLeadId
            })
        });

        const data = await res.json();

        if (data.success) {
            // ✅ Success: UI mein message turant dikhao
            const msgContainer = document.getElementById('chat-messages');
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const msgDiv = document.createElement('div');
            msgDiv.className = `flex justify-end mb-2`;
            msgDiv.innerHTML = `
                <div class="bg-[#d9fdd3] text-gray-800 p-2 px-3 rounded-lg shadow-sm max-w-xs text-sm rounded-tr-none">
                    <p>${message}</p>
                    <span class="text-[10px] text-gray-500 block text-right mt-1">${time} <i class="fa-solid fa-check text-gray-400"></i></span>
                </div>
            `;
            msgContainer.appendChild(msgDiv);
            msgContainer.scrollTop = msgContainer.scrollHeight;

            // Input clear karo
            input.value = '';
            
            // Note: Hum message ko cache mein bhi push kar sakte hain taaki refresh na karna pade
            if(!currentLead.messages) currentLead.messages = [];
            currentLead.messages.push({
                text: message,
                from: 'admin',
                timestamp: new Date()
            });

        } else {
            showNotification("Failed to send: " + (data.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error(err);
        showNotification("Error sending message", "error");
    }

    // Button reset
    btn.disabled = false;
    btn.innerHTML = originalIcon;
}

// ==========================================
// WHATSAPP CONFIGURATION FUNCTIONS
// ==========================================

// Switch WhatsApp view (Inbox/Settings)
function switchWhatsAppView(view) {
    const inboxView = document.getElementById('waInboxView');
    const templatesView = document.getElementById('waTemplatesView');
    const settingsView = document.getElementById('waSettingsView');
    const inboxBtn = document.getElementById('waInboxBtn');
    const templatesBtn = document.getElementById('waTemplatesBtn');
    const settingsBtn = document.getElementById('waSettingsBtn');
    const headerTitle = document.getElementById('waHeaderTitle');
    const statusBadge = document.getElementById('waStatusBadge');
    
    // Hide all views
    inboxView.classList.add('hidden');
    templatesView.classList.add('hidden');
    settingsView.classList.add('hidden');
    
    // Reset all buttons
    inboxBtn.classList.remove('border-green-500', 'text-green-600');
    inboxBtn.classList.add('border-transparent', 'text-gray-700');
    templatesBtn.classList.remove('border-green-500', 'text-green-600');
    templatesBtn.classList.add('border-transparent', 'text-gray-600');
    settingsBtn.classList.remove('border-green-500', 'text-green-600');
    settingsBtn.classList.add('border-transparent', 'text-gray-600');
    
    if (view === 'templates') {
        templatesView.classList.remove('hidden');
        templatesBtn.classList.add('border-green-500', 'text-green-600');
        templatesBtn.classList.remove('border-transparent', 'text-gray-600');
        headerTitle.textContent = 'Templates';
        if (statusBadge) statusBadge.classList.add('hidden');
        loadWhatsAppTemplates();
    } else if (view === 'settings') {
        settingsView.classList.remove('hidden');
        settingsBtn.classList.add('border-green-500', 'text-green-600');
        settingsBtn.classList.remove('border-transparent', 'text-gray-600');
        headerTitle.textContent = 'Settings';
        if (statusBadge) statusBadge.classList.add('hidden');
        loadWhatsAppConfig();
    } else {
        inboxView.classList.remove('hidden');
        inboxBtn.classList.add('border-green-500', 'text-green-600');
        inboxBtn.classList.remove('border-transparent', 'text-gray-700');
        headerTitle.textContent = 'Inbox';
        if (statusBadge) statusBadge.classList.remove('hidden');
        loadWhatsAppInbox();
    }
}

// Load WhatsApp inbox (logs)
async function loadWhatsAppInbox() {
    const inboxView = document.getElementById('waInboxView');
    if (!inboxView) return;
    
    // Show loading state
    inboxView.innerHTML = `
        <div class="p-6">
            <div class="flex items-center justify-center py-12">
                <i class="fa-solid fa-spinner fa-spin text-green-600 text-2xl mr-3"></i>
                <span class="text-gray-600">Loading WhatsApp messages...</span>
            </div>
        </div>
    `;
    
    try {
        const res = await authFetch('/api/whatsapp-logs/logs?page=1&limit=50');
        if (res && res.ok) {
            const data = await res.json();
            renderWhatsAppInbox(data.logs || [], data.pagination || {});
        } else {
            inboxView.innerHTML = `
                <div class="p-6">
                    <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                        <i class="fa-solid fa-exclamation-circle mr-2"></i>
                        Failed to load WhatsApp messages
                    </div>
                </div>
            `;
        }
    } catch (err) {
        console.error('Error loading WhatsApp inbox:', err);
        inboxView.innerHTML = `
            <div class="p-6">
                <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                    <i class="fa-solid fa-exclamation-circle mr-2"></i>
                    Error loading WhatsApp messages
                </div>
            </div>
        `;
    }
}

// Render WhatsApp inbox
function renderWhatsAppInbox(logs, pagination) {
    const inboxView = document.getElementById('waInboxView');
    if (!inboxView) return;
    
    if (logs.length === 0) {
        inboxView.innerHTML = `
            <div class="p-6">
                <div class="text-center py-12 text-gray-500">
                    <i class="fa-solid fa-inbox text-4xl mb-4 opacity-50"></i>
                    <p class="text-lg">No WhatsApp messages yet</p>
                </div>
            </div>
        `;
        return;
    }
    
    const logsHtml = logs.map(log => {
        const date = new Date(log.sentAt);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        const statusBadge = log.status === 'sent' 
            ? '<span class="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Sent</span>'
            : '<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">Failed</span>';
        const automatedBadge = log.isAutomated 
            ? '<span class="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs">Auto</span>'
            : '';
        
        return `
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-3 hover:shadow-md transition">
                <div class="flex items-start justify-between mb-2">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="font-semibold text-gray-800">${escapeHtml(log.to)}</span>
                            ${statusBadge}
                            ${automatedBadge}
                        </div>
                        <p class="text-sm text-gray-600 mb-2">${escapeHtml(log.message.substring(0, 100))}${log.message.length > 100 ? '...' : ''}</p>
                        <p class="text-xs text-gray-400">${dateStr}</p>
                    </div>
                </div>
                ${log.error ? `<p class="text-xs text-red-600 mt-2"><i class="fa-solid fa-exclamation-circle mr-1"></i>${escapeHtml(log.error)}</p>` : ''}
            </div>
        `;
    }).join('');
    
    inboxView.innerHTML = `
        <div class="p-6">
            <div class="mb-4">
                <h3 class="text-lg font-semibold text-gray-800">WhatsApp Messages</h3>
                <p class="text-sm text-gray-500">Total: ${pagination.total || logs.length} messages</p>
            </div>
            <div class="space-y-3">
                ${logsHtml}
            </div>
        </div>
    `;
}

// Load WhatsApp configuration
async function loadWhatsAppConfig() {
    const statusIcon = document.getElementById('whatsappConfigStatusIcon');
    const statusText = document.getElementById('whatsappConfigStatusText');
    
    // Early return if elements don't exist
    if (!statusIcon || !statusText) {
        console.warn('WhatsApp config status elements not found');
        return;
    }
    
    // Show loading state
    statusIcon.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-gray-400"></i>';
    statusText.textContent = 'Loading...';
    statusText.classList.remove('text-green-600', 'text-gray-500', 'font-medium', 'text-red-500');
    statusText.classList.add('text-gray-400');
    
    try {
        const res = await authFetch('/api/whatsapp/config');
        if (res && res.ok) {
            const config = await res.json();
            
            // Fill form fields
            const phoneInput = document.getElementById('configWaPhoneNumberId');
            const businessInput = document.getElementById('configWaBusinessId');
            if (phoneInput) phoneInput.value = config.waPhoneNumberId || '';
            if (businessInput) businessInput.value = config.waBusinessId || '';
            
            // Update status
            if (config.isConfigured) {
                statusIcon.innerHTML = '<i class="fa-solid fa-check-circle text-green-500"></i>';
                statusText.textContent = `WhatsApp configured: ${config.waPhoneNumberId || 'Phone Number ID set'}`;
                statusText.classList.remove('text-gray-500', 'text-gray-400', 'text-red-500');
                statusText.classList.add('text-green-600', 'font-medium');
            } else {
                statusIcon.innerHTML = '<i class="fa-solid fa-exclamation-circle text-yellow-500"></i>';
                statusText.textContent = 'WhatsApp not configured. Please configure your WhatsApp settings.';
                statusText.classList.remove('text-green-600', 'font-medium', 'text-gray-400', 'text-red-500');
                statusText.classList.add('text-gray-500');
            }
        } else {
            console.error('Failed to load WhatsApp config');
            statusIcon.innerHTML = '<i class="fa-solid fa-exclamation-circle text-red-500"></i>';
            statusText.textContent = 'Failed to load configuration';
            statusText.classList.remove('text-green-600', 'font-medium', 'text-gray-400', 'text-gray-500');
            statusText.classList.add('text-red-500');
        }
    } catch (err) {
        console.error('Error loading WhatsApp config:', err);
        statusIcon.innerHTML = '<i class="fa-solid fa-exclamation-circle text-red-500"></i>';
        statusText.textContent = 'Error loading configuration';
        statusText.classList.remove('text-green-600', 'font-medium', 'text-gray-400', 'text-gray-500');
        statusText.classList.add('text-red-500');
    }
}

// Save WhatsApp configuration
async function saveWhatsAppConfig(event) {
    event.preventDefault();
    
    const waPhoneNumberId = document.getElementById('configWaPhoneNumberId').value.trim();
    const waAccessToken = document.getElementById('configWaAccessToken').value;
    const waBusinessId = document.getElementById('configWaBusinessId').value.trim();
    
    const statusDiv = document.getElementById('whatsappConfigStatus');
    statusDiv.classList.add('hidden');
    statusDiv.innerHTML = '';
    
    try {
        const res = await authFetch('/api/whatsapp/config', {
            method: 'PUT',
            body: JSON.stringify({
                waPhoneNumberId,
                waAccessToken,
                waBusinessId: waBusinessId || undefined
            })
        });
        
        if (res && res.ok) {
            const data = await res.json();
            
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-green-50 border border-green-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-green-700">
                    <i class="fa-solid fa-check-circle"></i>
                    <span class="font-medium">${data.message || 'WhatsApp configuration saved successfully!'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
            
            // Clear token field
            document.getElementById('configWaAccessToken').value = '';
            
            // Reload config to update status
            loadWhatsAppConfig();
        } else {
            const error = await res.json();
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-red-700">
                    <i class="fa-solid fa-exclamation-circle"></i>
                    <span>${error.message || 'Failed to save WhatsApp configuration'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Error saving WhatsApp config:', err);
        statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
        statusDiv.innerHTML = `
            <div class="flex items-center gap-2 text-red-700">
                <i class="fa-solid fa-exclamation-circle"></i>
                <span>Error saving WhatsApp configuration. Please try again.</span>
            </div>
        `;
        statusDiv.classList.remove('hidden');
    }
}

// Test WhatsApp configuration
async function testWhatsAppConfig() {
    const waPhoneNumberId = document.getElementById('configWaPhoneNumberId').value.trim();
    const waAccessToken = document.getElementById('configWaAccessToken').value;
    
    const statusDiv = document.getElementById('whatsappConfigStatus');
    statusDiv.classList.add('hidden');
    statusDiv.innerHTML = '';
    
    if (!waPhoneNumberId || !waAccessToken) {
        statusDiv.className = 'p-4 rounded-lg mb-4 bg-yellow-50 border border-yellow-200';
        statusDiv.innerHTML = `
            <div class="flex items-center gap-2 text-yellow-700">
                <i class="fa-solid fa-exclamation-circle"></i>
                <span>Please enter Phone Number ID and Access Token first</span>
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
            <span>Testing WhatsApp connection...</span>
        </div>
    `;
    statusDiv.classList.remove('hidden');
    
    try {
        const res = await authFetch('/api/whatsapp/config/test', {
            method: 'POST',
            body: JSON.stringify({
                waPhoneNumberId,
                waAccessToken
            })
        });
        
        if (res && res.ok) {
            const data = await res.json();
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-green-50 border border-green-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-green-700">
                    <i class="fa-solid fa-check-circle"></i>
                    <span class="font-medium">${data.message || 'WhatsApp connection successful!'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
        } else {
            const error = await res.json();
            statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
            statusDiv.innerHTML = `
                <div class="flex items-center gap-2 text-red-700">
                    <i class="fa-solid fa-exclamation-circle"></i>
                    <span>${error.message || 'Failed to test WhatsApp configuration. Please check your credentials.'}</span>
                </div>
            `;
            statusDiv.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Error testing WhatsApp config:', err);
        statusDiv.className = 'p-4 rounded-lg mb-4 bg-red-50 border border-red-200';
        statusDiv.innerHTML = `
            <div class="flex items-center gap-2 text-red-700">
                <i class="fa-solid fa-exclamation-circle"></i>
                <span>Error testing WhatsApp configuration. Please try again.</span>
            </div>
        `;
        statusDiv.classList.remove('hidden');
    }
}

// ==========================================
// WHATSAPP TEMPLATE FUNCTIONS
// ==========================================

let currentWhatsAppTemplateId = null;
let allWhatsAppStages = [];
let allWhatsAppTemplates = [];

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load WhatsApp templates
async function loadWhatsAppTemplates() {
    try {
        const res = await authFetch('/api/whatsapp/templates');
        if (res && res.ok) {
            allWhatsAppTemplates = await res.json();
            renderWhatsAppTemplates(allWhatsAppTemplates);
        } else {
            console.error('Failed to load WhatsApp templates');
            const container = document.getElementById('waTemplatesContainer');
            if (container) {
                container.innerHTML = '<p class="col-span-full text-center text-red-400 py-10">Failed to load templates</p>';
            }
        }
    } catch (err) {
        console.error('Error loading WhatsApp templates:', err);
    }
}

// Load stages for dropdown
async function loadWhatsAppStages() {
    try {
        const res = await authFetch('/api/stages');
        if (res && res.ok) {
            allWhatsAppStages = await res.json();
            const stageSelect = document.getElementById('waTemplateStage');
            if (stageSelect) {
                stageSelect.innerHTML = '<option value="">Select Stage...</option>';
                allWhatsAppStages.forEach(stage => {
                    stageSelect.innerHTML += `<option value="${stage.name}">${stage.name}</option>`;
                });
            }
        }
    } catch (err) {
        console.error('Error loading stages:', err);
    }
}

// Render WhatsApp templates
function renderWhatsAppTemplates(templates) {
    const container = document.getElementById('waTemplatesContainer');
    if (!container) return;

    if (!templates || templates.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-16">
                <div class="inline-flex items-center justify-center w-24 h-24 bg-gray-100 rounded-full mb-6">
                    <i class="fa-brands fa-whatsapp text-5xl text-gray-300"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-700 mb-2">No Templates Yet</h3>
                <p class="text-gray-500 mb-6">Create your first WhatsApp template to get started</p>
                <button onclick="openWhatsAppTemplateModal()" class="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-semibold transition shadow-lg flex items-center gap-2 mx-auto">
                    <i class="fa-solid fa-plus"></i> Create Your First Template
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = templates.map(template => {
        // Type badge
        const typeBadge = template.isMarketing 
            ? `<span class="px-3 py-1 bg-orange-100 text-orange-700 text-xs font-semibold rounded-full border border-orange-200">
                <i class="fa-solid fa-bullhorn mr-1"></i>Marketing
            </span>`
            : `<span class="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full border border-blue-200">
                <i class="fa-solid fa-toolbox mr-1"></i>Utility
            </span>`;
        
        // Review status badge
        let reviewBadge = '';
        if (template.isMarketing) {
            const statusConfig = {
                'draft': { class: 'bg-gray-100 text-gray-700 border-gray-300', icon: 'fa-edit', text: 'Draft' },
                'pending_review': { class: 'bg-yellow-100 text-yellow-700 border-yellow-300', icon: 'fa-clock', text: 'Pending Review' },
                'approved': { class: 'bg-green-100 text-green-700 border-green-300', icon: 'fa-check-circle', text: 'Approved' },
                'rejected': { class: 'bg-red-100 text-red-700 border-red-300', icon: 'fa-times-circle', text: 'Rejected' }
            };
            const config = statusConfig[template.reviewStatus] || statusConfig.draft;
            reviewBadge = `<span class="px-3 py-1 ${config.class} text-xs font-semibold rounded-full border">
                <i class="fa-solid ${config.icon} mr-1"></i>${config.text}
            </span>`;
        }
        
        // Automation badge
        const automationBadge = template.isAutomated 
            ? `<span class="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full border border-purple-200">
                <i class="fa-solid fa-robot mr-1"></i>${template.triggerType === 'on_lead_create' ? 'Auto: New Lead' : template.triggerType === 'on_stage_change' ? `Auto: ${template.stage || 'Stage'}` : 'Automated'}
            </span>`
            : '';
        
        // Status badge
        const statusBadge = template.isActive
            ? '<span class="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full border border-green-200">Active</span>'
            : '<span class="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full border border-gray-200">Inactive</span>';

        const messagePreview = template.message ? (template.message.length > 120 ? template.message.substring(0, 120) + '...' : template.message) : 'No message';
        const createdDate = new Date(template.createdAt).toLocaleDateString();

        return `
            <div class="bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-gray-200 overflow-hidden">
                <div class="p-6">
                    <div class="flex items-start justify-between mb-4">
                        <div class="flex-1">
                            <h3 class="text-lg font-bold text-gray-800 mb-1">${escapeHtml(template.name)}</h3>
                            <p class="text-xs text-gray-500">Created ${createdDate}</p>
                        </div>
                    </div>
                    
                    <p class="text-sm text-gray-600 mb-4 line-clamp-3 min-h-[3.5rem]">${escapeHtml(messagePreview)}</p>
                    
                    <div class="flex flex-wrap gap-2 mb-4">
                        ${typeBadge}
                        ${reviewBadge}
                        ${automationBadge}
                        ${statusBadge}
                    </div>
                    
                    ${template.isMarketing && template.reviewStatus === 'rejected' && template.rejectionReason ? `
                        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <p class="text-xs font-semibold text-red-800 mb-1">Rejection Reason:</p>
                            <p class="text-xs text-red-700">${escapeHtml(template.rejectionReason)}</p>
                        </div>
                    ` : ''}
                </div>
                
                <div class="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-2">
                    <button onclick="editWhatsAppTemplate('${template._id}')" 
                        class="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm flex items-center justify-center gap-2">
                        <i class="fa-solid fa-edit"></i> Edit
                    </button>
                    ${template.isMarketing && template.reviewStatus === 'draft' ? `
                        <button onclick="submitWhatsAppTemplateForReview('${template._id}')" 
                            class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm flex items-center justify-center gap-2">
                            <i class="fa-solid fa-paper-plane"></i>
                        </button>
                    ` : ''}
                    <button onclick="deleteWhatsAppTemplate('${template._id}')" 
                        class="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm flex items-center justify-center">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Toggle marketing template settings
function toggleMarketingTemplate() {
    const utilityRadio = document.getElementById('waTemplateTypeUtility');
    const marketingRadio = document.getElementById('waTemplateTypeMarketing');
    const hintEl = document.getElementById('waTemplateTypeHint');
    const charLimitEl = document.getElementById('waMessageCharLimit');
    const submitBtn = document.getElementById('waSubmitForReviewBtn');
    const messageTextarea = document.getElementById('waTemplateMessage');
    
    const isMarketing = marketingRadio && marketingRadio.checked;
    
    if (hintEl) {
        hintEl.textContent = isMarketing 
            ? 'Marketing templates require approval (max 550 chars)'
            : 'Utility templates don\'t require approval (max 1024 chars)';
    }
    
    if (charLimitEl) {
        charLimitEl.textContent = isMarketing ? '550' : '1024';
    }
    
    if (submitBtn) {
        submitBtn.classList.toggle('hidden', !isMarketing);
    }
    
    // Update character count if message exists
    if (messageTextarea) {
        updateWhatsAppCharCount();
    }
}

// Update WhatsApp message character count
function updateWhatsAppCharCount() {
    const messageTextarea = document.getElementById('waTemplateMessage');
    const charCountEl = document.getElementById('waMessageCharCount');
    const charLimitEl = document.getElementById('waMessageCharLimit');
    
    if (!messageTextarea || !charCountEl) return;
    
    const length = messageTextarea.value.length;
    const limit = parseInt(charLimitEl?.textContent || '1024');
    
    charCountEl.textContent = length;
    
    // Change color based on limit
    if (length > limit) {
        charCountEl.classList.add('text-red-600', 'font-bold');
        charCountEl.classList.remove('text-gray-500');
    } else if (length > limit * 0.9) {
        charCountEl.classList.add('text-yellow-600', 'font-semibold');
        charCountEl.classList.remove('text-gray-500', 'text-red-600');
    } else {
        charCountEl.classList.remove('text-red-600', 'text-yellow-600', 'font-bold', 'font-semibold');
        charCountEl.classList.add('text-gray-500');
    }
}

// Open create template modal
function openWhatsAppTemplateModal() {
    currentWhatsAppTemplateId = null;
    const titleEl = document.getElementById('waTemplateModalTitle');
    if (titleEl) {
        titleEl.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Create WhatsApp Template';
    }
    const form = document.getElementById('waTemplateForm');
    if (form) form.reset();
    const isActive = document.getElementById('waTemplateIsActive');
    if (isActive) isActive.checked = true;
    const isAutomated = document.getElementById('waTemplateIsAutomated');
    if (isAutomated) isAutomated.checked = false;
    toggleWhatsAppAutomationSettings();
    
    // Reset template type to utility
    const utilityRadio = document.getElementById('waTemplateTypeUtility');
    if (utilityRadio) utilityRadio.checked = true;
    toggleMarketingTemplate();
    
    const modal = document.getElementById('waTemplateModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
    loadWhatsAppStages();
    
    // Add character count listener
    const messageTextarea = document.getElementById('waTemplateMessage');
    if (messageTextarea) {
        messageTextarea.removeEventListener('input', updateWhatsAppCharCount);
        messageTextarea.addEventListener('input', updateWhatsAppCharCount);
        updateWhatsAppCharCount();
    }
}

// Close template modal
function closeWhatsAppTemplateModal() {
    const modal = document.getElementById('waTemplateModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    currentWhatsAppTemplateId = null;
}

// Toggle automation settings
function toggleWhatsAppAutomationSettings() {
    const isAutomated = document.getElementById('waTemplateIsAutomated');
    const automationSettings = document.getElementById('waAutomationSettings');
    const stageSelector = document.getElementById('waStageSelector');
    const triggerType = document.getElementById('waTemplateTriggerType');
    
    if (!isAutomated || !automationSettings) return;
    
    if (isAutomated.checked) {
        automationSettings.classList.remove('hidden');
        if (triggerType && triggerType.value === 'on_stage_change') {
            if (stageSelector) stageSelector.classList.remove('hidden');
        } else {
            if (stageSelector) stageSelector.classList.add('hidden');
        }
    } else {
        automationSettings.classList.add('hidden');
        if (stageSelector) stageSelector.classList.add('hidden');
    }
}

// Trigger type change handler
document.addEventListener('DOMContentLoaded', () => {
    const triggerType = document.getElementById('waTemplateTriggerType');
    if (triggerType) {
        triggerType.addEventListener('change', () => {
            const stageSelector = document.getElementById('waStageSelector');
            if (triggerType.value === 'on_stage_change') {
                if (stageSelector) stageSelector.classList.remove('hidden');
            } else {
                if (stageSelector) stageSelector.classList.add('hidden');
            }
        });
    }
});

// Save WhatsApp template
async function saveWhatsAppTemplate(event) {
    event.preventDefault();
    
    const name = document.getElementById('waTemplateName').value.trim();
    const message = document.getElementById('waTemplateMessage').value.trim();
    const isActive = document.getElementById('waTemplateIsActive').checked;
    const isAutomated = document.getElementById('waTemplateIsAutomated').checked;
    const triggerType = document.getElementById('waTemplateTriggerType').value;
    const stage = document.getElementById('waTemplateStage')?.value || null;
    const marketingRadio = document.getElementById('waTemplateTypeMarketing');
    const isMarketing = marketingRadio && marketingRadio.checked;

    if (!name || !message) {
        alert('Please fill in all required fields');
        return;
    }
    
    // Validate character limits
    const charLimit = isMarketing ? 550 : 1024;
    if (message.length > charLimit) {
        alert(`Message exceeds ${charLimit} character limit for ${isMarketing ? 'marketing' : 'utility'} templates`);
        return;
    }

    try {
        const url = currentWhatsAppTemplateId 
            ? `/api/whatsapp/templates/${currentWhatsAppTemplateId}`
            : '/api/whatsapp/templates';
        
        const method = currentWhatsAppTemplateId ? 'PUT' : 'POST';
        
        const res = await authFetch(url, {
            method: method,
            body: JSON.stringify({
                name,
                message,
                isActive,
                isAutomated: isAutomated ? true : false,
                triggerType: isAutomated ? triggerType : 'manual',
                stage: (isAutomated && triggerType === 'on_stage_change') ? stage : null,
                isMarketing: isMarketing || false
            })
        });

        if (res && res.ok) {
            closeWhatsAppTemplateModal();
            await loadWhatsAppTemplates();
            alert(currentWhatsAppTemplateId ? 'Template updated successfully!' : 'Template created successfully!');
        } else {
            const error = await res.json();
            alert(error.message || 'Error saving template');
        }
    } catch (err) {
        console.error('Error saving WhatsApp template:', err);
        alert('Error saving template');
    }
}

// Edit WhatsApp template
async function editWhatsAppTemplate(id) {
    try {
        const res = await authFetch(`/api/whatsapp/templates/${id}`);
        if (res && res.ok) {
            const template = await res.json();
            currentWhatsAppTemplateId = id;
            
            const titleEl = document.getElementById('waTemplateModalTitle');
            if (titleEl) {
                titleEl.innerHTML = '<i class="fa-brands fa-whatsapp"></i> Edit WhatsApp Template';
            }
            
            document.getElementById('waTemplateName').value = template.name || '';
            document.getElementById('waTemplateMessage').value = template.message || '';
            document.getElementById('waTemplateIsActive').checked = template.isActive !== false;
            document.getElementById('waTemplateIsAutomated').checked = template.isAutomated || false;
            document.getElementById('waTemplateTriggerType').value = template.triggerType || 'manual';
            
            // Set template type (marketing/utility)
            const utilityRadio = document.getElementById('waTemplateTypeUtility');
            const marketingRadio = document.getElementById('waTemplateTypeMarketing');
            if (template.isMarketing && marketingRadio) {
                marketingRadio.checked = true;
            } else if (utilityRadio) {
                utilityRadio.checked = true;
            }
            toggleMarketingTemplate();
            
            if (template.stage && document.getElementById('waTemplateStage')) {
                document.getElementById('waTemplateStage').value = template.stage;
            }
            
            toggleWhatsAppAutomationSettings();
            loadWhatsAppStages().then(() => {
                if (template.stage && document.getElementById('waTemplateStage')) {
                    document.getElementById('waTemplateStage').value = template.stage;
                }
            });
            
            // Update character count
            updateWhatsAppCharCount();
            
            const modal = document.getElementById('waTemplateModal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            }
        } else {
            alert('Error loading template');
        }
    } catch (err) {
        console.error('Error loading WhatsApp template:', err);
        alert('Error loading template');
    }
}

// Submit WhatsApp template for review
async function submitWhatsAppTemplateForReview(templateId) {
    if (!templateId) {
        // If called from modal button (no ID), use current template ID
        templateId = currentWhatsAppTemplateId;
    }
    
    if (!templateId) {
        alert('No template selected');
        return;
    }
    
    if (!confirm('Submit this template for review?')) {
        return;
    }
    
    try {
        const res = await authFetch(`/api/whatsapp/templates/${templateId}/submit-review`, {
            method: 'POST'
        });
        
        if (res && res.ok) {
            const data = await res.json();
            alert('Template submitted for review successfully!');
            await loadWhatsAppTemplates(); // Reload templates to show updated status
            if (currentWhatsAppTemplateId === templateId) {
                closeWhatsAppTemplateModal(); // Close modal if editing
            }
        } else {
            const error = await res.json();
            alert(error.message || 'Error submitting template for review');
        }
    } catch (err) {
        console.error('Error submitting template for review:', err);
        alert('Error submitting template for review');
    }
}

// Delete WhatsApp template
async function deleteWhatsAppTemplate(id) {
    if (!confirm('Are you sure you want to delete this template?')) {
        return;
    }

    try {
        const res = await authFetch(`/api/whatsapp/templates/${id}`, {
            method: 'DELETE'
        });

        if (res && res.ok) {
            await loadWhatsAppTemplates();
            alert('Template deleted successfully!');
        } else {
            const error = await res.json();
            alert(error.message || 'Error deleting template');
        }
    } catch (err) {
        console.error('Error deleting WhatsApp template:', err);
        alert('Error deleting template');
    }
}

function filterWhatsAppLeads() {
    const filter = document.getElementById('waSearch').value.toLowerCase();
    const list = document.getElementById('wa-contacts-list');
    const items = list.getElementsByTagName('div');
    
    Array.from(items).forEach(div => {
        if(div.onclick) { 
            const text = div.innerText.toLowerCase();
            div.style.display = text.includes(filter) ? "flex" : "none";
        }
    });
}

// ==========================================
// 🛠️ SHARED UTILITIES
// ==========================================

async function updateStatus(leadId, containerId) {
    try {
        // containerId is the ID of the target container, which is set to stage.name
        // So we use containerId directly as the new status
        const newStatus = containerId;
        
        if (!leadId || !newStatus) {
            console.error('Missing lead ID or status');
            fetchData(); // Reload to revert UI
            return;
        }

        const res = await authFetch(`/api/leads/${leadId}`, { 
            method: 'PUT', 
            body: JSON.stringify({ status: newStatus }) 
        });
        
        if (!res.ok) {
            const error = await res.json();
            console.error('Failed to update status:', error);
            showNotification('Failed to update lead status: ' + (error.message || 'Unknown error'), 'error');
            // Reload data to revert the UI change
            if (typeof fetchData === 'function') fetchData();
            if (typeof setupKanban === 'function') setupKanban();
        } else {
            // Update local cache to reflect the change
            const leadIndex = allLeadsCache.findIndex(l => l._id === leadId);
            if (leadIndex !== -1) {
                allLeadsCache[leadIndex].status = newStatus;
            }
            showNotification('Lead status updated successfully', 'success');
            console.log('Lead status updated successfully');
        }
    } catch (err) {
        console.error('Error updating status:', err);
        showNotification('Error updating lead status: ' + err.message, 'error');
        // Reload to revert UI
        if (typeof fetchData === 'function') fetchData();
        if (typeof setupKanban === 'function') setupKanban();
    }
}

// Function to change lead stage from table view dropdown
async function changeLeadStage(leadId, newStatus) {
    if (!leadId || !newStatus) {
        console.error('Missing lead ID or status');
        showNotification('Invalid lead or stage selection', 'error');
        return;
    }

    try {
        // Get current lead to show old status
        const currentLead = allLeadsCache.find(l => l._id === leadId);
        const oldStatus = currentLead ? currentLead.status : 'Unknown';

        const res = await authFetch(`/api/leads/${leadId}`, { 
            method: 'PUT', 
            body: JSON.stringify({ status: newStatus }) 
        });
        
        if (!res.ok) {
            const error = await res.json();
            console.error('Failed to update status:', error);
            showNotification('Failed to update lead stage: ' + (error.message || 'Unknown error'), 'error');
            // Reload data to revert the UI change
            fetchData();
        } else {
            // Update local cache to reflect the change
            const leadIndex = allLeadsCache.findIndex(l => l._id === leadId);
            if (leadIndex !== -1) {
                allLeadsCache[leadIndex].status = newStatus;
            }
            
            showNotification(`Lead moved from "${oldStatus}" to "${newStatus}"`, 'success');
            
            // Refresh the table view and kanban view to reflect the change
            // Fetch stages again to ensure we have the latest data
            try {
                const stagesRes = await authFetch('/api/stages');
                const stages = await stagesRes.json();
                renderTable(allLeadsCache, stages);
                
                // Also update kanban if it's visible
                if (document.getElementById('kanbanBoard') && !document.getElementById('kanbanBoard').closest('.hidden')) {
                    renderKanban(stages, allLeadsCache);
                }
            } catch (err) {
                console.error('Error refreshing views:', err);
            }
        }
    } catch (err) {
        console.error('Error updating lead stage:', err);
        showNotification('Error updating lead stage: ' + err.message, 'error');
        // Reload to revert UI
        fetchData();
    }
}
async function deleteLead(id) {
    const confirmed = await showConfirm("Are you sure you want to delete this lead? This action cannot be undone.", "Delete Lead", "danger");
    if (confirmed) {
        try {
            const res = await authFetch(`/api/leads/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showNotification('Lead deleted successfully', 'success');
                fetchData();
            } else {
                const data = await res.json();
                showNotification('Failed to delete lead: ' + (data.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            showNotification('Error deleting lead', 'error');
        }
    }
}

// Open Edit Lead Modal
async function editLead(id, oldName, oldPhone) {
    const lead = allLeadsCache.find(l => l._id === id);
    if (!lead) {
        showNotification('Lead not found', 'error');
        return;
    }
    
    // Store current lead ID
    window.currentEditLeadId = id;
    
    // Populate form fields
    document.getElementById('editLeadName').value = lead.name || '';
    document.getElementById('editLeadPhone').value = lead.phone || '';
    document.getElementById('editLeadEmail').value = lead.email || '';
    document.getElementById('editLeadSource').value = lead.source || 'Manual Entry';
    
    // Set next follow-up date if exists
    if (lead.nextFollowUpDate) {
        const followUpDate = new Date(lead.nextFollowUpDate);
        document.getElementById('editLeadNextFollowUp').value = followUpDate.toISOString().split('T')[0];
    } else {
        document.getElementById('editLeadNextFollowUp').value = '';
    }
    
    // Fetch stages and populate status dropdown
    try {
        const stagesRes = await authFetch('/api/stages');
        const stages = await stagesRes.json();
        const statusSelect = document.getElementById('editLeadStatus');
        
        if (statusSelect) {
            statusSelect.innerHTML = '';
            stages.forEach(stage => {
                const option = document.createElement('option');
                option.value = stage.name;
                option.textContent = stage.name;
                if (lead.status === stage.name) {
                    option.selected = true;
                }
                statusSelect.appendChild(option);
            });
            
            // If current status is not in stages, add it
            if (!stages.find(s => s.name === lead.status)) {
                const option = document.createElement('option');
                option.value = lead.status || 'New';
                option.textContent = lead.status || 'New';
                option.selected = true;
                statusSelect.appendChild(option);
            }
        }
    } catch (err) {
        console.error('Error fetching stages:', err);
    }
    
    // Show modal
    const modal = document.getElementById('editLeadModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

// Close Edit Lead Modal
function closeEditLeadModal() {
    const modal = document.getElementById('editLeadModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    window.currentEditLeadId = null;
}

// Save Edited Lead
async function saveEditedLead(event) {
    event.preventDefault();
    
    if (!window.currentEditLeadId) {
        showNotification('No lead selected', 'error');
        return;
    }
    
    const name = document.getElementById('editLeadName').value.trim();
    const phone = document.getElementById('editLeadPhone').value.trim();
    const email = document.getElementById('editLeadEmail').value.trim();
    const status = document.getElementById('editLeadStatus').value;
    const source = document.getElementById('editLeadSource').value;
    const nextFollowUpDate = document.getElementById('editLeadNextFollowUp').value;
    
    // Validation
    if (!name || !phone) {
        showNotification('Name and Phone are required', 'warning');
        return;
    }
    
    try {
        // Get current lead to check if follow-up date needs to be cleared
        const lead = allLeadsCache.find(l => l._id === window.currentEditLeadId);
        
        // Prepare update data
        const updateData = {
            name,
            phone,
            email: email || undefined,
            status: status || 'New',
            source: source || 'Manual Entry'
        };
        
        // Handle next follow-up date
        if (nextFollowUpDate) {
            // Setting a new follow-up date
            updateData.nextFollowUpDate = nextFollowUpDate;
        } else if (lead && lead.nextFollowUpDate) {
            // If date field is empty but lead had a follow-up date, clear it by setting to null
            updateData.nextFollowUpDate = null;
        }
        
        const res = await authFetch(`/api/leads/${window.currentEditLeadId}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        
        if (res.ok) {
            const data = await res.json();
            
            // Update local cache
            const index = allLeadsCache.findIndex(l => l._id === window.currentEditLeadId);
            if (index !== -1 && data.lead) {
                allLeadsCache[index] = data.lead;
            }
            
            // Close modal
            closeEditLeadModal();
            
            // Refresh data
            await fetchData();
            
            showNotification('Lead updated successfully', 'success');
        } else {
            const error = await res.json();
            showNotification('Failed to update lead: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (err) {
        console.error('Error updating lead:', err);
        showNotification('Error updating lead: ' + (err.message || 'Unknown error'), 'error');
    }
}

async function deleteStage(stageId, stageName) {
    if (stageName === 'New') {
        showNotification("Cannot delete the default 'New' stage", 'warning');
        return;
    }
    const confirmed = await showConfirm(`Are you sure you want to delete the stage "${stageName}"? Leads in this stage will be moved to "New".`, "Delete Stage", "danger");
    if (confirmed) {
        try {
            const res = await authFetch(`/api/stages/${stageId}`, { method: 'DELETE' });
            if (res.ok) {
                showNotification('Stage deleted successfully', 'success');
                fetchData();
            } else {
                const data = await res.json();
                showNotification('Failed to delete stage: ' + (data.message || 'Unknown error'), 'error');
            }
        } catch (err) {
            showNotification('Error deleting stage', 'error');
        }
    }
}

// SETTINGS & MODALS
function toggleSettingsModal() {
    const m = document.getElementById('settingsModal');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
}
async function syncSheet(isAuto = false) {
    const link = document.getElementById('sheetLink').value;
    const currentUser = JSON.parse(localStorage.getItem('user'));
    if(!link) {
        if (!isAuto) {
            showNotification("Google Sheet link is required!", "warning");
        }
        return;
    }
    if (currentUser?.id) localStorage.setItem(`sheetLink_${currentUser.id}`, link);
    try {
        const res = await authFetch('/api/leads/sync-sheet', { method: 'POST', body: JSON.stringify({ sheetUrl: link }) });
        const data = await res.json();
        if(!isAuto) {
            if (data.success) {
                showNotification(data.message || "Sheet synced successfully!", "success");
            } else {
                showNotification("Error: " + (data.message || "Failed to sync sheet"), "error");
            }
            fetchData();
            toggleSettingsModal();
        }
    } catch (err) { 
        console.error(err);
        if (!isAuto) {
            showNotification("Error syncing sheet", "error");
        }
    }
}

function switchView(view) {
    // Show dashboard views, hide team management views
    document.getElementById('dashboardViews').classList.remove('hidden');
    document.getElementById('teamManagementView').classList.add('hidden');
    
    if (view === 'table') {
        document.getElementById('tableView').classList.remove('hidden');
        document.getElementById('kanbanView').classList.add('hidden');
    } else if (view === 'kanban' || view === 'pipeline') {
        document.getElementById('kanbanView').classList.remove('hidden');
        document.getElementById('tableView').classList.add('hidden');
        setupKanban(); // Load kanban data
    }
    
    // Re-initialize dashboard if needed (but won't redundantly fetch data due to flag)
    if (view === 'table' && document.getElementById('leadsTableBody')) {
        initDashboard();
    }
}
function filterLeads() {
    const filter = document.getElementById('searchBox').value.toLowerCase();
    const cards = document.getElementById('leadsTableBody').children;
    Array.from(cards).forEach(card => card.style.display = card.innerText.toLowerCase().includes(filter) ? "" : "none");
}
function toggleAddLeadModal() {
    const m = document.getElementById('addLeadModal');
    m.classList.toggle('hidden'); m.classList.toggle('flex');
}
async function saveNewLead(event) {
    event.preventDefault();
    const name = document.getElementById('manualName').value;
    const phone = document.getElementById('manualPhone').value;
    const email = document.getElementById('manualEmail').value;
    try {
        const res = await authFetch('/api/leads', { method: 'POST', body: JSON.stringify({ name, phone, email }) });
        if (res.ok) {
            toggleAddLeadModal();
            fetchData();
            showNotification("Lead Added Successfully! 🎉", "success");
        } else {
            const data = await res.json();
            showNotification("Failed to add lead: " + (data.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error(err);
        showNotification("Server Error", "error");
    }
}

// ==========================================
// 🔔 FOLLOW-UP MODAL FUNCTIONS
// ==========================================

// Open Follow-up Modal
async function openFollowUpModal() {
    const modal = document.getElementById('followUpModal');
    if (!modal) {
        console.error('Follow-up modal not found');
        return;
    }
    
    // Show modal first so elements exist
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Switch to Today tab
    switchFollowUpTab('today');
    
    // Fetch follow-up data (this will populate the modal)
    // Don't await - let it load in background, but handle errors gracefully
    loadFollowUpData().catch(err => {
        console.warn('Error loading follow-up data (non-critical):', err);
        // Don't show notification - data loading errors are handled inside loadFollowUpData
    });
}

// Close Follow-up Modal
function closeFollowUpModal() {
    const modal = document.getElementById('followUpModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// Switch Follow-up Tab
function switchFollowUpTab(tab) {
    const todayTab = document.getElementById('followUpTabToday');
    const doneTab = document.getElementById('followUpTabDone');
    const todayContent = document.getElementById('followUpTodayTab');
    const doneContent = document.getElementById('followUpDoneTab');
    
    if (tab === 'today') {
        todayTab.classList.add('border-b-2', 'border-orange-500', 'text-gray-700');
        todayTab.classList.remove('text-gray-500');
        doneTab.classList.remove('border-b-2', 'border-orange-500', 'text-gray-700');
        doneTab.classList.add('text-gray-500');
        todayContent.classList.remove('hidden');
        doneContent.classList.add('hidden');
    } else {
        doneTab.classList.add('border-b-2', 'border-orange-500', 'text-gray-700');
        doneTab.classList.remove('text-gray-500');
        todayTab.classList.remove('border-b-2', 'border-orange-500', 'text-gray-700');
        todayTab.classList.add('text-gray-500');
        doneContent.classList.remove('hidden');
        todayContent.classList.add('hidden');
    }
}

// Load Follow-up Data
async function loadFollowUpData() {
    let todayLeads = [];
    let doneLeads = [];
    
    // Fetch follow-up today
    try {
        const todayRes = await authFetch('/api/leads/follow-up-today');
        if (todayRes && todayRes.ok) {
            try {
                todayLeads = await todayRes.json();
            } catch (jsonErr) {
                console.warn('Error parsing follow-up today JSON:', jsonErr);
                todayLeads = [];
            }
        } else if (todayRes) {
            // Response exists but not OK - log warning but continue
            console.warn('Follow-up today response not OK:', todayRes.status);
        }
    } catch (todayErr) {
        // Network error or other issue - log but don't show notification
        console.warn('Error fetching follow-up today:', todayErr);
        // Continue with empty array
        todayLeads = [];
    }
    
    // Fetch follow-up done (optional - if it fails, just continue with empty array)
    try {
        const doneRes = await authFetch('/api/leads/follow-up-done');
        if (doneRes && doneRes.ok) {
            try {
                doneLeads = await doneRes.json();
            } catch (jsonErr) {
                console.warn('Error parsing follow-up done JSON:', jsonErr);
                doneLeads = [];
            }
        } else if (doneRes) {
            // Response exists but not OK - this is fine, just use empty array
            console.warn('Follow-up done response not OK:', doneRes.status);
            doneLeads = [];
        }
    } catch (doneErr) {
        // Network error or endpoint doesn't exist - log but don't show notification
        console.warn('Error fetching follow-up done (this is okay if endpoint is new):', doneErr);
        // Continue with empty array - this is expected if endpoint doesn't exist yet
        doneLeads = [];
    }
    
    // Update counts (only if elements exist)
    try {
        const todayCountElement = document.getElementById('followUpTodayTabCount');
        const doneCountElement = document.getElementById('followUpDoneTabCount');
        
        if (todayCountElement) {
            todayCountElement.innerText = Array.isArray(todayLeads) ? todayLeads.length : 0;
        }
        if (doneCountElement) {
            doneCountElement.innerText = Array.isArray(doneLeads) ? doneLeads.length : 0;
        }
    } catch (countErr) {
        console.warn('Error updating follow-up counts:', countErr);
    }
    
    // Render sections (with error handling)
    try {
        renderFollowUpToday(Array.isArray(todayLeads) ? todayLeads : []);
    } catch (renderErr) {
        console.error('Error rendering follow-up today:', renderErr);
    }
    
    try {
        renderFollowUpDone(Array.isArray(doneLeads) ? doneLeads : []);
    } catch (renderErr) {
        console.error('Error rendering follow-up done:', renderErr);
    }
}

// Render Follow-up Today Section (in modal)
function renderFollowUpToday(followUpLeads) {
    const container = document.getElementById('followUpTodayList');
    if (!container) return;
    
    if (followUpLeads.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-8">No follow-up reminders for today! 🎉</p>';
        return;
    }
    
    container.innerHTML = '';
    followUpLeads.forEach(lead => {
        const followUpDate = lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : '-';
        
        const createdAt = lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric'
        }) : '-';
        
        const statusColors = {
            'New': 'bg-blue-100 text-blue-800', 'Contacted': 'bg-yellow-100 text-yellow-800',
            'Won': 'bg-green-100 text-green-800', 'Lost': 'bg-red-100 text-red-800', 'Dead Lead': 'bg-gray-100 text-gray-800'
        };
        const badgeClass = statusColors[lead.status] || 'bg-gray-100 text-gray-800';
        
        const safeLeadId = lead._id.replace(/'/g, "\\'");
        
        const card = document.createElement('div');
        card.className = 'bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition border-l-4 border-orange-500';
        card.innerHTML = `
            <div class="flex items-center justify-between gap-4">
                <div class="flex-1">
                    <div class="flex items-center gap-3 mb-2">
                        <div class="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                            ${lead.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h3 class="font-bold text-gray-800">${lead.name}</h3>
                            <p class="text-xs text-gray-500"><i class="fa-solid fa-phone mr-1"></i> ${lead.phone || 'N/A'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-4 text-xs text-gray-500 ml-13">
                        <span><i class="fa-solid fa-calendar-plus mr-1 text-orange-500"></i> Follow-up: ${followUpDate}</span>
                        <span><i class="fa-solid fa-clock mr-1 text-blue-500"></i> Created: ${createdAt}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-bold uppercase">${lead.status}</span>
                    <button onclick="openFollowUpActionModal('${safeLeadId}')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
                        <i class="fa-solid fa-check-circle mr-1"></i> Complete
                    </button>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Render Follow-up Done Section
function renderFollowUpDone(doneLeads) {
    const container = document.getElementById('followUpDoneList');
    if (!container) {
        console.warn('Follow-up done container not found');
        return;
    }
    
    if (!Array.isArray(doneLeads) || doneLeads.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-8">No completed follow-ups yet.</p>';
        return;
    }
    
    container.innerHTML = '';
    doneLeads.forEach(lead => {
        if (!lead || !lead.followUpHistory || !Array.isArray(lead.followUpHistory) || lead.followUpHistory.length === 0) {
            return;
        }
        
        try {
            const lastFollowUp = lead.followUpHistory[lead.followUpHistory.length - 1];
            if (!lastFollowUp) return;
            
            let completedDate = '-';
            try {
                if (lastFollowUp.completedDate) {
                    completedDate = new Date(lastFollowUp.completedDate).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            } catch (dateErr) {
                console.warn('Error parsing completed date:', dateErr);
            }
            
            const createdAt = lead.createdAt ? (() => {
                try {
                    return new Date(lead.createdAt).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric'
                    });
                } catch (e) {
                    return '-';
                }
            })() : '-';
            
            const statusColors = {
                'New': 'bg-blue-100 text-blue-800', 'Contacted': 'bg-yellow-100 text-yellow-800',
                'Won': 'bg-green-100 text-green-800', 'Lost': 'bg-red-100 text-red-800', 'Dead Lead': 'bg-gray-100 text-gray-800'
            };
            const badgeClass = statusColors[lead.status] || 'bg-gray-100 text-gray-800';
            
            const safeLeadId = (lead._id || '').replace(/'/g, "\\'");
            const safeLeadName = (lead.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const safeNote = (lastFollowUp.note || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            
            let nextFollowUpHtml = '';
            if (lastFollowUp.nextFollowUpDate) {
                try {
                    const nextDate = new Date(lastFollowUp.nextFollowUpDate);
                    if (!isNaN(nextDate.getTime())) {
                        nextFollowUpHtml = `<span class="text-xs text-orange-600"><i class="fa-solid fa-calendar-plus mr-1"></i> Next Follow-up: ${nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
                    }
                } catch (e) {
                    // Skip if date is invalid
                }
            }
            
            const card = document.createElement('div');
            card.className = 'bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition border-l-4 border-green-500';
            card.innerHTML = `
                <div class="flex items-center justify-between gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-3 mb-2">
                            <div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold">
                                ${(lead.name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h3 class="font-bold text-gray-800">${lead.name || 'Unknown'}</h3>
                                <p class="text-xs text-gray-500"><i class="fa-solid fa-phone mr-1"></i> ${lead.phone || 'N/A'}</p>
                            </div>
                        </div>
                        <div class="space-y-1 ml-13">
                            <p class="text-xs text-gray-600"><i class="fa-solid fa-note-sticky mr-1 text-green-500"></i> ${safeNote.substring(0, 100)}${safeNote.length > 100 ? '...' : ''}</p>
                            <div class="flex items-center gap-4 text-xs text-gray-500">
                                <span><i class="fa-solid fa-check-circle mr-1 text-green-500"></i> Completed: ${completedDate}</span>
                                <span><i class="fa-solid fa-clock mr-1 text-blue-500"></i> Created: ${createdAt}</span>
                            </div>
                            ${nextFollowUpHtml}
                            ${lastFollowUp.markedAsDeadLead ? '<span class="text-xs text-red-600"><i class="fa-solid fa-skull mr-1"></i> Marked as Dead Lead</span>' : ''}
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-bold uppercase">${lead.status || 'Unknown'}</span>
                        <button onclick="openModal('${safeLeadId}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium transition">
                            <i class="fa-solid fa-eye mr-1"></i> View
                        </button>
                    </div>
                </div>
            `;
            container.appendChild(card);
        } catch (leadErr) {
            console.error('Error rendering follow-up done lead:', leadErr, lead);
            // Continue with next lead
        }
    });
}

// Open Follow-up Action Modal (for completing follow-up)
function openFollowUpActionModal(leadId) {
    const lead = allLeadsCache.find(l => l._id === leadId);
    if (!lead) {
        showNotification('Lead not found', 'error');
        return;
    }
    
    const modal = document.getElementById('followUpActionModal');
    const leadNameElement = document.getElementById('followUpActionLeadName');
    
    if (leadNameElement) {
        leadNameElement.textContent = lead.name;
    }
    
    // Reset form
    document.getElementById('followUpNoteInput').value = '';
    document.getElementById('nextFollowUpDateNew').value = '';
    document.querySelector('input[name="followUpNextAction"][value="nextDate"]').checked = true;
    document.querySelector('input[name="followUpNextAction"][value="deadLead"]').checked = false;
    
    // Reset error messages
    const noteError = document.getElementById('followUpNoteError');
    const actionError = document.getElementById('followUpActionError');
    if (noteError) noteError.classList.add('hidden');
    if (actionError) actionError.classList.add('hidden');
    
    // Enable date input by default
    const dateInput = document.getElementById('nextFollowUpDateNew');
    if (dateInput) {
        dateInput.disabled = false;
    }
    
    // Store current lead ID
    window.currentFollowUpLeadId = leadId;
    
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
}

// Close Follow-up Action Modal
function closeFollowUpActionModal() {
    const modal = document.getElementById('followUpActionModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    window.currentFollowUpLeadId = null;
}

// Toggle Follow-up Date Input based on radio selection
function toggleFollowUpDateInput() {
    const nextAction = document.querySelector('input[name="followUpNextAction"]:checked').value;
    const dateInput = document.getElementById('nextFollowUpDateNew');
    const actionError = document.getElementById('followUpActionError');
    
    if (nextAction === 'deadLead') {
        dateInput.disabled = true;
        dateInput.value = '';
        if (actionError) actionError.classList.add('hidden');
    } else {
        dateInput.disabled = false;
        if (actionError) actionError.classList.add('hidden');
    }
}

// Complete Follow-up
async function completeFollowUp() {
    const noteInput = document.getElementById('followUpNoteInput');
    const note = noteInput.value.trim();
    const nextAction = document.querySelector('input[name="followUpNextAction"]:checked');
    
    if (!nextAction) {
        showNotification('Please select next action', 'warning');
        return;
    }
    
    const actionValue = nextAction.value;
    const nextFollowUpDate = document.getElementById('nextFollowUpDateNew').value;
    const markedAsDeadLead = actionValue === 'deadLead';
    
    const noteError = document.getElementById('followUpNoteError');
    const actionError = document.getElementById('followUpActionError');
    
    // Validation: Note is required
    if (!note) {
        if (noteError) noteError.classList.remove('hidden');
        showNotification('Please add a follow-up note before completing', 'warning');
        return;
    } else {
        if (noteError) noteError.classList.add('hidden');
    }
    
    // Validation: Either nextFollowUpDate OR markedAsDeadLead
    if (actionValue === 'nextDate' && !nextFollowUpDate) {
        if (actionError) actionError.classList.remove('hidden');
        showNotification('Please select next follow-up date or mark as Dead Lead', 'warning');
        return;
    } else {
        if (actionError) actionError.classList.add('hidden');
    }
    
    if (!window.currentFollowUpLeadId) {
        showNotification('No lead selected', 'error');
        return;
    }
    
    try {
        const res = await authFetch('/api/leads/complete-followup', {
            method: 'POST',
            body: JSON.stringify({
                leadId: window.currentFollowUpLeadId,
                note: note,
                nextFollowUpDate: actionValue === 'nextDate' ? nextFollowUpDate : null,
                markedAsDeadLead: markedAsDeadLead
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            
            // Update local cache
            const index = allLeadsCache.findIndex(l => l._id === window.currentFollowUpLeadId);
            if (index !== -1) {
                allLeadsCache[index] = data.lead;
            }
            
            // Refresh follow-up modal
            await loadFollowUpData();
            
            // Refresh main dashboard
            await fetchData();
            
            // Close action modal
            closeFollowUpActionModal();
            
            showNotification('Follow-up completed successfully!', 'success');
        } else {
            const error = await res.json();
            showNotification('Failed to complete follow-up: ' + (error.message || 'Unknown error'), 'error');
        }
    } catch (err) {
        console.error('Error completing follow-up:', err);
        showNotification('Error completing follow-up: ' + (err.message || 'Unknown error'), 'error');
    }
}

// Note Modal
function openModal(id) {
    const lead = allLeadsCache.find(l => l._id === id);
    if (!lead) return;
    currentLeadId = id;
    document.getElementById('modalName').innerText = lead.name;
    document.getElementById('modalPhone').innerText = `${lead.phone || ''} | ${lead.email || ''}`;
    
    // Display created date
    const createdDate = lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) : 'Not available';
    document.getElementById('modalCreatedDate').innerText = createdDate;
    
    // Display last follow-up date
    const lastFollowUpDate = lead.lastFollowUpDate ? new Date(lead.lastFollowUpDate).toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }) : 'Not set';
    document.getElementById('modalLastFollowUpDate').innerText = lastFollowUpDate;
    
    // Display and set next follow-up date
    const nextFollowUpDateInput = document.getElementById('nextFollowUpDateInput');
    const modalNextFollowUpDate = document.getElementById('modalNextFollowUpDate');
    
    if (lead.nextFollowUpDate) {
        const nextDate = new Date(lead.nextFollowUpDate);
        nextFollowUpDateInput.value = nextDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
        modalNextFollowUpDate.innerText = `Scheduled for: ${nextDate.toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })}`;
    } else {
        nextFollowUpDateInput.value = '';
        modalNextFollowUpDate.innerText = 'Not scheduled';
    }
    
    renderNotes(lead.notes || []);
    
    // Populate email fields if lead has email
    const emailToInput = document.getElementById('emailToInput');
    if (emailToInput) {
        if (lead.email) {
            emailToInput.value = lead.email;
        } else {
            emailToInput.value = '';
        }
        // Clear email form
        document.getElementById('emailSubjectInput').value = '';
        document.getElementById('emailMessageInput').value = '';
        const emailStatusMessage = document.getElementById('emailStatusMessage');
        if (emailStatusMessage) {
            emailStatusMessage.classList.add('hidden');
        }
        // Close email section by default
        const emailSection = document.getElementById('emailSection');
        if (emailSection) {
            emailSection.classList.add('hidden');
        }
        const emailToggleIcon = document.getElementById('emailToggleIcon');
        if (emailToggleIcon) {
            emailToggleIcon.classList.remove('fa-chevron-up');
            emailToggleIcon.classList.add('fa-chevron-down');
        }
    }
    
    document.getElementById('leadModal').classList.remove('hidden');
    document.getElementById('leadModal').classList.add('flex');
}
function closeModal() {
    document.getElementById('leadModal').classList.add('hidden');
    document.getElementById('leadModal').classList.remove('flex');
}

// Toggle Email Section
function toggleEmailSection() {
    const emailSection = document.getElementById('emailSection');
    const emailToggleIcon = document.getElementById('emailToggleIcon');
    
    if (!emailSection || !emailToggleIcon) return;
    
    if (emailSection.classList.contains('hidden')) {
        emailSection.classList.remove('hidden');
        emailToggleIcon.classList.remove('fa-chevron-down');
        emailToggleIcon.classList.add('fa-chevron-up');
    } else {
        emailSection.classList.add('hidden');
        emailToggleIcon.classList.remove('fa-chevron-up');
        emailToggleIcon.classList.add('fa-chevron-down');
    }
}

// Send Email to Lead
async function sendEmailToLead() {
    const emailToInput = document.getElementById('emailToInput');
    const emailSubjectInput = document.getElementById('emailSubjectInput');
    const emailMessageInput = document.getElementById('emailMessageInput');
    const sendEmailBtn = document.getElementById('sendEmailBtn');
    const statusMessage = document.getElementById('emailStatusMessage');
    
    if (!emailToInput || !emailSubjectInput || !emailMessageInput || !sendEmailBtn) {
        showNotification('Email form elements not found', 'error');
        return;
    }
    
    const to = emailToInput.value.trim();
    const subject = emailSubjectInput.value.trim();
    const message = emailMessageInput.value.trim();
    
    // Validation
    if (!to) {
        if (statusMessage) {
            statusMessage.classList.remove('hidden', 'bg-green-50', 'text-green-700', 'border-green-200');
            statusMessage.classList.add('bg-red-50', 'text-red-700', 'border', 'border-red-200');
            statusMessage.innerHTML = '<i class="fa-solid fa-exclamation-circle mr-1"></i> Please enter recipient email address';
        }
        showNotification('Please enter recipient email address', 'warning');
        return;
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
        if (statusMessage) {
            statusMessage.classList.remove('hidden', 'bg-green-50', 'text-green-700', 'border-green-200');
            statusMessage.classList.add('bg-red-50', 'text-red-700', 'border', 'border-red-200');
            statusMessage.innerHTML = '<i class="fa-solid fa-exclamation-circle mr-1"></i> Please enter a valid email address';
        }
        showNotification('Please enter a valid email address', 'warning');
        return;
    }
    
    if (!subject) {
        if (statusMessage) {
            statusMessage.classList.remove('hidden', 'bg-green-50', 'text-green-700', 'border-green-200');
            statusMessage.classList.add('bg-red-50', 'text-red-700', 'border', 'border-red-200');
            statusMessage.innerHTML = '<i class="fa-solid fa-exclamation-circle mr-1"></i> Please enter email subject';
        }
        showNotification('Please enter email subject', 'warning');
        return;
    }
    
    if (!message) {
        if (statusMessage) {
            statusMessage.classList.remove('hidden', 'bg-green-50', 'text-green-700', 'border-green-200');
            statusMessage.classList.add('bg-red-50', 'text-red-700', 'border', 'border-red-200');
            statusMessage.innerHTML = '<i class="fa-solid fa-exclamation-circle mr-1"></i> Please enter email message';
        }
        showNotification('Please enter email message', 'warning');
        return;
    }
    
    // Disable button and show loading
    const originalBtnContent = sendEmailBtn.innerHTML;
    sendEmailBtn.disabled = true;
    sendEmailBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Sending...';
    if (statusMessage) {
        statusMessage.classList.add('hidden');
    }
    
    try {
        const res = await authFetch('/api/email/send', {
            method: 'POST',
            body: JSON.stringify({
                to: to,
                subject: subject,
                text: message,
                leadId: currentLeadId
            })
        });
        
        const data = await res.json();
        
        if (res.ok && data.success) {
            // Success
            if (statusMessage) {
                statusMessage.classList.remove('hidden', 'bg-red-50', 'text-red-700', 'border-red-200');
                statusMessage.classList.add('bg-green-50', 'text-green-700', 'border', 'border-green-200');
                statusMessage.innerHTML = '<i class="fa-solid fa-check-circle mr-1"></i> Email sent successfully!';
            }
            
            // Clear form
            emailSubjectInput.value = '';
            emailMessageInput.value = '';
            
            showNotification('Email sent successfully! 📧', 'success');
            
            // Hide status message after 3 seconds
            if (statusMessage) {
                setTimeout(() => {
                    statusMessage.classList.add('hidden');
                }, 3000);
            }
        } else {
            // Error from server
            if (statusMessage) {
                statusMessage.classList.remove('hidden', 'bg-green-50', 'text-green-700', 'border-green-200');
                statusMessage.classList.add('bg-red-50', 'text-red-700', 'border', 'border-red-200');
                statusMessage.innerHTML = `<i class="fa-solid fa-exclamation-circle mr-1"></i> ${data.message || 'Failed to send email'}`;
            }
            showNotification(data.message || 'Failed to send email', 'error');
        }
    } catch (err) {
        console.error('Error sending email:', err);
        if (statusMessage) {
            statusMessage.classList.remove('hidden', 'bg-green-50', 'text-green-700', 'border-green-200');
            statusMessage.classList.add('bg-red-50', 'text-red-700', 'border', 'border-red-200');
            statusMessage.innerHTML = '<i class="fa-solid fa-exclamation-circle mr-1"></i> Error sending email. Please try again.';
        }
        showNotification('Error sending email. Please try again.', 'error');
    } finally {
        // Re-enable button
        sendEmailBtn.disabled = false;
        sendEmailBtn.innerHTML = originalBtnContent;
    }
}
function renderNotes(notes) {
    const list = document.getElementById('notesList');
    list.innerHTML = '';
    if(!notes || notes.length === 0) { list.innerHTML = '<p class="text-gray-400 text-center text-sm mt-4">No notes yet.</p>'; return; }
    notes.slice().reverse().forEach(n => {
        list.innerHTML += `<div class="bg-gray-50 p-3 rounded-lg border border-gray-100"><p class="text-sm text-gray-700">${n.text}</p><span class="text-xs text-gray-400 block mt-1 text-right">${new Date(n.date).toLocaleString()}</span></div>`;
    });
}
async function saveNote() {
    const input = document.getElementById('newNoteInput');
    const text = input.value;
    if(!text) {
        showNotification("Please enter a note", "warning");
        return;
    }
    try {
        const res = await authFetch(`/api/leads/${currentLeadId}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
        const updatedLead = await res.json();
        const index = allLeadsCache.findIndex(l => l._id === currentLeadId);
        allLeadsCache[index] = updatedLead;
        renderNotes(updatedLead.notes);
        input.value = '';
        showNotification("Note saved successfully", "success");
    } catch (err) {
        console.error(err);
        showNotification("Error saving note", "error");
    }
}

// Update Follow-up Date
async function updateFollowUpDate() {
    const nextFollowUpDateInput = document.getElementById('nextFollowUpDateInput');
    const nextFollowUpDate = nextFollowUpDateInput.value;
    
    if (!nextFollowUpDate) {
        showNotification("Please select a follow-up date", "warning");
        return;
    }
    
    if (!currentLeadId) {
        showNotification("No lead selected", "error");
        return;
    }
    
    try {
        const res = await authFetch('/api/leads/update-followup', {
            method: 'POST',
            body: JSON.stringify({
                leadId: currentLeadId,
                nextFollowUpDate: nextFollowUpDate
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            
            // Update local cache
            const index = allLeadsCache.findIndex(l => l._id === currentLeadId);
            if (index !== -1) {
                allLeadsCache[index].nextFollowUpDate = data.lead.nextFollowUpDate;
                allLeadsCache[index].lastFollowUpDate = data.lead.lastFollowUpDate;
            }
            
            // Refresh modal with updated data
            openModal(currentLeadId);
            
            // Refresh follow-up section and table
            fetchData();
            
            showNotification("Follow-up date updated successfully", "success");
        } else {
            const error = await res.json();
            showNotification("Failed to update follow-up date: " + (error.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error(err);
        showNotification("Error updating follow-up date", "error");
    }
}

function addNewStageModal() {
    const m = document.getElementById('stageModal');
    m.classList.remove('hidden'); 
    m.classList.add('flex');
}

function toggleStageModal() {
    const m = document.getElementById('stageModal');
    m.classList.toggle('hidden'); 
    m.classList.toggle('flex');
}

async function addNewStage() {
    const name = document.getElementById('newStageNameInput').value;
    if(!name) {
        showNotification("Please enter a stage name", "warning");
        return;
    }
    try {
        const res = await authFetch('/api/stages', { method: 'POST', body: JSON.stringify({ name }) });
        if (res.ok) {
            document.getElementById('newStageNameInput').value = '';
            toggleStageModal();
            showNotification("Stage added successfully", "success");
            
            // Update all views in background
            fetchData(); // Updates table view and analytics
            
            // Also refresh kanban view if it's currently visible
            const kanbanView = document.getElementById('kanbanView');
            if (kanbanView && !kanbanView.classList.contains('hidden')) {
                setupKanban();
            }
        } else {
            const data = await res.json();
            showNotification("Failed to add stage: " + (data.message || "Unknown error"), "error");
        }
    } catch (err) {
        console.error(err);
        showNotification("Error adding stage", "error");
    }
}