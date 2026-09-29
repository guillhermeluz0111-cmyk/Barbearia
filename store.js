/* Substitui o server.js: roda no navegador e usa o Firestore direto (REST).
   Se o Firestore recusar/estiver indisponível, cai para localStorage. */
(function () {
  const PROJECT_ID = 'barbearia-c80da';
  const API_KEY = 'AIzaSyD0x4MrjdJ_kP3I4-kVsSEFXeiRi1w2-Ws';
  const DOC_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/system/state?key=${API_KEY}`;
  const LOCAL_KEY = 'barbearia-db';

  const Store = { mode: 'firestore', handle };
  window.Store = Store;

  const money = v => Math.round(Number(v) * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const dateISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  function initialData() {
    const today = new Date();
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
    return {
      config: { businessName: 'Willzinho Barber', whatsapp: '5541999901208', slotInterval: 10 },
      services, hours, appointments: []
    };
  }

  /* ---------- Firestore encode/decode ---------- */
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
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, i]) => [k, dec(i)]));
    return null;
  }

  /* ---------- Persistência ---------- */
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { return null; } };
  const writeLocal = db => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } };

  async function writeFirestore(db) {
    const r = await fetch(DOC_URL, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: enc(db).mapValue.fields })
    });
    if (!r.ok) throw new Error('Firestore recusou a gravação (' + r.status + ').');
  }

  async function load() {
    if (Store.mode === 'firestore') {
      try {
        const r = await fetch(DOC_URL, { cache: 'no-store' });
        if (r.ok) {
          const doc = await r.json();
          const db = dec({ mapValue: { fields: doc.fields || {} } });
          writeLocal(db);
          return db;
        }
        if (r.status === 404) {
          const db = readLocal() || initialData();
          await writeFirestore(db);
          return db;
        }
        console.warn('Firestore indisponível (' + r.status + '); usando armazenamento local.');
      } catch (e) {
        console.warn('Firestore indisponível; usando armazenamento local.', e);
      }
      Store.mode = 'local';
    }
    let db = readLocal();
    if (!db) { db = initialData(); writeLocal(db); }
    return db;
  }

  async function save(db) {
    writeLocal(db);
    if (Store.mode === 'firestore') {
      try { await writeFirestore(db); }
      catch (e) { console.warn('Não foi possível sincronizar com o Firestore.', e); Store.mode = 'local'; }
    }
  }

  /* ---------- Regras de negócio (portadas do server.js) ---------- */
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const endMin = a => toMin(a.time) + a.duration;
  const isBlocking = a => !['cancelled', 'no_show'].includes(a.status);

  function selectedServices(db, ids) {
    const unique = [...new Set(Array.isArray(ids) ? ids : [])];
    if (unique.includes('combo')) {
      ['corte', 'barba', 'sobrancelha'].forEach(id => { const i = unique.indexOf(id); if (i >= 0) unique.splice(i, 1); });
    }
    return unique.map(id => db.services.find(s => s.id === id))
      .filter(s => s && s.active && s.price !== null && s.duration !== null);
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
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

  /* ---------- Roteador (mesmas rotas /api/... do server.js) ---------- */
  async function handle(rawUrl, options = {}) {
    const url = new URL(rawUrl, 'http://local');
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    const db = await load();
    db.appointments = db.appointments || [];
    let m;

    if (method === 'GET' && url.pathname === '/api/state') {
      return ok({
        config: db.config, services: db.services, hours: db.hours,
        appointments: db.appointments.slice().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
      });
    }

    if (method === 'GET' && url.pathname === '/api/availability') {
      const ids = (url.searchParams.get('services') || '').split(',').filter(Boolean);
      return ok({ slots: availability(db, url.searchParams.get('date') || '', ids, url.searchParams.get('ignoreId')) });
    }

    if (method === 'POST' && url.pathname === '/api/appointments') {
      const v = validateBooking(db, body, null);
      if (v.error) return fail(422, v.error);
      const appointment = {
        id: uuid(), customerName: v.customerName, phone: v.phone, date: v.date, time: v.time,
        serviceIds: v.services.map(s => s.id),
        services: v.services.map(({ id, name, price, duration }) => ({ id, name, price, duration })),
        total: v.total, duration: v.duration, status: 'pending_confirmation',
        createdAt: new Date().toISOString(), history: []
      };
      db.appointments.push(appointment);
      await save(db);
      return ok({ appointment, whatsapp: db.config.whatsapp }, 201);
    }

    if ((m = url.pathname.match(/^\/api\/appointments\/([^/]+)\/(status|reschedule)$/)) && method === 'PATCH') {
      const appt = db.appointments.find(a => a.id === m[1]);
      if (!appt) return fail(404, 'Agendamento não encontrado.');
      appt.history = appt.history || [];
      if (m[2] === 'status') {
        if (!['pending_confirmation', 'scheduled', 'attended', 'no_show'].includes(body.status)) return fail(422, 'Status inválido.');
        appt.history.push({ type: 'status', from: appt.status, to: body.status, at: new Date().toISOString() });
        appt.status = body.status;
      } else {
        const v = validateBooking(db, { ...appt, date: body.date, time: body.time }, appt.id);
        if (v.error) return fail(422, v.error);
        appt.history.push({ type: 'reschedule', date: appt.date, time: appt.time, at: new Date().toISOString() });
        appt.date = v.date; appt.time = v.time; appt.status = 'rescheduled';
      }
      await save(db);
      return ok({ appointment: appt });
    }

    if ((m = url.pathname.match(/^\/api\/services(?:\/([^/]+))?$/)) && ['POST', 'PUT'].includes(method)) {
      const target = m[1] ? db.services.find(s => s.id === m[1]) : null;
      if (method === 'PUT' && !target) return fail(404, 'Serviço não encontrado.');
      const service = target || { id: uuid(), description: '' };
      service.name = String(body.name || service.name || '').trim().slice(0, 80);
      service.description = String(body.description ?? service.description ?? '').trim().slice(0, 160);
      service.price = body.price === null || body.price === '' ? null : money(body.price);
      service.duration = body.duration === null || body.duration === '' ? null : Math.max(5, Number(body.duration));
      service.active = Boolean(body.active) && service.price !== null && service.duration !== null;
      if (!service.name) return fail(422, 'Informe o nome do serviço.');
      if (!target) db.services.push(service);
      await save(db);
      return ok({ service }, target ? 200 : 201);
    }

    if ((m = url.pathname.match(/^\/api\/hours\/(\d)$/)) && method === 'PUT') {
      const item = db.hours.find(h => h.day === Number(m[1]));
      if (!item) return fail(404, 'Dia não encontrado.');
      const t = /^\d{2}:\d{2}$/;
      if (body.active && (!t.test(body.open) || !t.test(body.close) || toMin(body.open) >= toMin(body.close))) return fail(422, 'Horário de funcionamento inválido.');
      item.active = Boolean(body.active);
      item.open = body.open || item.open;
      item.close = body.close || item.close;
      await save(db);
      return ok({ hours: item });
    }

    return fail(404, 'Rota não encontrada.');
  }
})();
