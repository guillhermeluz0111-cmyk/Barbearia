const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, selected: [], date: '', time: '', rescheduleId: null, rescheduleTime: '', clientKey: null, clientQuery: '', step: 1, saving: false, weekStart: 0 };
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = value => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`)) : '—';
const shortDate = value => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(`${value}T12:00:00Z`));
const minutesLabel = value => value >= 60 ? `${Math.floor(value / 60)}h${value % 60 ? String(value % 60).padStart(2, '0') : ''}` : `${value} min`;
const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const addDaysISO = days => { const date = new Date(`${todayISO()}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const statusLabels = { pending_confirmation: 'Aguardando confirmação', scheduled: 'Confirmado', attended: 'Compareceu', no_show: 'Desistência', rescheduled: 'Reagendado' };

async function api(url, options = {}) {
  const { status, data } = await Store.handle(url, options);
  if (status >= 400) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}

function toast(message) {
  const element = $('#toast'); element.textContent = message; element.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
}

function selectedServices() {
  return state.data.services.filter(item => state.selected.includes(item.id));
}
function totals() {
  return selectedServices().reduce((acc, item) => ({ total: acc.total + item.price, duration: acc.duration + item.duration }), { total: 0, duration: 0 });
}

function renderServices() {
  $('#service-grid').innerHTML = state.data.services.map(item => {
    const ready = item.active && item.price !== null && item.duration !== null;
    return `<button type="button" class="service-card ${state.selected.includes(item.id) ? 'selected' : ''} ${ready ? '' : 'unavailable'}" data-service="${esc(item.id)}" ${ready ? '' : 'disabled'}>
      <div><h4>${esc(item.name)}</h4><p>${esc(item.description || '')}</p>${ready ? `<small>${minutesLabel(item.duration)}</small>` : '<small>Em breve</small>'}</div>
      <div><div class="service-check">✓</div>${ready ? `<strong>${BRL.format(item.price)}</strong>` : ''}</div>
      ${item.featured ? '<span class="featured-tag">MAIS ESCOLHIDO</span>' : ''}
    </button>`;
  }).join('');
  $$('[data-service]').forEach(button => button.addEventListener('click', () => toggleService(button.dataset.service)));
  updateScrollHint();
}

function toggleService(id) {
  if (id === 'combo') state.selected = state.selected.includes(id) ? [] : [...state.selected.filter(value => !['corte', 'barba', 'sobrancelha'].includes(value)), id];
  else {
    state.selected = state.selected.filter(value => value !== 'combo');
    state.selected = state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id];
  }
  state.time = '';
  renderServices(); updateSummary();
}

/* ---------- Agendamento em etapas ---------- */
const STEP_NAMES = ['Serviços', 'Data e horário', 'Seus dados', 'Confirmar'];
const dowOf = date => new Date(`${date}T12:00:00Z`).getUTCDay();
const hoursOn = date => state.data.hours.find(item => item.day === dowOf(date));
const toMinutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
function dayAvailable(date) {
  const cfg = hoursOn(date); if (!cfg || !cfg.active) return false;
  if (date !== todayISO()) return true;
  const now = new Date(); return now.getHours() * 60 + now.getMinutes() < toMinutes(cfg.close);
}
const firstOpenDay = () => { for (let i = 0; i < 28; i++) if (dayAvailable(addDaysISO(i))) return addDaysISO(i); return todayISO(); };
const phoneDigits = () => $('#customer-phone').value.replace(/\D/g, '');
const stepValid = n => n === 1 ? state.selected.length > 0
  : n === 2 ? Boolean(state.date && state.time)
  : n === 3 ? $('#customer-name').value.trim().length >= 2 && phoneDigits().length >= 10 : true;
const canGo = n => { for (let i = 1; i < n; i++) if (!stepValid(i)) return false; return true; };

function goStep(n) {
  if (n < 1 || n > 4 || !canGo(n)) return;
  state.step = n;
  if (n === 2) {
    if (!state.date) { state.date = firstOpenDay(); state.time = ''; }
    $('#booking-date').value = state.date;
    state.weekStart = Math.max(0, Math.floor(Math.round((new Date(`${state.date}T12:00:00Z`) - new Date(`${todayISO()}T12:00:00Z`)) / 86400000) / 7) * 7);
    renderDays(); loadSlots();
  }
  updateSummary();
  $('#bk-body').scrollTop = 0; updateScrollHint();
  const box = $('#bk'); const header = $('.site-header');
  const top = box.getBoundingClientRect().top;
  if (top < (header ? header.offsetHeight : 0) || box.getBoundingClientRect().bottom > innerHeight + 4) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderDays() {
  const fmtDay = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });
  const fmtMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'short' });
  const dates = Array.from({ length: 7 }, (_, i) => addDaysISO(state.weekStart + i));
  const short = date => { const d = new Date(`${date}T12:00:00Z`); return `${d.getUTCDate()} ${fmtMonth.format(d).replace('.', '')}`; };
  $('#week-label').textContent = `${short(dates[0])} – ${short(dates[6])}`;
  $('#week-prev').disabled = state.weekStart <= 0;
  $('#day-strip').innerHTML = dates.map(date => {
    const d = new Date(`${date}T12:00:00Z`);
    return `<button type="button" class="day-chip ${date === state.date ? 'selected' : ''}" data-day="${date}" ${dayAvailable(date) ? '' : 'disabled'}>
      <small>${fmtDay.format(d).replace('.', '')}</small><b>${d.getUTCDate()}</b></button>`;
  }).join('');
  $$('[data-day]').forEach(button => button.addEventListener('click', () => selectDate(button.dataset.day)));
}

function selectDate(date) {
  if (!date) return;
  state.date = date; state.time = ''; $('#booking-date').value = date;
  const diff = Math.round((new Date(`${date}T12:00:00Z`) - new Date(`${todayISO()}T12:00:00Z`)) / 86400000);
  state.weekStart = Math.max(0, Math.floor(diff / 7) * 7);
  renderDays(); loadSlots(); updateSummary();
}
function shiftWeek(direction) { state.weekStart = Math.max(0, state.weekStart + direction * 7); renderDays(); }

async function loadSlots() {
  const box = $('#time-slots');
  if (!state.date) { box.innerHTML = ''; return; }
  if (!hoursOn(state.date) || !hoursOn(state.date).active) { box.innerHTML = '<p class="empty-note">Estamos fechados neste dia. Escolha outra data.</p>'; updateScrollHint(); return; }
  const token = `${state.date}|${state.selected.join(',')}`; loadSlots.token = token;
  box.innerHTML = '<p class="empty-note">Consultando a agenda…</p>';
  try {
    const result = await api(`/api/availability?date=${state.date}&services=${state.selected.join(',')}`);
    if (loadSlots.token !== token) return;
    if (state.time && !result.slots.includes(state.time)) state.time = '';
    const groups = [['Manhã', t => t < '12:00'], ['Tarde', t => t >= '12:00' && t < '18:00'], ['Noite', t => t >= '18:00']];
    box.innerHTML = result.slots.length
      ? groups.map(([name, test]) => { const list = result.slots.filter(test); return list.length ? `<div class="slot-group"><h5>${name}</h5><div class="slot-row">${list.map(time => `<button type="button" class="time-slot ${state.time === time ? 'selected' : ''}" data-time="${time}">${time}</button>`).join('')}</div></div>` : ''; }).join('')
      : '<p class="empty-note">Nenhum horário disponível neste dia para essa combinação. Tente outra data.</p>';
    $$('[data-time]', box).forEach(button => button.addEventListener('click', () => {
      state.time = button.dataset.time; $$('.time-slot', box).forEach(item => item.classList.toggle('selected', item === button)); updateSummary();
    }));
  } catch (error) { box.innerHTML = `<p class="empty-note">${esc(error.message)}</p>`; }
  updateSummary(); updateScrollHint();
}

function renderReview() {
  const services = selectedServices(); const sum = totals();
  $('#bk-review').innerHTML = `
    <div class="rv-block"><div class="rv-title"><small>Serviços</small><button type="button" class="rv-edit" data-go="1">Alterar</button></div>
      ${services.map(item => `<div class="rv-line"><span>${esc(item.name)}</span><b>${BRL.format(item.price)}</b></div>`).join('')}</div>
    <div class="rv-block"><div class="rv-title"><small>Data e horário</small><button type="button" class="rv-edit" data-go="2">Alterar</button></div>
      <div class="rv-grid"><div><span>Data</span><b>${esc(shortDate(state.date))}</b></div><div><span>Horário</span><b>${esc(state.time)}</b></div><div><span>Duração</span><b>${minutesLabel(sum.duration)}</b></div></div></div>
    <div class="rv-block"><div class="rv-title"><small>Seus dados</small><button type="button" class="rv-edit" data-go="3">Alterar</button></div>
      <div class="rv-grid"><div><span>Nome</span><b>${esc($('#customer-name').value.trim())}</b></div><div><span>WhatsApp</span><b>${esc($('#customer-phone').value)}</b></div></div></div>
    <div class="rv-total"><span>Total</span><strong>${BRL.format(sum.total)}</strong></div>
    <p class="bk-note">✓ Você confere a mensagem antes de enviar pelo WhatsApp.</p>`;
  $$('.rv-edit', $('#bk-review')).forEach(button => button.addEventListener('click', () => goStep(Number(button.dataset.go))));
}

function updateScrollHint() {
  const body = $('#bk-body'); if (!body) return;
  requestAnimationFrame(() => body.classList.toggle('has-more', body.scrollHeight - body.clientHeight - body.scrollTop > 6));
}

function updateSummary() {
  const services = selectedServices(); const sum = totals();
  $('#summary-services').innerHTML = services.length ? services.map(item => `<div class="summary-service"><span>${esc(item.name)}</span><b>${BRL.format(item.price)}</b></div>`).join('') : '<p>Nenhum serviço selecionado.</p>';
  $('#summary-date').textContent = state.date ? dateFmt(state.date) : '—';
  $('#summary-time').textContent = state.time || '—';
  $('#summary-duration').textContent = sum.duration ? minutesLabel(sum.duration) : '—';
  $('#summary-total').textContent = BRL.format(sum.total);
  $('#bk-mini-total').textContent = BRL.format(sum.total);
  $('#bk-mini-info').textContent = services.length ? `${services.length} ${services.length === 1 ? 'serviço' : 'serviços'} · ${minutesLabel(sum.duration)}` : 'Nenhum serviço';

  $('#bk').dataset.step = state.step;
  $('#bk-progress').style.width = `${state.step * 25}%`;
  $$('.bk-pane').forEach(pane => pane.classList.toggle('active', Number(pane.dataset.pane) === state.step));
  $$('#bk-steps li').forEach(item => {
    const n = Number(item.dataset.go); const done = n !== state.step && n < 4 && canGo(n + 1);
    item.classList.toggle('active', n === state.step); item.classList.toggle('done', done); item.classList.toggle('locked', !canGo(n));
    item.querySelector('i').textContent = done ? '✓' : n;
  });
  const next = $('#bk-next');
  next.innerHTML = state.step === 4 ? 'Confirmar e abrir WhatsApp <span>→</span>' : state.step === 3 ? 'Revisar <span>→</span>' : 'Continuar <span>→</span>';
  next.disabled = !stepValid(state.step) || state.saving;
  $('#bk-back').style.visibility = state.step === 1 ? 'hidden' : 'visible';
  if (state.step === 4) renderReview();
  updateScrollHint();
}

function bookingMessage(appointment) {
  return `Olá! Acabei de realizar um agendamento.\n\nNome: ${appointment.customerName}\nData: ${dateFmt(appointment.date)}\nHorário: ${appointment.time}\nServiços: ${appointment.services.map(item => item.name).join(' + ')}\nValor total: ${BRL.format(appointment.total)}\n\nAguardo a confirmação. Obrigado!`;
}
function reminderMessage(item) {
  return `Olá, ${item.customerName.split(' ')[0]}! Passando para lembrar que você tem um agendamento na Willzinho Barber em ${dateFmt(item.date)} às ${item.time}.\n\nServiços: ${item.services.map(service => service.name).join(' + ')}\nValor: ${BRL.format(item.total)}\n\nTe esperamos!`;
}
function showMessage(phone, message) {
  $('#message-preview').value = message;
  $('#open-whatsapp').onclick = () => window.open(`https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent($('#message-preview').value)}`, '_blank', 'noopener');
  $('#message-dialog').showModal();
}

async function confirmBooking() {
  if (state.saving) return; state.saving = true;
  const button = $('#bk-next'); button.disabled = true; button.textContent = 'Salvando agendamento…';
  try {
    const result = await api('/api/appointments', { method: 'POST', body: JSON.stringify({
      customerName: $('#customer-name').value, phone: $('#customer-phone').value,
      date: state.date, time: state.time, serviceIds: state.selected
    }) });
    state.saving = false; resetBooking();
    showMessage(result.whatsapp, bookingMessage(result.appointment));
    toast('Agendamento salvo com sucesso.');
  } catch (error) {
    state.saving = false; toast(error.message);
    if (/hor[áa]rio/i.test(error.message)) { state.time = ''; state.step = 2; renderDays(); loadSlots(); }
    updateSummary();
  }
}

function resetBooking() {
  state.selected = []; state.date = ''; state.time = ''; state.step = 1; state.weekStart = 0;
  $('#customer-name').value = ''; $('#customer-phone').value = ''; $('#booking-date').value = '';
  renderServices(); $('#time-slots').innerHTML = ''; $('#day-strip').innerHTML = ''; updateSummary(); $('#bk-body').scrollTop = 0;
}

function wirePublic() {
  $('#booking-date').min = todayISO();
  $('#booking-date').addEventListener('change', event => selectDate(event.target.value));
  ['#customer-name', '#customer-phone'].forEach(selector => $(selector).addEventListener('input', updateSummary));
  $('#customer-phone').addEventListener('input', event => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
    event.target.value = digits.length > 6 ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}` : digits;
  });
  $('#customer-name').addEventListener('keydown', event => { if (event.key === 'Enter') $('#customer-phone').focus(); });
  $('#customer-phone').addEventListener('keydown', event => { if (event.key === 'Enter' && stepValid(3)) goStep(4); });
  $('#bk-next').addEventListener('click', () => (state.step < 4 ? goStep(state.step + 1) : confirmBooking()));
  $('#bk-back').addEventListener('click', () => goStep(state.step - 1));
  $('#week-prev').addEventListener('click', () => shiftWeek(-1));
  $('#week-next').addEventListener('click', () => shiftWeek(1));
  $$('#bk-steps li').forEach(item => item.addEventListener('click', () => goStep(Number(item.dataset.go))));
  $('#bk-body').addEventListener('scroll', updateScrollHint, { passive: true });
  window.addEventListener('resize', updateScrollHint);
  $$('[data-scroll]').forEach(button => button.addEventListener('click', () => $('#booking').scrollIntoView({ behavior: 'smooth' })));
  $$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
}

function appointmentsFor(date) { return state.data.appointments.filter(item => item.date === date).sort((a, b) => a.time.localeCompare(b.time)); }
function appointmentCard(item) {
  const actions = item.status === 'pending_confirmation'
    ? '<button class="mini-btn confirm" data-action="confirm">Confirmar</button><button class="mini-btn" data-action="reschedule">Reagendar</button><button class="mini-btn danger" data-action="no_show">Desistência</button>'
    : '<button class="mini-btn" data-action="remind">Lembrar</button><button class="mini-btn" data-action="attended">Compareceu</button><button class="mini-btn" data-action="reschedule">Reagendar</button><button class="mini-btn danger" data-action="no_show">Desistência</button>';
  return `<article class="appointment-card" data-appointment="${item.id}">
    <div class="appointment-head"><strong>${item.time} — ${esc(item.customerName)}</strong><span class="status-pill ${item.status}">${statusLabels[item.status] || item.status}</span></div>
    <p>${esc(item.services.map(service => service.name).join(' + '))} · ${BRL.format(item.total)}</p>
    <div class="appointment-details">
      <dl><div><dt>Telefone</dt><dd>${esc(item.phone)}</dd></div><div><dt>Duração</dt><dd>${minutesLabel(item.duration)}</dd></div><div><dt>Data</dt><dd>${dateFmt(item.date)}</dd></div><div><dt>Criado em</dt><dd>${new Date(item.createdAt).toLocaleDateString('pt-BR')}</dd></div></dl>
      <div class="action-row">${actions}</div>
    </div>
  </article>`;
}
function wireAppointmentCards(root) {
  $$('.appointment-card', root).forEach(card => card.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return card.classList.toggle('open');
    event.stopPropagation(); appointmentAction(card.dataset.appointment, button.dataset.action);
  }));
}

function renderDashboard() {
  const today = todayISO(); const month = today.slice(0, 7);
  const valid = item => !['no_show'].includes(item.status);
  const todayItems = appointmentsFor(today).filter(valid);
  const monthItems = state.data.appointments.filter(item => item.date.startsWith(month) && valid(item));
  const attended = state.data.appointments.filter(item => item.date.startsWith(month) && item.status === 'attended');
  const metrics = [
    ['Estimado hoje', BRL.format(todayItems.reduce((sum, item) => sum + item.total, 0)), `${todayItems.length} agendamentos`, true],
    ['Agenda de hoje', String(todayItems.length).padStart(2, '0'), 'horários reservados'],
    ['Estimado no mês', BRL.format(monthItems.reduce((sum, item) => sum + item.total, 0)), `${monthItems.length} agendamentos`],
    ['Realizado no mês', BRL.format(attended.reduce((sum, item) => sum + item.total, 0)), `${attended.length} atendimentos`]
  ];
  const pending = state.data.appointments.filter(item => item.status === 'pending_confirmation').sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const days = [0, 1, 2].map((offset, index) => {
    const date = addDaysISO(offset); const items = appointmentsFor(date);
    const label = index === 0 ? 'Hoje' : index === 1 ? 'Amanhã' : '3º dia';
    return `<div class="day-column ${index === 0 ? 'today' : ''}"><h4>${label}</h4><small>${shortDate(date)}</small>${items.length ? items.map(appointmentCard).join('') : '<div class="empty-admin">Agenda livre.</div>'}</div>`;
  }).join('');
  $('#admin-dashboard').innerHTML = `<div class="metrics-grid">${metrics.map(item => `<div class="metric-card ${item[3] ? 'accent' : ''}"><small>${item[0]}</small><strong>${item[1]}</strong><span>${item[2]}</span></div>`).join('')}</div>
    <div class="panel-card pending-panel"><div class="panel-header"><div><h3>AGENDAMENTOS AGUARDANDO CONFIRMAÇÃO</h3><p>Reservas feitas pelo site que ainda precisam da sua aprovação</p></div><span class="pending-count">${String(pending.length).padStart(2, '0')}</span></div><div class="pending-list">${pending.length ? pending.map(appointmentCard).join('') : '<div class="empty-admin">Nenhuma confirmação pendente.</div>'}</div></div>
    <div class="panel-card"><div class="panel-header"><h3>PRÓXIMOS ATENDIMENTOS</h3><p>Clique para ver detalhes e ações</p></div><div class="day-columns">${days}</div></div>`;
  wireAppointmentCards($('#admin-dashboard'));
}

function renderAgenda() {
  const items = state.data.appointments.slice().sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  $('#admin-agenda').innerHTML = `<div class="panel-card"><div class="panel-header"><h3>HISTÓRICO DE AGENDAMENTOS</h3><p>${items.length} registros preservados</p></div>${items.length ? items.map(appointmentCard).join('') : '<div class="empty-admin">Nenhum agendamento.</div>'}</div>`;
  wireAppointmentCards($('#admin-agenda'));
}

function renderServiceAdmin() {
  $('#admin-services').innerHTML = `<div class="panel-card"><div class="panel-header"><h3>CATÁLOGO DE SERVIÇOS</h3><p>As alterações refletem no site público</p></div><table class="data-table"><thead><tr><th>Serviço</th><th>Preço (R$)</th><th>Duração (min)</th><th>Visível</th><th></th></tr></thead><tbody>${state.data.services.map(item => `<tr data-service-row="${item.id}"><td><input data-field="name" value="${item.name}"></td><td><input data-field="price" type="number" min="0" step="0.01" value="${item.price ?? ''}" placeholder="A definir"></td><td><input data-field="duration" type="number" min="5" step="5" value="${item.duration ?? ''}" placeholder="A definir"></td><td><button class="toggle ${item.active ? 'on' : ''}" data-field="active" aria-label="Ativar ou desativar"></button></td><td><button class="mini-btn" data-save-service>Salvar</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-field="active"]', $('#admin-services')).forEach(button => button.addEventListener('click', () => button.classList.toggle('on')));
  $$('[data-save-service]', $('#admin-services')).forEach(button => button.addEventListener('click', () => saveService(button.closest('tr'))));
}

function renderHours() {
  const ordered = state.data.hours.slice().sort((a, b) => (a.day || 7) - (b.day || 7));
  $('#admin-hours').innerHTML = `<div class="panel-card"><div class="panel-header"><h3>HORÁRIO DE FUNCIONAMENTO</h3><p>Controle individual por dia</p></div><div class="hours-grid">${ordered.map(item => `<div class="hours-card" data-hours="${item.day}"><h4>${item.label}</h4><button class="toggle ${item.active ? 'on' : ''}" data-hour-toggle aria-label="Ativar dia"></button><input data-hour-open type="time" value="${item.open}"><input data-hour-close type="time" value="${item.close}"></div>`).join('')}</div></div>`;
  $$('[data-hours]', $('#admin-hours')).forEach(card => {
    $('[data-hour-toggle]', card).addEventListener('click', event => { event.currentTarget.classList.toggle('on'); saveHours(card); });
    $$('input', card).forEach(input => input.addEventListener('change', () => saveHours(card)));
  });
}

async function appointmentAction(id, action) {
  const item = state.data.appointments.find(value => value.id === id);
  if (!item) return;
  if (action === 'remind') return showMessage(item.phone, reminderMessage(item));
  if (action === 'reschedule') return openReschedule(item);
  if (action === 'confirm') {
    try {
      const result = await api(`/api/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'scheduled' }) });
      await reloadState(); renderAdmin();
      const confirmed = result.appointment;
      showMessage(confirmed.phone, `Olá, ${confirmed.customerName.split(' ')[0]}! Seu agendamento está confirmado.\n\nData: ${dateFmt(confirmed.date)}\nHorário: ${confirmed.time}\nServiços: ${confirmed.services.map(service => service.name).join(' + ')}\nValor: ${BRL.format(confirmed.total)}\nDuração estimada: ${minutesLabel(confirmed.duration)}\n\nTe esperamos!`);
      toast('Agendamento confirmado.');
    } catch (error) { toast(error.message); }
    return;
  }
  const nextStatus = action === 'attended' ? 'attended' : 'no_show';
  try {
    const result = await api(`/api/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
    await reloadState(); renderAdmin();
    const first = item.customerName.split(' ')[0];
    const message = nextStatus === 'attended'
      ? `Olá, ${first}! Obrigado pela preferência e por comparecer ao seu horário. Foi um prazer atender você!`
      : `Olá, ${first}! Seu agendamento foi marcado como desistência.\n\nCaso queira realizar um novo agendamento, estaremos à disposição.`;
    showMessage(result.appointment.phone, message); toast('Status atualizado.');
  } catch (error) { toast(error.message); }
}

async function openReschedule(item) {
  state.rescheduleId = item.id; state.rescheduleTime = '';
  const input = $('#reschedule-date'); input.min = todayISO(); input.value = item.date;
  $('#save-reschedule').disabled = true; $('#reschedule-dialog').showModal();
  await loadRescheduleSlots();
}
async function loadRescheduleSlots() {
  const item = state.data.appointments.find(value => value.id === state.rescheduleId);
  const date = $('#reschedule-date').value; const box = $('#reschedule-slots');
  box.innerHTML = '<p class="empty-note">Consultando…</p>';
  try {
    const result = await api(`/api/availability?date=${date}&services=${item.serviceIds.join(',')}&ignoreId=${item.id}`);
    box.innerHTML = result.slots.map(time => `<button class="time-slot" data-new-time="${time}">${time}</button>`).join('') || '<p class="empty-note">Nenhum horário livre.</p>';
    $$('[data-new-time]', box).forEach(button => button.addEventListener('click', () => {
      state.rescheduleTime = button.dataset.newTime; $$('.time-slot', box).forEach(slot => slot.classList.toggle('selected', slot === button)); $('#save-reschedule').disabled = false;
    }));
  } catch (error) { box.innerHTML = `<p class="empty-note">${error.message}</p>`; }
}
async function saveReschedule() {
  const item = state.data.appointments.find(value => value.id === state.rescheduleId);
  try {
    const result = await api(`/api/appointments/${item.id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ date: $('#reschedule-date').value, time: state.rescheduleTime }) });
    $('#reschedule-dialog').close(); await reloadState(); renderAdmin();
    const updated = result.appointment;
    showMessage(updated.phone, `Olá, ${updated.customerName.split(' ')[0]}! Seu agendamento foi reagendado.\n\nNova data: ${dateFmt(updated.date)}\nNovo horário: ${updated.time}\nServiços: ${updated.services.map(service => service.name).join(' + ')}\nValor: ${BRL.format(updated.total)}\n\nAté lá!`);
    toast('Agendamento reagendado.');
  } catch (error) { toast(error.message); }
}

async function saveService(row) {
  const payload = {
    name: $('[data-field="name"]', row).value,
    price: $('[data-field="price"]', row).value,
    duration: $('[data-field="duration"]', row).value,
    active: $('[data-field="active"]', row).classList.contains('on')
  };
  try { await api(`/api/services/${row.dataset.serviceRow}`, { method: 'PUT', body: JSON.stringify(payload) }); await reloadState(); renderServiceAdmin(); toast('Serviço atualizado.'); }
  catch (error) { toast(error.message); }
}
async function saveHours(card) {
  const payload = { active: $('[data-hour-toggle]', card).classList.contains('on'), open: $('[data-hour-open]', card).value, close: $('[data-hour-close]', card).value };
  try { await api(`/api/hours/${card.dataset.hours}`, { method: 'PUT', body: JSON.stringify(payload) }); await reloadState(); toast('Horário atualizado.'); }
  catch (error) { toast(error.message); renderHours(); }
}


/* ---------- Clientes ---------- */
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const phoneKey = phone => { const d = String(phone || '').replace(/\D/g, ''); return d.length > 11 && d.startsWith('55') ? d.slice(2) : d; };
const phoneFmt = phone => {
  const d = phoneKey(phone);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || '—';
};
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const stamp = item => `${item.date}${item.time}`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

function buildClients() {
  const map = new Map();
  state.data.appointments.slice().sort((a, b) => stamp(a).localeCompare(stamp(b))).forEach(item => {
    const key = phoneKey(item.phone) || item.customerName;
    const client = map.get(key) || { key, appts: [] };
    client.name = item.customerName; client.phone = item.phone; client.appts.push(item);
    map.set(key, client);
  });
  return [...map.values()].map(client => {
    const attended = client.appts.filter(item => item.status === 'attended');
    return { ...client, attended, spent: attended.reduce((sum, item) => sum + item.total, 0), last: client.appts[client.appts.length - 1] };
  }).sort((a, b) => stamp(b.last).localeCompare(stamp(a.last)));
}

function serviceStats(client) {
  const today = todayISO(); const map = new Map();
  client.appts.filter(item => item.status !== 'no_show').forEach(item => item.services.forEach(service => {
    const row = map.get(service.id) || { name: service.name, count: 0, done: 0, revenue: 0, last: '' };
    row.count += 1;
    if (item.status === 'attended') { row.done += 1; row.revenue += service.price; }
    if ((item.status === 'attended' || item.date <= today) && item.date > row.last) row.last = item.date;
    map.set(service.id, row);
  }));
  return [...map.values()].sort((a, b) => b.count - a.count || b.revenue - a.revenue);
}

function renderClients() {
  const root = $('#admin-clients');
  const clients = buildClients();
  const current = state.clientKey && clients.find(client => client.key === state.clientKey);
  if (current) return renderClientDetail(root, current);
  state.clientKey = null;
  root.innerHTML = `<div class="panel-card"><div class="panel-header"><div><h3>LISTA DE CLIENTES</h3><p>${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'} · clique em um cliente para ver o histórico completo</p></div></div>
    <div class="client-toolbar"><input id="client-search" type="search" placeholder="Buscar por nome ou telefone" value="${esc(state.clientQuery)}" autocomplete="off"></div>
    <div id="client-rows" class="client-list"></div></div>`;
  const draw = () => {
    const query = state.clientQuery.trim().toLowerCase(); const digits = query.replace(/\D/g, '');
    const list = clients.filter(client => !query || client.name.toLowerCase().includes(query) || (digits && phoneKey(client.phone).includes(digits)));
    $('#client-rows').innerHTML = list.length ? list.map(client => `<button class="client-row" data-client="${esc(client.key)}">
      <span class="client-avatar">${esc(initials(client.name))}</span>
      <span class="client-main"><b>${esc(client.name)}</b><small>${esc(phoneFmt(client.phone))}</small></span>
      <span class="client-col"><small>Último agendamento</small><b>${dateFmt(client.last.date)} · ${client.last.time}</b></span>
      <span class="client-col hide-sm"><small>Atendimentos</small><b>${client.attended.length}<em>/${client.appts.length}</em></b></span>
      <span class="client-col hide-sm"><small>Total gasto</small><b>${BRL.format(client.spent)}</b></span>
      <span class="client-arrow">→</span>
    </button>`).join('') : `<div class="empty-admin">${clients.length ? 'Nenhum cliente encontrado.' : 'Ainda não há clientes. Eles aparecem aqui após o primeiro agendamento.'}</div>`;
    $$('[data-client]', $('#client-rows')).forEach(button => button.addEventListener('click', () => openClient(button.dataset.client)));
  };
  $('#client-search').addEventListener('input', event => { state.clientQuery = event.target.value; draw(); });
  draw();
}

function renderClientDetail(root, client) {
  const today = todayISO();
  const active = client.appts.filter(item => item.status !== 'no_show');
  const noShows = client.appts.length - active.length;
  const upcoming = active.filter(item => item.date >= today && item.status !== 'attended').sort((a, b) => stamp(a).localeCompare(stamp(b)))[0];
  const lastAttended = client.attended[client.attended.length - 1];
  const gaps = client.attended.slice(1).map((item, index) => daysBetween(client.attended[index].date, item.date));
  const avgGap = gaps.length ? Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length) : null;
  const services = serviceStats(client);
  const maxCount = Math.max(1, ...services.map(row => row.count));
  const digits = String(client.phone).replace(/\D/g, ''); const wa = digits.length <= 11 ? `55${digits}` : digits;
  const metrics = [
    ['Total gasto', BRL.format(client.spent), `${client.attended.length} ${client.attended.length === 1 ? 'atendimento realizado' : 'atendimentos realizados'}`, true],
    ['Ticket médio', client.attended.length ? BRL.format(client.spent / client.attended.length) : '—', 'por atendimento'],
    ['Agendamentos', String(client.appts.length), noShows ? `${noShows} ${noShows === 1 ? 'desistência' : 'desistências'}` : 'nenhuma desistência'],
    ['Serviço favorito', services[0] ? esc(services[0].name) : '—', services[0] ? `${services[0].count}× agendado` : 'sem histórico'],
    ['Cliente desde', dateFmt(client.appts[0].date), `${client.appts.length} ${client.appts.length === 1 ? 'registro' : 'registros'}`],
    ['Última visita', lastAttended ? dateFmt(lastAttended.date) : '—', lastAttended ? `${daysBetween(lastAttended.date, today)} dias atrás` : 'ainda não compareceu'],
    ['Próximo agendamento', upcoming ? dateFmt(upcoming.date) : '—', upcoming ? `às ${upcoming.time}` : 'nada marcado'],
    ['Intervalo médio', avgGap === null ? '—' : `${avgGap} dias`, avgGap === null ? 'precisa de 2+ visitas' : 'entre atendimentos']
  ];
  const history = client.appts.slice().sort((a, b) => stamp(b).localeCompare(stamp(a)));
  root.innerHTML = `<div class="panel-card client-head">
      <button class="mini-btn" data-client-back>← Clientes</button>
      <div class="client-avatar big">${esc(initials(client.name))}</div>
      <div class="client-title"><h3>${esc(client.name)}</h3><p>${esc(phoneFmt(client.phone))}</p></div>
      <a class="mini-btn confirm" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp ↗</a>
    </div>
    <div class="metrics-grid client-metrics">${metrics.map(item => `<div class="metric-card ${item[3] ? 'accent' : ''}"><small>${item[0]}</small><strong>${item[1]}</strong><span>${item[2]}</span></div>`).join('')}</div>
    <div class="panel-card"><div class="panel-header"><div><h3>ESTATÍSTICAS DOS SERVIÇOS</h3><p>Desistências não entram na contagem · receita considera só atendimentos realizados</p></div></div>
      ${services.length ? `<table class="data-table"><thead><tr><th>Serviço</th><th>Agendado</th><th>Realizado</th><th>Receita</th><th>Última vez</th><th>Participação</th></tr></thead><tbody>${services.map(row => `<tr><td><b>${esc(row.name)}</b></td><td>${row.count}×</td><td>${row.done}×</td><td>${BRL.format(row.revenue)}</td><td>${row.last ? dateFmt(row.last) : '—'}</td><td><div class="share-bar"><i style="width:${Math.round(row.count / maxCount * 100)}%"></i></div></td></tr>`).join('')}</tbody></table>` : '<div class="empty-admin">Sem serviços registrados.</div>'}
    </div>
    <div class="panel-card"><div class="panel-header"><div><h3>AGENDAMENTOS DO CLIENTE</h3><p>${history.length} ${history.length === 1 ? 'registro' : 'registros'} · clique para ver detalhes e ações</p></div></div>${history.map(appointmentCard).join('')}</div>`;
  $('[data-client-back]', root).addEventListener('click', closeClient);
  wireAppointmentCards(root);
}

function openClient(key) {
  state.clientKey = key; history.pushState(null, '', `#clientes/${encodeURIComponent(key)}`);
  renderClients(); window.scrollTo({ top: 0 });
}
function closeClient() {
  state.clientKey = null; history.pushState(null, '', '#clientes');
  renderClients(); window.scrollTo({ top: 0 });
}
function navigateAdmin(tab) {
  if (tab === 'clients') {
    state.clientKey = null; setAdminTab('clients'); renderClients();
    if (location.hash !== '#clientes') history.pushState(null, '', '#clientes');
    return;
  }
  if (location.hash.startsWith('#clientes')) history.replaceState(null, '', location.pathname + location.search);
  setAdminTab(tab);
}
function syncClientHash() {
  const match = location.hash.match(/^#clientes(?:\/(.+))?$/);
  if (!match) return;
  state.clientKey = match[1] ? decodeURIComponent(match[1]) : null;
  setAdminTab('clients'); renderClients();
}


/* ---------- Informações públicas (horários, aberto agora, menu) ---------- */
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
function hoursGroups() {
  const order = [1, 2, 3, 4, 5, 6, 0]; const groups = [];
  order.forEach(day => {
    const item = state.data.hours.find(hour => hour.day === day); if (!item) return;
    const value = item.active ? `${item.open} — ${item.close}` : null; const last = groups[groups.length - 1];
    if (last && last.value === value) last.days.push(day); else groups.push({ days: [day], value });
  });
  return groups;
}
function renderPublicHours() {
  const list = $('#footer-hours'); if (!list) return;
  list.innerHTML = hoursGroups().map(group => {
    const first = DAY_SHORT[group.days[0]], last = DAY_SHORT[group.days[group.days.length - 1]];
    const label = group.days.length > 1 ? `${first} — ${last}` : first;
    return `<li class="${group.value ? '' : 'off'}"><span>${label}</span><b>${group.value || 'Fechado'}</b></li>`;
  }).join('');
}
function renderOpenStatus() {
  const label = $('#open-status'), dot = $('#open-dot'); if (!label) return;
  const now = new Date(); const minutes = now.getHours() * 60 + now.getMinutes();
  const item = state.data.hours.find(hour => hour.day === now.getDay());
  const toMin = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  let text = 'Fechado hoje', kind = 'closed';
  if (item && item.active) {
    if (minutes >= toMin(item.open) && minutes < toMin(item.close)) { text = `Aberto agora · fecha às ${item.close}`; kind = 'open'; }
    else if (minutes < toMin(item.open)) { text = `Abre hoje às ${item.open}`; kind = 'closed'; }
    else { text = 'Fechado agora'; kind = 'closed'; }
  }
  label.textContent = text; dot.className = `dot ${kind}`;
}
function wireNavHighlight() {
  const links = $$('.site-header .nav-link'); const sections = ['trabalho', 'booking', 'avaliacoes', 'contato'].map(id => document.getElementById(id));
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
  }), { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(section => section && observer.observe(section));
  const top = document.getElementById('inicio');
  if (top) new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) links.forEach(link => link.classList.remove('active')); }), { rootMargin: '-45% 0px -50% 0px' }).observe(top);
}
function renderPublicInfo() {
  renderPublicHours(); renderOpenStatus(); wireNavHighlight();
  const year = $('#year'); if (year) year.textContent = new Date().getFullYear();
}

/* ---------- Sistema: zerar dados ---------- */
function renderSystem() {
  const appointments = state.data.appointments.length; const clients = buildClients().length;
  $('#admin-system').innerHTML = `<div class="panel-card danger-zone">
    <div class="panel-header"><div><h3>ZERAR DADOS</h3><p>Apaga todos os agendamentos e clientes e deixa o sistema como novo. Serviços, preços e horários de funcionamento são mantidos.</p></div></div>
    <div class="reset-stats"><div><strong>${appointments}</strong><span>${appointments === 1 ? 'agendamento' : 'agendamentos'}</span></div><div><strong>${clients}</strong><span>${clients === 1 ? 'cliente' : 'clientes'}</span></div></div>
    <button class="mini-btn danger" id="reset-open" ${appointments || clients ? '' : 'disabled'}>${appointments || clients ? 'Zerar dados…' : 'Sistema já está zerado'}</button>
  </div>`;
  const open = $('#reset-open'); if (!open) return;
  open.addEventListener('click', () => {
    $('#reset-warn').textContent = `Serão apagados ${appointments} ${appointments === 1 ? 'agendamento' : 'agendamentos'} e ${clients} ${clients === 1 ? 'cliente' : 'clientes'}. Esta ação não pode ser desfeita.`;
    $('#reset-confirm').value = ''; $('#reset-run').disabled = true; $('#reset-dialog').showModal(); $('#reset-confirm').focus();
  });
}
async function runReset() {
  const button = $('#reset-run'); button.disabled = true; button.textContent = 'Apagando…';
  try {
    await api('/api/reset', { method: 'POST', body: JSON.stringify({ confirm: $('#reset-confirm').value.trim().toUpperCase() }) });
    $('#reset-dialog').close(); await reloadState(); renderAdmin(); toast('Sistema zerado.');
  } catch (error) { toast(error.message); }
  finally { button.textContent = 'Apagar agendamentos e clientes'; button.disabled = $('#reset-confirm').value.trim().toUpperCase() !== 'ZERAR'; }
}

function renderAdmin() {
  renderDashboard(); renderAgenda(); renderClients(); renderServiceAdmin(); renderHours(); renderSystem();
}
function setAdminTab(tab) {
  const titles = { dashboard: 'VISÃO GERAL', agenda: 'AGENDAMENTOS', clients: 'CLIENTES', services: 'SERVIÇOS', hours: 'HORÁRIOS', system: 'SISTEMA' };
  $$('.admin-nav').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tab));
  $$('.admin-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `admin-${tab}`));
  $('#admin-title').textContent = titles[tab];
}
async function reloadState() { state.data = await api('/api/state' + (document.body.classList.contains('admin-page') ? '?appointments=1' : '')); }
async function init() {
  try {
    await reloadState();
    const adminMode = document.body.classList.contains('admin-page');
    if (adminMode) {
      if (Store.mode === 'local') setTimeout(() => toast('Modo local: dados salvos só neste navegador (Firestore indisponível).'), 600);
      renderAdmin();
      $$('.admin-nav').forEach(button => button.addEventListener('click', () => navigateAdmin(button.dataset.adminTab)));
      $('#reschedule-date').addEventListener('change', () => { state.rescheduleTime = ''; $('#save-reschedule').disabled = true; loadRescheduleSlots(); });
      $('#save-reschedule').addEventListener('click', saveReschedule);
      $$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
      $('#reset-confirm').addEventListener('input', event => { $('#reset-run').disabled = event.target.value.trim().toUpperCase() !== 'ZERAR'; });
      $('#reset-run').addEventListener('click', runReset);
      window.addEventListener('hashchange', syncClientHash); syncClientHash();
    } else {
      renderServices(); updateSummary(); wirePublic(); renderPublicInfo();
    }
  } catch (error) { document.body.innerHTML = `<main style="padding:40px"><h1>Não foi possível iniciar</h1><p>${error.message}</p></main>`; }
}
init();
