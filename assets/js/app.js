/* ============================================================
   app.js — 应用入口：事件绑定与流程编排
   ============================================================ */
(function (global) {
  'use strict';

  const $ = U.$;
  const $$ = U.$$;

  /* 安全绑定：元素缺失时只告警，不中断整个应用的初始化 */
  const MISSING = [];
  function bind(selector, event, handler) {
    const node = typeof selector === 'string' ? $(selector) : selector;
    if (!node) {
      MISSING.push(selector + '@' + event);
      console.warn('[worknav] 绑定失败，未找到元素：', selector);
      return null;
    }
    node.addEventListener(event, handler);
    return node;
  }

  /* ============================================================
     Toast
     ============================================================ */

  const ICONS = {
    success: '<path d="M20 6L9 17l-5-5"/>',
    error: '<path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/>',
    warn: '<path d="M12 9v4M12 16.5v.01"/><path d="M10.3 3.9L2.4 17.4A1.6 1.6 0 0 0 3.8 20h16.4a1.6 1.6 0 0 0 1.4-2.6L13.7 3.9a1.6 1.6 0 0 0-2.8 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
  };

  function toast(message, type, opts) {
    opts = opts || {};
    const wrap = $('#toastWrap');
    if (!wrap) return;

    const node = U.el('div', { class: 'toast is-' + (type || 'info') });
    node.innerHTML =
      '<svg viewBox="0 0 24 24" class="ico">' + (ICONS[type] || ICONS.info) + '</svg>';

    const text = U.el('span', { text: message });
    node.appendChild(text);

    let timer = null;
    function close() {
      if (timer) clearTimeout(timer);
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 220);
    }

    if (opts.actionLabel && typeof opts.onAction === 'function') {
      const btn = U.el('button', {
        class: 'toast-action',
        text: opts.actionLabel,
        onclick: (e) => {
          e.stopPropagation();
          opts.onAction();
          close();
        },
      });
      node.appendChild(btn);
    }

    node.addEventListener('click', close);
    wrap.appendChild(node);

    const duration = opts.duration || (opts.actionLabel ? 6000 : 3000);
    timer = setTimeout(close, duration);
    return close;
  }

  /* ============================================================
     弹窗 / 抽屉 基础控制
     ============================================================ */

  const openStack = [];

  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.hidden = false;
    openStack.push(id);
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    if (id === 'confirmModal') m.dataset.confirmBound = '';
    m.hidden = true;
    const i = openStack.indexOf(id);
    if (i >= 0) openStack.splice(i, 1);
    if (!openStack.length) document.body.style.overflow = '';
  }

  function closeTop() {
    if (openStack.length) {
      const id = openStack[openStack.length - 1];
      // 确认框优先
      closeModal(id);
      return true;
    }
    // 关掉右键菜单
    const cm = $('#contextMenu');
    if (cm && !cm.hidden) {
      cm.hidden = true;
      return true;
    }
    return false;
  }

  /* ---------- 确认框 ---------- */
  let confirmResolve = null;

  function confirm(title, text, okLabel) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $('#confirmTitle').textContent = title || '确认操作';
      $('#confirmText').textContent = text || '';
      const ok = $('#confirmOk');
      ok.textContent = okLabel || '确定';
      openModal('confirmModal');
      setTimeout(() => ok.focus(), 50);
    });
  }

  function resolveConfirm(val) {
    closeModal('confirmModal');
    if (confirmResolve) {
      const r = confirmResolve;
      confirmResolve = null;
      r(val);
    }
  }

  /* ============================================================
     站点表单
     ============================================================ */

  let editingSiteId = null;
  let pendingCategoryId = '';

  function fillCategorySelect(selected) {
    const sel = $('#fCategory');
    if (!sel) return;
    sel.textContent = '';
    sel.appendChild(U.el('option', { value: '', text: '未分类' }));
    global.Store.categoryTree().forEach((node) => {
      sel.appendChild(U.el('option', { value: node.cat.id, text: node.cat.name }));
      node.children.forEach((c) => {
        sel.appendChild(U.el('option', { value: c.id, text: '　└ ' + c.name }));
      });
    });
    sel.value = selected || '';
  }

  function openSiteModal(siteOrNull, presetCategoryId) {
    if (global.Store.isReadOnly()) {
      toast('这是只读快照，不能编辑站点', 'info');
      return;
    }
    editingSiteId = siteOrNull ? siteOrNull.id : null;
    pendingCategoryId = presetCategoryId || '';

    $('#siteModalTitle').textContent = editingSiteId ? '编辑站点' : '添加站点';

    if (siteOrNull) {
      $('#fName').value = siteOrNull.name;
      $('#fUrl').value = siteOrNull.url;
      $('#fDesc').value = siteOrNull.description || '';
      $('#fIcon').value = siteOrNull.icon || '';
      $('#fTags').value = (siteOrNull.tags || []).join(', ');
      $('#fPinned').checked = !!siteOrNull.pinned;
      $('#fOpenIn').value = siteOrNull.openIn || 'default';
      fillCategorySelect(siteOrNull.categoryId);
    } else {
      $('#siteForm').reset();
      $('#fPinned').checked = false;
      $('#fOpenIn').value = 'default';
      // 默认分类：当前所在分类
      const ui = global.Store.state.ui;
      let defCat = presetCategoryId || '';
      if (!defCat && ui.activeCategory && ['all', 'pinned', 'unclassified'].indexOf(ui.activeCategory) < 0) {
        defCat = ui.activeCategory;
      }
      fillCategorySelect(defCat);
    }

    clearFieldErrors();
    $('#btnSaveAndNew').hidden = !!editingSiteId;
    updatePreview();
    openModal('siteModal');

    setTimeout(() => $('#fName').focus(), 60);
  }

  function clearFieldErrors() {
    $('#errName').textContent = '';
    $('#errUrl').textContent = '';
    $('#fName').classList.remove('is-error');
    $('#fUrl').classList.remove('is-error');
  }

  function updatePreview() {
    const name = $('#fName').value.trim() || '站点名称';
    const desc = $('#fDesc').value.trim() || U.getHost(U.normalizeUrl($('#fUrl').value).url) || '站点描述';
    const iconVal = $('#fIcon').value.trim();

    $('#previewName').textContent = name;
    $('#previewDesc').textContent = desc;

    const box = $('#previewIcon');
    box.textContent = '';
    box.style.background = 'transparent';

    const fakeSite = { name: name, url: $('#fUrl').value || 'https://example.com', icon: iconVal };
    const icon = global.Render.buildIcon(fakeSite);
    box.style.background = icon.style.background;
    while (icon.firstChild) box.appendChild(icon.firstChild);
    if (icon.textContent) box.textContent = icon.textContent;
  }

  function readSiteForm() {
    return {
      name: $('#fName').value.trim(),
      url: $('#fUrl').value.trim(),
      categoryId: $('#fCategory').value,
      description: $('#fDesc').value.trim(),
      icon: $('#fIcon').value.trim(),
      tags: $('#fTags').value.trim(),
      pinned: $('#fPinned').checked,
      openIn: $('#fOpenIn').value,
    };
  }

  function validateSiteForm(input) {
    let ok = true;
    clearFieldErrors();

    if (!input.name) {
      $('#errName').textContent = '请填写站点名称';
      $('#fName').classList.add('is-error');
      ok = false;
    } else if (input.name.length > 30) {
      $('#errName').textContent = '名称不能超过 30 个字';
      $('#fName').classList.add('is-error');
      ok = false;
    }

    const n = U.normalizeUrl(input.url);
    if (!n.ok) {
      $('#errUrl').textContent = n.reason;
      $('#fUrl').classList.add('is-error');
      ok = false;
    } else {
      input.url = n.url;
    }
    return ok;
  }

  function saveSiteForm(keepOpen) {
    const input = readSiteForm();
    if (!validateSiteForm(input)) return false;

    if (editingSiteId) {
      const res = global.Store.updateSite(editingSiteId, input);
      if (!res.ok) {
        toast(res.message || '保存失败', 'error');
        return false;
      }
      toast('已更新「' + input.name + '」', 'success');
      closeModal('siteModal');
      return true;
    }

    const res = global.Store.addSite(input, { source: 'manual' });
    if (!res.ok) {
      if (res.duplicate) {
        handleDuplicate(input, res.existing);
      } else {
        toast(res.message || '添加失败', 'error');
      }
      return false;
    }

    toast('已添加「' + input.name + '」', 'success');

    if (keepOpen) {
      $('#fName').value = '';
      $('#fUrl').value = '';
      $('#fDesc').value = '';
      $('#fIcon').value = '';
      $('#fTags').value = '';
      $('#fPinned').checked = false;
      clearFieldErrors();
      updatePreview();
      $('#fName').focus();
    } else {
      closeModal('siteModal');
    }
    return true;
  }

  function handleDuplicate(input, existing) {
    $('#errUrl').textContent = '已存在相同网址：' + existing.name;
    $('#fUrl').classList.add('is-error');
    toast('检测到重复网址，已标出。如仍要添加，请再次点击保存。', 'warn', { duration: 4500 });

    // 二次点击即强制保存
    const btn = $('#btnSaveSite');
    const handler = () => {
      btn.removeEventListener('click', handler);
      const r = global.Store.addSite(input, { source: 'manual', allowDuplicate: true });
      if (r.ok) {
        toast('已添加「' + input.name + '」', 'success');
        closeModal('siteModal');
      }
    };
    btn.addEventListener('click', handler);
  }

  /* ============================================================
     分类操作
     ============================================================ */

  async function promptAddCategory(parentId) {
    const name = global.prompt(
      parentId ? '新建二级分类（归在「' + (global.Store.getCategory(parentId) || {}).name + '」下）' : '新建分类名称'
    );
    if (name === null) return;
    const trimmed = String(name).trim();
    if (!trimmed) return;

    const res = global.Store.addCategory(trimmed, parentId || null);
    if (!res.ok) {
      // 同名时直接定位到已有分类
      if (res.category) {
        global.Store.setActiveCategory(res.category.id);
        toast('该分类已存在，已为你定位过去', 'info');
      } else {
        toast(res.message, 'error');
      }
      return;
    }
    global.Store.setActiveCategory(res.category.id);
    toast('已创建分类「' + trimmed + '」', 'success');
  }

  async function openCategoryMenu(catId, anchorEl) {
    const cat = global.Store.getCategory(catId);
    if (!cat) return;

    const items = [
      { label: '新建二级分类', act: 'addsub' },
      { label: '重命名', act: 'rename' },
      { label: '在此分类添加站点', act: 'addsite' },
      { label: '删除分类', act: 'delete', danger: true },
    ];

    showMenuAt(anchorEl, items, async (act) => {
      if (act === 'addsub') {
        promptAddCategory(cat.id);
      } else if (act === 'rename') {
        const name = global.prompt('重命名分类', cat.name);
        if (name === null) return;
        const r = global.Store.updateCategory(cat.id, { name: String(name).trim() });
        if (r.ok) toast('已重命名', 'success');
      } else if (act === 'addsite') {
        openSiteModal(null, cat.id);
      } else if (act === 'delete') {
        const childCount = global.Store.childCategories(cat.id).length;
        const affected = global.Store.sitesOfCategory(cat.id, true).length;
        const detail =
          '分类「' + cat.name + '」下有 ' + affected + ' 个站点' +
          (childCount ? '，以及 ' + childCount + ' 个子分类' : '') +
          '。\n\n删除后这些站点会变为「未分类」，不会丢失。';

        const ok = await confirm('删除分类', detail, '删除');
        if (!ok) return;
        const r = global.Store.deleteCategory(cat.id, 'move-to-uncategorized');
        if (r.ok) {
          if (global.Store.state.ui.activeCategory === cat.id) global.Store.setActiveCategory('all');
          toast('已删除分类，其中 ' + r.affected + ' 个站点已移到「未分类」', 'success');
        }
      }
    });
  }

  /* ============================================================
     通用右键菜单
     ============================================================ */

  let menuHandler = null;

  function showMenuAt(anchorEl, items, onPick) {
    const menu = $('#contextMenu');
    menu.textContent = '';
    items.forEach((it) => {
      menu.appendChild(
        U.el('button', {
          class: it.danger ? 'is-danger' : '',
          text: it.label,
          dataset: { act: it.act },
        })
      );
    });
    menuHandler = onPick;

    // 定位
    const rect = anchorEl.getBoundingClientRect();
    menu.hidden = false;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + mw > global.innerWidth - 8) left = global.innerWidth - mw - 8;
    if (top + mh > global.innerHeight - 8) top = rect.top - mh - 4;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
  }

  function showSiteMenu(site, x, y) {
    const menu = $('#contextMenu');
    const items = [
      { label: '打开', act: 'open' },
      { label: '在新标签页打开', act: 'opennew' },
      { label: '复制链接', act: 'copy' },
      { label: site.pinned ? '取消置顶' : '置顶显示', act: 'pin' },
      { label: '编辑', act: 'edit' },
      { label: '删除', act: 'delete', danger: true },
    ];
    menu.textContent = '';
    items.forEach((it) => {
      menu.appendChild(
        U.el('button', { class: it.danger ? 'is-danger' : '', text: it.label, dataset: { act: it.act } })
      );
    });
    menuHandler = async (act) => {
      if (act === 'open') global.Render.openSite(site, false);
      else if (act === 'opennew') global.Render.openSite(site, true);
      else if (act === 'copy') {
        const ok = await U.copyText(site.url);
        toast(ok ? '链接已复制' : '复制失败，请手动复制', ok ? 'success' : 'error');
      } else if (act === 'pin') {
        const r = global.Store.togglePin(site.id);
        toast(r.pinned ? '已置顶' : '已取消置顶', 'success');
      } else if (act === 'edit') {
        openSiteModal(site);
      } else if (act === 'delete') {
        requestDeleteSite(site);
      }
    };

    menu.hidden = false;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    menu.style.left = Math.min(x, global.innerWidth - mw - 8) + 'px';
    menu.style.top = Math.min(y, global.innerHeight - mh - 8) + 'px';
  }

  async function requestDeleteSite(site) {
    const ok = await confirm('删除站点', '确定删除「' + site.name + '」吗？删除后可通过底部的撤销按钮恢复。', '删除');
    if (!ok) return;
    const r = global.Store.deleteSite(site.id);
    if (r.ok) {
      toast('已删除「' + site.name + '」', 'success', {
        actionLabel: '撤销',
        onAction: () => {
          global.Store.restoreSite(r.site);
          toast('已恢复', 'success');
        },
        duration: 6000,
      });
    }
  }

  /* ============================================================
     导入向导
     ============================================================ */

  const importer = {
    step: 1,
    parsed: null,
    selected: new Set(),
    fileName: '',
  };

  function openImport() {
    importer.step = 1;
    importer.parsed = null;
    importer.selected = new Set();
    importer.fileName = '';
    $('#fileInput').value = '';
    $('#importErr').hidden = true;
    $('#importFootNote').textContent = '';
    $('#importResult').hidden = true;
    $('#replaceWarn').hidden = true;
    refreshReplaceWarn();
    $$('input[name=importMode]').forEach((r) => (r.checked = r.value === 'merge'));
    goImportStep(1);
    openModal('importModal');
  }

  /** 覆盖模式提示里的条数必须写实，不能留模板占位符 */
  function refreshReplaceWarn() {
    const el = $('#replaceWarn');
    if (!el) return;
    const st = global.Store.stats();
    el.textContent =
      '确定要清空当前 ' + st.sites + ' 个站点、' + st.categories + ' 个分类吗？建议先到「设置 → 数据」导出备份。';
  }

  function goImportStep(n) {
    importer.step = n;
    $$('#importSteps .step').forEach((s) => {
      const i = Number(s.dataset.step);
      s.classList.toggle('is-active', i === n);
      s.classList.toggle('is-done', i < n);
    });
    $$('#importModal .step-pane').forEach((p) => {
      p.hidden = Number(p.dataset.pane) !== n;
    });
    $('#btnImportBack').hidden = n === 1;
    $('#btnImportNext').textContent = n === 3 ? '开始导入' : '下一步';
  }

  async function handleBookmarkFile(file) {
    $('#importErr').hidden = true;
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      showImportError('文件过大（' + U.fileSize(file.size) + '），请确认是否选错了文件。');
      return;
    }

    let text;
    try {
      text = await U.readFileAsText(file);
    } catch (e) {
      showImportError('文件读取失败：' + (e.message || '未知错误'));
      return;
    }

    // 快速识别 plist（Safari）
    if (/<plist/i.test(text.slice(0, 2000))) {
      showImportError('这看起来是 Safari 导出的 plist 格式，暂不支持。建议用 Chrome / Edge / Firefox 导入后再导出。');
      return;
    }

    const res = global.Bookmark.parse(text);
    if (!res.ok) {
      showImportError(res.message);
      return;
    }

    importer.parsed = res;
    importer.fileName = file.name;
    // 默认全选
    importer.selected = new Set(res.categories.map((c) => (c.parentName || '') + '|' + c.name));
    if (res.sites.some((s) => !s.categoryName)) importer.selected.add('|');

    renderImportPreview();
    goImportStep(2);
  }

  function showImportError(msg) {
    const el = $('#importErr');
    el.textContent = msg;
    el.hidden = false;
  }

  function renderImportPreview() {
    const p = importer.parsed;
    const stats = $('#importStats');
    const tree = $('#importTree');
    if (!p) return;

    stats.textContent = '';
    const unclassified = p.sites.filter((s) => !s.categoryName).length;
    [
      { n: p.stats.sites, l: '可导入站点', cls: '' },
      { n: p.stats.topCategories, l: '一级分类', cls: 'is-muted' },
      { n: p.stats.categories, l: '分类总数', cls: 'is-muted' },
      { n: p.stats.skipped, l: '已跳过', cls: p.stats.skipped ? 'is-warn' : 'is-muted' },
    ].forEach((it) => {
      stats.appendChild(
        U.el('div', { class: 'stat-chip ' + it.cls }, [
          U.el('div', { class: 'stat-num', text: String(it.n) }),
          U.el('div', { class: 'stat-label', text: it.l }),
        ])
      );
    });
    void unclassified;

    tree.textContent = '';
    const frag = document.createDocumentFragment();

    // 未分类项
    const unc = p.sites.filter((s) => !s.categoryName);
    if (unc.length) {
      frag.appendChild(
        buildTreeItem(
          { name: '（未分类）', parentName: '', icon: '📥' },
          unc.length,
          true
        )
      );
    }

    // 一级分类及其子分类
    p.categories
      .filter((c) => !c.parentName)
      .forEach((top) => {
        frag.appendChild(buildTreeItem(top, top.count, false, top.samples));
        p.categories
          .filter((c) => c.parentName === top.name)
          .forEach((child) => {
            const fakeTop = top;
            const node = buildTreeItem(child, child.count, false, child.samples, fakeTop.name);
            node.classList.add('tree-sub');
            frag.appendChild(node);
          });
      });

    tree.appendChild(frag);
  }

  function buildTreeItem(cat, count, isUnclassified, samples, parentName) {
    const key = (parentName || cat.parentName || '') + '|' + (isUnclassified ? '' : cat.name);
    const box = U.el('div', { class: 'tree-item' });

    const label = U.el('label', { class: 'check' });
    const cb = U.el('input', { type: 'checkbox' });
    cb.checked = importer.selected.has(key);
    cb.dataset.key = key;
    cb.addEventListener('change', () => {
      if (cb.checked) importer.selected.add(key);
      else importer.selected.delete(key);
    });
    label.appendChild(cb);
    label.appendChild(U.el('span', { class: 'tree-name', text: (cat.icon ? cat.icon + ' ' : '') + cat.name }));
    label.appendChild(U.el('span', { class: 'tree-badge', text: count + ' 个' }));
    box.appendChild(label);

    const sampleList = samples || cat.samples || [];
    if (sampleList.length) {
      const s = U.el('div', { class: 'tree-samples' });
      sampleList.forEach((n) => s.appendChild(U.el('span', { text: '· ' + n })));
      box.appendChild(s);
    }
    return box;
  }

  async function runImport() {
    if (!importer.parsed) return;

    const mode = ($$('input[name=importMode]').find((r) => r.checked) || {}).value || 'merge';
    const sites = global.Bookmark.filterSelection(importer.parsed, Array.from(importer.selected));

    if (!sites.length) {
      toast('没有勾选任何分类，请返回上一步选择', 'warn');
      return;
    }

    const payload = {
      categories: importer.parsed.categories
        .filter((c) => importer.selected.has((c.parentName || '') + '|' + c.name))
        .map((c) => ({ name: c.name, parentName: c.parentName, icon: c.icon })),
      sites: sites.map((s) => ({
        name: s.name,
        url: s.url,
        categoryName: s.categoryName,
        parentName: s.parentName,
        icon: s.icon,
        description: '',
        tags: [],
        source: 'bookmark',
        createdAt: s.addDate || Date.now(),
      })),
    };

    // 覆盖模式需要二次确认
    if (mode === 'replace') {
      const cur = global.Store.stats().sites;
      const ok = await confirm(
        '全量覆盖确认',
        '这会清空当前的 ' + cur + ' 个站点和全部分类，然后导入书签数据。此操作不可撤销（可尝试用「回滚」恢复）。',
        '确认覆盖'
      );
      if (!ok) return;
    }

    const res = global.Store.bulkImport(payload, { mode: mode });

    // 结果展示
    const box = $('#importResult');
    box.textContent = '';
    box.hidden = false;
    [
      { n: res.addedSites, l: '新增站点', cls: '' },
      { n: res.skippedSites, l: '跳过重复', cls: 'is-muted' },
      { n: res.addedCategories, l: '新建分类', cls: '' },
      { n: res.reusedCategories, l: '复用分类', cls: 'is-muted' },
    ].forEach((it) => {
      box.appendChild(
        U.el('div', { class: 'stat-chip ' + it.cls }, [
          U.el('div', { class: 'stat-num', text: String(it.n) }),
          U.el('div', { class: 'stat-label', text: it.l }),
        ])
      );
    });

    $('#importFootNote').textContent =
      '导入完成：新增 ' + res.addedSites + ' 条，跳过重复 ' + res.skippedSites + ' 条。';

    toast('导入完成，新增 ' + res.addedSites + ' 个站点', 'success', {
      actionLabel: '关闭',
      onAction: () => closeModal('importModal'),
    });

    // 自动关闭
    setTimeout(() => {
      if (!$('#importModal').hidden && importer.step === 3) closeModal('importModal');
    }, 2200);

    importer.step = 3;
    $('#btnImportNext').textContent = '完成';
  }

  /* ============================================================
     设置面板事件
     ============================================================ */

  function bindSettings() {
    // 分段控件：主题
    onSeg('#segTheme', (val) => {
      global.Store.updateSettings({ theme: val });
      global.Render.applyTheme();
      Background.apply(global.Store.getSettings().background);
    });

    onSeg('#segBgType', (val) => {
      global.Store.updateBackground({ type: val });
      global.Render.renderSettings();
      Background.apply(global.Store.getSettings().background);
      if (val === 'upload') global.Render.renderUploadedThumbs();
    });

    onSeg('#segColumns', (val) => {
      global.Store.updateSettings({ layout: Object.assign({}, global.Store.getSettings().layout, { columns: val }) });
      global.Render.applyLayout();
      global.Render.renderSettings();
    });

    onSeg('#segCardSize', (val) => {
      global.Store.updateSettings({ layout: Object.assign({}, global.Store.getSettings().layout, { cardSize: val }) });
      global.Render.applyLayout();
      global.Render.renderSettings();
    });

    onSeg('#segOpenIn', (val) => {
      global.Store.updateSettings({
        behavior: Object.assign({}, global.Store.getSettings().behavior, { defaultOpenIn: val }),
      });
      global.Render.renderSettings();
    });

    // 壁纸选择
    bind('#wallpaperGrid', 'click', (e) => {
      const item = e.target.closest('[data-preset]');
      if (!item) return;
      global.Store.updateBackground({ type: 'preset', presetId: item.dataset.preset });
      global.Render.renderSettings();
      Background.apply(global.Store.getSettings().background);
    });

    // 渐变预设
    bind('#gradientSwatches', 'click', (e) => {
      const sw = e.target.closest('[data-gfrom]');
      if (!sw) return;
      const bg = global.Store.getSettings().background;
      global.Store.updateBackground({
        type: 'gradient',
        gradient: Object.assign({}, bg.gradient, { from: sw.dataset.gfrom, to: sw.dataset.gto }),
      });
      global.Render.renderSettings();
      $('#gradFrom').value = sw.dataset.gfrom;
      $('#gradTo').value = sw.dataset.gto;
      Background.apply(global.Store.getSettings().background);
    });

    bind('#gradFrom', 'input', updateGradient);
    bind('#gradTo', 'input', updateGradient);
    bind('#gradAngle', 'input', (e) => {
      $('#gradAngleVal').textContent = e.target.value;
      updateGradient();
    });

    function updateGradient() {
      const bg = global.Store.getSettings().background;
      global.Store.updateBackground({
        type: 'gradient',
        gradient: {
          from: $('#gradFrom').value,
          to: $('#gradTo').value,
          angle: Number($('#gradAngle').value),
        },
      });
      void bg;
      Background.apply(global.Store.getSettings().background);
    }

    // 纯色
    bind('#colorSwatches', 'click', (e) => {
      const sw = e.target.closest('[data-color]');
      if (!sw) return;
      global.Store.updateBackground({ type: 'color', color: sw.dataset.color });
      $('#bgColor').value = sw.dataset.color;
      global.Render.renderSettings();
      Background.apply(global.Store.getSettings().background);
    });

    bind('#bgColor', 'input', (e) => {
      global.Store.updateBackground({ type: 'color', color: e.target.value });
      Background.apply(global.Store.getSettings().background);
    });

    // 上传
    bind('#btnPickImage', 'click', () => $('#imageInput').click());

    bind('#imageInput', 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;

      if (global.Storage.isIdbDisabled()) {
        toast('当前浏览器禁用了本地图片存储（IndexedDB），无法上传背景图。可改用「图片链接」。', 'error', {
          duration: 6000,
        });
        return;
      }

      toast('正在处理图片…', 'info', { duration: 1500 });
      try {
        const rec = await Background.saveUploadedImage(file);
        global.Store.updateBackground({ type: 'upload', imageId: rec.id });
        global.Render.renderSettings();
        global.Render.renderUploadedThumbs();
        Background.apply(global.Store.getSettings().background);
        toast('背景已更新（压缩后 ' + U.fileSize(rec.size) + '）', 'success');
      } catch (err) {
        toast(err.message || '图片处理失败', 'error', { duration: 5000 });
      }
    });

    // 已上传缩略图
    bind('#uploadedThumbs', 'click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        const id = del.dataset.del;
        const bg = global.Store.getSettings().background;
        const ok = await confirm('删除图片', '删除后该图片将从本地存储中移除，无法恢复。', '删除');
        if (!ok) return;
        await global.Storage.deleteImage(id);
        if (global.Store.state.runtime.thumbUrls[id]) {
          URL.revokeObjectURL(global.Store.state.runtime.thumbUrls[id]);
          delete global.Store.state.runtime.thumbUrls[id];
        }
        if (bg.imageId === id) {
          global.Store.updateBackground({ type: 'preset', imageId: '', presetId: Background.PRESETS[0].id });
          Background.apply(global.Store.getSettings().background);
        }
        global.Render.renderSettings();
        global.Render.renderUploadedThumbs();
        toast('图片已删除', 'success');
        return;
      }

      const thumb = e.target.closest('[data-img]');
      if (!thumb) return;
      global.Store.updateBackground({ type: 'upload', imageId: thumb.dataset.img });
      global.Render.renderUploadedThumbs();
      Background.apply(global.Store.getSettings().background);
    });

    // 图片链接
    bind('#btnApplyUrl', 'click', async () => {
      const url = $('#bgUrl').value.trim();
      if (!url) {
        toast('请先填写图片地址', 'warn');
        return;
      }
      const n = U.normalizeUrl(url);
      if (!n.ok) {
        toast(n.reason, 'error');
        return;
      }
      global.Store.updateBackground({ type: 'url', url: n.url });
      await Background.apply(global.Store.getSettings().background);
      toast('已应用图片链接', 'success');
    });

    // 显示调节
    bind('#bgBlur', 'input', (e) => {
      $('#blurVal').textContent = e.target.value;
      global.Store.updateBackground({ blur: Number(e.target.value) });
      Background.apply(global.Store.getSettings().background);
    });

    bind('#bgOverlayRange', 'input', (e) => {
      $('#overlayVal').textContent = e.target.value;
      global.Store.updateBackground({ overlay: Number(e.target.value) / 100 });
      Background.apply(global.Store.getSettings().background);
    });

    bind('#bgFit', 'change', (e) => {
      global.Store.updateBackground({ fit: e.target.value });
      Background.apply(global.Store.getSettings().background);
    });

    bind('#autoThemeColor', 'change', (e) => {
      global.Store.updateBackground({ autoThemeColor: e.target.checked });
      Background.apply(global.Store.getSettings().background);
    });

    // 行为
    bind('#showClock', 'change', (e) => {
      global.Store.updateSettings({
        behavior: Object.assign({}, global.Store.getSettings().behavior, { showClock: e.target.checked }),
      });
      global.Render.applyTheme();
    });

    bind('#allowFaviconFetch', 'change', (e) => {
      global.Store.updateSettings({
        behavior: Object.assign({}, global.Store.getSettings().behavior, { allowFaviconFetch: e.target.checked }),
      });
      global.Render.renderBoard();
      if (e.target.checked) {
        toast('已开启联网抓取图标。这会让浏览器向站点域名发起请求。', 'warn', { duration: 5000 });
      }
    });

    bind('#showDesc', 'change', (e) => {
      global.Store.updateSettings({
        layout: Object.assign({}, global.Store.getSettings().layout, { showDescription: e.target.checked }),
      });
      global.Render.applyLayout();
    });

    // 数据：导出
    bind('#btnExport', 'click', () => {
      const data = global.Store.exportData();
      U.download('work-nav-backup-' + U.stampCompact() + '.json', JSON.stringify(data, null, 2));
      toast('备份已导出', 'success');
    });

    // 数据：导入 JSON
    bind('#btnImportJson', 'click', () => $('#jsonInput').click());

    bind('#jsonInput', 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;

      let raw;
      try {
        const txt = await U.readFileAsText(file);
        raw = JSON.parse(txt);
      } catch (err) {
        toast('JSON 解析失败，请确认文件是本工具导出的备份', 'error', { duration: 5000 });
        return;
      }

      const norm = global.Storage.normalize(raw);
      const ok = await confirm(
        '导入备份',
        '将用备份中的数据替换当前全部内容：' +
          norm.data.sites.length +
          ' 个站点、' +
          norm.data.categories.length +
          ' 个分类。当前数据会被覆盖（可用「回滚」尝试恢复）。',
        '确认导入'
      );
      if (!ok) return;

      global.Store.replaceAll(norm.data, 'data:import-json');
      // 背景设置同步
      await Background.apply(global.Store.getSettings().background);
      global.Render.renderSettings();
      global.Render.renderAll();
      toast('已导入 ' + norm.data.sites.length + ' 个站点', 'success');
    });

    // 回滚
    bind('#btnRollback', 'click', async () => {
      const snap = global.Storage.readSnapshot();
      if (!snap) {
        toast('没有可用的快照', 'warn');
        return;
      }
      const ok = await confirm('回滚数据', '将恢复到上一次修改前的状态，当前改动会丢失。', '确认回滚');
      if (!ok) return;
      const parsed = global.Storage.load.snapshotParse ? global.Storage.load.snapshotParse() : null;
      void parsed;
      const norm = global.Storage.normalize(snap);
      global.Store.replaceAll(norm.data, 'data:rollback');
      global.Storage.clearSnapshot();
      await Background.apply(global.Store.getSettings().background);
      global.Render.renderSettings();
      global.Render.renderAll();
      toast('已回滚到上一次修改前', 'success');
    });

    // 清空全部
    bind('#btnClearAll', 'click', async () => {
      const st = global.Store.stats();
      const ok = await confirm(
        '清空所有数据',
        '这将删除全部 ' + st.sites + ' 个站点和 ' + st.categories + ' 个分类。建议先导出备份。删除后可通过「回滚」尝试恢复。',
        '确认清空'
      );
      if (!ok) return;
      global.Store.clearAllData();
      global.Store.setActiveCategory('all');
      toast('已清空', 'success');
    });

    /* ---------- 排序模式 ---------- */
    onSeg('#segSortMode', (val) => {
      global.Store.setSortMode(val);
      global.Render.renderBoard();
      global.Render.renderSettings();
      if (val !== 'manual') toast('已按「' + ({ name: '名称', clicks: '访问量', recent: '最近访问' }[val] || val) + '」排序', 'info', { duration: 2500 });
    });

    bind('#showTags', 'change', (e) => {
      global.Store.updateSettings({
        layout: Object.assign({}, global.Store.getSettings().layout, { showTags: e.target.checked }),
      });
      global.Render.renderBoard();
    });

    /* ---------- 壁纸轮播 ---------- */
    const syncRotate = () => {
      Background.startRotation(global.Store.getSettings().background);
    };

    bind('#bgRotate', 'change', (e) => {
      const bg = global.Store.getSettings().background;
      const type = bg.type === 'preset' ? 'preset' : bg.type;
      global.Store.updateBackground({ rotate: Object.assign({}, bg.rotate, { enabled: e.target.checked }) });
      if (e.target.checked && type !== 'preset') {
        toast('轮播只在「预设壁纸」模式下生效，已同时切换过去', 'info', { duration: 4000 });
        global.Store.updateBackground({ type: 'preset' });
        global.Render.renderSettings();
        Background.apply(global.Store.getSettings().background);
      }
      syncRotate();
    });

    bind('#bgRotateMin', 'change', (e) => {
      const bg = global.Store.getSettings().background;
      const minutes = Math.max(1, Number(e.target.value) || 5);
      global.Store.updateBackground({ rotate: Object.assign({}, bg.rotate, { minutes: minutes }) });
      syncRotate();
    });

    /* ---------- 搜索默认引擎 ---------- */
    bind('#searchEngine', 'change', (e) => {
      global.Store.updateSettings({
        behavior: Object.assign({}, global.Store.getSettings().behavior, { searchEngine: e.target.value }),
      });
      global.Render.renderBoard();
    });

    /* ---------- 只读快照导出 ---------- */
    bind('#btnSnapshot', 'click', () => exportSnapshot());

    /* ---------- 访问统计 ---------- */
    bind('#btnStats', 'click', () => {
      global.Render.renderStatsPanel();
      openModal('statsModal');
    });

    /* ---------- 回收站 ---------- */
    bind('#trashList', 'click', async (e) => {
      const restore = e.target.closest('[data-restore]');
      if (restore) {
        const r = global.Store.restoreFromTrash(restore.dataset.restore);
        toast(r.ok ? '已恢复到原来的分类' : r.message || '恢复失败', r.ok ? 'success' : 'error');
        global.Render.renderTrash();
        global.Render.renderDataStats();
        return;
      }
      const purge = e.target.closest('[data-purge]');
      if (purge) {
        const ok = await confirm('彻底删除', '这条记录将从回收站里彻底删除，无法恢复。', '彻底删除');
        if (!ok) return;
        global.Store.removeTrashItem(purge.dataset.purge);
        global.Render.renderTrash();
        global.Render.renderDataStats();
      }
    });

    bind('#btnEmptyTrash', 'click', async () => {
      const n = global.Store.getTrash().length;
      if (!n) return;
      const ok = await confirm('清空回收站', '将彻底删除回收站里的 ' + n + ' 条记录，无法恢复。', '清空');
      if (!ok) return;
      global.Store.emptyTrash();
      global.Render.renderTrash();
      global.Render.renderDataStats();
      toast('回收站已清空', 'success');
    });
  }

  function onSeg(sel, cb) {
    const seg = U.$(sel);
    if (!seg) return;
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-val]');
      if (!btn) return;
      U.$$('button', seg).forEach((b) => b.classList.toggle('is-active', b === btn));
      cb(btn.dataset.val);
    });
  }

  /* ============================================================
     折叠 / 多选 / 拖拽排序
     ============================================================ */

  /** 折叠或展开一个分组（带动画，状态记在 ui.collapsed） */
  function toggleCollapse(groupId) {
    if (!groupId) return;
    const ui = global.Store.state.ui;
    ui.collapsed[groupId] = !ui.collapsed[groupId];
    const section = document.querySelector('.section[data-group="' + String(groupId).replace(/"/g, '') + '"]');
    if (section) section.classList.toggle('is-collapsed', !!ui.collapsed[groupId]);
  }

  function toggleSelect(id, force) {
    const ui = global.Store.state.ui;
    const on = force === undefined ? !ui.selected.has(id) : !!force;
    if (on) ui.selected.add(id);
    else ui.selected.delete(id);
    const card = document.querySelector('.site-card[data-id="' + String(id).replace(/"/g, '') + '"]');
    if (card) {
      card.classList.toggle('is-selected', on);
      const cb = card.querySelector('.card-check input');
      if (cb) cb.checked = on;
    }
    updateSelectBar();
  }

  function updateSelectBar() {
    const ui = global.Store.state.ui;
    const bar = $('#selectBar');
    if (!bar) return;
    bar.hidden = !ui.selectMode;
    document.body.classList.toggle('is-selecting', !!ui.selectMode);
    const n = ui.selected.size;
    const label = $('#selCount');
    if (label) label.textContent = '已选 ' + n + ' 个';
    ['#selMove', '#selPin', '#selDelete'].forEach((sel) => {
      const b = $(sel);
      if (b) b.disabled = !n;
    });
  }

  function fillSelCategory() {
    const sel = $('#selCategory');
    if (!sel) return;
    sel.textContent = '';
    sel.appendChild(U.el('option', { value: '', text: '移动到…未分类' }));
    global.Store.categoryTree().forEach((node) => {
      sel.appendChild(U.el('option', { value: node.cat.id, text: node.cat.name }));
      node.children.forEach((c) => {
        sel.appendChild(U.el('option', { value: c.id, text: '　└ ' + c.name }));
      });
    });
  }

  function enterSelectMode(on) {
    const ui = global.Store.state.ui;
    ui.selectMode = !!on;
    ui.selected = new Set();
    if (on) fillSelCategory();
    global.Render.renderBoard();
    updateSelectBar();
    if (on) toast('多选模式：点卡片选择，再用底部工具条批量处理', 'info', { duration: 4000 });
  }

  async function batchDeleteSelected() {
    const ui = global.Store.state.ui;
    const ids = Array.from(ui.selected);
    if (!ids.length) return;
    const ok = await confirm('批量删除', '确定删除选中的 ' + ids.length + ' 个站点吗？会放进回收站，可以恢复。', '删除');
    if (!ok) return;
    const r = global.Store.batchDelete(ids);
    ui.selected = new Set();
    updateSelectBar();
    toast('已删除 ' + r.count + ' 个站点', 'success', {
      actionLabel: '撤销',
      onAction: () => {
        (r.sites || []).forEach((s) => global.Store.restoreSite(s));
      },
      duration: 6000,
    });
  }

  /* ---------- 拖拽 ---------- */
  const dragState = { kind: '', id: '' };

  function initDragAndDrop() {
    const board = $('#board');
    const catList = $('#catList');

    function clearDropMarks() {
      U.$$('.drop-before, .drop-after, .is-dragging').forEach((n) => {
        n.classList.remove('drop-before', 'drop-after', 'is-dragging');
      });
    }

    function markTarget(e, selector) {
      const target = e.target.closest(selector);
      U.$$('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      if (!target || target.dataset.id === dragState.id || target.dataset.cat === dragState.id) return null;
      const rect = target.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      target.classList.add(before ? 'drop-before' : 'drop-after');
      return { el: target, before: before };
    }

    // 站点卡片
    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.site-card[data-id]');
      if (!card || global.Store.state.ui.selectMode) return;
      dragState.kind = 'site';
      dragState.id = card.dataset.id;
      card.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', dragState.id);
        } catch (err) {
          /* ignore */
        }
      }
    });

    board.addEventListener('dragover', (e) => {
      if (dragState.kind !== 'site') return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      markTarget(e, '.site-card[data-id]');
    });

    board.addEventListener('drop', (e) => {
      if (dragState.kind !== 'site') return;
      e.preventDefault();
      const t = e.target.closest('.site-card[data-id]');
      const card = document.querySelector('.site-card[data-id="' + String(dragState.id).replace(/"/g, '') + '"]');
      if (!t || !card) {
        clearDropMarks();
        dragState.kind = '';
        return;
      }
      const rect = t.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      const r = global.Store.reorderSite(dragState.id, t.dataset.id, before);
      if (!r.ok && r.message) toast(r.message, 'warn', { duration: 4000 });
      clearDropMarks();
      dragState.kind = '';
    });

    board.addEventListener('dragend', () => {
      clearDropMarks();
      dragState.kind = '';
    });

    // 分类
    catList.addEventListener('dragstart', (e) => {
      const item = e.target.closest('[data-dragcat]');
      if (!item) return;
      dragState.kind = 'cat';
      dragState.id = item.dataset.dragcat;
      item.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', dragState.id);
        } catch (err) {
          /* ignore */
        }
      }
    });

    catList.addEventListener('dragover', (e) => {
      if (dragState.kind !== 'cat') return;
      e.preventDefault();
      markTarget(e, '[data-dragcat]');
    });

    catList.addEventListener('drop', (e) => {
      if (dragState.kind !== 'cat') return;
      e.preventDefault();
      const t = e.target.closest('[data-dragcat]');
      if (!t) {
        clearDropMarks();
        dragState.kind = '';
        return;
      }
      const rect = t.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      const r = global.Store.reorderCategory(dragState.id, t.dataset.dragcat, before);
      if (!r.ok && r.message) toast(r.message, 'warn', { duration: 4000 });
      clearDropMarks();
      dragState.kind = '';
    });

    catList.addEventListener('dragend', () => {
      clearDropMarks();
      dragState.kind = '';
    });
  }

  /* ============================================================
     只读快照导出（方案 A）
     ============================================================ */

  const SNAPSHOT_CSS = ['assets/css/base.css', 'assets/css/layout.css', 'assets/css/components.css'];
  const SNAPSHOT_JS = [
    'assets/js/utils.js',
    'assets/js/storage.js',
    'assets/js/store.js',
    'assets/js/pinyin.js',
    'assets/js/background.js',
    'assets/js/bookmark.js',
    'assets/js/render.js',
    'assets/js/app.js',
  ];

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(url + ' ' + res.status);
    return res.text();
  }

  async function exportSnapshot() {
    const btn = $('#btnSnapshot');
    if (btn) btn.disabled = true;
    try {
      const all = await Promise.all(
        ['index.html'].concat(SNAPSHOT_CSS, SNAPSHOT_JS).map(fetchText)
      );
      const shell = all[0];
      const css = all.slice(1, 1 + SNAPSHOT_CSS.length).join('\n');
      const js = all.slice(1 + SNAPSHOT_CSS.length).join('\n').replace(/<\/script>/gi, '<\\/script>');
      const data = global.Store.exportData();

      let html = shell
        .replace(/<script[^>]*src="\/page\/page_comm\/inject\.js"[^>]*><\/script>\s*/i, '')
        .replace(/<link[^>]*href="assets\/css\/[^"]*"[^>]*>\s*/gi, '')
        .replace(/<link[^>]*rel="manifest"[^>]*>\s*/gi, '')
        .replace(/<script[^>]*src="assets\/js\/[^"]*"[^>]*><\/script>\s*/gi, '')
        .replace(/<title[^>]*>[\s\S]*?<\/title>/, '<title>工作导航 · 只读快照</title>');

      const headInject =
        '<style>\n' + css + '\n</style>\n</head>';
      // 用函数式替换，避免内容里的 $ 被当成替换模式（如 $$ 会塌缩成 $）
      html = html.replace(/<\/head>/i, () => headInject);

      const payload = JSON.stringify(data).replace(/</g, '\\u003c');
      const bodyInject =
        '<script>window.__NAV_SNAPSHOT__=' + payload + ';window.__NAV_SNAPSHOT_AT__=' + Date.now() + ';</script>\n' +
        '<script>\n' + js + '\n</script>\n</body>';
      html = html.replace(/<\/body>/i, () => bodyInject);

      U.download('work-nav-快照-' + U.stampCompact() + '.html', html, 'text/html;charset=utf-8');
      toast('只读快照已导出，可直接发给同事打开', 'success', { duration: 5000 });
    } catch (e) {
      toast('导出失败：当前可能是在本地文件（file://）里打开的，请用线上发布的版本导出。', 'error', {
        duration: 7000,
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------- 只读模式 ---------- */
  function applyReadonlyMode() {
    if (!global.Store.isReadOnly()) return;
    document.body.classList.add('is-readonly');
    const badge = $('#readonlyBadge');
    if (badge) {
      badge.hidden = false;
      const at = global.__NAV_SNAPSHOT_AT__;
      const d = at ? new Date(at) : null;
      badge.title =
        '这是一份只读快照' +
        (d ? '，数据截至 ' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '') +
        '。如需编辑，请使用正式版本。';
    }
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  function bindEvents() {
    /* ---------- 顶栏 ---------- */
    bind('#btnAddSite', 'click', () => {
      if (global.Store.isReadOnly()) {
        toast('这是只读快照，不能添加站点', 'info');
        return;
      }
      openSiteModal(null);
    });

    /* ---------- 多选模式 ---------- */
    bind('#btnSelectMode', 'click', () => {
      if (global.Store.isReadOnly()) {
        toast('这是只读快照，不能编辑', 'info');
        return;
      }
      enterSelectMode(!global.Store.state.ui.selectMode);
    });

    bind('#selectBar', 'click', async (e) => {
      const ui = global.Store.state.ui;
      if (e.target.closest('#selExit')) {
        enterSelectMode(false);
        return;
      }
      if (e.target.closest('#selAll')) {
        const cards = U.$$('#board .site-card[data-id]');
        const all = ui.selected.size === cards.length;
        ui.selected = new Set(all ? [] : cards.map((c) => c.dataset.id));
        global.Render.renderBoard();
        updateSelectBar();
        return;
      }
      if (e.target.closest('#selPin')) {
        const r = global.Store.batchPin(Array.from(ui.selected), true);
        toast('已置顶 ' + r.count + ' 个站点', 'success');
        return;
      }
      if (e.target.closest('#selMove')) {
        const sel = $('#selCategory');
        const target = sel ? sel.value : '';
        const r = global.Store.batchMove(Array.from(ui.selected), target);
        const name = target ? (global.Store.getCategory(target) || {}).name : '未分类';
        toast('已把 ' + r.count + ' 个站点移动到「' + name + '」', 'success');
        return;
      }
      if (e.target.closest('#selDelete')) {
        await batchDeleteSelected();
      }
    });

    bind('#btnSettings', 'click', () => {
      global.Render.renderSettings();
      global.Render.renderUploadedThumbs();
      openModal('settingsDrawer');
    });

    bind('#btnTheme', 'click', () => {
      if (global.Store.isReadOnly()) {
        // 只读快照：主题只在本地切，不写数据
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        const sun = document.querySelector('.ico-sun');
        const moon = document.querySelector('.ico-moon');
        if (sun && moon) {
          sun.style.display = next === 'light' ? '' : 'none';
          moon.style.display = next === 'dark' ? '' : 'none';
        }
        return;
      }
      const s = global.Store.getSettings();
      const cur = global.Render.applyTheme();
      const next = cur === 'dark' ? 'light' : 'dark';
      global.Store.updateSettings({ theme: next });
      global.Render.applyTheme();
      Background.apply(global.Store.getSettings().background);
      toast(next === 'dark' ? '已切换到暗色模式' : '已切换到亮色模式', 'info', { duration: 1600 });
      void s;
    });

    bind('#btnSidebarToggle', 'click', () => {
      const open = global.Store.state.ui.sidebarOpen;
      global.Store.toggleSidebar(!open);
      $('#sidebar').classList.toggle('is-open', !open);
      $('#sidebarMask').hidden = open;
    });

    bind('#sidebarMask', 'click', () => {
      global.Store.toggleSidebar(false);
      $('#sidebar').classList.remove('is-open');
      $('#sidebarMask').hidden = true;
    });

    /* ---------- 搜索 ---------- */
    const doSearch = U.debounce(() => {
      global.Store.state.ui.activeCardIndex = -1;
      global.Store.setKeyword($('#searchInput').value);
      global.Render.renderBoard();
      $('#btnSearchClear').hidden = !$('#searchInput').value;
    }, 200);

    bind('#searchInput', 'input', doSearch);

    bind('#searchInput', 'keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const cards = U.$$('#board .site-card');
        if (!cards.length) return;
        e.preventDefault();
        const ui = global.Store.state.ui;
        let idx = Number.isFinite(ui.activeCardIndex) ? ui.activeCardIndex : -1;
        idx += e.key === 'ArrowDown' ? 1 : -1;
        if (idx < 0) idx = cards.length - 1;
        if (idx >= cards.length) idx = 0;
        ui.activeCardIndex = idx;
        cards.forEach((c, i) => c.classList.toggle('is-kbd', i === idx));
        cards[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cards = U.$$('#board .site-card');
        const ui = global.Store.state.ui;
        const picked = Number.isFinite(ui.activeCardIndex) && cards[ui.activeCardIndex] ? cards[ui.activeCardIndex] : cards[0];
        if (picked) {
          const s = global.Store.getSite(picked.dataset.id);
          if (s) global.Render.openSite(s, e.ctrlKey || e.metaKey);
        }
      } else if (e.key === 'Escape') {
        $('#searchInput').value = '';
        doSearch();
        $('#searchInput').blur();
      }
    });

    bind('#btnSearchClear', 'click', () => {
      $('#searchInput').value = '';
      doSearch();
      $('#searchInput').focus();
    });

    /* ---------- 侧栏 ---------- */
    bind('#catList', 'click', (e) => {
      const more = e.target.closest('[data-more]');
      if (more) {
        e.stopPropagation();
        openCategoryMenu(more.dataset.more, more);
        return;
      }
      const item = e.target.closest('[data-cat]');
      if (!item) return;
      global.Store.setActiveCategory(item.dataset.cat);
      $('#sidebar').classList.remove('is-open');
      $('#sidebarMask').hidden = true;
    });

    bind('#btnAddCategory', 'click', () => promptAddCategory(null));

    /* ---------- 内容区（事件委托） ---------- */
    const content = $('#content');

    content.addEventListener('click', (e) => {
      // 分类内快捷添加
      const add = e.target.closest('[data-addto]');
      if (add) {
        openSiteModal(null, add.dataset.addto);
        return;
      }

      // 标签筛选
      const tag = e.target.closest('[data-tag]');
      if (tag) {
        e.stopPropagation();
        $('#searchInput').value = tag.dataset.tag;
        $('#btnSearchClear').hidden = false;
        global.Store.setKeyword(tag.dataset.tag);
        return;
      }

      // 多选模式下的勾选
      const check = e.target.closest('.card-check');
      if (check) {
        e.stopPropagation();
        const cb = check.querySelector('input');
        const card = check.closest('.site-card');
        if (card && cb) {
          toggleSelect(card.dataset.id, cb.checked);
        }
        return;
      }

      // 分组折叠 / 展开
      const head = e.target.closest('.section-head');
      if (head && !e.target.closest('[data-addto]')) {
        const section = head.closest('.section');
        if (section) toggleCollapse(section.dataset.group);
        return;
      }

      if (e.target.id === 'btnAddFromSearch') {
        const kw = global.Store.state.ui.keyword;
        openSiteModal(null);
        // 把搜索词填进名称，方便续写
        setTimeout(() => {
          if ($('#fName') && !$('#fName').value) $('#fName').value = kw;
          updatePreview();
        }, 80);
        return;
      }

      if (e.target.id === 'btnEmptyImport') {
        openImport();
        return;
      }

      if (e.target.id === 'btnEmptyAdd') {
        openSiteModal(null);
        return;
      }

      // 卡片打开（多选模式下改为切换选中）
      const card = e.target.closest('.site-card[data-id]');
      if (card) {
        if (global.Store.state.ui.selectMode) {
          toggleSelect(card.dataset.id);
          return;
        }
        const site = global.Store.getSite(card.dataset.id);
        if (site) global.Render.openSite(site, e.ctrlKey || e.metaKey);
      }
    });

    content.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.site-card[data-id]');
      if (card && e.target === card) {
        e.preventDefault();
        const site = global.Store.getSite(card.dataset.id);
        if (site) global.Render.openSite(site, false);
      }
    });

    content.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.site-card[data-id]');
      if (!card) return;
      e.preventDefault();
      const site = global.Store.getSite(card.dataset.id);
      if (site) showSiteMenu(site, e.clientX, e.clientY);
    });

    /* ---------- 右键菜单点击 ---------- */
    bind('#contextMenu', 'click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const handler = menuHandler;
      $('#contextMenu').hidden = true;
      menuHandler = null;
      if (handler) handler(act);
    });

    document.addEventListener('click', (e) => {
      const menu = $('#contextMenu');
      if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    });

    window.addEventListener('scroll', () => {
      const menu = $('#contextMenu');
      if (!menu.hidden) menu.hidden = true;
    }, true);

    /* ---------- 站点表单 ---------- */
    bind('#btnSaveSite', 'click', () => saveSiteForm(false));
    bind('#btnSaveAndNew', 'click', () => saveSiteForm(true));

    bind('#siteForm', 'submit', (e) => {
      e.preventDefault();
      saveSiteForm(false);
    });

    ['#fName', '#fUrl', '#fDesc', '#fIcon'].forEach((sel) => {
      $(sel).addEventListener('input', updatePreview);
    });

    // 名称失焦时若为空，自动用域名填充
    bind('#fUrl', 'blur', () => {
      const nameEl = $('#fName');
      if (!nameEl.value.trim()) {
        const n = U.normalizeUrl($('#fUrl').value);
        if (n.ok) {
          nameEl.value = U.getHost(n.url);
          updatePreview();
        }
      }
    });

    /* ---------- 导入向导 ---------- */
    bind('#btnImportNext', 'click', () => {
      if (importer.step === 1) {
        // 手动触发文件选择
        if (!importer.parsed) {
          $('#fileInput').click();
          return;
        }
        goImportStep(2);
      } else if (importer.step === 2) {
        if (!importer.selected.size) {
          toast('请至少勾选一个分类', 'warn');
          return;
        }
        goImportStep(3);
      } else {
        if ($('#btnImportNext').textContent === '完成') {
          closeModal('importModal');
        } else {
          runImport();
        }
      }
    });

    bind('#btnImportBack', 'click', () => {
      if (importer.step > 1) goImportStep(importer.step - 1);
    });

    const dz = $('#dropzone');
    dz.addEventListener('click', () => $('#fileInput').click());

    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('is-over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('is-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('is-over');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleBookmarkFile(f);
    });

    bind('#fileInput', 'change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleBookmarkFile(f);
    });

    bind('#checkAllCats', 'change', (e) => {
      const on = e.target.checked;
      const boxes = $$('#importTree input[type=checkbox][data-key]');
      boxes.forEach((cb) => {
        cb.checked = on;
        if (on) importer.selected.add(cb.dataset.key);
        else importer.selected.delete(cb.dataset.key);
      });
    });

    $$('input[name=importMode]').forEach((r) => {
      r.addEventListener('change', () => {
        refreshReplaceWarn();
        $('#replaceWarn').hidden = r.value !== 'replace';
      });
    });

    /* ---------- 抽屉 Tab ---------- */
    bind('#settingsTabs', 'click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      U.$$('#settingsTabs .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      U.$$('#settingsDrawer .tab-pane').forEach((p) => {
        p.classList.toggle('is-active', p.dataset.pane === tab.dataset.tab);
      });
      if (tab.dataset.tab === 'data') {
        global.Render.renderDataStats();
        global.Render.renderRollbackHint();
      }
      if (tab.dataset.tab === 'background') {
        global.Render.renderUploadedThumbs();
      }
    });

    /* ---------- 关闭按钮 ---------- */
    document.addEventListener('click', (e) => {
      const closer = e.target.closest('[data-close]');
      if (!closer) return;
      const holder = closer.closest('.modal, .drawer');
      if (holder) closeModal(holder.id);
    });

    bind('#confirmOk', 'click', () => resolveConfirm(true));

    // 遮罩点击取消确认框
    bind('#confirmModal', 'click', (e) => {
      if (e.target.classList.contains('modal-mask')) resolveConfirm(false);
    });

    /* ---------- 全局键盘 ---------- */
    document.addEventListener('keydown', (e) => {
      // Esc 关闭最上层
      if (e.key === 'Escape') {
        if (!$('#confirmModal').hidden) {
          resolveConfirm(false);
          return;
        }
        if (closeTop()) return;
        if (global.Store.state.ui.selectMode) {
          enterSelectMode(false);
          return;
        }
      }

      // 输入框内不触发快捷键
      const tag = (e.target.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

      if (isTyping) {
        // 在表单内 Cmd/Ctrl+Enter 保存
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !$('#siteModal').hidden) {
          e.preventDefault();
          saveSiteForm(false);
        }
        return;
      }

      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        $('#searchInput').focus();
        $('#searchInput').select();
      } else if (e.key === 'n' || e.key === 'N') {
        if (!$('#siteModal').hidden) return;
        e.preventDefault();
        openSiteModal(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#searchInput').focus();
      }
    });

    /* ---------- 窗口尺寸变化 ---------- */
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        global.Render.applyLayout();
      }, 150);
    });

    /* ---------- 系统主题变化 ---------- */
    if (global.matchMedia) {
      const mq = global.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        if (global.Store.getSettings().theme === 'auto') {
          global.Render.applyTheme();
          Background.apply(global.Store.getSettings().background);
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }

    /* ---------- 离开前确保落盘 ---------- */
    window.addEventListener('beforeunload', () => {
      global.Store.persistNow();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') global.Store.persistNow();
    });
  }

  /* ============================================================
     时钟
     ============================================================ */

  function startClock() {
    const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const pad = (n) => String(n).padStart(2, '0');

    function tick() {
      const d = new Date();
      const t = $('#clockTime');
      const dd = $('#clockDate');
      if (!t) return;
      t.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
      dd.textContent = pad(d.getMonth() + 1) + '月' + pad(d.getDate()) + '日 ' + WEEK[d.getDay()];
    }
    tick();
    setInterval(tick, 15000);
  }

  /* ============================================================
     启动
     ============================================================ */

  async function boot() {
    // 1. 数据
    const res = global.Store.init();

    // 2. 主题（先于渲染，避免闪白）
    global.Render.applyTheme();

    // 3. 背景
    await Background.apply(global.Store.getSettings().background);

    // 4. 渲染
    global.Render.renderAll();

    // 5. 事件
    bindEvents();
    bindSettings();
    startClock();
    initDragAndDrop();
    applyReadonlyMode();
    updateSelectBar();
    Background.startRotation(global.Store.getSettings().background);

    // 6. 订阅刷新
    global.Store.onChange(() => {
      global.Render.renderBoard();
      global.Render.renderSidebar();
    });
    global.Store.onUi((state, reason) => {
      // 分类切换 / 搜索词变化都会影响主区域，必须一起重绘
      if (
        reason === 'ui:category' ||
        reason === 'ui:keyword' ||
        reason === 'ui' ||
        reason === 'ui:sidebar'
      ) {
        global.Render.renderSidebar();
        global.Render.renderBoard();
      } else {
        global.Render.renderSidebar();
      }
      if (reason === 'ui:persist-error') {
        toast(global.Store.getLastPersistError() || '数据保存失败', 'error', { duration: 6000 });
      }
    });

    // 7. 环境提示
    if (!global.Storage.lsAvailable) {
      toast('当前浏览器禁用了本地存储，数据在关闭页面后会丢失。建议改用普通模式打开。', 'error', {
        duration: 9000,
      });
    }
    if (location.protocol === 'file:' && !global.indexedDB) {
      toast('本地文件模式下图片存储可能不可用，可改用「图片链接」或起一个本地服务。', 'warn', {
        duration: 7000,
      });
    }

    const issues = (res && res.issues) || [];
    if (res && res.corrupted) {
      toast('本地数据已损坏，已重置为空白。如有备份可到设置里导入。', 'error', { duration: 8000 });
    } else if (issues.length && issues.some((i) => i.indexOf('丢弃') >= 0)) {
      toast('有部分数据格式异常已被忽略（' + issues.length + ' 项）。', 'warn', { duration: 6000 });
    }

    // 8. 首次使用引导
    if (res && res.firstRun) {
      setTimeout(() => {
        if (!$('#board').children.length) {
          toast('欢迎使用！点击右上角「添加站点」，或从浏览器收藏夹导入。', 'info', { duration: 8000 });
        }
      }, 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 暴露给控制台调试
  global.Nav = { toast, confirm, openSiteModal, openImport, closeModal };
})(window);
