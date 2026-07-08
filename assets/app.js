/**
 * AI 破局门户 — 前端逻辑
 * 所有数据均通过 REST API 动态获取，静态页面本身不含业务数据。
 */
(function () {
  'use strict';

  // ============ 常量 ============
  const API_BASE = '/api';
  const THEME_KEY = 'portal-theme';
  const root = document.documentElement;

  // 静态模式：由 static-build 的 HTML 注入 window.PORTAL_STATIC=true 激活。
  // 静态版为只读，数据来自预生成的 /data/*.json，写操作会优雅报错。
  const STATIC_MODE = window.PORTAL_STATIC === true;
  const DATA_BASE = '/data';

  // 把动态 API 路径映射到静态 JSON 文件路径
  function staticPath(apiPath) {
    // 先把 query string 拆出来，避免污染路径分段比对
    const _qIdx = apiPath.indexOf('?');
    const rawQuery = _qIdx >= 0 ? apiPath.slice(_qIdx + 1) : '';
    const p = apiPath.slice(0, _qIdx < 0 ? undefined : _qIdx).replace(/^\//, '');
    const parts = p.split('/');
    const head = parts[0];
    if (head === 'config') {
      if (parts[1] === 'active-group') return `${DATA_BASE}/active-group.json`;
      if (parts[1] === 'providers') return `${DATA_BASE}/providers.json`;
      return `${DATA_BASE}/config.json`;
    }
    if (head === 'groups') {
      if (parts.length === 1) return `${DATA_BASE}/groups.json`;
      const gid = parts[1];
      if (parts.length === 2) return `${DATA_BASE}/groups/${gid}/group.json`;
      const sub = parts[2];
      if (sub === 'members') return `${DATA_BASE}/groups/${gid}/members.json`;
      if (sub === 'summaries') {
        if (parts[3]) return `${DATA_BASE}/groups/${gid}/summaries/${parts[3]}.json`;
        return `${DATA_BASE}/groups/${gid}/summaries.json`;
      }
      if (sub === 'messages') {
        const q = new URLSearchParams(rawQuery);
        const sender = q.get('sender_id');
        const date = q.get('date');
        if (sender) return `${DATA_BASE}/groups/${gid}/messages/by-sender/${sender}.json`;
        if (date) return `${DATA_BASE}/groups/${gid}/messages/by-date/${date}.json`;
        const page = parseInt(q.get('page') || '1', 10) || 1;
        return `${DATA_BASE}/groups/${gid}/messages/page-${page}.json`;
      }
    }
    return null;
  }

  const _urlToken = new URLSearchParams(location.search).get('token');
  if (_urlToken) sessionStorage.setItem('adminToken', _urlToken);

  // ============ 通用工具 ============
  async function fetchAPI(path, options = {}) {
    // ---- 静态模式：只读，从预生成的 /data JSON 读取 ----
    if (STATIC_MODE) {
      if (options.method && String(options.method).toUpperCase() !== 'GET') {
        throw new Error('静态版为只读，此操作需在本地管理端执行');
      }
      const url = staticPath(path);
      if (!url) throw new Error('静态版不支持该接口：' + path);
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(url + sep + 'v=' + (window.PORTAL_STATIC_BUILD || '1'), { cache: 'no-cache' });
      if (!res.ok) throw new Error('静态数据加载失败：' + path);
      return res.json();
    }
    // ---- 动态模式 ----
    const token = sessionStorage.getItem('adminToken');
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['X-Admin-Token'] = token;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: '请求失败' }));
      let msg = error.detail || '请求失败';
      if (res.status === 401) msg = '需要管理员权限：请在网址加 ?token=你的Token';
      throw new Error(msg);
    }
    return res.json();
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // 把微信里的媒体标记（markdown 图片/表情/文件等）转成友好占位，避免直接暴露 URL
  // 支持：
  //   ![动画表情](url)  ![图片](url)  ![xxx](url)
  //   [动画表情] [图片] [视频] [语音] [文件] [位置] [链接] [引用]
  function formatMessageContent(text) {
    if (text == null) return '';
    const iconMap = {
      '动画表情': '🎭', '表情': '🎭', 'sticker': '🎭', 'emoji': '🎭',
      '图片': '📷', 'image': '📷', 'photo': '📷',
      '视频': '🎬', 'video': '🎬',
      '语音': '🎙️', '音频': '🎙️', 'audio': '🎙️', 'voice': '🎙️',
      '文件': '📎', 'file': '📎',
      '位置': '📍', 'location': '📍',
      '链接': '🔗', '分享': '🔗', 'link': '🔗',
      '引用': '💬', 'quote': '💬',
      '红包': '🧧', '转账': '💰',
    };
    function iconFor(label) {
      const key = String(label || '').trim();
      if (iconMap[key]) return iconMap[key];
      for (const k in iconMap) {
        if (key.indexOf(k) !== -1) return iconMap[k];
      }
      return '📦';
    }
    let out = String(text).replace(/!\[([^\]]*)\]\(([^)]*)\)/g, function (_m, label) {
      const l = label && label.trim() ? label.trim() : '媒体';
      return '\u0000MEDIA\u0000' + iconFor(l) + ' [' + l + ']\u0000ENDMEDIA\u0000';
    });
    out = escapeHtml(out);
    out = out.replace(/\u0000MEDIA\u0000([\s\S]*?)\u0000ENDMEDIA\u0000/g, function (_m, inner) {
      return '<span class="msg-media">' + inner + '</span>';
    });
    out = out.replace(/\[(动画表情|表情|图片|视频|语音|音频|文件|位置|链接|分享|引用|红包|转账)\]/g, function (_m, k) {
      return '<span class="msg-media">' + iconFor(k) + ' [' + k + ']</span>';
    });
    return out;
  }

  // 把媒体标记完全剥离（返回纯文字，供同营人卡片使用）
  // 处理：
  //   ![xxx](url)  → 空
  //   [动画表情]/[图片]/[视频]/[语音]/[文件]/[位置]/[链接]/[引用]/[红包]/[转账] → 空
  //   独立 http(s) 链接 → 空（自我介绍里没意义）
  //   连续空行 → 单空行
  function stripMedia(text) {
    if (text == null) return '';
    let s = String(text);
    // markdown 图片语法
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    // 微信原生媒体占位
    s = s.replace(/\[(动画表情|表情|图片|视频|语音|音频|文件|位置|链接|分享|引用|红包|转账)\]/g, '');
    // 单独一行的裸 URL（http/https）—— 自我介绍里出现这种通常是分享链接残留
    s = s.replace(/(^|\n)\s*https?:\/\/\S+\s*(?=\n|$)/g, '$1');
    // 连续空白行合并
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function firstChar(name) {
    if (!name) return '?';
    const zh = name.match(/[\u4e00-\u9fff]/);
    return zh ? zh[0] : name.trim().charAt(0).toUpperCase();
  }

  function paletteIdx(name) {
    let h = 0;
    if (!name) return 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 8;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  // 拉全群列表 + 活跃群设置，返回 { groups, activeGroup, activeGroupId }
  async function loadGroups() {
    const [groupsResp, activeResp] = await Promise.all([
      fetchAPI('/groups'),
      fetchAPI('/config/active-group').catch(() => ({ group_id: null })),
    ]);
    const groups = groupsResp.groups || [];
    let activeId = activeResp.group_id;
    let active = groups.find(g => g.id === activeId);
    if (!active && groups.length) active = groups[0];
    return { groups, activeGroup: active || null, activeGroupId: active ? active.id : null };
  }

  // 解析当前应显示的群：URL ?gid= 优先 > localStorage > activeGroupId（null 时 fallback 到第一群）
  function resolveGroupId(activeId) {
    const up = new URLSearchParams(location.search).get('gid');
    if (up && /^\d+$/.test(up)) return parseInt(up, 10);
    const ls = localStorage.getItem('portal_gid');
    if (ls && /^\d+$/.test(ls)) return parseInt(ls, 10);
    // null/undefined/falsy 时由调用方 fallback 到 groups[0].id
    return activeId && Number.isFinite(activeId) ? activeId : null;
  }

  // 顶部群切换下拉
  function renderGroupSwitcher(mountEl, currentId, groups) {
    if (!mountEl || !groups || !groups.length) return;
    mountEl.innerHTML = ''
      + '<label class="gs-label" title="切换群">'
      +   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
      +   '<select id="groupSelect" class="gs-select">'
      +     groups.map(function (g) {
            const st = g.stats || {};
            const cnt = st.members || g.member_count || 0;
            return '<option value="' + g.id + '"' + (g.id === currentId ? ' selected' : '') + '>'
              + escapeHtml(g.name || ('群' + g.id)) + ' · ' + cnt + '人</option>';
          }).join('')
      +   '</select>'
      + '</label>';
    const sel = mountEl.querySelector('#groupSelect');
    if (sel) sel.addEventListener('change', function () {
      const gid = parseInt(sel.value, 10);
      localStorage.setItem('portal_gid', String(gid));
      const url = new URL(location.href);
      url.searchParams.set('gid', String(gid));
      location.href = url.pathname + url.search;
    });
  }

  // ============ 主题 ============
  function applyTheme(t) {
    const eff = t === 'system'
      ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t;
    root.setAttribute('data-theme', eff);
    document.querySelectorAll('[data-theme-btn]').forEach(btn => {
      const state = btn.querySelector('.theme-state');
      if (state) state.textContent = t === 'system' ? '🌗' : (eff === 'dark' ? '🌙' : '☀️');
      btn.setAttribute('title', `主题：${t}（点击切换）`);
    });
  }

  function cycleTheme() {
    const cur = localStorage.getItem(THEME_KEY) || 'system';
    const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  applyTheme(localStorage.getItem(THEME_KEY) || 'system');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'system') === 'system') applyTheme('system');
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-theme-btn]')) cycleTheme();
  });

  // ============ Reveal on scroll ============
  function initReveal() {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });
    document.querySelectorAll('.reveal:not(.in)').forEach(el => io.observe(el));
  }
  requestAnimationFrame(initReveal);

  // 暴露到全局
  window.__PORTAL = { fetchAPI, showToast, escapeHtml, formatMessageContent, stripMedia, debounce, firstChar, paletteIdx, initReveal, todayISO, loadGroups, resolveGroupId, renderGroupSwitcher, STATIC_MODE };
})();

// ============================================================
// 首页
// ============================================================
(function () {
  if (document.body.dataset.page !== 'home') return;
  const P = window.__PORTAL;

  async function init() {
    const statusEl = document.getElementById('homeStatus');
    try {
      const { groups, activeGroup } = await P.loadGroups();
      if (!groups.length || !activeGroup) {
        statusEl.innerHTML = `
          <section class="section"><div class="section-inner">
            <div class="empty-state">
              <div class="icon">🛟</div>
              <h2>还没有群组数据</h2>
              <p>请先在设置页配置 AI，然后用 scripts/collect_from_chatlog.py 采集群消息。</p>
              <a href="./settings.html" class="btn btn-primary">前往设置</a>
            </div>
          </div></section>`;
        return;
      }

      const currentGroupId = P.resolveGroupId(activeGroup.id);
      const group = groups.find(g => g.id === currentGroupId) || activeGroup;
      P.renderGroupSwitcher(document.getElementById('groupSwitcher'), currentGroupId, groups);
      const brand = document.getElementById('brandGroupName');
      if (brand) brand.textContent = group.name || 'AI破局门户';

      const [detail, membersResp, summariesResp] = await Promise.all([
        P.fetchAPI(`/groups/${group.id}`),
        P.fetchAPI(`/groups/${group.id}/members?limit=500`),
        P.fetchAPI(`/groups/${group.id}/summaries?limit=5`),
      ]);

      const stats = detail.stats || {};
      const totalMsg = stats.messages || 0;
      const totalCrew = stats.members || group.member_count || 0;
      const totalDigest = stats.summaries || 0;

      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('metaMsg', totalMsg.toLocaleString());
      set('metaMember', totalCrew.toLocaleString());
      set('metaDigest', totalDigest.toLocaleString());
      set('heroBigMsg', totalMsg.toLocaleString());
      set('heroEyebrow', `群名：${group.name || '未知'} · 实时同步`);

      // --- 进度条：按「今天距开营的第几天 / 营期总天数」计算 ---
      const fill = document.getElementById('progressFill');
      const duration = parseInt(detail.duration_days, 10) || 30;
      const startDate = detail.start_date;       // YYYY-MM-DD 或 null
      if (startDate) {
        const start = new Date(startDate + 'T00:00:00');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dayMs = 86400000;
        const elapsed = Math.floor((today - start) / dayMs);  // 开营当天 = 0
        set('progressMid', `第 ${Math.round(duration / 2)} 天`);
        if (elapsed < 0) {
          // 未开营：显示倒计时
          const daysUntil = Math.abs(elapsed);
          set('progressDay', `距开营 ${daysUntil} 天`);
          set('progressCrew', ` / 共 ${duration} 天`);
          set('progressStatus', `● 还有 ${daysUntil} 天开营`);
          if (fill) setTimeout(() => (fill.style.width = '2%'), 250);
        } else {
          const dayNumber = Math.min(elapsed + 1, duration);    // 第几天（从 1 起）
          const pct = Math.max(4, Math.min(100, (dayNumber / duration) * 100));
          set('progressDay', `第 ${dayNumber} 天`);
          set('progressCrew', ` / 共 ${duration} 天`);
          if (dayNumber > duration) {
            set('progressStatus', `已结营`);
          } else {
            set('progressStatus', `进行中 · 第 ${dayNumber}/${duration} 天`);
          }
          if (fill) setTimeout(() => (fill.style.width = pct.toFixed(1) + '%'), 250);
        }
      } else {
        // 未设置开营日期：优雅降级
        set('progressDay', '待设定');
        set('progressCrew', ` / 共 ${duration} 天`);
        set('progressMid', `第 ${Math.round(duration / 2)} 天`);
        set('progressStatus', '待在设置页填写开营日期');
        if (fill) setTimeout(() => (fill.style.width = '6%'), 250);
      }

      // 能力标签聚合
      const members = membersResp.members || [];
      const tagMap = new Map();
      members.forEach(m => {
        const tags = (m.intro && m.intro.tags) || [];
        tags.forEach(t => {
          if (!t) return;
          const arr = tagMap.get(t) || [];
          arr.push(m.display_name || m.nickname || '');
          tagMap.set(t, arr);
        });
      });
      const tagArr = [...tagMap.entries()]
        .map(([key, names]) => ({ key, count: names.length, samples: names.slice(0, 5) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);

      const tagsSec = document.getElementById('tagsSection');
      if (tagArr.length > 0) {
        tagsSec.hidden = false;
        document.getElementById('tagsCount').textContent = `共 ${tagArr.length} 个能力标签 / ${members.length} 位同营人`;
        const grid = document.getElementById('tagsGrid');
        grid.innerHTML = tagArr.map((t, i) => `
          <a href="./members.html?tag=${encodeURIComponent(t.key)}" class="tag-card reveal d${(i % 4) + 1}">
            <div class="tag-head">
              <div class="tag-name">${P.escapeHtml(t.key)}</div>
              <div class="tag-count">${t.count}</div>
            </div>
            <div class="tag-samples">${t.samples.map(P.escapeHtml).join('、') || '暂无样例'}</div>
            <div class="tag-cta"><span>点击进入名册筛选</span><span class="arrow">→</span></div>
          </a>`).join('');
      }

      // 最近精华
      const summaries = summariesResp.summaries || [];
      const digestSec = document.getElementById('digestSection');
      digestSec.hidden = false;
      if (summaries.length > 0) {
        const latest = summaries[0];
        const content = latest.content || {};
        set('dpDate', latest.date);
        set('dpTitle', content.title || '每日精华');
        set('dpBadge', latest.date === P.todayISO() ? '今日精华' : '最近一日');
        const bullets = document.getElementById('dpBullets');
        const keyPoints = content.key_points || [];
        const items = keyPoints.length > 0
          ? keyPoints.slice(0, 5)
          : (content.sections || []).flatMap(s => (s.rules || []).slice(0, 2)).slice(0, 5);
        bullets.innerHTML = items.map(x => `<li>${P.escapeHtml(x)}</li>`).join('');
        const summaryLine = (content.sections && content.sections[0] && content.sections[0].intro)
          || (keyPoints.length > 0 ? keyPoints[0] : `AI 已为 ${latest.message_count || 0} 条消息生成精华。`);
        set('dpSummary', summaryLine);
        const more = document.getElementById('dpMore');
        if (more) more.href = `./daily.html?date=${encodeURIComponent(latest.date)}`;
      } else {
        set('dpDate', '尚未生成');
        set('dpTitle', '还没有每日精华');
        set('dpBadge', '待生成');
        set('dpSummary', '当群内有消息之后，可以在每日精华页点击「生成今日精华」。');
        document.getElementById('dpBullets').innerHTML = '';
      }

      requestAnimationFrame(P.initReveal);
    } catch (error) {
      statusEl.innerHTML = `
        <section class="section"><div class="section-inner">
          <div class="empty-state">
            <div class="icon">⚠️</div>
            <h2>加载失败</h2><p>${P.escapeHtml(error.message)}</p>
            <p>请确认后端服务正在运行 (uvicorn backend.main:app --port 8000)。</p>
          </div>
        </div></section>`;
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();

// ============================================================
// 同营人名册
// ============================================================
(function () {
  if (document.body.dataset.page !== 'members') return;
  const P = window.__PORTAL;

  let allMembers = [];
  let allTags = [];
  let activeTag = new URLSearchParams(location.search).get('tag') || '';
  let currentGroupId = null;

  function memberSearchStr(m) {
    const intro = sanitizeIntro(m.intro);
    return (
      (m.display_name || '') + ' ' + (m.nickname || '') + ' ' +
      (intro.location || '') + ' ' + (intro.intro || '') + ' ' +
      (intro.offer || '') + ' ' + (intro.seek || '') + ' ' + (intro.goal || '') + ' ' + (intro.words || '') + ' ' +
      ((intro.tags || []).join(' '))
    ).toLowerCase();
  }

  function formatLines(text) {
    // 同营人卡片里绝不展示媒体占位——直接剥离所有 markdown 图片 / 表情 / 视频 / 位置 / 链接等标记
    const stripped = P.stripMedia(text);
    if (!stripped) return '';
    return P.escapeHtml(stripped).split('\n').filter(s => s.trim()).map(s => '<p>' + s + '</p>').join('');
  }

  // 把 intro 各字段中的媒体标记先剥离，返回一个"净化过"的副本。
  // 剥完就没内容的字段会置空，避免卡片里出现空区块或只剩链接的段落。
  function sanitizeIntro(intro) {
    if (!intro) return {};
    const out = Object.assign({}, intro);
    ['intro', 'offer', 'seek', 'goal', 'words', 'punchline', 'location', 'company'].forEach(function (k) {
      if (out[k] != null) {
        const s = P.stripMedia(String(out[k]));
        out[k] = s || '';
      }
    });
    // punchline 如果剥完就空、或原本引用的是同一个 words，也一并清掉
    if (!out.punchline || out.punchline === out.words) out.punchline = out.punchline || '';
    return out;
  }

  function memberCard(m) {
    const p = P.paletteIdx(m.display_name || m.nickname);
    const intro = sanitizeIntro(m.intro);
    const tags = intro.tags || [];
    const avatarInner = m.avatar
      ? '<img src="' + P.escapeHtml(m.avatar) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:14px">'
      : P.escapeHtml(P.firstChar(m.display_name || m.nickname));
    let parts = [];
    parts.push('<div class="member-card reveal" data-tags="' + tags.map(P.escapeHtml).join('|') + '" data-search="' + P.escapeHtml(memberSearchStr(m)) + '" data-mid="' + m.id + '">');
    parts.push('<div class="mc-head"><div class="avatar p' + p + '">' + avatarInner + '</div>');
    parts.push('<div><div class="mc-name">' + P.escapeHtml(m.display_name || m.nickname || '无名') + '</div>');
    if (intro.location) parts.push('<div class="mc-city"><span class="dot"></span>' + P.escapeHtml(intro.location) + '</div>');
    parts.push('</div></div>');
    if (tags.length) parts.push('<div class="mc-tags">' + tags.slice(0, 6).map(t => '<span class="mc-tag">' + P.escapeHtml(t) + '</span>').join('') + '</div>');

    if (intro.intro) {
      parts.push('<div class="mc-section"><div class="mc-sec-title">介绍</div><div class="mc-sec-body">' + formatLines(intro.intro) + '</div></div>');
    }
    if (intro.offer) {
      parts.push('<div class="mc-section"><div class="mc-sec-title">能提供</div><div class="mc-sec-body">' + formatLines(intro.offer) + '</div></div>');
    }
    if (intro.seek) {
      parts.push('<div class="mc-section"><div class="mc-sec-title">在寻求</div><div class="mc-sec-body">' + formatLines(intro.seek) + '</div></div>');
    }

    parts.push('<div class="mc-foot">');
    parts.push('<span>' + (m.message_count || 0) + ' 条发言</span>');
    parts.push('<button type="button" class="mc-more" data-mid="' + m.id + '">点开看完整介绍 →</button>');
    parts.push('</div></div>');
    return parts.join('');
  }

  function renderModal(member) {
    const intro = sanitizeIntro(member.intro);
    const p = P.paletteIdx(member.display_name || member.nickname);
    const avatarInner = member.avatar
      ? '<img src="' + P.escapeHtml(member.avatar) + '" alt="">'
      : P.escapeHtml(P.firstChar(member.display_name || member.nickname));
    let sections = [];
    if (intro.intro) sections.push('<div class="im-section"><div class="im-sec-title">介绍</div><div class="im-sec-body">' + formatLines(intro.intro) + '</div></div>');
    if (intro.goal) sections.push('<div class="im-section"><div class="im-sec-title">目标</div><div class="im-sec-body">' + formatLines(intro.goal) + '</div></div>');
    if (intro.offer) sections.push('<div class="im-section"><div class="im-sec-title">能提供</div><div class="im-sec-body">' + formatLines(intro.offer) + '</div></div>');
    if (intro.seek) sections.push('<div class="im-section"><div class="im-sec-title">在寻求</div><div class="im-sec-body">' + formatLines(intro.seek) + '</div></div>');
    if (intro.words) sections.push('<div class="im-section"><div class="im-sec-title">想和大家说的话</div><div class="im-sec-body">' + formatLines(intro.words) + '</div></div>');
    if (intro.punchline && intro.punchline !== intro.words) sections.push('<div class="im-quote">“' + P.escapeHtml(intro.punchline) + '”</div>');
    return ''
      + '<div class="im-head">'
      +   '<div class="im-avatar p' + p + '">' + avatarInner + '</div>'
      +   '<div class="im-info">'
      +     '<div class="im-name">' + P.escapeHtml(member.display_name || member.nickname || '无名') + '</div>'
      +     (intro.location ? '<div class="im-city"><span class="dot"></span>' + P.escapeHtml(intro.location) + '</div>' : '')
      +   '</div>'
      + '</div>'
      + (intro.tags && intro.tags.length ? '<div class="im-tags">' + intro.tags.slice(0, 10).map(t => '<span class="im-tag">' + P.escapeHtml(t) + '</span>').join('') + '</div>' : '')
      + '<div class="im-content">' + sections.join('') + '</div>';
  }

  function openModal(member) {
    const modal = document.getElementById('introModal');
    const body = document.getElementById('introModalBody');
    body.innerHTML = renderModal(member);
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const modal = document.getElementById('introModal');
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function renderChips() {
    const el = document.getElementById('tagChips');
    let html = '<button class="chip ' + (!activeTag ? 'active' : '') + '" data-tag=""><span>全部</span><span class="n">' + allMembers.length + '</span></button>';
    allTags.slice(0, 20).forEach(t => {
      html += '<button class="chip ' + (activeTag === t.key ? 'active' : '') + '" data-tag="' + P.escapeHtml(t.key) + '">'
           + '<span>' + P.escapeHtml(t.key) + '</span><span class="n">' + t.count + '</span></button>';
    });
    el.innerHTML = html;
  }

  function applyFilter() {
    const q = (document.getElementById('searchInput').value || '').toLowerCase().trim();
    const cards = document.querySelectorAll('#membersGrid .member-card');
    let n = 0;
    cards.forEach(c => {
      const tags = (c.dataset.tags || '').split('|');
      const search = c.dataset.search || '';
      const okTag = !activeTag || tags.includes(activeTag);
      const okQ = !q || search.includes(q);
      const show = okTag && okQ;
      c.style.display = show ? '' : 'none';
      if (show) n++;
    });
    document.getElementById('filterCount').innerHTML =
      '共 <strong>' + n + '</strong> 位同营人' + (activeTag ? '，标签：<strong>' + P.escapeHtml(activeTag) + '</strong>' : '');
    document.getElementById('mCount').textContent = n;
    const grid = document.getElementById('membersGrid');
    const existing = grid.querySelector('.empty-state.dyn');
    if (n === 0 && !existing) {
      const em = document.createElement('div');
      em.className = 'empty-state dyn';
      em.style.columnSpan = 'all';
      em.style.width = '100%';
      em.innerHTML = '<div class="icon">🔍</div><h3>没有匹配的同营人</h3><p>换个关键词或切到「全部」标签。</p>';
      grid.appendChild(em);
    } else if (n > 0 && existing) {
      existing.remove();
    }
  }

  function hasIntro(m) {
    if (!m || !m.intro) return false;
    const intro = sanitizeIntro(m.intro);
    // 至少有一项净化后仍非空的结构化字段才算有效
    return !!(intro.intro || intro.offer || intro.seek || intro.goal || intro.words || (intro.tags && intro.tags.length));
  }

  async function refreshMembers() {
    const grid = document.getElementById('membersGrid');
    const { members } = await P.fetchAPI('/groups/' + currentGroupId + '/members?limit=500');
    const raw = members || [];
    // 只保留有自我介绍数据的成员
    allMembers = raw.filter(hasIntro);
    allTags = (function () {
      const map = new Map();
      allMembers.forEach(m => ((m.intro && m.intro.tags) || []).forEach(t => { if (t) map.set(t, (map.get(t) || 0) + 1); }));
      return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
    })();
    if (!allMembers.length) {
      const totalHint = raw.length
        ? '<p>群里已有 ' + raw.length + ' 位成员，但都还没有解析出自我介绍。</p>'
        : '<p>请先在设置页采集一些群消息。</p>';
      grid.innerHTML = '<div class="empty-state" style="column-span:all;width:100%"><div class="icon">👥</div><h3>还没有可展示的名片</h3>' + totalHint + '</div>';
    } else {
      grid.innerHTML = allMembers.map(memberCard).join('');
    }
    renderChips();
    applyFilter();
    requestAnimationFrame(P.initReveal);
  }

  async function init() {
    const grid = document.getElementById('membersGrid');
    try {
      const { groups, activeGroupId, activeGroup } = await P.loadGroups();
      if (!groups.length || !activeGroupId) {
        grid.innerHTML = '<div class="empty-state" style="column-span:all;width:100%"><div class="icon">🛟</div><h3>暂无群组数据</h3><p>请先在设置页配置 AI 并采集群消息。</p></div>';
        return;
      }
      const brand = document.getElementById('brandGroupName');
      if (brand && activeGroup) brand.textContent = activeGroup.name || 'AI破局门户';
      const heroGroup = document.getElementById('memberGroupName');
      if (heroGroup && activeGroup) heroGroup.textContent = '📌 ' + (activeGroup.name || '未知群');
      currentGroupId = P.resolveGroupId(activeGroupId);
      P.renderGroupSwitcher(document.getElementById('groupSwitcher'), currentGroupId, groups);
      await refreshMembers();

      document.getElementById('tagChips').addEventListener('click', e => {
        const b = e.target.closest('.chip');
        if (!b) return;
        activeTag = b.dataset.tag || '';
        renderChips();
        applyFilter();
        const url = new URL(location.href);
        if (activeTag) url.searchParams.set('tag', activeTag); else url.searchParams.delete('tag');
        history.replaceState(null, '', url);
        window.scrollTo({ top: 220, behavior: 'smooth' });
      });
      document.getElementById('searchInput').addEventListener('input', P.debounce(applyFilter, 200));

      // 提取 / 查看完整介绍
      grid.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-mid]');
        if (!btn) return;
        const mid = Number(btn.dataset.mid);
        const member = allMembers.find(m => m.id === mid);
        if (!member) return;
        if (btn.classList.contains('mc-more')) {
          openModal(member);
          return;
        }
        try {
          btn.disabled = true;
          P.showToast('正在提取，请稍候…');
          await P.fetchAPI('/groups/' + currentGroupId + '/members/' + mid + '/extract-intro', { method: 'POST' });
          P.showToast('提取成功！');
          await refreshMembers();
        } catch (err) {
          P.showToast(err.message, 'error');
        } finally {
          btn.disabled = false;
        }
      });

      // 批量提取功能已移除（静态版不需要）

      // 弹窗关闭
      document.getElementById('introModal')?.addEventListener('click', function (e) {
        if (e.target.classList.contains('modal-backdrop') || e.target.closest('.modal-close')) {
          closeModal();
        }
      });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    } catch (err) {
      grid.innerHTML = '<div class="empty-state" style="column-span:all;width:100%"><div class="icon">⚠️</div><h3>加载失败</h3><p>' + P.escapeHtml(err.message) + '</p></div>';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
// ============================================================
// 每日精华
// ============================================================
(function () {
  if (document.body.dataset.page !== 'daily') return;
  const P = window.__PORTAL;
  let currentGroupId = null;
  let allSummaries = [];

  function renderDayHeader(summary) {
    const content = summary.content || {};
    const stats = [
      { k: '总消息数', v: summary.message_count || 0 },
      { k: '关键要点', v: (content.key_points || []).length },
      { k: '活跃成员', v: (content.active_members || []).length },
      { k: '讨论话题', v: (content.topics || []).length },
    ];
    return ''
      + '<div class="daily-header-row reveal">'
      +   '<div class="date-pill">'
      +     '<span class="date-num">' + P.escapeHtml(summary.date) + '</span>'
      +     '<span class="date-phase">' + P.escapeHtml(content.title || '群聊精华') + '</span>'
      +   '</div>'
      + '</div>'
      + '<div class="daily-stats">'
      +   stats.map(function (s) {
        return '<div class="daily-stat"><div class="ds-k">' + s.k + '</div><div class="ds-v">' + s.v + '</div></div>';
      }).join('')
      + '</div>';
  }

  function renderPeopleCards(people) {
    return '<div class="picks">' + people.map(function (p) {
      return ''
        + '<div class="pick">'
        +   '<div class="head"><div class="name">' + P.escapeHtml(p.name || '') + '</div><div class="city">' + P.escapeHtml(p.city || '') + '</div></div>'
        +   (p.what ? '<div class="desc">' + P.escapeHtml(p.what) + '</div>' : '')
        +   (p.seek ? '<div class="want">' + P.escapeHtml(p.seek) + '</div>' : '')
        + '</div>';
    }).join('') + '</div>';
  }

  function renderSection(section, idx) {
    const kind = (section.kind || 'rules').toLowerCase();
    let inner = '';
    if (section.intro) inner += '<p style="color:var(--ink-3);margin:0 0 14px;line-height:1.85">' + P.escapeHtml(section.intro) + '</p>';

    if (kind === 'rules' && section.rules && section.rules.length) {
      inner += '<ul>' + section.rules.map(function (r) { return '<li>' + P.escapeHtml(r) + '</li>'; }).join('') + '</ul>';
    }
    if (kind === 'quote' && section.quote) {
      inner += '<div class="quote-in">' + P.escapeHtml(section.quote) + (section.by ? '<div style="margin-top:8px;font-size:12px;color:var(--mute);font-style:normal">— ' + P.escapeHtml(section.by) + '</div>' : '') + '</div>';
    }
    if ((kind === 'spotlight' || kind === 'team') && section.people && section.people.length) {
      inner += renderPeopleCards(section.people);
    }
    if (kind === 'announcement') {
      if (section.rules && section.rules.length) inner += '<ul>' + section.rules.map(function (r) { return '<li>' + P.escapeHtml(r) + '</li>'; }).join('') + '</ul>';
      if (section.quote) inner += '<div class="quote-in">' + P.escapeHtml(section.quote) + '</div>';
    }
    // 兼容其它字段：rules 也可能出现在非 rules kind 下
    if (kind !== 'rules' && kind !== 'announcement' && section.rules && section.rules.length) {
      inner += '<ul>' + section.rules.map(function (r) { return '<li>' + P.escapeHtml(r) + '</li>'; }).join('') + '</ul>';
    }

    return ''
      + '<div class="tl-item reveal">'
      +   '<div class="tl-idx">' + String(idx + 1).padStart(2, '0') + '</div>'
      +   '<div class="tl-body">'
      +     '<h3>' + P.escapeHtml(section.title || '板块') + '</h3>'
      +     (section.by ? '<div class="by">' + P.escapeHtml(section.by) + '</div>' : '')
      +     inner
      +   '</div>'
      + '</div>';
  }

  async function renderDay(date) {
    const container = document.getElementById('dayContent');
    container.innerHTML = '<div class="loading">正在读取 ' + P.escapeHtml(date) + ' 的精华…</div>';
    try {
      const summary = await P.fetchAPI('/groups/' + currentGroupId + '/summaries/' + encodeURIComponent(date));
      const content = summary.content || {};
      const sections = content.sections || [];
      let html = renderDayHeader(summary);

      // 今日导读：取第一条摘要或首条 keyPoint 作为导读
      const leadText = (content.sections && content.sections[0] && content.sections[0].intro)
        || (content.key_points && content.key_points.length ? content.key_points.slice(0, 3).join('；') : '')
        || ('AI 已为当日 ' + (summary.message_count || 0) + ' 条消息生成精华。');
      if (leadText) {
        html += '<div class="digest-lead reveal"><div class="dl-title">今日导读</div><p class="dl-body">' + P.escapeHtml(leadText) + '</p></div>';
      }

      // 时间线板块
      if (sections.length === 0) {
        html += '<div class="empty-state" style="margin-top:24px"><div class="icon">📭</div><h3>当日没有解析出板块</h3><p>可以点击「重新生成」再试。</p></div>';
      } else {
        html += '<div class="timeline">' + sections.map(renderSection).join('') + '</div>';
      }

      // 静态模式不显示"重新生成"按钮
      if (!P.STATIC_MODE) {
        html += '<div style="text-align:center;margin-top:36px"><button class="btn btn-secondary" id="regenBtn" data-date="' + P.escapeHtml(date) + '">🔄 重新生成本日精华</button></div>';
      }
      container.innerHTML = html;
      requestAnimationFrame(P.initReveal);

      // 绑定重新生成（仅动态模式有此按钮）
      const regenBtn = document.getElementById('regenBtn');
      if (regenBtn) {
        regenBtn.addEventListener('click', async function () {
          try {
            this.disabled = true;
            P.showToast('正在重新生成…');
            await P.fetchAPI('/groups/' + currentGroupId + '/summaries/' + encodeURIComponent(date) + '/generate', { method: 'POST' });
            P.showToast('生成成功！');
            renderDay(date);
          } catch (err) { P.showToast(err.message, 'error'); this.disabled = false; }
        });
      }
    } catch (err) {
      container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>加载失败</h3><p>' + P.escapeHtml(err.message) + '</p></div>';
    }
  }

  async function generateToday() {
    try {
      P.showToast('正在生成今日精华，请稍候…');
      const today = P.todayISO();
      await P.fetchAPI('/groups/' + currentGroupId + '/summaries/' + today + '/generate', { method: 'POST' });
      P.showToast('生成成功！');
      init();
    } catch (err) { P.showToast(err.message, 'error'); }
  }

  async function init() {
    const tabsBox = document.getElementById('dayTabs');
    const content = document.getElementById('dayContent');
    try {
      const { groups, activeGroupId, activeGroup } = await P.loadGroups();
      if (!groups.length || !activeGroupId) {
        tabsBox.innerHTML = '';
        content.innerHTML = '<div class="empty-state"><div class="icon">🛟</div><h3>暂无群组数据</h3><p>请先采集群消息。</p></div>';
        return;
      }
      currentGroupId = P.resolveGroupId(activeGroupId);
      const group = groups.find(g => g.id === currentGroupId) || activeGroup;
      P.renderGroupSwitcher(document.getElementById('groupSwitcher'), currentGroupId, groups);
      const brand = document.getElementById('brandGroupName');
      if (brand) brand.textContent = group.name || 'AI破局门户';
      const { summaries } = await P.fetchAPI('/groups/' + currentGroupId + '/summaries?limit=60');
      allSummaries = summaries || [];
      if (allSummaries.length === 0) {
        tabsBox.innerHTML = '';
        content.innerHTML = ''
          + '<div class="empty-state">'
          + '<div class="icon">📅</div><h3>还没有每日精华</h3>'
          + '<p>开营后群内产生消息时，将自动生成每日精华。</p>'
          + (!P.STATIC_MODE ? '<button class="btn btn-primary" id="genTodayBtn">✨ 生成今日精华</button>' : '')
          + '</div>';
        const genBtn = document.getElementById('genTodayBtn');
        if (genBtn) genBtn.addEventListener('click', generateToday);
        return;
      }

      // 优先选 URL ?date=
      const wanted = new URLSearchParams(location.search).get('date');
      const selectDate = (wanted && allSummaries.some(s => s.date === wanted)) ? wanted : allSummaries[0].date;

      tabsBox.innerHTML = allSummaries.map(function (s) {
        return '<button class="day-tab' + (s.date === selectDate ? ' active' : '') + '" data-date="' + P.escapeHtml(s.date) + '">' + P.escapeHtml(s.date) + '</button>';
      }).join('');
      tabsBox.addEventListener('click', function (e) {
        const btn = e.target.closest('.day-tab');
        if (!btn) return;
        tabsBox.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        const url = new URL(location.href);
        url.searchParams.set('date', btn.dataset.date);
        history.replaceState(null, '', url);
        renderDay(btn.dataset.date);
      });

      renderDay(selectDate);
    } catch (err) {
      content.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>加载失败</h3><p>' + P.escapeHtml(err.message) + '</p></div>';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();

// ============================================================
// 消息浏览
// ============================================================
(function () {
  if (document.body.dataset.page !== 'messages') return;
  const P = window.__PORTAL;
  let groupId = null;
  let page = 1;
  const pageSize = 50;

  async function load() {
    const list = document.getElementById('messagesList');
    const pagBox = document.getElementById('pagination');
    list.innerHTML = '<div class="loading">正在读取消息…</div>';
    const params = new URLSearchParams({ page: page, page_size: pageSize });
    const dateVal = document.getElementById('dateFilter').value;
    const senderVal = document.getElementById('senderFilter').value;
    if (dateVal) params.set('date', dateVal);
    if (senderVal) params.set('sender_id', senderVal);
    try {
      const data = await P.fetchAPI('/groups/' + groupId + '/messages?' + params);
      if (!data.messages || data.total === 0) {
        list.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h3>暂无消息</h3></div>';
        pagBox.innerHTML = '';
        return;
      }
      // 静态模式下，按日期/成员筛选返回的是整个集合（messages.length === total），需客户端分页
      let view = data.messages;
      if (data.messages.length === data.total && data.total > pageSize) {
        const start = (page - 1) * pageSize;
        view = data.messages.slice(start, start + pageSize);
      }
      if (view.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h3>暂无消息</h3></div>';
        pagBox.innerHTML = '';
        return;
      }
      list.innerHTML = view.map(function (m) {
        return '<div class="msg-row">'
          + '<div class="msg-head"><span class="msg-sender">' + P.escapeHtml(m.sender || '未知') + '</span><span class="msg-time">' + P.escapeHtml(m.time) + '</span></div>'
          + '<div class="msg-body">' + P.formatMessageContent(m.content) + '</div>'
          + '</div>';
      }).join('');
      const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
      pagBox.innerHTML =
        '<button class="btn btn-secondary" ' + (page <= 1 ? 'disabled' : '') + ' data-go="' + (page - 1) + '">上一页</button>'
        + '<span>第 ' + page + ' / ' + totalPages + ' 页 · 共 ' + data.total + ' 条</span>'
        + '<button class="btn btn-secondary" ' + (page >= totalPages ? 'disabled' : '') + ' data-go="' + (page + 1) + '">下一页</button>';
      pagBox.querySelectorAll('button[data-go]').forEach(function (b) {
        b.addEventListener('click', function () {
          page = parseInt(b.dataset.go, 10);
          load();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (err) {
      list.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>加载失败</h3><p>' + P.escapeHtml(err.message) + '</p></div>';
      pagBox.innerHTML = '';
    }
  }

  async function init() {
    const list = document.getElementById('messagesList');
    try {
      const { groups, activeGroupId, activeGroup } = await P.loadGroups();
      if (!groups.length || !activeGroupId) {
        list.innerHTML = '<div class="empty-state"><div class="icon">🛟</div><h3>暂无群组数据</h3></div>';
        return;
      }
      const groupId2 = P.resolveGroupId(activeGroupId);
      const group = groups.find(g => g.id === groupId2) || activeGroup;
      P.renderGroupSwitcher(document.getElementById('groupSwitcher'), groupId2, groups);
      const brand = document.getElementById('brandGroupName');
      if (brand) brand.textContent = group.name || 'AI破局门户';
      groupId = groupId2;
      const { members } = await P.fetchAPI('/groups/' + groupId + '/members?limit=500');
      const sel = document.getElementById('senderFilter');
      sel.innerHTML = '<option value="">全部成员</option>'
        + (members || []).map(function (m) { return '<option value="' + m.id + '">' + P.escapeHtml(m.display_name || m.nickname) + '</option>'; }).join('');
      document.getElementById('applyFilter').addEventListener('click', function () { page = 1; load(); });
      document.getElementById('clearFilter').addEventListener('click', function () {
        document.getElementById('dateFilter').value = '';
        document.getElementById('senderFilter').value = '';
        page = 1;
        load();
      });
      await load();
    } catch (err) {
      list.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>加载失败</h3><p>' + P.escapeHtml(err.message) + '</p></div>';
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();

// ============================================================
// 设置页
// ============================================================
(function () {
  if (document.body.dataset.page !== 'settings') return;
  const P = window.__PORTAL;

  async function renderGroupsCard() {
    const box = document.getElementById('groupsList');
    if (!box) return;
    box.innerHTML = '<div class="loading">正在加载群列表…</div>';
    try {
      const { groups, activeGroupId } = await P.loadGroups();
      if (!groups.length) {
        box.innerHTML = ''
          + '<div class="empty-state" style="padding:36px 20px">'
          + '<div class="icon">📭</div><h3>还没有任何群数据</h3>'
          + '<p>用 <code class="inline">scripts/collect_from_chatlog.py --group "群名"</code> 采集一次，群就会出现在这里。</p>'
          + '</div>';
        return;
      }
      box.innerHTML = groups.map(function (g) {
        const st = g.stats || {};
        const isActive = g.id === activeGroupId;
        return ''
          + '<div class="group-item' + (isActive ? ' active' : '') + '" data-gid="' + g.id + '">'
          +   '<div class="gi-main">'
          +     '<div class="gi-radio">' + (isActive ? '●' : '○') + '</div>'
          +     '<div class="gi-info">'
          +       '<div class="gi-name">' + P.escapeHtml(g.name || '未命名群') + (isActive ? ' <span class="gi-tag">当前统计</span>' : '') + '</div>'
          +       '<div class="gi-meta">'
          +         '<span>' + (st.messages || 0).toLocaleString() + ' 条消息</span>'
          +         '<span>·</span><span>' + (st.members || g.member_count || 0) + ' 位成员</span>'
          +         '<span>·</span><span>' + (st.summaries || 0) + ' 篇精华</span>'
          +       '</div>'
          +       '<div class="gi-cid">' + P.escapeHtml(g.chatroom_id || '') + '</div>'
          +     '</div>'
          +   '</div>'
          +   '<div class="gi-actions">'
          +     (isActive
                ? '<span class="btn btn-secondary" style="opacity:.5;pointer-events:none;padding:6px 14px;font-size:13px;width:auto">已选中</span>'
                : '<button type="button" class="btn btn-primary gi-select" style="padding:6px 14px;font-size:13px;width:auto">设为统计群</button>')
          +     '<button type="button" class="btn btn-secondary gi-delete" style="padding:6px 14px;font-size:13px;width:auto;color:var(--danger,#c94b3b)" title="删除此群及全部数据">删除</button>'
          +   '</div>'
          + '</div>';
      }).join('');

      box.querySelectorAll('.gi-select').forEach(function (b) {
        b.addEventListener('click', async function () {
          const gid = parseInt(b.closest('.group-item').dataset.gid, 10);
          try {
            b.disabled = true;
            await P.fetchAPI('/config/active-group', {
              method: 'POST',
              body: JSON.stringify({ group_id: gid }),
            });
            P.showToast('已切换到新的统计群！');
            await renderGroupsCard();
          } catch (err) { P.showToast(err.message, 'error'); b.disabled = false; }
        });
      });
      box.querySelectorAll('.gi-delete').forEach(function (b) {
        b.addEventListener('click', async function () {
          const item = b.closest('.group-item');
          const gid = parseInt(item.dataset.gid, 10);
          const name = item.querySelector('.gi-name').textContent.trim();
          if (!confirm('确定删除「' + name + '」及其全部消息/成员/精华？此操作不可撤销。')) return;
          try {
            b.disabled = true;
            await P.fetchAPI('/groups/' + gid, { method: 'DELETE' });
            P.showToast('已删除');
            await renderGroupsCard();
          } catch (err) { P.showToast(err.message, 'error'); b.disabled = false; }
        });
      });
    } catch (err) {
      box.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">⚠️</div><h3>加载失败</h3><p>' + P.escapeHtml(err.message) + '</p></div>';
    }
  }

  // === 从微信导入群 ===
  let _chatlogGroups = [];
  async function loadChatlogGroups() {
    const box = document.getElementById('chatlogGroupsBox');
    const list = document.getElementById('chatlogGroupsList');
    const btn = document.getElementById('loadChatlogBtn');
    if (!box || !list) return;
    btn.disabled = true;
    btn.textContent = '加载中…';
    list.innerHTML = '<div class="loading">正在从微信拉取群列表…</div>';
    box.style.display = 'block';
    try {
      const data = await P.fetchAPI('/chatlog/groups');
      _chatlogGroups = data.groups || [];
      renderChatlogList('');
    } catch (err) {
      list.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">⚠️</div><h3>加载失败</h3>'
        + '<p>' + P.escapeHtml(err.message) + '</p>'
        + '<p style="font-size:13px;color:var(--mute)">请确认 chatlog 服务已启动（终端运行 <code class="inline">chatlog server</code>）</p></div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '查看可用群';
    }
  }

  function renderChatlogList(query) {
    const list = document.getElementById('chatlogGroupsList');
    if (!list) return;
    let items = _chatlogGroups;
    if (query) {
      const q = query.toLowerCase();
      items = items.filter(g => (g.name || '').toLowerCase().includes(q) || (g.chatroom_id || '').includes(q));
    }
    if (!items.length) {
      list.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">🔍</div><h3>没有匹配的群</h3></div>';
      return;
    }
    list.innerHTML = items.map(function (g) {
      return ''
        + '<div class="group-item' + (g.imported ? ' active' : '') + '">'
        +   '<div class="gi-main">'
        +     '<div class="gi-radio">' + (g.imported ? '✓' : '💬') + '</div>'
        +     '<div class="gi-info">'
        +       '<div class="gi-name">' + P.escapeHtml(g.name || g.chatroom_id) + (g.imported ? ' <span class="gi-tag">已导入</span>' : '') + '</div>'
        +       '<div class="gi-meta">'
        +         '<span>' + (g.member_count || 0) + ' 人</span>'
        +       '</div>'
        +       '<div class="gi-cid">' + P.escapeHtml(g.chatroom_id || '') + '</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="gi-actions">'
        +     (g.imported
            ? '<span class="btn btn-secondary" style="opacity:.5;pointer-events:none;padding:6px 14px;font-size:13px;width:auto">已导入</span>'
            : '<button type="button" class="btn btn-primary gi-import" data-chat="' + P.escapeHtml(g.chatroom_id) + '" style="padding:6px 14px;font-size:13px;width:auto">导入</button>')
        +   '</div>'
        + '</div>';
    }).join('');

    list.querySelectorAll('.gi-import').forEach(function (b) {
      b.addEventListener('click', async function () {
        const chat = b.dataset.chat;
        const orig = b.textContent;
        b.disabled = true;
        b.textContent = '采集中…';
        // 读取时间范围
        var sinceVal = document.getElementById('importSince')?.value;
        var untilVal = document.getElementById('importUntil')?.value;
        var body = { chat: chat };
        if (sinceVal) {
          // 当天 00:00:00 的 Unix 时间戳（秒）
          body.since = Math.floor(new Date(sinceVal + 'T00:00:00').getTime() / 1000);
        }
        if (untilVal) {
          // 当天 23:59:59 的 Unix 时间戳（秒）
          body.until = Math.floor(new Date(untilVal + 'T23:59:59').getTime() / 1000);
        }
        try {
          const res = await P.fetchAPI('/chatlog/import', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          var msg = '导入完成：拉取 ' + res.pulled + ' 条，入库 ' + res.imported + ' 条';
          if (sinceVal || untilVal) msg += '（已按时间范围筛选）';
          P.showToast(msg);
          // 刷新两个列表
          await loadChatlogGroups();
          await renderGroupsCard();
        } catch (err) {
          P.showToast(err.message, 'error');
          b.disabled = false;
          b.textContent = orig;
        }
      });
    });
  }

  async function init() {
    // === 静态只读提示 ===
    if (P.STATIC_MODE) {
      const note = document.createElement('div');
      note.style.cssText = 'margin:0 0 18px;padding:12px 16px;border-radius:12px;background:rgba(37,99,235,.1);border:1px solid rgba(37,99,235,.3);font-size:13px;line-height:1.6';
      note.innerHTML = '📋 当前为 <b>静态只读版本</b>。采集群消息、批量抽取自我介绍、生成每日精华等管理操作需在<b>本地管理端</b>执行；完成后重新运行导出脚本并部署即可更新本页。';
      const target = document.querySelector('.section-inner') || document.body;
      target.insertBefore(note, target.firstChild);
    }

    // === 从微信导入群 ===
    document.getElementById('loadChatlogBtn')?.addEventListener('click', loadChatlogGroups);
    document.getElementById('chatlogSearch')?.addEventListener('input', P.debounce(function (e) {
      renderChatlogList(e.target.value);
    }, 200));
    document.getElementById('clearTimeRange')?.addEventListener('click', function () {
      var s = document.getElementById('importSince');
      var u = document.getElementById('importUntil');
      if (s) s.value = '';
      if (u) u.value = '';
    });

    // === 群列表 & 活跃群 ===
    await renderGroupsCard();
    document.getElementById('refreshGroupsBtn')?.addEventListener('click', renderGroupsCard);

    // 导航栏显示群名
    const { activeGroup: sa } = await P.loadGroups();
    const sbrand = document.getElementById('brandGroupName');
    if (sbrand && sa) sbrand.textContent = sa.name || 'AI破局门户';

    // === 营期设置 ===
    const campForm = document.getElementById('campForm');
    if (campForm) {
      const { groups, activeGroupId, activeGroup } = await P.loadGroups();
      const gid = activeGroupId;
      const campNameEl = document.getElementById('campGroupName');
      if (campNameEl) campNameEl.textContent = '当前群：' + (activeGroup ? (activeGroup.name || '未命名群') : '—');
      if (gid) {
        try {
          const detail = await P.fetchAPI('/groups/' + gid);
          const sd = document.getElementById('campStartDate');
          const dd = document.getElementById('campDuration');
          if (sd && detail.start_date) sd.value = detail.start_date;
          if (dd && detail.duration_days) dd.value = detail.duration_days;
        } catch (err) { /* 忽略，使用默认值 */ }
      }
      campForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!gid) { P.showToast('请先在上方选择一个统计群', 'error'); return; }
        const fd = new FormData(campForm);
        const payload = {};
        const sdVal = (fd.get('start_date') || '').toString().trim();
        const ddVal = parseInt(fd.get('duration_days'), 10);
        payload.start_date = sdVal;   // 空字符串会清空开营日期
        if (!isNaN(ddVal) && ddVal > 0) payload.duration_days = ddVal;
        try {
          await P.fetchAPI('/groups/' + gid, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          P.showToast('营期设置已保存！首页进度条已更新。');
        } catch (err) { P.showToast(err.message, 'error'); }
      });
    }

    const form = document.getElementById('aiConfigForm');
    const providerSelect = document.getElementById('providerSelect');
    const modelSelect = document.getElementById('modelSelect');
    const modelCustomInput = document.getElementById('modelCustomInput');
    const baseUrlInput = document.getElementById('baseUrlInput');
    if (!form) return;
    try {
      const { providers } = await P.fetchAPI('/config/providers');
      providerSelect.innerHTML = providers.map(function (p) {
        return '<option value="' + p.id + '">' + P.escapeHtml(p.name) + '</option>';
      }).join('');
      const config = await P.fetchAPI('/config');
      const aiConfig = config['ai_config'] || {};
      if (aiConfig.provider) providerSelect.value = aiConfig.provider;

      providerSelect.addEventListener('change', function () {
        const provider = providers.find(function (p) { return p.id === providerSelect.value; });
        if (!provider) return;
        if (provider.models && provider.models.length) {
          modelSelect.innerHTML = '<option value="">使用默认模型</option>' + provider.models.map(function (m) { return '<option value="' + P.escapeHtml(m) + '">' + P.escapeHtml(m) + '</option>'; }).join('');
          modelSelect.style.display = 'block';
          modelCustomInput.style.display = 'none';
          if (provider.default_model) modelSelect.value = provider.default_model;
        } else {
          modelSelect.style.display = 'none';
          modelCustomInput.style.display = 'block';
          modelCustomInput.value = aiConfig.model || '';
        }
        if (provider.id === 'custom') {
          baseUrlInput.parentElement.style.display = 'block';
          baseUrlInput.value = aiConfig.base_url || '';
        } else {
          baseUrlInput.value = provider.base_url || '';
          baseUrlInput.parentElement.style.display = provider.base_url ? 'block' : 'none';
        }
      });
      providerSelect.dispatchEvent(new Event('change'));

      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const fd = new FormData(form);
        let modelValue = fd.get('model');
        if (!modelValue && modelCustomInput.style.display !== 'none') modelValue = fd.get('model_custom');
        try {
          await P.fetchAPI('/config/ai', {
            method: 'POST',
            body: JSON.stringify({
              provider: fd.get('provider'),
              api_key: fd.get('api_key'),
              base_url: fd.get('base_url') || null,
              model: modelValue || null,
            }),
          });
          P.showToast('AI 配置保存成功！');
        } catch (err) { P.showToast(err.message, 'error'); }
      });
    } catch (err) { P.showToast(err.message, 'error'); }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
