/* google.js — Google 帳號與 Drive Excel/JSON 雲端同步 */
'use strict';

const GOOGLE_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const JSON_MIME = 'application/json';
const CLOUD_EXCEL_NAME = '羽球團_完整紀錄.xlsx';
const CLOUD_JSON_NAME = '羽球團_系統還原備份.json';

let googleAccessToken = '';
let googleTokenExpiresAt = 0;
let googleTokenClient = null;
let googleSessionRestorePromise = null;
let googleSilentReconnectAttempted = false;
let googleSyncPromise = null;

function googleConnected() {
  return Boolean(googleAccessToken && Date.now() < googleTokenExpiresAt);
}

function googleAccountRemembered() {
  return Boolean(device?.google?.connected && device?.google?.email);
}

async function waitForGoogleLibrary(timeout = 7000) {
  const started = Date.now();
  while (!window.google?.accounts?.oauth2 && Date.now() - started < timeout) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return Boolean(window.google?.accounts?.oauth2);
}

async function googleFetch(url, options = {}) {
  if (!googleConnected()) throw new Error('Google Drive 授權已過期，請重新連接');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${googleAccessToken}`);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `Google API 錯誤 ${response.status}`);
  }
  const type = response.headers.get('content-type') || '';
  if (type.includes('json')) return response.json();
  return response;
}

async function rememberGoogleAccount(profile = {}) {
  device.google.connected = true;
  device.google.email = profile.email || device.google.email || '';
  device.google.name = profile.name || device.google.name || '';
  device.google.picture = profile.picture || device.google.picture || '';
  if ((!device.operatorName || device.operatorName === '管理者') && profile.name) device.operatorName = profile.name;
  await saveDevice();
  renderApp();
}

async function connectGoogle({ prompt = 'consent', silent = false, refresh = true } = {}) {
  try {
    const clientId = String(device?.google?.clientId || '').trim();
    if (!clientId) {
      if (!silent) toast('請先在設定輸入 Google OAuth Client ID', true);
      return false;
    }
    if (googleConnected()) return true;
    if (!(await waitForGoogleLibrary())) throw new Error('Google Identity 元件尚未載入');

    await new Promise((resolve, reject) => {
      googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPES,
        callback: async response => {
          if (response.error) return reject(new Error(response.error_description || response.error));
          googleAccessToken = response.access_token;
          googleTokenExpiresAt = Date.now() + Math.max(60, safeNumber(response.expires_in, 3600) - 60) * 1000;
          try {
            const profile = await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo');
            await rememberGoogleAccount(profile);
            resolve();
          } catch (error) { reject(error); }
        },
        error_callback: error => reject(new Error(error?.message || error?.type || 'Google 授權未完成'))
      });
      googleTokenClient.requestAccessToken({ prompt });
    });

    googleSilentReconnectAttempted = false;
    if (refresh) renderApp();
    return true;
  } catch (error) {
    if (!silent) toast(error.message || 'Google 連接失敗', true);
    return false;
  }
}

async function restoreGoogleSession() {
  if (googleConnected()) return true;
  if (!googleAccountRemembered() || !device.google.clientId) return false;
  if (googleSessionRestorePromise) return googleSessionRestorePromise;
  if (googleSilentReconnectAttempted) return false;
  googleSilentReconnectAttempted = true;
  googleSessionRestorePromise = connectGoogle({ prompt:'', silent:true, refresh:false })
    .finally(() => { googleSessionRestorePromise = null; });
  return googleSessionRestorePromise;
}

async function disconnectGoogle() {
  const ok = await confirmAction('斷開 Google Drive', '只會清除這台裝置的 Google 連線，不會刪除雲端 Excel 或 JSON。確定繼續？');
  if (!ok) return;
  if (googleAccessToken && window.google?.accounts?.oauth2) {
    google.accounts.oauth2.revoke(googleAccessToken, () => {});
  }
  googleAccessToken = '';
  googleTokenExpiresAt = 0;
  googleTokenClient = null;
  googleSessionRestorePromise = null;
  googleSilentReconnectAttempted = false;
  device.google.connected = false;
  device.google.email = '';
  device.google.name = '';
  device.google.picture = '';
  await saveDevice();
  renderApp();
  toast('已斷開 Google Drive');
}

async function ensureGoogleFolder() {
  if (device.google.folderId) {
    try {
      const meta = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(device.google.folderId)}?fields=id,name,mimeType,trashed`);
      if (meta && !meta.trashed && meta.mimeType === 'application/vnd.google-apps.folder') return meta.id;
    } catch (_) {
      device.google.folderId = '';
    }
  }

  const folderName = device.google.folderName || '羽球團管理系統備份';
  const escaped = folderName.replaceAll("'", "\\'");
  const query = encodeURIComponent(`name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const result = await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive&pageSize=10`);
  if (result.files?.[0]) {
    device.google.folderId = result.files[0].id;
  } else {
    const folder = await googleFetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ name:folderName, mimeType:'application/vnd.google-apps.folder' })
    });
    device.google.folderId = folder.id;
  }
  await saveDevice();
  return device.google.folderId;
}

async function findGoogleDriveFile(folderId, name) {
  const escaped = name.replaceAll("'", "\\'");
  const query = encodeURIComponent(`name='${escaped}' and '${folderId}' in parents and trashed=false`);
  const result = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)&spaces=drive&pageSize=10`
  );
  return result.files?.[0] || null;
}

async function createGoogleDriveFileMetadata(folderId, name, mimeType) {
  return googleFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,size,modifiedTime,webViewLink', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ name, parents:[folderId], mimeType })
  });
}

async function upsertGoogleDriveFile(folderId, name, blob, mimeType) {
  let file = await findGoogleDriveFile(folderId, name);
  if (!file) file = await createGoogleDriveFileMetadata(folderId, name, mimeType);
  await googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`, {
    method:'PATCH', headers:{'Content-Type':mimeType}, body:blob
  });
  const verified = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?fields=id,name,mimeType,size,modifiedTime,webViewLink`
  );
  if (verified.name !== name) throw new Error(`雲端檔名驗證失敗：${name}`);
  if (verified.mimeType !== mimeType) throw new Error(`雲端格式驗證失敗：${name}`);
  if (safeNumber(verified.size) <= 0) throw new Error(`雲端檔案內容為空：${name}`);
  return verified;
}

async function downloadGoogleJsonBackup({ optional = false } = {}) {
  const folderId = await ensureGoogleFolder();
  const file = await findGoogleDriveFile(folderId, CLOUD_JSON_NAME);
  if (!file) {
    if (optional) return null;
    throw new Error('Google Drive 找不到羽球團 JSON 備份');
  }
  const payload = await googleFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  return { file, payload };
}

async function syncGoogleDrive({ silent = false, mergeFirst = true } = {}) {
  if (googleSyncPromise) return googleSyncPromise;
  googleSyncPromise = (async () => {
    try {
      if (!googleConnected() && googleAccountRemembered()) await restoreGoogleSession();
      if (!googleConnected()) {
        const connected = await connectGoogle({ prompt:'consent', silent, refresh:false });
        if (!connected || !googleConnected()) return false;
      }
      if (!window.XLSX) throw new Error('Excel 元件尚未載入，無法建立雲端 Excel');
      if (!silent) setLoading(true, '同步 Google Drive…');

      const folderId = await ensureGoogleFolder();
      if (mergeFirst) {
        const cloud = await downloadGoogleJsonBackup({ optional:true });
        if (cloud?.payload) {
          const incoming = cloud.payload.data || cloud.payload;
          state = mergeStates(state, incoming);
          state.sessions.forEach(session => recalcSessionCharges(session.id));
          state.meta.updatedAt = nowIso();
          await dbSet(STATE_KEY, state);
        }
      }

      const excel = await upsertGoogleDriveFile(folderId, CLOUD_EXCEL_NAME, createWorkbookBlob(), EXCEL_MIME);
      const json = await upsertGoogleDriveFile(folderId, CLOUD_JSON_NAME, createJsonBackupBlob(), JSON_MIME);
      device.google.lastSyncAt = nowIso();
      device.google.lastExcel = excel;
      device.google.lastJson = json;
      await saveDevice();
      renderApp();
      if (!silent) toast('Google Drive 已更新 Excel＋JSON');
      return true;
    } catch (error) {
      console.error(error);
      if (!silent) toast(`Google Drive 同步失敗：${error.message}`, true);
      return false;
    } finally {
      if (!silent) setLoading(false);
      googleSyncPromise = null;
    }
  })();
  return googleSyncPromise;
}

async function restoreGoogleDriveBackup() {
  if (!googleConnected() && googleAccountRemembered()) await restoreGoogleSession();
  if (!googleConnected()) {
    const connected = await connectGoogle({ prompt:'consent', silent:false, refresh:false });
    if (!connected) return;
  }
  const confirmed = await confirmAction('從 Google Drive 還原', '會以雲端 JSON 覆蓋這台裝置目前的資料。確定繼續？');
  if (!confirmed) return;
  setLoading(true, '從雲端還原…');
  try {
    const cloud = await downloadGoogleJsonBackup();
    const incoming = cloud.payload.data || cloud.payload;
    await replaceState(incoming, { sync:false });
    device.google.lastSyncAt = nowIso();
    await saveDevice();
    toast('已從 Google Drive 還原');
  } catch (error) {
    toast(`還原失敗：${error.message}`, true);
  } finally { setLoading(false); }
}

function openCloudExcel() {
  const url = device?.google?.lastExcel?.webViewLink;
  if (!url) return toast('尚未同步 Excel 到 Google Drive', true);
  window.open(url, '_blank', 'noopener');
}

function openCloudFolder() {
  const id = device?.google?.folderId;
  if (!id) return toast('尚未建立 Google Drive 備份資料夾', true);
  window.open(`https://drive.google.com/drive/folders/${encodeURIComponent(id)}`, '_blank', 'noopener');
}
