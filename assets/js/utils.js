/* ============================================================
   utils.js — 通用工具函数
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- DOM 简写 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /* ---------- ID ---------- */
  function uid(prefix) {
    const rand =
      global.crypto && global.crypto.randomUUID
        ? global.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    return (prefix || 'id') + '_' + rand;
  }

  /* ---------- 防抖 / 节流 ---------- */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), wait);
    };
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      const now = Date.now();
      const remain = wait - (now - last);
      if (remain <= 0) {
        last = now;
        fn.apply(ctx, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(ctx, args);
        }, remain);
      }
    };
  }

  /* ---------- URL ---------- */
  /** 规范化 URL：补协议、去空白、校验协议白名单 */
  function normalizeUrl(raw) {
    if (!raw) return { ok: false, url: '', reason: '请输入网址' };
    let s = String(raw).trim().replace(/\s+/g, '');
    if (!s) return { ok: false, url: '', reason: '请输入网址' };

    // 拒绝危险协议
    if (/^(javascript|data|vbscript|file):/i.test(s)) {
      return { ok: false, url: '', reason: '不支持该协议' };
    }
    // 补协议
    if (!/^https?:\/\//i.test(s)) {
      if (/^\/\//.test(s)) s = 'https:' + s;
      else s = 'https://' + s;
    }
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { ok: false, url: '', reason: '仅支持 http / https 链接' };
      }
      if (!u.hostname || u.hostname.indexOf('.') === -1) {
        return { ok: false, url: '', reason: '域名格式不正确' };
      }
      return { ok: true, url: u.href };
    } catch (e) {
      return { ok: false, url: '', reason: '网址格式不正确' };
    }
  }

  function getHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '');
    } catch (e) {
      return '';
    }
  }

  /** 用于去重的键：协议无关 + 去尾斜杠 + 去 www */
  function urlKey(url) {
    try {
      const u = new URL(url);
      let host = u.hostname.toLowerCase().replace(/^www\./, '');
      let path = u.pathname.replace(/\/+$/, '');
      let search = u.search;
      // 剥离常见追踪参数
      if (search) {
        const p = new URLSearchParams(search);
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from'].forEach(
          (k) => p.delete(k)
        );
        const rest = p.toString();
        search = rest ? '?' + rest : '';
      }
      return host + path + search + (u.hash || '');
    } catch (e) {
      return String(url || '').toLowerCase().replace(/\/+$/, '');
    }
  }

  function isSameHost(a, b) {
    return getHost(a) === getHost(b);
  }

  /* ---------- 文本 ---------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeReg(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 智能截断（按字符） */
  function truncate(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* ---------- 颜色 ---------- */
  /** 字符串 → 稳定哈希 → 色相，用于生成首字母色块背景 */
  function hashColor(str, salt) {
    let h = 0;
    const s = String(str || '') + (salt || '');
    for (let i = 0; i < s.length; i++) {
      h = (h << 5) - h + s.charCodeAt(i);
      h |= 0;
    }
    const hue = Math.abs(h) % 360;
    return 'hsl(' + hue + ', 62%, 52%)';
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  function rgbToHex(r, g, b) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }

  /* ---------- 时间 ---------- */
  function nowIso() {
    return new Date().toISOString();
  }

  function stampCompact() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes())
    );
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---------- 杂项 ---------- */
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsText(file, 'UTF-8');
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('读取失败'));
      fr.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = src;
    });
  }

  /** 复制到剪贴板（带降级） */
  async function copyText(text) {
    try {
      if (navigator.clipboard && global.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      throw new Error('no clipboard api');
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  function fileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
  }

  global.U = {
    $,
    $$,
    el,
    uid,
    debounce,
    throttle,
    normalizeUrl,
    getHost,
    urlKey,
    isSameHost,
    escapeHtml,
    escapeReg,
    truncate,
    hashColor,
    hexToRgb,
    rgbToHex,
    nowIso,
    stampCompact,
    formatDate,
    clamp,
    download,
    readFileAsText,
    readFileAsDataUrl,
    loadImage,
    copyText,
    fileSize,
  };
})(window);
