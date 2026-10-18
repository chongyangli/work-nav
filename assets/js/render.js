/* ============================================================
   render.js — 视图渲染
   全量重绘策略：数据量（千级以内）下足够快，逻辑简单不易出错
   ============================================================ */
(function (global) {
  'use strict';

  const iconCache = Object.create(null); // url -> true/false（图标加载结果）

  /* ============================================================
     图标
     ============================================================ */

  /** 生成图标元素：优先本地 → favicon → 服务 → 首字母兜底 */
  function buildIcon(site, size) {
    const box = U.el('div', { class: 'card-icon' });
    const letter = firstLetter(site.name);
    const bg = U.hashColor(site.name || site.url);

    const candidates = iconCandidates(site);

    if (!candidates.length) {
      box.style.background = bg;
      box.textContent = letter;
      return box;
    }

    const img = U.el('img', {
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    });

    let idx = 0;
    img.addEventListener('error', () => {
      idx++;
      if (idx < candidates.length) {
        img.src = candidates[idx];
      } else {
        // 全部失败 → 首字母兜底
        box.removeChild(img);
        box.style.background = bg;
        box.textContent = letter;
      }
    });
    img.addEventListener('load', () => {
      box.style.background = 'transparent';
    });

    img.src = candidates[0];
    box.appendChild(img);
    void size;
    return box;
  }

  function iconCandidates(site) {
    const list = [];
    const settings = global.Store.getSettings();
    const allowFetch = settings.behavior.allowFaviconFetch;

    // 1. 用户自定义（本地缓存 or 完整地址）
    if (site.icon) {
      if (/^(https?:|data:)/i.test(site.icon)) list.push(site.icon);
      else if (site.icon.indexOf('img:') === 0) list.push(site.icon); // 预留
    }

    if (!allowFetch) return list;

    // 2. 站点自身 favicon.ico（原生同源尝试，跨域下多数失败会走 onerror）
    try {
      const u = new URL(site.url);
      list.push(u.origin + '/favicon.ico');
      // 3. Google 图标服务作为最后手段
      list.push('https://www.google.com/s2/favicons?sz=64&domain=' + encodeURIComponent(u.hostname));
    } catch (e) {
      /* ignore */
    }
    return list;
  }

  function firstLetter(name) {
    const s = String(name || '').trim();
    if (!s) return '?';
    const ch = s[0];
    if (/[\u4e00-\u9fa5]/.test(ch)) return ch;
    if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
    if (/[0-9]/.test(ch)) return ch;
    return '?';
  }

  /* ============================================================
     搜索匹配
     ============================================================ */

  function matchSite(site, kw) {
    if (!kw) return { hit: true, field: '' };
    const q = kw.toLowerCase();

    // 名称
    const n = Pinyin.match(site.name, q);
    if (n.match) return { hit: true, field: 'name' };
    // URL
    if (String(site.url).toLowerCase().indexOf(q) >= 0) return { hit: true, field: 'url' };
    // 域名
    const host = U.getHost(site.url);
    if (host && host.toLowerCase().indexOf(q) >= 0) return { hit: true, field: 'url' };
    // 描述
    if (site.description && Pinyin.match(site.description, q).match) return { hit: true, field: 'description' };
    // 标签
    if (site.tags && site.tags.some((t) => Pinyin.match(t, q).match || t.toLowerCase().indexOf(q) >= 0)) {
      return { hit: true, field: 'tags' };
    }
    return { hit: false, field: '' };
  }

  function highlight(text, kw) {
    const s = String(text == null ? '' : text);
    if (!kw) return document.createTextNode(s);
    const q = kw.toLowerCase();
    const lower = s.toLowerCase();
    const i = lower.indexOf(q);
    if (i < 0) return document.createTextNode(s);

    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(s.slice(0, i)));
    frag.appendChild(U.el('span', { class: 'hl', text: s.slice(i, i + kw.length) }));
    frag.appendChild(document.createTextNode(s.slice(i + kw.length)));
    return frag;
  }

  /* ============================================================
     卡片
     ============================================================ */

  function buildCard(site, kw, index) {
    const ui = global.Store.state.ui;
    const readonly = global.Store.isReadOnly();
    const selectMode = !!ui.selectMode && !readonly;
    const card = U.el('div', {
      class:
        'site-card' +
        (site.pinned ? ' is-pinned' : '') +
        (selectMode && ui.selected.has(site.id) ? ' is-selected' : '') +
        (!selectMode && ui.activeCardIndex === index && index >= 0 ? ' is-kbd' : ''),
      title: site.name + '\n' + site.url,
      dataset: { id: site.id, index: String(index) },
      tabindex: '0',
      role: 'link',
    });
    if (!readonly && !selectMode) card.setAttribute('draggable', 'true');

    if (selectMode) {
      const box = U.el('label', { class: 'card-check', title: '选择' });
      const cb = U.el('input', { type: 'checkbox' });
      cb.checked = ui.selected.has(site.id);
      cb.dataset.sel = site.id;
      box.appendChild(cb);
      card.appendChild(box);
    }

    card.appendChild(buildIcon(site));

    const main = U.el('div', { class: 'card-main' });
    const nameEl = U.el('div', { class: 'card-name' });
    nameEl.appendChild(highlight(site.name, kw && nameEl ? kw : ''));
    main.appendChild(nameEl);

    const descText = site.description || U.getHost(site.url);
    const descEl = U.el('div', { class: 'card-desc' });
    descEl.appendChild(highlight(descText, kw));
    main.appendChild(descEl);

    const showTags = global.Store.getSettings().layout.showTags !== false;
    if (showTags && site.tags && site.tags.length) {
      const tagBox = U.el('div', { class: 'card-tags' });
      site.tags.slice(0, 4).forEach((t) => {
        tagBox.appendChild(U.el('span', { class: 'tag-chip', text: t, dataset: { tag: t }, title: '按标签筛选' }));
      });
      main.appendChild(tagBox);
    }

    card.appendChild(main);
    return card;
  }

  /** 打开站点 */
  function openSite(site, forceNew) {
    if (!site) return;
    const settings = global.Store.getSettings();
    const mode = site.openIn === 'default' ? settings.behavior.defaultOpenIn : site.openIn;
    const target = forceNew ? 'new' : mode;

    global.Store.recordClick(site.id);

    if (target === 'self') {
      global.location.href = site.url;
    } else {
      const w = global.open(site.url, '_blank', 'noopener,noreferrer');
      if (w) w.opener = null;
    }
  }

  /* ============================================================
     侧栏
     ============================================================ */

  function renderSidebar() {
    const list = U.$('#catList');
    if (!list) return;
    list.textContent = '';

    const st = global.Store.stats();
    const ui = global.Store.state.ui;
    const frag = document.createDocumentFragment();

    // 系统分类（「未分类」的名字取自设置，可重命名）
    const readonly = global.Store.isReadOnly();
    const sys = [
      { id: 'all', name: '全部站点', icon: '📚', count: st.sites },
      { id: 'pinned', name: '常用置顶', icon: '📌', count: st.pinned },
      {
        id: 'unclassified',
        name: global.Store.uncategorizedName(),
        icon: '📥',
        count: st.uncategorized,
        more: true,
      },
    ];

    sys.forEach((s) => {
      const children = [
        U.el('span', { class: 'cat-ico', text: s.icon }),
        U.el('span', { class: 'cat-name', text: s.name }),
        U.el('span', { class: 'cat-count', text: String(s.count) }),
      ];
      if (s.more && !readonly) {
        children.push(
          U.el('button', {
            class: 'cat-more is-always',
            title: '分组操作（重命名）',
            text: '⋯',
            dataset: { more: s.id },
          })
        );
      }
      frag.appendChild(
        U.el(
          'div',
          {
            class: 'cat-item' + (ui.activeCategory === s.id ? ' is-active' : ''),
            dataset: { cat: s.id },
            role: 'button',
            tabindex: '0',
          },
          children
        )
      );
    });

    const tree = global.Store.categoryTree();
    if (tree.length) {
      frag.appendChild(U.el('div', { class: 'cat-sep' }));
      frag.appendChild(U.el('div', { class: 'cat-sect-title', text: '我的分类' }));
    }

    tree.forEach((node) => {
      const count = global.Store.sitesOfCategory(node.cat.id, true).length;
      const item = U.el(
        'div',
        {
          class: 'cat-item' + (ui.activeCategory === node.cat.id ? ' is-active' : ''),
          dataset: { cat: node.cat.id },
          role: 'button',
          tabindex: '0',
          draggable: readonly ? null : 'true',
        },
        [
          U.el('span', { class: 'cat-ico', text: node.cat.icon || '📁' }),
          U.el('span', { class: 'cat-name', text: node.cat.name }),
          U.el('span', { class: 'cat-count', text: String(count) }),
          U.el('button', {
            class: 'cat-more',
            title: '分类操作',
            text: '⋯',
            dataset: { more: node.cat.id },
          }),
        ]
      );
      item.dataset.dragcat = node.cat.id;
      frag.appendChild(item);

      node.children.forEach((child) => {
        const c2 = global.Store.sitesOfCategory(child.id, false).length;
        const sub = U.el(
          'div',
          {
            class: 'cat-item is-sub' + (ui.activeCategory === child.id ? ' is-active' : ''),
            dataset: { cat: child.id },
            role: 'button',
            tabindex: '0',
            draggable: readonly ? null : 'true',
          },
          [
            U.el('span', { class: 'cat-ico', text: child.icon || '·' }),
            U.el('span', { class: 'cat-name', text: child.name }),
            U.el('span', { class: 'cat-count', text: String(c2) }),
          ]
        );
        sub.dataset.dragcat = child.id;
        frag.appendChild(sub);
      });
    });

    list.appendChild(frag);
  }

  /* ============================================================
     主区域
     ============================================================ */

  function renderBoard() {
    const board = U.$('#board');
    const empty = U.$('#emptyState');
    if (!board) return;

    const data = global.Store.getData();
    const ui = global.Store.state.ui;
    const kw = ui.keyword;
    const readonly = global.Store.isReadOnly();

    // 完全没数据 → 空状态
    if (!data.sites.length && !kw) {
      board.textContent = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    board.textContent = '';
    const frag = document.createDocumentFragment();

    // 收集要渲染的分组
    const groups = buildGroups(ui.activeCategory, kw);

    let totalShown = 0;
    let cardIndex = 0;

    groups.forEach((g) => {
      if (!g.sites.length) return;
      totalShown += g.sites.length;

      const collapsed = !!ui.collapsed[g.id];
      const section = U.el('section', {
        class: 'section' + (collapsed ? ' is-collapsed' : ''),
        dataset: { group: g.id },
      });
      const head = U.el('div', { class: 'section-head', title: '点击折叠 / 展开' }, [
        U.el('div', { class: 'section-title' }, [
          U.el('span', { class: 'cat-ico', text: g.icon || '📁' }),
          document.createTextNode(g.name),
        ]),
        U.el('span', { class: 'section-count', text: String(g.sites.length) }),
        U.el('span', { class: 'section-line' }),
        U.el('span', { class: 'section-caret', text: '▾' }),
      ]);
      if (!readonly) {
        head.appendChild(
          U.el('button', {
            class: 'section-add',
            title: '在此分类下添加站点',
            dataset: { addto: g.id, addname: g.name },
          }, [U.el('span', { text: '＋ 添加' })])
        );
      }
      section.appendChild(head);

      const grid = U.el('div', { class: 'card-grid' });
      const cardsFrag = document.createDocumentFragment();
      g.sites.forEach((s) => {
        cardsFrag.appendChild(buildCard(s, kw, cardIndex));
        cardIndex++;
      });
      grid.appendChild(cardsFrag);
      section.appendChild(grid);
      frag.appendChild(section);
    });

    // 搜索无结果 —— 给出补充查询与添加入口
    if (!totalShown) {
      const engine = global.Store.getSettings().behavior.searchEngine || 'baidu';
      const engines = {
        baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
        bing: { name: '必应', url: 'https://www.bing.com/search?q=' },
        google: { name: 'Google', url: 'https://www.google.com/search?q=' },
      };
      const e = engines[engine] || engines.baidu;
      const actions = U.el('div', { class: 'no-result-actions' });
      if (kw) {
        actions.appendChild(
          U.el('a', {
            class: 'btn btn-outline',
            href: e.url + encodeURIComponent(kw),
            target: '_blank',
            rel: 'noopener noreferrer',
            text: '去' + e.name + '搜「' + kw + '」',
          })
        );
      }
      if (!readonly) {
        actions.appendChild(U.el('button', { class: 'btn btn-primary', id: 'btnAddFromSearch', text: '添加为站点' }));
      }
      const nr = U.el('div', { class: 'no-result' }, [
        U.el('h3', { text: kw ? '没有找到匹配的站点' : '这个分类还是空的' }),
        U.el('p', { text: kw ? '换个关键词，或者把它添加成新站点。' : '点右上角「添加站点」，或从浏览器收藏夹导入。' }),
        actions,
      ]);
      frag.appendChild(nr);
      board.classList.add('is-empty-result');
    } else {
      board.classList.remove('is-empty-result');
    }

    board.appendChild(frag);
  }

  /** 按当前筛选条件生成分组 */
  function buildGroups(activeCategory, kw) {
    const groups = [];
    const allSites = global.Store.getSites();

    // 全局搜索：不分分类，平铺一个结果区
    if (kw) {
      const matched = allSites.filter((s) => matchSite(s, kw).hit);

      // 排序：置顶 → 名称命中 → 点击数 → 名称
      matched.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const am = matchSite(a, kw).field === 'name' ? 0 : 1;
        const bm = matchSite(b, kw).field === 'name' ? 0 : 1;
        if (am !== bm) return am - bm;
        if ((b.clickCount || 0) !== (a.clickCount || 0)) return (b.clickCount || 0) - (a.clickCount || 0);
        return global.Store.siteSorter(a, b);
      });

      if (activeCategory !== 'all' && activeCategory !== 'unclassified' && activeCategory !== 'pinned') {
        // 在搜索时若指定了分类，做一次过滤
        const catId = activeCategory;
        const allowed = new Set([catId]);
        global.Store.childCategories(catId).forEach((c) => allowed.add(c.id));
        const filtered = matched.filter((s) => allowed.has(s.categoryId));
        return [{ id: 'search', name: '搜索结果', icon: '🔍', sites: filtered }];
      }
      return [{ id: 'search', name: '搜索结果', icon: '🔍', sites: matched }];
    }

    // 无搜索
    if (activeCategory === 'all') {
      // 置顶组
      const pinned = global.Store.pinnedSites();
      if (pinned.length) {
        groups.push({ id: 'pinned', name: '常用置顶', icon: '📌', sites: pinned });
      }

      global.Store.categoryTree().forEach((node) => {
        const sites = global.Store.sitesOfCategory(node.cat.id, true);
        if (sites.length) {
          groups.push({
            id: node.cat.id,
            name: node.cat.name,
            icon: node.cat.icon || '📁',
            sites: sites,
          });
        }
      });

      const unc = global.Store.uncategorizedSites();
      if (unc.length) {
        groups.push({
          id: 'unclassified',
          name: global.Store.uncategorizedName(),
          icon: '📥',
          sites: unc,
        });
      }
      return groups;
    }

    if (activeCategory === 'pinned') {
      return [{ id: 'pinned', name: '常用置顶', icon: '📌', sites: global.Store.pinnedSites() }];
    }

    if (activeCategory === 'unclassified') {
      return [
        {
          id: 'unclassified',
          name: global.Store.uncategorizedName(),
          icon: '📥',
          sites: global.Store.uncategorizedSites(),
        },
      ];
    }

    // 指定分类
    const cat = global.Store.getCategory(activeCategory);
    if (!cat) return [{ id: 'all', name: '全部站点', icon: '📚', sites: global.Store.getSites().slice().sort(global.Store.siteSorter) }];

    const out = [];
    const own = global.Store.sitesOfCategory(cat.id, true);
    if (own.length) {
      out.push({ id: cat.id, name: cat.name, icon: cat.icon || '📁', sites: own });
    }
    // 子分类单独成组
    global.Store.childCategories(cat.id).forEach((child) => {
      const cs = global.Store.sitesOfCategory(child.id, false);
      if (cs.length) out.push({ id: child.id, name: child.name, icon: child.icon || '·', sites: cs });
    });
    return out;
  }

  /* ============================================================
     布局变量
     ============================================================ */

  function applyLayout() {
    const s = global.Store.getSettings();
    const board = U.$('#board');
    const root = document.documentElement;
    if (!board) return;

    board.dataset.size = s.layout.cardSize || 'medium';
    board.dataset.showdesc = s.layout.showDescription ? 'true' : 'false';

    // 每行卡片数：auto 时按窗口宽度自适应
    let cols;
    if (s.layout.columns === 'auto') {
      const w = global.innerWidth || 1440;
      if (w >= 1560) cols = 6;
      else if (w >= 1280) cols = 5;
      else if (w >= 1000) cols = 4;
      else if (w >= 768) cols = 3;
      else cols = 2;
    } else {
      cols = Number(s.layout.columns) || 5;
      // 小屏强制收敛
      const w = global.innerWidth || 1440;
      if (w < 768) cols = Math.min(cols, 2);
      else if (w < 1024) cols = Math.min(cols, 3);
    }
    root.style.setProperty('--cols-xl', String(cols));
    root.style.setProperty('--cols', String(cols));
  }

  /* ============================================================
     主题
     ============================================================ */

  function applyTheme() {
    const s = global.Store.getSettings();
    const mode = s.theme || 'auto';
    const resolved =
      mode === 'auto'
        ? (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;

    document.documentElement.setAttribute('data-theme', resolved);

    // 顶栏时钟显隐
    const clock = U.$('#clock');
    if (clock) clock.hidden = !s.behavior.showClock;

    // 主题按钮图标
    const sun = document.querySelector('.ico-sun');
    const moon = document.querySelector('.ico-moon');
    if (sun && moon) {
      sun.style.display = resolved === 'light' ? '' : 'none';
      moon.style.display = resolved === 'dark' ? '' : 'none';
    }

    return resolved;
  }

  /* ============================================================
     全量渲染
     ============================================================ */

  function renderAll() {
    applyTheme();
    applyLayout();
    renderSidebar();
    renderBoard();
  }

  /* ============================================================
     设置面板渲染
     ============================================================ */

  function renderSettings() {
    const s = global.Store.getSettings();

    // 主题分段
    setSegActive('#segTheme', s.theme);
    setSegActive('#segBgType', s.background.type);
    setSegActive('#segColumns', s.layout.columns);
    setSegActive('#segCardSize', s.layout.cardSize);
    setSegActive('#segOpenIn', s.behavior.defaultOpenIn);
    setSegActive('#segSortMode', s.layout.sortMode || 'manual');

    // 背景子面板显隐
    const t = s.background.type;
    toggle('#panePreset', t === 'preset');
    toggle('#paneGradient', t === 'gradient');
    toggle('#paneColor', t === 'color');
    toggle('#paneUpload', t === 'upload');
    toggle('#paneUrl', t === 'url');

    // 滑杆
    const blur = U.$('#bgBlur');
    const ol = U.$('#bgOverlayRange');
    const ga = U.$('#gradAngle');
    if (blur) blur.value = s.background.blur || 0;
    if (ol) ol.value = Math.round((s.background.overlay || 0) * 100);
    if (ga) ga.value = s.background.gradient.angle || 135;
    U.$('#blurVal').textContent = String(s.background.blur || 0);
    U.$('#overlayVal').textContent = String(Math.round((s.background.overlay || 0) * 100));
    U.$('#gradAngleVal').textContent = String(s.background.gradient.angle || 135);

    const gc = U.$('#gradFrom');
    const gt = U.$('#gradTo');
    if (!gc.dataset.bound) {
      gc.value = s.background.gradient.from;
      gt.value = s.background.gradient.to;
    }

    const bc = U.$('#bgColor');
    if (bc.value !== s.background.color) bc.value = s.background.color;

    const bu = U.$('#bgUrl');
    bu.value = s.background.url || '';

    const fit = U.$('#bgFit');
    fit.value = s.background.fit || 'cover';

    U.$('#autoThemeColor').checked = !!s.background.autoThemeColor;

    // 行为
    U.$('#showClock').checked = !!s.behavior.showClock;
    U.$('#allowFaviconFetch').checked = !!s.behavior.allowFaviconFetch;
    U.$('#showDesc').checked = !!s.layout.showDescription;
    if (U.$('#showTags')) U.$('#showTags').checked = s.layout.showTags !== false;
    if (U.$('#bgRotate')) U.$('#bgRotate').checked = !!s.background.rotate.enabled;
    if (U.$('#bgRotateMin')) U.$('#bgRotateMin').value = String(s.background.rotate.minutes || 5);

    renderWallpapers();
    renderSwatches();
    renderDataStats();
    renderRollbackHint();
    renderTrash();
  }

  function setSegActive(sel, val) {
    const seg = U.$(sel);
    if (!seg) return;
    U.$$('button', seg).forEach((b) => {
      b.classList.toggle('is-active', b.dataset.val === String(val));
    });
  }

  function toggle(sel, show) {
    const node = U.$(sel);
    if (node) node.hidden = !show;
  }

  function renderWallpapers() {
    const grid = U.$('#wallpaperGrid');
    if (!grid) return;
    const cur = global.Store.getSettings().background.presetId;
    grid.textContent = '';
    const frag = document.createDocumentFragment();
    Background.PRESETS.forEach((p) => {
      const item = U.el('div', {
        class: 'wallpaper-item' + (p.id === cur ? ' is-active' : ''),
        title: p.label,
        dataset: { preset: p.id },
      });
      item.style.backgroundImage = p.css;
      item.appendChild(U.el('div', { class: 'wp-label', text: p.label }));
      frag.appendChild(item);
    });
    grid.appendChild(frag);
  }

  function renderSwatches() {
    const gs = U.$('#gradientSwatches');
    const cs = U.$('#colorSwatches');
    const bg = global.Store.getSettings().background;

    if (gs) {
      gs.textContent = '';
      const frag = document.createDocumentFragment();
      Background.GRADIENT_PRESETS.forEach((g) => {
        const isActive = g.from === bg.gradient.from && g.to === bg.gradient.to;
        const sw = U.el('div', {
          class: 'swatch' + (isActive ? ' is-active' : ''),
          title: g.from + ' → ' + g.to,
          dataset: { gfrom: g.from, gto: g.to },
        });
        sw.style.backgroundImage = 'linear-gradient(135deg, ' + g.from + ', ' + g.to + ')';
        frag.appendChild(sw);
      });
      gs.appendChild(frag);
    }

    if (cs) {
      cs.textContent = '';
      const frag = document.createDocumentFragment();
      Background.COLOR_PRESETS.forEach((c) => {
        const sw = U.el('div', {
          class: 'swatch' + (c === bg.color ? ' is-active' : ''),
          title: c,
          dataset: { color: c },
        });
        sw.style.background = c;
        frag.appendChild(sw);
      });
      cs.appendChild(frag);
    }
  }

  async function renderUploadedThumbs() {
    const wrap = U.$('#uploadedThumbs');
    const hint = U.$('#uploadHint');
    if (!wrap) return;

    const list = await global.Storage.listImages();
    const cur = global.Store.getSettings().background.imageId;
    wrap.textContent = '';

    if (!list.length) {
      if (hint) hint.textContent = '还没有上传过图片。';
      return;
    }
    if (hint) hint.textContent = '共 ' + list.length + ' 张，单击使用，点右上角 × 删除。';

    list.sort((a, b) => b.createdAt - a.createdAt);

    const frag = document.createDocumentFragment();
    for (const rec of list) {
      let url = '';
      const cached = global.Store.state.runtime.thumbUrls[rec.id];
      if (cached) url = cached;
      else {
        url = URL.createObjectURL(rec.blob);
        global.Store.state.runtime.thumbUrls[rec.id] = url;
      }

      const item = U.el('div', {
        class: 'thumb' + (rec.id === cur ? ' is-active' : ''),
        title: rec.name + '\n' + U.fileSize(rec.size) + '\n' + rec.w + '×' + rec.h,
        dataset: { img: rec.id },
      });
      item.style.backgroundImage = 'url("' + url + '")';
      item.appendChild(
        U.el('button', { class: 'thumb-del', text: '×', title: '删除这张图片', dataset: { del: rec.id } })
      );
      frag.appendChild(item);
    }
    wrap.appendChild(frag);
  }

  function renderDataStats() {
    const box = U.$('#dataStats');
    if (!box) return;
    const st = global.Store.stats();
    box.textContent = '';
    const items = [
      { n: st.sites, l: '站点总数', cls: '' },
      { n: st.categories, l: '分类数', cls: 'is-muted' },
      { n: st.pinned, l: '置顶', cls: 'is-muted' },
      { n: st.clicks, l: '累计访问', cls: '' },
    ];
    items.forEach((it) => {
      box.appendChild(
        U.el('div', { class: 'stat-chip ' + it.cls }, [
          U.el('div', { class: 'stat-num', text: String(it.n) }),
          U.el('div', { class: 'stat-label', text: it.l }),
        ])
      );
    });
  }

  function renderRollbackHint() {
    const el = U.$('#rollbackHint');
    const btn = U.$('#btnRollback');
    if (!el || !btn) return;
    const has = global.Storage.hasSnapshot();
    btn.disabled = !has;
    el.textContent = has ? '可回滚到上一次修改前的状态。' : '暂无可回滚的快照（做过修改后才会生成）。';
  }

  /* ---------- 回收站 ---------- */
  function renderTrash() {
    const box = U.$('#trashList');
    const hint = U.$('#trashHint');
    const emptyBtn = U.$('#btnEmptyTrash');
    if (!box) return;

    const list = global.Store.getTrash();
    box.textContent = '';
    if (hint) hint.textContent = list.length ? '共 ' + list.length + ' 条，保留最近 50 条。' : '回收站是空的。';
    if (emptyBtn) emptyBtn.disabled = !list.length;
    if (!list.length) return;

    const frag = document.createDocumentFragment();
    list.forEach((item) => {
      const row = U.el('div', { class: 'trash-row' }, [
        U.el('div', { class: 'trash-main' }, [
          U.el('div', { class: 'trash-name', text: item.site.name }),
          U.el('div', { class: 'trash-url', text: U.getHost(item.site.url) || item.site.url }),
        ]),
        U.el('div', { class: 'trash-ops' }, [
          U.el('button', { class: 'btn btn-ghost btn-xs', text: '恢复', dataset: { restore: item.site.id } }),
          U.el('button', { class: 'btn btn-ghost btn-xs is-danger', text: '彻底删除', dataset: { purge: item.site.id } }),
        ]),
      ]);
      frag.appendChild(row);
    });
    box.appendChild(frag);
  }

  /* ---------- 访问统计 ---------- */
  function renderStatsPanel() {
    const box = U.$('#statsPanel');
    if (!box) return;
    const st = global.Store.stats();
    const top = global.Store.topSites(12);
    const tags = st.tags.slice(0, 12);
    const max = top.length ? top[0].clickCount || 1 : 1;

    box.textContent = '';

    const chips = U.el('div', { class: 'stat-row' });
    [
      { n: st.sites, l: '站点总数' },
      { n: st.categories, l: '分类数' },
      { n: st.clicks, l: '累计访问' },
      { n: st.tags.length, l: '标签数' },
    ].forEach((it) => {
      chips.appendChild(
        U.el('div', { class: 'stat-chip' }, [
          U.el('div', { class: 'stat-num', text: String(it.n) }),
          U.el('div', { class: 'stat-label', text: it.l }),
        ])
      );
    });
    box.appendChild(chips);

    const sec1 = U.el('div', { class: 'stats-section' }, [
      U.el('div', { class: 'stats-title', text: '访问最多的站点' }),
    ]);
    if (!top.length) {
      sec1.appendChild(U.el('p', { class: 'note-sub', text: '还没有访问记录，点开几个站点后这里就会有排行。' }));
    } else {
      top.forEach((s, i) => {
        const pct = Math.max(4, Math.round(((s.clickCount || 0) / max) * 100));
        const fill = U.el('span', { class: 'bar-fill' });
        fill.style.width = pct + '%';
        sec1.appendChild(
          U.el('div', { class: 'bar-row' }, [
            U.el('span', { class: 'bar-rank', text: String(i + 1) }),
            U.el('span', { class: 'bar-name', text: s.name }),
            U.el('span', { class: 'bar-track' }, [fill]),
            U.el('span', { class: 'bar-val', text: String(s.clickCount || 0) }),
          ])
        );
      });
    }
    box.appendChild(sec1);

    const sec2 = U.el('div', { class: 'stats-section' }, [
      U.el('div', { class: 'stats-title', text: '标签分布' }),
    ]);
    if (!tags.length) {
      sec2.appendChild(U.el('p', { class: 'note-sub', text: '给站点加几个标签，这里会显示分布。' }));
    } else {
      const wrap = U.el('div', { class: 'tag-cloud' });
      tags.forEach((t) => {
        wrap.appendChild(U.el('span', { class: 'tag-chip', text: t.name + ' · ' + t.count, dataset: { tag: t.name } }));
      });
      sec2.appendChild(wrap);
    }
    box.appendChild(sec2);
  }

  global.Render = {
    renderAll,
    renderSidebar,
    renderBoard,
    renderSettings,
    renderUploadedThumbs,
    renderDataStats,
    renderRollbackHint,
    renderTrash,
    renderStatsPanel,
    renderWallpapers,
    applyTheme,
    applyLayout,
    buildCard,
    buildIcon,
    buildGroups,
    openSite,
    matchSite,
    highlight,
    firstLetter,
    setSegActive,
  };
})(window);
