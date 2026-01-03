// 🔒 SECURITY & USER
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user'));

if (!token) window.location.href = 'login.html';
else if(user) {
    const nameDisplay = document.getElementById('userNameDisplay');
    if(nameDisplay) nameDisplay.innerText = user.name;
}

function logout() {
    if(confirm("Logout?")) {
        localStorage.clear();
        window.location.href = 'login.html';
    }
}

// 🔥 AUTH FETCH
async function authFetch(url, options = {}) {
    // Bearer removed so backend accepts it
    options.headers = { ...options.headers, 'Authorization': token, 'Content-Type': 'application/json' };
    const res = await fetch(url, options);
    if(res.status === 401) { alert("Session Expired"); logout(); }
    return res;
}

// --- VARIABLES ---
let drake, currentLeadId = null, allLeadsCache = [];

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
// 📊 DASHBOARD LOGIC (Original Code)
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
    fetchData();
    setInterval(() => syncSheet(true), 5 * 60 * 1000); // Auto sync
}

async function fetchData() {
    try {
        const [leadsRes, stagesRes, statsRes] = await Promise.all([
            authFetch('/api/leads'), authFetch('/api/stages'), authFetch('/api/analytics')
        ]);
        if(!leadsRes) return;
        const leads = await leadsRes.json();
        allLeadsCache = leads;
        const stages = await stagesRes.json();
        const stats = await statsRes.json();

        renderTable(leads);
        renderKanban(stages, leads);
        renderChart(stats);
    } catch (e) { console.error(e); }
}

function renderTable(leads) {
    const container = document.getElementById('leadsTableBody');
    if(!container) return; // Safety check
    document.getElementById('totalCount').innerText = leads.length;
    container.innerHTML = '';

    leads.forEach(lead => {
        let dateDisplay = '-';
        if(lead.date) {
            const d = new Date(lead.date);
            if(!isNaN(d.getTime())) dateDisplay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        const statusColors = {
            'New': 'bg-blue-100 text-blue-800', 'Contacted': 'bg-yellow-100 text-yellow-800',
            'Won': 'bg-green-100 text-green-800', 'Lost': 'bg-red-100 text-red-800'
        };
        const badgeClass = statusColors[lead.status] || 'bg-gray-100 text-gray-800';

        const card = `
        <div class="bg-white rounded-xl p-5 shadow-sm hover:shadow-md transition border-l-4 border-blue-500 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div class="flex-1 cursor-pointer" onclick="openModal('${lead._id}')">
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
            <div class="flex items-center gap-4">
                <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide shadow-sm">${lead.status}</span>
                <span class="text-xs text-gray-400 font-medium"><i class="fa-regular fa-calendar mr-1"></i> ${dateDisplay}</span>
            </div>
            <div class="flex items-center gap-2">
                <button onclick="openModal('${lead._id}')" class="flex items-center gap-1 bg-orange-50 hover:bg-orange-100 text-orange-600 px-3 py-2 rounded-lg text-sm font-medium transition border border-orange-200"><i class="fa-regular fa-note-sticky"></i> Note</button>
                <button onclick="editLead('${lead._id}', '${lead.name}', '${lead.phone}')" class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-blue-100 hover:text-blue-600 transition text-gray-500"><i class="fa-solid fa-pen"></i></button>
                <button onclick="deleteLead('${lead._id}')" class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-red-100 hover:text-red-600 transition text-gray-500"><i class="fa-solid fa-trash"></i></button>
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
        stages.forEach(stage => {
            const container = document.getElementById(stage.name);
            dragContainers.push(container);
            const stageLeads = leads.filter(l => (l.status || 'New') === stage.name);
            
            stageLeads.forEach(lead => {
                const card = document.createElement('div');
                card.className = 'lead-card bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-400 cursor-grab hover:shadow-md transition';
                card.id = lead._id;
                card.innerHTML = `<h4 class="font-bold text-gray-800">${lead.name}</h4><p class="text-xs text-gray-500 mt-1"><i class="fa-solid fa-phone"></i> ${lead.phone || '-'}</p>`;
                container.appendChild(card);
            });
        });

        if (drake) drake.destroy();
        if(window.dragula) {
            drake = dragula(dragContainers);
            drake.on('drop', (el, target) => updateStatus(el.id, target.id));
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
// 🟢 WHATSAPP LOGIC (UPDATED WITH REAL CHAT)
// ==========================================

async function initWhatsApp() {
    await fetchWhatsAppLeads();
}

async function fetchWhatsAppLeads() {
    const listContainer = document.getElementById('wa-contacts-list');
    listContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">Syncing...</p>';

    try {
        const res = await authFetch('/api/whatsapp/leads');
        const leads = await res.json();
        
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

// 👇 UPDATED OPEN CHAT FUNCTION (REAL DB MESSAGES)
function openChat(lead) {
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

function filterWhatsAppLeads() {
    const filter = document.getElementById('waSearch').value.toLowerCase();
    const list = document.getElementById('wa-contacts-list');
    const items = list.getElementsByTagName('div');
    
    // Simple filter logic for parent divs that have onclick (Lead cards)
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

async function updateStatus(id, status) {
    await authFetch(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
}
async function deleteLead(id) {
    if(confirm("Delete lead?")) { await authFetch(`/api/leads/${id}`, { method: 'DELETE' }); fetchData(); }
}
async function editLead(id, oldName, oldPhone) {
    const newName = prompt("Name:", oldName); const newPhone = prompt("Phone:", oldPhone);
    if (newName) { await authFetch(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify({ name: newName, phone: newPhone }) }); fetchData(); }
}
async function deleteStage(stageId, stageName) {
    if (stageName === 'New') return alert("Cannot delete the default 'New' stage");
    if (!confirm(`Delete stage "${stageName}"?`)) return;
    await authFetch(`/api/stages/${stageId}`, { method: 'DELETE' });
    fetchData();
}

// SETTINGS & MODALS
function toggleSettingsModal() {
    const m = document.getElementById('settingsModal');
    if(m) { m.classList.toggle('hidden'); m.classList.toggle('flex'); }
}
async function syncSheet(isAuto = false) {
    const link = document.getElementById('sheetLink').value;
    const currentUser = JSON.parse(localStorage.getItem('user'));
    if(!link) return !isAuto && alert("Link required!");
    if (currentUser?.id) localStorage.setItem(`sheetLink_${currentUser.id}`, link);
    try {
        const res = await authFetch('/api/sync-sheet', { method: 'POST', body: JSON.stringify({ sheetUrl: link }) });
        const data = await res.json();
        if(!isAuto) { alert(data.success ? data.message : "Error: " + data.message); fetchData(); toggleSettingsModal(); }
    } catch (err) { console.error(err); }
}

function switchView(view) {
    document.getElementById('tableView').classList.toggle('hidden', view !== 'table');
    document.getElementById('kanbanView').classList.toggle('hidden', view !== 'kanban');
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
        if (res.ok) { toggleAddLeadModal(); fetchData(); alert("Lead Added Successfully! 🎉"); }
    } catch (err) { alert("Server Error"); }
}

// Note Modal
function openModal(id) {
    const lead = allLeadsCache.find(l => l._id === id);
    if (!lead) return;
    currentLeadId = id;
    document.getElementById('modalName').innerText = lead.name;
    document.getElementById('modalPhone').innerText = `${lead.phone || ''} | ${lead.email || ''}`;
    renderNotes(lead.notes || []);
    document.getElementById('leadModal').classList.remove('hidden');
    document.getElementById('leadModal').classList.add('flex');
}
function closeModal() {
    document.getElementById('leadModal').classList.add('hidden');
    document.getElementById('leadModal').classList.remove('flex');
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
    if(!text) return;
    try {
        const res = await authFetch(`/api/leads/${currentLeadId}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
        const updatedLead = await res.json();
        const index = allLeadsCache.findIndex(l => l._id === currentLeadId);
        allLeadsCache[index] = updatedLead;
        renderNotes(updatedLead.notes);
        input.value = '';
    } catch (err) { alert("Error saving note"); }
}
function addNewStageModal() {
    const m = document.getElementById('stageModal');
    m.classList.remove('hidden'); m.classList.add('flex');
}
function toggleStageModal() {
    const m = document.getElementById('stageModal');
    m.classList.toggle('hidden'); m.classList.toggle('flex');
}
async function addNewStage() {
    const name = document.getElementById('newStageNameInput').value;
    if(!name) return alert("Please enter a stage name");
    await authFetch('/api/stages', { method: 'POST', body: JSON.stringify({ name }) });
    document.getElementById('newStageNameInput').value = ''; 
    toggleStageModal(); fetchData();
}