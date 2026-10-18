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

   分层规则：完整保留书签文件夹的目录层级（最多 MAX_DEPTH 层），
            浏览器自带的根容器（收藏夹栏 / 其他书签 …）不计入层级。
   ============================================================ */
(function (global) {
  'use strict';

  /** 分类层级上限：超过这一层的文件夹不再新建分类，站点挂到该层 */
  const MAX_DEPTH = 6;

  /** 需要跳过、不作为分类的根节点名称 */
  const ROOT_NAMES = [
    '收藏夹栏', '收藏夹', '书签栏', '书签菜单', '书签工具栏', '书签', '其他书签', '其它书签',
    'favorites bar', 'favorites', 'bookmarks bar', 'bookmarks toolbar', 'bookmarks menu',
    'bookmarks', 'other bookmarks', 'mobile bookmarks', 'reading list',
  ];

  /** 路径分隔符：用不可见字符，避免和文件夹名里的普通字符冲突 */
  const SEP = '\u0001';

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
    if (u.indexOf('wyciwyg:') === 0) return true;
    // 常见内部占位
    if (name && /^(javascript|新建书签|new bookmark)$/i.test(String(name).trim())) return true;
    return false;
  }

  /** 把分类路径数组转成唯一 key */
  function pathKey(path) {
    return (path || []).join(SEP);
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

    const catRecords = []; // { name, path:[names], icon }
    const sites = []; // { name, url, path:[names], categoryName, parentName, icon, addDate }
    const seenUrl = new Set(); // 按剥离追踪参数后的规范化地址去重
    const seenRaw = new Set();
    const seenBase = new Set(); // 带查询串时，再记录一份「裸路径」用于兜底判重
    let skipped = 0;
    let maxDepth = 0;

    /* ---------- 递归遍历 ---------- */
    /**
     * @param {Element} dl 当前层的 <DL>
     * @param {Array<{name:string, icon:string}>} path 当前分类路径
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
            const nextPath = handleFolder(name, path, h3);
            if (subDl) walk(subDl, nextPath);
          } else if (a) {
            pushSite(a, path);
          }

          // 有些导出文件把嵌套 DL 放在 DT 的同级，而不是内部
          if (!h3 && !a && subDl) walk(subDl, path);
        } else if (tag === 'H3') {
          // 结构被完全打平的兜底
          const name = cleanText(node.textContent);
          const nextPath = handleFolder(name, path, node);
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
    function handleFolder(name, path, element) {
      if (!name) return path;

      // 根容器：不作为分类，其子文件夹提升为一级
      if (isRootName(name)) return path;

      // 达到层级上限：不再新建分类，站点挂到当前最深一层
      if (path.length >= MAX_DEPTH) return path;

      // 父子同名（少见，但有的导出工具会这样）：合并成一层
      if (path.length && path[path.length - 1].name === name) return path;

      const record = {
        name: name,
        icon: getFolderIcon(element),
      };
      catRecords.push({
        name: name,
        icon: record.icon,
        // 分类的完整路径：父路径 + 自己
        path: path.map((p) => p.name).concat([name]),
      });
      const nextPath = path.concat([record]);
      if (nextPath.length > maxDepth) maxDepth = nextPath.length;
      return nextPath;
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

      const names = path.map((p) => p.name);

      sites.push({
        name: name.slice(0, 60),
        url: n.url,
        path: names,
        categoryName: names.length ? names[names.length - 1] : '',
        parentName: names.length > 1 ? names[names.length - 2] : '',
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

    /* ---------- 整理分类：按完整路径去重，并累计站点数 ---------- */
    const catMap = new Map(); // pathKey -> category
    const order = [];
    catRecords.forEach((c) => {
      const k = pathKey(c.path);
      if (catMap.has(k)) return;
      catMap.set(k, {
        name: c.name,
        icon: c.icon,
        path: c.path,
        depth: c.path.length,
        count: 0, // 含所有子分类的站点数
        direct: 0, // 只算直属站点
        samples: [],
      });
      order.push(k);
    });

    sites.forEach((s) => {
      const names = s.path.slice();
      // 自底向上累加每一层的计数
      for (let d = names.length; d > 0; d--) {
        const k = pathKey(names.slice(0, d));
        const c = catMap.get(k);
        if (!c) continue;
        c.count++;
        if (d === names.length) {
          c.direct++;
          if (c.samples.length < 3) c.samples.push(s.name);
        }
      }
    });

    const categories = order.map((k) => catMap.get(k));
    const topCategories = categories.filter((c) => c.depth === 1).length;

    return {
      ok: true,
      categories: categories,
      sites: sites,
      stats: {
        sites: sites.length,
        categories: categories.length,
        topCategories: topCategories,
        maxDepth: maxDepth,
        skipped: skipped,
      },
    };
  }

  /**
   * 兼容旧调用：按分类 key 过滤站点
   * @param {object} parsed parse() 的结果
   * @param {Array<string>} selectedKeys 形如 'a\u0001b'
   */
  function filterSelection(parsed, selectedKeys) {
    const sel = new Set(selectedKeys || []);
    return parsed.sites.filter((s) => {
      const names = s.path || [];
      if (!names.length) return sel.has('');
      // 勾选父分类时，子分类下的站点一并导入
      for (let d = 1; d <= names.length; d++) {
        if (sel.has(pathKey(names.slice(0, d)))) return true;
      }
      return false;
    });
  }

  global.Bookmark = {
    MAX_DEPTH,
    SEP,
    parse,
    filterSelection,
    isRootName,
    pathKey,
  };
})(window);
