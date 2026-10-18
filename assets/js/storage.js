/* ============================================================
   storage.js — localStorage + IndexedDB 封装
   - 结构化数据：localStorage（体积小、读写快）
   - 图片二进制：IndexedDB（体积大，不能塞 localStorage）
   ============================================================ */
(function (global) {
  'use strict';

  const KEY_DATA = 'worknav:data';
  const KEY_SNAPSHOT = 'worknav:snapshot';
  const KEY_META = 'worknav:meta';

  const SCHEMA_VERSION = 1;

  const DB_NAME = 'worknav';
  const DB_VERSION = 1;
  const STORE_IMG = 'images';

  /* ============================================================
     localStorage 部分
     ============================================================ */

  function lsAvailable() {
    try {
      const k = '__worknav_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  const HAS_LS = lsAvailable();
  let memoryFallback = null; // localStorage 不可用时的内存兜底

  function lsGet(key) {
    if (!HAS_LS) return memoryFallback ? memoryFallback[key] : null;
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, value) {
    if (!HAS_LS) {
      memoryFallback = memoryFallback || {};
      memoryFallback[key] = value;
      return { ok: true, memory: true };
    }
    try {
      global.localStorage.setItem(key, value);
      return { ok: true };
    } catch (e) {
      // 配额超限
      const isQuota =
        e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
      return { ok: false, quota: isQuota, error: e };
    }
  }

  function lsRemove(key) {
    if (!HAS_LS) {
      if (memoryFallback) delete memoryFallback[key];
      return;
    }
    try {
      global.localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }

  /* ============================================================
     默认数据结构
     ============================================================ */

  const DEFAULT_SETTINGS = {
    theme: 'auto',
    background: {
      type: 'preset',
      presetId: 'aurora',
      color: '#1e1e2e',
      gradient: { from: '#667eea', to: '#764ba2', angle: 135 },
      imageId: '',
      url: '',
      blur: 0,
      overlay: 0.15,
      fit: 'cover',
      autoThemeColor: true,
      rotate: { enabled: false, minutes: 5 },
    },
    layout: {
      columns: 'auto',
      cardSize: 'medium',
      showDescription: true,
      sortMode: 'manual',
      showTags: true,
      uncategorizedName: '未分类',
    },
    behavior: {
      defaultOpenIn: 'new',
      allowFaviconFetch: false,
      showClock: true,
      searchEngine: 'baidu',
    },
  };

  const TRASH_LIMIT = 50;

  function defaultData() {
    return {
      version: SCHEMA_VERSION,
      exportedAt: null,
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      categories: [],
      sites: [],
      trash: [],
    };
  }

  /* 只读快照模式：导出时注入的数据，不允许写回 localStorage */
  let readOnly = false;
  function setReadOnly(v) {
    readOnly = !!v;
  }
  function isReadOnly() {
    return readOnly;
  }

  /* ============================================================
     数据迁移
     保留迁移链，保证未来版本升级时老数据不丢
     ============================================================ */

  const migrations = {
    // 示例：1 → 2 的迁移（当前 schema 为 1，暂无实际迁移）
    // 2: function (data) { ... return data; }
  };

  function migrate(data) {
    let v = Number(data.version || 0);
    if (!v) {
      // 无版本号：视为最初版本，补齐结构
      data.version = 1;
      v = 1;
    }
    while (v < SCHEMA_VERSION) {
      const fn = migrations[v + 1];
      if (typeof fn === 'function') {
        try {
          data = fn(data) || data;
        } catch (e) {
          console.warn('[worknav] 数据迁移失败 v' + v + ' → v' + (v + 1), e);
          break;
        }
      }
      v++;
      data.version = v;
    }
    return data;
  }

  /* ============================================================
     结构校验与规范化
     ============================================================ */

  function normalizeCategory(c, i) {
    if (!c || typeof c !== 'object') return null;
    const name = String(c.name || '').trim();
    if (!name) return null;
    return {
      id: String(c.id || U.uid('cat')),
      name: name.slice(0, 40),
      parentId: c.parentId ? String(c.parentId) : null,
      icon: String(c.icon || '').slice(0, 8),
      order: Number.isFinite(c.order) ? c.order : (i + 1) * 100,
      collapsed: !!c.collapsed,
      createdAt: Number(c.createdAt) || Date.now(),
    };
  }

  function normalizeSite(s, i) {
    if (!s || typeof s !== 'object') return null;
    const raw = String(s.url || '').trim();
    if (!raw) return null;
    const n = U.normalizeUrl(raw);
    if (!n.ok) return null;
    const openIn = ['default', 'new', 'self'].indexOf(s.openIn) >= 0 ? s.openIn : 'default';
    return {
      id: String(s.id || U.uid('s')),
      name: String(s.name || U.getHost(n.url) || '未命名').trim().slice(0, 60),
      url: n.url,
      categoryId: String(s.categoryId || ''),
      description: String(s.description || '').slice(0, 120),
      icon: String(s.icon || ''),
      tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t).slice(0, 20)).slice(0, 12) : [],
      pinned: !!s.pinned,
      openIn: openIn,
      order: Number.isFinite(s.order) ? s.order : (i + 1) * 100,
      source: ['manual', 'bookmark', 'json'].indexOf(s.source) >= 0 ? s.source : 'manual',
      createdAt: Number(s.createdAt) || Date.now(),
      lastClickAt: Number(s.lastClickAt) || 0,
      clickCount: Number(s.clickCount) || 0,
    };
  }

  /** 深度合并设置，保证新增字段有默认值 */
  function mergeSettings(incoming) {
    const def = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (!incoming || typeof incoming !== 'object') return def;
    const out = Object.assign({}, def, incoming);
    ['background', 'layout', 'behavior'].forEach((k) => {
      out[k] = Object.assign({}, def[k], incoming[k] || {});
    });
    out.background.gradient = Object.assign({}, def.background.gradient, (incoming.background || {}).gradient || {});
    out.background.rotate = Object.assign({}, def.background.rotate, (incoming.background || {}).rotate || {});
    if (['auto', 'light', 'dark'].indexOf(out.theme) < 0) out.theme = 'auto';
    if (['manual', 'name', 'clicks', 'recent'].indexOf(out.layout.sortMode) < 0) out.layout.sortMode = 'manual';
    if (['baidu', 'bing', 'google'].indexOf(out.behavior.searchEngine) < 0) out.behavior.searchEngine = 'baidu';
    // 「未分类」是虚拟分组，名字存在设置里，需要校验非空
    const unc = typeof out.layout.uncategorizedName === 'string' ? out.layout.uncategorizedName.trim() : '';
    out.layout.uncategorizedName = unc ? unc.slice(0, 20) : '未分类';
    return out;
  }

  /**
   * 规范化任意来源的数据对象
   * @returns {{data: object, issues: string[]}}
   */
  function normalize(raw) {
    const issues = [];
    const out = defaultData();

    if (!raw || typeof raw !== 'object') {
      issues.push('数据格式不是对象');
      return { data: out, issues: issues };
    }

    if (Array.isArray(raw.categories)) {
      raw.categories.forEach((c, i) => {
        const n = normalizeCategory(c, i);
        if (n) out.categories.push(n);
        else issues.push('丢弃无效分类');
      });
    } else if (raw.categories != null) {
      issues.push('categories 字段类型错误，已忽略');
    }

    const catIds = new Set(out.categories.map((c) => c.id));

    if (Array.isArray(raw.sites)) {
      raw.sites.forEach((s, i) => {
        const n = normalizeSite(s, i);
        if (!n) {
          issues.push('丢弃无效站点：' + String((s && s.name) || (s && s.url) || '未知'));
          return;
        }
        // 分类不存在则落到未分类
        if (n.categoryId && !catIds.has(n.categoryId)) n.categoryId = '';
        out.sites.push(n);
      });
    } else if (raw.sites != null) {
      issues.push('sites 字段类型错误，已忽略');
    }

    out.settings = mergeSettings(raw.settings);
    out.version = Number(raw.version) || 1;
    out.exportedAt = raw.exportedAt || null;

    // 回收站（最多保留 50 条）
    if (Array.isArray(raw.trash)) {
      raw.trash.slice(0, TRASH_LIMIT).forEach((t, i) => {
        if (!t || typeof t !== 'object') return;
        const site = normalizeSite(t.site, i);
        if (!site) return;
        out.trash.push({ site: site, at: Number(t.at) || Date.now() });
      });
    }

    // 清理孤儿 parentId
    const removeSet = new Set();
    out.categories.forEach((c) => {
      if (c.parentId && !catIds.has(c.parentId)) c.parentId = null;
    });
    // 限制只有两层：父分类的 parentId 必须为空
    out.categories.forEach((c) => {
      if (c.parentId) {
        const p = out.categories.find((x) => x.id === c.parentId);
        if (p && p.parentId) c.parentId = null; // 三级降级为一级
      }
    });
    void removeSet;

    return { data: out, issues: issues };
  }

  /* ============================================================
     读写入口
     ============================================================ */

  function load() {
    const txt = lsGet(KEY_DATA);
    if (!txt) return { data: defaultData(), issues: [], firstRun: true };
    let parsed = null;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      console.error('[worknav] 本地数据解析失败', e);
      return { data: defaultData(), issues: ['本地数据损坏，已重置为空白数据'], corrupted: true };
    }
    const migrated = migrate(parsed);
    const res = normalize(migrated);
    return { data: res.data, issues: res.issues, firstRun: false };
  }

  function save(data) {
    if (readOnly) return { ok: true, skipped: true };
    const json = JSON.stringify(data);
    const res = lsSet(KEY_DATA, json);
    if (!res.ok && res.quota) {
      return {
        ok: false,
        quota: true,
        message: '浏览器本地存储空间不足，请减少背景图片或删除部分站点后重试。',
      };
    }
    if (!res.ok) {
      return { ok: false, message: '数据保存失败：' + ((res.error && res.error.message) || '未知错误') };
    }
    return { ok: true, memory: !!res.memory, bytes: json.length };
  }

  /** 保存前快照（用于回滚，只保留最近一份） */
  function snapshot() {
    if (readOnly) return;
    const cur = lsGet(KEY_DATA);
    if (cur) lsSet(KEY_SNAPSHOT, cur);
  }

  function hasSnapshot() {
    return !!lsGet(KEY_SNAPSHOT);
  }

  function readSnapshot() {
    const txt = lsGet(KEY_SNAPSHOT);
    if (!txt) return null;
    try {
      return JSON.parse(txt);
    } catch (e) {
      return null;
    }
  }

  function clearSnapshot() {
    lsRemove(KEY_SNAPSHOT);
  }

  function clearAll() {
    lsRemove(KEY_DATA);
    lsRemove(KEY_SNAPSHOT);
    lsRemove(KEY_META);
  }

  /** 粗略估算已用字节 */
  function usedBytes() {
    const txt = lsGet(KEY_DATA);
    return txt ? txt.length : 0;
  }

  /* ============================================================
     IndexedDB 部分（图片）
     ============================================================ */

  let dbPromise = null;
  let idbDisabled = false;

  function openDB() {
    if (idbDisabled) return Promise.reject(new Error('indexedDB disabled'));
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        if (!global.indexedDB) throw new Error('浏览器不支持 IndexedDB');
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        idbDisabled = true;
        reject(e);
        return;
      }
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_IMG)) {
          db.createObjectStore(STORE_IMG, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbDisabled = true;
        reject(req.error || new Error('IndexedDB 打开失败'));
      };
      req.onblocked = () => {
        /* 多标签页时可能阻塞，等待即可 */
      };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(STORE_IMG, mode);
          const store = t.objectStore(STORE_IMG);
          let result;
          try {
            result = fn(store);
          } catch (e) {
            reject(e);
            return;
          }
          t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error || new Error('事务中止'));
        })
    );
  }

  /** 保存图片 { id, blob, w, h, size, name, createdAt } */
  async function putImage(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE_IMG, 'readwrite');
      t.objectStore(STORE_IMG).put(record);
      t.oncomplete = () => resolve(record);
      t.onerror = () => reject(t.error);
    });
  }

  async function getImage(id) {
    if (!id) return null;
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE_IMG, 'readonly');
        const r = t.objectStore(STORE_IMG).get(id);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      return null;
    }
  }

  async function listImages() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE_IMG, 'readonly');
        const r = t.objectStore(STORE_IMG).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      return [];
    }
  }

  async function deleteImage(id) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE_IMG, 'readwrite');
        t.objectStore(STORE_IMG).delete(id);
        t.oncomplete = () => resolve(true);
        t.onerror = () => reject(t.error);
      });
    } catch (e) {
      return false;
    }
  }

  /** 清理未被引用的图片，避免 IndexedDB 无限增长 */
  async function gcImages(usedIds) {
    const used = new Set(usedIds || []);
    const all = await listImages();
    let removed = 0;
    for (const rec of all) {
      if (!used.has(rec.id)) {
        await deleteImage(rec.id);
        removed++;
      }
    }
    return removed;
  }

  function isIdbDisabled() {
    return idbDisabled;
  }

  /* ============================================================
     导出
     ============================================================ */

  global.Storage = {
    SCHEMA_VERSION,
    DEFAULT_SETTINGS,
    defaultData,
    normalize,
    mergeSettings,
    load,
    save,
    snapshot,
    hasSnapshot,
    readSnapshot,
    clearSnapshot,
    clearAll,
    usedBytes,
    lsAvailable: HAS_LS,
    setReadOnly,
    isReadOnly,
    TRASH_LIMIT,
    // images
    putImage,
    getImage,
    listImages,
    deleteImage,
    gcImages,
    isIdbDisabled,
    // 内部（测试用）
    _tx: tx,
  };
})(window);
