/**
 * Loader.js — loads every bundled data file with a progress report.
 *
 * Everything ships with the game (no network, no CDN): the loader simply reads
 * the JSON tables from src/data and reports progress to the boot screen.
 */
export class Loader {
  constructor(bus, i18n) {
    this.bus = bus;
    this.i18n = i18n;
    this.cache = new Map();
  }

  /** Fetch one JSON file, memoised. */
  async json(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    const res = await fetch(path, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
    const data = await res.json();
    this.cache.set(path, data);
    return data;
  }

  /**
   * Load everything the game needs.
   * @param {(progress:number, statusKey:string, vars?:object)=>void} onProgress
   */
  async loadAll(onProgress = () => { }) {
    const files = [
      { key: 'terminal', path: 'src/data/terminal.json' },
      { key: 'machines', path: 'src/data/machines.json' },
      { key: 'lessons', path: 'src/data/lessons.json' },
      { key: 'missions', path: 'src/data/missions.json' },
      { key: 'dialogue', path: 'src/data/dialogue.json' }
    ];
    const total = files.length + 1;    // +1 for the string tables
    const out = {};
    onProgress(0.08, 'boot.loading');

    // language tables first so the boot screen can be translated
    try {
      await this.i18n.load('src/data');
    } catch (err) {
      console.warn('[loader] string tables failed', err);
    }
    onProgress(1 / total, 'boot.loading');

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        out[f.key] = await this.json(f.path);
      } catch (err) {
        console.warn(`[loader] ${f.path} failed`, err);
        out[f.key] = null;
      }
      onProgress((i + 2) / total, 'boot.loading');
      this.bus?.emit('loader:file', { key: f.key });
    }

    if (!out.terminal || !out.machines) {
      throw new Error('Core data files are missing or damaged.');
    }
    this.bus?.emit('loader:done', {});
    return out;
  }
}

export default Loader;
