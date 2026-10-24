// Output formats. Each function takes the chat facts and plain message records
// produced by wa.js and returns file text.
(() => {
  'use strict';
  const A = (window.__waTools ??= {});
  const esc = A.escapeHtml;

  const dateOf = (t) => new Date(t * 1000);

  function mediaNote(media, type) {
    const label = A.TYPE_LABEL[type] ?? 'Medya';
    if (media.file) return `<ekli: ${media.file}>`;
    if (media.status === 'failed') return `<${label} indirilemedi: ${media.error}>`;
    return `<${label} dışa aktarılmadı>`;
  }

  // WhatsApp-style plain text: "[24.10.2026 14:32:05] Ad: mesaj".
  function txt(info, records) {
    const lines = [
      `# ${info.title}`,
      `# Dışa aktarma: ${A.fmtDate(info.exportedAt)} ${A.fmtTime(info.exportedAt)} · ${records.length} mesaj`,
      '',
    ];
    for (const r of records) {
      const d = dateOf(r.t);
      const head = `[${A.fmtDate(d)} ${A.fmtTime(d)}]`;
      if (r.system) {
        lines.push(`${head} ${r.text}`);
        continue;
      }
      const parts = [];
      if (r.forwarded) parts.push('(iletildi)');
      if (r.quoted) parts.push(`(yanıt: “${r.quoted.preview || r.quoted.key}”)`);
      if (r.media) parts.push(mediaNote(r.media, r.type));
      if (r.text) parts.push(r.text);
      lines.push(`${head} ${r.sender}: ${parts.join(' ')}`);
    }
    return `${lines.join('\n')}\n`;
  }

  // Spreadsheets run cells starting with these characters as formulas.
  const FORMULA_START = /^[=+\-@\t\r]/;

  function csvCell(value, delimiter) {
    let s = value === null || value === undefined ? '' : String(value);
    if (FORMULA_START.test(s)) s = `'${s}`;
    return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function csv(info, records, delimiter = ';') {
    const header = [
      'tarih',
      'saat',
      'iso_zaman',
      'gonderen',
      'telefon',
      'benden',
      'tur',
      'metin',
      'medya_dosyasi',
      'medya_durumu',
      'yanitlanan_mesaj',
      'iletildi',
      'yildizli',
      'mesaj_id',
    ];
    const rows = [header.join(delimiter)];
    for (const r of records) {
      const d = dateOf(r.t);
      rows.push(
        [
          A.fmtDate(d),
          A.fmtTime(d),
          A.isoLocal(d),
          r.sender,
          r.senderPhone,
          r.fromMe ? 1 : 0,
          r.type,
          r.text,
          r.media?.file ?? '',
          r.media ? r.media.error ?? r.media.status : '',
          r.quoted?.key ?? '',
          r.forwarded ? 1 : 0,
          r.starred ? 1 : 0,
          r.id,
        ]
          .map((v) => csvCell(v, delimiter))
          .join(delimiter),
      );
    }
    // The BOM makes Excel open the file as UTF-8 (Turkish letters, emoji).
    return `﻿${rows.join('\r\n')}\r\n`;
  }

  function json(info, records) {
    return JSON.stringify(
      {
        schema: 'wa-tools/chat/1',
        chat: {
          id: info.id,
          title: info.title,
          isGroup: info.isGroup,
          participants: info.participants,
        },
        me: info.me,
        exportedAt: A.isoLocal(info.exportedAt),
        range: info.range,
        history: info.history,
        messageCount: records.length,
        messages: records,
      },
      null,
      2,
    );
  }

  // --- HTML -------------------------------------------------------------

  const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;

  function formatWhatsApp(escaped) {
    return escaped
      .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
      .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,!?:;])/g, '$1<b>$2</b>')
      .replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,!?:;])/g, '$1<i>$2</i>')
      .replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s).,!?:;])/g, '$1<s>$2</s>');
  }

  // Escape first, then add only our own markup; URLs are kept out of the
  // formatting pass so underscores in links survive.
  function richText(text) {
    let html = '';
    let last = 0;
    for (const match of text.matchAll(URL_RE)) {
      html += formatWhatsApp(esc(text.slice(last, match.index)));
      const url = match[0];
      html += `<a href="${esc(url)}" rel="noreferrer noopener" target="_blank">${esc(url)}</a>`;
      last = match.index + url.length;
    }
    html += formatWhatsApp(esc(text.slice(last)));
    return html.replace(/\n/g, '<br>');
  }

  function hue(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % 360;
  }

  function mediaHtml(r) {
    const m = r.media;
    const label = A.TYPE_LABEL[r.type] ?? 'Medya';
    if (!m.file) {
      const why = m.status === 'failed' ? `indirilemedi: ${m.error}` : 'dışa aktarılmadı';
      return `<div class="nomedia">${esc(label)} — ${esc(why)}</div>`;
    }
    const src = esc(A.hrefPath(m.file));
    switch (r.type) {
      case 'image':
        return `<a href="${src}" target="_blank"><img class="img" loading="lazy" src="${src}" alt="${esc(label)}"></a>`;
      case 'sticker':
        return `<img class="sticker" loading="lazy" src="${src}" alt="${esc(label)}">`;
      case 'video':
      case 'ptv':
        return `<video controls preload="none" src="${src}"></video>`;
      case 'ptt':
      case 'audio':
        return `<audio controls preload="none" src="${src}"></audio>`;
      default: {
        const name = m.filename || m.file.split('/').pop();
        const size = A.formatBytes(m.size);
        return `<a class="doc" href="${src}" target="_blank">📄 ${esc(name)}${size ? ` <small>${esc(size)}</small>` : ''}</a>`;
      }
    }
  }

  const CSS = `
:root{--bg:#efeae2;--in:#fff;--out:#d9fdd3;--sys:#fff5c4;--ink:#111b21;--muted:#667781;--head:#008069}
@media (prefers-color-scheme:dark){:root{--bg:#0b141a;--in:#202c33;--out:#005c4b;--sys:#2a3942;--ink:#e9edef;--muted:#8696a0;--head:#1f2c34}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--head);color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:17px;margin:0;flex:1 1 240px}header p{margin:0;font-size:12px;opacity:.85;flex-basis:100%}
header input{flex:0 1 260px;padding:6px 10px;border-radius:8px;border:0;font:inherit}
main{max-width:900px;margin:0 auto;padding:12px 16px 40px;display:flex;flex-direction:column;gap:4px}
.day{align-self:center;background:var(--in);color:var(--muted);font-size:12px;padding:4px 10px;border-radius:8px;margin:10px 0 4px}
.msg{max-width:min(78%,640px);padding:6px 9px 4px;border-radius:8px;background:var(--in);box-shadow:0 1px .5px rgba(0,0,0,.13);overflow-wrap:anywhere}
.msg.out{align-self:flex-end;background:var(--out)}.msg.in{align-self:flex-start}
.msg.sys{align-self:center;background:var(--sys);font-size:13px;text-align:center}
.msg:target{outline:3px solid #53bdeb}
.who{font-size:13px;font-weight:600;margin-bottom:2px}
.meta{font-size:11px;color:var(--muted);text-align:right;margin-top:2px}
.quote{display:block;border-left:4px solid #06cf9c;background:rgba(0,0,0,.05);padding:4px 8px;border-radius:6px;margin-bottom:4px;color:inherit;text-decoration:none;font-size:13px}
.img{max-width:100%;max-height:420px;border-radius:6px;display:block}.sticker{width:160px;height:160px;object-fit:contain}
video{max-width:100%;max-height:420px;border-radius:6px}audio{width:280px;max-width:100%}
.doc{display:inline-block;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,.06);color:inherit}
.nomedia{font-size:13px;color:var(--muted);font-style:italic}
.fwd{font-size:12px;color:var(--muted);font-style:italic}
code{font-family:ui-monospace,Consolas,monospace;background:rgba(0,0,0,.06);padding:0 3px;border-radius:3px}
a{color:#027eb5}.hidden{display:none!important}`;

  const SEARCH_JS = `
const q=document.getElementById('q');q&&q.addEventListener('input',()=>{const v=q.value.trim().toLocaleLowerCase('tr');
for(const el of document.querySelectorAll('.msg'))el.classList.toggle('hidden',!!v&&!el.textContent.toLocaleLowerCase('tr').includes(v));
for(const el of document.querySelectorAll('.day'))el.classList.toggle('hidden',!!v);});`;

  function page(title, subtitle, body, searchable) {
    return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><h1>${esc(title)}</h1>${searchable ? '<input id="q" type="search" placeholder="Mesajlarda ara…">' : ''}<p>${esc(subtitle)}</p></header>
<main>${body}</main>${searchable ? `<script>${SEARCH_JS}</script>` : ''}</body></html>
`;
  }

  function html(info, records) {
    const out = [];
    let day = '';
    for (const r of records) {
      const d = dateOf(r.t);
      const dayText = A.fmtDate(d);
      if (dayText !== day) {
        day = dayText;
        out.push(`<div class="day">${esc(dayText)}</div>`);
      }
      const anchor = r.key ? ` id="m-${esc(r.key)}"` : '';
      if (r.system) {
        out.push(`<div class="msg sys"${anchor}>${richText(r.text)} <span class="meta">${A.fmtTime(d)}</span></div>`);
        continue;
      }
      const parts = [];
      if (info.isGroup && !r.fromMe) {
        parts.push(`<div class="who" style="color:hsl(${hue(r.senderId || r.sender)} 55% 42%)">${esc(r.sender)}</div>`);
      }
      if (r.forwarded) parts.push('<div class="fwd">↪ İletildi</div>');
      if (r.quoted) {
        parts.push(
          `<a class="quote" href="#m-${esc(r.quoted.key)}">${esc(r.quoted.preview || 'Yanıtlanan mesaj')}</a>`,
        );
      }
      if (r.media) parts.push(mediaHtml(r));
      if (r.location?.lat !== null && r.location?.lat !== undefined) {
        const maps = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(r.location.lat)}&mlon=${encodeURIComponent(r.location.lng)}`;
        parts.push(`<a href="${esc(maps)}" target="_blank" rel="noreferrer noopener">📍 ${esc(r.text || 'Konum')}</a>`);
      } else if (r.text) {
        parts.push(`<div class="txt">${richText(r.text)}</div>`);
      }
      parts.push(`<div class="meta">${r.starred ? '★ ' : ''}${A.fmtTime(d)}</div>`);
      out.push(`<div class="msg ${r.fromMe ? 'out' : 'in'}"${anchor}>${parts.join('')}</div>`);
    }
    const first = records[0] ? A.fmtDate(dateOf(records[0].t)) : '-';
    const last = records.length ? A.fmtDate(dateOf(records[records.length - 1].t)) : '-';
    const subtitle =
      `${records.length} mesaj · ${first} – ${last} · ` +
      `dışa aktarma ${A.fmtDate(info.exportedAt)} ${A.fmtTime(info.exportedAt)}` +
      (info.history.complete ? '' : ' · ⚠ geçmiş eksik olabilir');
    return page(info.title, subtitle, out.join('\n'), true);
  }

  function indexHtml(summary, htmlIncluded) {
    const rows = summary.chats.map((c) => {
      const title = esc(c.title ?? c.id);
      const link = htmlIncluded && c.folder ? `<a href="${esc(A.hrefPath(`${c.folder}/sohbet.html`))}">${title}</a>` : title;
      const notes = [];
      if (c.error) notes.push(`hata: ${c.error}`);
      if (c.history && !c.history.complete) notes.push('geçmiş eksik olabilir');
      if (c.media?.failed) notes.push(`${c.media.failed} medya indirilemedi`);
      return (
        `<div class="msg in">${link}<div class="meta">${c.messageCount ?? 0} mesaj` +
        `${c.media ? ` · ${c.media.ok} medya` : ''}${notes.length ? ` · ${esc(notes.join(' · '))}` : ''}</div></div>`
      );
    });
    const started = new Date(summary.startedAt);
    const subtitle =
      `${summary.chats.length} sohbet · ${A.fmtDate(started)} ${A.fmtTime(started)}` +
      (summary.aborted ? ' · ⚠ kullanıcı tarafından durduruldu' : '');
    return page('WhatsApp Arşivi', subtitle, rows.join('\n'), false);
  }

  A.formats = { txt, csv, json, html, indexHtml };
})();
