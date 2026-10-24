// Export orchestration: one folder per chat, media streamed to the sink as it
// downloads, and a summary that records what is missing and why.
(() => {
  'use strict';
  const A = (window.__waTools ??= {});

  function uniqueName(used, base) {
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})`;
    used.add(name.toLowerCase());
    return name;
  }

  function mediaFileName(used, record) {
    const ext = A.mediaExt(record.media.mimetype, record.media.filename);
    const stamp = A.stamp(new Date(record.t * 1000));
    const original = record.media.filename ? A.safeName(record.media.filename.replace(/\.[^.]+$/, ''), 60) : '';
    const base = original ? `${stamp}_${original}` : `${stamp}_${A.safeName(record.key, 12)}`;
    let name = `${base}.${ext}`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}_${i}.${ext}`;
    used.add(name.toLowerCase());
    return name;
  }

  async function exportChat(id, options, ctx) {
    const { from, to, formats, media, mediaTypes, phoneHistory, csvDelimiter, sink, signal, report } = options;
    const chat = A.wa.getChat(id);
    if (!chat) return { id, error: 'Sohbet bulunamadı' };
    const title = A.wa.chatTitle(chat);
    report({ chat: title, step: 'Geçmiş yükleniyor…' });

    const history = await A.wa.ensureHistory(chat, {
      since: from,
      signal,
      phoneHistory,
      onProgress: (count, oldest) =>
        report({
          chat: title,
          step: `Geçmiş yükleniyor: ${count} mesaj${oldest ? ` (en eski ${A.fmtDate(new Date(oldest * 1000))})` : ''}`,
        }),
    });
    history.complete = history.reachedStart || history.coveredRangeStart;

    const people = A.wa.names();
    const messages = A.wa.messagesInRange(chat, from, to);
    const records = messages.map((m) => A.wa.describe(m, people));
    const folder = uniqueName(ctx.folders, A.safeName(title, 60));
    const stats = { ok: 0, failed: 0, skipped: 0 };

    if (media) {
      const usedNames = new Set();
      const pending = records.filter((r) => r.media);
      let done = 0;
      for (const [i, record] of records.entries()) {
        if (!record.media) continue;
        A.throwIfAborted(signal);
        if (!mediaTypes.has(record.type)) {
          record.media.status = 'skipped';
          stats.skipped += 1;
          continue;
        }
        done += 1;
        report({ chat: title, step: `Medya ${done}/${pending.length} indiriliyor…` });
        try {
          const blob = await A.wa.fetchMedia(messages[i], signal);
          const name = mediaFileName(usedNames, record);
          await sink.write(`${folder}/media/${name}`, blob);
          record.media.file = `media/${name}`;
          record.media.status = 'ok';
          record.media.size ??= blob.size;
          stats.ok += 1;
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          record.media.status = 'failed';
          record.media.error = error?.message ?? String(error);
          stats.failed += 1;
        }
      }
    } else {
      for (const record of records) if (record.media) stats.skipped += 1;
    }

    const isGroup = A.wa.isGroup(chat);
    const info = {
      id,
      title,
      isGroup,
      participants: isGroup ? A.wa.participants(chat, people) : [],
      me: people.me,
      exportedAt: new Date(),
      range: {
        from: from ? A.isoLocal(new Date(from * 1000)) : null,
        to: Number.isFinite(to) ? A.isoLocal(new Date(to * 1000)) : null,
      },
      history,
    };
    report({ chat: title, step: 'Dosyalar yazılıyor…' });
    if (formats.has('html')) await sink.write(`${folder}/sohbet.html`, A.formats.html(info, records));
    if (formats.has('txt')) await sink.write(`${folder}/sohbet.txt`, A.formats.txt(info, records));
    if (formats.has('csv')) await sink.write(`${folder}/mesajlar.csv`, A.formats.csv(info, records, csvDelimiter));
    if (formats.has('json')) await sink.write(`${folder}/mesajlar.json`, A.formats.json(info, records));

    return {
      id,
      title,
      folder,
      isGroup,
      messageCount: records.length,
      firstTs: records[0]?.t ?? null,
      lastTs: records.at(-1)?.t ?? null,
      history,
      media: media ? stats : null,
    };
  }

  // options: chatIds, from/to (unix seconds; to is exclusive), formats (Set),
  // media (bool), mediaTypes (Set), phoneHistory, csvDelimiter, sink, signal,
  // report({chat, step, index, total}).
  A.runExport = async function runExport(options) {
    const { chatIds, sink, signal } = options;
    const startedAt = new Date();
    const summary = {
      schema: 'wa-tools/export/1',
      tool: { name: 'WhatsApp Tools', version: A.version },
      startedAt: A.isoLocal(startedAt),
      finishedAt: null,
      aborted: false,
      options: {
        from: options.from || null,
        to: Number.isFinite(options.to) ? options.to : null,
        formats: [...options.formats],
        media: options.media,
        mediaTypes: [...options.mediaTypes],
        phoneHistory: options.phoneHistory,
      },
      chats: [],
      limitations: [
        'Yalnızca WhatsApp Web’in bu tarayıcıya yüklediği veya telefondan getirebildiği mesajlar dışa aktarılır.',
        'Tepkiler (emoji reaksiyonları), anket oyları ve görüntülenme durumları dışa aktarılmaz.',
        'Sunucuda süresi dolmuş medya indirilemez; bu durum ilgili mesajda belirtilir.',
      ],
    };
    const ctx = { folders: new Set() };
    let fatal = null;
    try {
      for (const [index, id] of chatIds.entries()) {
        A.throwIfAborted(signal);
        const report = (event) => options.report?.({ ...event, index, total: chatIds.length });
        try {
          summary.chats.push(await exportChat(id, { ...options, report }, ctx));
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          summary.chats.push({ id, error: error?.message ?? String(error) });
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') summary.aborted = true;
      else fatal = error;
    }
    // Whatever was exported stays usable, also after a stop or failure.
    summary.finishedAt = A.isoLocal(new Date());
    if (fatal) summary.error = fatal.message ?? String(fatal);
    await sink.write('index.html', A.formats.indexHtml(summary, options.formats.has('html')));
    await sink.write('disa-aktarim.json', JSON.stringify(summary, null, 2));
    const output = await sink.close();
    return { output, summary };
  };
})();
