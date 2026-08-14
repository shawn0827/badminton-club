/* reports.js — Excel 與 JSON 報表 */
'use strict';

function sheetFromRows(rows, widths = []) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (widths.length) ws['!cols'] = widths.map(wch => ({ wch }));
  if (rows.length > 1 && rows[0]?.length) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  return ws;
}

function createWorkbook() {
  if (!window.XLSX) throw new Error('Excel 元件尚未載入');
  const wb = XLSX.utils.book_new();
  const sessions = [...state.sessions].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const members = [...state.members].sort((a,b)=>String(a.name).localeCompare(String(b.name),'zh-Hant'));
  const attendance = [...state.attendance].sort((a,b)=>String(a.sessionId+a.memberId).localeCompare(String(b.sessionId+b.memberId)));
  const transactions = [...state.transactions].filter(tx=>!tx.voided).sort((a,b)=>String(a.date+a.createdAt).localeCompare(String(b.date+b.createdAt)));
  const inventory = [...state.inventoryPurchases].filter(item=>!item.voided).sort((a,b)=>String(a.date).localeCompare(String(b.date)));

  const totalTopup = transactions.filter(tx=>tx.type==='topup').reduce((s,x)=>s+safeNumber(x.amount),0);
  const totalCharges = Math.abs(transactions.filter(tx=>tx.type==='charge').reduce((s,x)=>s+safeNumber(x.amount),0));
  const inventoryCost = inventory.reduce((s,x)=>s+safeNumber(x.totalCost),0);
  const usedBuckets = sessions.filter(s=>s.status!=='cancelled').reduce((sum,s)=>sum+safeNumber(s.bucketsUsed),0);

  const overview = [
    ['羽球團管理系統－營運總覽',''],
    ['團名', state.settings.clubName],
    ['匯出時間', new Date().toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })],
    ['本季週數', state.settings.seasonWeeks],
    ['球局數', sessions.filter(s=>s.status!=='cancelled').length],
    ['球桶已使用', usedBuckets],
    ['球桶目前庫存', stockBuckets()],
    ['會員目前總餘額', totalMemberBalance()],
    ['累計儲值', totalTopup],
    ['累計球費扣款', totalCharges],
    ['球桶進貨成本', inventoryCost]
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(overview,[24,20]), '營運總覽');

  const memberRows = [['姓名','類型','啟用','分攤球費','目前餘額','本季出席次數','最後更新']];
  members.forEach(member=>{
    const presentCount = attendance.filter(row=>row.memberId===member.id && row.present).length;
    memberRows.push([member.name,member.type,member.active!==false?'是':'否',member.defaultShare!==false?'是':'否',memberBalance(member.id),presentCount,formatDateTime(member.updatedAt)]);
  });
  XLSX.utils.book_append_sheet(wb, sheetFromRows(memberRows,[18,10,9,12,14,14,18]), '團員餘額');

  const sessionRows = [['日期','球局','狀態','使用桶數','每桶價格','本次球費','扣款方式','固定每人扣款','出席人數','已扣總額','最後更新','操作者']];
  sessions.forEach(session=>{
    const rows = attendance.filter(row=>row.sessionId===session.id && row.present);
    sessionRows.push([
      session.date,session.title,session.status==='completed'?'已完成':session.status==='cancelled'?'已取消':'進行中',
      safeNumber(session.bucketsUsed),safeNumber(session.pricePerBucket),safeNumber(session.bucketsUsed)*safeNumber(session.pricePerBucket),
      session.chargeMode==='equal'?'依出席平均':'固定扣款',safeNumber(session.fixedCharge),rows.length,
      rows.reduce((s,r)=>s+safeNumber(r.chargeAmount),0),formatDateTime(session.updatedAt),session.updatedBy||''
    ]);
  });
  XLSX.utils.book_append_sheet(wb, sheetFromRows(sessionRows,[12,18,10,10,12,12,14,14,10,12,18,12]), '球局紀錄');

  const attendanceRows = [['日期','球局','團員','是否出席','本次扣款','分攤設定','最後更新','操作者']];
  attendance.forEach(row=>{
    const session = getSession(row.sessionId); const member = getMember(row.memberId);
    if (!session || !member) return;
    attendanceRows.push([session.date,session.title,member.name,row.present?'是':'否',safeNumber(row.chargeAmount),member.defaultShare!==false?'分攤':'不分攤',formatDateTime(row.updatedAt),row.updatedBy||'']);
  });
  XLSX.utils.book_append_sheet(wb, sheetFromRows(attendanceRows,[12,18,18,10,12,12,18,12]), '出席明細');

  const txRows = [['日期','姓名','類型','金額','備註','球局ID','最後更新','操作者']];
  transactions.forEach(tx=>txRows.push([
    tx.date,tx.memberName||'',tx.type==='topup'?'儲值':tx.type==='charge'?'球費扣款':'手動調整',safeNumber(tx.amount),tx.note||'',tx.sessionId||'',formatDateTime(tx.updatedAt),tx.updatedBy||''
  ]));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(txRows,[12,18,12,12,28,24,18,12]), '流水帳');

  const inventoryRows = [['日期','進貨桶數','每桶成本','總成本','備註','最後更新','操作者']];
  inventory.forEach(item=>inventoryRows.push([item.date,safeNumber(item.buckets),safeNumber(item.unitCost),safeNumber(item.totalCost),item.note||'',formatDateTime(item.updatedAt),item.updatedBy||'']));
  inventoryRows.push([]);
  inventoryRows.push(['目前庫存',stockBuckets()]);
  inventoryRows.push(['累計進貨',inventory.reduce((s,x)=>s+safeNumber(x.buckets),0)]);
  inventoryRows.push(['累計使用',usedBuckets]);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(inventoryRows,[12,12,12,12,28,18,12]), '球桶庫存');

  const settingRows = [
    ['設定項目','目前值'],
    ['團名',state.settings.clubName],
    ['一季週數',safeNumber(state.settings.seasonWeeks)],
    ['每次預設桶數',safeNumber(state.settings.defaultBuckets)],
    ['每桶價格',safeNumber(state.settings.pricePerBucket)],
    ['扣款方式',state.settings.chargeMode==='equal'?'依出席平均':'固定扣款'],
    ['固定每人扣款',safeNumber(state.settings.fixedCharge)]
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromRows(settingRows,[22,24]), '設定');

  return wb;
}

function createWorkbookBlob() {
  const workbook = createWorkbook();
  const array = XLSX.write(workbook, { bookType:'xlsx', type:'array', compression:true });
  return new Blob([array], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function createJsonBackupBlob() {
  const payload = { schema:'badminton-club-drive-v1', exportedAt:nowIso(), data:state };
  return new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
}

function downloadExcel() {
  if (!window.XLSX) return toast('Excel 元件尚未載入', true);
  XLSX.writeFile(createWorkbook(), `羽球團_完整紀錄_${todayTW()}.xlsx`, { compression:true });
}

function downloadJson() {
  const url = URL.createObjectURL(createJsonBackupBlob());
  const a = document.createElement('a');
  a.href = url; a.download = `羽球團_系統還原備份_${todayTW()}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function importJsonFile(file) {
  if (!file) return;
  const raw = JSON.parse(await file.text());
  const incoming = raw.data || raw;
  if (!incoming.settings || !Array.isArray(incoming.members)) throw new Error('JSON 備份格式不完整');
  await replaceState(incoming, { sync:false });
}
