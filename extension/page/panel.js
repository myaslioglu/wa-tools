// In-page control panel. Built with DOM APIs only (no innerHTML), so chat
// titles are always inserted as text.
(() => {
  'use strict';
  const A = (window.__waTools ??= {});
  if (A.panelLoaded) return;
  A.panelLoaded = true;

  const STORE_KEY = 'waTools:options';
  const MEDIA_GROUPS = {
    photo: { label: 'Fotoğraf', types: ['image'] },
    video: { label: 'Video', types: ['video', 'ptv'] },
    audio: { label: 'Ses', types: ['ptt', 'audio'] },
    document: { label: 'Belge', types: ['document'] },
    sticker: { label: 'Çıkartma', types: ['sticker'] },
  };
  const FORMATS = { html: 'HTML (görüntüleme)', txt: 'TXT', csv: 'CSV (Excel)', json: 'JSON (ham veri)' };
  const DEFAULTS = {
    formats: Object.keys(FORMATS),
    media: true,
    mediaGroups: Object.keys(MEDIA_GROUPS),
    csvDelimiter: ';',
    output: 'folder',
    phoneHistory: false,
  };

  function loadOptions() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveOptions(options) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(options));
    } catch {}
  }

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (typeof value === 'boolean') el[key] = value;
      else el.setAttribute(key, value);
    }
    el.append(...children.filter((c) => c !== null && c !== undefined));
    return el;
  }

  const check = (name, value, label, checked) =>
    h('label', { class: 'wat-check' }, h('input', { type: 'checkbox', name, value, checked }), label);

  // "YYYY-MM-DD" from a date input, as local midnight in unix seconds.
  function dayStart(value, offsetDays = 0) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offsetDays).getTime() / 1000;
  }

  let root = null;
  let ui = {};
  let chats = [];
  const selected = new Set();
  let controller = null;
  let readyTimer = null;

  function log(text, level = 'info') {
    const item = h('li', { class: `wat-${level}` }, `${A.fmtTime(new Date())} ${text}`);
    ui.log.append(item);
    while (ui.log.childElementCount > 300) ui.log.firstElementChild.remove();
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function updateCount() {
    ui.count.textContent = `${selected.size} seçili · toplam ${chats.length} sohbet`;
  }

  function visibleChats() {
    const query = ui.search.value.trim().toLocaleLowerCase('tr');
    const filter = ui.filter.value;
    return chats.filter((c) => {
      if (filter === 'direct' && (c.isGroup || c.archived)) return false;
      if (filter === 'group' && (!c.isGroup || c.archived)) return false;
      if (filter === 'archived' && !c.archived) return false;
      if (filter === 'all' && c.archived) return false;
      return !query || c.title.toLocaleLowerCase('tr').includes(query);
    });
  }

  function renderList() {
    const rows = visibleChats().map((c) => {
      const box = h('input', { type: 'checkbox', checked: selected.has(c.id) });
      box.addEventListener('change', () => {
        if (box.checked) selected.add(c.id);
        else selected.delete(c.id);
        updateCount();
      });
      const tags = [c.isGroup ? 'Grup' : null, c.archived ? 'Arşiv' : null].filter(Boolean).join(' · ');
      return h(
        'label',
        { class: 'wat-row', title: c.id },
        box,
        h('span', { class: 'wat-title' }, c.title),
        tags ? h('small', {}, tags) : null,
      );
    });
    ui.list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'wat-empty' }, 'Sohbet bulunamadı')]));
    updateCount();
  }

  function refreshChats() {
    if (!A.wa.isReady()) {
      ui.status.textContent = 'WhatsApp Web hazır değil. QR koduyla giriş yapın ve sohbetler yüklenene kadar bekleyin…';
      ui.status.className = 'wat-status wat-warn';
      clearTimeout(readyTimer);
      readyTimer = setTimeout(refreshChats, 2000);
      return;
    }
    try {
      chats = A.wa.listChats();
      for (const id of [...selected]) if (!chats.some((c) => c.id === id)) selected.delete(id);
      ui.status.textContent = `Hazır · ${chats.length} sohbet`;
      ui.status.className = 'wat-status wat-ok';
    } catch (error) {
      ui.status.textContent = `Sohbetler okunamadı: ${error.message}`;
      ui.status.className = 'wat-status wat-error';
    }
    renderList();
  }

  function readOptions() {
    const checked = (name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
    const mediaGroups = checked('mediaGroup');
    const options = {
      formats: checked('format'),
      media: ui.media.checked,
      mediaGroups,
      csvDelimiter: ui.delimiter.value,
      output: root.querySelector('input[name="output"]:checked')?.value ?? 'zip',
      phoneHistory: ui.phoneHistory.checked,
    };
    saveOptions(options);
    return {
      ...options,
      formats: new Set(options.formats),
      mediaTypes: new Set(mediaGroups.flatMap((g) => MEDIA_GROUPS[g]?.types ?? [])),
      from: dayStart(ui.from.value) ?? 0,
      to: dayStart(ui.to.value, 1) ?? Infinity,
    };
  }

  function setRunning(running) {
    ui.start.disabled = running;
    ui.stop.disabled = !running;
    for (const el of root.querySelectorAll('.wat-settings input, .wat-settings select, .wat-settings button')) {
      el.disabled = running;
    }
    if (!running) ui.folder.disabled = !A.DirectorySink.supported();
  }

  function onReport({ chat, step, index, total }) {
    ui.progress.max = total;
    ui.progress.value = index;
    ui.progressText.textContent = `${index + 1}/${total} · ${chat} — ${step}`;
  }

  function onStart() {
    const options = readOptions();
    if (!selected.size) return log('En az bir sohbet seçin.', 'warn');
    if (!options.formats.size) return log('En az bir çıktı biçimi seçin.', 'warn');
    if (options.from && options.from >= options.to) return log('Başlangıç tarihi bitiş tarihinden sonra olamaz.', 'warn');
    const rootName = `WhatsApp-Arsiv_${A.stamp(new Date())}`;
    // The folder picker needs this click's user gesture, so it opens before any await.
    const useFolder = options.output === 'folder' && A.DirectorySink.supported();
    const sink = useFolder ? A.DirectorySink.open(rootName) : Promise.resolve(new A.ZipSink(rootName));
    run(sink, options);
  }

  async function run(sinkPromise, options) {
    let sink;
    try {
      sink = await sinkPromise;
    } catch (error) {
      if (error?.name === 'AbortError') log('Klasör seçimi iptal edildi.', 'warn');
      else log(`Klasör açılamadı (${error.message}). "ZIP indir" çıktısını deneyin.`, 'error');
      return;
    }
    controller = new AbortController();
    setRunning(true);
    const chatIds = chats.filter((c) => selected.has(c.id)).map((c) => c.id);
    log(`${chatIds.length} sohbet dışa aktarılıyor (${sink instanceof A.ZipSink ? 'ZIP' : 'klasör'}).`);
    try {
      const { output, summary } = await A.runExport({ ...options, chatIds, sink, signal: controller.signal, report: onReport });
      for (const c of summary.chats) {
        if (c.error) {
          log(`${c.title ?? c.id}: ${c.error}`, 'error');
          continue;
        }
        const notes = [`${c.messageCount} mesaj`];
        if (c.media) notes.push(`${c.media.ok} medya`);
        if (c.media?.failed) notes.push(`${c.media.failed} medya indirilemedi`);
        if (!c.history.complete) notes.push('geçmiş eksik olabilir');
        log(`${c.title}: ${notes.join(', ')}`, c.history.complete && !c.media?.failed ? 'ok' : 'warn');
      }
      if (summary.error) log(`Hata: ${summary.error}`, 'error');
      log(
        `${summary.aborted ? 'Durduruldu; o ana kadarki dosyalar kaydedildi' : 'Tamamlandı'} → ${output.label}` +
          (output.size ? ` (${A.formatBytes(output.size)})` : ''),
        summary.aborted || summary.error ? 'warn' : 'ok',
      );
      ui.progressText.textContent = summary.aborted ? 'Durduruldu' : 'Tamamlandı';
      ui.progress.value = ui.progress.max;
    } catch (error) {
      log(`Hata: ${error.message}`, 'error');
    } finally {
      controller = null;
      setRunning(false);
    }
  }

  function build() {
    const saved = loadOptions();
    ui.search = h('input', { type: 'search', placeholder: 'Sohbet ara…', class: 'wat-grow' });
    ui.filter = h(
      'select',
      {},
      h('option', { value: 'all' }, 'Tümü (arşiv hariç)'),
      h('option', { value: 'direct' }, 'Bireysel'),
      h('option', { value: 'group' }, 'Gruplar'),
      h('option', { value: 'archived' }, 'Arşivlenmiş'),
    );
    ui.list = h('div', { class: 'wat-list' });
    ui.count = h('span', { class: 'wat-muted' });
    ui.status = h('div', { class: 'wat-status' });
    ui.from = h('input', { type: 'date' });
    ui.to = h('input', { type: 'date' });
    ui.delimiter = h('select', {}, h('option', { value: ';' }, 'CSV ayırıcı: ;'), h('option', { value: ',' }, 'CSV ayırıcı: ,'));
    ui.delimiter.value = saved.csvDelimiter;
    ui.media = h('input', { type: 'checkbox', checked: saved.media });
    ui.phoneHistory = h('input', { type: 'checkbox', checked: saved.phoneHistory });
    const folderSupported = A.DirectorySink.supported();
    ui.folder = h('input', {
      type: 'radio',
      name: 'output',
      value: 'folder',
      checked: folderSupported && saved.output === 'folder',
      disabled: !folderSupported,
    });
    const zip = h('input', { type: 'radio', name: 'output', value: 'zip', checked: !folderSupported || saved.output !== 'folder' });
    ui.start = h('button', { class: 'wat-primary', onclick: onStart }, 'Dışa aktarmayı başlat');
    ui.stop = h('button', { disabled: true, onclick: () => controller?.abort() }, 'Durdur');
    ui.progress = h('progress', { max: '1', value: '0' });
    ui.progressText = h('div', { class: 'wat-muted wat-small' }, 'Bekliyor');
    ui.log = h('ol', { class: 'wat-log' });

    ui.search.addEventListener('input', renderList);
    ui.filter.addEventListener('change', renderList);

    const selectVisible = () => {
      for (const c of visibleChats()) selected.add(c.id);
      renderList();
    };
    const clearSelection = () => {
      selected.clear();
      renderList();
    };

    root = h(
      'div',
      { id: 'wat-root', role: 'dialog', 'aria-label': 'WhatsApp Tools' },
      h(
        'div',
        { class: 'wat-head' },
        h('strong', {}, 'WhatsApp Tools'),
        h('span', { class: 'wat-muted wat-small' }, `v${A.version} · yerel, veri göndermez`),
        h('button', { class: 'wat-close', title: 'Kapat', onclick: () => toggle(false) }, '×'),
      ),
      ui.status,
      h(
        'div',
        { class: 'wat-settings' },
        h('fieldset', {},
          h('legend', {}, 'Sohbetler'),
          h('div', { class: 'wat-line' }, ui.search, h('button', { onclick: refreshChats, title: 'Listeyi yenile' }, '↻')),
          h('div', { class: 'wat-line' },
            ui.filter,
            h('button', { onclick: selectVisible }, 'Görünenleri seç'),
            h('button', { onclick: clearSelection }, 'Temizle'),
          ),
          ui.list,
          ui.count,
        ),
        h('fieldset', {},
          h('legend', {}, 'Tarih aralığı (boş = tüm geçmiş)'),
          h('div', { class: 'wat-line' }, h('label', {}, 'Başlangıç ', ui.from), h('label', {}, 'Bitiş ', ui.to)),
        ),
        h('fieldset', {},
          h('legend', {}, 'Biçimler'),
          h('div', { class: 'wat-wrap' },
            ...Object.entries(FORMATS).map(([v, l]) => check('format', v, l, saved.formats.includes(v))),
          ),
          ui.delimiter,
        ),
        h('fieldset', {},
          h('legend', {}, 'Medya'),
          h('label', { class: 'wat-check' }, ui.media, 'Medyayı indir'),
          h('div', { class: 'wat-wrap' },
            ...Object.entries(MEDIA_GROUPS).map(([v, g]) => check('mediaGroup', v, g.label, saved.mediaGroups.includes(v))),
          ),
        ),
        h('fieldset', {},
          h('legend', {}, 'Gelişmiş'),
          h('label', { class: 'wat-check' }, ui.phoneHistory, 'Telefondaki eski mesajları da iste (deneysel, sohbeti açar)'),
        ),
        h('fieldset', {},
          h('legend', {}, 'Çıktı'),
          h('label', { class: 'wat-check' }, ui.folder, 'Klasöre yaz (önerilir, büyük arşivler için)'),
          h('label', { class: 'wat-check' }, zip, 'ZIP indir'),
        ),
      ),
      h('div', { class: 'wat-line' }, ui.start, ui.stop),
      ui.progress,
      ui.progressText,
      ui.log,
    );
    root.hidden = true;
    document.body.append(root);
  }

  function toggle(force) {
    if (!root) build();
    const show = force ?? root.hidden;
    root.hidden = !show;
    if (show) refreshChats();
    else clearTimeout(readyTimer);
  }

  A.togglePanel = toggle;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'wa-tools-bridge') return;
    if (event.data.type === 'toggle') toggle();
  });
})();
