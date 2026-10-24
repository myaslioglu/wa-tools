// Shared helpers for the page-world scripts. Everything lives under one
// namespace so WhatsApp Web's own globals are never touched.
(() => {
  'use strict';
  const A = (window.__waTools ??= {});

  A.version = '0.1.0';

  A.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  A.abortError = () => new DOMException('Dışa aktarma durduruldu', 'AbortError');

  A.throwIfAborted = (signal) => {
    if (signal?.aborted) throw A.abortError();
  };

  A.withTimeout = (promise, ms, message) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  A.raceAbort = (promise, signal) => {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(A.abortError());
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(A.abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  };

  const pad = (n) => String(n).padStart(2, '0');
  A.fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  A.fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  A.stamp = (d) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  // ISO 8601 with the local UTC offset, so exported times stay unambiguous.
  A.isoLocal = (d) => {
    const offset = -d.getTimezoneOffset();
    const abs = Math.abs(offset);
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${A.fmtTime(d)}` +
      `${offset >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
  };

  // A file or folder name every desktop OS accepts; Turkish letters and emoji stay.
  A.safeName = (value, max = 80) => {
    const cleaned = String(value ?? '')
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*‎‏‪-‮⁦-⁩]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const cut = [...cleaned].slice(0, max).join('').replace(/[. ]+$/, '');
    if (!cut) return 'adsiz';
    return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cut) ? `_${cut}` : cut;
  };

  A.escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // Relative link target for a path such as "media/a b.jpg".
  A.hrefPath = (path) => path.split('/').map(encodeURIComponent).join('/');

  const MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/amr': 'amr',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'text/vcard': 'vcf',
  };

  A.mediaExt = (mimetype, filename) => {
    const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(filename || '')?.[1];
    if (fromName) return fromName.toLowerCase();
    const base = String(mimetype || '').split(';')[0].trim().toLowerCase();
    return MIME_EXT[base] || base.split('/')[1]?.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  };

  A.formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
  };

  A.TYPE_LABEL = {
    image: 'Fotoğraf',
    video: 'Video',
    ptv: 'Görüntülü not',
    ptt: 'Sesli mesaj',
    audio: 'Ses',
    document: 'Belge',
    sticker: 'Çıkartma',
    location: 'Konum',
    vcard: 'Kişi kartı',
    multi_vcard: 'Kişi kartları',
    poll_creation: 'Anket',
    revoked: 'Silinen mesaj',
    call_log: 'Arama',
  };
})();
