/* ---------- Endereço / mapas ---------- */
const SHOP = {
  name: 'Willzinho Barber',
  lines: ['R. Paschoa Lazarotto Toniolo, 9', 'Rio Verde, Colombo — PR', 'CEP 83405-000'],
  query: 'Willzinho Barber, R. Paschoa Lazarotto Toniolo, 9, Rio Verde, Colombo - PR, 83405-000',
  google: ''
};
SHOP.google = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(SHOP.query);
SHOP.embed = 'https://maps.google.com/maps?q=' + encodeURIComponent(SHOP.query) + '&z=16&output=embed';
const mapUrl = () => SHOP.google;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, selected: [], date: '', time: '', rescheduleId: null, rescheduleTime: '', clientKey: null, clientQuery: '', products: [], clientMode: '', foundName: '', autoName: '', lookingUp: false, step: 1, saving: false, weekStart: 0 };
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
function selectedProducts() {
  return (state.data.products || []).filter(item => state.products.includes(item.id));
}
function totals() {
  const base = selectedServices().reduce((acc, item) => ({ total: acc.total + item.price, duration: acc.duration + item.duration }), { total: 0, duration: 0 });
  base.total += selectedProducts().reduce((sum, item) => sum + item.price, 0);
  return base;
}
const prodLine = item => (item.products && item.products.length) ? `\nProdutos: ${item.products.map(p => p.name).join(' + ')}` : '';

function renderServices() {
  if (!state.data.services.length) { $('#service-grid').innerHTML = '<p class="empty-note">Nenhum serviço disponível no momento. Volte em breve.</p>'; return; }
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

function renderProducts() {
  const list = (state.data.products || []).filter(item => item.active && item.price !== null && item.price !== undefined);
  $('#product-grid').innerHTML = list.length ? list.map(item => `<button type="button" class="service-card ${state.products.includes(item.id) ? 'selected' : ''}" data-product="${esc(item.id)}">
      <div><h4>${esc(item.name)}</h4><p>${esc(item.description || '')}</p></div>
      <div><div class="service-check">✓</div><strong>${BRL.format(item.price)}</strong></div>
    </button>`).join('') : '<p class="empty-note">Nenhum produto disponível no momento. Pode continuar.</p>';
  $$('[data-product]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.product;
    state.products = state.products.includes(id) ? state.products.filter(value => value !== id) : [...state.products, id];
    renderProducts(); updateSummary();
  }));
  updateScrollHint();
}

function toggleService(id) {
  state.selected = state.selected.includes(id) ? state.selected.filter(value => value !== id) : [...state.selected, id];
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
  : n === 3 ? true
  : n === 4 ? (state.clientMode === 'existing' ? phoneDigits().length >= 10 && Boolean(state.foundName) && !state.lookingUp
    : state.clientMode === 'new' ? phoneDigits().length >= 10 && $('#customer-name').value.trim().length >= 2 && !state.lookingUp : false)
  : true;
const canGo = n => { for (let i = 1; i < n; i++) if (!stepValid(i)) return false; return true; };

function goStep(n) {
  if (n < 1 || n > 5 || !canGo(n)) return;
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
  const services = selectedServices(); const products = selectedProducts(); const sum = totals();
  $('#bk-review').innerHTML = `
    <div class="rv-block"><div class="rv-title"><small>Serviços</small><button type="button" class="rv-edit" data-go="1">Alterar</button></div>
      ${services.map(reviewServiceLine).join('')}</div>
    <div class="rv-block"><div class="rv-title"><small>Data e horário</small><button type="button" class="rv-edit" data-go="2">Alterar</button></div>
      <div class="rv-grid"><div><span>Data</span><b>${esc(shortDate(state.date))}</b></div><div><span>Horário</span><b>${esc(state.time)}</b></div><div><span>Duração</span><b>${minutesLabel(sum.duration)}</b></div></div></div>
    ${products.length ? `<div class="rv-block"><div class="rv-title"><small>Complementos</small><button type="button" class="rv-edit" data-go="3">Alterar</button></div>
      ${products.map(item => `<div class="rv-line"><span>${esc(item.name)}</span><b>${BRL.format(item.price)}</b></div>`).join('')}</div>` : ''}
    <div class="rv-block"><div class="rv-title"><small>Seus dados</small><button type="button" class="rv-edit" data-go="4">Alterar</button></div>
      <div class="rv-grid"><div><span>Nome</span><b>${esc($('#customer-name').value.trim())}</b></div><div><span>WhatsApp</span><b>${esc($('#customer-phone').value)}</b></div><div><span>Cadastro</span><b>${state.clientMode === 'new' ? 'Novo cliente' : 'Cliente cadastrado'}</b></div></div></div>
    ${reviewPlanBlock()}
    <div class="rv-total"><span>Total</span><strong>${BRL.format(shownTotal(sum))}</strong></div>
    <p class="bk-note">✓ Você confere a mensagem antes de enviar pelo WhatsApp.</p>`;
  $$('.rv-edit', $('#bk-review')).forEach(button => button.addEventListener('click', () => goStep(Number(button.dataset.go))));
  const who = $('#rv-beneficiary'); if (who) who.addEventListener('change', () => { state.beneficiary = who.value; renderReview(); });
  loadQuote();
}

/* ---------- Assinante: confere o cadastro e os cortes do plano antes de confirmar ---------- */
const quoteKey = () => [phoneDigits(), state.date, state.selected.join(','), state.products.join(','), state.beneficiary || ''].join('|');
const quoteOk = () => Boolean(state.quote && state.quote.subscriber && state.quoteKey === quoteKey());
const shownTotal = sum => (state.step >= 5 && quoteOk()) ? state.quote.total : sum.total;
async function loadQuote() {
  if (state.quotePhone !== phoneDigits()) { state.quotePhone = phoneDigits(); state.beneficiary = ''; }
  const key = quoteKey(); if (state.quoteKey === key) return;
  state.quoteKey = key; state.quote = null; state.quoteLoading = true; updateSummary();
  try {
    const q = await api('/api/plan-quote?' + new URLSearchParams({ phone: phoneDigits(), date: state.date, services: state.selected.join(','), products: state.products.join(','), beneficiary: state.beneficiary || '' }));
    if (state.quoteKey !== key) return; state.quote = q;
  } catch (error) { if (state.quoteKey !== key) return; state.quote = null; }
  state.quoteLoading = false; if (state.step === 5) { renderReview(); updateSummary(); }
}
function reviewServiceLine(item) {
  const line = quoteOk() ? state.quote.lines.find(l => l.id === item.id) : null;
  if (!line || !line.eligible) return `<div class="rv-line"><span>${esc(item.name)}</span><b>${BRL.format(item.price)}</b></div>`;
  return `<div class="rv-line"><span>${esc(item.name)}</span><b>${line.covered ? `<s>${BRL.format(item.price)}</s> Incluso no plano` : `${line.charge === item.price ? '' : `<s>${BRL.format(item.price)}</s> `}${BRL.format(line.charge)} <small>(adicional)</small>`}</b></div>`;
}
function reviewPlanBlock() {
  if (state.quoteLoading) return '<div class="rv-block rv-plan"><p class="rv-plan-msg">Conferindo seu cadastro…</p></div>';
  if (!quoteOk()) return '';
  const q = state.quote; const month = state.date ? new Date(state.date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long' }) : 'mês';
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  let message, tone = 'ok';
  if (!q.eligible) message = 'Nenhum serviço deste agendamento usa corte do plano. Os valores são os normais.';
  else if (!q.extra) message = `✓ ${n(q.covered, 'corte incluso', 'cortes inclusos')} no plano, valor zerado. Depois deste agendamento, ${q.remainingAfter === 1 ? 'resta 1 corte' : `restam ${q.remainingAfter} cortes`} em ${month}.`;
  else if (!q.covered) { tone = 'warn'; message = `${q.limit === 1 ? 'Seu corte' : `Seus ${q.limit} cortes`} de ${month} ${q.limit === 1 ? 'já foi usado' : 'já foram usados'}. Será cobrado corte adicional: ${BRL.format(q.extraCharge)}.`; }
  else { tone = 'warn'; message = `${n(q.covered, 'corte incluso', 'cortes inclusos')} no plano e ${n(q.extra, 'adicional', 'adicionais')}: ${BRL.format(q.extraCharge)} a pagar.`; }
  return `<div class="rv-block rv-plan"><div class="rv-title"><small>Plano mensal · ${esc(q.planName)}</small></div>
    ${q.dependents.length ? `<label class="rv-who">Quem vai cortar?<select id="rv-beneficiary"><option value="">Titular</option>${q.dependents.map(d => `<option value="${esc(d.id)}" ${state.beneficiary === d.id ? 'selected' : ''}>${esc(d.name)} (dependente)</option>`).join('')}</select></label>` : ''}
    <div class="rv-grid"><div><span>Usados no mês</span><b>${Math.min(q.usedBefore, q.limit)} de ${q.limit}</b></div><div><span>Disponíveis</span><b>${q.available}</b></div><div><span>Após este</span><b>${q.remainingAfter}</b></div></div>
    <p class="rv-plan-msg ${tone}">${message}</p></div>`;
}

function updateScrollHint() {
  const body = $('#bk-body'); if (!body) return;
  requestAnimationFrame(() => body.classList.toggle('has-more', body.scrollHeight - body.clientHeight - body.scrollTop > 6));
}

function updateSummary() {
  const services = selectedServices(); const sum = totals();
  $('#summary-services').innerHTML = services.length ? services.map(item => `<div class="summary-service"><span>${esc(item.name)}</span><b>${BRL.format(item.price)}</b></div>`).join('') : '<p>Nenhum serviço selecionado.</p>';
  const prods = selectedProducts(); const box = $('#summary-products');
  box.hidden = !prods.length;
  box.innerHTML = prods.map(item => `<div class="summary-service"><span>${esc(item.name)}</span><b>${BRL.format(item.price)}</b></div>`).join('');
  $('#summary-date').textContent = state.date ? dateFmt(state.date) : '—';
  $('#summary-time').textContent = state.time || '—';
  $('#summary-duration').textContent = sum.duration ? minutesLabel(sum.duration) : '—';
  $('#summary-total').textContent = BRL.format(shownTotal(sum));
  $('#bk-mini-total').textContent = BRL.format(shownTotal(sum));
  $('#bk-mini-info').textContent = services.length ? `${services.length} ${services.length === 1 ? 'serviço' : 'serviços'}${prods.length ? ` · ${prods.length} ${prods.length === 1 ? 'produto' : 'produtos'}` : ''} · ${minutesLabel(sum.duration)}` : 'Nenhum serviço';

  $('#bk').dataset.step = state.step;
  $('#bk-progress').style.width = `${state.step * 20}%`;
  $$('.bk-pane').forEach(pane => pane.classList.toggle('active', Number(pane.dataset.pane) === state.step));
  $$('#bk-steps li').forEach(item => {
    const n = Number(item.dataset.go); const done = n !== state.step && n < 5 && canGo(n + 1);
    item.classList.toggle('active', n === state.step); item.classList.toggle('done', done); item.classList.toggle('locked', !canGo(n));
    item.querySelector('i').textContent = done ? '✓' : n;
  });
  const next = $('#bk-next');
  next.innerHTML = state.step === 5 ? 'Confirmar e abrir WhatsApp <span>→</span>' : state.step === 4 ? 'Revisar <span>→</span>' : 'Continuar <span>→</span>';
  next.disabled = !stepValid(state.step) || state.saving || (state.step === 5 && state.quoteLoading);
  if (state.step === 4) renderClientStep();
  $('#bk-back').style.visibility = state.step === 1 ? 'hidden' : 'visible';
  if (state.step === 5) renderReview();
  updateScrollHint();
}

function bookingMessage(appointment) {
  return `Olá! Acabei de realizar um agendamento.\n\nNome: ${appointment.customerName}\nData: ${dateFmt(appointment.date)}\nHorário: ${appointment.time}\nServiços: ${appointment.services.map(item => item.name).join(' + ')}${prodLine(appointment)}\nValor total: ${BRL.format(appointment.total)}${appointment.planInfo ? `\n\n${appointment.planInfo.text}` : ''}\n\nAguardo a confirmação. Obrigado!`;
}
function reminderMessage(item) {
  return `Olá, ${item.customerName.split(' ')[0]}! Passando para lembrar que você tem um agendamento na Willzinho Barber em ${dateFmt(item.date)} às ${item.time}.\n\nServiços: ${item.services.map(service => service.name).join(' + ')}${prodLine(item)}\nValor: ${BRL.format(item.total)}\n\nTe esperamos!`;
}
function showMessage(phone, message) {
  $('#message-preview').value = message;
  $('#open-whatsapp').onclick = () => {
    window.open(`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent($('#message-preview').value)}`, '_blank', 'noopener');
    if (state.askAddress) setTimeout(() => $('#message-dialog').close(), 150); // fecha a mensagem: a pergunta do endereço aparece
  };
  $('#message-dialog').showModal();
}

async function confirmBooking() {
  if (state.saving) return; state.saving = true;
  const button = $('#bk-next'); button.disabled = true; button.textContent = 'Salvando agendamento…';
  try {
    const result = await api('/api/appointments', { method: 'POST', body: JSON.stringify({
      customerName: $('#customer-name').value, phone: $('#customer-phone').value,
      date: state.date, time: state.time, serviceIds: state.selected, productIds: state.products, beneficiaryId: state.beneficiary || ''
    }) });
    state.saving = false; resetBooking();
    showMessage(result.whatsapp, bookingMessage(result.appointment)); state.askAddress = true;
    toast('Agendamento salvo com sucesso.');
  } catch (error) {
    state.saving = false; toast(error.message);
    if (/hor[áa]rio/i.test(error.message)) { state.time = ''; state.step = 2; renderDays(); loadSlots(); }
    updateSummary();
  }
}

function resetBooking() {
  state.quote = null; state.quoteKey = ''; state.quoteLoading = false; state.beneficiary = ''; state.quotePhone = '';
  state.selected = []; state.products = []; state.clientMode = ''; state.foundName = ''; state.date = ''; state.time = ''; state.step = 1; state.weekStart = 0;
  $('#customer-name').value = ''; $('#customer-phone').value = ''; $('#booking-date').value = ''; state.autoName = ''; $('#phone-hint').hidden = true;
  renderServices(); renderProducts(); $('#time-slots').innerHTML = ''; $('#day-strip').innerHTML = ''; updateSummary(); $('#bk-body').scrollTop = 0;
}

/* Etapa 4: "já sou cliente" carrega o cadastro pelo WhatsApp; "novo cliente" pede o nome. */
function renderClientStep() {
  const mode = state.clientMode;
  $$('[data-client-mode]').forEach(button => button.classList.toggle('active', button.dataset.clientMode === mode));
  $('#client-fields').hidden = !mode;
  $('#name-label').hidden = mode !== 'new';
}
function setHint(html) { const hint = $('#phone-hint'); hint.innerHTML = html; hint.hidden = !html; }

let lookupTimer = null, lookupSeq = 0;
function scheduleLookup(delay = 350) {
  clearTimeout(lookupTimer); const mine = ++lookupSeq;
  const name = $('#customer-name');
  const clearAuto = () => { if (state.autoName && name.value.trim() === state.autoName) name.value = ''; state.autoName = ''; state.foundName = ''; };
  if (!state.clientMode || phoneDigits().length < 10) { state.lookingUp = false; clearAuto(); setHint(''); updateSummary(); return; }
  state.lookingUp = true; state.foundName = ''; updateSummary();
  lookupTimer = setTimeout(async () => {
    try {
      const { client } = await api('/api/client?phone=' + encodeURIComponent(phoneDigits()));
      if (mine !== lookupSeq) return; // o telefone mudou enquanto a busca rodava
      state.lookingUp = false;
      if (client) {
        state.foundName = client.name; state.autoName = client.name; name.value = client.name;
        const first = esc(client.name.split(' ')[0]);
        setHint(state.clientMode === 'new'
          ? `Este WhatsApp já tem cadastro, <b>${first}</b>! Entramos como cliente cadastrado.`
          : `Olá, <b>${first}</b>! Encontramos seu cadastro.`);
        if (client.subscriber) setHint($('#phone-hint').innerHTML + ` Você é <b>assinante</b> do ${esc(client.planName)}: seus cortes do plano serão conferidos na revisão.`);
        state.clientMode = 'existing';
      } else {
        clearAuto();
        setHint(state.clientMode === 'existing'
          ? 'Não encontramos este número. <button type="button" class="link-btn" data-client-mode="new">Fazer meu cadastro</button>'
          : '');
      }
    } catch (error) { if (mine !== lookupSeq) return; state.lookingUp = false; setHint('Não foi possível consultar agora. Tente novamente.'); }
    updateSummary();
  }, delay);
}
function setClientMode(mode) {
  if (state.clientMode === mode) return;
  const name = $('#customer-name');
  if (state.autoName && name.value.trim() === state.autoName) name.value = '';
  state.autoName = ''; state.foundName = ''; state.clientMode = mode; setHint('');
  renderClientStep(); scheduleLookup(0);
  setTimeout(() => (mode === 'new' && phoneDigits().length >= 10 ? name : $('#customer-phone')).focus(), 0);
}
function wireClientStep() {
  $('#bk').addEventListener('click', event => { const button = event.target.closest('[data-client-mode]'); if (button) setClientMode(button.dataset.clientMode); });
  $('#customer-phone').addEventListener('input', () => scheduleLookup());
}

function wirePublic() {
  $('#booking-date').min = todayISO();
  $('#booking-date').addEventListener('change', event => selectDate(event.target.value));
  $('#customer-name').addEventListener('input', updateSummary);
  $('#customer-phone').addEventListener('input', event => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
    event.target.value = digits.length > 6 ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}` : digits;
  });
  $('#customer-phone').addEventListener('keydown', event => { if (event.key !== 'Enter') return; if (stepValid(4)) goStep(5); else if (state.clientMode === 'new') $('#customer-name').focus(); });
  $('#customer-name').addEventListener('keydown', event => { if (event.key === 'Enter' && stepValid(4)) goStep(5); });
  $('#bk-next').addEventListener('click', () => (state.step < 5 ? goStep(state.step + 1) : confirmBooking()));
  $('#bk-back').addEventListener('click', () => goStep(state.step - 1));
  $('#week-prev').addEventListener('click', () => shiftWeek(-1));
  $('#week-next').addEventListener('click', () => shiftWeek(1));
  $$('#bk-steps li').forEach(item => item.addEventListener('click', () => goStep(Number(item.dataset.go))));
  $('#bk-body').addEventListener('scroll', updateScrollHint, { passive: true });
  window.addEventListener('resize', updateScrollHint);
  $$('[data-scroll]').forEach(button => button.addEventListener('click', () => $('#booking').scrollIntoView({ behavior: 'smooth' })));
  $$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#ps-send').addEventListener('click', sendPlanSignup);
  wireClientStep();
}

function appointmentsFor(date) { return state.data.appointments.filter(item => item.date === date).sort((a, b) => a.time.localeCompare(b.time)); }
const planSummary = item => { const p = item.planInfo; if (!p) return ''; if (!p.eligible) return `${p.planName}: sem corte do plano`; if (p.extra) return `${p.planName}: ${p.extra} ${p.extra === 1 ? 'corte adicional' : 'cortes adicionais'} · ${BRL.format(p.extraCharge)} a cobrar`; return `${p.planName}: corte incluso · restam ${p.remainingAfter}`; };
function planNotice(appt) {
  return `Olá, ${appt.customerName.split(' ')[0]}! Resumo do seu agendamento em ${dateFmt(appt.date)} às ${appt.time}.\n\nServiços: ${appt.services.map(service => service.name).join(' + ')}${prodLine(appt)}\nValor a pagar: ${BRL.format(appt.total)}${appt.planInfo ? `\n\n${appt.planInfo.text}` : ''}\n\nQualquer dúvida, é só chamar!`;
}
function appointmentCard(item) {
  const actions = item.status === 'pending_confirmation'
    ? '<button class="mini-btn confirm" data-action="confirm">Confirmar</button><button class="mini-btn" data-action="reschedule">Reagendar</button><button class="mini-btn danger" data-action="no_show">Desistência</button>'
    : '<button class="mini-btn" data-action="remind">Lembrar</button><button class="mini-btn" data-action="attended">Compareceu</button><button class="mini-btn" data-action="reschedule">Reagendar</button><button class="mini-btn danger" data-action="no_show">Desistência</button>';
  return `<article class="appointment-card" data-appointment="${item.id}">
    <div class="appointment-head"><strong>${item.time} — ${esc(item.customerName)}</strong><span class="status-pill ${item.status}">${statusLabels[item.status] || item.status}</span></div>
    <p>${esc(item.services.map(service => service.name).join(' + '))}${item.products && item.products.length ? ` <em class="prod-tag">+ ${esc(item.products.map(p => p.name).join(', '))}</em>` : ''}${item.planInfo ? ' <em class="plan-tag">Assinante</em>' : ''} · ${BRL.format(item.total)}</p>
    <div class="appointment-details">
      <dl><div><dt>Telefone</dt><dd>${esc(item.phone)}</dd></div><div><dt>Duração</dt><dd>${minutesLabel(item.duration)}</dd></div><div><dt>Data</dt><dd>${dateFmt(item.date)}</dd></div><div><dt>Criado em</dt><dd>${new Date(item.createdAt).toLocaleDateString('pt-BR')}</dd></div>${item.planInfo ? `<div><dt>Plano</dt><dd>${esc(planSummary(item))}</dd></div>` : ''}</dl>
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
  $('#admin-dashboard').innerHTML = `<div class="metrics-grid">${metrics.map(item => `<div class="metric-card ${item[3] ? 'accent' : ''} ${item[4] ? 'alert' : ''}"><small>${item[0]}</small><strong>${item[1]}</strong><span>${item[2]}</span></div>`).join('')}</div>
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
  const root = $('#admin-services');
  const products = state.data.products || [];
  const margin = item => (item.price !== null && item.cost !== null && item.cost !== undefined) ? BRL.format(item.price - item.cost) : '—';
  root.innerHTML = `${planConfigCard()}<div class="panel-card"><div class="panel-header"><div><h3>CATÁLOGO DE SERVIÇOS</h3><p>As alterações refletem no site público</p></div><button class="primary-btn small" id="add-item">Adicionar <span>+</span></button></div>
    ${state.data.services.length ? `<table class="data-table"><thead><tr><th>Serviço</th><th>Preço (R$)</th><th>Custo (R$)</th><th>Lucro</th><th>Duração (min)</th><th>No plano</th><th>Visível</th><th></th></tr></thead><tbody>${state.data.services.map(item => `<tr data-service-row="${esc(item.id)}"><td><input data-field="name" value="${esc(item.name)}"></td><td><input data-field="price" type="number" min="0" step="0.01" value="${item.price ?? ''}" placeholder="A definir"></td><td><input data-field="cost" type="number" min="0" step="0.01" value="${item.cost ?? ''}" placeholder="Opcional"></td><td><b>${margin(item)}</b></td><td><input data-field="duration" type="number" min="5" step="5" value="${item.duration ?? ''}" placeholder="A definir"></td><td><button class="toggle ${inPlanOf(item) ? 'on' : ''}" data-field="inplan" aria-label="Coberto pelo plano mensal" title="Usa um corte do plano do assinante"></button></td><td><button class="toggle ${item.active ? 'on' : ''}" data-field="active" aria-label="Ativar ou desativar"></button></td><td class="row-actions"><button class="mini-btn" data-save-service>Salvar</button><button class="mini-btn danger" data-delete-service>Apagar</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-admin">Nenhum serviço cadastrado. Use “Adicionar” para criar o primeiro.</div>'}</div>
    <div class="panel-card"><div class="panel-header"><div><h3>CATÁLOGO DE PRODUTOS</h3><p>Aparecem como complementos na etapa 3 do agendamento · o custo só aparece aqui no painel</p></div></div>
    ${products.length ? `<table class="data-table"><thead><tr><th>Produto</th><th>Custo (R$)</th><th>Venda (R$)</th><th>Lucro</th><th>Qtd.</th><th>Descrição</th><th>Visível</th><th></th></tr></thead><tbody>${products.map(item => `<tr data-product-row="${esc(item.id)}"><td><input data-field="name" value="${esc(item.name)}"></td><td><input data-field="cost" type="number" min="0" step="0.01" value="${item.cost ?? ''}"></td><td><input data-field="price" type="number" min="0" step="0.01" value="${item.price ?? ''}"></td><td><b>${margin(item)}</b></td><td><input data-field="quantity" type="number" min="0" step="1" value="${item.quantity ?? ''}" placeholder="0"></td><td><input data-field="description" value="${esc(item.description || '')}"></td><td><button class="toggle ${item.active ? 'on' : ''}" data-field="active" aria-label="Ativar ou desativar"></button></td><td class="row-actions"><button class="mini-btn" data-save-product>Salvar</button><button class="mini-btn danger" data-delete-product>Apagar</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-admin">Nenhum produto cadastrado. Use “Adicionar” para criar o primeiro.</div>'}
    </div>`;
  $$('[data-field="active"], [data-field="inplan"]', root).forEach(button => button.addEventListener('click', () => button.classList.toggle('on')));
  $$('[data-save-service]', root).forEach(button => button.addEventListener('click', () => saveService(button.closest('tr'))));
  $$('[data-save-product]', root).forEach(button => button.addEventListener('click', () => saveProduct(button.closest('tr'))));
  $$('[data-delete-service]', root).forEach(button => button.addEventListener('click', () => deleteItem('services', button.closest('tr'))));
  $$('[data-delete-product]', root).forEach(button => button.addEventListener('click', () => deleteItem('products', button.closest('tr'))));
  $('#add-item').addEventListener('click', openItemDialog);
  wirePlanConfig(root);
}

/* ---------- Plano mensal: configuração (aba Serviços) ---------- */
const inPlanOf = item => (item.inPlan === undefined || item.inPlan === null) ? /corte|cabelo/i.test(item.name || '') : Boolean(item.inPlan);
const planOf = () => (state.data.config && state.data.config.monthlyPlan) || { enabled: false, name: 'Plano Mensal', description: '', monthlyValue: 0, includedCuts: 4, extraCutValue: 0, dependentValue: 0, maxDependents: 3 };
const planTotal = (plan, deps, cuts) => plan.monthlyValue + deps * plan.dependentValue + Math.max(0, cuts - plan.includedCuts) * plan.extraCutValue;
function planConfigCard() {
  const p = planOf();
  return `<div class="panel-card plan-config" id="plan-config">
    <div class="panel-header"><div><h3>PLANO MENSAL</h3><p>Define o box de plano exibido abaixo do agendamento no site · o cliente personaliza dependentes e cortes</p></div>
      <label class="pc-switch"><span>Mostrar no site</span><button type="button" class="toggle ${p.enabled ? 'on' : ''}" id="pc-enabled" aria-label="Mostrar plano no site"></button></label></div>
    <div class="pc-grid">
      <label class="reset-label">Nome do plano<input id="pc-name" autocomplete="off" maxlength="60" value="${esc(p.name)}" placeholder="Plano Mensal"></label>
      <label class="reset-label">Valor mensal (R$)<input id="pc-monthly" type="number" min="0" step="0.01" inputmode="decimal" value="${p.monthlyValue || ''}" placeholder="0,00"></label>
      <label class="reset-label">Quantidade mínima de cortes no mês<input id="pc-cuts" type="number" min="1" step="1" inputmode="numeric" value="${p.includedCuts}" placeholder="4"></label>
      <label class="reset-label">Valor de cada corte adicional (R$)<input id="pc-extra" type="number" min="0" step="0.01" inputmode="decimal" value="${p.extraCutValue || ''}" placeholder="0,00"></label>
      <label class="reset-label">Valor adicional por dependente (R$)<input id="pc-dep" type="number" min="0" step="0.01" inputmode="decimal" value="${p.dependentValue || ''}" placeholder="0,00"></label>
      <label class="reset-label">Máximo de dependentes<input id="pc-maxdep" type="number" min="0" step="1" inputmode="numeric" value="${p.maxDependents}" placeholder="3"></label>
      <label class="reset-label pc-wide">Descrição (opcional)<input id="pc-desc" autocomplete="off" maxlength="200" value="${esc(p.description)}" placeholder="Ex.: Corte ilimitado na semana, atendimento prioritário…"></label>
    </div>
    <p class="pc-preview" id="pc-preview"></p>
    <button class="primary-btn small" id="pc-save">Salvar plano</button>
  </div>`;
}
function readPlanForm() {
  return { enabled: $('#pc-enabled').classList.contains('on'), name: $('#pc-name').value, description: $('#pc-desc').value, monthlyValue: $('#pc-monthly').value,
    includedCuts: $('#pc-cuts').value, extraCutValue: $('#pc-extra').value, dependentValue: $('#pc-dep').value, maxDependents: $('#pc-maxdep').value };
}
function wirePlanConfig(root) {
  const n = v => Number(v) || 0;
  const preview = () => {
    const f = readPlanForm(); const plan = { monthlyValue: n(f.monthlyValue), includedCuts: Math.max(1, n(f.includedCuts)), extraCutValue: n(f.extraCutValue), dependentValue: n(f.dependentValue) };
    const deps = Math.min(1, n(f.maxDependents)), cuts = plan.includedCuts + 2;
    $('#pc-preview').innerHTML = `Exemplo: <b>${deps} dependente</b> e <b>${cuts} cortes no mês</b> (${cuts - plan.includedCuts} acima do mínimo) = <b>${BRL.format(planTotal(plan, deps, cuts))}</b>/mês`;
  };
  $('#pc-enabled', root).addEventListener('click', event => event.currentTarget.classList.toggle('on'));
  $$('#plan-config input', root).forEach(input => input.addEventListener('input', preview)); preview();
  $('#pc-save', root).addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await api('/api/plan-config', { method: 'PUT', body: JSON.stringify(readPlanForm()) }); await reloadState(); renderServiceAdmin(); toast('Plano mensal salvo.'); }
    catch (error) { toast(error.message); button.disabled = false; }
  });
}

/* ---------- Plano mensal: assinatura pelo site ---------- */
function planSignupMessage(plan, client, dependents, total, extraCuts) {
  const deps = dependents.length ? dependents.map(d => `${d.name}${d.phone ? ` (${phoneFmt(d.phone)})` : ''}`).join(', ') : 'nenhum';
  return `Olá! Quero assinar o ${plan.name}.\n\nNome: ${client.name}\nWhatsApp: ${phoneFmt(client.phone)}\nCortes por mês: ${planPick.cuts}${extraCuts ? ` (${extraCuts} acima do mínimo de ${plan.includedCuts})` : ''}\nDependentes: ${deps}\nValor mensal: ${BRL.format(total)}\n\nAguardo as instruções para o pagamento e a confirmação da assinatura.`;
}
function openPlanSignup() {
  const plan = planOf(); const total = planTotal(plan, planPick.deps, planPick.cuts);
  $('#plan-signup-sum').innerHTML = `<b>${esc(plan.name)}</b> · ${planPick.cuts} ${planPick.cuts === 1 ? 'corte' : 'cortes'}/mês · ${planPick.deps} ${planPick.deps === 1 ? 'dependente' : 'dependentes'} · <b>${BRL.format(total)}</b>/mês`;
  $('#ps-deps').innerHTML = Array.from({ length: planPick.deps }, (_, i) => `<div class="ps-dep"><small>Dependente ${i + 1}</small><div class="two-cols">
      <label class="reset-label">Nome<input data-ps-dep-name autocomplete="off" placeholder="Nome do dependente"></label>
      <label class="reset-label">WhatsApp <em>(opcional)</em><input data-ps-dep-phone inputmode="tel" autocomplete="off" placeholder="(00) 00000-0000"></label></div></div>`).join('');
  $$('#plan-signup-dialog [data-ps-dep-phone], #ps-phone').forEach(input => { input.oninput = () => formatPhoneInput(input); });
  $('#plan-signup-dialog').showModal();
}
async function sendPlanSignup() {
  const button = $('#ps-send'); if (button.disabled) return;
  const plan = planOf(); const name = $('#ps-name').value.trim(); const phone = $('#ps-phone').value;
  if (name.split(/\s+/).filter(Boolean).length < 2) { $('#ps-name').focus(); return toast('Informe o nome completo.'); }
  if (phoneKey(phone).length < 10) { $('#ps-phone').focus(); return toast('Informe um WhatsApp válido com DDD.'); }
  const rows = $$('#ps-deps .ps-dep'); const dependents = [];
  for (const row of rows) {
    const depName = $('[data-ps-dep-name]', row).value.trim(); const depPhone = $('[data-ps-dep-phone]', row).value;
    if (depName.length < 2) { $('[data-ps-dep-name]', row).focus(); return toast('Informe o nome de cada dependente.'); }
    if (depPhone && phoneKey(depPhone).length < 10) { $('[data-ps-dep-phone]', row).focus(); return toast('WhatsApp do dependente incompleto: informe com DDD ou deixe em branco.'); }
    dependents.push({ name: depName, phone: depPhone });
  }
  button.disabled = true;
  try {
    const result = await api('/api/plan-requests', { method: 'POST', body: JSON.stringify({ name, phone, cuts: planPick.cuts, dependents }) });
    $('#plan-signup-dialog').close();
    const extraCuts = planPick.cuts - plan.includedCuts;
    showMessage(result.whatsapp, planSignupMessage(plan, { name, phone }, dependents, result.planValue, extraCuts));
    toast('Pedido registrado. Envie a mensagem para confirmar a assinatura.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

/* ---------- Plano mensal: box público (abaixo do agendamento) ---------- */
const planPick = { deps: 0, cuts: null };
function renderPlanBox() {
  const wrap = $('#plan-wrap'); if (!wrap) return;
  const plan = planOf(); const link = $('#nav-plano');
  const visible = plan.enabled && plan.monthlyValue > 0;
  wrap.hidden = !visible; if (link) link.style.display = visible ? '' : 'none';
  if (!visible) return;
  planPick.cuts = Math.max(plan.includedCuts, Math.min(planPick.cuts ?? plan.includedCuts, 60));
  planPick.deps = Math.max(0, Math.min(planPick.deps, plan.maxDependents));
  const extraCuts = planPick.cuts - plan.includedCuts;
  const depsCost = planPick.deps * plan.dependentValue, extraCost = extraCuts * plan.extraCutValue;
  const total = planTotal(plan, planPick.deps, planPick.cuts);
  const stepper = (key, value, min, max) => `<div class="stepper"><button type="button" data-plan-step="${key}" data-dir="-1" aria-label="Diminuir" ${value <= min ? 'disabled' : ''}>−</button><b>${value}</b><button type="button" data-plan-step="${key}" data-dir="1" aria-label="Aumentar" ${value >= max ? 'disabled' : ''}>+</button></div>`;
  $('#plan-box').innerHTML = `<div class="plan-info">
      <p class="summary-kicker">PLANO MENSAL</p>
      <h3>${esc(plan.name)}</h3>
      ${plan.description ? `<p class="plan-desc">${esc(plan.description)}</p>` : ''}
      <div class="plan-from"><small>A partir de</small><strong>${BRL.format(plan.monthlyValue)}</strong><span>/mês</span></div>
      <ul class="plan-perks">
        <li><i>✓</i>${plan.includedCuts} ${plan.includedCuts === 1 ? 'corte incluso' : 'cortes inclusos'} por mês</li>
        <li><i>✓</i>${plan.extraCutValue > 0 ? `Corte adicional: + ${BRL.format(plan.extraCutValue)} cada` : 'Cortes adicionais sem custo extra'}</li>
        ${plan.maxDependents > 0 ? `<li><i>✓</i>${plan.dependentValue > 0 ? `Dependente: + ${BRL.format(plan.dependentValue)} por mês` : 'Dependentes sem custo extra'} (até ${plan.maxDependents})</li>` : ''}
      </ul>
    </div>
    <div class="plan-build">
      <h4>Monte o seu plano</h4>
      <div class="plan-row"><div><b>Cortes por mês</b><small>Mínimo de ${plan.includedCuts}</small></div>${stepper('cuts', planPick.cuts, plan.includedCuts, 60)}</div>
      ${plan.maxDependents > 0 ? `<div class="plan-row"><div><b>Dependentes</b><small>Filho, irmão, pai… até ${plan.maxDependents}</small></div>${stepper('deps', planPick.deps, 0, plan.maxDependents)}</div>` : ''}
      <div class="plan-lines">
        <div><span>Plano base (${plan.includedCuts} ${plan.includedCuts === 1 ? 'corte' : 'cortes'})</span><b>${BRL.format(plan.monthlyValue)}</b></div>
        ${planPick.deps ? `<div><span>${planPick.deps} ${planPick.deps === 1 ? 'dependente' : 'dependentes'}</span><b>${BRL.format(depsCost)}</b></div>` : ''}
        ${extraCuts ? `<div><span>${extraCuts} ${extraCuts === 1 ? 'corte adicional' : 'cortes adicionais'}</span><b>${BRL.format(extraCost)}</b></div>` : ''}
      </div>
      <div class="plan-total"><span>Total por mês</span><strong>${BRL.format(total)}</strong></div>
      <button type="button" class="primary-btn full" id="plan-interest">Quero este plano <span>→</span></button>
    </div>`;
  $$('[data-plan-step]').forEach(button => button.addEventListener('click', () => {
    planPick[button.dataset.planStep] += Number(button.dataset.dir); renderPlanBox();
  }));
  $('#plan-interest').addEventListener('click', openPlanSignup);
}

/* Apagar serviço ou produto do catálogo (agendamentos antigos mantêm o registro do que foi feito) */
async function deleteItem(kind, row) {
  const id = kind === 'services' ? row.dataset.serviceRow : row.dataset.productRow;
  const name = $('[data-field="name"]', row).value.trim() || 'este item';
  const label = kind === 'services' ? 'serviço' : 'produto';
  if (!confirm(`Apagar o ${label} “${name}”?\n\nEle some do site e do catálogo. Agendamentos já feitos continuam com o registro.`)) return;
  try { await api(`/api/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }); await reloadState(); renderServiceAdmin(); toast(kind === 'services' ? 'Serviço apagado.' : 'Produto apagado.'); }
  catch (error) { toast(error.message); }
}

async function saveProduct(row) {
  const payload = {
    name: $('[data-field="name"]', row).value, cost: $('[data-field="cost"]', row).value, price: $('[data-field="price"]', row).value, quantity: $('[data-field="quantity"]', row).value,
    description: $('[data-field="description"]', row).value, active: $('[data-field="active"]', row).classList.contains('on')
  };
  try { await api(`/api/products/${row.dataset.productRow}`, { method: 'PUT', body: JSON.stringify(payload) }); await reloadState(); renderServiceAdmin(); toast('Produto atualizado.'); }
  catch (error) { toast(error.message); }
}

/* Botão "Adicionar": serviço (nome e valor) ou produto (nome, custo, venda e descrição) */
const itemDialog = { type: 'service' };
function setItemType(type) {
  itemDialog.type = type;
  $$('[data-item-type]').forEach(button => button.classList.toggle('active', button.dataset.itemType === type));
  $$('.item-fields').forEach(box => { box.hidden = box.dataset.for !== type; });
  $('#item-save').textContent = type === 'service' ? 'Adicionar serviço' : 'Adicionar produto';
}
function openItemDialog() {
  ['#new-service-name', '#new-service-price', '#new-service-cost', '#new-product-quantity', '#new-product-name', '#new-product-cost', '#new-product-price', '#new-product-desc'].forEach(selector => { $(selector).value = ''; });
  $('#new-service-duration').value = '30';
  setItemType('service'); $('#item-dialog').showModal();
}
async function saveNewItem() {
  const button = $('#item-save'); button.disabled = true;
  try {
    if (itemDialog.type === 'service') {
      await api('/api/services', { method: 'POST', body: JSON.stringify({ name: $('#new-service-name').value, price: $('#new-service-price').value, cost: $('#new-service-cost').value, duration: $('#new-service-duration').value, active: true }) });
      toast('Serviço adicionado.');
    } else {
      await api('/api/products', { method: 'POST', body: JSON.stringify({ name: $('#new-product-name').value, cost: $('#new-product-cost').value, price: $('#new-product-price').value, quantity: $('#new-product-quantity').value, description: $('#new-product-desc').value, active: true }) });
      toast('Produto adicionado.');
    }
    $('#item-dialog').close(); await reloadState(); renderServiceAdmin();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
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
      showMessage(confirmed.phone, `Olá, ${confirmed.customerName.split(' ')[0]}! Seu agendamento está confirmado.\n\nData: ${dateFmt(confirmed.date)}\nHorário: ${confirmed.time}\nServiços: ${confirmed.services.map(service => service.name).join(' + ')}${prodLine(confirmed)}\nValor: ${BRL.format(confirmed.total)}\nDuração estimada: ${minutesLabel(confirmed.duration)}${confirmed.planInfo ? `\n\n${confirmed.planInfo.text}` : ''}\n\nTe esperamos!`);
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
    showMessage(updated.phone, `Olá, ${updated.customerName.split(' ')[0]}! Seu agendamento foi reagendado.\n\nNova data: ${dateFmt(updated.date)}\nNovo horário: ${updated.time}\nServiços: ${updated.services.map(service => service.name).join(' + ')}${prodLine(updated)}\nValor: ${BRL.format(updated.total)}\n\nAté lá!`);
    toast('Agendamento reagendado.');
  } catch (error) { toast(error.message); }
}

async function saveService(row) {
  const payload = {
    name: $('[data-field="name"]', row).value,
    price: $('[data-field="price"]', row).value,
    cost: $('[data-field="cost"]', row).value,
    duration: $('[data-field="duration"]', row).value,
    inPlan: $('[data-field="inplan"]', row).classList.contains('on'),
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

const cutValue = item => (item.services || []).reduce((sum, service) => sum + service.price, 0);
const regDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

function buildClients() {
  const registry = new Map((state.data.clients || []).map(item => [item.id, item]));
  const map = new Map();
  state.data.appointments.slice().sort((a, b) => stamp(a).localeCompare(stamp(b))).forEach(item => {
    const key = phoneKey(item.phone) || item.customerName;
    const client = map.get(key) || { key, appts: [] };
    client.name = item.customerName; client.phone = item.phone; client.appts.push(item);
    map.set(key, client);
  });
  return [...map.values()].map(client => {
    const attended = client.appts.filter(item => item.status === 'attended');
    const record = registry.get(phoneKey(client.phone));
    const registeredAt = (record && record.firstBookingAt) || client.appts.map(item => item.createdAt).filter(Boolean).sort()[0] || '';
    return { ...client, attended, registeredAt, lastCut: attended[attended.length - 1] || null, spent: attended.reduce((sum, item) => sum + item.total, 0), last: client.appts[client.appts.length - 1] };
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
      <span class="client-meta">
        <span class="client-col"><small>Cadastro</small><b>${regDate(client.registeredAt)}</b></span>
        <span class="client-col"><small>Último corte</small><b>${client.lastCut ? dateFmt(client.lastCut.date) : '—'}</b></span>
        <span class="client-col"><small>Valor do corte</small><b>${client.lastCut ? BRL.format(cutValue(client.lastCut)) : '—'}</b></span>
      </span>
      <span class="client-col hide-sm"><small>Atendimentos</small><b>${client.attended.length}<em>/${client.appts.length}</em></b></span>
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
    ['Cliente desde', regDate(client.registeredAt), 'data do cadastro'],
    ['Último corte', lastAttended ? dateFmt(lastAttended.date) : '—', lastAttended ? `${BRL.format(cutValue(lastAttended))} · ${daysBetween(lastAttended.date, today)} dias atrás` : 'ainda não compareceu'],
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


/* ---------- Planos mensais (dados ficam no cadastro do cliente: clients/{telefone}.plan) ---------- */
const isPending = item => Boolean(item.plan && item.plan.status === 'pending_payment');
const planClients = () => (state.data.clients || []).filter(item => item.plan).sort((a, b) => (isPending(b) - isPending(a)) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
const cutsInMonth = (client, month) => ((client.plan && client.plan.cuts) || []).filter(cut => cut.date.slice(0, 7) === month);
const planKeyOf = phone => phoneKey(phone);
const waNumber = phone => { const d = String(phone || '').replace(/\D/g, ''); return d.length <= 11 ? `55${d}` : d; };
const keepPlanOpen = key => $$(`.plan-card[data-plan="${key}"]`).forEach(el => el.classList.add('open'));

function renderPlans() {
  const root = $('#admin-plans'); if (!root) return;
  const list = planClients(); const month = todayISO().slice(0, 7);
  const pending = list.filter(isPending);
  const active = list.filter(item => !isPending(item) && item.plan.active !== false);
  const revenue = active.reduce((sum, item) => sum + (item.plan.planValue || 0), 0);
  const cuts = active.reduce((sum, item) => sum + cutsInMonth(item, month).length, 0);
  const deps = list.reduce((sum, item) => sum + (item.plan.dependents || []).length, 0);
  const metrics = [
    ['Receita mensal dos planos', BRL.format(revenue), `${active.length} ${active.length === 1 ? 'plano ativo' : 'planos ativos'}`, true],
    ['Planos cadastrados', String(list.length).padStart(2, '0'), `${list.length - active.length - pending.length} inativo(s)`],
    ['Cortes no mês', String(cuts).padStart(2, '0'), 'realizados pelos planos ativos'],
    ['Aguardando pagamento', String(pending.length).padStart(2, '0'), `${deps} dependente(s) nos planos`, false, pending.length > 0]
  ];
  const card = item => {
    const plan = item.plan; const used = cutsInMonth(item, month).length; const limit = plan.cutsPerMonth || 0;
    const pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0; const over = limit && used > limit;
    const history = (plan.cuts || []).slice().sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)).slice(0, 15);
    const depList = plan.dependents || [];
    const wait = isPending(item);
    return `<article class="plan-card ${wait ? 'pending' : plan.active === false ? 'off' : ''}" data-plan="${esc(item.id)}">
      <div class="appointment-head"><strong>${esc(item.name)}</strong><span class="status-pill ${wait ? 'pending_confirmation' : plan.active === false ? 'no_show' : 'attended'}">${wait ? 'Aguardando pagamento' : plan.active === false ? 'Inativo' : 'Ativo'}</span></div>
      <div class="plan-stats">
        <div><small>Telefone</small><b>${esc(phoneFmt(item.phone))}</b></div>
        <div><small>Valor mensal</small><b>${BRL.format(plan.planValue ?? plan.monthlyValue ?? 0)}</b></div>
        <div><small>Cortes no mês</small><b class="${over ? 'over' : ''}">${used}<em>/${limit}</em></b><span class="plan-bar"><i style="width:${pct}%"></i></span></div>
        <div><small>Dependentes</small><b>${depList.length}<em>/${plan.dependentsAllowed || 0}</em></b></div>
      </div>
      <div class="appointment-details plan-details">
        ${wait ? `<div class="plan-block"><small>Pedido feito pelo site${plan.requestedAt ? ` em ${regDate(plan.requestedAt)}` : ''}</small><p class="muted">Cortes acima do mínimo: ${Math.max(0, (plan.cutsPerMonth || 0) - (plan.includedCuts || plan.cutsPerMonth || 0))} · Combine o pagamento com o cliente no WhatsApp e confirme aqui para ativar o plano.</p></div>` : ''}
        <div class="plan-block"><small>Dependentes cadastrados</small>${depList.length ? `<div class="chips">${depList.map(dep => `<span class="chip dep-chip"><b>${esc(dep.name)}</b>${dep.phone ? `<a href="https://wa.me/${esc(waNumber(dep.phone))}" target="_blank" rel="noopener">${esc(phoneFmt(dep.phone))} ↗</a>` : '<em>sem WhatsApp</em>'}</span>`).join('')}</div>` : '<p class="muted">Nenhum dependente cadastrado.</p>'}</div>
        <div class="plan-block"><small>Cortes registrados ${history.length ? `· últimos ${history.length}` : ''}</small>
          ${history.length ? history.map(cut => `<div class="cut-line"><span>${dateFmt(cut.date)}${cut.time ? ` · ${esc(cut.time)}` : ''}</span><b>${cut.dependentName ? `Dependente: ${esc(cut.dependentName)}` : 'Titular'}</b>${cut.kind === 'extra' ? `<em class="cut-tag extra">Adicional ${BRL.format(cut.charge || 0)}</em>` : cut.appointmentId ? '<em class="cut-tag">Agendamento · incluso</em>' : ''}${cut.appointmentId ? `<button class="mini-btn" data-plan-action="cut-msg" data-cut="${esc(cut.id)}">Mensagem</button>` : ''}<button class="mini-btn danger" data-plan-action="remove-cut" data-cut="${esc(cut.id)}">Remover</button></div>`).join('') : '<p class="muted">Nenhum corte registrado ainda.</p>'}</div>
        <div class="action-row">
          ${wait ? `<button class="mini-btn confirm" data-plan-action="confirm">Confirmar pagamento</button>
          <button class="mini-btn" data-plan-action="charge">Chamar no WhatsApp</button>
          <button class="mini-btn" data-plan-action="edit">Editar plano</button>
          <button class="mini-btn danger" data-plan-action="reject">Recusar pedido</button>` : `<button class="mini-btn confirm" data-plan-action="cut" ${plan.active === false ? 'disabled' : ''}>Registrar corte</button>
          <button class="mini-btn" data-plan-action="send">Enviar no WhatsApp</button>
          <button class="mini-btn" data-plan-action="edit">Editar plano</button>
          <button class="mini-btn ${plan.active === false ? '' : 'danger'}" data-plan-action="toggle">${plan.active === false ? 'Reativar' : 'Desativar'}</button>`}
        </div>
      </div>
    </article>`;
  };
  root.innerHTML = `<div class="metrics-grid">${metrics.map(item => `<div class="metric-card ${item[3] ? 'accent' : ''}"><small>${item[0]}</small><strong>${item[1]}</strong><span>${item[2]}</span></div>`).join('')}</div>
    <div class="panel-card"><div class="panel-header"><div><h3>CLIENTES COM PLANO MENSAL</h3><p>Clique em um plano para ver dependentes e cortes · o plano fica salvo no cadastro do cliente</p></div><button class="primary-btn small" id="plan-new">Novo plano <span>+</span></button></div>
      ${list.length ? list.map(card).join('') : '<div class="empty-admin">Nenhum plano mensal cadastrado. Use “Novo plano” para começar.</div>'}</div>`;
  const nav = $('.admin-nav[data-admin-tab="plans"]');
  if (nav) { $$('.nav-badge', nav).forEach(el => el.remove()); if (pending.length) nav.insertAdjacentHTML('beforeend', `<b class="nav-badge" title="Aguardando pagamento">${pending.length}</b>`); }
  $('#plan-new').addEventListener('click', () => openPlanDialog(null));
  $$('.plan-card', root).forEach(el => el.addEventListener('click', event => {
    if (event.target.closest('a')) return event.stopPropagation();
    const button = event.target.closest('[data-plan-action]');
    if (!button) return el.classList.toggle('open');
    event.stopPropagation(); planAction(el.dataset.plan, button.dataset.planAction, button.dataset.cut);
  }));
}

function planAction(key, action, cutId) {
  const client = planClients().find(item => item.id === key); if (!client) return;
  if (action === 'edit') return openPlanDialog(client);
  if (action === 'cut') return openCutDialog(client);
  if (action === 'toggle') return togglePlan(client);
  if (action === 'send') return showMessage(client.phone, planMessage(client));
  if (action === 'charge') return showMessage(client.phone, pendingMessage(client));
  if (action === 'confirm') return confirmPlanPayment(client);
  if (action === 'reject') return rejectPlan(client);
  if (action === 'cut-msg') {
    const cut = (client.plan.cuts || []).find(item => item.id === cutId); const appt = cut && state.data.appointments.find(item => item.id === cut.appointmentId);
    return appt ? showMessage(client.phone, planNotice(appt)) : toast('Agendamento deste corte não encontrado.');
  }
  if (action === 'remove-cut') return removeCut(client, cutId);
}

function planMessage(client) {
  const plan = client.plan; const business = (state.data.config && state.data.config.businessName) || 'nossa barbearia';
  const deps = plan.dependents || [];
  return `Olá, ${client.name.split(' ')[0]}! Seu plano mensal na ${business} está cadastrado.\n\nValor mensal: ${BRL.format(plan.planValue ?? plan.monthlyValue ?? 0)}\nCortes por mês: ${plan.cutsPerMonth}\nDependentes: ${deps.length ? deps.map(dep => dep.name).join(', ') : 'nenhum'}\n\nQualquer dúvida, é só chamar!`;
}

function pendingMessage(client) {
  const plan = client.plan; const business = (state.data.config && state.data.config.businessName) || 'nossa barbearia'; const deps = plan.dependents || [];
  return `Olá, ${client.name.split(' ')[0]}! Recebemos seu pedido do ${plan.planName || 'plano mensal'} na ${business}.\n\nCortes por mês: ${plan.cutsPerMonth}\nDependentes: ${deps.length ? deps.map(dep => dep.name).join(', ') : 'nenhum'}\nValor mensal: ${BRL.format(plan.planValue || 0)}\n\nPara ativar a assinatura, falta confirmar o pagamento. Como prefere pagar?`;
}
async function confirmPlanPayment(client) {
  if (!confirm(`Confirmar o pagamento de ${client.name} (${BRL.format(client.plan.planValue || 0)}) e ativar o plano?`)) return;
  try {
    const { client: updated } = await api(`/api/clients/${client.id}/plan/confirm`, { method: 'POST', body: '{}' });
    await reloadState(); renderAdmin(); keepPlanOpen(client.id); toast('Pagamento confirmado. Plano ativo.');
    showMessage(updated.phone, planMessage(updated)); // avisa o cliente que o plano está ativo
  } catch (error) { toast(error.message); }
}
async function rejectPlan(client) {
  if (!confirm(`Recusar o pedido de plano de ${client.name}? Ele sai da lista de aguardando pagamento.`)) return;
  try { await api(`/api/clients/${client.id}/plan/reject`, { method: 'POST', body: '{}' }); await reloadState(); renderAdmin(); toast('Pedido recusado.'); }
  catch (error) { toast(error.message); }
}

const planDraft = { key: null, dependents: [] };
const formatPhoneInput = input => {
  const digits = input.value.replace(/\D/g, '').slice(0, 11);
  input.value = digits.length > 6 ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}` : digits;
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

function drawPlanDeps() {
  const allowed = Number($('#plan-deps-allowed').value) || 0;
  $('#plan-deps-count').textContent = `(${planDraft.dependents.length} de ${allowed})`;
  $('#plan-dep-list').innerHTML = planDraft.dependents.length
    ? planDraft.dependents.map(dep => `<span class="chip dep-chip"><b>${esc(dep.name)}</b>${dep.phone ? `<em>${esc(phoneFmt(dep.phone))}</em>` : '<em>sem WhatsApp</em>'}<button type="button" data-dep-remove="${esc(dep.id)}" aria-label="Remover ${esc(dep.name)}">×</button></span>`).join('')
    : '<p class="muted">Nenhum dependente cadastrado.</p>';
  $$('[data-dep-remove]', $('#plan-dep-list')).forEach(button => button.addEventListener('click', () => {
    planDraft.dependents = planDraft.dependents.filter(dep => dep.id !== button.dataset.depRemove); drawPlanDeps();
  }));
}
function openPlanDialog(client) {
  const plan = client && client.plan;
  planDraft.key = client ? client.id : null;
  planDraft.dependents = plan ? (plan.dependents || []).map(dep => ({ ...dep })) : [];
  $('#plan-dialog-title').textContent = client ? 'EDITAR PLANO' : 'NOVO PLANO';
  $('#plan-name').value = client ? client.name : ''; $('#plan-phone').value = client ? phoneFmt(client.phone) : ''; $('#plan-phone').disabled = Boolean(client);
  $('#plan-monthly').value = plan ? (plan.planValue ?? plan.monthlyValue ?? '') : '';
  $('#plan-cuts').value = plan ? plan.cutsPerMonth : ''; $('#plan-deps-allowed').value = plan ? plan.dependentsAllowed : 0;
  $('#plan-dep-input').value = ''; $('#plan-dep-phone').value = ''; $('#plan-dialog-hint').hidden = true;
  drawPlanDeps(); $('#plan-dialog').showModal();
}
function addPlanDependent() {
  const input = $('#plan-dep-input'), phoneInput = $('#plan-dep-phone'); const name = input.value.trim(); const phone = phoneKey(phoneInput.value);
  if (name.length < 2) { input.focus(); return toast('Informe o nome do dependente.'); }
  if (phone && phone.length < 10) { phoneInput.focus(); return toast('WhatsApp incompleto: informe com DDD ou deixe em branco.'); }
  const allowed = Number($('#plan-deps-allowed').value) || 0;
  if (planDraft.dependents.length >= allowed) return toast('Aumente a quantidade de dependentes do plano para cadastrar mais um.');
  if (phone && planDraft.dependents.some(dep => phoneKey(dep.phone) === phone)) return toast('Já existe um dependente com este WhatsApp.');
  planDraft.dependents.push({ id: newId(), name, phone: phone || '' }); input.value = ''; phoneInput.value = ''; drawPlanDeps(); input.focus();
}
/* Ao digitar o telefone de um plano novo, reaproveita nome de quem já é cliente */
function lookupPlanClient() {
  if (planDraft.key) return;
  const key = phoneKey($('#plan-phone').value); const hint = $('#plan-dialog-hint');
  if (key.length < 10) { hint.hidden = true; return; }
  const known = (state.data.clients || []).find(item => item.id === key)
    || (() => { const appt = state.data.appointments.find(item => phoneKey(item.phone) === key); return appt ? { name: appt.customerName, plan: null } : null; })();
  if (!known) { hint.hidden = true; return; }
  if (!$('#plan-name').value.trim()) $('#plan-name').value = known.name;
  hint.textContent = known.plan ? 'Este cliente já tem plano mensal. Para alterar, use “Editar plano”.' : `Cliente já cadastrado: ${known.name}.`; hint.hidden = false;
}
async function savePlan() {
  const button = $('#plan-save'); button.disabled = true;
  const phone = $('#plan-phone').value; const key = planDraft.key || planKeyOf(phone);
  if (!key || key.length < 10) { toast('Informe um telefone válido com DDD.'); button.disabled = false; return; }
  const existing = (state.data.clients || []).find(item => item.id === key);
  if (!planDraft.key && existing && existing.plan) { toast('Este cliente já tem plano mensal.'); button.disabled = false; return; }
  try {
    const isNew = !planDraft.key;
    const { client } = await api(`/api/clients/${key}/plan`, { method: 'PUT', body: JSON.stringify({
      name: $('#plan-name').value, phone, monthlyValue: $('#plan-monthly').value, planValue: $('#plan-monthly').value,
      cutsPerMonth: $('#plan-cuts').value, dependentsAllowed: $('#plan-deps-allowed').value, dependents: planDraft.dependents
    }) });
    $('#plan-dialog').close(); await reloadState(); renderAdmin(); keepPlanOpen(key); toast('Plano salvo no cadastro do cliente.');
    if (isNew) showMessage(client.phone, planMessage(client)); // opção de avisar o cliente no WhatsApp
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
async function togglePlan(client) {
  const plan = client.plan; const turnOff = plan.active !== false;
  if (turnOff && !confirm(`Desativar o plano de ${client.name}? O histórico de cortes é mantido.`)) return;
  try {
    await api(`/api/clients/${client.id}/plan`, { method: 'PUT', body: JSON.stringify({ ...plan, name: client.name, phone: client.phone, active: !turnOff }) });
    await reloadState(); renderAdmin(); keepPlanOpen(client.id); toast(turnOff ? 'Plano desativado.' : 'Plano reativado.');
  } catch (error) { toast(error.message); }
}

const cutDraft = { key: null };
function openCutDialog(client) {
  cutDraft.key = client.id;
  $('#cut-client').textContent = `${client.name} · ${phoneFmt(client.phone)}`;
  $('#cut-date').value = todayISO(); $('#cut-date').max = todayISO();
  $('#cut-who').innerHTML = `<option value="">Titular — ${esc(client.name)}</option>` + (client.plan.dependents || []).map(dep => `<option value="${esc(dep.id)}">Dependente — ${esc(dep.name)}${dep.phone ? ` · ${esc(phoneFmt(dep.phone))}` : ''}</option>`).join('');
  $('#cut-dialog').showModal();
}
async function saveCut() {
  const button = $('#cut-save'); button.disabled = true;
  try {
    const result = await api(`/api/clients/${cutDraft.key}/plan/cuts`, { method: 'POST', body: JSON.stringify({ date: $('#cut-date').value, dependentId: $('#cut-who').value || null }) });
    $('#cut-dialog').close(); await reloadState(); renderAdmin();
    $$(`.plan-card[data-plan="${cutDraft.key}"]`).forEach(el => el.classList.add('open'));
    toast(result.overLimit ? 'Corte registrado — atenção: passou do limite de cortes do mês.' : 'Corte registrado.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
async function removeCut(client, cutId) {
  if (!confirm('Remover este corte do histórico do plano?')) return;
  try {
    await api(`/api/clients/${client.id}/plan/cuts/${encodeURIComponent(cutId)}`, { method: 'DELETE' });
    await reloadState(); renderAdmin(); $$(`.plan-card[data-plan="${client.id}"]`).forEach(el => el.classList.add('open')); toast('Corte removido.');
  } catch (error) { toast(error.message); }
}
function wirePlanDialogs() {
  $('#plan-phone').addEventListener('input', () => { formatPhoneInput($('#plan-phone')); lookupPlanClient(); });
  $('#plan-deps-allowed').addEventListener('input', drawPlanDeps);
  $('#plan-dep-add').addEventListener('click', addPlanDependent);
  $('#plan-dep-phone').addEventListener('input', () => formatPhoneInput($('#plan-dep-phone')));
  ['#plan-dep-input', '#plan-dep-phone'].forEach(selector => $(selector).addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addPlanDependent(); } }));
  $('#plan-save').addEventListener('click', savePlan);
  $('#cut-save').addEventListener('click', saveCut);
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
  const links = $$('.site-header .nav-link'); const sections = ['trabalho', 'booking', 'plano', 'avaliacoes', 'localizacao', 'contato'].map(id => document.getElementById(id));
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
  }), { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(section => section && observer.observe(section));
  const top = document.getElementById('inicio');
  if (top) new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) links.forEach(link => link.classList.remove('active')); }), { rootMargin: '-45% 0px -50% 0px' }).observe(top);
}
function renderLocation() {
  const google = $('#loc-google'); if (!google) return;
  google.href = SHOP.google;
  $('#loc-address').innerHTML = SHOP.lines.map(esc).join('<br>');
  const frame = $('#loc-frame'); if (frame && !frame.getAttribute('src')) frame.setAttribute('src', SHOP.embed);
  const shield = $('#loc-shield'); if (shield) shield.addEventListener('click', () => { shield.hidden = true; });
  $('#loc-copy').addEventListener('click', async () => {
    const text = `${SHOP.name} — ${SHOP.lines.join(', ')}`;
    try { await navigator.clipboard.writeText(text); toast('Endereço copiado.'); } catch (error) { toast(text); }
  });
}

/* Depois do agendamento: "Você sabe o endereço?" */
function wireAddressAsk() {
  const dialog = $('#address-dialog'); if (!dialog) return;
  $('#addr-google').href = SHOP.google;
  $('#addr-info-text').innerHTML = SHOP.lines.map(esc).join('<br>');
  $('#addr-yes').addEventListener('click', () => { dialog.close(); toast('Perfeito! Te esperamos na barbearia.'); });
  $('#addr-no').href = mapUrl(); // link real: abre o mapa do aparelho mesmo em navegadores embutidos
  $('#addr-no').addEventListener('click', () => {
    $('#addr-opened').textContent = 'Abrimos o Google Maps para você. Se não abriu, use o botão abaixo:';
    $('#addr-ask').hidden = true; $('#addr-info').hidden = false;
  });
  const messageDialog = $('#message-dialog');
  messageDialog.addEventListener('close', () => { // a pergunta aparece quando a mensagem do WhatsApp é fechada
    if (!state.askAddress) return; state.askAddress = false;
    $('#addr-ask').hidden = false; $('#addr-info').hidden = true; dialog.showModal();
  });
}

function renderPublicInfo() {
  renderPublicHours(); renderOpenStatus(); wireNavHighlight(); renderLocation(); wireAddressAsk();
  const year = $('#year'); if (year) year.textContent = new Date().getFullYear();
}

/* ---------- Sistema: zerar dados ---------- */
function renderSystem() {
  const appointments = state.data.appointments.length; const clients = buildClients().length;
  $('#admin-system').innerHTML = `<div class="panel-card danger-zone">
    <div class="panel-header"><div><h3>ZERAR DADOS</h3><p>Apaga todos os agendamentos e clientes (incluindo os planos mensais) e deixa o sistema como novo. Serviços, preços e horários de funcionamento são mantidos.</p></div></div>
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
  renderDashboard(); renderAgenda(); renderClients(); renderPlans(); renderServiceAdmin(); renderHours(); renderSystem();
}
function setAdminTab(tab) {
  const titles = { dashboard: 'VISÃO GERAL', agenda: 'AGENDAMENTOS', clients: 'CLIENTES', plans: 'PLANOS MENSAIS', services: 'SERVIÇOS', hours: 'HORÁRIOS', system: 'SISTEMA' };
  $$('.admin-nav').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tab));
  $$('.admin-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `admin-${tab}`));
  $('#admin-title').textContent = titles[tab];
}
/* ---------- Painel ao vivo: detecta novos agendamentos sozinho ---------- */
const LIVE_INTERVAL = 5000;
const live = { version: null, busy: false };

function rerenderAppointmentViews() {
  const openCards = $$('.appointment-card.open').map(card => card.dataset.appointment);
  const active = document.activeElement; const focusId = active && active.id;
  const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scroller = window.scrollY;
  const openPlans = $$('.plan-card.open').map(card => card.dataset.plan);
  renderDashboard(); renderAgenda(); renderClients(); renderSystem(); renderPlans();
  openPlans.forEach(key => $$(`.plan-card[data-plan="${key}"]`).forEach(card => card.classList.add('open')));
  openCards.forEach(id => $$(`.appointment-card[data-appointment="${id}"]`).forEach(card => card.classList.add('open')));
  if (focusId && document.getElementById(focusId) && document.activeElement.id !== focusId) {
    const element = document.getElementById(focusId); element.focus();
    if (caret && typeof element.setSelectionRange === 'function') element.setSelectionRange(caret[0], caret[1]);
  }
  window.scrollTo({ top: scroller });
}

async function refreshLive() {
  const known = new Set(state.data.appointments.map(item => item.id));
  const knownPlans = new Set(planClients().filter(isPending).map(item => item.id));
  await reloadState();
  const fresh = state.data.appointments.filter(item => !known.has(item.id));
  const freshPlans = planClients().filter(item => isPending(item) && !knownPlans.has(item.id));
  rerenderAppointmentViews();
  if (freshPlans.length && !fresh.length) return toast(freshPlans.length === 1 ? `Novo pedido de plano: ${freshPlans[0].name}` : `${freshPlans.length} novos pedidos de plano`);
  if (fresh.length === 1) toast(`Novo agendamento: ${fresh[0].customerName} · ${dateFmt(fresh[0].date)} às ${fresh[0].time}`);
  else if (fresh.length > 1) toast(`${fresh.length} novos agendamentos`);
}

async function syncLive() {
  if (live.busy || document.hidden) return; live.busy = true;
  try {
    const { version } = await api('/api/sync');
    if (live.version !== null && version !== live.version) { live.version = version; await refreshLive(); }
    live.version = version;
  } catch (error) { /* sem conexão agora: tenta de novo no próximo ciclo */ }
  finally { live.busy = false; }
}

function startLive() {
  setInterval(syncLive, LIVE_INTERVAL);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncLive(); });
  window.addEventListener('focus', syncLive);
}

async function reloadState() { state.data = await api('/api/state' + (document.body.classList.contains('admin-page') ? '?appointments=1' : '')); }
async function init() {
  try {
    const adminMode = document.body.classList.contains('admin-page');
    // marcador lido ANTES de carregar os dados: qualquer agendamento feito nesse intervalo é detectado
    if (adminMode) { try { live.version = (await api('/api/sync')).version; } catch (error) { live.version = null; } }
    await reloadState();
    if (adminMode) {
      if (Store.mode === 'local') setTimeout(() => toast('Modo local: dados salvos só neste navegador (Firestore indisponível).'), 600);
      renderAdmin();
      $$('.admin-nav').forEach(button => button.addEventListener('click', () => navigateAdmin(button.dataset.adminTab)));
      $('#reschedule-date').addEventListener('change', () => { state.rescheduleTime = ''; $('#save-reschedule').disabled = true; loadRescheduleSlots(); });
      $('#save-reschedule').addEventListener('click', saveReschedule);
      $$('.dialog-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
      $('#reset-confirm').addEventListener('input', event => { $('#reset-run').disabled = event.target.value.trim().toUpperCase() !== 'ZERAR'; });
      $('#reset-run').addEventListener('click', runReset);
      wirePlanDialogs();
      $$('[data-item-type]').forEach(button => button.addEventListener('click', () => setItemType(button.dataset.itemType)));
      $('#item-save').addEventListener('click', saveNewItem);
      window.addEventListener('hashchange', syncClientHash); syncClientHash();
      startLive();
    } else {
      renderServices(); renderProducts(); updateSummary(); wirePublic(); renderPublicInfo(); renderPlanBox();
    }
  } catch (error) { document.body.innerHTML = `<main style="padding:40px"><h1>Não foi possível iniciar</h1><p>${error.message}</p></main>`; }
}
init();
