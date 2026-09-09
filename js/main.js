(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var themeToggle = document.getElementById('theme-toggle');

  function setTheme(theme) {
    root.dataset.theme = theme;
    if (themeToggle) themeToggle.setAttribute('aria-pressed', String(theme === 'light'));
    try { localStorage.setItem('deeporca-theme', theme); } catch (e) {}
  }

  var initialTheme = root.dataset.theme === 'light' ? 'light' : 'deep';
  setTheme(initialTheme);
  themeToggle.addEventListener('click', function () {
    setTheme(root.dataset.theme === 'deep' ? 'light' : 'deep');
  });

  var revealItems = document.querySelectorAll('.reveal');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealItems.forEach(function (item) { revealObserver.observe(item); });
  } else {
    revealItems.forEach(function (item) { item.classList.add('in'); });
  }

  var journeyTabs = document.querySelectorAll('.journey-tab');
  var journeyScenes = document.querySelectorAll('.journey-scene');
  function activateJourney(name) {
    journeyTabs.forEach(function (tab) {
      var active = tab.dataset.journey === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    journeyScenes.forEach(function (scene) {
      var active = scene.dataset.scene === name;
      scene.classList.toggle('is-active', active);
      scene.hidden = !active;
    });
  }
  journeyTabs.forEach(function (tab) {
    tab.addEventListener('click', function () { activateJourney(tab.dataset.journey); });
    tab.addEventListener('mouseenter', function () { activateJourney(tab.dataset.journey); });
  });

  var moduleData = {
    chat: ['01 / 08', 'AI 会话工作台', '流式会话循环、工具调用与上下文压缩，跨会话持久化与恢复。把你的每次思考留在可接续的工作流里。'],
    editor: ['02 / 08', '专业编辑器', '流畅的编辑体验把思考直接送进文件；内联差异让每一次 AI 变更都能被接受、拒绝或继续推敲。'],
    git: ['03 / 08', 'Git 源码管理', '分支、变更与提交不离开工作台。让每次创作留下清晰的版本航迹。'],
    wiki: ['04 / 08', '项目索引与 Wiki', '从符号、文档和架构三个视角快速理解项目，不必在陌生代码里独自潜行。'],
    knowledge: ['05 / 08', '仓库知识库', '任意 GitHub 仓库都能变成可问答的知识库；本地检索，快速而私密。'],
    memory: ['06 / 08', '本地智能层', '本地向量嵌入与长期记忆，让 AI 越用越懂你的项目，数据不出本机。'],
    language: ['07 / 08', '多语言界面', '简/繁中文、English、日本語、한국어、香港繁体——让工作台随你的语言切换。'],
    security: ['08 / 08', '权限与安全', '细粒度权限管控，敏感操作逐一确认。计划模式先规划后执行，让每次行动都有边界。']
  };
  var moduleDetail = document.getElementById('module-detail');
  var moduleDefault = moduleDetail.innerHTML;
  function resetModuleDetail() {
    moduleDetail.innerHTML = moduleDefault;
    document.querySelectorAll('.module-node').forEach(function (item) { item.classList.remove('is-active'); });
  }
  document.querySelectorAll('.module-node').forEach(function (node) {
    node.addEventListener('click', function () {
      var data = moduleData[node.dataset.module];
      moduleDetail.innerHTML = '<button class="detail-close" type="button" aria-label="关闭模块详情">关闭 ×</button><p class="detail-index">' + data[0] + '</p><h3>' + data[1] + '</h3><p>' + data[2] + '</p><span class="detail-link">正在与本地智能核心交换信号</span>';
      document.querySelectorAll('.module-node').forEach(function (item) { item.classList.remove('is-active'); });
      node.classList.add('is-active');
      moduleDetail.querySelector('.detail-close').focus();
    });
  });
  moduleDetail.addEventListener('click', function (event) {
    if (event.target.classList.contains('detail-close')) resetModuleDetail();
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && moduleDetail.querySelector('.detail-close')) resetModuleDetail();
  });

  var ecoData = {
    actions: ['Actions', '一次定义的能力，可在 AI 会话、桌面界面和自动化工作流中直接调用。'],
    skills: ['技能扩展', '一项技能即是一种新能力；安装后，AI 会在合适的创作时刻自动调用它。'],
    protocol: ['开放协议', '基于开放标准接入兼容的工具、服务和数据源，让工作流自然伸向更远处。'],
    plugins: ['内置插件', '代码索引、安全扫描、浏览器自动化等能力已经随工作台抵达，不必反复配置环境。']
  };
  var ecoDetail = document.getElementById('eco-detail');
  document.querySelectorAll('[data-eco]').forEach(function (node) {
    node.addEventListener('click', function () {
      var data = ecoData[node.dataset.eco];
      ecoDetail.innerHTML = '<b>' + data[0] + '</b><span>' + data[1] + '</span>';
      document.querySelectorAll('[data-eco]').forEach(function (item) { item.classList.remove('is-active'); });
      node.classList.add('is-active');
    });
  });

  var chainStates = [
    { title: '发现同主题设备', text: '同一局域网内、工作区主题相同的实例自动互相可见。默认不共享，发现不等于加入。', ledger: '已发现 3 个同主题实例 / share: off', pod: '建立订阅流原型', position: 'a', status: 'STEP 01' },
    { title: '选择共享边界', text: '选择哪些项目记录进入协作链。需求、设计、任务或会话可以独立选择；共享边界始终由你掌控。', ledger: '范围已选择：需求 · 原型 · 任务记录', pod: '共享：订阅流原型', position: 'a', status: 'STEP 02' },
    { title: '签名上链', text: '每条共享记录由设备签名。它带着来源、时间和关联上下文，成为可验证、可审计的项目记忆。', ledger: 'device:A signed / record 7f2a committed', pod: '已签名 / 7f2a', position: 'middle', status: 'STEP 03' },
    { title: '跨设备接续', text: 'B 设备接到任务后，不只收到一条消息，还会获得关联的原型、设计和对话上下文，立即继续工作。', ledger: 'Orca / B accepted / context hydrated', pod: 'B 正在接续任务', position: 'b', status: 'STEP 04' },
    { title: '审计回放', text: '任何设备都能沿着记录回看任务如何发生、由谁接续、引用了哪些资产。协作不再成为不可见的黑箱。', ledger: 'audit trail complete / 4 linked events', pod: '审计回放 / 4 events', position: 'c', status: 'STEP 05' }
  ];
  var chainSteps = document.querySelectorAll('.chain-step');
  var chainReadout = document.getElementById('chain-readout');
  var ledgerText = document.getElementById('ledger-text');
  var taskPod = document.querySelector('.task-pod');
  var chainPlay = document.getElementById('chain-play');
  var chainReset = document.getElementById('chain-reset');
  var chainIndex = 0;
  var chainTimer = null;
  var chainPlaying = !reduceMotion;

  function renderChain(index) {
    chainIndex = index;
    var state = chainStates[index];
    chainSteps.forEach(function (step, i) {
      var active = i === index;
      step.classList.toggle('is-active', active);
      step.setAttribute('aria-selected', String(active));
    });
    chainReadout.innerHTML = '<span>' + state.status + '</span><h3>' + state.title + '</h3><p>' + state.text + '</p>';
    ledgerText.textContent = state.ledger;
    taskPod.querySelector('strong').textContent = state.pod;
    taskPod.querySelector('small').textContent = index < 2 ? 'task.share / 7f2a' : index === 2 ? 'record.commit / 7f2a' : index === 3 ? 'task.resume / device:B' : 'chain.audit / 4 events';
    taskPod.className = 'task-pod at-' + state.position;
  }

  function stopChain() {
    chainPlaying = false;
    window.clearInterval(chainTimer);
    chainTimer = null;
    chainPlay.textContent = '继续自动演示';
    chainPlay.setAttribute('aria-pressed', 'false');
  }

  function startChain() {
    if (reduceMotion) return;
    chainPlaying = true;
    chainPlay.textContent = '暂停自动演示';
    chainPlay.setAttribute('aria-pressed', 'true');
    window.clearInterval(chainTimer);
    chainTimer = window.setInterval(function () { renderChain((chainIndex + 1) % chainStates.length); }, 4200);
  }

  chainSteps.forEach(function (step, index) {
    step.addEventListener('click', function () { renderChain(index); stopChain(); });
  });
  chainPlay.addEventListener('click', function () { if (chainPlaying) stopChain(); else startChain(); });
  chainReset.addEventListener('click', function () { renderChain(0); startChain(); });
  renderChain(0);
  if (chainPlaying) startChain();

  if (!reduceMotion) {
    var heroDepth = document.getElementById('hero-depth');
    window.addEventListener('pointermove', function (event) {
      if (!heroDepth || window.innerWidth < 941) return;
      var rect = heroDepth.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      var x = (event.clientX - rect.left) / rect.width - 0.5;
      var y = (event.clientY - rect.top) / rect.height - 0.5;
      heroDepth.style.transform = 'translate(' + (x * 9) + 'px,' + (y * 9) + 'px)';
    });
  }
})();
