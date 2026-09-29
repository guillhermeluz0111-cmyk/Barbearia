const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, selected: [], date: '', time: '', rescheduleId: null, rescheduleTime: '' };
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
    return `<button class="service-card ${state.selected.includes(item.id) ? 'selected' : ''} ${ready ? '' : 'unavailable'}" data-service="${item.id}" ${ready ? '' : 'disabled'}>
      <div><h4>${item.name}</h4><p>${item.description || ''}</p>${ready ? `<small>${minutesLabel(item.duration)}</small>` : '<small>Em breve</small>'}</div>
      <div><div class="service-check">✓</div>${ready ? `<strong>${BRL.format(item.price)}</strong>` : ''}</div>
      ${item.featured ? '<span class="featured-tag">MAIS ESCOLHIDO</span>' : ''}
    </button>`;
  }).join('');
  $$('[data-service]').forEach(button => button.addEventListener('click', () => toggleService(button.dataset.service)));
}

function toggleService(id) {
  if (id === 'combo') state.selected = state.selected.includes(id) ? [] : [...state.selected.filter(value => !['corte', 'barba', 'sobrancelha'].includes(value)), id];
  else {
    state.selected = state.selected.filter(value => value !== 'combo');
    state.selected = state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id];
  }
  state.time = '';
  renderServices(); updateSummary();
  $('#step-date').classList.toggle('locked', !state.selected.length);
  $('#step-client').classList.add('locked');
  if (state.date && state.selected.length) loadSlots();
}

function updateSummary() {
  const services = selectedServices(); const sum = totals();
  $('#summary-services').innerHTML = services.length ? services.map(item => `<div class="summary-service"><span>${item.name}</span><b>${BRL.format(item.price)}</b></div>`).join('') : '<p>Nenhum serviço selecionado.</p>';
  $('#summary-date').textContent = dateFmt(state.date);
  $('#summary-time').textContent = state.time || '—';
  $('#summary-duration').textContent = sum.duration ? minutesLabel(sum.duration) : '—';
  $('#summary-total').textContent = BRL.format(sum.total);
  const ready = services.length && state.date && state.time && $('#customer-name').value.trim().length >= 2 && $('#customer-phone').value.replace(/\D/g, '').length >= 10;
  $('#confirm-booking').disabled = !ready;
}

async function loadSlots() {
  const box = $('#time-slots'); box.innerHTML = '<p class="empty-note">Consultando a agenda…</p>';
  try {
    const result = await api(`/api/availability?date=${state.date}&services=${state.selected.join(',')}`);
    box.innerHTML = result.slots.length ? result.slots.map(time => `<button class="time-slot ${state.time === time ? 'selected' : ''}" data-time="${time}">${time}</button>`).join('') : '<p class="empty-note">Nenhum horário disponível para esta combinação.</p>';
    $$('[data-time]', box).forEach(button => button.addEventListener('click', () => {
      state.time = button.dataset.time; $$('.time-slot', box).forEach(item => item.classList.toggle('selected', item === button));
      $('#step-client').classList.remove('locked'); updateSummary();
    }));
  } catch (error) { box.innerHTML = `<p class="empty-note">${error.message}</p>`; }
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
  const button = $('#confirm-booking'); button.disabled = true; button.textContent = 'Salvando agendamento…';
  try {
    const result = await api('/api/appointments', { method: 'POST', body: JSON.stringify({
      customerName: $('#customer-name').value, phone: $('#customer-phone').value,
      date: state.date, time: state.time, serviceIds: state.selected
    }) });
    await reloadState();
    showMessage(result.whatsapp, bookingMessage(result.appointment));
    toast('Agendamento salvo com sucesso.');
    state.selected = []; state.time = ''; renderServices(); updateSummary();
  } catch (error) { toast(error.message); if (state.date) loadSlots(); }
  finally { button.innerHTML = 'Confirmar e abrir WhatsApp <span>→</span>'; updateSummary(); }
}

function wirePublic() {
  const input = $('#booking-date'); input.min = todayISO(); input.value = state.date;
  input.addEventListener('change', event => { state.date = event.target.value; state.time = ''; updateSummary(); loadSlots(); });
  ['#customer-name', '#customer-phone'].forEach(selector => $(selector).addEventListener('input', updateSummary));
  $('#customer-phone').addEventListener('input', event => {
    let digits = event.target.value.replace(/\D/g, '').slice(0, 11);
    event.target.value = digits.length > 6 ? `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}` : digits;
  });
  $('#confirm-booking').addEventListener('click', confirmBooking);
  $$('[data-scroll]').forEach(button => button.addEventListener('click', () => $('#booking').scrollIntoView({ behavior: 'smooth' })));
  $$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
}

function appointmentsFor(date) { return state.data.appointments.filter(item => item.date === date).sort((a, b) => a.time.localeCompare(b.time)); }
function appointmentCard(item) {
  const actions = item.status === 'pending_confirmation'
    ? '<button class="mini-btn confirm" data-action="confirm">Confirmar</button><button class="mini-btn" data-action="reschedule">Reagendar</button><button class="mini-btn danger" data-action="no_show">Desistência</button>'
    : '<button class="mini-btn" data-action="remind">Lembrar</button><button class="mini-btn" data-action="attended">Compareceu</button><button class="mini-btn" data-action="reschedule">Reagendar</button><button class="mini-btn danger" data-action="no_show">Desistência</button>';
  return `<article class="appointment-card" data-appointment="${item.id}">
    <div class="appointment-head"><strong>${item.time} — ${item.customerName}</strong><span class="status-pill ${item.status}">${statusLabels[item.status] || item.status}</span></div>
    <p>${item.services.map(service => service.name).join(' + ')} · ${BRL.format(item.total)}</p>
    <div class="appointment-details">
      <dl><div><dt>Telefone</dt><dd>${item.phone}</dd></div><div><dt>Duração</dt><dd>${minutesLabel(item.duration)}</dd></div><div><dt>Data</dt><dd>${dateFmt(item.date)}</dd></div><div><dt>Criado em</dt><dd>${new Date(item.createdAt).toLocaleDateString('pt-BR')}</dd></div></dl>
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

function renderAdmin() {
  renderDashboard(); renderAgenda(); renderServiceAdmin(); renderHours();
}
function setAdminTab(tab) {
  const titles = { dashboard: 'VISÃO GERAL', agenda: 'AGENDAMENTOS', services: 'SERVIÇOS', hours: 'HORÁRIOS' };
  $$('.admin-nav').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tab));
  $$('.admin-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `admin-${tab}`));
  $('#admin-title').textContent = titles[tab];
}
async function reloadState() { state.data = await api('/api/state'); }
async function init() {
  try {
    await reloadState();
    if (Store.mode === 'local') setTimeout(() => toast('Modo local: dados salvos só neste navegador (Firestore indisponível).'), 600);
    const adminMode = document.body.classList.contains('admin-page');
    if (adminMode) {
      renderAdmin();
      $$('.admin-nav').forEach(button => button.addEventListener('click', () => setAdminTab(button.dataset.adminTab)));
      $('#reschedule-date').addEventListener('change', () => { state.rescheduleTime = ''; $('#save-reschedule').disabled = true; loadRescheduleSlots(); });
      $('#save-reschedule').addEventListener('click', saveReschedule);
      $$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    } else {
      state.date = todayISO(); renderServices(); updateSummary(); wirePublic();
    }
  } catch (error) { document.body.innerHTML = `<main style="padding:40px"><h1>Não foi possível iniciar</h1><p>${error.message}</p></main>`; }
}
init();
