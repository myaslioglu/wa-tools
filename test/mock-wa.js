// Fake WhatsApp Web module registry for end-to-end tests of WhatsApp Tools.
// It mimics only the shapes wa.js relies on; it does not prove that the real
// WhatsApp Web build still exposes them.
(() => {
  class Collection {
    constructor(models = []) {
      this._models = models;
    }
    getModelsArray() {
      return this._models;
    }
    get(id) {
      return this._models.find((m) => (m.id?._serialized ?? m.id) === id);
    }
  }
  const wid = (user, server) => ({ user, server, _serialized: `${user}@${server}` });
  const me = wid('905309998877', 'c.us');
  const START = new Date(2026, 0, 1, 9, 0, 0).getTime() / 1000;
  const HOUR = 3600;
  const THUMB = 'A'.repeat(400);

  function msg(chatWid, n, t, fields = {}) {
    const fromMe = fields.fromMe ?? false;
    return {
      id: { fromMe, remote: chatWid, id: `ID${n}`, _serialized: `${fromMe}_${chatWid._serialized}_ID${n}` },
      t,
      type: 'chat',
      from: fromMe ? me : chatWid,
      ...fields,
    };
  }

  // Chat 1: direct chat with 230 messages; only the newest 20 are loaded.
  const ayse = wid('905321112233', 'c.us');
  const all1 = [];
  for (let n = 0; n < 230; n++) {
    const t = START + n * 3 * HOUR;
    const fromMe = n % 7 === 0;
    let fields = { fromMe, body: `Mesaj ${n}` };
    if (n === 5) fields = { fromMe, type: 'image', body: THUMB, caption: 'Tatil 🌴', mimetype: 'image/jpeg', directPath: '/img/5', size: 12 };
    if (n === 9) fields = { fromMe, type: 'document', body: THUMB, filename: 'Rapor 2026.pdf', mimetype: 'application/pdf', directPath: '/doc/9', size: 12 };
    if (n === 12) fields = { fromMe, type: 'ptt', body: THUMB, mimetype: 'audio/ogg; codecs=opus', directPath: '/ptt/12', duration: 7 };
    if (n === 15) fields = { fromMe, type: 'revoked' };
    if (n === 20) fields = { fromMe, body: 'Buna katılıyorum', quotedStanzaID: 'ID19', quotedMsg: { type: 'chat', body: 'Mesaj 19' } };
    if (n === 25) fields = { fromMe, body: '<script>alert(1)</script> *kalın* _italik_ https://example.com/a_b_c?x=1&y=2' };
    if (n === 30) fields = { fromMe, type: 'location', body: THUMB, lat: 41.0082, lng: 28.9784, loc: 'Sultanahmet' };
    if (n === 35) fields = { fromMe, type: 'vcard', body: 'BEGIN:VCARD\nVERSION:3.0\nFN:Ali Veli\nTEL:+905001112233\nEND:VCARD' };
    if (n === 40) fields = { fromMe, body: 'Satır 1\nSatır 2\nSatır 3' };
    if (n === 45) fields = { fromMe, type: 'protocol' };
    if (n === 50) fields = { fromMe, type: 'image', body: THUMB, mimetype: 'image/jpeg', directPath: '/expired/50' };
    if (n === 60) fields = { fromMe, body: '=SUM(A1:A9)' };
    if (n === 225) fields = { fromMe, body: 'Son mesajlardan biri', isForwarded: true, star: true };
    all1.push(msg(ayse, n, t, fields));
  }
  const chat1 = {
    id: ayse,
    formattedTitle: 'Ayşe Yılmaz',
    t: all1.at(-1).t,
    msgs: new Collection(all1.slice(-20)),
  };
  chat1.msgs.msgLoadState = { noEarlierMsgs: false };
  chat1.hidden = all1.slice(0, -20);

  // Chat 2: group with a LID participant, a system event and a sticker.
  const group = wid('120363000000000001', 'g.us');
  const lid = wid('12345', 'lid');
  const ali = wid('905441112233', 'c.us');
  const g = [
    msg(group, 1000, START + 1 * HOUR, { type: 'gp2', subtype: 'add', author: lid, recipients: [ali] }),
    msg(group, 1001, START + 2 * HOUR, { author: lid, from: group, body: 'Merhaba ekip' }),
    msg(group, 1002, START + 3 * HOUR, { author: ali, from: group, body: 'Selam', notifyName: 'Ali' }),
    msg(group, 1003, START + 4 * HOUR, { fromMe: true, body: 'Toplantı yarın 10:00' }),
    msg(group, 1004, START + 5 * HOUR, { author: lid, from: group, type: 'sticker', body: THUMB, mimetype: 'image/webp', directPath: '/st/1004' }),
  ];
  const chat2 = {
    id: group,
    formattedTitle: 'Proje Ekibi',
    isGroup: true,
    t: g.at(-1).t,
    msgs: new Collection(g),
    groupMetadata: { participants: new Collection([{ id: lid, isAdmin: true }, { id: ali }, { id: me }]) },
  };
  chat2.msgs.msgLoadState = { noEarlierMsgs: true };

  // Chat 3: nothing loaded until the chat is opened.
  const empty = wid('905000000000', 'c.us');
  const chat3 = { id: empty, formattedTitle: 'Boş/Sohbet: test?', t: START, msgs: new Collection([]) };
  chat3.msgs.msgLoadState = { noEarlierMsgs: false };

  const chat4 = { id: wid('905111111111', 'c.us'), formattedTitle: 'Eski Arşiv', archive: true, t: START - 99999, msgs: new Collection([]) };
  const status = { id: wid('status', 'broadcast'), formattedTitle: 'Durum', t: START, msgs: new Collection([]) };

  const Chat = new Collection([chat1, chat2, chat3, chat4, status]);

  const contacts = new Collection([
    { id: ayse, name: 'Ayşe Yılmaz', pushname: 'ayse' },
    { id: lid, pushname: 'Mehmet' },
    { id: me, pushname: 'murat' },
  ]);
  contacts.getMeContact = () => contacts.get(me._serialized);

  const modules = {
    WAWebCollections: { Chat, Contact: contacts, Msg: new Collection([]) },
    WAWebContactCollection: { ContactCollection: contacts },
    WAWebConnModel: { Conn: { pushname: 'Murat Yaşlıoğlu' } },
    WAWebWidFactory: {
      createWid: (s) => {
        const [user, server] = s.split('@');
        return wid(user, server);
      },
    },
    WAWebApiContact: { getPhoneNumber: (w) => (w.user === '12345' ? wid('905551234567', 'c.us') : null) },
    WAWebChatLoadMessages: {
      async loadEarlierMsgs(arg) {
        if (!arg?.chat) throw new TypeError('expected options object');
        await new Promise((r) => setTimeout(r, 5));
        const chat = arg.chat;
        const batch = chat.hidden?.splice(-50) ?? [];
        chat.msgs._models.unshift(...batch);
        if (!chat.hidden?.length) chat.msgs.msgLoadState.noEarlierMsgs = true;
        return batch;
      },
    },
    WAWebCmd: {
      Cmd: {
        async openChatBottom({ chat }) {
          window.__openedChats = (window.__openedChats ?? 0) + 1;
          if (chat === chat3 && chat3.msgs._models.length === 0) {
            chat3.msgs._models.push(
              msg(empty, 3000, START + 10 * HOUR, { body: 'İlk' }),
              msg(empty, 3001, START + 11 * HOUR, { fromMe: true, body: 'İkinci' }),
              msg(empty, 3002, START + 12 * HOUR, { body: 'Üçüncü' }),
            );
            chat3.msgs.msgLoadState.noEarlierMsgs = true;
          }
        },
      },
    },
    WAWebDownloadManager: {
      downloadManager: {
        async downloadAndMaybeDecrypt({ directPath }) {
          await new Promise((r) => setTimeout(r, 5));
          if (directPath.startsWith('/expired')) throw Object.assign(new Error('gone'), { status: 404 });
          return new TextEncoder().encode(`MEDIA:${directPath}`).buffer;
        },
      },
    },
  };

  window.require = (name) => {
    if (!(name in modules)) throw new Error(`Requiring unknown module "${name}"`);
    return modules[name];
  };

  // Folder output in tests goes to the origin-private file system, because a
  // headless browser cannot answer the real folder picker.
  window.showDirectoryPicker = async () => {
    const opfs = await navigator.storage.getDirectory();
    return opfs.getDirectoryHandle('secilen-klasor', { create: true });
  };
})();
