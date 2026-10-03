/* Camada de dados do navegador (substitui o server.js).
   Banco: Firestore, uma coleção para cada tipo de informação:

     config/business        -> dados do negócio (nome, WhatsApp, intervalo dos horários)
     services/{id}          -> um documento por serviço
     hours/{0..6}           -> um documento por dia da semana (0 = domingo)
     appointments/{id}      -> um documento por agendamento
     clients/{telefone}     -> um documento por cliente
     meta/sync              -> marcador de última mudança (o painel lê só este documento para saber se há novidade)

   O sistema nasce zerado: sem agendamentos e sem clientes. Só são criados os serviços e horários
   padrão (editáveis no painel). Se o Firestore estiver indisponível, cai para localStorage. */
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
    const services = [
      { id: 'corte', name: 'Corte', price: 35, duration: 40, active: true, description: 'Corte personalizado e finalização.' },
      { id: 'barba', name: 'Barba', price: 35, duration: 30, active: true, description: 'Toalha quente, desenho e acabamento.' },
      { id: 'combo', name: 'Corte e Barba', price: 70, duration: 75, active: true, featured: true, description: 'Combo completo com sobrancelha de cortesia.' },
      { id: 'sobrancelha', name: 'Sobrancelha', price: 15, duration: 5, active: true, description: 'Alinhamento e acabamento.' },
      { id: 'pezinho', name: 'Pezinho', price: null, duration: null, active: false, description: 'Acabamento de contorno.' },
      { id: 'progressiva', name: 'Progressiva', price: 90, duration: 120, active: true, description: 'Alinhamento e redução de volume.' },
      { id: 'platinado', name: 'Platinado', price: 140, duration: 120, active: true, description: 'Descoloração e tonalização completa.' },
      { id: 'luzes', name: 'Luzes', price: 120, duration: 120, active: true, description: 'Luzes personalizadas e tonalização.' },
      { id: 'depilacao', name: 'Nariz e orelha', price: 25, duration: 30, active: true, description: 'Depilação com acabamento cuidadoso.' },
      { id: 'pele', name: 'Limpeza de pele', price: 30, duration: 30, active: true, description: 'Higienização e cuidado facial.' }
    ];
    const labels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const hours = labels.map((label, day) => ({ day, label, active: true, open: '10:00', close: day === 0 ? '13:00' : '20:00' }));
    return { config: { businessName: 'Willzinho Barber', whatsapp: '5541999901208', slotInterval: 10 }, services, hours, appointments: [] };
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
      const [config, services, hours] = await Promise.all([fs.get('config', 'business'), fs.list('services'), fs.list('hours')]);
      return { config: config || initialData().config, services: byOrder(services), hours: hours.sort((a, b) => a.day - b.day) };
    },
    listAppointments: () => fs.list('appointments'),
    appointmentsByDate: date => fs.whereEq('appointments', 'date', date),
    getAppointment: id => fs.get('appointments', id),
    async createAppointment(appt) {
      const key = appt.clientId; const now = new Date().toISOString();
      const writes = [{ col: 'appointments', id: appt.id, data: appt, mustNotExist: true }, touch()];
      if (key) {
        const old = await fs.get('clients', key);
        writes.push({ col: 'clients', id: key, data: { id: key, name: appt.customerName, phone: appt.phone, firstBookingAt: (old && old.firstBookingAt) || now, lastBookingAt: now } });
      }
      await fs.commit(writes);
    },
    async updateAppointment(appt, keys) {
      await fs.update('appointments', appt.id, Object.fromEntries(keys.map(k => [k, appt[k]])));
      await fs.set('meta', 'sync', { updatedAt: Date.now() });
    },
    async version() { const d = await fs.get('meta', 'sync'); return d ? String(d.updatedAt) : '0'; },
    saveService: s => fs.set('services', s.id, s),
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
    db() { let db = readLocal(); if (!db) { db = initialData(); writeLocal(db); } db.appointments = db.appointments || []; return db; },
    async core() { const d = this.db(); return { config: d.config, services: byOrder(d.services), hours: d.hours }; },
    async listAppointments() { return this.db().appointments; },
    async appointmentsByDate(date) { return this.db().appointments.filter(a => a.date === date); },
    async getAppointment(id) { return this.db().appointments.find(a => a.id === id) || null; },
    async createAppointment(appt) { const d = this.db(); d.appointments.push(appt); d.syncAt = Date.now(); writeLocal(d); },
    async updateAppointment(appt) { const d = this.db(); const i = d.appointments.findIndex(a => a.id === appt.id); if (i >= 0) d.appointments[i] = appt; d.syncAt = Date.now(); writeLocal(d); },
    async saveService(s) { const d = this.db(); const i = d.services.findIndex(x => x.id === s.id); if (i >= 0) d.services[i] = s; else d.services.push(s); writeLocal(d); },
    async saveHour(h) { const d = this.db(); const i = d.hours.findIndex(x => x.day === h.day); if (i >= 0) d.hours[i] = h; writeLocal(d); },
    async resetData() { const d = this.db(); const n = d.appointments.length; d.appointments = []; d.syncAt = Date.now(); writeLocal(d); return { appointments: n, clients: 0 }; },
    async version() { return String(this.db().syncAt || 0); }
  };

  /* ---------- Primeiro acesso: cria as coleções vazias (serviços e horários padrão) ---------- */
  async function seed() {
    const data = initialData(); const writes = [];
    data.services.forEach((s, i) => writes.push({ col: 'services', id: s.id, data: { ...s, order: i } }));
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
    if (unique.includes('combo')) {
      ['corte', 'barba', 'sobrancelha'].forEach(id => { const i = unique.indexOf(id); if (i >= 0) unique.splice(i, 1); });
    }
    return unique.map(id => db.services.find(s => s.id === id)).filter(s => s && s.active && s.price !== null && s.duration !== null);
  }
  function bookingTotals(db, ids) {
    const services = selectedServices(db, ids);
    return { services, total: money(services.reduce((n, s) => n + s.price, 0)), duration: services.reduce((n, s) => n + s.duration, 0) };
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
  function validateBooking(db, body, ignoreId) {
    const customerName = String(body.customerName || '').trim().slice(0, 80);
    const phone = String(body.phone || '').replace(/\D/g, '').slice(0, 15);
    const date = String(body.date || ''), time = String(body.time || '');
    const totals = bookingTotals(db, body.serviceIds);
    if (customerName.length < 2) return { error: 'Informe o nome completo.' };
    if (phone.length < 10) return { error: 'Informe um WhatsApp válido com DDD.' };
    if (!totals.services.length) return { error: 'Selecione ao menos um serviço disponível.' };
    if (!availability(db, date, totals.services.map(s => s.id), ignoreId).includes(time)) return { error: 'Este horário não está mais disponível.' };
    return { customerName, phone, date, time, ...totals };
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
      return ok({ ...core, appointments });
    }

    if (method === 'GET' && url.pathname === '/api/sync') return ok({ version: await store.version() });

    if (method === 'GET' && url.pathname === '/api/availability') {
      const date = url.searchParams.get('date') || '';
      const ids = (url.searchParams.get('services') || '').split(',').filter(Boolean);
      const [core, appointments] = await Promise.all([getCore(store), validDate(date) ? store.appointmentsByDate(date) : []]);
      return ok({ slots: availability({ ...core, appointments }, date, ids, url.searchParams.get('ignoreId')) });
    }

    if (method === 'POST' && url.pathname === '/api/appointments') {
      const date = String(body.date || '');
      const [core, appointments] = await Promise.all([getCore(store, true), validDate(date) ? store.appointmentsByDate(date) : []]);
      const v = validateBooking({ ...core, appointments }, body, null);
      if (v.error) return fail(422, v.error);
      const appointment = {
        id: uuid(), clientId: phoneKey(v.phone), customerName: v.customerName, phone: v.phone, date: v.date, time: v.time,
        serviceIds: v.services.map(s => s.id),
        services: v.services.map(({ id, name, price, duration }) => ({ id, name, price, duration })),
        total: v.total, duration: v.duration, status: 'pending_confirmation',
        createdAt: new Date().toISOString(), history: []
      };
      await store.createAppointment(appointment);
      return ok({ appointment, whatsapp: core.config.whatsapp }, 201);
    }

    if ((m = url.pathname.match(/^\/api\/appointments\/([^/]+)\/(status|reschedule)$/)) && method === 'PATCH') {
      const appt = await store.getAppointment(m[1]);
      if (!appt) return fail(404, 'Agendamento não encontrado.');
      appt.history = appt.history || [];
      let changed;
      if (m[2] === 'status') {
        if (!['pending_confirmation', 'scheduled', 'attended', 'no_show'].includes(body.status)) return fail(422, 'Status inválido.');
        appt.history.push({ type: 'status', from: appt.status, to: body.status, at: new Date().toISOString() });
        appt.status = body.status; changed = ['status', 'history'];
      } else {
        const date = String(body.date || '');
        const [core, appointments] = await Promise.all([getCore(store, true), validDate(date) ? store.appointmentsByDate(date) : []]);
        const v = validateBooking({ ...core, appointments }, { ...appt, date: body.date, time: body.time }, appt.id);
        if (v.error) return fail(422, v.error);
        appt.history.push({ type: 'reschedule', date: appt.date, time: appt.time, at: new Date().toISOString() });
        appt.date = v.date; appt.time = v.time; appt.status = 'rescheduled'; changed = ['date', 'time', 'status', 'history'];
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
      service.active = Boolean(body.active) && service.price !== null && service.duration !== null;
      if (!service.name) return fail(422, 'Informe o nome do serviço.');
      await store.saveService(service); bust();
      return ok({ service }, target ? 200 : 201);
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
