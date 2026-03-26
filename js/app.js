const API_BASE = "https://prozharim-oreder-api.polihov-alexey-a.workers.dev";
const REFRESH_MS = 10000;
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
  dateValue: ''
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function showToast(message){const el=$('#toast');el.textContent=message;el.classList.add('isOn');clearTimeout(showToast._t);showToast._t=setTimeout(()=>el.classList.remove('isOn'),2600)}
function setConnectionState(text, mode=''){const el=$('#connectState'); if(!el) return; el.textContent=text; el.className=`connectState ${mode}`.trim();}
function setAuthBusy(isBusy){const btn=$('#saveAuthBtn'); btn.disabled=isBusy; btn.textContent=isBusy?'Проверка...':'Подключиться';}
async function verifyConnection(token){const res=await fetch(`${API_BASE}/admin/ping`,{headers:{'X-Admin-Token':token}}); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error || 'Ошибка API'); if(!data.hasKv) throw new Error('Worker не видит ORDERS_KV'); return data;}
async function saveAuth(){const token=$('#adminToken').value.trim(); if(!token) return showToast('Введите ADMIN_TOKEN'); setAuthBusy(true); setConnectionState('Проверка подключения...', 'pending'); try{await verifyConnection(token); state.adminToken=token; localStorage.setItem('proz_admin_token',state.adminToken); setConnectionState('Подключено. KV и Worker доступны.', 'success'); showToast('Подключение подтверждено'); await bootstrap();}catch(err){setConnectionState(err.message||'Ошибка подключения', 'error'); showToast(err.message||'Ошибка подключения');}finally{setAuthBusy(false);}}
async function api(path, options={}){if(!state.adminToken) throw new Error('Сначала введи ADMIN_TOKEN'); const res=await fetch(`${API_BASE}${path}`,{...options,headers:{'Content-Type':'application/json','X-Admin-Token':state.adminToken,...(options.headers||{})}}); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error || 'Ошибка API'); return data;}
function formatMoney(n){return `${Math.round(Number(n||0)).toLocaleString('ru-RU')} ₽`}
function formatDateTime(iso){const d=new Date(iso); return d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function getOrderDateKey(order){const d=new Date(order.createdAt); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`}
function applyClientFilters(items){return items.filter(order=>{ if(state.statusFilter && order.status!==state.statusFilter) return false; if(state.site && order.site!==state.site) return false; if(state.dateMode==='date' && state.dateValue && getOrderDateKey(order)!==state.dateValue) return false; const q=state.search.trim().toLowerCase(); if(q){ const hay=[order.id,order.customer?.name,order.customer?.phone,order.delivery?.address,order.delivery?.restaurant,order.comment,SITE_LABELS[order.site]||order.site].filter(Boolean).join(' ').toLowerCase(); if(!hay.includes(q)) return false; } return true; })}
async function bootstrap(){await loadOrders(); startAutoRefresh()}
function startAutoRefresh(){clearInterval(state._timer); if(!state.adminToken) return; state._timer=setInterval(()=>{ if(document.hidden) return; loadOrders(true).catch(()=>{}); }, REFRESH_MS)}
async function loadOrders(silent=false){const data=await api('/admin/orders?limit=500'); const prev=new Set(state.orders.map(x=>x.id)); state.orders=data.items||[]; render(); if(!silent && prev.size){const fresh=state.orders.filter(x=>!prev.has(x.id)).length; if(fresh>0) showToast(`Новых заказов: ${fresh}`)} }
function render(){ const items=applyClientFilters(state.orders); renderStats(items); renderTable(items); const selected=items.find(x=>x.id===state.selectedOrderId) || state.orders.find(x=>x.id===state.selectedOrderId) || null; if(selected && $('#orderModal')?.classList.contains('isOn')) renderDetails(selected); }
function renderStats(items){ const newCount=items.filter(x=>x.status==='new').length; const revenue=items.filter(x=>x.status==='done').reduce((s,x)=>s+Number(x.total||0),0); $('#statNew').textContent=newCount.toLocaleString('ru-RU'); $('#statTotal').textContent=items.length.toLocaleString('ru-RU'); $('#statRevenue').textContent=formatMoney(revenue); }
function statusBadge(status){ return `<span class="statusBadge status-${status}">${STATUS_LABELS[status]||status}</span>` }
function typeLabel(order){const when=order.when?.type==='later'?'Предзаказ':'Ближайшее'; const receive=order.delivery?.type==='pickup'?'Самовывоз':'Доставка'; return `${when}<br>${receive}`}
function renderTable(items){ const body=$('#ordersBody'); if(!items.length){ body.innerHTML='<tr><td colspan="7" class="muted">Заказов нет</td></tr>'; return; } body.innerHTML=items.map(order=>`<tr data-id="${order.id}" class="${order.id===state.selectedOrderId?'isOn':''}"><td>${statusBadge(order.status)}<div style="margin-top:10px;font-weight:800">#${order.id}</div></td><td><strong>${formatDateTime(order.createdAt)}</strong><div class="muted">${new Date(order.createdAt).toLocaleDateString('ru-RU')}</div></td><td><strong>${order.customer?.name||'—'}</strong><div class="muted">${order.customer?.phone||'—'}</div></td><td><strong>${typeLabel(order)}</strong></td><td><strong>${order.delivery?.address||'—'}</strong><div class="muted">${order.comment||'Без комментария'}</div></td><td><strong>${SITE_LABELS[order.site]||order.site||'—'}</strong><div class="muted">${order.delivery?.restaurant||'—'}</div></td><td class="sumCell">${Math.round(Number(order.total||0))}₽</td></tr>`).join('');
 $$('#ordersBody tr[data-id]').forEach(tr=>tr.addEventListener('click',()=>openOrderModal(tr.dataset.id))) }
function openOrderModal(orderId){ state.selectedOrderId=orderId; const order=state.orders.find(x=>x.id===orderId); renderTable(applyClientFilters(state.orders)); renderDetails(order||null); $('#orderModal')?.classList.add('isOn'); document.body.classList.add('modalOpen'); }
function closeOrderModal(){ $('#orderModal')?.classList.remove('isOn'); document.body.classList.remove('modalOpen'); }
function renderDetails(order){
  const wrap = $('#orderDetails');
  if(!order){
    wrap.className = 'orderDetails empty';
    wrap.textContent = 'Выбери заказ из таблицы.';
    return;
  }

  wrap.className = 'orderDetails';

  const statusOptions = Object.entries(STATUS_LABELS)
    .map(([k,v]) => `<option value="${k}" ${order.status===k?'selected':''}>${v}</option>`)
    .join('');

  const items = (order.items || []).map(it => {
    const weight = it.weight ? ` (${it.weight})` : '';
    const variant = it.variantLabel ? ` · ${it.variantLabel}` : '';
    return `<li>${it.name}${weight}${variant} ×${it.qty} — ${it.sum} ₽</li>`;
  }).join('');

  const paymentLabel = order.paymentLabel || order.payment || '—';
  const receiveLabel = order.delivery?.type === 'pickup' ? 'Самовывоз' : 'Доставка';
  const whenLabel = order.when?.type === 'later' ? 'Предзаказ' : 'Ближайшее время';
  const customerName = order.customer?.name || '—';
  const customerPhone = order.customer?.phone || '—';
  const address = order.delivery?.address || '—';
  const restaurantPoint = order.delivery?.restaurant || order.point || order.branch || order.pointName || order.restaurantPoint || order.pickupPoint || '—';
  const deliveryPrice = Number(order.delivery?.price || 0);
  const deliveryBasePrice = Number(order.delivery?.basePrice || 0);
  const minSurcharge = Number(order.delivery?.minimumOrderSurcharge || 0);
  const zone = order.delivery?.zone || order.deliveryZone || '—';
  const entrance = order.delivery?.entrance || '';
  const floor = order.delivery?.floor || '';
  const flat = order.delivery?.flat || '';
  const comment = order.comment || order.delivery?.comment || '';
  const cutleryCount = order.cutlery?.count;
  const cutleryPaidCount = order.cutlery?.paidCount;
  const cutleryPrice = Number(order.cutlery?.price || 0);
  const promoCode = order.promo?.code || '';
  const promoTitle = order.promo?.title || '';
  const promoDiscount = Number(order.promo?.discount || 0);
  const changeFrom = order.changeFrom || order.payment?.changeFrom || '';
  const nightMarkup = Number(order.pricing?.nightMarkup || 0);
  const subtotal = Number(order.subtotal || order.pricing?.subtotal || 0);

  const extraRows = [
    restaurantPoint && restaurantPoint !== '—' ? `<div class="detailBox"><strong>Точка ресторана</strong><div>${restaurantPoint}</div><div class="muted">${SITE_LABELS[order.site]||order.site||'—'}</div></div>` : '',
    order.delivery?.type !== 'pickup' ? `<div class="detailBox"><strong>Доставка</strong><div>${formatMoney(deliveryPrice)}</div><div class="muted">Базовая: ${formatMoney(deliveryBasePrice)}${minSurcharge ? ` · Доплата до минимума: ${formatMoney(minSurcharge)}` : ''}</div></div>` : '',
    zone && zone !== '—' ? `<div class="detailBox"><strong>Зона доставки</strong><div>${zone}</div></div>` : '',
    (entrance || floor || flat) ? `<div class="detailBox"><strong>Подъезд / этаж / квартира</strong><div>${entrance || '—'} / ${floor || '—'} / ${flat || '—'}</div></div>` : '',
    typeof cutleryCount !== 'undefined' ? `<div class="detailBox"><strong>Приборы</strong><div>${cutleryCount || 0} шт.</div><div class="muted">Платных: ${cutleryPaidCount || 0} · ${formatMoney(cutleryPrice)}</div></div>` : '',
    promoCode || promoTitle || promoDiscount ? `<div class="detailBox"><strong>Промокод</strong><div>${promoCode || '—'}</div><div class="muted">${promoTitle || 'Без названия'}${promoDiscount ? ` · Скидка: ${formatMoney(promoDiscount)}` : ''}</div></div>` : '',
    changeFrom ? `<div class="detailBox"><strong>Сдача</strong><div>С ${changeFrom}</div></div>` : '',
    nightMarkup ? `<div class="detailBox"><strong>Ночная наценка</strong><div>${formatMoney(nightMarkup)}</div></div>` : '',
    subtotal ? `<div class="detailBox"><strong>Сумма товаров</strong><div>${formatMoney(subtotal)}</div></div>` : '',
    comment ? `<div class="detailBox detailBox--wide"><strong>Комментарий клиента</strong><div>${comment}</div></div>` : ''
  ].filter(Boolean).join('');

  wrap.innerHTML = `
    <div class="detailCard">
      <div class="detailTop">
        <div>
          <h3 style="margin:0">Заказ #${order.id}</h3>
          <div class="muted">${formatDateTime(order.createdAt)} · ${SITE_LABELS[order.site]||order.site||'—'}</div>
        </div>
        <div class="statusRow">
          <select class="statusSelect" id="statusSelect">${statusOptions}</select>
          <button class="primaryBtn" id="saveStatusBtn">Сохранить статус</button>
        </div>
      </div>

      <div class="detailGrid">
        <div class="detailBox"><strong>Клиент</strong><div>${customerName}</div><div class="muted">${customerPhone}</div></div>
        <div class="detailBox"><strong>Получение</strong><div>${receiveLabel}</div><div class="muted">${address}</div><div class="muted">${whenLabel}</div></div>
        <div class="detailBox"><strong>Оплата</strong><div>${paymentLabel}</div><div class="muted">Итого: ${formatMoney(order.total)}</div></div>
        ${extraRows}
      </div>

      <div class="itemsBox"><strong>Состав заказа</strong><ul>${items || '<li>—</li>'}</ul></div>
    </div>`;

  $('#saveStatusBtn').addEventListener('click', async()=>{
    const status = $('#statusSelect').value;
    await api(`/admin/orders/${encodeURIComponent(order.id)}/status`, { method:'POST', body: JSON.stringify({status}) });
    showToast('Статус обновлён');
    await loadOrders(true);
    const refreshed = state.orders.find(x=>x.id===order.id);
    if(refreshed) renderDetails(refreshed);
  });
}
function bindEvents(){ $('#adminToken').value=state.adminToken; $('#saveAuthBtn').addEventListener('click',saveAuth); $('#applyFiltersBtn').addEventListener('click',()=>{syncFilters(); render();}); $('#refreshBtn').addEventListener('click',()=>{syncFilters(); loadOrders().catch(err=>showToast(err.message));}); $('#searchInput').addEventListener('input',()=>{syncFilters(); render();}); $('#siteFilter').addEventListener('change',()=>{syncFilters(); render();}); $('#dateMode').addEventListener('change',()=>{syncFilters(); $('#dateInput').disabled = $('#dateMode').value !== 'date'; render();}); $('#dateInput').addEventListener('change',()=>{syncFilters(); render();}); $$('#statusChips .chip').forEach(btn=>btn.addEventListener('click',()=>{ $$('#statusChips .chip').forEach(x=>x.classList.remove('isOn')); btn.classList.add('isOn'); state.statusFilter=btn.dataset.status||''; render();})); $('#orderModalBackdrop')?.addEventListener('click', closeOrderModal); $('#orderModalClose')?.addEventListener('click', closeOrderModal); document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeOrderModal(); }); }
function syncFilters(){ state.search=$('#searchInput').value||''; state.site=$('#siteFilter').value||''; state.dateMode=$('#dateMode').value||'all'; state.dateValue=$('#dateInput').value||''; }
(function init(){ bindEvents(); if(state.adminToken){ setConnectionState('Проверка сохранённого токена...', 'pending'); verifyConnection(state.adminToken).then(()=>{ setConnectionState('Подключено. KV и Worker доступны.', 'success'); return bootstrap(); }).catch(err=>{ setConnectionState(err.message||'Ошибка подключения', 'error'); showToast(err.message||'Ошибка подключения'); }); } else { setConnectionState('Введите ADMIN_TOKEN для загрузки заказов', ''); } })();
