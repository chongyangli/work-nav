/* ============================================================
   bookmark.js — 浏览器书签 HTML 解析
   格式：Netscape Bookmark File Format
     <DL><p>
       <DT><H3>文件夹名</H3>
       <DL><p>
         <DT><A HREF="..." ICON="...">站点名</A>
       </DL>
     </DL>
   注意：真实文件里 <DT>/<DD> 是隐式闭合的，浏览器解析后 DOM 树会被重排，
        因此必须按 DL 的 children 逐层递归，不能直接 querySelectorAll('a')。
   ============================================================ */
(function (global) {
  'use strict';

  /** 需要跳过、不作为分类的根节点名称 */
  const ROOT_NAMES = [
    '收藏夹栏', '收藏夹', '书签栏', '书签菜单', '书签工具栏', '书签', '其他书签', '其它书签',
    'favorites bar', 'favorites', 'bookmarks bar', 'bookmarks toolbar', 'bookmarks menu',
    'bookmarks', 'other bookmarks', 'mobile bookmarks', 'reading list',
  ];

  function isRootName(name) {
    const n = String(name || '').trim().toLowerCase();
    return ROOT_NAMES.indexOf(n) >= 0;
  }

  /** 判断是否是需要过滤掉的链接 */
  function isSkippable(url, name) {
    if (!url) return true;
    const u = String(url).trim();
    if (!u) return true;
    // 伪协议 / 内部链接
    if (/^(javascript|place|about|chrome|edge|moz-extension|chrome-extension|data|file|blob):/i.test(u)) return true;
    if (/^(javascript|place):/i.test(u)) return true;
    if (u.indexOf('wyciwyg:') === 0) return true;
    // 常见内部占位
    if (name && /^(javascript|新建书签|new bookmark)$/i.test(String(name).trim())) return true;
    return false;
  }

  /**
   * 解析书签 HTML
   * @param {string} html 文件文本内容
   * @returns {{ok:boolean, message?:string, categories:Array, sites:Array, stats:object}}
   */
  function parse(html) {
    if (!html || !String(html).trim()) {
      return { ok: false, message: '文件内容为空' };
    }

    const doc = new DOMParser().parseFromString(String(html), 'text/html');

    // 校验是不是书签文件
    const firstDl = doc.querySelector('dl');
    if (!firstDl) {
      return {
        ok: false,
        message: '没有在文件中找到书签结构，请确认导出的是「书签 HTML 文件」而不是浏览器主页或其它网页。',
      };
    }

    const categories = []; // { name, parentName }
    const sites = []; // { name, url, categoryName, parentName, icon, addDate }
    const seenUrl = new Set(); // 按剥离追踪参数后的规范化地址去重
    const seenRaw = new Set();
    const seenBase = new Set(); // 带查询串时，再记录一份「裸路径」用于兜底判重
    let skipped = 0;

    /* ---------- 递归遍历 ---------- */
    /**
     * @param {Element} dl 当前层的 <DL>
     * @param {Array<string>} path 当前的分类路径 [{name}] 最多两层
     */
    function walk(dl, path) {
      if (!dl || !dl.children) return;

      // 收集本层的 DT（因为隐式闭合，DT 可能被重排，这里以 DL 的直接子元素为准）
      const items = Array.from(dl.children);

      for (let i = 0; i < items.length; i++) {
        const node = items[i];
        const tag = node.tagName ? node.tagName.toUpperCase() : '';

        if (tag === 'DT') {
          // 一个 DT 里可能同时包含 H3 / A / 嵌套 DL
          const h3 = node.querySelector(':scope > h3');
          const a = node.querySelector(':scope > a');
          const subDl = node.querySelector(':scope > dl');

          if (h3) {
            const name = cleanText(h3.textContent);
            const nextPath = handleFolder(name, path, categories, h3);
            if (subDl) walk(subDl, nextPath);
          } else if (a) {
            pushSite(a, path);
          }

          // 有些导出文件把嵌套 DL 放在 DT 的同级，而不是内部
          if (!h3 && !a && subDl) walk(subDl, path);
        } else if (tag === 'H3') {
          // 结构被完全打平的兜底
          const name = cleanText(node.textContent);
          const nextPath = handleFolder(name, path, categories, node);
          const nextDl = nextSiblingDl(node);
          if (nextDl) walk(nextDl, nextPath);
        } else if (tag === 'A') {
          pushSite(node, path);
        } else if (tag === 'DL') {
          walk(node, path);
        } else if (tag === 'P') {
          // 空的 <p> 占位，忽略
          continue;
        }
      }
    }

    /** 处理一个文件夹节点，返回新的路径 */
    function handleFolder(name, path, catList, element) {
      if (!name) return path;

      // 根容器：不作为分类，其子文件夹提升为一级
      if (isRootName(name)) return path;

      // 已经有 2 层了（parent + child），更深的文件夹不再单独建分类，
      // 站点归到第 2 层分类下，避免三层以上难用。
      if (path.length >= 2) return path;

      const parentName = path.length === 1 ? path[0].name : '';
      const record = {
        name: name,
        parentName: parentName,
        icon: getFolderIcon(element),
      };
      catList.push(record);
      return path.concat([record]);
    }

    function nextSiblingDl(node) {
      let sib = node.nextElementSibling;
      while (sib) {
        const t = sib.tagName ? sib.tagName.toUpperCase() : '';
        if (t === 'DL') return sib;
        if (t === 'H3' || t === 'A') return null;
        sib = sib.nextElementSibling;
      }
      return null;
    }

    function pushSite(aEl, path) {
      const rawUrl = aEl.getAttribute('href') || aEl.getAttribute('HREF') || '';
      const name = cleanText(aEl.textContent) || rawUrl;
      if (isSkippable(rawUrl, name)) {
        skipped++;
        return;
      }
      const n = U.normalizeUrl(rawUrl);
      if (!n.ok) {
        skipped++;
        return;
      }
      const key = U.urlKey(n.url); // 已剥离 utm_* / spm 等追踪参数
      if (seenUrl.has(key)) {
        skipped++;
        return;
      }
      // 兜底：如果两条书签只差一个无意义的追踪后缀，也算重复
      const rawKey = n.url.replace(/\/+$/, '');
      if (seenRaw.has(rawKey)) {
        skipped++;
        return;
      }
      let base = '';
      try {
        const u = new URL(n.url);
        base = u.origin + u.pathname.replace(/\/+$/, '');
      } catch (e) {
        base = '';
      }
      if (base && seenBase.has(base)) {
        skipped++;
        return;
      }

      seenUrl.add(key);
      seenRaw.add(rawKey);
      if (base) seenBase.add(base);

      const addDate = Number(aEl.getAttribute('add_date') || aEl.getAttribute('ADD_DATE') || 0);
      const icon = aEl.getAttribute('icon') || aEl.getAttribute('ICON') || '';

      const parentName = path.length === 2 ? path[0].name : '';
      const categoryName = path.length >= 1 ? path[path.length - 1].name : '';

      sites.push({
        name: name.slice(0, 60),
        url: n.url,
        categoryName: isRootName(categoryName) ? '' : categoryName,
        parentName: parentName,
        // 内置 base64 图标体积较大，默认不保存；仅当很短时保留
        icon: icon && icon.length < 20000 && !/^data:/i.test(icon) ? icon : '',
        addDate: addDate ? addDate * 1000 : 0,
      });
    }

    /** 从 H3 的 ICON 属性取文件夹图标 */
    function getFolderIcon(element) {
      const ic = element.getAttribute('icon') || element.getAttribute('ICON') || '';
      if (!ic) return '';
      if (/^data:/i.test(ic)) return '';
      // 只保留 emoji / 短字符
      return ic.length <= 4 ? ic : '';
    }

    function cleanText(t) {
      return String(t || '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /* ---------- 执行 ---------- */
    try {
      walk(firstDl, []);
    } catch (e) {
      console.error('[worknav] 书签解析异常', e);
      return { ok: false, message: '解析出错：' + (e.message || '未知错误') };
    }

    if (!sites.length) {
      return {
        ok: false,
        message: '没有解析到任何有效书签。可能原因：文件是空书签，或导出的是 Safari 的 plist 格式（暂不支持）。',
      };
    }

    // 去重分类（同名同父只留一个）
    const catSeen = new Set();
    const finalCats = [];
    categories.forEach((c) => {
      const key = (c.parentName || '') + '|' + c.name;
      if (catSeen.has(key)) return;
      catSeen.add(key);
      finalCats.push(c);
    });

    // 统计每个分类下的站点数
    const countMap = {};
    sites.forEach((s) => {
      const key = (s.parentName || '') + '|' + (s.categoryName || '');
      countMap[key] = (countMap[key] || 0) + 1;
    });

    const enriched = finalCats.map((c) => {
      const key = (c.parentName || '') + '|' + c.name;
      return {
        name: c.name,
        parentName: c.parentName,
        icon: c.icon,
        count: countMap[key] || 0,
        samples: sites
          .filter((s) => s.categoryName === c.name && (s.parentName || '') === (c.parentName || ''))
          .slice(0, 3)
          .map((s) => s.name),
      };
    });

    return {
      ok: true,
      categories: enriched,
      sites: sites,
      stats: {
        sites: sites.length,
        categories: enriched.length,
        topCategories: enriched.filter((c) => !c.parentName).length,
        skipped: skipped,
      },
    };
  }

  /** 计算真正会被导入的站点（按勾选的分类过滤） */
  function filterSelection(parsed, selectedKeys) {
    const sel = new Set(selectedKeys || []);
    const sites = parsed.sites.filter((s) => {
      const key = (s.parentName || '') + '|' + (s.categoryName || '');
      if (!s.categoryName) return sel.has('|'); // 未分类项
      return sel.has(key);
    });
    return sites;
  }

  global.Bookmark = {
    parse,
    filterSelection,
    isRootName,
  };
})(window);
