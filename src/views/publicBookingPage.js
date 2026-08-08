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
              <div class="min-h-screen bg-slate-50 flex items-center justify-center">
                  <div class="flex flex-col items-center gap-4">
                      <div class="w-10 h-10 border-4 border-slate-200 rounded-full animate-spin" style="border-top-color: var(--accent)"></div>
                      <p class="text-sm font-medium text-slate-500 animate-pulse">Loading booking page...</p>
                  </div>
              </div>\`;
            return;
          }

          if (state.error) {
            root.innerHTML = \`
              <div class="min-h-screen bg-slate-50 flex items-center justify-center px-4">
                  <div class="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 max-w-sm w-full text-center border border-slate-100">
                      <div class="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                          <i class="fa-solid fa-triangle-exclamation text-2xl"></i>
                      </div>
                      <h2 class="text-xl font-bold text-slate-900 mb-2">Unavailable</h2>
                      <p class="text-slate-500 text-sm leading-relaxed">\${esc(state.error)}</p>
                  </div>
              </div>\`;
            return;
          }

          if (state.done) {
            const tyMsg = esc(state.page?.thankYouMessage || '').replace(/\{\{name\}\}/gi, esc(state.name));
            root.innerHTML = \`
              <div class="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8 font-sans flex items-start sm:items-center justify-center selection:bg-slate-200">
                  <div class="max-w-2xl w-full mx-auto bg-white rounded-3xl shadow-2xl shadow-slate-200/60 overflow-hidden border border-slate-100 p-8 sm:p-10 text-center animate-in fade-in zoom-in duration-500">
                      <div class="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center shadow-xl accent-bg" style="box-shadow: 0 10px 25px -5px color-mix(in srgb, var(--accent) 60%, transparent)">
                          <i class="fa-solid fa-check text-white text-3xl"></i>
                      </div>
                      <h2 class="text-2xl font-extrabold text-slate-900 tracking-tight">Booking Confirmed!</h2>
                      <p class="text-slate-500 text-base mt-3 max-w-sm mx-auto leading-relaxed">
                          \${tyMsg ? tyMsg : \`Thanks, \${esc(state.name)}. We've received your booking.\`}
                      </p>
                      
                      <div class="mt-10 text-left max-w-sm mx-auto bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                          <div class="flex items-start gap-4">
                              <div class="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                                  <i class="fa-solid fa-briefcase text-slate-400 text-xs"></i>
                              </div>
                              <div>
                                  <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Service</p>
                                  <p class="text-sm font-bold text-slate-800 mt-0.5">\${esc(state.service)}</p>
                              </div>
                          </div>
                          <div class="flex items-start gap-4">
                              <div class="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                                  <i class="fa-solid fa-calendar-day text-slate-400 text-xs"></i>
                              </div>
                              <div>
                                  <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Date</p>
                                  <p class="text-sm font-bold text-slate-800 mt-0.5">\${esc(state.date)}</p>
                              </div>
                          </div>
                          <div class="flex items-start gap-4">
                              <div class="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                                  <i class="fa-solid fa-clock text-slate-400 text-xs"></i>
                              </div>
                              <div>
                                  <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Time</p>
                                  <p class="text-sm font-bold text-slate-800 mt-0.5">\${esc(state.time)}</p>
                              </div>
                          </div>
                      </div>

                      <div class="flex items-center justify-center gap-2 mt-8 text-sm font-medium text-slate-500">
                          <i class="fa-brands fa-whatsapp text-lg text-[#25d366]"></i>
                          Confirmation sent to WhatsApp
                      </div>
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
                class="px-5 py-4 rounded-xl text-sm font-semibold border transition-all duration-200 text-left hover:scale-[1.02] \${active ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}"
                style="\${active ? 'background-color: var(--accent); box-shadow: 0 4px 14px 0 color-mix(in srgb, var(--accent) 40%, transparent);' : ''}">
                \${esc(s)}
              </button>\`;
          }).join('');

          const slotButtons = (state.slots || []).map((slot) => {
            const time = slot?.time || slot;
            const active = state.time === time;
            return \`
              <button type="button" data-slot="\${esc(time)}"
                class="py-3 rounded-xl text-sm font-bold border transition-all duration-200 hover:scale-[1.03] \${active ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}"
                style="\${active ? 'background-color: var(--accent); box-shadow: 0 4px 14px 0 color-mix(in srgb, var(--accent) 40%, transparent);' : ''}">
                \${esc(time)}
              </button>\`;
          }).join('');

          const sortedQuestions = (page.customQuestions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
          const requiredAnswered = sortedQuestions
            .filter(q => q.required)
            .every(q => String(state.customAnswers[q.id] || '').trim() !== '');
          const canSubmit = !!(state.service && state.date && state.time && state.name.trim() && state.phone.trim() && requiredAnswered && !state.submitting);

          const baseClass = 'mt-1 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 placeholder-slate-400 bg-white shadow-sm transition-all focus:outline-none accent-ring';

          const customQuestionsHtml = sortedQuestions.length === 0 ? '' : \`
            <section class="space-y-5 pt-8 border-t border-slate-100">
              <div class="flex items-center gap-2 mb-2">
                  <i class="fa-solid fa-clipboard-list text-slate-400"></i>
                  <h3 class="text-sm font-bold text-slate-800">Additional Information</h3>
              </div>
              <div class="grid grid-cols-1 gap-5">
                \${sortedQuestions.map(q => {
                  const val = esc(state.customAnswers[q.id] || '');
                  const label = \`<label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">\${esc(q.question)}\${q.required ? ' <span class="font-bold text-slate-400">*</span>' : ''}</label>\`;
                  let input = '';
                  if (q.type === 'textarea') {
                    input = \`<textarea data-cq="\${esc(q.id)}" rows="3" class="\${baseClass} resize-none" placeholder="\${esc(q.question)}">\${val}</textarea>\`;
                  } else if (q.type === 'select' && Array.isArray(q.options) && q.options.length) {
                    const opts = q.options.map(o => \`<option value="\${esc(o)}" \${val === esc(o) ? 'selected' : ''}>\${esc(o)}</option>\`).join('');
                    input = \`<select data-cq="\${esc(q.id)}" class="\${baseClass}"><option value="">-- Select --</option>\${opts}</select>\`;
                  } else {
                    const inputType = q.type === 'email' ? 'email' : q.type === 'phone' ? 'tel' : 'text';
                    input = \`<input data-cq="\${esc(q.id)}" type="\${inputType}" class="\${baseClass}" placeholder="\${esc(q.question)}" value="\${val}" />\`;
                  }
                  return \`<div>\${label}\${input}</div>\`;
                }).join('')}
              </div>
            </section>
          \`;

          root.innerHTML = \`
            <div class="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8 font-sans flex items-start sm:items-center justify-center selection:bg-slate-200">
                <div class="max-w-2xl w-full mx-auto bg-white rounded-3xl shadow-2xl shadow-slate-200/60 overflow-hidden border border-slate-100 flex flex-col animate-in fade-in duration-300">
                    
                    <!-- Header -->
                    <header class="px-8 pt-14 pb-10 text-center relative overflow-hidden shrink-0" style="background-color: color-mix(in srgb, var(--accent) 8%, white)">
                        <div class="absolute -top-24 -right-24 w-56 h-56 rounded-full blur-3xl opacity-40 mix-blend-multiply accent-bg"></div>
                        <div class="absolute -bottom-24 -left-24 w-56 h-56 rounded-full blur-3xl opacity-40 mix-blend-multiply accent-bg"></div>
                        
                        <div class="relative z-10">
                            \${page.logoUrl ? \`
                                <img src="\${esc(page.logoUrl)}" alt="" class="w-20 h-20 object-contain rounded-2xl mx-auto mb-6 shadow-md border border-white/50 bg-white p-1" />
                            \` : \`
                                <div class="w-16 h-16 rounded-2xl mx-auto mb-6 shadow-sm border border-slate-200 bg-white flex items-center justify-center">
                                    <i class="fa-solid fa-calendar-check text-slate-300 text-2xl"></i>
                                </div>
                            \`}
                            <h1 class="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">\${esc(page.title || 'Book an Appointment')}</h1>
                            \${page.subtitle ? \`<p class="text-slate-600 mt-4 text-base leading-relaxed max-w-md mx-auto">\${esc(page.subtitle)}</p>\` : ''}
                            \${page.businessName ? \`<p class="mt-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">\${esc(page.businessName)}</p>\` : ''}
                        </div>
                    </header>

                    <!-- Content -->
                    <div class="p-8 sm:p-10 flex-1 overflow-y-auto space-y-10">
                        
                        \${page.description ? \`
                            <div class="bg-slate-50 border border-slate-100 rounded-2xl p-6">
                                <p class="text-slate-600 text-sm leading-relaxed text-center">\${esc(page.description)}</p>
                            </div>
                        \` : ''}

                        <section>
                            <div class="flex items-center gap-2 mb-4">
                                <i class="fa-solid fa-briefcase text-slate-400"></i>
                                <h3 class="text-sm font-bold text-slate-800">Select Service</h3>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                \${serviceButtons || '<p class="text-sm text-slate-500 font-medium">No services configured.</p>'}
                            </div>
                        </section>

                        <section>
                            <div class="flex items-center gap-2 mb-4">
                                <i class="fa-solid fa-calendar-days text-slate-400"></i>
                                <h3 class="text-sm font-bold text-slate-800">Select Date</h3>
                            </div>
                            <input id="dateInput" type="date"
                                class="\${baseClass}"
                                min="\${todayISO()}" max="\${maxISO}" value="\${esc(state.date)}" />
                            \${state.dateWarning ? \`<div class="mt-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 animate-in slide-in-from-top-2"><i class="fa-solid fa-circle-info mr-2"></i>\${esc(state.dateWarning)}</div>\` : ''}
                        </section>

                        <section>
                            <div class="flex items-center gap-2 mb-4">
                                <i class="fa-solid fa-clock text-slate-400"></i>
                                <h3 class="text-sm font-bold text-slate-800">Select Time</h3>
                            </div>
                            
                            \${state.slotsLoading ? \`
                                <div class="flex items-center justify-center gap-3 py-10 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400">
                                    <div class="w-5 h-5 border-2 border-slate-300 rounded-full animate-spin" style="border-top-color: var(--accent)"></div>
                                    <span class="text-sm font-medium">Checking availability...</span>
                                </div>
                            \` : (state.date && state.service) ? (slotButtons ? \`
                                <div class="grid grid-cols-3 sm:grid-cols-4 gap-3 animate-in fade-in slide-in-from-top-4 duration-300">\${slotButtons}</div>
                            \` : \`
                                <div class="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                                    <p class="text-slate-500 text-sm font-medium">No slots available on this day.</p>
                                </div>
                            \`) : \`
                                <div class="text-center py-8 bg-slate-50 rounded-2xl border border-slate-100">
                                    <p class="text-slate-400 text-sm font-medium">Pick a service and date to view available slots.</p>
                                </div>
                            \`}
                        </section>

                        <section class="space-y-5 pt-8 border-t border-slate-100">
                            <div class="flex items-center gap-2 mb-2">
                                <i class="fa-solid fa-user text-slate-400"></i>
                                <h3 class="text-sm font-bold text-slate-800">Your Details</h3>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                <div class="sm:col-span-2">
                                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full name *</label>
                                    <input id="nameInput" type="text" class="\${baseClass}" placeholder="John Doe" value="\${esc(state.name)}" />
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">WhatsApp number *</label>
                                    <input id="phoneInput" type="tel" class="\${baseClass}" placeholder="+1 234 567 8900" value="\${esc(state.phone)}" />
                                </div>
                                <div>
                                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                        Email <span class="font-medium normal-case opacity-70">(optional)</span>
                                    </label>
                                    <input id="emailInput" type="email" class="\${baseClass}" placeholder="john@example.com" value="\${esc(state.email)}" />
                                </div>
                                <div class="sm:col-span-2">
                                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                        Notes <span class="font-medium normal-case opacity-70">(optional)</span>
                                    </label>
                                    <textarea id="notesInput" rows="3" class="\${baseClass} resize-none" placeholder="Any special requests or details?">\${esc(state.notes)}</textarea>
                                </div>
                            </div>
                        </section>

                        \${customQuestionsHtml}

                        <div class="pt-8 border-t border-slate-100">
                            \${state.submitError ? \`
                                <div class="mb-4 flex items-center gap-3 text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-xl p-4 animate-in shake">
                                    <i class="fa-solid fa-triangle-exclamation text-lg shrink-0"></i>
                                    \${esc(state.submitError)}
                                </div>
                            \` : ''}

                            <button id="submitBtn" type="button" disabled
                                class="w-full py-4 rounded-xl text-white font-bold text-base shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-3"
                                style="background-color: var(--accent); box-shadow: 0 10px 25px -5px color-mix(in srgb, var(--accent) 60%, transparent)">
                                \${state.submitting ? \`
                                    <span class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                    Processing...
                                \` : \`Confirm Booking\`}
                            </button>
                            <p class="mt-4 text-[11px] font-medium text-slate-400 text-center">
                                By booking, you agree to be contacted regarding this appointment.
                            </p>
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

          // Recompute the submit button's disabled state without a full re-render,
          // so typing in the details fields re-enables it immediately.
          const refreshSubmitDisabled = () => {
            const btn = document.getElementById('submitBtn');
            if (!btn) return;
            const rq = sortedQuestions.filter(q => q.required).every(q => String(state.customAnswers[q.id] || '').trim() !== '');
            btn.disabled = !(state.service && state.date && state.time && state.name.trim() && state.phone.trim() && rq && !state.submitting);
          };

          const nameEl = document.getElementById('nameInput');
          if (nameEl) nameEl.addEventListener('input', () => { state.name = nameEl.value || ''; refreshSubmitDisabled(); });
          const phoneEl = document.getElementById('phoneInput');
          if (phoneEl) phoneEl.addEventListener('input', () => { state.phone = phoneEl.value || ''; refreshSubmitDisabled(); });
          const emailEl = document.getElementById('emailInput');
          if (emailEl) emailEl.addEventListener('input', () => { state.email = emailEl.value || ''; });
          const notesEl = document.getElementById('notesInput');
          if (notesEl) notesEl.addEventListener('input', () => { state.notes = notesEl.value || ''; });

          document.querySelectorAll('[data-cq]').forEach((el) => {
            const qid = el.getAttribute('data-cq');
            const evt = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(evt, () => {
              state.customAnswers[qid] = el.value || '';
              refreshSubmitDisabled();
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

