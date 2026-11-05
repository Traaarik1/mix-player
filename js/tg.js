// Telegram: вход своим аккаунтом и загрузка музыки из канала.
// Библиотека teleproto (поддерживаемый форк GramJS), версия зафиксирована.
const LIB = 'https://esm.sh/teleproto@1.232.1?bundle&alias=crypto:crypto-browserify';
let mod, client;

async function lib() {
  if (mod) return mod;
  const { Buffer } = await import('https://esm.sh/buffer@6.0.3');
  globalThis.Buffer ??= Buffer;
  globalThis.process ??= { env: {}, versions: {}, browser: true };
  mod = await import(LIB);
  return mod;
}

export async function connect({ apiId, apiHash, session = '' }) {
  const { TelegramClient, sessions } = await lib();
  if (client) { try { await client.disconnect(); } catch {} }
  client = new TelegramClient(new sessions.StringSession(session), Number(apiId), apiHash, { connectionRetries: 5, useWSS: true });
  client.setLogLevel('error');
  await client.connect();
  return client;
}

// false только если Telegram прямо сказал, что сессии больше нет. Сетевой сбой — это ошибка, а не выход из аккаунта.
export async function authorized() {
  const { Api } = await lib();
  try { await client.invoke(new Api.updates.GetState()); return true; }
  catch (e) {
    if (/AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|AUTH_KEY_DUPLICATED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/.test(e.errorMessage || e.message || '')) return false;
    throw e;
  }
}
// После сна телефона: поднимаем то же соединение, не трогая идущие загрузки
export async function reconnect() { if (client && !client.connected) await client.connect(); }

// phone/code/password — async-функции, которые спрашивают у человека в интерфейсе
export const login = ({ phone, code, password, onError }) =>
  client.start({ phoneNumber: phone, phoneCode: code, password, onError });

export const session = () => client.session.save();
export async function logout() { try { await client.invoke(new (await lib()).Api.auth.LogOut()); } catch {} }

export async function chats() {
  // архивные чаты лежат в отдельной папке и в обычный список не попадают
  const [main, archived] = await Promise.all([client.getDialogs({ limit: 1000 }), client.getDialogs({ limit: 500, folder: 1 }).catch(() => [])]);
  return [...main, ...archived]
    .filter(d => d.isChannel || d.isGroup || d.entity?.self)
    .map(d => ({ id: d.id.toString(), title: d.entity?.self ? 'Избранное' : d.title, entity: d.entity, isChannel: d.isChannel }));
}

export async function* audioMessages(entity) {
  const { Api } = await lib();
  for await (const m of client.iterMessages(entity, { filter: new Api.InputMessagesFilterMusic() })) {
    const doc = m.media?.document;
    if (!doc) continue;
    const audio = doc.attributes.find(a => a.className === 'DocumentAttributeAudio');
    const file = doc.attributes.find(a => a.className === 'DocumentAttributeFilename');
    yield {
      msg: m, msgId: m.id, docId: doc.id.toString(), size: Number(doc.size), mime: doc.mimeType || 'audio/mpeg',
      title: audio?.title || '', artist: audio?.performer || '', duration: audio?.duration || 0,
      fileName: file?.fileName || '', date: m.date, hasThumb: !!doc.thumbs?.length,
    };
  }
}

// Одно сообщение по id — если трек надо скачать, а канал в этот запуск ещё не просматривали
export async function message(entity, msgId) {
  const [m] = await client.getMessages(entity, { ids: [msgId] });
  if (!m?.media?.document) return null;
  const doc = m.media.document;
  return { msg: m, msgId: m.id, docId: doc.id.toString(), size: Number(doc.size), mime: doc.mimeType || 'audio/mpeg', hasThumb: !!doc.thumbs?.length };
}

export async function download(item, onProgress) {
  const buf = await client.downloadMedia(item.msg, { progressCallback: (d, t) => onProgress?.(Number(d) / Number(t || item.size)) });
  return new Blob([buf], { type: item.mime });
}

// Перезалить аудио в тот же пост канала с правильными названием, артистом и обложкой.
// Пост остаётся на месте (это редактирование, а не удаление и новая публикация).
export async function editAudio(entity, msgId, { blob, fileName, mime, title, performer, duration, thumb }) {
  const { Api } = await lib();
  // Сначала убеждаемся, что под этим номером лежит именно аудио: чужой или текстовый пост не трогаем
  const [cur] = await client.getMessages(entity, { ids: [msgId] });
  const doc = cur?.media?.document;
  if (!doc?.attributes?.some(a => a.className === 'DocumentAttributeAudio') || cur.fwdFrom) throw Object.assign(new Error('NOT_EDITABLE_POST'), { errorMessage: 'NOT_EDITABLE_POST' });
  // Без новой обложки редактирование стёрло бы старую — переносим её
  if (!thumb && doc.thumbs?.length) {
    const old = await client.downloadMedia(cur, { thumb: doc.thumbs.length - 1 }).catch(() => null);
    if (!old?.length) throw Object.assign(new Error('NOT_EDITABLE_POST'), { errorMessage: 'NOT_EDITABLE_POST' });
    thumb = new Blob([old], { type: 'image/jpeg' });
  }
  const file = await client.uploadFile({ file: new File([blob], fileName, { type: mime }), workers: 4 });
  const th = thumb ? await client.uploadFile({ file: new File([thumb], 'cover.jpg', { type: 'image/jpeg' }), workers: 1 }) : undefined;
  await client.invoke(new Api.messages.EditMessage({
    peer: entity, id: msgId, message: cur.message || '', entities: cur.entities || undefined,
    media: new Api.InputMediaUploadedDocument({
      file, thumb: th, mimeType: mime,
      attributes: [
        new Api.DocumentAttributeAudio({ duration: Math.round(duration || 0), title, performer }),
        new Api.DocumentAttributeFilename({ fileName }),
      ],
    }),
  }));
}

export async function downloadThumb(item) {
  try {
    const thumbs = item.msg.media.document.thumbs;
    const buf = await client.downloadMedia(item.msg, { thumb: thumbs.length - 1 });
    return buf?.length ? new Blob([buf], { type: 'image/jpeg' }) : null;
  } catch { return null; }
}

// ---------- файл синхронизации в «Избранном» ----------
// Все функции ниже работают только с 'me' и только с собственным файлом с точным именем:
// канал с музыкой и другие сообщения сюда не попадают ни при каком аргументе.
const SELF = 'me', SYNC_NAME = 'mix-sync.json', SYNC_MIME = 'application/json';
const syncFileName = m => m?.media?.document?.attributes?.find(a => a.className === 'DocumentAttributeFilename')?.fileName;
const isSyncMsg = (m, name) => !!m && !m.fwdFrom && syncFileName(m) === name;
const syncItem = m => ({ msg: m, msgId: m.id, docId: m.media.document.id.toString(), size: Number(m.media.document.size), date: m.editDate || m.date });

export const syncReady = () => !!client?.connected;

// Все копии файла, новые сверху. Обычно одна; две бывают, если устройства создали файл одновременно.
export async function findSyncDocs({ name = SYNC_NAME, hintId = null } = {}) {
  const { Api } = await lib();
  const found = new Map();
  const add = m => { if (isSyncMsg(m, name)) found.set(m.id, m); };
  if (hintId) for (const m of await client.getMessages(SELF, { ids: [hintId] })) add(m);
  for await (const m of client.iterMessages(SELF, { search: name, limit: 20 })) add(m);
  // Поиск Telegram индексирует имя файла не мгновенно, поэтому без подсказки смотрим ещё и последние документы
  if (!found.size) for await (const m of client.iterMessages(SELF, { filter: new Api.InputMessagesFilterDocument(), limit: 200 })) add(m);
  return [...found.values()].sort((a, b) => b.id - a.id).map(syncItem);
}

export async function downloadSyncDoc(item) {
  const buf = await client.downloadMedia(item.msg, {});
  return new TextDecoder().decode(buf);
}

// Заменяет файл в том же сообщении. Если правка невозможна — отправляет новое и только после успеха удаляет старое.
export async function uploadSyncDoc(text, { name = SYNC_NAME, replaceMsgId = null } = {}) {
  const { Api } = await lib();
  const file = () => new File([text], name, { type: SYNC_MIME });
  let old = null;
  if (replaceMsgId) {
    const [m] = await client.getMessages(SELF, { ids: [replaceMsgId] });
    if (isSyncMsg(m, name)) old = m;
  }
  if (old) {
    try {
      const handle = await client.uploadFile({ file: file(), workers: 1 });
      await client.invoke(new Api.messages.EditMessage({
        peer: new Api.InputPeerSelf(), id: old.id,
        media: new Api.InputMediaUploadedDocument({ file: handle, mimeType: SYNC_MIME, forceFile: true, attributes: [new Api.DocumentAttributeFilename({ fileName: name })] }),
      }));
      const [m] = await client.getMessages(SELF, { ids: [old.id] });
      if (isSyncMsg(m, name)) return { msgId: m.id, docId: m.media.document.id.toString() };
      throw Object.assign(new Error('sync message lost after edit'), { errorMessage: 'MESSAGE_ID_INVALID' });
    } catch (e) {
      if (e.errorMessage === 'MESSAGE_NOT_MODIFIED') return { msgId: old.id, docId: old.media.document.id.toString() };
      // Сеть и FLOOD_WAIT — повторим весь цикл позже; отказ самого Telegram от правки — идём запасным путём
      if (!e.errorMessage || e.seconds) throw e;
    }
  }
  const sent = await client.sendFile(SELF, { file: file(), forceDocument: true, workers: 1 });
  if (old) { try { await client.deleteMessages(SELF, [old.id], { revoke: true }); } catch {} }
  return { msgId: sent.id, docId: sent.media.document.id.toString() };
}

// Удаляет только сообщения, которые действительно являются файлом синхронизации
export async function deleteSyncDocs(msgIds, { name = SYNC_NAME } = {}) {
  if (!msgIds?.length) return 0;
  const ms = await client.getMessages(SELF, { ids: msgIds });
  const ids = ms.filter(m => isSyncMsg(m, name)).map(m => m.id);
  if (ids.length) await client.deleteMessages(SELF, ids, { revoke: true });
  return ids.length;
}
