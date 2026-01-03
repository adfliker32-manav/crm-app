// 🔒 SECURITY & USER
const token = localStorage.getItem('token');
const user = JSON.parse(localStorage.getItem('user'));

if (!token) window.location.href = 'login.html';
else if(user) document.getElementById('userNameDisplay').innerText = user.name;

function logout() {
    if(confirm("Logout?")) {
        localStorage.clear();
        window.location.href = 'login.html';
    }
}

// 🔥 AUTH FETCH
async function authFetch(url, options = {}) {
    options.headers = { ...options.headers, 'Authorization': token, 'Content-Type': 'application/json' };
    const res = await fetch(url, options);
    if(res.status === 401) { alert("Session Expired"); logout(); }
    return res;
}

// --- VARIABLES ---
let drake, currentLeadId = null, allLeadsCache = [];

// 🔥 PAGE LOAD
document.addEventListener('DOMContentLoaded', () => {
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
});

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

// 🔥 RENDER CARDS (TABLE VIEW REPLACEMENT)
function renderTable(leads) {
    const container = document.getElementById('leadsTableBody');
    document.getElementById('totalCount').innerText = leads.length;
    container.innerHTML = '';

    leads.forEach(lead => {
        // Date Fix logic
        let dateDisplay = '-';
        if(lead.date) {
            const d = new Date(lead.date);
            if(!isNaN(d.getTime())) dateDisplay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        // Color badge logic
        const statusColors = {
            'New': 'bg-blue-100 text-blue-800',
            'Contacted': 'bg-yellow-100 text-yellow-800',
            'Won': 'bg-green-100 text-green-800',
            'Lost': 'bg-red-100 text-red-800'
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
                <span class="${badgeClass} px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide shadow-sm">
                    ${lead.status}
                </span>
                <span class="text-xs text-gray-400 font-medium">
                    <i class="fa-regular fa-calendar mr-1"></i> ${dateDisplay}
                </span>
            </div>

            <div class="flex items-center gap-2">
                
                <button onclick="openModal('${lead._id}')" class="flex items-center gap-1 bg-orange-50 hover:bg-orange-100 text-orange-600 px-3 py-2 rounded-lg text-sm font-medium transition border border-orange-200">
                    <i class="fa-regular fa-note-sticky"></i> Note
                </button>

                <button onclick="editLead('${lead._id}', '${lead.name}', '${lead.phone}')" class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-blue-100 hover:text-blue-600 transition text-gray-500">
                    <i class="fa-solid fa-pen"></i>
                </button>
                
                <button onclick="deleteLead('${lead._id}')" class="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-red-100 hover:text-red-600 transition text-gray-500">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>

        </div>`;
        container.innerHTML += card;
    });
}

// 🔥 KANBAN WITH TAILWIND
function renderKanban(stages, leads) {
    const board = document.getElementById('kanbanBoard');
    board.innerHTML = ''; 
    const dragContainers = []; 

    stages.forEach(stage => {
        const count = leads.filter(l => (l.status || 'New') === stage.name).length;
        board.innerHTML += `
            <div class="kanban-column w-72 flex-shrink-0 flex flex-col h-full">
                <div class="bg-slate-800 text-white p-3 rounded-t-xl font-bold flex justify-between items-center shadow-md">
                    <div class="flex items-center gap-3">
                        <span class="truncate">${stage.name}</span>
                        <span class="bg-slate-600 text-xs px-2 py-1 rounded-full">
                            ${count}
                        </span>
                    </div>
                    ${stage.name !== 'New' ? `<button onclick="deleteStage('${stage._id}','${stage.name}')" class="ml-2 w-8 h-8 flex items-center justify-center rounded-full bg-red-600 hover:bg-red-500 text-white text-sm" title="Delete stage"><i class="fa-solid fa-trash"></i></button>` : `<button disabled class="ml-2 w-8 h-8 flex items-center justify-center rounded-full bg-gray-500 text-white text-sm opacity-50" title="Can't delete default stage"><i class="fa-solid fa-trash"></i></button>`}
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
                card.innerHTML = `
                    <h4 class="font-bold text-gray-800">${lead.name}</h4>
                    <p class="text-xs text-gray-500 mt-1"><i class="fa-solid fa-phone"></i> ${lead.phone || '-'}</p>
                `;
                container.appendChild(card);
            });
        });

        if (drake) drake.destroy();
        drake = dragula(dragContainers);
        drake.on('drop', (el, target) => updateStatus(el.id, target.id));
    }, 100);
}

// ... (Baki Functions: Chart, Status Update, Delete, Edit, Sync, Modal same as before) ...
// Copy paste the rest of the utility functions below:

// CHART
let myChart;
function renderChart(stats) {
    const ctx = document.getElementById('myChart').getContext('2d');
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(stats),
            datasets: [{ data: Object.values(stats), backgroundColor: ['#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
}

// ACTIONS
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

// Delete Stage (frontend handler)
async function deleteStage(stageId, stageName) {
    // Show custom modal instead of browser confirm
    if (stageName === 'New') {
        showToast("Cannot delete the default 'New' stage", 'error');
        return;
    }
    showConfirmModal(stageId, stageName);
}

function showConfirmModal(stageId, stageName) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmStageName').innerText = stageName;
    modal.dataset.stageId = stageId;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const btn = document.getElementById('confirmDeleteBtn');
    btn.onclick = () => performDeleteStage(stageId, stageName);
}

function hideConfirmModal() {
    const modal = document.getElementById('confirmModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    delete modal.dataset.stageId;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.onclick = null;
}

async function performDeleteStage(stageId, stageName) {
    try {
        const btn = document.getElementById('confirmDeleteBtn');
        btn.disabled = true; btn.innerText = 'Deleting...';

        const res = await authFetch(`/api/stages/${stageId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            hideConfirmModal();
            showToast(`Stage "${stageName}" deleted. ${data.reassignCount ?? 0} lead(s) reassigned.`, 'success');
            fetchData();
        } else {
            showToast(data.message || 'Error deleting stage', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Server error while deleting stage', 'error');
    } finally {
        const btn = document.getElementById('confirmDeleteBtn');
        btn.disabled = false; btn.innerText = 'Delete Stage';
    }
}

// Simple Toast Utility
function showToast(message, type = 'success', timeout = 3500) {
    const container = document.getElementById('toastContainer');
    const id = 'toast_' + Date.now();
    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-blue-600'
    };
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `${colors[type] || colors.info} text-white px-4 py-2 rounded shadow-md animate-fade-in-up max-w-xs`;
    toast.innerText = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => { try { container.removeChild(toast); } catch (e) {} }, 300);
    }, timeout);
}

// SETTINGS MODAL (For Sheet Sync)
function toggleSettingsModal() {
    const m = document.getElementById('settingsModal');
    m.classList.toggle('hidden');
    m.classList.toggle('flex');
}

// SYNC
async function syncSheet(isAuto = false) {
    const link = document.getElementById('sheetLink').value;
    const currentUser = JSON.parse(localStorage.getItem('user'));
    if(!link) return !isAuto && alert("Link required!");
    if (currentUser?.id) localStorage.setItem(`sheetLink_${currentUser.id}`, link);

    if(!isAuto) {
        const btn = document.querySelector('#settingsModal button');
        btn.innerText = "Syncing..."; btn.disabled = true;
    }

    try {
        const res = await authFetch('/api/sync-sheet', { method: 'POST', body: JSON.stringify({ sheetUrl: link }) });
        const data = await res.json();
        if(!isAuto) { alert(data.success ? data.message : "Error: " + data.message); fetchData(); toggleSettingsModal(); }
    } catch (err) { console.error(err); }

    if(!isAuto) {
        const btn = document.querySelector('#settingsModal button');
        btn.innerText = "Sync Now"; btn.disabled = false;
    }
}

// VIEW SWITCH
function switchView(view) {
    document.getElementById('tableView').classList.toggle('hidden', view !== 'table');
    document.getElementById('kanbanView').classList.toggle('hidden', view !== 'kanban');
}

// SEARCH
function filterLeads() {
    const filter = document.getElementById('searchBox').value.toLowerCase();
    const cards = document.getElementById('leadsTableBody').children;
    Array.from(cards).forEach(card => {
        card.style.display = card.innerText.toLowerCase().includes(filter) ? "" : "none";
    });
}

// MODAL & NOTES
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
// 🔥 STAGE MANAGEMENT FIX

// 1. Modal Open/Close
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

// 2. API Call to Add Stage
async function addNewStage() {
    const nameInput = document.getElementById('newStageNameInput');
    const name = nameInput.value;
    
    if(!name) return alert("Please enter a stage name");

    try {
        await authFetch('/api/stages', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        
        nameInput.value = ''; // Clear input
        toggleStageModal(); // Close popup
        fetchData(); // Refresh board
    } catch (err) {
        alert("Error adding stage");
    }
}
// 🔥 MANUAL LEAD ENTRY LOGIC

function toggleAddLeadModal() {
    const m = document.getElementById('addLeadModal');
    m.classList.toggle('hidden');
    m.classList.toggle('flex');
}

async function saveNewLead(event) {
    event.preventDefault(); // Form refresh hone se roko

    const name = document.getElementById('manualName').value;
    const phone = document.getElementById('manualPhone').value;
    const email = document.getElementById('manualEmail').value;

    try {
        const res = await authFetch('/api/leads', {
            method: 'POST',
            body: JSON.stringify({ name, phone, email })
        });

        if (res.ok) {
            // Success
            document.getElementById('manualName').value = '';
            document.getElementById('manualPhone').value = '';
            document.getElementById('manualEmail').value = '';
            
            toggleAddLeadModal(); // Close Modal
            fetchData(); // Table refresh karo
            alert("Lead Added Successfully! 🎉");
        } else {
            alert("Error adding lead.");
        }
    } catch (err) {
        console.error(err);
        alert("Server Error");
    }
}