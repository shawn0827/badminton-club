/* app.js — UI 與操作綁定 */
'use strict';

function go(route) {
  currentRoute = route;
  $$('.bottom-nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.route === route));
  renderApp();
  window.scrollTo({ top:0, behavior:'smooth' });
}

function updateHeader() {
  if (!state || !device) return;
  $('#clubTitle').textContent = state.settings.clubName || '羽球團';
  const name = device.google.connected ? (device.google.name || device.google.email || 'Google 已連接') : '未連 Google';
  $('#accountName').textContent = name;
  const avatar = $('#accountAvatar');
  avatar.innerHTML = device.google.picture ? `<img src="${escAttr(device.google.picture)}" alt="">` : (device.google.connected ? 'G' : '○');
}

function cloudStatusLabel() {
  if (!device.google.clientId) return '尚未設定 Google Client ID';
  if (!device.google.connected) return googleAccountRemembered() ? '已記住帳號，Drive 權限待續接' : '尚未連接 Google Drive';
  if (!device.google.lastSyncAt) return '已連接，尚未同步';
  return `已同步 ${formatDateTime(device.google.lastSyncAt)}`;
}

function homePage() {
  const session = todaySession();
  const recent = combinedLedger().slice(0,5);
  const seasonCount = state.sessions.filter(s=>s.status!=='cancelled').length;
  const defaultCost = safeNumber(state.settings.defaultBuckets)*safeNumber(state.settings.pricePerBucket);
  return `<section class="page">
    <div class="hero card">
      <div><div class="eyebrow">TODAY</div><h2>${formatDate(todayTW())} 羽球</h2><div class="muted">${session ? (session.status==='completed'?'今日球局已完成':'今日球局進行中') : '今天尚未建立球局'}</div></div>
      <button class="primary-button" data-home-session>${session?'查看今日球局':'開始今日球局'}</button>
    </div>
    <div class="stats-grid">
      <div class="stat card"><span>球桶庫存</span><strong>${money(stockBuckets())}</strong><small>桶</small></div>
      <div class="stat card"><span>會員總餘額</span><strong>$${money(totalMemberBalance())}</strong><small>預收餘額</small></div>
      <div class="stat card"><span>本季球局</span><strong>${seasonCount}</strong><small>/ ${safeNumber(state.settings.seasonWeeks,12)} 週</small></div>
      <div class="stat card"><span>預設球費</span><strong>$${money(defaultCost)}</strong><small>${state.settings.defaultBuckets} 桶 × $${money(state.settings.pricePerBucket)}</small></div>
    </div>
    ${session ? renderTodaySummary(session) : ''}
    <div class="section-head"><h3>Google 雲端</h3><button class="ghost-button" data-route-jump="settings">設定</button></div>
    <div class="card cloud-status"><span class="cloud-dot ${device.google.connected?'ok':device.google.clientId?'warn':''}"></span><div><strong>${esc(cloudStatusLabel())}</strong><div class="muted">同步後會在 Google Drive 建立真正的 .xlsx Excel＋JSON 還原備份</div></div></div>
    <div class="section-head"><h3>最近帳務</h3><button class="ghost-button" data-route-jump="ledger">全部</button></div>
    <div class="card list">${recent.length?recent.map(ledgerRow).join(''):emptyRow('目前沒有帳務紀錄')}</div>
  </section>`;
}

function renderTodaySummary(session) {
  const rows = sessionAttendance(session.id).filter(a=>a.present);
  const charged = rows.reduce((s,x)=>s+safeNumber(x.chargeAmount),0);
  return `<button class="card" data-home-session style="text-align:left;width:100%;border-color:var(--line);color:var(--ink)">
    <div class="section-head"><div><div class="eyebrow">今日球局</div><h3>${esc(session.title)}</h3></div><span class="pill ${session.status==='completed'?'done':''}">${session.status==='completed'?'已完成':'進行中'}</span></div>
    <div class="muted">${session.bucketsUsed} 桶 × $${money(session.pricePerBucket)} = $${money(session.bucketsUsed*session.pricePerBucket)}｜${rows.length} 人出席｜已扣 $${money(charged)}</div>
  </button>`;
}

function sessionPage() {
  const session = todaySession();
  if (!session) return `<section class="page"><div class="section-head sticky"><div><div class="eyebrow">SESSION</div><h2>今日球局</h2></div></div><div class="empty card"><div class="icon">🏸</div><h3>今天還沒有球局</h3><p>建立後預設使用 ${state.settings.defaultBuckets} 桶、每桶 $${money(state.settings.pricePerBucket)}。</p><button class="primary-button full" data-start-session>開始今日球局</button></div></section>`;

  const rows = sessionAttendance(session.id);
  const attendanceMap = Object.fromEntries(rows.map(row=>[row.memberId,row]));
  const members = activeMembers();
  const present = rows.filter(row=>row.present);
  const charged = present.reduce((sum,row)=>sum+safeNumber(row.chargeAmount),0);
  const totalCost = safeNumber(session.bucketsUsed)*safeNumber(session.pricePerBucket);
  const completed = session.status === 'completed';

  return `<section class="page">
    <div class="section-head sticky"><div><div class="eyebrow">SESSION</div><h2>${formatDate(session.date)} 羽球</h2></div><span class="pill ${completed?'done':''}">${completed?'已完成':'進行中'}</span></div>
    <div class="card session-cost">
      <div class="field-row"><label>使用球桶</label><div class="stepper"><button data-bucket-step="-1" ${completed?'disabled':''}>−</button><strong>${money(session.bucketsUsed)}</strong><button data-bucket-step="1" ${completed?'disabled':''}>＋</button></div></div>
      <div class="field-row"><label>每桶價格</label><div class="money-input"><span>$</span><input id="sessionPrice" type="number" inputmode="numeric" value="${safeNumber(session.pricePerBucket)}" ${completed?'disabled':''}></div></div>
      <div class="divider"></div>
      <div class="field-row total"><label>本次球費</label><strong>$${money(totalCost)}</strong></div>
      <label class="field"><span>扣款方式</span><select id="sessionChargeMode" ${completed?'disabled':''}><option value="fixed" ${session.chargeMode==='fixed'?'selected':''}>固定每人扣款</option><option value="equal" ${session.chargeMode==='equal'?'selected':''}>依實際出席平均分攤</option></select></label>
      <label class="field ${session.chargeMode==='equal'?'hidden':''}" id="fixedChargeField"><span>固定每人扣款</span><input id="sessionFixedCharge" type="number" inputmode="numeric" value="${safeNumber(session.fixedCharge)}" ${completed?'disabled':''}></label>
      ${!completed?'<button class="secondary-button full" data-save-session>儲存本次設定</button>':''}
    </div>
    <div class="section-head"><h3>出席勾選</h3><span class="muted">${present.length} 人｜已扣 $${money(charged)}</span></div>
    <div class="attendance-grid">${members.map(member=>attendanceCard(member,attendanceMap[member.id],completed)).join('')}</div>
    <div class="button-row">${completed?'<button class="secondary-button full" data-reopen-session>重新開啟球局</button>':'<button class="primary-button full" data-complete-session>✓ 完成本日球局</button>'}</div>
  </section>`;
}

function attendanceCard(member, row, completed) {
  const present = Boolean(row?.present);
  return `<button class="attendance-card ${present?'present':''}" data-attendance="${escAttr(member.id)}" ${completed?'disabled':''}>
    <span class="check">${present?'✓':''}</span><strong>${esc(member.name)}</strong><small>${esc(member.type)}｜${member.defaultShare!==false?'分攤球費':'不分攤'}</small>
    <div class="charge">${present?(safeNumber(row?.chargeAmount)>0?`扣 $${money(row.chargeAmount)}`:'已出席'):'點一下出席'}</div>
  </button>`;
}

function membersPage() {
  const members = [...state.members].sort((a,b)=>Number(b.active!==false)-Number(a.active!==false)||String(a.name).localeCompare(String(b.name),'zh-Hant'));
  return `<section class="page">
    <div class="section-head sticky"><div><div class="eyebrow">MEMBERS</div><h2>團員</h2></div><button class="primary-button small" data-add-member>＋ 新增</button></div>
    <div class="member-list">${members.length?members.map(memberCard).join(''):'<div class="empty card">尚無團員</div>'}</div>
  </section>`;
}

function memberCard(member) {
  const balance = memberBalance(member.id);
  const presentCount = state.attendance.filter(row=>row.memberId===member.id&&row.present).length;
  return `<div class="member-card card" style="opacity:${member.active!==false?1:.55}">
    <div class="top"><div><h3>${esc(member.name)}</h3><div class="muted">${esc(member.type)}｜${member.defaultShare!==false?'分攤球費':'不分攤'}｜出席 ${presentCount} 次${member.active===false?'｜已停用':''}</div></div><div class="balance ${balance<=0?'low':''}">$${money(balance)}</div></div>
    <div class="member-actions"><button class="primary-button small" data-topup="${escAttr(member.id)}">＋ 儲值</button><button class="secondary-button small" data-adjust="${escAttr(member.id)}">± 調整</button><button class="secondary-button small" data-edit-member="${escAttr(member.id)}">編輯</button></div>
  </div>`;
}

function ledgerPage() {
  return `<section class="page">
    <div class="section-head sticky"><div><div class="eyebrow">LEDGER</div><h2>流水帳</h2></div><div class="button-row"><button class="secondary-button small" data-download-excel>Excel</button><button class="secondary-button small" data-download-json>JSON</button></div></div>
    <div class="card list">${combinedLedger().length?combinedLedger().map(ledgerRow).join(''):emptyRow('目前沒有帳務紀錄')}</div>
  </section>`;
}

function ledgerRow(item) {
  const type = item.kind==='topup'?'儲值':item.kind==='charge'?'球費':item.kind==='adjustment'?'調整':'球桶進貨';
  return `<div class="list-row"><div class="meta"><strong>${esc(item.title)}</strong><small>${formatDate(item.date)}｜${type}${item.note?'｜'+esc(item.note):''}${item.operator?'｜'+esc(item.operator):''}</small></div><strong class="amount ${item.amount>=0?'plus':'minus'}">${item.amount>=0?'+':'−'}$${money(Math.abs(item.amount))}</strong></div>`;
}

function emptyRow(text) { return `<div class="empty">${esc(text)}</div>`; }

function settingsPage() {
  const g = device.google;
  return `<section class="page">
    <div class="section-head sticky"><div><div class="eyebrow">SETTINGS</div><h2>設定</h2></div></div>

    <div class="card cloud-card">
      <div class="section-head"><div><h3 style="margin:0">Google Drive Excel</h3><div class="muted">與民宿系統相同架構</div></div><span class="pill ${g.connected?'done':'warn'}">${g.connected?'已連接':'未連接'}</span></div>
      <div class="cloud-status"><span class="cloud-dot ${g.connected?'ok':g.clientId?'warn':''}"></span><div><strong>${esc(cloudStatusLabel())}</strong>${g.email?`<div class="muted">${esc(g.email)}</div>`:''}</div></div>
      <label class="field"><span>Google OAuth Client ID</span><input id="googleClientId" value="${escAttr(g.clientId||'')}" placeholder="xxxxx.apps.googleusercontent.com"></label>
      <label class="field"><span>這台裝置的管理者名稱</span><input id="operatorName" value="${escAttr(device.operatorName||'管理者')}" placeholder="例如：Shawn"></label>
      <label class="field"><span>Google Drive 資料夾名稱</span><input id="folderName" value="${escAttr(g.folderName||'羽球團管理系統備份')}"></label>
      <label class="switch-row"><span>操作後自動同步 Excel＋JSON</span><input id="autoSync" type="checkbox" ${device.autoSync?'checked':''}></label>
      <div class="notice">兩位管理者若要像同一套系統使用，最簡單穩定的方式是兩台裝置都連到同一個「羽球團專用 Google 帳號」。同步時會先合併雲端 JSON，再重新產生 Excel。</div>
      <div class="button-row"><button class="primary-button" data-save-google>儲存設定</button>${g.connected?'<button class="secondary-button" data-sync-google>立即同步</button>':'<button class="secondary-button" data-connect-google>連接 Google</button>'}</div>
      ${g.connected?`<div class="button-row"><button class="secondary-button" data-open-excel>開啟雲端 Excel</button><button class="secondary-button" data-open-folder>開啟資料夾</button></div><div class="button-row"><button class="secondary-button" data-restore-cloud>從雲端還原</button><button class="danger-button" data-disconnect-google>斷開連接</button></div>`:''}
      <div class="cloud-files">
        ${g.lastExcel?cloudFileRow('Excel',g.lastExcel):''}${g.lastJson?cloudFileRow('JSON',g.lastJson):''}
      </div>
    </div>

    <div class="card">
      <h3>球局預設</h3>
      <label class="field"><span>團名</span><input id="clubName" value="${escAttr(state.settings.clubName)}"></label>
      <div class="two-col"><label class="field"><span>一季週數</span><input id="seasonWeeks" type="number" value="${safeNumber(state.settings.seasonWeeks)}"></label><label class="field"><span>每次桶數</span><input id="defaultBuckets" type="number" value="${safeNumber(state.settings.defaultBuckets)}"></label><label class="field"><span>每桶價格</span><input id="pricePerBucket" type="number" value="${safeNumber(state.settings.pricePerBucket)}"></label><label class="field"><span>固定每人扣款</span><input id="fixedCharge" type="number" value="${safeNumber(state.settings.fixedCharge)}"></label></div>
      <label class="field"><span>預設扣款方式</span><select id="chargeMode"><option value="fixed" ${state.settings.chargeMode==='fixed'?'selected':''}>固定每人扣款</option><option value="equal" ${state.settings.chargeMode==='equal'?'selected':''}>依實際出席平均分攤</option></select></label>
      <button class="primary-button full" data-save-settings>儲存球局設定</button>
    </div>

    <div class="card"><h3>球桶庫存</h3><div style="font-size:36px;font-weight:900;margin:8px 0">${money(stockBuckets())} <small style="font-size:14px;color:var(--muted)">桶</small></div><div class="two-col"><label class="field"><span>進貨桶數</span><input id="inventoryBuckets" type="number" value="10"></label><label class="field"><span>每桶成本</span><input id="inventoryCost" type="number" value="700"></label></div><label class="field"><span>備註</span><input id="inventoryNote" placeholder="例如：8月進貨"></label><button class="primary-button full" data-add-inventory>＋ 記錄進貨</button></div>

    <div class="card"><h3>本機備份</h3><p class="hint">即使沒有 Google，也可以手動下載 Excel 與 JSON。JSON 可完整還原 App 資料。</p><div class="button-row"><button class="secondary-button" data-download-excel>下載 Excel</button><button class="secondary-button" data-download-json>下載 JSON</button></div><label class="secondary-button full" style="display:block;text-align:center;margin-top:8px">匯入 JSON<input id="importJson" type="file" accept="application/json" hidden></label></div>
  </section>`;
}

function cloudFileRow(label, file) {
  return `<div class="cloud-file"><div><strong>${label}｜${esc(file.name||'')}</strong><small>${file.modifiedTime?formatDateTime(file.modifiedTime):''}｜${money(file.size||0)} bytes</small></div><span class="pill done">OK</span></div>`;
}

function renderApp() {
  if (!state || !device) return;
  updateHeader();
  const app = $('#app');
  app.innerHTML = currentRoute==='session'?sessionPage():currentRoute==='members'?membersPage():currentRoute==='ledger'?ledgerPage():currentRoute==='settings'?settingsPage():homePage();
  bindPageEvents();
}

function bindPageEvents() {
  $$('[data-route-jump]').forEach(btn=>btn.onclick=()=>go(btn.dataset.routeJump));
  $$('[data-home-session]').forEach(btn=>btn.onclick=async()=>{if(!todaySession()){createTodaySession();await saveState();}go('session');});
  $$('[data-start-session]').forEach(btn=>btn.onclick=async()=>{createTodaySession();await saveState();go('session');});
  $$('[data-attendance]').forEach(btn=>btn.onclick=async()=>{try{await toggleAttendance(btn.dataset.attendance);}catch(e){toast(e.message,true);}});
  $$('[data-bucket-step]').forEach(btn=>btn.onclick=async()=>{const s=todaySession();const next=Math.max(0,safeNumber(s.bucketsUsed)+safeNumber(btn.dataset.bucketStep));await updateSession(s.id,{bucketsUsed:next});});
  $('#sessionChargeMode')?.addEventListener('change',e=>$('#fixedChargeField')?.classList.toggle('hidden',e.target.value==='equal'));
  $('[data-save-session]')?.addEventListener('click',async()=>{const s=todaySession();await updateSession(s.id,{pricePerBucket:Math.max(0,safeNumber($('#sessionPrice').value)),chargeMode:$('#sessionChargeMode').value,fixedCharge:Math.max(0,safeNumber($('#sessionFixedCharge').value))});toast('本次設定已儲存');});
  $('[data-complete-session]')?.addEventListener('click',async()=>{await setSessionStatus(todaySession().id,'completed');toast('本日球局已完成');});
  $('[data-reopen-session]')?.addEventListener('click',async()=>{await setSessionStatus(todaySession().id,'open');toast('球局已重新開啟');});

  $('[data-add-member]')?.addEventListener('click',()=>openMemberDialog());
  $$('[data-edit-member]').forEach(btn=>btn.onclick=()=>openMemberDialog(btn.dataset.editMember));
  $$('[data-topup]').forEach(btn=>btn.onclick=()=>openMoneyDialog(btn.dataset.topup,'topup'));
  $$('[data-adjust]').forEach(btn=>btn.onclick=()=>openMoneyDialog(btn.dataset.adjust,'adjustment'));

  $$('[data-download-excel]').forEach(btn=>btn.onclick=downloadExcel);
  $$('[data-download-json]').forEach(btn=>btn.onclick=downloadJson);

  $('[data-save-google]')?.addEventListener('click',saveGoogleSettingsFromForm);
  $('[data-connect-google]')?.addEventListener('click',async()=>{await saveGoogleSettingsFromForm(false);const ok=await connectGoogle({prompt:'consent'});if(ok) await syncGoogleDrive({silent:false,mergeFirst:true});});
  $('[data-sync-google]')?.addEventListener('click',()=>syncGoogleDrive({silent:false,mergeFirst:true}));
  $('[data-open-excel]')?.addEventListener('click',openCloudExcel);
  $('[data-open-folder]')?.addEventListener('click',openCloudFolder);
  $('[data-restore-cloud]')?.addEventListener('click',restoreGoogleDriveBackup);
  $('[data-disconnect-google]')?.addEventListener('click',disconnectGoogle);

  $('[data-save-settings]')?.addEventListener('click',async()=>{await saveClubSettings({clubName:$('#clubName').value.trim()||'我的羽球團',seasonWeeks:Math.max(1,Math.round(safeNumber($('#seasonWeeks').value,12))),defaultBuckets:Math.max(0,Math.round(safeNumber($('#defaultBuckets').value,2))),pricePerBucket:Math.max(0,Math.round(safeNumber($('#pricePerBucket').value,700))),fixedCharge:Math.max(0,Math.round(safeNumber($('#fixedCharge').value,350))),chargeMode:$('#chargeMode').value});toast('球局設定已儲存');});
  $('[data-add-inventory]')?.addEventListener('click',async()=>{try{await addInventoryPurchase($('#inventoryBuckets').value,$('#inventoryCost').value,$('#inventoryNote').value);toast('球桶進貨已記錄');}catch(e){toast(e.message,true);}});
  $('#importJson')?.addEventListener('change',async event=>{try{const ok=await confirmAction('匯入 JSON','會覆蓋這台裝置目前資料，確定繼續？');if(!ok)return;await importJsonFile(event.target.files[0]);toast('JSON 已匯入');}catch(e){toast(e.message,true);}finally{event.target.value='';}});
}

async function saveGoogleSettingsFromForm(showToast = true) {
  const nextClientId = ($('#googleClientId')?.value || '').trim();
  const nextFolderName = ($('#folderName')?.value || '羽球團管理系統備份').trim() || '羽球團管理系統備份';
  if (device.google.folderName && device.google.folderName !== nextFolderName) {
    device.google.folderId = '';
    device.google.lastExcel = null;
    device.google.lastJson = null;
  }
  if (device.google.clientId && device.google.clientId !== nextClientId) {
    googleAccessToken = '';
    googleTokenExpiresAt = 0;
    device.google.connected = false;
    device.google.email = '';
    device.google.name = '';
    device.google.picture = '';
  }
  device.google.clientId = nextClientId;
  device.operatorName = ($('#operatorName')?.value || '管理者').trim() || '管理者';
  device.google.folderName = nextFolderName;
  device.autoSync = Boolean($('#autoSync')?.checked);
  await saveDevice();
  renderApp();
  if (showToast) toast('Google 設定已儲存');
}

function openMemberDialog(memberId = '') {
  const member = memberId ? getMember(memberId) : null;
  const body = $('#formDialogBody');
  body.innerHTML = `<div class="dialog-head"><h3>${member?'編輯團員':'新增團員'}</h3><button value="cancel" class="icon-button">×</button></div><label class="field"><span>姓名</span><input id="dlgMemberName" value="${escAttr(member?.name||'')}" required></label><label class="field"><span>類型</span><select id="dlgMemberType"><option ${member?.type==='固定'?'selected':''}>固定</option><option ${member?.type==='臨打'?'selected':''}>臨打</option><option ${member?.type==='其他'?'selected':''}>其他</option></select></label><label class="switch-row"><span>納入球費分攤</span><input id="dlgMemberShare" type="checkbox" ${member?.defaultShare!==false?'checked':''}></label>${member?`<label class="switch-row"><span>啟用團員</span><input id="dlgMemberActive" type="checkbox" ${member.active!==false?'checked':''}></label>`:''}<button type="button" class="primary-button full" id="dlgMemberSave">儲存</button>`;
  const dialog = $('#formDialog'); dialog.showModal();
  $('#dlgMemberSave').onclick=async()=>{try{await saveMember({id:member?.id,name:$('#dlgMemberName').value,type:$('#dlgMemberType').value,defaultShare:$('#dlgMemberShare').checked,active:member?$('#dlgMemberActive').checked:true});dialog.close();toast('團員已儲存');}catch(e){toast(e.message,true);}};
}

function openMoneyDialog(memberId, type) {
  const member = getMember(memberId); if(!member)return;
  const isTopup = type==='topup';
  const body = $('#formDialogBody');
  body.innerHTML = `<div class="dialog-head"><h3>${isTopup?'儲值':'手動調整'}｜${esc(member.name)}</h3><button value="cancel" class="icon-button">×</button></div><div class="muted" style="margin-bottom:12px">目前餘額 $${money(memberBalance(member.id))}</div><label class="field"><span>金額${isTopup?'':'（可輸入負數）'}</span><input id="dlgMoneyAmount" type="number" inputmode="numeric" value="${isTopup?4200:''}"></label><label class="field"><span>備註</span><input id="dlgMoneyNote" placeholder="${isTopup?'例如：本季季繳':'例如：人工修正'}"></label><button type="button" class="primary-button full" id="dlgMoneySave">記錄</button>`;
  const dialog=$('#formDialog');dialog.showModal();
  $('#dlgMoneySave').onclick=async()=>{try{await addMemberMoney(memberId,type,$('#dlgMoneyAmount').value,$('#dlgMoneyNote').value);dialog.close();toast('帳務已記錄');}catch(e){toast(e.message,true);}};
}

async function initApp() {
  setLoading(true,'載入資料…');
  try {
    await loadLocalData();
    updateHeader();
    renderApp();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
    if (googleAccountRemembered()) restoreGoogleSession().then(ok=>{if(ok)renderApp();}).catch(console.warn);
  } catch (error) {
    console.error(error); toast(`啟動失敗：${error.message}`,true);
  } finally { setLoading(false); }
}

$$('.bottom-nav button').forEach(btn=>btn.addEventListener('click',()=>go(btn.dataset.route)));
$('#homeBrand').addEventListener('click',()=>go('home'));
$('#accountButton').addEventListener('click',()=>go('settings'));
window.addEventListener('focus',()=>{if(googleAccountRemembered()&&!googleConnected())restoreGoogleSession().catch(()=>{});});
document.addEventListener('DOMContentLoaded',initApp);
