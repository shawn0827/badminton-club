/* core.js — 本機 IndexedDB、資料模型與帳務核心 */
'use strict';

const DB_NAME = 'badminton_club_drive_v1';
const DB_VERSION = 1;
const DB_STORE = 'app';
const STATE_KEY = 'state';
const DEVICE_KEY = 'device';

let state = null;
let device = null;
let currentRoute = 'home';
let saveTimer = null;
let autoSyncTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const nowIso = () => new Date().toISOString();
const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const money = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Number(value || 0));
const safeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const escAttr = esc;

function todayTW() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatDate(value) {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  const [y, m, d] = text.split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}` : value;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function defaultState() {
  const stamp = nowIso();
  return {
    version: 1,
    meta: { createdAt: stamp, updatedAt: stamp },
    settings: {
      clubName: '我的羽球團',
      seasonWeeks: 12,
      defaultBuckets: 2,
      pricePerBucket: 700,
      chargeMode: 'fixed',
      fixedCharge: 350,
      updatedAt: stamp
    },
    members: [
      { id: 'member_1', name: '固定1', type: '固定', defaultShare: true, active: true, updatedAt: stamp },
      { id: 'member_2', name: '固定2', type: '固定', defaultShare: true, active: true, updatedAt: stamp },
      { id: 'member_3', name: '固定3', type: '固定', defaultShare: true, active: true, updatedAt: stamp },
      { id: 'member_4', name: '固定4', type: '固定', defaultShare: true, active: true, updatedAt: stamp }
    ],
    sessions: [],
    attendance: [],
    transactions: [],
    inventoryPurchases: []
  };
}

function defaultDevice() {
  return {
    operatorName: '管理者',
    autoSync: true,
    google: {
      clientId: '',
      folderName: '羽球團管理系統備份',
      folderId: '',
      connected: false,
      email: '',
      name: '',
      picture: '',
      lastSyncAt: '',
      lastExcel: null,
      lastJson: null
    }
  };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadLocalData() {
  state = await dbGet(STATE_KEY) || defaultState();
  device = await dbGet(DEVICE_KEY) || defaultDevice();
  migrateState();
  await Promise.all([dbSet(STATE_KEY, state), dbSet(DEVICE_KEY, device)]);
}

function migrateState() {
  const stamp = nowIso();
  state = state && typeof state === 'object' ? state : defaultState();
  state.version = 1;
  state.meta ||= { createdAt: stamp, updatedAt: stamp };
  state.settings = { ...defaultState().settings, ...(state.settings || {}) };
  for (const key of ['members','sessions','attendance','transactions','inventoryPurchases']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  device = device && typeof device === 'object' ? device : defaultDevice();
  device.google = { ...defaultDevice().google, ...(device.google || {}) };
  if (typeof device.autoSync !== 'boolean') device.autoSync = true;
  if (!device.operatorName) device.operatorName = '管理者';
}

async function saveState({ sync = true } = {}) {
  state.meta.updatedAt = nowIso();
  await dbSet(STATE_KEY, state);
  renderApp();
  if (sync) scheduleAutoSync();
}

async function saveDevice() {
  await dbSet(DEVICE_KEY, device);
  updateHeader();
}

function scheduleAutoSync() {
  clearTimeout(autoSyncTimer);
  if (!device?.autoSync || !device?.google?.connected) return;
  autoSyncTimer = setTimeout(() => {
    if (typeof syncGoogleDrive === 'function') syncGoogleDrive({ silent: true, mergeFirst: true }).catch(console.warn);
  }, 900);
}

function getMember(id) { return state.members.find(item => item.id === id); }
function getSession(id) { return state.sessions.find(item => item.id === id); }
function activeMembers() { return state.members.filter(item => item.active !== false); }
function todaySession() { return state.sessions.find(item => item.date === todayTW() && item.status !== 'cancelled'); }
function sessionAttendance(sessionId) { return state.attendance.filter(item => item.sessionId === sessionId); }
function activeTransactions() { return state.transactions.filter(item => !item.voided); }

function memberBalance(memberId) {
  return activeTransactions()
    .filter(item => item.memberId === memberId)
    .reduce((sum, item) => sum + safeNumber(item.amount), 0);
}

function totalMemberBalance() {
  return activeMembers().reduce((sum, member) => sum + memberBalance(member.id), 0);
}

function stockBuckets() {
  const purchased = state.inventoryPurchases.filter(item => !item.voided).reduce((sum, item) => sum + safeNumber(item.buckets), 0);
  const used = state.sessions.filter(item => item.status !== 'cancelled').reduce((sum, item) => sum + safeNumber(item.bucketsUsed), 0);
  return purchased - used;
}

function touch(record) {
  record.updatedAt = nowIso();
  record.updatedBy = device?.operatorName || '管理者';
  return record;
}

function createTodaySession() {
  const date = todayTW();
  let session = todaySession();
  if (session) return session;
  session = touch({
    id: `session_${date}`,
    date,
    title: `${formatDate(date)} 羽球`,
    bucketsUsed: safeNumber(state.settings.defaultBuckets, 2),
    pricePerBucket: safeNumber(state.settings.pricePerBucket, 700),
    chargeMode: state.settings.chargeMode || 'fixed',
    fixedCharge: safeNumber(state.settings.fixedCharge, 350),
    status: 'open',
    createdAt: nowIso()
  });
  state.sessions.push(session);
  activeMembers().forEach(member => ensureAttendance(session.id, member.id));
  recalcSessionCharges(session.id);
  return session;
}

function ensureAttendance(sessionId, memberId) {
  let item = state.attendance.find(row => row.sessionId === sessionId && row.memberId === memberId);
  if (!item) {
    item = touch({ id: `attendance_${sessionId}_${memberId}`, sessionId, memberId, present: false, chargeAmount: 0 });
    state.attendance.push(item);
  }
  return item;
}

function upsertChargeTransaction(session, member, amount, voided) {
  const id = `charge_${session.id}_${member.id}`;
  let tx = state.transactions.find(item => item.id === id);
  if (!tx) {
    tx = {
      id,
      date: session.date,
      memberId: member.id,
      memberName: member.name,
      type: 'charge',
      amount: -Math.abs(safeNumber(amount)),
      note: `${session.title} 球費`,
      sessionId: session.id,
      voided: Boolean(voided),
      createdAt: nowIso()
    };
    state.transactions.push(touch(tx));
  } else {
    tx.date = session.date;
    tx.memberName = member.name;
    tx.amount = -Math.abs(safeNumber(amount));
    tx.note = `${session.title} 球費`;
    tx.voided = Boolean(voided);
    touch(tx);
  }
}

function recalcSessionCharges(sessionId) {
  const session = getSession(sessionId);
  if (!session) return;
  const rows = sessionAttendance(sessionId);
  const presentEligible = rows.filter(row => {
    if (!row.present) return false;
    const member = getMember(row.memberId);
    return member && member.active !== false && member.defaultShare !== false;
  });
  const totalCost = Math.round(safeNumber(session.bucketsUsed) * safeNumber(session.pricePerBucket));
  const allocations = new Map();

  if ((session.chargeMode || 'fixed') === 'equal' && presentEligible.length) {
    const base = Math.floor(totalCost / presentEligible.length);
    let remainder = totalCost - base * presentEligible.length;
    presentEligible.forEach((row, index) => allocations.set(row.memberId, base + (index < remainder ? 1 : 0)));
  } else {
    presentEligible.forEach(row => allocations.set(row.memberId, Math.round(safeNumber(session.fixedCharge, 350))));
  }

  rows.forEach(row => {
    const amount = allocations.get(row.memberId) || 0;
    row.chargeAmount = amount;
    touch(row);
    const member = getMember(row.memberId);
    if (member) upsertChargeTransaction(session, member, amount, !amount);
  });

  state.transactions
    .filter(tx => tx.type === 'charge' && tx.sessionId === sessionId)
    .forEach(tx => {
      if (!allocations.has(tx.memberId)) {
        tx.voided = true;
        touch(tx);
      }
    });
}

async function toggleAttendance(memberId) {
  const session = todaySession() || createTodaySession();
  if (session.status === 'completed') throw new Error('球局已完成，請先重新開啟');
  const row = ensureAttendance(session.id, memberId);
  row.present = !row.present;
  touch(row);
  recalcSessionCharges(session.id);
  await saveState();
}

async function updateSession(sessionId, patch) {
  const session = getSession(sessionId);
  if (!session) throw new Error('找不到球局');
  Object.assign(session, patch);
  touch(session);
  recalcSessionCharges(sessionId);
  await saveState();
}

async function setSessionStatus(sessionId, status) {
  const session = getSession(sessionId);
  if (!session) throw new Error('找不到球局');
  session.status = status;
  touch(session);
  await saveState();
}

async function saveMember(payload) {
  const stamp = nowIso();
  let member = payload.id ? getMember(payload.id) : null;
  if (!member) {
    member = { id: uid('member'), createdAt: stamp };
    state.members.push(member);
  }
  Object.assign(member, {
    name: String(payload.name || '').trim(),
    type: payload.type || '固定',
    defaultShare: Boolean(payload.defaultShare),
    active: payload.active !== false
  });
  if (!member.name) throw new Error('請輸入姓名');
  touch(member);
  state.transactions.filter(tx => tx.memberId === member.id).forEach(tx => { tx.memberName = member.name; touch(tx); });
  const open = todaySession();
  if (open) ensureAttendance(open.id, member.id);
  await saveState();
}

async function addMemberMoney(memberId, type, amount, note = '') {
  const member = getMember(memberId);
  if (!member) throw new Error('找不到團員');
  let signed = Math.round(safeNumber(amount));
  if (!signed) throw new Error('金額不能是 0');
  if (type === 'topup') signed = Math.abs(signed);
  const tx = touch({
    id: uid('tx'), date: todayTW(), memberId, memberName: member.name,
    type, amount: signed, note: String(note || '').trim(), voided: false, createdAt: nowIso()
  });
  state.transactions.push(tx);
  await saveState();
}

async function addInventoryPurchase(buckets, unitCost, note = '') {
  buckets = Math.round(safeNumber(buckets));
  unitCost = Math.round(safeNumber(unitCost));
  if (buckets <= 0) throw new Error('進貨桶數需大於 0');
  state.inventoryPurchases.push(touch({
    id: uid('inventory'), date: todayTW(), buckets, unitCost,
    totalCost: buckets * unitCost, note: String(note || '').trim(), voided: false, createdAt: nowIso()
  }));
  await saveState();
}

async function saveClubSettings(patch) {
  Object.assign(state.settings, patch);
  state.settings.updatedAt = nowIso();
  await saveState();
}

function recordKey(item) { return item.id; }
function chooseLatest(a, b) {
  if (!a) return structuredClone(b);
  if (!b) return structuredClone(a);
  const at = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
  const bt = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
  return structuredClone(bt > at ? b : a);
}

function mergeCollection(local = [], cloud = []) {
  const map = new Map();
  [...local, ...cloud].forEach(item => {
    if (!item?.id) return;
    map.set(item.id, chooseLatest(map.get(item.id), item));
  });
  return [...map.values()];
}

function mergeStates(localState, cloudState) {
  if (!cloudState || typeof cloudState !== 'object') return structuredClone(localState);
  const merged = defaultState();
  merged.meta.createdAt = localState.meta?.createdAt || cloudState.meta?.createdAt || nowIso();
  merged.meta.updatedAt = nowIso();
  merged.settings = chooseLatest(localState.settings, cloudState.settings);
  merged.members = mergeCollection(localState.members, cloudState.members);
  merged.sessions = mergeCollection(localState.sessions, cloudState.sessions);
  merged.attendance = mergeCollection(localState.attendance, cloudState.attendance);
  merged.transactions = mergeCollection(localState.transactions, cloudState.transactions);
  merged.inventoryPurchases = mergeCollection(localState.inventoryPurchases, cloudState.inventoryPurchases);
  return merged;
}

async function replaceState(incoming, { sync = false } = {}) {
  if (!incoming || typeof incoming !== 'object') throw new Error('備份格式不正確');
  state = incoming;
  migrateState();
  await saveState({ sync });
}

function combinedLedger() {
  const txRows = activeTransactions().map(item => ({
    id: item.id, date: item.date, at: item.updatedAt || item.createdAt, kind: item.type,
    title: item.memberName || '團員', note: item.note || '', amount: safeNumber(item.amount),
    operator: item.updatedBy || ''
  }));
  const invRows = state.inventoryPurchases.filter(item => !item.voided).map(item => ({
    id: item.id, date: item.date, at: item.updatedAt || item.createdAt, kind: 'inventory',
    title: `進貨 ${item.buckets} 桶`, note: item.note || '', amount: -safeNumber(item.totalCost),
    operator: item.updatedBy || ''
  }));
  return [...txRows, ...invRows].sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)));
}

function toast(message, error = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function setLoading(on, text = '處理中…') {
  const box = $('#loading');
  if (!box) return;
  $('span', box).textContent = text;
  box.classList.toggle('hidden', !on);
}

function confirmAction(title, message) {
  return new Promise(resolve => {
    const dialog = $('#confirmDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    const finish = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'default');
    };
    const onClose = () => finish();
    dialog.addEventListener('close', onClose, { once: true });
    dialog.showModal();
  });
}
