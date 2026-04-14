
const API_BASE = "https://api.полихов.рф";
const REFRESH_MS = 3000;
const STATUS_LABELS = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  cooking: 'Готовится',
  delivery: 'У курьера',
  done: 'Завершён',
  cancelled: 'Отменён'
};
const SITE_LABELS = { prozharim: 'ПРОЖАРИМ', sushidza: 'СУШИДЗА', banzai: 'БАНЗАЙ' };

const state = {
  adminToken: localStorage.getItem('proz_admin_token') || '',
  orders: [],
  selectedOrderId: null,
  statusFilter: '',
  search: '',
  site: '',
  dateMode: 'all',
  dateValue: '',
  lastNewIds: new Set(),
  blinkTimer: null,
  blinkOn: false,
  originalTitle: document.title,
  newOrderCount: 0,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const MAIN_FAVICON = 'assets/favicon.png';
const ALERT_FAVICON = 'assets/favicon-alert.png';

function showToast(message){
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('isOn');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('isOn'), 2600);
}
function setConnectionState(text, mode=''){
  const el = $('#connectState');
  if(!el) return;
  el.textContent = text;
  el.className = `connectState ${mode}`.trim();
}
function setAuthBusy(isBusy){
  const btn = $('#saveAuthBtn');
  if (!btn) return;
  btn.disabled = isBusy;
  btn.textContent = isBusy ? 'Проверка...' : 'Войти';
}
function updateAuthView(isAuthed){
  const gate = $('#loginGate');
  const app = $('#appRoot');
  document.body.classList.toggle('isAuthed', !!isAuthed);
  if (!gate || !app) return;
  if (isAuthed){
    gate.hidden = true;
    gate.setAttribute('aria-hidden', 'true');
    app.hidden = false;
    app.setAttribute('aria-hidden', 'false');
  } else {
    gate.hidden = false;
    gate.setAttribute('aria-hidden', 'false');
    app.hidden = true;
    app.setAttribute('aria-hidden', 'true');
  }
}
function escapeHtml(v){
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtNum(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('ru-RU');
}
function formatMoney(v){
  const n = Number(v || 0);
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function getOrderDateKey(order){
  const d = new Date(order.createdAt);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function getVal(...values){
  for (const v of values){
    if (v === 0) return 0;
    if (v === false) return false;
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}
function verifyConnection(token){
  return fetch(`${API_BASE}/admin/ping`, { headers:{ 'X-Admin-Token': token }})
    .then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Код ошибки API1. Обратитесь к разработчику.');
      if (!data.hasKv) throw new Error('Код ошибки WKV1. Обратитесь к разработчику.');
      return data;
    });
}
async function saveAuth(){
  const token = $('#adminToken').value.trim();
  if (!token) return showToast('Введите пароль');
  setAuthBusy(true);
  setConnectionState('Проверка подключения...', 'pending');
  try {
    await verifyConnection(token);
    state.adminToken = token;
    localStorage.setItem('proz_admin_token', token);
    setConnectionState('Подключение установлено.', 'success');
    updateAuthView(true);
    await requestNotificationPermission();
    await bootstrap();
    showToast('Подключение установлено');
  } catch (err){
    updateAuthView(false);
    setConnectionState(err.message || 'Ошибка подключения', 'error');
    showToast(err.message || 'Ошибка подключения');
  } finally {
    setAuthBusy(false);
  }
}
async function api(path, options={}){
  if (!state.adminToken) throw new Error('Сначала введи пароль');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': state.adminToken,
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Код ошибки API1. Обратитесь к разработчику.');
  return data;
}
function applyClientFilters(items){
  return items.filter(order => {
    if (state.statusFilter && order.status !== state.statusFilter) return false;
    if (state.site && order.site !== state.site) return false;
    if (state.dateMode === 'date' && state.dateValue && getOrderDateKey(order) !== state.dateValue) return false;
    const q = state.search.trim().toLowerCase();
    if (q) {
      const hay = [
        order.id,
        order.customer?.name,
        order.customer?.phone,
        order.delivery?.address,
        order.delivery?.restaurant,
        order.point,
        order.branch,
        order.comment,
        SITE_LABELS[order.site] || order.site
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
async function bootstrap(){
  await loadOrders();
  startAutoRefresh();
  updateAuthView(true);
}
function startAutoRefresh(){
  clearInterval(state._timer);
  if (!state.adminToken) return;
  state._timer = setInterval(() => {
    if (document.hidden) return;
    if ($('#orderModal')?.classList.contains('isOn')) return;
    if (document.activeElement && document.activeElement.id === 'statusSelect') return;
    loadOrders(true).catch(() => {});
  }, REFRESH_MS);
}
async function loadOrders(silent=false){
  const data = await api('/admin/orders?limit=500');
  const prevIds = new Set(state.orders.map(x => x.id));
  const selectedId = state.selectedOrderId;
  const modalOpen = $('#orderModal')?.classList.contains('isOn');
  const statusFocused = document.activeElement && document.activeElement.id === 'statusSelect';

  state.orders = data.items || [];
  handleOrderAlerts(state.orders, prevIds, silent);
  render();

  if (modalOpen && selectedId && !statusFocused) {
    const refreshed = state.orders.find(x => x.id === selectedId);
    if (refreshed) renderDetails(refreshed);
  }

  if (!silent && prevIds.size) {
    const fresh = state.orders.filter(x => !prevIds.has(x.id)).length;
    if (fresh > 0) showToast(`Новых заказов: ${fresh}`);
  }
}
function handleOrderAlerts(orders, prevIds, silent){
  const newOrders = orders.filter(x => x.status === 'new');
  const newIds = new Set(newOrders.map(x => x.id));
  state.newOrderCount = newIds.size;
  if (newIds.size > 0) startBlink(); else stopBlink();
  let appeared = 0;
  newIds.forEach(id => {
    if (!state.lastNewIds.has(id) && (!prevIds || !prevIds.has(id))) appeared++;
  });
  if (!silent && appeared > 0) {
    beep();
    notifyBrowser(`Новый заказ${appeared > 1 ? `ов: ${appeared}` : ''}`, 'В колл-центр поступил новый заказ.');
  }
  state.lastNewIds = newIds;
}
function setFavicon(href){
  const favicon = $('#favicon');
  if (favicon) favicon.href = href;
}
function startBlink(){
  if (state.blinkTimer) return;
  state.blinkTimer = setInterval(() => {
    state.blinkOn = !state.blinkOn;
    const countText = state.newOrderCount > 1 ? ` (${state.newOrderCount})` : '';
    document.title = state.blinkOn ? `🔴${countText} Новый заказ` : state.originalTitle;
    setFavicon(state.blinkOn ? ALERT_FAVICON : MAIN_FAVICON);
  }, 1000);
}
function stopBlink(){
  if (state.blinkTimer) {
    clearInterval(state.blinkTimer);
    state.blinkTimer = null;
  }
  state.blinkOn = false;
  document.title = state.originalTitle;
  setFavicon(MAIN_FAVICON);
}
function beep(){
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1046;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    setTimeout(() => ctx.close && ctx.close(), 500);
  } catch {}
}
async function requestNotificationPermission(){
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
}
function notifyBrowser(title, body){
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: MAIN_FAVICON, badge: ALERT_FAVICON, silent: false });
  } catch {}
}
function render(){
  const items = applyClientFilters(state.orders);
  renderStats(items);
  renderTable(items);
  const selected = items.find(x => x.id === state.selectedOrderId) || state.orders.find(x => x.id === state.selectedOrderId) || null;
  if (selected && $('#orderModal')?.classList.contains('isOn')) renderDetails(selected);
}
function renderStats(items){
  const newCount = items.filter(x => x.status === 'new').length;
  const revenue = items.filter(x => x.status === 'done').reduce((s, x) => s + Number(x.total || 0), 0);
  $('#statNew').textContent = newCount.toLocaleString('ru-RU');
  $('#statTotal').textContent = items.length.toLocaleString('ru-RU');
  $('#statRevenue').textContent = formatMoney(revenue);
}
function statusBadge(status){
  return `<span class="statusBadge status-${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
}
function typeLabel(order){
  const when = order.when?.type === 'later' ? 'Предзаказ' : 'Ближайшее';
  const receive = order.delivery?.type === 'pickup' ? 'Самовывоз' : 'Доставка';
  return `${when}<br>${receive}`;
}
function orderPointText(order){
  const site = SITE_LABELS[order.site] || order.site || '';
  const point = getVal(order.delivery?.restaurant, order.point, order.branch, order.pointName, order.restaurantPoint, order.pickupPoint, order.delivery?.point, order.delivery?.pickupPointName);
  return `${site ? `${site}<br>` : ''}${point || '—'}`;
}
function renderTable(items){
  const body = $('#ordersBody');
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="7" class="muted">Заказов нет</td></tr>';
    return;
  }
  body.innerHTML = items.map(order => `
    <tr data-id="${escapeHtml(order.id)}" class="${order.id === state.selectedOrderId ? 'isOn' : ''}">
      <td>${statusBadge(order.status)}<div style="margin-top:10px;font-weight:800">#${escapeHtml(order.id)}</div></td>
      <td><strong>${escapeHtml(formatDateTime(order.createdAt))}</strong><div class="muted">${escapeHtml(new Date(order.createdAt).toLocaleDateString('ru-RU'))}</div></td>
      <td><strong>${escapeHtml(order.customer?.name || '—')}</strong><div class="muted">${escapeHtml(order.customer?.phone || '—')}</div></td>
      <td>${typeLabel(order)}</td>
      <td><strong>${escapeHtml(order.delivery?.address || '—')}</strong><div class="muted">${escapeHtml(order.comment || 'Без комментария')}</div></td>
      <td><strong>${orderPointText(order)}</strong></td>
      <td class="sumCell">${escapeHtml(fmtNum(order.total || 0))}₽</td>
    </tr>
  `).join('');
  $$('#ordersBody tr[data-id]').forEach(row => row.addEventListener('click', () => openOrderModal(row.dataset.id)));
}
function openOrderModal(orderId){
  state.selectedOrderId = orderId;
  const order = state.orders.find(x => x.id === orderId);
  renderDetails(order || null);
  $('#orderModal')?.classList.add('isOn');
  document.body.classList.add('modalOpen');
}
function closeOrderModal(){
  $('#orderModal')?.classList.remove('isOn');
  document.body.classList.remove('modalOpen');
}
function fieldCard(title, value, muted='', wide=false){
  if (value === '' || value === null || value === undefined) return '';
  return `<div class="detailBox${wide ? ' detailBox--wide' : ''}"><strong>${escapeHtml(title)}</strong><div>${escapeHtml(String(value))}</div>${muted ? `<div class="muted">${escapeHtml(String(muted))}</div>` : ''}</div>`;
}
function renderDetails(order){
  const wrap = $('#orderDetails');
  if (!order) {
    wrap.className = 'orderDetails empty';
    wrap.textContent = 'Выбери заказ из таблицы.';
    return;
  }
  wrap.className = 'orderDetails';

  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([k,v]) => `<option value="${escapeHtml(k)}" ${order.status===k?'selected':''}>${escapeHtml(v)}</option>`)
    .join('');

  const items = (order.items || []).map(it => {
    const weight = getVal(it.weight, it.variant, it.variantLabel);
    const label = [it.name, weight ? `(${weight})` : ''].filter(Boolean).join(' ');
    const lineSum = getVal(it.sum, Number(it.price || 0) * Number(it.qty || 0));
    return `<li>${escapeHtml(label || 'Позиция')} ×${escapeHtml(String(it.qty || 1))} — ${escapeHtml(fmtNum(lineSum))} ₽</li>`;
  }).join('');

  const paymentLabel = getVal(order.paymentLabel, order.payment, order.payment?.methodLabel, order.payment?.method, '—');
  const receiveLabel = order.delivery?.type === 'pickup' ? 'Самовывоз' : 'Доставка';
  const whenLabel = order.when?.type === 'later'
    ? `Предзаказ${order.when?.date ? ` · ${formatDateTime(order.when.date)}` : ''}`
    : 'Ближайшее время';
  const customerName = getVal(order.customer?.name, '—');
  const customerPhone = getVal(order.customer?.phone, '—');
  const address = getVal(order.delivery?.address, order.address, '—');
  const restaurantPoint = getVal(order.delivery?.restaurant, order.point, order.branch, order.pointName, order.restaurantPoint, order.pickupPoint, order.delivery?.point, order.delivery?.pickupPointName, order.delivery?.pickupAddress);
  const deliveryPrice = getVal(order.delivery?.price, order.pricing?.deliveryPrice);
  const deliveryBasePrice = getVal(order.delivery?.basePrice, order.pricing?.baseDeliveryPrice);
  const minSurcharge = getVal(order.delivery?.minimumOrderSurcharge, order.pricing?.minimumOrderSurcharge);
  const zone = getVal(order.delivery?.zone, order.deliveryZone, order.zoneName, order.zone);
  const entrance = getVal(order.delivery?.entrance);
  const floor = getVal(order.delivery?.floor);
  const flat = getVal(order.delivery?.flat);
  const comment = getVal(order.comment, order.delivery?.comment, order.customerComment);
  const cutleryCount = getVal(order.cutlery?.count, order.cutleryCount);
  const cutleryPaidCount = getVal(order.cutlery?.paidCount, order.cutlery?.countPaid, order.paidCutleryCount);
  const cutleryPrice = getVal(order.cutlery?.price, order.cutleryPrice);
  const promoCode = getVal(order.promo?.code, order.promoCode);
  const promoTitle = getVal(order.promo?.title, order.promo?.name, order.promoTitle);
  const promoDiscount = getVal(order.promo?.discount, order.discount, order.pricing?.discount);
  const changeFrom = getVal(order.changeFrom, order.payment?.changeFrom);
  const nightMarkup = getVal(order.pricing?.nightMarkup, order.nightMarkup);
  const subtotal = getVal(order.subtotal, order.pricing?.subtotal, order.itemsSubtotal);
  const orderTotal = getVal(order.total, order.pricing?.total, 0);

  const cards = [
    fieldCard('Клиент', customerName, customerPhone),
    fieldCard('Получение', receiveLabel, `${address}${whenLabel ? ` · ${whenLabel}` : ''}`),
    fieldCard('Оплата', paymentLabel, `Итого: ${formatMoney(orderTotal)}`),
    fieldCard('Точка ресторана', restaurantPoint, SITE_LABELS[order.site] || order.site),
    (deliveryPrice !== '' && deliveryPrice !== undefined && order.delivery?.type !== 'pickup') ? fieldCard('Стоимость доставки', formatMoney(deliveryPrice), [deliveryBasePrice !== '' ? `Базовая: ${formatMoney(deliveryBasePrice)}` : '', minSurcharge !== '' && Number(minSurcharge) > 0 ? `Доплата до минимума: ${formatMoney(minSurcharge)}` : ''].filter(Boolean).join(' · ')) : '',
    fieldCard('Зона доставки', zone),
    (entrance || floor || flat) ? fieldCard('Подъезд / этаж / квартира', `${entrance || '—'} / ${floor || '—'} / ${flat || '—'}`) : '',
    (cutleryCount !== '') ? fieldCard('Приборы', `${cutleryCount || 0} шт.`, `Платных: ${cutleryPaidCount || 0}${cutleryPrice !== '' ? ` · ${formatMoney(cutleryPrice)}` : ''}`) : '',
    (promoCode || promoTitle || promoDiscount !== '') ? fieldCard('Промокод', promoCode || '—', `${promoTitle || 'Без названия'}${promoDiscount !== '' && Number(promoDiscount) > 0 ? ` · Скидка: ${formatMoney(promoDiscount)}` : ''}`) : '',
    (changeFrom !== '') ? fieldCard('Сдача', `С ${changeFrom}`) : '',
    (nightMarkup !== '' && Number(nightMarkup) > 0) ? fieldCard('Ночная наценка', formatMoney(nightMarkup)) : '',
    (subtotal !== '' && Number(subtotal) > 0) ? fieldCard('Сумма товаров', formatMoney(subtotal)) : '',
    comment ? fieldCard('Комментарий клиента', comment, '', true) : ''
  ].filter(Boolean).join('');

  wrap.innerHTML = `
    <div class="detailCard">
      <div class="detailTop">
        <div>
          <h3 style="margin:0">Заказ #${escapeHtml(order.id)}</h3>
          <div class="muted">${escapeHtml(formatDateTime(order.createdAt))} · ${escapeHtml(SITE_LABELS[order.site] || order.site || '—')}</div>
        </div>
        <div class="statusRow">
          <select class="statusSelect" id="statusSelect">${statusOptions}</select>
          <button class="primaryBtn" id="saveStatusBtn">Сохранить статус</button>
        </div>
      </div>
      <div class="detailGrid">${cards}</div>
      <div class="itemsBox"><strong>Состав заказа</strong><ul>${items || '<li>—</li>'}</ul></div>
    </div>`;

  $('#saveStatusBtn').addEventListener('click', async() => {
    const status = $('#statusSelect').value;
    await api(`/admin/orders/${encodeURIComponent(order.id)}/status`, { method:'POST', body: JSON.stringify({ status }) });
    showToast('Статус обновлён');
    await loadOrders(true);
    const refreshed = state.orders.find(x => x.id === order.id);
    if (refreshed) renderDetails(refreshed);
  });
}
function bindEvents(){
  $('#adminToken').value = state.adminToken;
  $('#saveAuthBtn').addEventListener('click', saveAuth);
  $('#adminToken').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveAuth();
  });
  $('#applyFiltersBtn').addEventListener('click', () => { syncFilters(); render(); });
  $('#refreshBtn').addEventListener('click', () => { syncFilters(); loadOrders().catch(err => showToast(err.message)); });
  $('#searchInput').addEventListener('input', () => { syncFilters(); render(); });
  $('#siteFilter').addEventListener('change', () => { syncFilters(); render(); });
  $('#dateMode').addEventListener('change', () => {
    syncFilters();
    $('#dateInput').disabled = $('#dateMode').value !== 'date';
    render();
  });
  $('#dateInput').addEventListener('change', () => { syncFilters(); render(); });
  $$('#statusChips .chip').forEach(btn => btn.addEventListener('click', () => {
    $$('#statusChips .chip').forEach(x => x.classList.remove('isOn'));
    btn.classList.add('isOn');
    state.statusFilter = btn.dataset.status || '';
    render();
  }));
  $('#orderModalBackdrop')?.addEventListener('click', closeOrderModal);
  $('#orderModalClose')?.addEventListener('click', closeOrderModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOrderModal(); });
}
function syncFilters(){
  state.search = $('#searchInput').value || '';
  state.site = $('#siteFilter').value || '';
  state.dateMode = $('#dateMode').value || 'all';
  state.dateValue = $('#dateInput').value || '';
}
(function init(){
  bindEvents();
  updateAuthView(false);
  if (state.adminToken) {
    setConnectionState('Проверка сохранённого пароля...', 'pending');
    verifyConnection(state.adminToken)
      .then(async() => {
        setConnectionState('Подключение установлено.', 'success');
        await requestNotificationPermission();
        return bootstrap();
      })
      .catch(err => {
        updateAuthView(false);
        setConnectionState(err.message || 'Ошибка подключения', 'error');
        showToast(err.message || 'Ошибка подключения');
      });
  } else {
    setConnectionState('Введите пароль для загрузки заказов', '');
  }
})();
