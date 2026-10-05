/* Camada de dados do navegador (substitui o server.js).
   Banco: Firestore, uma coleção para cada tipo de informação:

     config/business        -> dados do negócio (nome, WhatsApp, intervalo dos horários) e `monthlyPlan` (modelo do plano mensal exibido no site)
     services/{id}          -> um documento por serviço
     products/{id}          -> um documento por produto (nome, custo, venda, descrição)
     hours/{0..6}           -> um documento por dia da semana (0 = domingo)
     appointments/{id}      -> um documento por agendamento
     clients/{telefone}     -> um documento por cliente (inclui o plano mensal em `plan`: valores, dependentes e cortes)
     meta/sync              -> marcador de última mudança (o painel lê só este documento para saber se há novidade)

   O sistema nasce zerado: sem agendamentos, clientes, serviços ou produtos. Só são criados os horários
   de funcionamento padrão e os dados do negócio (editáveis no painel). Se o Firestore estiver indisponível, cai para localStorage. */
(function () {
  const PROJECT_ID = 'barbearia-c80da';
  const API_KEY = 'AIzaSyD0x4MrjdJ_kP3I4-kVsSEFXeiRi1w2-Ws';
  const DB = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const BASE = `https://firestore.googleapis.com/v1/${DB}`;
  const LOCAL_KEY = 'barbearia-db';

  const Store = { mode: 'unknown', handle };
  window.Store = Store;

  const money = v => Math.round(Number(v) * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const dateISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const phoneKey = phone => { const d = String(phone || '').replace(/\D/g, ''); return d.length > 11 && d.startsWith('55') ? d.slice(2) : d; };
  const byOrder = list => list.map((s, i) => [s, i]).sort((a, b) => (a[0].order ?? a[1]) - (b[0].order ?? b[1])).map(x => x[0]);

  function initialData() {
    const labels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const hours = labels.map((label, day) => ({ day, label, active: true, open: '10:00', close: day === 0 ? '13:00' : '20:00' }));
    return { config: { businessName: 'Willzinho Barber', whatsapp: '5541999901208', slotInterval: 10 }, services: [], hours, products: [], appointments: [] };
  }

  /* ---------- Firestore: codificação de valores ---------- */
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, i]) => [k, enc(i)])) } };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    return { stringValue: String(v) };
  }
  function dec(v) {
    if ('nullValue' in v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, i]) => [k, dec(i)]));
    return null;
  }
  const fields = obj => enc(obj).mapValue.fields;
  const fromDoc = doc => dec({ mapValue: { fields: doc.fields || {} } });

  /* ---------- Firestore: chamadas REST ---------- */
  async function req(path, { method = 'GET', body, params = [] } = {}) {
    const url = `${BASE}${path}?${[...params, 'key=' + API_KEY].join('&')}`;
    const init = { method, cache: 'no-store' };
    if (body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    const r = await fetch(url, init);
    if (!r.ok) { const e = new Error('Firestore respondeu ' + r.status); e.status = r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }
  const fs = {
    async get(col, id) {
      try { return fromDoc(await req(`/${col}/${encodeURIComponent(id)}`)); }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    async list(col) {
      const out = []; let token = '';
      do {
        const params = ['pageSize=300']; if (token) params.push('pageToken=' + encodeURIComponent(token));
        const res = await req(`/${col}`, { params });
        (res.documents || []).forEach(d => out.push(fromDoc(d)));
        token = res.nextPageToken || '';
      } while (token);
      return out;
    },
    async whereEq(col, field, value) {
      const res = await req(':runQuery', { method: 'POST', body: { structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } } });
      return res.filter(x => x.document).map(x => fromDoc(x.document));
    },
    async ids(col) { const out = []; let token = '';
      do {
        const params = ['pageSize=300', 'mask.fieldPaths=id']; if (token) params.push('pageToken=' + encodeURIComponent(token));
        const res = await req(`/${col}`, { params });
        (res.documents || []).forEach(d => out.push(decodeURIComponent(d.name.split('/').pop())));
        token = res.nextPageToken || '';
      } while (token);
      return out;
    },
    async del(col, id) { await req(`/${col}/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    async set(col, id, data) { await req(`/${col}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { fields: fields(data) } }); },
    async update(col, id, data) {
      const params = Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k));
      await req(`/${col}/${encodeURIComponent(id)}`, { method: 'PATCH', params, body: { fields: fields(data) } });
    },
    async commit(writes) {
      for (let i = 0; i < writes.length; i += 400) {
        await req(':commit', { method: 'POST', body: { writes: writes.slice(i, i + 400).map(w => w.remove
          ? { delete: `${DB}/${w.col}/${w.id}` }
          : { update: { name: `${DB}/${w.col}/${w.id}`, fields: fields(w.data) }, ...(w.mustNotExist ? { currentDocument: { exists: false } } : {}) }) } });
      }
    }
  };

  const touch = () => ({ col: 'meta', id: 'sync', data: { updatedAt: Date.now() } });

  /* ---------- Adaptador Firestore (coleções separadas) ---------- */
  const fsStore = {
    async core() {
      const [config, services, hours, products] = await Promise.all([fs.get('config', 'business'), fs.list('services'), fs.list('hours'), fs.list('products').catch(() => [])]);
      return { config: config || initialData().config, services: byOrder(services), hours: hours.sort((a, b) => a.day - b.day), products: byOrder(products) };
    },
    listAppointments: () => fs.list('appointments'),
    appointmentsByDate: date => fs.whereEq('appointments', 'date', date),
    getAppointment: id => fs.get('appointments', id),
    getClient: key => fs.get('clients', key),
    listClients: () => fs.list('clients'),
    saveClient: c => fs.commit([{ col: 'clients', id: c.id, data: c }, touch()]),
    async createAppointment(appt) {
      const key = appt.clientId; const now = new Date().toISOString();
      const writes = [{ col: 'appointments', id: appt.id, data: appt, mustNotExist: true }, touch()];
      if (key) {
        const old = await fs.get('clients', key);
        writes.push({ col: 'clients', id: key, data: { ...(old || {}), id: key, name: appt.customerName, phone: appt.phone, firstBookingAt: (old && old.firstBookingAt) || now, lastBookingAt: now } });
      }
      await fs.commit(writes);
    },
    async updateAppointment(appt, keys) {
      await fs.update('appointments', appt.id, Object.fromEntries(keys.map(k => [k, appt[k]])));
      await fs.set('meta', 'sync', { updatedAt: Date.now() });
    },
    async version() { const d = await fs.get('meta', 'sync'); return d ? String(d.updatedAt) : '0'; },
    saveMonthlyPlan: async plan => { await fs.update('config', 'business', { monthlyPlan: plan }); await fs.set('meta', 'sync', { updatedAt: Date.now() }); },
    saveService: s => fs.set('services', s.id, s),
    saveProduct: p => fs.set('products', p.id, p),
    deleteService: id => fs.del('services', id),
    deleteProduct: id => fs.del('products', id),
    saveHour: h => fs.set('hours', String(h.day), h),
    async resetData() {
      const [appts, clients] = await Promise.all([fs.ids('appointments'), fs.ids('clients')]);
      await fs.commit([...appts.map(id => ({ col: 'appointments', id, remove: true })), ...clients.map(id => ({ col: 'clients', id, remove: true })), touch()]);
      return { appointments: appts.length, clients: clients.length };
    }
  };

  /* ---------- Adaptador local (fallback: localStorage) ---------- */
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { return null; } };
  const writeLocal = db => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } };
  const localStore = {
    db() { let db = readLocal(); if (!db) { db = initialData(); writeLocal(db); } db.appointments = db.appointments || []; db.products = db.products || []; db.clients = db.clients || []; return db; },
    async core() { const d = this.db(); return { config: d.config, services: byOrder(d.services), hours: d.hours, products: byOrder(d.products) }; },
    async listAppointments() { return this.db().appointments; },
    async appointmentsByDate(date) { return this.db().appointments.filter(a => a.date === date); },
    async getAppointment(id) { return this.db().appointments.find(a => a.id === id) || null; },
    async getClient(key) {
      const saved = this.db().clients.find(c => c.id === key); if (saved) return saved;
      const list = this.db().appointments.filter(a => a.clientId === key).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      if (!list.length) return null;
      const last = list[list.length - 1];
      return { id: key, name: last.customerName, phone: last.phone, firstBookingAt: list[0].createdAt, lastBookingAt: last.createdAt };
    },
    async listClients() { return this.db().clients; },
    async saveClient(c) { const d = this.db(); const i = d.clients.findIndex(x => x.id === c.id); if (i >= 0) d.clients[i] = c; else d.clients.push(c); d.syncAt = Date.now(); writeLocal(d); },
    async createAppointment(appt) {
      const d = this.db(); d.appointments.push(appt);
      if (appt.clientId) {
        const now = new Date().toISOString(); const i = d.clients.findIndex(c => c.id === appt.clientId); const old = i >= 0 ? d.clients[i] : null;
        const c = { ...(old || {}), id: appt.clientId, name: appt.customerName, phone: appt.phone, firstBookingAt: (old && old.firstBookingAt) || now, lastBookingAt: now };
        if (i >= 0) d.clients[i] = c; else d.clients.push(c);
      }
      d.syncAt = Date.now(); writeLocal(d);
    },
    async updateAppointment(appt) { const d = this.db(); const i = d.appointments.findIndex(a => a.id === appt.id); if (i >= 0) d.appointments[i] = appt; d.syncAt = Date.now(); writeLocal(d); },
    async saveMonthlyPlan(plan) { const d = this.db(); d.config = { ...d.config, monthlyPlan: plan }; d.syncAt = Date.now(); writeLocal(d); },
    async saveService(s) { const d = this.db(); const i = d.services.findIndex(x => x.id === s.id); if (i >= 0) d.services[i] = s; else d.services.push(s); writeLocal(d); },
    async saveProduct(p) { const d = this.db(); const i = d.products.findIndex(x => x.id === p.id); if (i >= 0) d.products[i] = p; else d.products.push(p); writeLocal(d); },
    async deleteService(id) { const d = this.db(); d.services = d.services.filter(x => x.id !== id); writeLocal(d); },
    async deleteProduct(id) { const d = this.db(); d.products = d.products.filter(x => x.id !== id); writeLocal(d); },
    async saveHour(h) { const d = this.db(); const i = d.hours.findIndex(x => x.day === h.day); if (i >= 0) d.hours[i] = h; writeLocal(d); },
    async resetData() { const d = this.db(); const n = d.appointments.length, c = d.clients.length; d.appointments = []; d.clients = []; d.syncAt = Date.now(); writeLocal(d); return { appointments: n, clients: c }; },
    async version() { return String(this.db().syncAt || 0); }
  };

  /* ---------- Primeiro acesso: cria as coleções vazias (serviços e horários padrão) ---------- */
  async function seed() {
    const data = initialData(); const writes = [];
    data.hours.forEach(h => writes.push({ col: 'hours', id: String(h.day), data: h }));
    // config por último: só existe se todo o resto foi gravado (marca a criação como concluída)
    writes.push({ col: 'config', id: 'business', data: data.config });
    await fs.commit(writes);
  }

  let ready = null;
  function init() {
    if (!ready) ready = (async () => {
      try {
        if (!(await fs.get('config', 'business'))) await seed();
        Store.mode = 'firestore';
        return fsStore;
      } catch (e) {
        console.warn('Firestore indisponível; usando armazenamento local.', e);
        Store.mode = 'local';
        return localStore;
      }
    })();
    return ready;
  }

  let coreCache = null;
  async function getCore(store, fresh) {
    if (!fresh && coreCache && coreCache.store === store && Date.now() - coreCache.at < 8000) return coreCache.value;
    const value = await store.core(); coreCache = { at: Date.now(), store, value }; return value;
  }
  const bust = () => { coreCache = null; };

  /* ---------- Regras de negócio ---------- */
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const endMin = a => toMin(a.time) + a.duration;
  const isBlocking = a => !['cancelled', 'no_show'].includes(a.status);
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);

  function selectedServices(db, ids) {
    const unique = [...new Set(Array.isArray(ids) ? ids : [])];
    return unique.map(id => db.services.find(s => s.id === id)).filter(s => s && s.active && s.price !== null && s.duration !== null);
  }
  function bookingTotals(db, ids) {
    const services = selectedServices(db, ids);
    return { services, total: money(services.reduce((n, s) => n + s.price, 0)), duration: services.reduce((n, s) => n + s.duration, 0) };
  }
  function selectedProducts(db, ids) {
    const unique = [...new Set(Array.isArray(ids) ? ids : [])];
    return unique.map(id => (db.products || []).find(p => p.id === id)).filter(p => p && p.active && p.price !== null && p.price !== undefined);
  }
  function conflicts(db, date, time, duration, ignoreId) {
    const start = toMin(time), end = start + duration;
    return db.appointments.some(a => a.id !== ignoreId && a.date === date && isBlocking(a) && start < endMin(a) && end > toMin(a.time));
  }
  function availability(db, date, ids, ignoreId) {
    if (!validDate(date)) return [];
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    const cfg = db.hours.find(h => h.day === day);
    const { duration } = bookingTotals(db, ids);
    if (!cfg || !cfg.active || !duration) return [];
    const open = toMin(cfg.open), close = toMin(cfg.close);
    const now = new Date(), today = dateISO(now), nowMin = now.getHours() * 60 + now.getMinutes();
    const step = (db.config && db.config.slotInterval) || 10;
    const slots = [];
    for (let c = open; c + duration <= close; c += step) {
      const passed = date < today || (date === today && c <= nowMin);
      if (!passed && !conflicts(db, date, toTime(c), duration, ignoreId)) slots.push(toTime(c));
    }
    return slots;
  }
  // serviços apagados do catálogo: o agendamento guarda nome, valor e duração, então ele segue reagendável
  const withSnapshot = (db, appt) => {
    if (!appt) return db;
    const known = new Set(db.services.map(x => x.id));
    return { ...db, services: [...db.services, ...(appt.services || []).filter(x => !known.has(x.id)).map(x => ({ ...x, active: true }))] };
  };
  function validateBooking(db, body, ignoreId) {
    const customerName = String(body.customerName || '').trim().slice(0, 80);
    const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 15);
    const date = String(body.date || ''), time = String(body.time || '');
    const totals = bookingTotals(db, body.serviceIds);
    if (customerName.length < 2) return { error: 'Informe o nome completo.' };
    if (phone.length < 10) return { error: 'Informe um WhatsApp válido com DDD.' };
    if (!totals.services.length) return { error: 'Selecione ao menos um serviço disponível.' };
    if (!availability(db, date, totals.services.map(s => s.id), ignoreId).includes(time)) return { error: 'Este horário não está mais disponível.' };
    const products = selectedProducts(db, body.productIds);
    const productsTotal = money(products.reduce((n, p) => n + p.price, 0));
    return { customerName, phone, date, time, ...totals, products, total: money(totals.total + productsTotal) };
  }

  /* Modelo do plano mensal (config/business.monthlyPlan): o que o cliente vê e personaliza no site */
  const PLAN_DEFAULTS = { enabled: false, name: 'Plano Mensal', description: '', monthlyValue: 0, includedCuts: 4, extraCutValue: 0, dependentValue: 0, maxDependents: 3 };
  const planNum = (v, fallback) => (v === null || v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0) ? fallback : money(v);
  const planInt = (v, fallback) => (v === null || v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0) ? fallback : Math.floor(Number(v));
  const normalizePlan = p => { const o = p || {}; return {
    enabled: Boolean(o.enabled), name: String(o.name || PLAN_DEFAULTS.name).slice(0, 60), description: String(o.description || '').slice(0, 200),
    monthlyValue: planNum(o.monthlyValue, 0), includedCuts: Math.max(1, planInt(o.includedCuts, PLAN_DEFAULTS.includedCuts)),
    extraCutValue: planNum(o.extraCutValue, 0), dependentValue: planNum(o.dependentValue, 0), maxDependents: planInt(o.maxDependents, PLAN_DEFAULTS.maxDependents) }; };

  /* ---------- Assinante: cortes do plano x agendamento ---------- */
  const brl = v => 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',');
  const isSubscriber = c => Boolean(c && c.plan && c.plan.status !== 'pending_payment' && c.plan.active !== false);
  const serviceInPlan = sv => (sv.inPlan === undefined || sv.inPlan === null) ? /corte|cabelo/i.test(sv.name || '') : Boolean(sv.inPlan);
  /* Calcula, para um assinante, quantos cortes do plano o agendamento usa e quanto ainda precisa ser cobrado. */
  function buildQuote(client, cfg, core, body) {
    if (!isSubscriber(client)) return null;
    const plan = client.plan; const date = validDate(String(body.date || '')) ? String(body.date) : dateISO(new Date());
    const services = selectedServices(core, body.serviceIds); const products = selectedProducts(core, body.productIds);
    const productsTotal = money(products.reduce((n, p) => n + p.price, 0));
    const deps = plan.dependents || []; let beneficiary = null;
    if (body.beneficiaryId) { beneficiary = deps.find(d => d.id === body.beneficiaryId); if (!beneficiary) return { error: 'Dependente não encontrado.' }; }
    const limit = plan.cutsPerMonth || 0; const month = date.slice(0, 7);
    const usedBefore = (plan.cuts || []).filter(c => String(c.date).slice(0, 7) === month).length;
    const available = Math.max(0, limit - usedBefore);
    const unit = plan.extraCutValue > 0 ? plan.extraCutValue : (cfg.extraCutValue > 0 ? cfg.extraCutValue : null); // sem valor configurado: vale o preço normal
    let left = available;
    const lines = services.map(sv => {
      const base = { id: sv.id, name: sv.name, price: sv.price };
      if (!serviceInPlan(sv)) return { ...base, eligible: false, covered: false, charge: sv.price };
      if (left > 0) { left--; return { ...base, eligible: true, covered: true, charge: 0 }; }
      return { ...base, eligible: true, covered: false, charge: money(unit ?? sv.price) };
    });
    const eligible = lines.filter(l => l.eligible).length, covered = lines.filter(l => l.covered).length, extra = eligible - covered;
    const extraCharge = money(lines.filter(l => l.eligible && !l.covered).reduce((n, l) => n + l.charge, 0));
    const servicesTotal = money(lines.reduce((n, l) => n + l.charge, 0));
    const usedAfter = usedBefore + eligible, remainingAfter = Math.max(0, limit - usedAfter);
    const planName = plan.planName || 'Plano mensal';
    const text = [`Plano mensal: ${planName} (assinante)`,
      beneficiary ? `Corte para: ${beneficiary.name} (dependente)` : null,
      !eligible ? 'Este agendamento não usa corte do plano.' : null,
      eligible && !available ? 'Os cortes do plano deste mês já acabaram.' : null,
      eligible ? `Cortes do mês: ${Math.min(usedAfter, limit)} de ${limit} usados (restam ${remainingAfter})` : null,
      covered ? `Incluso no plano neste agendamento: ${covered} ${covered === 1 ? 'corte' : 'cortes'} (${brl(0)})` : null,
      extra ? `Corte adicional: ${extra} x ${brl(extraCharge / extra)} = ${brl(extraCharge)} a pagar` : null].filter(Boolean).join('\n');
    return { subscriber: true, planName, limit, usedBefore, usedAfter, available, remainingAfter, eligible, covered, extra, extraCharge, unit, lines,
      servicesTotal, productsTotal, total: money(servicesTotal + productsTotal), beneficiary: beneficiary ? { id: beneficiary.id, name: beneficiary.name } : null,
      dependents: deps.map(d => ({ id: d.id, name: d.name })), text };
  }

  async function syncPlanCuts(store, appt, action) {
    const c = await store.getClient(appt.clientId); if (!c || !c.plan) return;
    const ids = new Set(appt.planCuts.map(x => x.id));
    c.plan.cuts = (c.plan.cuts || []).filter(x => !ids.has(x.id));
    if (action === 'restore') c.plan.cuts.push(...appt.planCuts.map(x => ({ ...x, date: appt.date })));
    await store.saveClient(c);
  }

  const ok = (data, status = 200) => ({ status, data });
  const fail = (status, error) => ({ status, data: { error } });
  const stamp = a => `${a.date}${a.time}`;

  /* ---------- Roteador (mesmas rotas /api/... usadas pelo app.js) ---------- */
  async function handle(rawUrl, options = {}) {
    try { return await route(rawUrl, options); }
    catch (e) { console.error(e); return fail(500, 'Não foi possível concluir a operação. Verifique a conexão e tente novamente.'); }
  }

  async function route(rawUrl, options) {
    const url = new URL(rawUrl, 'http://local');
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    const store = await init();
    let m;

    if (method === 'GET' && url.pathname === '/api/state') {
      const core = await getCore(store, true);
      const appointments = url.searchParams.get('appointments') === '1' ? (await store.listAppointments()).sort((a, b) => stamp(a).localeCompare(stamp(b))) : [];
      const clients = url.searchParams.get('appointments') === '1' ? await store.listClients() : [];
      const admin = url.searchParams.get('appointments') === '1';
      const products = admin ? core.products : (core.products || []).map(({ cost, ...p }) => p);
      const services = admin ? core.services : core.services.map(({ cost, ...x }) => x);
      return ok({ ...core, services, config: { ...core.config, monthlyPlan: normalizePlan(core.config && core.config.monthlyPlan) }, products, appointments, clients });
    }

    /* Busca de cliente pelo telefone (agendamento): devolve só o nome, nada além disso. */
    if (method === 'GET' && url.pathname === '/api/client') {
      const key = phoneKey(url.searchParams.get('phone'));
      if (key.length < 10) return ok({ client: null });
      const c = await store.getClient(key);
      const sub = isSubscriber(c);
      return ok({ client: c && c.name ? { name: c.name, subscriber: sub, planName: sub ? (c.plan.planName || 'Plano mensal') : null } : null });
    }

    /* Prévia do agendamento para assinantes: cortes restantes, valor zerado ou cobrança do corte adicional. */
    if (method === 'GET' && url.pathname === '/api/plan-quote') {
      const key = phoneKey(url.searchParams.get('phone'));
      if (key.length < 10) return ok({ subscriber: false });
      const [core, c] = await Promise.all([getCore(store, true), store.getClient(key)]);
      const q = buildQuote(c, normalizePlan(core.config && core.config.monthlyPlan), core, {
        serviceIds: (url.searchParams.get('services') || '').split(',').filter(Boolean), productIds: (url.searchParams.get('products') || '').split(',').filter(Boolean),
        date: url.searchParams.get('date'), beneficiaryId: url.searchParams.get('beneficiary') || '' });
      if (!q) return ok({ subscriber: false });
      if (q.error) return fail(422, q.error);
      return ok(q);
    }

    if (method === 'GET' && url.pathname === '/api/sync') return ok({ version: await store.version() });

    if (method === 'GET' && url.pathname === '/api/availability') {
      const date = url.searchParams.get('date') || '';
      const ids = (url.searchParams.get('services') || '').split(',').filter(Boolean);
      const [core, appointments] = await Promise.all([getCore(store), validDate(date) ? store.appointmentsByDate(date) : []]);
      const ignoreId = url.searchParams.get('ignoreId'); const current = ignoreId ? await store.getAppointment(ignoreId) : null;
      return ok({ slots: availability(withSnapshot({ ...core, appointments }, current), date, ids, ignoreId) });
    }

    if (method === 'POST' && url.pathname === '/api/appointments') {
      const date = String(body.date || '');
      const [core, appointments] = await Promise.all([getCore(store, true), validDate(date) ? store.appointmentsByDate(date) : []]);
      const v = validateBooking({ ...core, appointments }, body, null);
      if (v.error) return fail(422, v.error);
      const clientId = phoneKey(v.phone); const apptId = uuid(); const nowIso = new Date().toISOString();
      const q = buildQuote(await store.getClient(clientId), normalizePlan(core.config && core.config.monthlyPlan), core, { serviceIds: body.serviceIds, productIds: body.productIds, date: v.date, beneficiaryId: body.beneficiaryId || '' });
      if (q && q.error) return fail(422, q.error);
      const planCuts = q ? q.lines.filter(l => l.eligible).map(l => ({ id: uuid(), date: v.date, time: v.time, dependentId: q.beneficiary ? q.beneficiary.id : null, dependentName: q.beneficiary ? q.beneficiary.name : null,
        createdAt: nowIso, appointmentId: apptId, serviceName: l.name, kind: l.covered ? 'included' : 'extra', charge: l.charge, source: 'booking' })) : [];
      const appointment = {
        id: apptId, clientId, customerName: v.customerName, phone: v.phone, date: v.date, time: v.time,
        serviceIds: v.services.map(sv => sv.id),
        services: v.services.map(({ id, name, price, duration, cost }) => {
          const l = q && q.lines.find(x => x.id === id);
          return { id, name, price, duration, cost: cost ?? null, ...(l ? { planCovered: l.covered, charge: l.charge } : {}) };
        }),
        productIds: v.products.map(p => p.id),
        products: v.products.map(({ id, name, price, cost }) => ({ id, name, price, cost: cost ?? null })),
        total: q ? q.total : v.total, duration: v.duration, status: 'pending_confirmation',
        createdAt: nowIso, history: []
      };
      if (q) {
        appointment.planInfo = { planName: q.planName, limit: q.limit, usedBefore: q.usedBefore, usedAfter: q.usedAfter, remainingAfter: q.remainingAfter, eligible: q.eligible, covered: q.covered, extra: q.extra,
          extraCharge: q.extraCharge, listTotal: v.total, beneficiaryName: q.beneficiary ? q.beneficiary.name : null, text: q.text };
        appointment.planCuts = planCuts;
      }
      await store.createAppointment(appointment);
      if (planCuts.length) { const c = await store.getClient(clientId); if (c && c.plan) { c.plan.cuts = [...(c.plan.cuts || []), ...planCuts]; await store.saveClient(c); } }
      return ok({ appointment, whatsapp: core.config.whatsapp }, 201);
    }

    if ((m = url.pathname.match(/^\/api\/appointments\/([^/]+)\/(status|reschedule)$/)) && method === 'PATCH') {
      const appt = await store.getAppointment(m[1]);
      if (!appt) return fail(404, 'Agendamento não encontrado.');
      appt.history = appt.history || [];
      let changed;
      if (m[2] === 'status') {
        if (!['pending_confirmation', 'scheduled', 'attended', 'no_show'].includes(body.status)) return fail(422, 'Status inválido.');
        const prevStatus = appt.status;
        appt.history.push({ type: 'status', from: appt.status, to: body.status, at: new Date().toISOString() });
        appt.status = body.status; changed = ['status', 'history'];
        if ((appt.planCuts || []).length) { // desistência devolve o corte ao plano; desfazer a desistência volta a contá-lo
          if (body.status === 'no_show' && prevStatus !== 'no_show') await syncPlanCuts(store, appt, 'release');
          else if (prevStatus === 'no_show' && body.status !== 'no_show') await syncPlanCuts(store, appt, 'restore');
        }
      } else {
        const date = String(body.date || '');
        const [core, appointments] = await Promise.all([getCore(store, true), validDate(date) ? store.appointmentsByDate(date) : []]);
        const v = validateBooking(withSnapshot({ ...core, appointments }, appt), { ...appt, date: body.date, time: body.time }, appt.id);
        if (v.error) return fail(422, v.error);
        appt.history.push({ type: 'reschedule', date: appt.date, time: appt.time, at: new Date().toISOString() });
        appt.date = v.date; appt.time = v.time; appt.status = 'rescheduled'; changed = ['date', 'time', 'status', 'history'];
        if ((appt.planCuts || []).length) { appt.planCuts = appt.planCuts.map(x => ({ ...x, date: appt.date, time: appt.time })); changed.push('planCuts'); await syncPlanCuts(store, appt, 'restore'); }
      }
      await store.updateAppointment(appt, changed);
      return ok({ appointment: appt });
    }

    if ((m = url.pathname.match(/^\/api\/services(?:\/([^/]+))?$/)) && ['POST', 'PUT'].includes(method)) {
      const core = await getCore(store, true);
      const target = m[1] ? core.services.find(s => s.id === m[1]) : null;
      if (method === 'PUT' && !target) return fail(404, 'Serviço não encontrado.');
      const service = target || { id: uuid(), description: '', order: Math.max(-1, ...core.services.map((s, i) => s.order ?? i)) + 1 };
      service.name = String(body.name || service.name || '').trim().slice(0, 80);
      service.description = String(body.description ?? service.description ?? '').trim().slice(0, 160);
      service.price = body.price === null || body.price === '' ? null : money(body.price);
      service.duration = body.duration === null || body.duration === '' ? null : Math.max(5, Number(body.duration));
      service.cost = (body.cost === null || body.cost === undefined || body.cost === '' || isNaN(Number(body.cost)) || Number(body.cost) < 0) ? null : money(body.cost);
      if (body.inPlan !== undefined) service.inPlan = Boolean(body.inPlan);
      service.active = Boolean(body.active) && service.price !== null && service.duration !== null;
      if (!service.name) return fail(422, 'Informe o nome do serviço.');
      if (!target && (service.price === null || service.duration === null)) return fail(422, 'Informe o valor do serviço.');
      await store.saveService(service); bust();
      return ok({ service }, target ? 200 : 201);
    }

    if ((m = url.pathname.match(/^\/api\/(services|products)\/([^/]+)$/)) && method === 'DELETE') {
      const core = await getCore(store, true);
      const isService = m[1] === 'services';
      if (!(isService ? core.services : core.products || []).some(x => x.id === m[2])) return fail(404, isService ? 'Serviço não encontrado.' : 'Produto não encontrado.');
      await (isService ? store.deleteService(m[2]) : store.deleteProduct(m[2])); bust();
      return ok({ deleted: m[2] });
    }

    if ((m = url.pathname.match(/^\/api\/products(?:\/([^/]+))?$/)) && ['POST', 'PUT'].includes(method)) {
      const core = await getCore(store, true);
      const list = core.products || [];
      const target = m[1] ? list.find(p => p.id === m[1]) : null;
      if (method === 'PUT' && !target) return fail(404, 'Produto não encontrado.');
      const product = target || { id: uuid(), order: Math.max(-1, ...list.map((p, i) => p.order ?? i)) + 1 };
      const num = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0) ? null : money(v);
      product.name = String(body.name ?? product.name ?? '').trim().slice(0, 80);
      product.description = String(body.description ?? product.description ?? '').trim().slice(0, 200);
      product.cost = num(body.cost);
      product.price = num(body.price);
      if (!product.name) return fail(422, 'Informe o nome do produto.');
      if (product.price === null) return fail(422, 'Informe o valor de venda.');
      if (product.cost === null) return fail(422, 'Informe o valor de custo.');
      product.quantity = (body.quantity === null || body.quantity === undefined || body.quantity === '' || isNaN(Number(body.quantity)) || Number(body.quantity) < 0) ? null : Math.floor(Number(body.quantity));
      product.active = body.active === undefined ? true : Boolean(body.active);
      await store.saveProduct(product); bust();
      return ok({ product }, target ? 200 : 201);
    }

    /* ---------- Modelo do plano mensal (aba Serviços do painel -> box do site) ---------- */
    if (method === 'PUT' && url.pathname === '/api/plan-config') {
      const plan = normalizePlan({ ...body, enabled: Boolean(body.enabled) });
      const strict = (v, label) => (v === null || v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0) ? `Informe ${label}.` : null;
      const err = strict(body.monthlyValue, 'o valor mensal do plano') || strict(body.includedCuts, 'a quantidade mínima de cortes') || strict(body.extraCutValue, 'o valor de cada corte adicional') || strict(body.dependentValue, 'o valor adicional por dependente') || strict(body.maxDependents, 'o máximo de dependentes');
      if (err) return fail(422, err);
      if (Number(body.includedCuts) < 1) return fail(422, 'A quantidade mínima de cortes deve ser pelo menos 1.');
      if (!String(body.name || '').trim()) return fail(422, 'Informe o nome do plano.');
      plan.name = String(body.name).trim().slice(0, 60);
      await store.saveMonthlyPlan(plan); bust();
      return ok({ plan });
    }

    /* ---------- Plano mensal (fica dentro do cadastro do cliente) ---------- */
    if ((m = url.pathname.match(/^\/api\/clients\/(\d+)\/plan$/)) && method === 'PUT') {
      const key = m[1]; const now = new Date().toISOString();
      const name = String(body.name || '').trim().slice(0, 80);
      const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 15);
      const val = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0) ? null : money(v);
      const int = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) || Number(v) < 0) ? null : Math.floor(Number(v));
      if (name.length < 2) return fail(422, 'Informe o nome do usuário.');
      if (key.length < 10 || phoneKey(phone) !== key) return fail(422, 'Informe um telefone válido com DDD.');
      const monthlyValue = val(body.monthlyValue), planValue = val(body.planValue === '' ? body.monthlyValue : body.planValue);
      const cutsPerMonth = int(body.cutsPerMonth), dependentsAllowed = int(body.dependentsAllowed ?? 0);
      if (monthlyValue === null) return fail(422, 'Informe o valor do plano mensal.');
      if (planValue === null) return fail(422, 'Informe o valor do plano.');
      if (cutsPerMonth === null) return fail(422, 'Informe a quantidade de cortes no mês.');
      if (dependentsAllowed === null) return fail(422, 'Informe a quantidade de dependentes.');
      const dependents = (Array.isArray(body.dependents) ? body.dependents : []).map(d => ({ id: String(d.id || uuid()).slice(0, 60), name: String(d.name || '').trim().slice(0, 80), phone: String(d.phone || '').replace(/\D/g, '').slice(0, 15) })).filter(d => d.name).slice(0, 30);
      if (dependents.some(d => d.phone && d.phone.length < 10)) return fail(422, 'Informe um WhatsApp válido com DDD para o dependente.');
      if (dependents.length > dependentsAllowed) return fail(422, 'Há mais dependentes cadastrados do que a quantidade permitida no plano.');
      const old = await store.getClient(key); const prev = old && old.plan;
      const client = { ...(old || {}), id: key, name, phone, firstBookingAt: (old && old.firstBookingAt) || now, lastBookingAt: (old && old.lastBookingAt) || null,
        plan: { ...(prev || {}), active: body.active === undefined ? !(prev && prev.active === false) : Boolean(body.active), monthlyValue, planValue, cutsPerMonth, dependentsAllowed, dependents,
          cuts: (prev && prev.cuts) || [], startedAt: (prev && prev.startedAt) || (prev && prev.status === 'pending_payment' ? null : now.slice(0, 10)), updatedAt: now } };
      await store.saveClient(client);
      return ok({ client }, prev ? 200 : 201);
    }

    /* ---------- Assinatura pelo site: cai em Planos mensais como "aguardando pagamento" ---------- */
    if (method === 'POST' && url.pathname === '/api/plan-requests') {
      const core = await getCore(store, true);
      const cfg = normalizePlan(core.config && core.config.monthlyPlan);
      if (!cfg.enabled || cfg.monthlyValue <= 0) return fail(422, 'O plano mensal não está disponível no momento.');
      const name = String(body.name || '').trim().slice(0, 80);
      const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 15); const key = phoneKey(phone);
      if (name.length < 2) return fail(422, 'Informe o nome completo.');
      if (key.length < 10) return fail(422, 'Informe um WhatsApp válido com DDD.');
      const cuts = planInt(body.cuts, null);
      if (cuts === null || cuts < cfg.includedCuts || cuts > 60) return fail(422, `Escolha entre ${cfg.includedCuts} e 60 cortes por mês.`);
      const rawDeps = Array.isArray(body.dependents) ? body.dependents : [];
      if (rawDeps.length > cfg.maxDependents) return fail(422, `Este plano aceita até ${cfg.maxDependents} dependentes.`);
      if (rawDeps.some(d => String(d.name || '').trim().length < 2)) return fail(422, 'Informe o nome de cada dependente.');
      const dependents = rawDeps.map(d => ({ id: uuid(), name: String(d.name).trim().slice(0, 80), phone: String(d.phone || '').replace(/\D/g, '').slice(0, 15) }));
      if (dependents.some(d => d.phone && d.phone.length < 10)) return fail(422, 'Informe um WhatsApp válido com DDD para o dependente (ou deixe em branco).');
      const extra = cuts - cfg.includedCuts;
      const planValue = money(cfg.monthlyValue + dependents.length * cfg.dependentValue + extra * cfg.extraCutValue);
      const old = await store.getClient(key); const prev = old && old.plan; const now = new Date().toISOString();
      if (prev && prev.status !== 'pending_payment' && prev.active !== false) return fail(409, 'Este WhatsApp já possui um plano mensal ativo. Fale com a barbearia pelo WhatsApp para alterar.');
      const client = { ...(old || {}), id: key, name: (old && old.name) || name, phone, firstBookingAt: (old && old.firstBookingAt) || now, lastBookingAt: (old && old.lastBookingAt) || null,
        plan: { ...(prev || {}), active: false, status: 'pending_payment', source: 'site', planName: cfg.name, monthlyValue: cfg.monthlyValue, planValue, cutsPerMonth: cuts, includedCuts: cfg.includedCuts,
          extraCutValue: cfg.extraCutValue, dependentValue: cfg.dependentValue, dependentsAllowed: dependents.length, dependents, cuts: (prev && prev.cuts) || [],
          startedAt: (prev && prev.startedAt) || null, requestedAt: now, updatedAt: now } };
      await store.saveClient(client);
      return ok({ client, whatsapp: core.config.whatsapp, planValue }, 201);
    }

    /* Admin: confirma o pagamento (ativa) ou recusa o pedido */
    if ((m = url.pathname.match(/^\/api\/clients\/(\d+)\/plan\/(confirm|reject)$/)) && method === 'POST') {
      const old = await store.getClient(m[1]);
      if (!old || !old.plan || old.plan.status !== 'pending_payment') return fail(404, 'Não há plano aguardando pagamento para este cliente.');
      const plan = old.plan; const now = new Date().toISOString();
      if (m[2] === 'confirm') {
        plan.status = 'active'; plan.active = true; plan.paidAt = now; plan.startedAt = dateISO(new Date()); plan.updatedAt = now;
      } else if ((plan.cuts || []).length) { delete plan.status; plan.active = false; plan.updatedAt = now; }
      else delete old.plan;
      await store.saveClient(old);
      return ok({ client: old, removed: !old.plan });
    }

    if ((m = url.pathname.match(/^\/api\/clients\/(\d+)\/plan\/cuts(?:\/([^/]+))?$/)) && ['POST', 'DELETE'].includes(method)) {
      const old = await store.getClient(m[1]);
      if (!old || !old.plan) return fail(404, 'Plano não encontrado.');
      const plan = old.plan; plan.cuts = plan.cuts || [];
      if (method === 'DELETE') {
        if (!plan.cuts.some(c => c.id === m[2])) return fail(404, 'Corte não encontrado.');
        plan.cuts = plan.cuts.filter(c => c.id !== m[2]); await store.saveClient(old);
        return ok({ client: old });
      }
      if (plan.status === 'pending_payment') return fail(422, 'Este plano aguarda a confirmação do pagamento.');
      if (plan.active === false) return fail(422, 'Este plano está inativo.');
      const date = String(body.date || '');
      if (!validDate(date)) return fail(422, 'Informe a data do corte.');
      let dependent = null;
      if (body.dependentId) { dependent = (plan.dependents || []).find(d => d.id === body.dependentId); if (!dependent) return fail(422, 'Dependente não encontrado.'); }
      const cut = { id: uuid(), date, dependentId: dependent ? dependent.id : null, dependentName: dependent ? dependent.name : null, createdAt: new Date().toISOString() };
      plan.cuts.push(cut); await store.saveClient(old);
      const overLimit = plan.cuts.filter(c => c.date.slice(0, 7) === date.slice(0, 7)).length > plan.cutsPerMonth;
      return ok({ client: old, cut, overLimit }, 201);
    }

    if ((m = url.pathname.match(/^\/api\/hours\/(\d)$/)) && method === 'PUT') {
      const core = await getCore(store, true);
      const item = core.hours.find(h => h.day === Number(m[1]));
      if (!item) return fail(404, 'Dia não encontrado.');
      const t = /^\d{2}:\d{2}$/;
      if (body.active && (!t.test(body.open) || !t.test(body.close) || toMin(body.open) >= toMin(body.close))) return fail(422, 'Horário de funcionamento inválido.');
      item.active = Boolean(body.active);
      item.open = body.open || item.open;
      item.close = body.close || item.close;
      await store.saveHour(item); bust();
      return ok({ hours: item });
    }

    if (method === 'POST' && url.pathname === '/api/reset') {
      if (body.confirm !== 'ZERAR') return fail(422, 'Digite ZERAR para confirmar.');
      const removed = await store.resetData();
      try { localStorage.removeItem(LOCAL_KEY); } catch (e) { /* ignore */ }
      return ok({ removed });
    }

    return fail(404, 'Rota não encontrada.');
  }
})();
