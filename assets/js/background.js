/* ============================================================
   background.js — 背景系统
   - 预设壁纸（纯 CSS 渐变生成，零文件依赖）
   - 纯色 / 渐变 / 本地上传 / 图片链接
   - 上传图片：Canvas 压缩后存 IndexedDB
   - 主色调提取
   ============================================================ */
(function (global) {
  'use strict';

  const MAX_EDGE = 2560; // 压缩后最长边
  const QUALITY = 0.85; // 压缩质量
  const MAX_INPUT_BYTES = 12 * 1024 * 1024; // 单张原图上限 12MB

  /* ---------- 预设壁纸（全部用 CSS 渐变实现，不依赖外部文件） ---------- */
  const PRESETS = [
    {
      id: 'aurora',
      label: '极光',
      css: 'linear-gradient(135deg, #667eea 0%, #764ba2 55%, #f093fb 100%)',
    },
    {
      id: 'deepsea',
      label: '深海',
      css: 'linear-gradient(160deg, #0f2027 0%, #203a43 45%, #2c5364 100%)',
    },
    {
      id: 'sunset',
      label: '落日',
      css: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 45%, #a18cd1 100%)',
    },
    {
      id: 'forest',
      label: '林间',
      css: 'linear-gradient(150deg, #134e5e 0%, #1f7a5a 50%, #71b280 100%)',
    },
    {
      id: 'morning',
      label: '晨雾',
      css: 'linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)',
    },
    {
      id: 'night',
      label: '夜幕',
      css: 'linear-gradient(150deg, #141e30 0%, #243b55 100%)',
    },
    {
      id: 'peach',
      label: '蜜桃',
      css: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    },
    {
      id: 'indigo',
      label: '靛蓝',
      css: 'linear-gradient(140deg, #1a2980 0%, #26d0ce 100%)',
    },
    {
      id: 'graphite',
      label: '石墨',
      css: 'linear-gradient(160deg, #232526 0%, #414345 100%)',
    },
    {
      id: 'rose',
      label: '玫瑰',
      css: 'linear-gradient(135deg, #ee9ca7 0%, #ffdde1 100%)',
    },
    {
      id: 'mint',
      label: '薄荷',
      css: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    },
    {
      id: 'ember',
      label: '余烬',
      css: 'linear-gradient(140deg, #3a1c71 0%, #d76d77 55%, #ffaf7b 100%)',
    },
  ];

  const GRADIENT_PRESETS = [
    { from: '#667eea', to: '#764ba2' },
    { from: '#0f2027', to: '#2c5364' },
    { from: '#ff9a9e', to: '#a18cd1' },
    { from: '#134e5e', to: '#71b280' },
    { from: '#141e30', to: '#243b55' },
    { from: '#1a2980', to: '#26d0ce' },
    { from: '#3a1c71', to: '#ffaf7b' },
    { from: '#232526', to: '#414345' },
    { from: '#e0eafc', to: '#cfdef3' },
    { from: '#f093fb', to: '#f5576c' },
    { from: '#4facfe', to: '#00f2fe' },
    { from: '#43e97b', to: '#38f9d7' },
  ];

  const COLOR_PRESETS = [
    '#ffffff', '#f4f6fb', '#e8ecf4',
    '#1e293b', '#0f1424', '#111827',
    '#4c6ef5', '#7c3aed', '#ec4899',
    '#0ea5e9', '#10b981', '#f59e0b',
  ];

  let currentObjectUrl = null;

  /* ============================================================
     图片压缩
     ============================================================ */

  /**
   * 读取图片文件 → 等比缩放 → 压缩为 Blob
   * @param {File} file
   * @returns {Promise<{blob: Blob, w:number, h:number, name:string}>}
   */
  async function compressFile(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) {
      throw new Error('请选择图片文件（jpg / png / webp）');
    }
    if (file.size > MAX_INPUT_BYTES) {
      throw new Error('图片过大（' + U.fileSize(file.size) + '），请选择小于 12MB 的图片');
    }

    const dataUrl = await U.readFileAsDataUrl(file);
    const img = await U.loadImage(dataUrl);

    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('无法读取图片尺寸');

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, tw, th);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))),
        'image/jpeg',
        QUALITY
      );
    });

    return { blob: blob, w: tw, h: th, name: file.name || 'wallpaper.jpg' };
  }

  /** 压缩网络图片 URL（可能因跨域失败，失败则放弃提取主色） */
  async function compressUrl(url) {
    const n = U.normalizeUrl(url);
    if (!n.ok) throw new Error(n.reason);

    let img;
    try {
      img = await loadImageCors(n.url);
    } catch (e) {
      throw new Error('图片无法加载，可能是链接失效或站点禁止跨域引用。');
    }

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    let blob = null;
    const mainColor = safeExtractColor(img);

    // 尝试转成 Blob 便于统一存储；跨域污染 canvas 时会失败，此时保留 URL 方式
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY));
    } catch (e) {
      blob = null;
    }

    return { blob: blob, url: n.url, w: w, h: h, mainColor: mainColor };
  }

  function loadImageCors(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => reject(new Error('timeout')), 15000);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('load error'));
      };
      img.src = src;
    });
  }

  /* ============================================================
     主色调提取
     ============================================================ */

  /**
   * 从图片提取主色（缩略图 + 中位切分简化版：按色相分桶取最多）
   * @returns {string|null} hex
   */
  function extractMainColor(img) {
    try {
      const size = 48;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);

      const data = ctx.getImageData(0, 0, size, size).data;
      const buckets = new Map();

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 128) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        const s = max === min ? 0 : (l > 127 ? (max - min) / (510 - max - min) : (max - min) / (max + min));

        // 过滤掉过亮/过暗/灰度像素，保留有色彩倾向的
        if (l < 30 || l > 225 || s < 0.18) continue;

        // 色相分桶（24 桶）
        let h = 0;
        if (max === min) h = 0;
        else if (max === r) h = ((g - b) / (max - min) + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / (max - min) + 2) * 60;
        else h = ((r - g) / (max - min) + 4) * 60;

        const bucket = Math.floor(h / 15);
        const cur = buckets.get(bucket) || { n: 0, r: 0, g: 0, b: 0 };
        cur.n++;
        cur.r += r;
        cur.g += g;
        cur.b += b;
        buckets.set(bucket, cur);
      }

      if (!buckets.size) return null;

      let best = null;
      buckets.forEach((v) => {
        if (!best || v.n > best.n) best = v;
      });
      if (!best || best.n < 8) return null;

      let r = best.r / best.n;
      let g = best.g / best.n;
      let b = best.b / best.n;

      // 提高饱和度与明度，让它更适合做强调色
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2 / 255;
      const targetS = 0.55;
      const targetL = 0.52;
      const avg = (r + g + b) / 3;
      const f = (v) => {
        const base = avg + (v - avg) * 1.35; // 增强色彩倾向
        return U.clamp(base, 0, 255);
      };
      r = f(r);
      g = f(g);
      b = f(b);

      // 归一化到目标明度
      const curL = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
      if (curL > 0.001) {
        const k = targetL / curL;
        r = U.clamp(r * k, 0, 255);
        g = U.clamp(g * k, 0, 255);
        b = U.clamp(b * k, 0, 255);
      }
      void targetS;

      return U.rgbToHex(r, g, b);
    } catch (e) {
      // 跨域图片会污染 canvas，读取失败属正常
      return null;
    }
  }

  function safeExtractColor(img) {
    try {
      return extractMainColor(img);
    } catch (e) {
      return null;
    }
  }

  /* ============================================================
     应用背景
     ============================================================ */

  /**
   * 把背景设置渲染到 DOM
   * @param {object} bg settings.background
   */
  async function apply(bg) {
    const layer = U.$('#bgLayer');
    const root = document.documentElement;
    if (!layer) return;

    const type = (bg && bg.type) || 'none';

    // 释放旧的 ObjectURL
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    // 先重置
    layer.style.backgroundImage = 'none';
    layer.style.backgroundColor = '';
    layer.style.backgroundSize = 'cover';
    layer.style.backgroundRepeat = 'no-repeat';
    layer.style.backgroundPosition = 'center';

    let mainColor = null;

    switch (type) {
      case 'none':
        layer.style.backgroundColor = 'var(--bg)';
        break;

      case 'color':
        layer.style.backgroundColor = bg.color || 'var(--bg)';
        break;

      case 'gradient': {
        const g = bg.gradient || {};
        layer.style.backgroundImage =
          'linear-gradient(' + (Number(g.angle) || 135) + 'deg, ' + (g.from || '#667eea') + ', ' + (g.to || '#764ba2') + ')';
        break;
      }

      case 'preset': {
        const p = PRESETS.find((x) => x.id === bg.presetId) || PRESETS[0];
        layer.style.backgroundImage = p.css;
        break;
      }

      case 'upload': {
        const rec = await global.Storage.getImage(bg.imageId);
        if (rec && rec.blob) {
          currentObjectUrl = URL.createObjectURL(rec.blob);
          layer.style.backgroundImage = 'url("' + currentObjectUrl + '")';
          mainColor = rec.mainColor || null;
          if (!mainColor) {
            try {
              const img = await U.loadImage(currentObjectUrl);
              mainColor = safeExtractColor(img);
              if (mainColor) {
                rec.mainColor = mainColor;
                global.Storage.putImage(rec).catch(() => {});
              }
            } catch (e) {
              /* ignore */
            }
          }
        } else {
          // 图片丢失（IndexedDB 被清），降级到默认预设
          layer.style.backgroundImage = PRESETS[0].css;
        }
        break;
      }

      case 'url': {
        if (bg.url) {
          layer.style.backgroundImage = 'url("' + String(bg.url).replace(/"/g, '') + '")';
        } else {
          layer.style.backgroundColor = 'var(--bg)';
        }
        break;
      }

      default:
        layer.style.backgroundColor = 'var(--bg)';
    }

    // 填充方式
    const fit = bg.fit || 'cover';
    if (fit === 'repeat') {
      layer.style.backgroundSize = 'auto';
      layer.style.backgroundRepeat = 'repeat';
    } else {
      layer.style.backgroundSize = fit === 'contain' ? 'contain' : 'cover';
      layer.style.backgroundRepeat = 'no-repeat';
    }

    // 模糊与遮罩
    root.style.setProperty('--bg-blur', (Number(bg.blur) || 0) + 'px');
    root.style.setProperty('--bg-overlay', String(Number(bg.overlay) || 0));

    // 遮罩颜色跟随主题
    const theme = resolveTheme();
    root.style.setProperty('--overlay-color', theme === 'dark' ? '0, 0, 0' : '255, 255, 255');

    // 主色联动
    if (bg.autoThemeColor && mainColor) {
      applyAccent(mainColor, theme);
    } else {
      clearAccent();
    }
  }

  /* ---------- 强调色 ---------- */

  function applyAccent(hex, theme) {
    const rgb = U.hexToRgb(hex);
    if (!rgb) return;
    const root = document.documentElement;
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-soft', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.14)');
    root.style.setProperty('--card-border-hover', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ', 0.4)');
    void theme;
  }

  function clearAccent() {
    const root = document.documentElement;
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-soft');
    root.style.removeProperty('--card-border-hover');
  }

  function resolveTheme() {
    const s = global.Store && global.Store.getSettings ? global.Store.getSettings() : null;
    const mode = (s && s.theme) || 'auto';
    if (mode === 'auto') {
      return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  }

  /* ============================================================
     上传图片管理
     ============================================================ */

  async function saveUploadedImage(file) {
    const res = await compressFile(file);
    const rec = {
      id: U.uid('bg'),
      blob: res.blob,
      w: res.w,
      h: res.h,
      size: res.blob.size,
      name: res.name,
      createdAt: Date.now(),
      mainColor: null,
    };
    // 顺带提取主色
    try {
      const url = URL.createObjectURL(res.blob);
      const img = await U.loadImage(url);
      rec.mainColor = safeExtractColor(img);
      URL.revokeObjectURL(url);
    } catch (e) {
      /* ignore */
    }
    await global.Storage.putImage(rec);
    return rec;
  }

  /* ============================================================
     壁纸轮播（v1.1）
     ============================================================ */

  let rotateTimer = null;

  function stopRotation() {
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = null;
    }
  }

  /**
   * 按设置启动预设壁纸轮播；非预设模式或未开启时自动停止
   * @param {object} bg settings.background
   */
  function startRotation(bg) {
    stopRotation();
    if (!bg || !bg.rotate || !bg.rotate.enabled) return;
    if (bg.type !== 'preset') return;

    const minutes = Math.max(1, Number(bg.rotate.minutes) || 5);
    rotateTimer = setInterval(async () => {
      const cur = global.Store.getSettings().background;
      if (!cur.rotate || !cur.rotate.enabled || cur.type !== 'preset') {
        stopRotation();
        return;
      }
      const idx = PRESETS.findIndex((p) => p.id === cur.presetId);
      const next = PRESETS[(idx + 1 + PRESETS.length) % PRESETS.length];
      global.Store.updateBackground({ type: 'preset', presetId: next.id }, 'settings:bg-rotate');
      await apply(global.Store.getSettings().background);
      if (global.Render && global.Render.renderWallpapers) global.Render.renderWallpapers();
    }, minutes * 60 * 1000);
  }

  function isRotating() {
    return !!rotateTimer;
  }

  /* ============================================================
     对外接口
     ============================================================ */

  global.Background = {
    PRESETS,
    GRADIENT_PRESETS,
    COLOR_PRESETS,
    apply,
    compressFile,
    compressUrl,
    extractMainColor,
    saveUploadedImage,
    resolveTheme,
    applyAccent,
    clearAccent,
    startRotation,
    stopRotation,
    isRotating,
    MAX_EDGE,
    MAX_INPUT_BYTES,
  };
})(window);
