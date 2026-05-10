const renderPublicBookingPage = (slug) => {
    const safeSlug = JSON.stringify(String(slug || '').trim());

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Booking</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
    <style>
      :root { --accent: #3b82f6; }
      .accent-bg { background-color: var(--accent); }
      .accent-text { color: var(--accent); }
      .accent-ring:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent); }
    </style>
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div id="app"></div>
    <script>
      (() => {
        const SLUG = ${safeSlug};
        const API_BASE = '/api/book/' + encodeURIComponent(SLUG);
        const root = document.getElementById('app');

        const state = {
          page: null,
          loading: true,
          error: '',
          service: '',
          date: '',
          time: '',
          slots: [],
          slotsLoading: false,
          dateWarning: '',
          name: '',
          phone: '',
          email: '',
          notes: '',
          customAnswers: {},
          submitting: false,
          submitError: '',
          done: false
        };

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));

        const todayISO = () => {
          const d = new Date(); d.setHours(0,0,0,0);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2,'0');
          const day = String(d.getDate()).padStart(2,'0');
          return \`\${y}-\${m}-\${day}\`;
        };

        const addDaysISO = (days) => {
          const d = new Date(); d.setHours(0,0,0,0);
          d.setDate(d.getDate() + days);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2,'0');
          const day = String(d.getDate()).padStart(2,'0');
          return \`\${y}-\${m}-\${day}\`;
        };

        const allowedDay = (isoDate) => {
          if (!state.page || !isoDate) return true;
          const availableDays = Array.isArray(state.page.availableDays) ? state.page.availableDays : [1,2,3,4,5];
          const dow = new Date(isoDate + 'T00:00:00').getDay();
          return availableDays.includes(dow);
        };

        const setAccent = (color) => {
          const c = String(color || '').trim();
          document.documentElement.style.setProperty('--accent', c || '#3b82f6');
        };

        const render = () => {
          if (state.loading) {
            root.innerHTML = \`
              <div class="min-h-screen flex items-center justify-center p-6">
                <div class="bg-white border border-slate-200 rounded-3xl p-10 shadow-sm text-center max-w-md w-full">
                  <div class="w-12 h-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center">
                    <i class="fa-solid fa-spinner fa-spin text-slate-400"></i>
                  </div>
                  <p class="mt-4 font-bold text-slate-900">Loading booking page…</p>
                  <p class="mt-1 text-sm text-slate-500">Please wait a moment.</p>
                </div>
              </div>\`;
            return;
          }

          if (state.error) {
            root.innerHTML = \`
              <div class="min-h-screen flex items-center justify-center p-6">
                <div class="bg-white border border-slate-200 rounded-3xl p-10 shadow-sm text-center max-w-md w-full">
                  <div class="w-12 h-12 mx-auto rounded-2xl bg-red-50 flex items-center justify-center">
                    <i class="fa-solid fa-triangle-exclamation text-red-500"></i>
                  </div>
                  <p class="mt-4 font-black text-slate-900">\${esc(state.error)}</p>
                  <p class="mt-1 text-sm text-slate-500">If you received this link from a business, ask them to re-share it.</p>
                </div>
              </div>\`;
            return;
          }

          if (state.done) {
            const tyMsg = (state.page?.thankYouMessage || '').replace(/\{\{name\}\}/gi, esc(state.name));
            root.innerHTML = \`
              <div class="min-h-screen flex items-center justify-center p-6">
                <div class="bg-white border border-slate-200 rounded-3xl p-10 shadow-sm text-center max-w-md w-full">
                  <div class="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center">
                    <i class="fa-solid fa-check text-emerald-600"></i>
                  </div>
                  <h1 class="mt-4 text-xl font-black text-slate-900">Booking confirmed!</h1>
                  \${tyMsg
                    ? \`<p class="mt-2 text-sm text-slate-700 leading-relaxed whitespace-pre-line">\${tyMsg}</p>\`
                    : \`<p class="mt-2 text-sm text-slate-500">You will receive a confirmation message shortly.</p>\`}
                </div>
              </div>\`;
            return;
          }

          const page = state.page || {};
          const maxAdvanceDays = Number(page.maxAdvanceDays || 30);
          const maxISO = maxAdvanceDays > 0 ? addDaysISO(maxAdvanceDays) : addDaysISO(30);

          const serviceButtons = (page.services || []).map((s) => {
            const active = state.service === s;
            return \`
              <button type="button" data-service="\${esc(s)}"
                class="w-full text-left px-4 py-3 rounded-2xl border transition-all font-semibold
                \${active ? 'border-transparent text-white shadow-md' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}"
                style="\${active ? 'background-color: var(--accent);' : ''}">
                \${esc(s)}
              </button>\`;
          }).join('');

          const slotButtons = (state.slots || []).map((slot) => {
            const time = slot?.time || slot;
            const label = slot?.label ? \`<div class="text-[11px] text-slate-400 mt-0.5">\${esc(slot.label)}</div>\` : '';
            const active = state.time === time;
            return \`
              <button type="button" data-slot="\${esc(time)}"
                class="text-left px-4 py-3 rounded-2xl border transition-all font-bold
                  \${active ? 'border-transparent text-white shadow-md' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}"
                style="\${active ? 'background-color: var(--accent);' : ''}">
                <div class="text-sm">\${esc(time)}</div>
                \${label}
              </button>\`;
          }).join('');

          const sortedQuestions = (page.customQuestions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
          const requiredAnswered = sortedQuestions
            .filter(q => q.required)
            .every(q => String(state.customAnswers[q.id] || '').trim() !== '');
          const canSubmit = !!(state.service && state.date && state.time && state.name.trim() && state.phone.trim() && requiredAnswered && !state.submitting);

          const customQuestionsHtml = sortedQuestions.length === 0 ? '' : \`
            <div class="pt-2 border-t border-slate-100">
              <p class="text-xs font-black text-slate-500 tracking-wider uppercase mb-3">
                <i class="fa-solid fa-circle-question mr-2"></i>Additional information
              </p>
              <div class="space-y-3">
                \${sortedQuestions.map(q => {
                  const val = esc(state.customAnswers[q.id] || '');
                  const label = \`<label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">\${esc(q.question)}\${q.required ? ' <span class="text-red-500">*</span>' : ''}</label>\`;
                  const baseClass = 'mt-1 w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none accent-ring';
                  let input = '';
                  if (q.type === 'textarea') {
                    input = \`<textarea data-cq="\${esc(q.id)}" rows="3" class="\${baseClass} resize-none" placeholder="\${esc(q.question)}">\${val}</textarea>\`;
                  } else if (q.type === 'select' && Array.isArray(q.options) && q.options.length) {
                    const opts = q.options.map(o => \`<option value="\${esc(o)}" \${val === esc(o) ? 'selected' : ''}>\${esc(o)}</option>\`).join('');
                    input = \`<select data-cq="\${esc(q.id)}" class="\${baseClass} bg-white"><option value="">-- Select --</option>\${opts}</select>\`;
                  } else {
                    const inputType = q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : 'text';
                    input = \`<input data-cq="\${esc(q.id)}" type="\${inputType}" class="\${baseClass}" placeholder="\${esc(q.question)}" value="\${val}" />\`;
                  }
                  return \`<div>\${label}\${input}</div>\`;
                }).join('')}
              </div>
            </div>
          \`;

          root.innerHTML = \`
            <div class="min-h-screen p-6">
              <div class="max-w-xl mx-auto">
                <div class="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
                  <div class="px-7 py-7 border-b border-slate-100 bg-gradient-to-br from-white to-slate-50">
                    <div class="flex items-center gap-4">
                      \${page.logoUrl ? \`<img src="\${esc(page.logoUrl)}" alt="Logo" class="h-12 w-12 rounded-2xl object-contain border border-slate-200 bg-white p-1" />\` : \`<div class="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center border border-slate-200"><i class="fa-solid fa-calendar-check text-slate-400"></i></div>\`}
                      <div class="min-w-0">
                        <p class="text-xs font-bold text-slate-400 tracking-widest uppercase">\${esc(page.businessName || 'Appointment')}</p>
                        <h1 class="text-xl sm:text-2xl font-black text-slate-900 truncate">\${esc(page.title || 'Book an Appointment')}</h1>
                        <p class="text-sm text-slate-500 mt-1">\${esc(page.subtitle || 'Choose a service and pick a time.')}</p>
                      </div>
                    </div>
                    \${page.description ? \`<p class="mt-4 text-sm text-slate-600 leading-relaxed whitespace-pre-line">\${esc(page.description)}</p>\` : ''}
                  </div>

                  <div class="p-7 space-y-7">
                    <div>
                      <p class="text-xs font-black text-slate-500 tracking-wider uppercase mb-3">
                        <i class="fa-solid fa-briefcase mr-2"></i>Select service
                      </p>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        \${serviceButtons || '<p class="text-sm text-slate-500">No services configured.</p>'}
                      </div>
                    </div>

                    <div>
                      <p class="text-xs font-black text-slate-500 tracking-wider uppercase mb-3">
                        <i class="fa-solid fa-calendar-days mr-2"></i>Select date
                      </p>
                      <input id="dateInput" type="date"
                        class="w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm font-semibold outline-none bg-white accent-ring"
                        min="\${todayISO()}" max="\${maxISO}" value="\${esc(state.date)}" />
                      \${state.dateWarning ? \`<div class="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"><i class="fa-solid fa-circle-info mr-2"></i>\${esc(state.dateWarning)}</div>\` : ''}
                    </div>

                    <div>
                      <div class="flex items-center justify-between mb-3">
                        <p class="text-xs font-black text-slate-500 tracking-wider uppercase">
                          <i class="fa-solid fa-clock mr-2"></i>Select time
                        </p>
                        \${state.slotsLoading ? '<span class="text-xs text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading slots</span>' : ''}
                      </div>
                      \${(state.date && state.service)
                        ? (slotButtons
                          ? \`<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">\${slotButtons}</div>\`
                          : '<p class="text-sm text-slate-500">No slots available for this date.</p>')
                        : '<p class="text-sm text-slate-500">Pick a service and date to view available slots.</p>'}
                    </div>

                    <div class="pt-2 border-t border-slate-100">
                      <p class="text-xs font-black text-slate-500 tracking-wider uppercase mb-3">
                        <i class="fa-solid fa-user mr-2"></i>Your details
                      </p>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Name *</label>
                          <input id="nameInput" type="text" class="mt-1 w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none accent-ring"
                            placeholder="Your name" value="\${esc(state.name)}" />
                        </div>
                        <div>
                          <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Phone *</label>
                          <input id="phoneInput" type="tel" class="mt-1 w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none accent-ring"
                            placeholder="e.g. 919876543210" value="\${esc(state.phone)}" />
                        </div>
                        <div class="sm:col-span-2">
                          <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Email (optional)</label>
                          <input id="emailInput" type="email" class="mt-1 w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none accent-ring"
                            placeholder="you@email.com" value="\${esc(state.email)}" />
                        </div>
                        <div class="sm:col-span-2">
                          <label class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Notes (optional)</label>
                          <textarea id="notesInput" rows="3" class="mt-1 w-full border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none accent-ring resize-none"
                            placeholder="Any specific request?">\${esc(state.notes)}</textarea>
                        </div>
                      </div>

                    </div>

                    \${customQuestionsHtml}

                    <div class="pt-2 border-t border-slate-100">
                      \${state.submitError ? \`<div class="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2"><i class="fa-solid fa-triangle-exclamation mr-2"></i>\${esc(state.submitError)}</div>\` : ''}

                      <button id="submitBtn" type="button"
                        class="mt-5 w-full py-4 rounded-2xl text-white font-black transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg"
                        style="background-color: var(--accent);">
                        \${state.submitting ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Booking…' : 'Confirm Booking'}
                      </button>
                      <p class="mt-3 text-[11px] text-slate-400 text-center">
                        By booking, you agree to be contacted regarding this appointment.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>\`;

          // ---- Event bindings (re-bound each render) ----
          document.querySelectorAll('[data-service]').forEach((btn) => {
            btn.addEventListener('click', () => {
              state.service = btn.getAttribute('data-service') || '';
              state.time = '';
              state.slots = [];
              state.submitError = '';
              if (state.date) loadSlots();
              render();
            });
          });

          document.querySelectorAll('[data-slot]').forEach((btn) => {
            btn.addEventListener('click', () => {
              state.time = btn.getAttribute('data-slot') || '';
              state.submitError = '';
              render();
            });
          });

          const dateEl = document.getElementById('dateInput');
          if (dateEl) {
            dateEl.addEventListener('change', () => {
              state.date = dateEl.value || '';
              state.time = '';
              state.slots = [];
              state.submitError = '';
              state.dateWarning = '';
              if (state.date) loadSlots();
              render();
            });
          }

          const nameEl = document.getElementById('nameInput');
          if (nameEl) nameEl.addEventListener('input', () => { state.name = nameEl.value || ''; });
          const phoneEl = document.getElementById('phoneInput');
          if (phoneEl) phoneEl.addEventListener('input', () => { state.phone = phoneEl.value || ''; });
          const emailEl = document.getElementById('emailInput');
          if (emailEl) emailEl.addEventListener('input', () => { state.email = emailEl.value || ''; });
          const notesEl = document.getElementById('notesInput');
          if (notesEl) notesEl.addEventListener('input', () => { state.notes = notesEl.value || ''; });

          document.querySelectorAll('[data-cq]').forEach((el) => {
            const qid = el.getAttribute('data-cq');
            const evt = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(evt, () => {
              state.customAnswers[qid] = el.value || '';
              const submitEl2 = document.getElementById('submitBtn');
              if (submitEl2) {
                const rq = sortedQuestions.filter(q => q.required).every(q => String(state.customAnswers[q.id] || '').trim() !== '');
                submitEl2.disabled = !(state.service && state.date && state.time && state.name.trim() && state.phone.trim() && rq && !state.submitting);
              }
            });
          });

          const submitEl = document.getElementById('submitBtn');
          if (submitEl) {
            submitEl.disabled = !canSubmit;
            submitEl.addEventListener('click', submit);
          }
        };

        const loadPage = async () => {
          state.loading = true;
          state.error = '';
          render();
          try {
            const res = await fetch(API_BASE, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error('not_ok');
            const data = await res.json();
            state.page = data || {};
            setAccent(state.page.primaryColor);
            const title = (state.page.businessName ? (state.page.businessName + ' | ') : '') + (state.page.title || 'Booking');
            document.title = title;
          } catch (_) {
            state.error = 'This booking page is not available.';
          } finally {
            state.loading = false;
            render();
          }
        };

        const loadSlots = async () => {
          if (!state.service || !state.date) return;
          if (!allowedDay(state.date)) {
            state.dateWarning = 'Selected date is not available. Please pick another date.';
            state.slots = [];
            return;
          }

          state.slotsLoading = true;
          state.dateWarning = '';
          render();
          try {
            const url = API_BASE + '/slots?date=' + encodeURIComponent(state.date);
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error('not_ok');
            const data = await res.json();
            state.slots = Array.isArray(data?.slots) ? data.slots : [];
          } catch (_) {
            // graceful fallback: show static slots if API fails
            state.slots = Array.isArray(state.page?.timeSlots) ? state.page.timeSlots : [];
          } finally {
            state.slotsLoading = false;
            render();
          }
        };

        const submit = async () => {
          state.submitError = '';
          if (!state.service || !state.date || !state.time) {
            state.submitError = 'Please select a service, date and time.';
            render();
            return;
          }
          if (!state.name.trim() || !state.phone.trim()) {
            state.submitError = 'Name and phone number are required.';
            render();
            return;
          }

          state.submitting = true;
          render();
          try {
            const allQuestions = (state.page?.customQuestions || []);
            const customAnswersPayload = allQuestions
              .filter(q => String(state.customAnswers[q.id] || '').trim())
              .map(q => ({ questionId: q.id, question: q.question, answer: String(state.customAnswers[q.id] || '').trim() }));

            const res = await fetch(API_BASE + '/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customerName: state.name,
                customerPhone: state.phone,
                customerEmail: state.email,
                serviceType: state.service,
                appointmentDate: state.date,
                appointmentTime: state.time,
                notes: state.notes,
                customAnswers: customAnswersPayload
              })
            });
            if (!res.ok) {
              let msg = 'Something went wrong. Please try again.';
              try { msg = (await res.json())?.message || msg; } catch (_) {}
              throw new Error(msg);
            }
            state.done = true;
          } catch (e) {
            state.submitError = e?.message || 'Something went wrong. Please try again.';
          } finally {
            state.submitting = false;
            render();
          }
        };

        loadPage();
      })();
    </script>
  </body>
</html>`;
};

module.exports = { renderPublicBookingPage };

