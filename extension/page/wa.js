// The only file that knows WhatsApp Web internals. It reads the page's own
// module registry (window.require) and turns models into plain records.
// WhatsApp renames internals from time to time; when an export breaks, this
// file is where module names and call shapes need updating.
(() => {
  'use strict';
  const A = (window.__waTools ??= {});

  const req = (name) => {
    try {
      return window.require?.(name);
    } catch {
      return undefined;
    }
  };
  const models = (collection) => collection?.getModelsArray?.() ?? collection?._models ?? [];
  const widString = (wid) => (typeof wid === 'string' ? wid : wid?._serialized ?? '');

  const MEDIA_TYPES = new Set(['image', 'video', 'ptv', 'ptt', 'audio', 'document', 'sticker']);
  // Entries WhatsApp keeps in a chat's message collection that are not
  // conversation content.
  const HIDDEN_TYPES = new Set([
    'protocol',
    'reaction',
    'reaction_enc',
    'poll_update',
    'pin_message',
    'keep_in_chat',
    'debug',
  ]);
  const PHONE_HISTORY_BUTTON = /click here|buraya tıkla|older messages|eski mesaj/i;

  function collections() {
    const c = req('WAWebCollections');
    if (!c?.Chat) {
      throw new Error(
        'WhatsApp Web iç modülleri bulunamadı (WAWebCollections). Sayfanın tam yüklendiğinden emin olun; ' +
          'sorun sürerse WhatsApp Web güncellenmiş olabilir.',
      );
    }
    return c;
  }

  function contactCollection() {
    return req('WAWebContactCollection')?.ContactCollection ?? req('WAWebCollections')?.Contact;
  }

  function toWid(value) {
    if (value && typeof value === 'object') return value;
    if (!value) return null;
    try {
      return req('WAWebWidFactory')?.createWid?.(value) ?? null;
    } catch {
      return null;
    }
  }

  function chatTitle(chat) {
    return (
      chat.formattedTitle ||
      chat.name ||
      chat.contact?.name ||
      chat.contact?.pushname ||
      widString(chat.id).split('@')[0]
    );
  }

  // Resolves sender identities once per export; LID senders are mapped to a
  // phone number when WhatsApp exposes the mapping, and stay unresolved otherwise.
  function names() {
    const contacts = contactCollection();
    const apiContact = req('WAWebApiContact');
    const meContact = contacts?.getMeContact?.();
    const me = {
      id: widString(meContact?.id),
      name: req('WAWebConnModel')?.Conn?.pushname || meContact?.pushname || 'Ben',
      phone: meContact?.id?.user ?? '',
    };
    const cache = new Map();

    function resolve(wid, notifyName) {
      const id = widString(wid);
      if (!id) return { id: '', name: notifyName || 'Bilinmeyen', phone: '' };
      const cached = cache.get(id);
      if (cached) return cached;
      const widObj = toWid(wid);
      const server = widObj?.server ?? id.split('@')[1];
      let phone = '';
      if (server === 'lid') {
        try {
          phone = apiContact?.getPhoneNumber?.(widObj)?.user ?? '';
        } catch {}
      } else {
        phone = widObj?.user ?? id.split('@')[0];
      }
      let contact;
      try {
        contact = contacts?.get?.(id);
      } catch {}
      if (!phone) phone = contact?.phoneNumber?.user ?? '';
      const name =
        contact?.name ||
        contact?.pushname ||
        contact?.verifiedName ||
        notifyName ||
        (phone ? `+${phone}` : id.split('@')[0]);
      const record = { id, name, phone };
      cache.set(id, record);
      return record;
    }

    return { me, resolve };
  }

  function listChats() {
    return models(collections().Chat)
      .map((chat) => ({
        id: widString(chat.id),
        title: chatTitle(chat),
        isGroup: Boolean(chat.isGroup ?? chat.groupMetadata),
        archived: Boolean(chat.archive),
        lastTs: chat.t || 0,
      }))
      .filter((chat) => chat.id && chat.id !== 'status@broadcast' && !chat.id.endsWith('@newsletter'))
      .sort((a, b) => b.lastTs - a.lastTs);
  }

  // Newer builds take an options object, older ones positional arguments.
  // The first shape that works is remembered for the rest of the session.
  let loadEarlierShape = null;

  async function loadEarlier(chat) {
    const fn = req('WAWebChatLoadMessages')?.loadEarlierMsgs;
    if (typeof fn !== 'function') throw new Error('WAWebChatLoadMessages.loadEarlierMsgs bulunamadı');
    const shapes = loadEarlierShape ? [loadEarlierShape] : ['object', 'positional'];
    let lastError;
    for (const shape of shapes) {
      try {
        const call = shape === 'object' ? fn({ chat, msgCollection: chat.msgs }) : fn(chat, chat.msgs);
        const result = await A.withTimeout(Promise.resolve(call), 30_000, 'Eski mesajlar 30 sn içinde gelmedi');
        loadEarlierShape = shape;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async function openChat(chat) {
    const cmd = req('WAWebCmd')?.Cmd;
    try {
      await cmd?.openChatBottom?.({ chat });
    } catch {
      try {
        await cmd?.openChatBottom?.(chat);
      } catch {}
    }
  }

  // Messages older than what WhatsApp Web has synced live only on the phone.
  // The conversation view then offers a button that fetches them; this clicks
  // it. It depends on the visible UI and is therefore opt-in.
  async function requestOlderFromPhone(chat, signal) {
    await openChat(chat);
    await A.sleep(1000);
    const pane =
      document.querySelector('#main [data-scrolltracepolicy="wa.web.conversation.messages"]') ??
      document.querySelector('#main .copyable-area [tabindex="0"]');
    if (!pane) return false;
    const before = models(chat.msgs).length;
    pane.scrollTop = 0;
    await A.sleep(800);
    const button = [...pane.querySelectorAll('button, [role="button"]')].find(
      (el) => !el.closest('[data-id]') && PHONE_HISTORY_BUTTON.test(el.textContent || ''),
    );
    if (!button) return false;
    button.click();
    for (let i = 0; i < 60; i++) {
      A.throwIfAborted(signal);
      if (models(chat.msgs).length > before) return true;
      await A.sleep(500);
    }
    return false;
  }

  // Loads older messages until the range start is covered or WhatsApp has
  // nothing earlier. The returned facts say whether the history is complete.
  async function ensureHistory(chat, { since = 0, signal, onProgress, phoneHistory = false } = {}) {
    const facts = { reachedStart: false, coveredRangeStart: false, loaded: 0, oldestTs: null, lastError: null };
    if (models(chat.msgs).length === 0) {
      await openChat(chat);
      for (let i = 0; i < 20 && models(chat.msgs).length === 0; i++) {
        A.throwIfAborted(signal);
        await A.sleep(500);
      }
    }
    let stagnant = 0;
    for (let round = 0; round < 100_000; round++) {
      A.throwIfAborted(signal);
      const list = models(chat.msgs);
      const oldest = list[0]?.t;
      if (since && oldest !== undefined && oldest <= since) {
        facts.coveredRangeStart = true;
        break;
      }
      if (chat.msgs?.msgLoadState?.noEarlierMsgs) {
        facts.reachedStart = true;
        break;
      }
      const before = list.length;
      try {
        await A.raceAbort(loadEarlier(chat), signal);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        facts.lastError = error?.message ?? String(error);
      }
      const after = models(chat.msgs).length;
      onProgress?.(after, models(chat.msgs)[0]?.t);
      if (after > before) {
        stagnant = 0;
        continue;
      }
      if (phoneHistory && (await requestOlderFromPhone(chat, signal))) {
        stagnant = 0;
        continue;
      }
      if (++stagnant >= 3) break;
      await A.sleep(700);
    }
    if (chat.msgs?.msgLoadState?.noEarlierMsgs) facts.reachedStart = true;
    const list = models(chat.msgs);
    facts.loaded = list.length;
    facts.oldestTs = list[0]?.t ?? null;
    return facts;
  }

  function messagesInRange(chat, from, to) {
    return models(chat.msgs)
      .filter((m) => !HIDDEN_TYPES.has(m.type) && m.t >= from && m.t < to)
      .sort((a, b) => a.t - b.t);
  }

  function participants(chat, people) {
    return models(chat.groupMetadata?.participants).map((p) => ({
      ...people.resolve(p.id),
      admin: Boolean(p.isAdmin || p.isSuperAdmin),
      superAdmin: Boolean(p.isSuperAdmin),
    }));
  }

  // Media messages carry a base64 thumbnail in `body`; it must never be
  // exported as text.
  const looksLikeBase64 = (s) => s.length > 120 && /^[A-Za-z0-9+/=\s]+$/.test(s);

  function vcardName(vcard) {
    return /^FN[;:](?:.*:)?(.+)$/im.exec(vcard || '')?.[1]?.trim() ?? '';
  }

  function systemText(m, people) {
    const who = (list) =>
      (Array.isArray(list) ? list : [])
        .map((w) => people.resolve(w).name)
        .join(', ');
    const actor = m.author ? people.resolve(m.author).name : '';
    const subject = who(m.recipients);
    const sub = m.subtype || m.type;
    const text = {
      create: `${actor} grubu oluşturdu`,
      add: `${actor} ${subject} kişisini ekledi`,
      invite: `${subject} davet bağlantısıyla katıldı`,
      remove: `${actor} ${subject} kişisini çıkardı`,
      leave: `${subject || actor} ayrıldı`,
      subject: `${actor} grup adını değiştirdi${m.body ? `: ${m.body}` : ''}`,
      description: `${actor} grup açıklamasını değiştirdi`,
      picture: `${actor} grup fotoğrafını değiştirdi`,
    }[sub];
    return `ℹ️ ${text ?? `Sistem bildirimi (${sub})`}`.replace(/\s+/g, ' ').trim();
  }

  function textOf(m, type, people) {
    switch (type) {
      case 'chat':
        return m.body ?? '';
      case 'location':
        return [m.loc, Number.isFinite(m.lat) ? `${m.lat}, ${m.lng}` : ''].filter(Boolean).join(' — ');
      case 'vcard':
        return vcardName(m.body);
      case 'multi_vcard':
        return (m.vcardList ?? []).map((v) => v.displayName || vcardName(v.vcard)).join(', ');
      case 'poll_creation':
        return [m.pollName, ...(m.pollOptions ?? []).map((o) => `• ${o.name}`)].filter(Boolean).join('\n');
      case 'revoked':
        return '🚫 Bu mesaj silindi';
      case 'ciphertext':
        return '⏳ Mesaj henüz çözülemedi (telefonda açıp tekrar deneyin)';
      case 'call_log':
        return '📞 Arama kaydı';
      case 'e2e_notification':
        return '🔒 Uçtan uca şifreleme bildirimi';
      case 'gp2':
      case 'notification':
      case 'notification_template':
        return systemText(m, people);
      default: {
        if (MEDIA_TYPES.has(type)) return m.caption ?? '';
        const body = typeof m.body === 'string' ? m.body : '';
        return looksLikeBase64(body) ? '' : body;
      }
    }
  }

  function quotedPreview(q) {
    if (!q) return '';
    if (q.type === 'chat') return String(q.body ?? '').slice(0, 200);
    const label = A.TYPE_LABEL[q.type];
    if (!label) return '';
    return `[${label}] ${MEDIA_TYPES.has(q.type) ? q.caption ?? '' : ''}`.trim();
  }

  const SYSTEM_TYPES = new Set(['gp2', 'notification', 'notification_template', 'e2e_notification', 'call_log']);

  function describe(m, people) {
    const type = m.type || 'unknown';
    const fromMe = Boolean(m.id?.fromMe);
    // In groups `author` is the participant; in direct chats `from` is the peer.
    const sender = fromMe ? people.me : people.resolve(m.author ?? m.from, m.notifyName);
    return {
      id: widString(m.id) || String(m.id?.id ?? ''),
      key: String(m.id?.id ?? ''),
      t: m.t,
      type,
      system: SYSTEM_TYPES.has(type),
      fromMe,
      sender: sender.name,
      senderPhone: sender.phone,
      senderId: sender.id,
      text: textOf(m, type, people),
      quoted: m.quotedStanzaID
        ? { key: String(m.quotedStanzaID), participant: widString(m.quotedParticipant), preview: quotedPreview(m.quotedMsg) }
        : null,
      forwarded: Boolean(m.isForwarded),
      starred: Boolean(m.star),
      ack: Number.isFinite(m.ack) ? m.ack : null,
      location: type === 'location' ? { lat: m.lat ?? null, lng: m.lng ?? null, name: m.loc ?? '' } : null,
      media: MEDIA_TYPES.has(type)
        ? {
            mimetype: m.mimetype ?? '',
            filename: m.filename ?? '',
            size: m.size ?? null,
            duration: m.duration ?? null,
            status: 'not-requested',
            file: null,
            error: null,
          }
        : null,
    };
  }

  function blobFromMessage(m) {
    try {
      const blob = m.mediaData?.mediaBlob?.forceToBlob?.();
      if (blob?.size) return blob;
    } catch {}
    try {
      const cache = req('WAWebMediaInMemoryBlobCache')?.InMemoryMediaBlobCache;
      let blob = m.filehash ? cache?.get?.(m.filehash) : null;
      if (blob && !(blob instanceof Blob)) blob = blob.forceToBlob?.();
      if (blob?.size) return blob;
    } catch {}
    return null;
  }

  function mediaError(error) {
    const status = error?.status ?? error?.statusCode;
    if (status === 404 || status === 410) return 'Medya WhatsApp sunucusunda artık yok (süresi dolmuş)';
    return error?.message || (status ? `İndirme hatası (HTTP ${status})` : 'Medya indirilemedi');
  }

  // Cached blob first, then WhatsApp's own download-and-decrypt path, then the
  // message's download action. Media bytes never leave the browser.
  async function fetchMedia(m, signal) {
    const cached = blobFromMessage(m);
    if (cached) return cached;
    let lastError;
    const manager = req('WAWebDownloadManager')?.downloadManager;
    if (typeof manager?.downloadAndMaybeDecrypt === 'function' && m.directPath) {
      try {
        const data = await A.raceAbort(
          A.withTimeout(
            Promise.resolve(
              manager.downloadAndMaybeDecrypt({
                directPath: m.directPath,
                encFilehash: m.encFilehash,
                filehash: m.filehash,
                mediaKey: m.mediaKey,
                mediaKeyTimestamp: m.mediaKeyTimestamp,
                type: m.type,
                signal,
              }),
            ),
            120_000,
            'Medya indirme zaman aşımı (120 sn)',
          ),
          signal,
        );
        const blob = data instanceof Blob ? data : data ? new Blob([data], { type: m.mimetype || '' }) : null;
        if (blob?.size) return blob;
      } catch (error) {
        if (signal?.aborted) throw A.abortError();
        lastError = error;
      }
    }
    if (typeof m.downloadMedia === 'function') {
      try {
        await A.raceAbort(
          A.withTimeout(
            Promise.resolve(m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true })),
            120_000,
            'Medya indirme zaman aşımı (120 sn)',
          ),
          signal,
        );
        const blob = blobFromMessage(m);
        if (blob) return blob;
      } catch (error) {
        if (signal?.aborted) throw A.abortError();
        lastError = error;
      }
    }
    throw new Error(mediaError(lastError));
  }

  A.wa = {
    isReady: () => typeof req('WAWebCollections')?.Chat?.get === 'function',
    listChats,
    getChat: (id) => collections().Chat.get(id),
    chatTitle,
    isGroup: (chat) => Boolean(chat.isGroup ?? chat.groupMetadata),
    names,
    ensureHistory,
    messagesInRange,
    participants,
    describe,
    fetchMedia,
  };
})();
