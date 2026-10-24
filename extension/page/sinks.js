// Output destinations. Both expose write(path, data) and close().
(() => {
  'use strict';
  const A = (window.__waTools ??= {});

  // Writes straight into a folder the user picks. Each file is streamed to disk
  // as soon as it is ready, so large media archives do not accumulate in memory.
  class DirectorySink {
    static supported() {
      return typeof window.showDirectoryPicker === 'function';
    }

    // Must be called directly from a click handler: the picker needs the
    // user's gesture, so nothing may be awaited before it.
    static async open(rootName) {
      const parent = await window.showDirectoryPicker({ id: 'wa-tools', mode: 'readwrite', startIn: 'downloads' });
      const root = await parent.getDirectoryHandle(rootName, { create: true });
      return new DirectorySink(root, `${parent.name}/${rootName}`);
    }

    constructor(root, label) {
      this.root = root;
      this.label = label;
      this.dirs = new Map();
    }

    async dir(parts) {
      let handle = this.root;
      let key = '';
      for (const part of parts) {
        key += `/${part}`;
        let next = this.dirs.get(key);
        if (!next) {
          next = await handle.getDirectoryHandle(part, { create: true });
          this.dirs.set(key, next);
        }
        handle = next;
      }
      return handle;
    }

    async write(path, data) {
      const parts = path.split('/');
      const fileName = parts.pop();
      const dir = await this.dir(parts);
      const file = await dir.getFileHandle(fileName, { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(data);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
    }

    async close() {
      return { kind: 'folder', label: this.label };
    }
  }

  // Fallback when the File System Access API is unavailable: one ZIP download.
  class ZipSink {
    constructor(rootName) {
      this.rootName = rootName;
      this.zip = new A.ZipWriter();
    }

    write(path, data) {
      return this.zip.add(`${this.rootName}/${path}`, data);
    }

    async close() {
      const blob = this.zip.finish();
      A.saveBlob(blob, `${this.rootName}.zip`);
      return { kind: 'zip', label: `${this.rootName}.zip`, size: blob.size };
    }
  }

  A.saveBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    // Keep the URL alive long enough for Chrome to read a large archive.
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  };

  A.DirectorySink = DirectorySink;
  A.ZipSink = ZipSink;
})();
