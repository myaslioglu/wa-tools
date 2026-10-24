// Minimal ZIP writer (stored entries, no compression). Media is already
// compressed, and the archive is assembled from Blob parts, so file bytes are
// read once for the CRC and never copied into one large buffer.
(() => {
  'use strict';
  const A = (window.__waTools ??= {});

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crcUpdate(crc, bytes) {
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return crc;
  }

  const CHUNK = 8 * 1024 * 1024;

  async function crcBlob(blob) {
    let crc = 0xffffffff;
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
      crc = crcUpdate(crc, bytes);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  const UTF8_FLAG = 0x0800;
  const MAX_U32 = 0xffffffff;
  const LIMIT_MESSAGE =
    'ZIP sınırı aşıldı (4 GB veya 65.535 dosya). "Klasöre yaz" çıktısını seçin ya da tarih aralığını daraltın.';

  class ZipWriter {
    constructor() {
      this.parts = [];
      this.central = [];
      this.offset = 0;
      this.count = 0;
      this.stamp = dosDateTime(new Date());
    }

    async add(path, data) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const name = new TextEncoder().encode(path);
      if (this.count + 1 > 0xffff || this.offset + 30 + name.length + blob.size >= MAX_U32) {
        throw new Error(LIMIT_MESSAGE);
      }
      const crc = await crcBlob(blob);
      const { time, date } = this.stamp;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, UTF8_FLAG, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, blob.size, true);
      local.setUint32(22, blob.size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);

      const central = new Uint8Array(46 + name.length);
      const cd = new DataView(central.buffer);
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, UTF8_FLAG, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, blob.size, true);
      cd.setUint32(24, blob.size, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, this.offset, true);
      central.set(name, 46);

      this.parts.push(local.buffer, name, blob);
      this.central.push(central);
      this.offset += 30 + name.length + blob.size;
      this.count += 1;
    }

    finish() {
      const centralSize = this.central.reduce((sum, entry) => sum + entry.length, 0);
      if (this.offset + centralSize >= MAX_U32) throw new Error(LIMIT_MESSAGE);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, this.count, true);
      end.setUint16(10, this.count, true);
      end.setUint32(12, centralSize, true);
      end.setUint32(16, this.offset, true);
      return new Blob([...this.parts, ...this.central, end.buffer], { type: 'application/zip' });
    }
  }

  A.ZipWriter = ZipWriter;
})();
