/* ============================================================
   store.js — 状态管理（单一数据源 + 订阅刷新）
   ============================================================ */
(function (global) {
  'use strict';

  const state = {
    data: null,
    ui: {
      keyword: '',
      rawKeyword: '',
      activeCategory: 'all', // all | pinned | uncategorized | <categoryId>
      sidebarOpen: false,
      selectMode: false,
      selected: new Set(),
      collapsed: Object.create(null),
      activeCardIndex: -1,
    },
    runtime: {
      thumbUrls: {}, // imageId -> ObjectURL（背景层用）
      warnings: [],
    },
  };

  const listeners = { change: new Set(), ui: new Set() };

  /* ---------- 订阅 ---------- */
  function onChange(fn) {
    listeners.change.add(fn);
    return () => listeners.change.delete(fn);
  }
  function onUi(fn) {
    listeners.ui.add(fn);
    return () => listeners.ui.delete(fn);
  }
  function emitChange(reason) {
    listeners.change.forEach((fn) => {
      try {
        fn(state, reason);
      } catch (e) {
        console.error('[worknav] change 监听器出错', e);
      }
    });
  }
  function emitUi(reason) {
    listeners.ui.forEach((fn) => {
      try {
        fn(state, reason);
      } catch (e) {
        console.error('[worknav] ui 监听器出错', e);
      }
    });
  }

  /* ---------- 持久化 ---------- */
  let persistTimer = null;
  let lastPersistError = null;

  function persistNow() {
    const data = state.data;
    if (!data) return { ok: true };
    data.exportedAt = data.exportedAt; // 不更新导出时间
    const res = global.Storage.save(data);
    if (!res.ok) {
      lastPersistError = res.message;
      console.error('[worknav]', res.message);
    } else {
      lastPersistError = null;
    }
    return res;
  }

  const persistDebounced = U.debounce(() => {
    const res = persistNow();
    if (!res.ok) {
      emitUi('persist-error');
    }
  }, 400);

  function persist() {
    persistDebounced();
  }

  function getLastPersistError() {
    return lastPersistError;
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // 只读快照：数据由导出时注入，覆盖本地数据且不落盘
    const injected = global.__NAV_SNAPSHOT__;
    if (injected && typeof injected === 'object') {
      const norm = global.Storage.normalize(injected);
      state.data = norm.data;
      state.runtime.warnings = norm.issues || [];
      global.Storage.setReadOnly(true);
      return { data: state.data, issues: norm.issues || [], firstRun: false, readOnly: true };
    }
    const res = global.Storage.load();
    state.data = res.data;
    state.runtime.warnings = res.issues || [];
    return res;
  }

  function isReadOnly() {
    return global.Storage.isReadOnly();
  }

  /* ---------- 变更提交 ---------- */
  /**
   * 一次性写操作：先快照、再改动、再持久化、再通知
   * @param {Function} mutator 直接修改 state.data 的函数
   */
  function commit(mutator, reason, opts) {
    opts = opts || {};
    if (isReadOnly()) return undefined; // 只读快照：静默忽略写操作
    if (!opts.noSnapshot) global.Storage.snapshot();
    const ret = mutator(state.data);
    persist();
    emitChange(reason || 'commit');
    return ret;
  }

  /* ============================================================
     查询
     ============================================================ */

  function getData() {
    return state.data;
  }
  function getSettings() {
    return state.data.settings;
  }
  function getCategories() {
    return state.data.categories;
  }
  function getSites() {
    return state.data.sites;
  }

  function getCategory(id) {
    return state.data.categories.find((c) => c.id === id) || null;
  }

  function getSite(id) {
    return state.data.sites.find((s) => s.id === id) || null;
  }

  /** 一级分类 */
  function topCategories() {
    return state.data.categories
      .filter((c) => !c.parentId)
      .sort((a, b) => a.order - b.order);
  }

  /** 某分类下的子分类 */
  function childCategories(parentId) {
    return state.data.categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }

  /** 分类下的站点（含子分类） */
  function sitesOfCategory(catId, includeChildren) {
    const ids = new Set([catId]);
    if (includeChildren !== false) {
      childCategories(catId).forEach((c) => ids.add(c.id));
    }
    return state.data.sites
      .filter((s) => ids.has(s.categoryId))
      .sort(siteSorter);
  }

  function uncategorizedSites() {
    const catIds = new Set(state.data.categories.map((c) => c.id));
    return state.data.sites
      .filter((s) => !s.categoryId || !catIds.has(s.categoryId))
      .sort(siteSorter);
  }

  function pinnedSites() {
    return state.data.sites.filter((s) => s.pinned).sort(siteSorter);
  }

  /** 排序：置顶优先 → 按当前排序模式 */
  function siteSorter(a, b) {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const mode = (state.data.settings.layout && state.data.settings.layout.sortMode) || 'manual';
    if (mode === 'name') return a.name.localeCompare(b.name, 'zh-CN');
    if (mode === 'clicks') {
      const d = (b.clickCount || 0) - (a.clickCount || 0);
      return d !== 0 ? d : a.name.localeCompare(b.name, 'zh-CN');
    }
    if (mode === 'recent') {
      const d = (b.lastClickAt || 0) - (a.lastClickAt || 0);
      if (d !== 0) return d;
      const c = (b.createdAt || 0) - (a.createdAt || 0);
      return c !== 0 ? c : a.name.localeCompare(b.name, 'zh-CN');
    }
    if (a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name, 'zh-CN');
  }

  function categoryTree() {
    const tops = topCategories();
    return tops.map((t) => ({
      cat: t,
      children: childCategories(t.id),
    }));
  }

  /* ============================================================
     分类操作
     ============================================================ */

  function addCategory(name, parentId, icon) {
    name = String(name || '').trim();
    if (!name) return { ok: false, message: '分类名不能为空' };
    const dup = state.data.categories.find(
      (c) => c.name === name && (c.parentId || null) === (parentId || null)
    );
    if (dup) return { ok: false, message: '同级下已有同名分类', category: dup };

    const siblings = state.data.categories.filter((c) => (c.parentId || null) === (parentId || null));
    const maxOrder = siblings.reduce((m, c) => Math.max(m, c.order), 0);

    const cat = {
      id: U.uid('cat'),
      name: name.slice(0, 40),
      parentId: parentId || null,
      icon: icon || '',
      order: maxOrder + 100,
      collapsed: false,
      createdAt: Date.now(),
    };
    commit((d) => d.categories.push(cat), 'category:add');
    return { ok: true, category: cat };
  }

  function updateCategory(id, patch) {
    const cat = getCategory(id);
    if (!cat) return { ok: false, message: '分类不存在' };
    commit((d) => {
      const c = d.categories.find((x) => x.id === id);
      if (!c) return;
      if (patch.name !== undefined) {
        const nm = String(patch.name).trim();
        if (nm) {
          const dup = d.categories.find(
            (x) => x.id !== id && x.name === nm && (x.parentId || null) === (c.parentId || null)
          );
          if (!dup) c.name = nm.slice(0, 40);
        }
      }
      if (patch.icon !== undefined) c.icon = String(patch.icon).slice(0, 8);
      if (patch.collapsed !== undefined) c.collapsed = !!patch.collapsed;
      if (patch.order !== undefined) c.order = patch.order;
      if (patch.parentId !== undefined) {
        const pid = patch.parentId || null;
        if (pid !== id) {
          const p = pid ? d.categories.find((x) => x.id === pid) : null;
          if (!p || !p.parentId) c.parentId = pid; // 只允许挂在一级分类下
        }
      }
    }, 'category:update');
    return { ok: true };
  }

  /**
   * 删除分类
   * @param {string} id
   * @param {'move-to-uncategorized'|'delete-all'} strategy
   */
  function deleteCategory(id, strategy) {
    const cat = getCategory(id);
    if (!cat) return { ok: false, message: '分类不存在' };
    const children = childCategories(id);
    const childIds = children.map((c) => c.id);
    const allIds = new Set([id].concat(childIds));
    const affected = state.data.sites.filter((s) => allIds.has(s.categoryId)).length;

    commit((d) => {
      if (strategy === 'delete-all') {
        d.sites = d.sites.filter((s) => !allIds.has(s.categoryId));
      } else {
        d.sites.forEach((s) => {
          if (allIds.has(s.categoryId)) s.categoryId = '';
        });
      }
      d.categories = d.categories.filter((c) => !allIds.has(c.id));
    }, 'category:delete');

    return { ok: true, affected: affected, children: children.length };
  }

  function reorderCategory(id, newOrder) {
    return updateCategory(id, { order: newOrder });
  }

  /* ============================================================
     站点操作
     ============================================================ */

  function addSite(input, opts) {
    opts = opts || {};
    const n = U.normalizeUrl(input.url);
    if (!n.ok) return { ok: false, message: n.reason };

    const key = U.urlKey(n.url);
    const existing = state.data.sites.find((s) => U.urlKey(s.url) === key);
    if (existing && !opts.allowDuplicate) {
      return { ok: false, duplicate: true, existing: existing, message: '已存在相同网址：' + existing.name };
    }

    const catId = input.categoryId && getCategory(input.categoryId) ? input.categoryId : '';
    const siblings = state.data.sites.filter((s) => s.categoryId === catId);
    const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order), 0);

    const site = {
      id: U.uid('s'),
      name: String(input.name || '').trim().slice(0, 60) || U.getHost(n.url) || '未命名',
      url: n.url,
      categoryId: catId,
      description: String(input.description || '').slice(0, 120),
      icon: String(input.icon || ''),
      tags: parseTags(input.tags),
      pinned: !!input.pinned,
      openIn: ['default', 'new', 'self'].indexOf(input.openIn) >= 0 ? input.openIn : 'default',
      order: maxOrder + 100,
      source: opts.source || 'manual',
      createdAt: Date.now(),
      clickCount: 0,
    };

    commit((d) => d.sites.push(site), 'site:add');
    return { ok: true, site: site };
  }

  function updateSite(id, patch) {
    const site = getSite(id);
    if (!site) return { ok: false, message: '站点不存在' };

    if (patch.url !== undefined) {
      const n = U.normalizeUrl(patch.url);
      if (!n.ok) return { ok: false, message: n.reason };
      patch.url = n.url;
    }

    commit((d) => {
      const s = d.sites.find((x) => x.id === id);
      if (!s) return;
      if (patch.name !== undefined) s.name = String(patch.name).trim().slice(0, 60) || s.name;
      if (patch.url !== undefined) s.url = patch.url;
      if (patch.description !== undefined) s.description = String(patch.description).slice(0, 120);
      if (patch.icon !== undefined) s.icon = String(patch.icon);
      if (patch.tags !== undefined) s.tags = parseTags(patch.tags);
      if (patch.pinned !== undefined) s.pinned = !!patch.pinned;
      if (patch.openIn !== undefined && ['default', 'new', 'self'].indexOf(patch.openIn) >= 0) {
        s.openIn = patch.openIn;
      }
      if (patch.categoryId !== undefined) {
        s.categoryId = patch.categoryId && d.categories.some((c) => c.id === patch.categoryId)
          ? patch.categoryId
          : '';
      }
      if (patch.order !== undefined) s.order = patch.order;
    }, 'site:update');
    return { ok: true };
  }

  function deleteSite(id) {
    const site = getSite(id);
    if (!site) return { ok: false, message: '站点不存在' };
    commit((d) => {
      d.sites = d.sites.filter((s) => s.id !== id);
      d.trash = (d.trash || []).filter((t) => t.site.id !== id);
      d.trash.unshift({ site: JSON.parse(JSON.stringify(site)), at: Date.now() });
      if (d.trash.length > global.Storage.TRASH_LIMIT) {
        d.trash = d.trash.slice(0, global.Storage.TRASH_LIMIT);
      }
    }, 'site:delete');
    return { ok: true, site: site };
  }

  function batchDelete(ids) {
    const set = new Set(ids || []);
    const removed = state.data.sites.filter((s) => set.has(s.id));
    if (!removed.length) return { ok: false, count: 0 };
    commit((d) => {
      d.sites = d.sites.filter((s) => !set.has(s.id));
      d.trash = (d.trash || []).filter((t) => !set.has(t.site.id));
      removed.forEach((s) => d.trash.unshift({ site: JSON.parse(JSON.stringify(s)), at: Date.now() }));
      if (d.trash.length > global.Storage.TRASH_LIMIT) {
        d.trash = d.trash.slice(0, global.Storage.TRASH_LIMIT);
      }
    }, 'site:batch-delete');
    return { ok: true, count: removed.length, sites: removed };
  }

  function batchMove(ids, categoryId) {
    const set = new Set(ids || []);
    const catId = categoryId && getCategory(categoryId) ? categoryId : '';
    let n = 0;
    commit((d) => {
      d.sites.forEach((s) => {
        if (set.has(s.id) && s.categoryId !== catId) {
          s.categoryId = catId;
          n++;
        }
      });
    }, 'site:batch-move');
    return { ok: true, count: n };
  }

  function batchPin(ids, pinned) {
    const set = new Set(ids || []);
    let n = 0;
    commit((d) => {
      d.sites.forEach((s) => {
        if (set.has(s.id) && s.pinned !== !!pinned) {
          s.pinned = !!pinned;
          n++;
        }
      });
    }, 'site:batch-pin');
    return { ok: true, count: n };
  }

  /** 撤销删除 */
  function restoreSite(site) {
    if (!site) return { ok: false };
    commit((d) => {
      if (!d.sites.some((s) => s.id === site.id)) d.sites.push(site);
      d.trash = (d.trash || []).filter((t) => t.site.id !== site.id);
    }, 'site:restore');
    return { ok: true };
  }

  function togglePin(id) {
    const site = getSite(id);
    if (!site) return { ok: false };
    commit((d) => {
      const s = d.sites.find((x) => x.id === id);
      if (s) s.pinned = !s.pinned;
    }, 'site:pin');
    return { ok: true, pinned: !site.pinned };
  }

  function recordClick(id) {
    const site = getSite(id);
    if (!site) return;
    site.clickCount = (site.clickCount || 0) + 1;
    site.lastClickAt = Date.now();
    persist();
  }

  /* ============================================================
     拖拽排序
     ============================================================ */

  /**
   * 把 dragId 插到 targetId 之前/之后，重排同组 order
   * @returns {{ok:boolean, message?:string}}
   */
  function reorderSite(dragId, targetId, before) {
    if (dragId === targetId) return { ok: false };
    const mode = (state.data.settings.layout && state.data.settings.layout.sortMode) || 'manual';
    if (mode !== 'manual') return { ok: false, message: '请先在「设置 → 布局」把排序模式切换为「手动排序」' };

    const drag = getSite(dragId);
    const target = getSite(targetId);
    if (!drag || !target) return { ok: false };
    if (drag.categoryId !== target.categoryId) {
      return { ok: false, message: '只能在同一分类内拖拽排序' };
    }

    commit((d) => {
      const group = d.sites
        .filter((s) => s.categoryId === drag.categoryId)
        .sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.order - b.order));
      const from = group.findIndex((s) => s.id === dragId);
      if (from < 0) return;
      const removed = group.splice(from, 1)[0];
      let to = group.findIndex((s) => s.id === targetId);
      if (to < 0) to = group.length;
      if (!before) to += 1;
      group.splice(to, 0, removed);
      group.forEach((s, i) => {
        s.order = (i + 1) * 100;
      });
    }, 'site:reorder');
    return { ok: true };
  }

  function reorderCategory(dragId, targetId, before) {
    if (dragId === targetId) return { ok: false };
    const drag = getCategory(dragId);
    const target = getCategory(targetId);
    if (!drag || !target) return { ok: false };
    if ((drag.parentId || null) !== (target.parentId || null)) {
      return { ok: false, message: '只能在同一层级内拖拽排序' };
    }
    commit((d) => {
      const group = d.categories
        .filter((c) => (c.parentId || null) === (drag.parentId || null))
        .sort((a, b) => a.order - b.order);
      const from = group.findIndex((c) => c.id === dragId);
      if (from < 0) return;
      const removed = group.splice(from, 1)[0];
      let to = group.findIndex((c) => c.id === targetId);
      if (to < 0) to = group.length;
      if (!before) to += 1;
      group.splice(to, 0, removed);
      group.forEach((c, i) => {
        c.order = (i + 1) * 100;
      });
    }, 'category:reorder');
    return { ok: true };
  }

  /* ============================================================
     回收站
     ============================================================ */

  function getTrash() {
    return (state.data.trash || []).slice();
  }

  function restoreFromTrash(siteId) {
    const list = state.data.trash || [];
    const idx = list.findIndex((t) => t.site.id === siteId);
    if (idx < 0) return { ok: false, message: '回收站里没有这条记录' };
    const item = list[idx];
    commit((d) => {
      d.trash = d.trash.filter((t) => t.site.id !== siteId);
      if (!d.sites.some((s) => s.id === item.site.id)) {
        // 分类可能已被删除，落回未分类
        if (item.site.categoryId && !d.categories.some((c) => c.id === item.site.categoryId)) {
          item.site.categoryId = '';
        }
        d.sites.push(item.site);
      }
    }, 'trash:restore');
    return { ok: true, site: item.site };
  }

  function removeTrashItem(siteId) {
    commit((d) => {
      d.trash = (d.trash || []).filter((t) => t.site.id !== siteId);
    }, 'trash:remove');
    return { ok: true };
  }

  function emptyTrash() {
    commit((d) => {
      d.trash = [];
    }, 'trash:empty');
    return { ok: true };
  }

  function setSortMode(mode) {
    if (['manual', 'name', 'clicks', 'recent'].indexOf(mode) < 0) return { ok: false };
    updateSettings(
      { layout: Object.assign({}, state.data.settings.layout, { sortMode: mode }) },
      'settings:sort-mode'
    );
    return { ok: true };
  }

  function parseTags(v) {
    if (Array.isArray(v)) return v.map((t) => String(t).trim().slice(0, 20)).filter(Boolean).slice(0, 12);
    return String(v || '')
      .split(/[,，\s]+/)
      .map((t) => t.trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 12);
  }

  /* ============================================================
     批量导入
     ============================================================ */

  /**
   * 批量写入（导入收藏夹 / JSON 恢复共用）
   * @param {object} payload { categories: [{name, parentName}], sites: [{name,url,categoryName,description,icon,tags}] }
   * @param {object} opts { mode: 'merge'|'newonly'|'replace' }
   */
  function bulkImport(payload, opts) {
    opts = opts || {};
    const mode = opts.mode || 'merge';
    const result = {
      addedSites: 0,
      skippedSites: 0,
      addedCategories: 0,
      reusedCategories: 0,
      failedSites: 0,
      total: 0,
    };

    commit((d) => {
      if (mode === 'replace') {
        d.categories = [];
        d.sites = [];
      }

      // 已有分类名 → id 映射（同名视为同一分类）
      const catByName = new Map();
      d.categories.forEach((c) => {
        const key = (c.parentId || '') + '|' + c.name;
        catByName.set(key, c.id);
      });

      // 已有 URL 集合
      const urlSet = new Set(d.sites.map((s) => U.urlKey(s.url)));

      let catOrder = d.categories.reduce((m, c) => Math.max(m, c.order), 0);

      // 1. 先建分类
      (payload.categories || []).forEach((pc) => {
        const name = String(pc.name || '').trim().slice(0, 40);
        if (!name) return;
        const parentName = pc.parentName ? String(pc.parentName).trim().slice(0, 40) : '';

        let parentId = null;
        if (parentName) {
          const pKey = '|' + parentName;
          if (catByName.has(pKey)) {
            parentId = catByName.get(pKey);
            result.reusedCategories++;
          } else {
            catOrder += 100;
            const pCat = {
              id: U.uid('cat'),
              name: parentName,
              parentId: null,
              icon: '',
              order: catOrder,
              collapsed: false,
              createdAt: Date.now(),
            };
            d.categories.push(pCat);
            catByName.set(pKey, pCat.id);
            parentId = pCat.id;
            result.addedCategories++;
          }
        }

        const key = (parentId || '') + '|' + name;
        if (catByName.has(key)) {
          result.reusedCategories++;
          return;
        }
        catOrder += 100;
        const cat = {
          id: U.uid('cat'),
          name: name,
          parentId: parentId,
          icon: pc.icon || '',
          order: catOrder,
          collapsed: false,
          createdAt: Date.now(),
        };
        d.categories.push(cat);
        catByName.set(key, cat.id);
        result.addedCategories++;
      });

      // 2. 再建站点
      let siteOrder = d.sites.reduce((m, s) => Math.max(m, s.order), 0);

      (payload.sites || []).forEach((ps) => {
        result.total++;
        const n = U.normalizeUrl(ps.url);
        if (!n.ok) {
          result.failedSites++;
          return;
        }
        const ukey = U.urlKey(n.url);
        if (urlSet.has(ukey)) {
          result.skippedSites++;
          return;
        }

        // 定位分类
        let catId = '';
        const catName = String(ps.categoryName || '').trim().slice(0, 40);
        const parentName = String(ps.parentName || '').trim().slice(0, 40);
        if (catName) {
          let parentId = null;
          if (parentName) {
            const pKey = '|' + parentName;
            if (catByName.has(pKey)) parentId = catByName.get(pKey);
            else {
              catOrder += 100;
              const pCat = {
                id: U.uid('cat'),
                name: parentName,
                parentId: null,
                icon: '',
                order: catOrder,
                collapsed: false,
                createdAt: Date.now(),
              };
              d.categories.push(pCat);
              catByName.set(pKey, pCat.id);
              parentId = pCat.id;
              result.addedCategories++;
            }
          }
          const key = (parentId || '') + '|' + catName;
          if (catByName.has(key)) {
            catId = catByName.get(key);
          } else if (mode !== 'newonly' || true) {
            // 分类不存在则创建
            catOrder += 100;
            const cat = {
              id: U.uid('cat'),
              name: catName,
              parentId: parentId,
              icon: '',
              order: catOrder,
              collapsed: false,
              createdAt: Date.now(),
            };
            d.categories.push(cat);
            catByName.set(key, cat.id);
            catId = cat.id;
            result.addedCategories++;
          }
        }

        siteOrder += 100;
        d.sites.push({
          id: U.uid('s'),
          name: String(ps.name || '').trim().slice(0, 60) || U.getHost(n.url),
          url: n.url,
          categoryId: catId,
          description: String(ps.description || '').slice(0, 120),
          icon: String(ps.icon || ''),
          tags: Array.isArray(ps.tags) ? ps.tags.slice(0, 12) : [],
          pinned: false,
          openIn: 'default',
          order: siteOrder,
          source: ps.source || 'bookmark',
          createdAt: Number(ps.createdAt) || Date.now(),
          clickCount: 0,
        });
        urlSet.add(ukey);
        result.addedSites++;
      });
    }, 'bulk:import', { noSnapshot: !!opts.noSnapshot });

    return result;
  }

  /* ============================================================
     设置
     ============================================================ */

  function updateSettings(patch, reason) {
    commit((d) => {
      d.settings = global.Storage.mergeSettings(Object.assign({}, d.settings, patch));
    }, reason || 'settings:update');
    return { ok: true };
  }

  /**
   * 「未分类」是虚拟分组，不在 categories 里，
   * 因此它的显示名存进 settings.layout.uncategorizedName
   */
  function uncategorizedName() {
    const layout = (state.data.settings && state.data.settings.layout) || {};
    const name = typeof layout.uncategorizedName === 'string' ? layout.uncategorizedName.trim() : '';
    return name || '未分类';
  }

  function setUncategorizedName(name) {
    const v = String(name == null ? '' : name).trim().slice(0, 20);
    if (!v) return { ok: false, message: '名称不能为空' };
    updateSettings(
      { layout: Object.assign({}, state.data.settings.layout, { uncategorizedName: v }) },
      'settings:uncategorized-name'
    );
    return { ok: true, name: v };
  }

  function updateBackground(patch) {
    commit((d) => {
      d.settings.background = Object.assign({}, d.settings.background, patch);
    }, 'settings:background');
    return { ok: true };
  }

  function replaceAll(newData, reason) {
    commit((d) => {
      const normalized = global.Storage.normalize(newData).data;
      d.categories = normalized.categories;
      d.sites = normalized.sites;
      d.settings = normalized.settings;
      d.version = normalized.version;
    }, reason || 'data:replace');
    return { ok: true };
  }

  function clearAllData() {
    commit((d) => {
      d.categories = [];
      d.sites = [];
    }, 'data:clear');
    return { ok: true };
  }

  /* ============================================================
     UI 状态
     ============================================================ */

  function setUi(patch, reason) {
    Object.assign(state.ui, patch);
    emitUi(reason || 'ui');
  }

  function setKeyword(kw) {
    setUi({ rawKeyword: kw, keyword: String(kw || '').trim() }, 'ui:keyword');
  }

  function setActiveCategory(id) {
    setUi({ activeCategory: id || 'all', sidebarOpen: false }, 'ui:category');
  }

  function toggleSidebar(force) {
    const next = force === undefined ? !state.ui.sidebarOpen : !!force;
    setUi({ sidebarOpen: next }, 'ui:sidebar');
  }

  /* ---------- 统计 ---------- */
  function stats() {
    const sites = state.data.sites;
    const cats = state.data.categories;
    const clicks = sites.reduce((m, s) => m + (s.clickCount || 0), 0);
    return {
      sites: sites.length,
      categories: cats.length,
      pinned: sites.filter((s) => s.pinned).length,
      uncategorized: uncategorizedSites().length,
      clicks: clicks,
      trash: (state.data.trash || []).length,
      tags: countTags(),
      bytes: global.Storage.usedBytes(),
      bySource: sites.reduce((acc, s) => {
        acc[s.source] = (acc[s.source] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  function countTags() {
    const map = Object.create(null);
    state.data.sites.forEach((s) => {
      (s.tags || []).forEach((t) => {
        map[t] = (map[t] || 0) + 1;
      });
    });
    return Object.keys(map)
      .map((name) => ({ name: name, count: map[name] }))
      .sort((a, b) => b.count - a.count);
  }

  function topSites(n) {
    return state.data.sites
      .filter((s) => (s.clickCount || 0) > 0)
      .sort((a, b) => (b.clickCount || 0) - (a.clickCount || 0))
      .slice(0, n || 10);
  }

  /* ---------- 导出 ---------- */
  function exportData() {
    const d = state.data;
    return {
      version: global.Storage.SCHEMA_VERSION,
      exportedAt: U.nowIso(),
      generator: 'work-nav',
      settings: d.settings,
      categories: d.categories,
      sites: d.sites,
    };
  }

  global.Store = {
    state,
    init,
    isReadOnly,
    onChange,
    onUi,
    persist,
    persistNow,
    getLastPersistError,
    commit,
    // 查询
    getData,
    getSettings,
    getCategories,
    getSites,
    getCategory,
    getSite,
    topCategories,
    childCategories,
    sitesOfCategory,
    uncategorizedSites,
    uncategorizedName,
    setUncategorizedName,
    pinnedSites,
    siteSorter,
    categoryTree,
    // 分类
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategory,
    // 站点
    addSite,
    updateSite,
    deleteSite,
    restoreSite,
    togglePin,
    recordClick,
    parseTags,
    // 排序 / 批量
    reorderSite,
    reorderCategory,
    batchDelete,
    batchMove,
    batchPin,
    setSortMode,
    // 回收站
    getTrash,
    restoreFromTrash,
    removeTrashItem,
    emptyTrash,
    // 批量
    bulkImport,
    // 设置
    updateSettings,
    updateBackground,
    replaceAll,
    clearAllData,
    // UI
    setUi,
    setKeyword,
    setActiveCategory,
    toggleSidebar,
    // 其他
    stats,
    topSites,
    countTags,
    exportData,
  };
})(window);
