const renderManageBookingPage = (token) => {
    const safeToken = JSON.stringify(String(token || '').trim());

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Manage Appointment</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
    <style>
      :root { --accent: #3b82f6; }
    </style>
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div id="app"></div>
    <script>
      (() => {
        const TOKEN = ${safeToken};
        const API = '/api/book/manage/' + encodeURIComponent(TOKEN);
        const root = document.getElementById('app');

        const state = {
          loading: true, error: '', data: null,
          mode: 'view',          // 'view' | 'reschedule' | 'done'
          doneMsg: '',
          date: '', time: '', slots: [], slotsLoading: false, actionError: '', busy: false
        };

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));

        const todayISO = () => { const d = new Date(); d.setHours(0,0,0,0);
          return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
        const addDaysISO = (n) => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n);
          return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };

        const card = (inner) => \`<div class="min-h-screen flex items-center justify-center p-6"><div class="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm max-w-md w-full">\${inner}</div></div>\`;

        const statusBadge = (s) => {
          const map = { Pending:'bg-amber-50 text-amber-700', Confirmed:'bg-emerald-50 text-emerald-700', Cancelled:'bg-red-50 text-red-700', Completed:'bg-slate-100 text-slate-600', 'No-Show':'bg-red-50 text-red-700' };
          return \`<span class="text-xs font-bold px-2.5 py-1 rounded-full \${map[s] || 'bg-slate-100 text-slate-600'}">\${esc(s)}</span>\`;
        };

        const detailsBlock = (a, biz) => \`
          <div class="flex items-center justify-between mb-1">
            <p class="text-xs font-bold text-slate-400 tracking-widest uppercase">\${esc(biz || 'Appointment')}</p>
            \${statusBadge(a.status)}
          </div>
          <h1 class="text-xl font-black text-slate-900 mb-4">Your appointment</h1>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td class="py-2 text-sm text-slate-500">Service</td><td class="py-2 font-semibold text-right">\${esc(a.serviceType)}</td></tr>
            <tr class="border-t border-slate-100"><td class="py-2 text-sm text-slate-500">Date</td><td class="py-2 font-semibold text-right">\${esc(a.appointmentDate)}</td></tr>
            <tr class="border-t border-slate-100"><td class="py-2 text-sm text-slate-500">Time</td><td class="py-2 font-semibold text-right">\${esc(a.appointmentTime)}</td></tr>
          </table>\`;

        const render = () => {
          if (state.loading) { root.innerHTML = card('<p class="text-center text-slate-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>'); return; }
          if (state.error)  { root.innerHTML = card('<p class="text-center font-bold text-slate-800">' + esc(state.error) + '</p>'); return; }

          if (state.mode === 'done') {
            root.innerHTML = card(\`
              <div class="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center"><i class="fa-solid fa-check text-emerald-600"></i></div>
              <h1 class="mt-4 text-xl font-black text-center text-slate-900">Done</h1>
              <p class="mt-2 text-sm text-slate-600 text-center">\${esc(state.doneMsg)}</p>\`);
            return;
          }

          const a = state.data.appointment;
          const page = state.data.page || {};

          if (!state.data.canModify) {
            root.innerHTML = card(detailsBlock(a, page.businessName) +
              \`<p class="mt-5 text-sm text-slate-500 text-center">This appointment is \${esc(a.status.toLowerCase())} and can no longer be changed.</p>\`);
            return;
          }

          if (state.mode === 'reschedule') {
            const maxISO = addDaysISO(Number(page.maxAdvanceDays || 30) || 30);
            const slotButtons = (state.slots || []).map(s => {
              const t = s.time || s; const active = state.time === t;
              return \`<button data-slot="\${esc(t)}" class="px-3 py-2.5 rounded-xl border text-sm font-bold \${active ? 'text-white border-transparent' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}" style="\${active ? 'background:var(--accent)' : ''}">\${esc(t)}</button>\`;
            }).join('');
            root.innerHTML = card(\`
              <h1 class="text-lg font-black text-slate-900 mb-4">Reschedule</h1>
              <label class="text-[11px] font-bold text-slate-500 uppercase">New date</label>
              <input id="d" type="date" min="\${todayISO()}" max="\${maxISO}" value="\${esc(state.date)}" class="mt-1 mb-4 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none" />
              <label class="text-[11px] font-bold text-slate-500 uppercase">New time</label>
              <div class="mt-1 grid grid-cols-2 gap-2 min-h-[44px]">
                \${state.slotsLoading ? '<p class="text-sm text-slate-400 col-span-2"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>'
                  : (state.date ? (slotButtons || '<p class="text-sm text-slate-500 col-span-2">No slots available.</p>') : '<p class="text-sm text-slate-500 col-span-2">Pick a date.</p>')}
              </div>
              \${state.actionError ? '<p class="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">' + esc(state.actionError) + '</p>' : ''}
              <div class="mt-5 flex gap-2">
                <button id="back" class="flex-1 py-3 rounded-xl border border-slate-200 font-bold text-slate-600">Back</button>
                <button id="confirm" class="flex-1 py-3 rounded-xl text-white font-black disabled:opacity-60" style="background:var(--accent)" \${(state.date && state.time && !state.busy) ? '' : 'disabled'}>\${state.busy ? 'Saving…' : 'Confirm'}</button>
              </div>\`);

            const d = document.getElementById('d');
            d && d.addEventListener('change', () => { state.date = d.value; state.time=''; state.actionError=''; loadSlots(); render(); });
            document.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => { state.time = b.getAttribute('data-slot'); render(); }));
            document.getElementById('back').addEventListener('click', () => { state.mode='view'; state.actionError=''; render(); });
            document.getElementById('confirm').addEventListener('click', doReschedule);
            return;
          }

          // view mode
          root.innerHTML = card(detailsBlock(a, page.businessName) + \`
            \${state.actionError ? '<p class="mt-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">' + esc(state.actionError) + '</p>' : ''}
            <div class="mt-6 flex gap-2">
              <button id="resched" class="flex-1 py-3 rounded-xl text-white font-black" style="background:var(--accent)">Reschedule</button>
              <button id="cancel" class="flex-1 py-3 rounded-xl border border-red-200 text-red-600 font-bold">Cancel</button>
            </div>\`);
          document.getElementById('resched').addEventListener('click', () => { state.mode='reschedule'; state.date=''; state.time=''; state.slots=[]; render(); });
          document.getElementById('cancel').addEventListener('click', doCancel);
        };

        const loadSlots = async () => {
          if (!state.date || !state.data?.page?.slug) return;
          state.slotsLoading = true; render();
          try {
            const res = await fetch('/api/book/' + encodeURIComponent(state.data.page.slug) + '/slots?date=' + encodeURIComponent(state.date));
            const j = await res.json();
            state.slots = Array.isArray(j?.slots) ? j.slots : [];
          } catch (_) { state.slots = []; }
          finally { state.slotsLoading = false; render(); }
        };

        const doCancel = async () => {
          if (!confirm('Cancel this appointment?')) return;
          state.actionError=''; state.busy=true; render();
          try {
            const res = await fetch(API + '/cancel', { method:'POST' });
            const j = await res.json();
            if (!res.ok) throw new Error(j?.message || 'Could not cancel.');
            state.mode='done'; state.doneMsg = j.message || 'Your appointment has been cancelled.';
          } catch (e) { state.actionError = e.message; }
          finally { state.busy=false; render(); }
        };

        const doReschedule = async () => {
          state.actionError=''; state.busy=true; render();
          try {
            const res = await fetch(API + '/reschedule', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ appointmentDate: state.date, appointmentTime: state.time })
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j?.message || 'Could not reschedule.');
            state.mode='done'; state.doneMsg = j.message || 'Your appointment has been rescheduled.';
          } catch (e) { state.actionError = e.message; state.busy=false; render(); return; }
          state.busy=false; render();
        };

        const load = async () => {
          try {
            const res = await fetch(API, { headers: { 'Accept':'application/json' } });
            if (!res.ok) throw new Error('not_found');
            state.data = await res.json();
            const c = state.data?.page?.primaryColor;
            if (c) document.documentElement.style.setProperty('--accent', c);
          } catch (_) { state.error = 'This appointment link is invalid or has expired.'; }
          finally { state.loading = false; render(); }
        };

        load();
      })();
    </script>
  </body>
</html>`;
};

module.exports = { renderManageBookingPage };
