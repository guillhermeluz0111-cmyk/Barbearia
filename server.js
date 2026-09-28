const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');
const FIREBASE_PROJECT_ID = 'barbearia-c80da';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyD0x4MrjdJ_kP3I4-kVsSEFXeiRi1w2-Ws';
const FIRESTORE_DOCUMENT = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/system/state?key=${FIREBASE_API_KEY}`;

const money = value => Math.round(Number(value) * 100) / 100;
const isoDate = date => date.toISOString().slice(0, 10);
const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

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
  const hours = [
    { day: 0, label: 'Domingo', active: true, open: '10:00', close: '13:00' },
    { day: 1, label: 'Segunda', active: true, open: '10:00', close: '20:00' },
    { day: 2, label: 'Terça', active: true, open: '10:00', close: '20:00' },
    { day: 3, label: 'Quarta', active: true, open: '10:00', close: '20:00' },
    { day: 4, label: 'Quinta', active: true, open: '10:00', close: '20:00' },
    { day: 5, label: 'Sexta', active: true, open: '10:00', close: '20:00' },
    { day: 6, label: 'Sábado', active: true, open: '10:00', close: '20:00' }
  ];
  const appointment = (offset, time, name, phone, ids, status = 'scheduled') => {
    const selected = services.filter(item => ids.includes(item.id));
    return {
      id: crypto.randomUUID(), customerName: name, phone,
      date: isoDate(addDays(today, offset)), time,
      serviceIds: ids,
      services: selected.map(({ id, name, price, duration }) => ({ id, name, price, duration })),
      total: money(selected.reduce((sum, item) => sum + item.price, 0)),
      duration: selected.reduce((sum, item) => sum + item.duration, 0),
      status, createdAt: new Date().toISOString(), history: []
    };
  };
  return {
    config: { businessName: 'Willzinho Barber', whatsapp: '5541999901208', slotInterval: 10 },
    services, hours,
    appointments: [
      appointment(0, '14:00', 'João Silva', '5511988881111', ['combo']),
      appointment(0, '16:00', 'Caio Martins', '5511988882222', ['corte']),
      appointment(1, '11:00', 'Lucas Rocha', '5511988883333', ['barba', 'sobrancelha']),
      appointment(2, '15:30', 'Rafael Melo', '5511988884444', ['progressiva'])
    ]
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(initialData(), null, 2));
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

let db = loadData();
let firestoreConnected = false;
let syncTimer = null;

function encodeFirestore(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestore) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestore(item)])) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  return { stringValue: String(value) };
}

function decodeFirestore(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestore);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestore(item)]));
  return null;
}

async function writeFirestore() {
  const encoded = encodeFirestore(db);
  const response = await fetch(FIRESTORE_DOCUMENT, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encoded.mapValue.fields })
  });
  if (!response.ok) throw new Error(`Firestore recusou a gravação (${response.status}).`);
  firestoreConnected = true;
}

async function initializeStorage() {
  try {
    const response = await fetch(FIRESTORE_DOCUMENT);
    if (response.ok) {
      const document = await response.json();
      db = decodeFirestore({ mapValue: { fields: document.fields || {} } });
      firestoreConnected = true;
      fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } else if (response.status === 404) {
      await writeFirestore();
    } else {
      console.warn(`Firestore indisponível (${response.status}); usando armazenamento local.`);
    }
  } catch (error) {
    console.warn('Firestore indisponível; usando armazenamento local.');
  }
}

const save = () => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => writeFirestore().catch(() => {
    firestoreConnected = false;
    console.warn('Não foi possível sincronizar com o Firestore.');
  }), 50);
};

const toMinutes = value => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
const toTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const endMinutes = appointment => toMinutes(appointment.time) + appointment.duration;
const isBlocking = appointment => !['cancelled', 'no_show'].includes(appointment.status);

function selectedServices(ids) {
  const unique = [...new Set(Array.isArray(ids) ? ids : [])];
  if (unique.includes('combo')) {
    ['corte', 'barba', 'sobrancelha'].forEach(id => {
      const index = unique.indexOf(id);
      if (index >= 0) unique.splice(index, 1);
    });
  }
  return unique.map(id => db.services.find(item => item.id === id))
    .filter(item => item && item.active && item.price !== null && item.duration !== null);
}

function bookingTotals(serviceIds) {
  const services = selectedServices(serviceIds);
  return {
    services,
    total: money(services.reduce((sum, item) => sum + item.price, 0)),
    duration: services.reduce((sum, item) => sum + item.duration, 0)
  };
}

function conflicts(date, time, duration, ignoreId = null) {
  const start = toMinutes(time);
  const end = start + duration;
  return db.appointments.some(item => item.id !== ignoreId && item.date === date && isBlocking(item)
    && start < endMinutes(item) && end > toMinutes(item.time));
}

function availability(date, serviceIds, ignoreId = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const requested = new Date(`${date}T12:00:00Z`);
  const dayConfig = db.hours.find(item => item.day === requested.getUTCDay());
  const { duration } = bookingTotals(serviceIds);
  if (!dayConfig?.active || !duration) return [];
  const open = toMinutes(dayConfig.open);
  const close = toMinutes(dayConfig.close);
  const now = new Date();
  const today = isoDate(now);
  const slots = [];
  for (let cursor = open; cursor + duration <= close; cursor += db.config.slotInterval || 10) {
    const time = toTime(cursor);
    const passed = date < today || (date === today && cursor <= now.getHours() * 60 + now.getMinutes());
    if (!passed && !conflicts(date, time, duration, ignoreId)) slots.push(time);
  }
  return slots;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) request.destroy();
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
  });
}

function cleanPhone(phone) { return String(phone || '').replace(/\D/g, '').slice(0, 15); }
function publicState() {
  return {
    config: db.config,
    services: db.services,
    hours: db.hours,
    appointments: db.appointments.slice().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
  };
}

function validateBooking(body, ignoreId = null) {
  const customerName = String(body.customerName || '').trim().slice(0, 80);
  const phone = cleanPhone(body.phone);
  const date = String(body.date || '');
  const time = String(body.time || '');
  const totals = bookingTotals(body.serviceIds);
  if (customerName.length < 2) return { error: 'Informe o nome completo.' };
  if (phone.length < 10) return { error: 'Informe um WhatsApp válido com DDD.' };
  if (!totals.services.length) return { error: 'Selecione ao menos um serviço disponível.' };
  if (!availability(date, totals.services.map(item => item.id), ignoreId).includes(time)) return { error: 'Este horário não está mais disponível.' };
  return { customerName, phone, date, time, ...totals };
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/state') return sendJson(response, 200, publicState());

  if (request.method === 'GET' && url.pathname === '/api/availability') {
    const date = url.searchParams.get('date') || '';
    const ids = (url.searchParams.get('services') || '').split(',').filter(Boolean);
    const ignoreId = url.searchParams.get('ignoreId');
    return sendJson(response, 200, { slots: availability(date, ids, ignoreId) });
  }

  if (request.method === 'POST' && url.pathname === '/api/appointments') {
    const body = await readBody(request);
    const valid = validateBooking(body);
    if (valid.error) return sendJson(response, 422, { error: valid.error });
    const appointment = {
      id: crypto.randomUUID(), customerName: valid.customerName, phone: valid.phone,
      date: valid.date, time: valid.time,
      serviceIds: valid.services.map(item => item.id),
      services: valid.services.map(({ id, name, price, duration }) => ({ id, name, price, duration })),
      total: valid.total, duration: valid.duration,
      status: 'pending_confirmation', createdAt: new Date().toISOString(), history: []
    };
    db.appointments.push(appointment);
    save();
    return sendJson(response, 201, { appointment, whatsapp: db.config.whatsapp });
  }

  const appointmentMatch = url.pathname.match(/^\/api\/appointments\/([^/]+)(?:\/(status|reschedule))?$/);
  if (appointmentMatch && request.method === 'PATCH') {
    const appointment = db.appointments.find(item => item.id === appointmentMatch[1]);
    if (!appointment) return sendJson(response, 404, { error: 'Agendamento não encontrado.' });
    const body = await readBody(request);
    if (appointmentMatch[2] === 'status') {
      const allowed = ['pending_confirmation', 'scheduled', 'attended', 'no_show'];
      if (!allowed.includes(body.status)) return sendJson(response, 422, { error: 'Status inválido.' });
      appointment.history.push({ type: 'status', from: appointment.status, to: body.status, at: new Date().toISOString() });
      appointment.status = body.status;
    } else if (appointmentMatch[2] === 'reschedule') {
      const valid = validateBooking({ ...appointment, date: body.date, time: body.time }, appointment.id);
      if (valid.error) return sendJson(response, 422, { error: valid.error });
      appointment.history.push({ type: 'reschedule', date: appointment.date, time: appointment.time, at: new Date().toISOString() });
      appointment.date = valid.date;
      appointment.time = valid.time;
      appointment.status = 'rescheduled';
    } else {
      return sendJson(response, 404, { error: 'Rota inválida.' });
    }
    save();
    return sendJson(response, 200, { appointment });
  }

  const serviceMatch = url.pathname.match(/^\/api\/services(?:\/([^/]+))?$/);
  if (serviceMatch && ['POST', 'PUT'].includes(request.method)) {
    const body = await readBody(request);
    const target = serviceMatch[1] ? db.services.find(item => item.id === serviceMatch[1]) : null;
    if (request.method === 'PUT' && !target) return sendJson(response, 404, { error: 'Serviço não encontrado.' });
    const service = target || { id: crypto.randomUUID(), description: '' };
    service.name = String(body.name || service.name || '').trim().slice(0, 80);
    service.description = String(body.description ?? service.description ?? '').trim().slice(0, 160);
    service.price = body.price === null || body.price === '' ? null : money(body.price);
    service.duration = body.duration === null || body.duration === '' ? null : Math.max(5, Number(body.duration));
    service.active = Boolean(body.active) && service.price !== null && service.duration !== null;
    if (!service.name) return sendJson(response, 422, { error: 'Informe o nome do serviço.' });
    if (!target) db.services.push(service);
    save();
    return sendJson(response, target ? 200 : 201, { service });
  }

  const hoursMatch = url.pathname.match(/^\/api\/hours\/(\d)$/);
  if (hoursMatch && request.method === 'PUT') {
    const item = db.hours.find(day => day.day === Number(hoursMatch[1]));
    if (!item) return sendJson(response, 404, { error: 'Dia não encontrado.' });
    const body = await readBody(request);
    if (body.active && (!/^\d{2}:\d{2}$/.test(body.open) || !/^\d{2}:\d{2}$/.test(body.close) || toMinutes(body.open) >= toMinutes(body.close))) {
      return sendJson(response, 422, { error: 'Horário de funcionamento inválido.' });
    }
    item.active = Boolean(body.active);
    item.open = body.open || item.open;
    item.close = body.close || item.close;
    save();
    return sendJson(response, 200, { hours: item });
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(response, url) {
  if (url.pathname === '/') {
    response.writeHead(302, { Location: '/site/' }); response.end(); return;
  }
  const routes = { '/site/': '/index.html', '/site': '/index.html', '/admin/': '/admin/index.html', '/admin': '/admin/index.html' };
  const requested = routes[url.pathname] || url.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404); response.end('Não encontrado'); return;
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else serveStatic(response, url);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: 'Não foi possível concluir a operação.' });
  }
});

initializeStorage().finally(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`Willzinho Barber disponível na porta ${PORT} (${firestoreConnected ? 'Firestore' : 'armazenamento local'})`));
});
