// Vanilla-JS single-page app. No modules, no React. Pure DOM + template strings.
(function () {
  function applyTheme() {
    document.body.classList.toggle('dark', !!DB.getSettings().darkMode);
  }

  // Route table — icons are now SVG sprite ids (defined in index.html).
  var ROUTES = [
    { path:'month',      label:'חודש נוכחי',    icon:'i-home' },
    { path:'yearly',     label:'סיכום שנתי',    icon:'i-chart' },
    { path:'categories', label:'קטגוריות',      icon:'i-tag' },
    { path:'payments',   label:'אמצעי תשלום',   icon:'i-wallet' },
    { path:'settings',   label:'הגדרות',        icon:'i-cog' },
  ];
  var MIN_MONTH = '2026-01';
  var MIN_YEAR  = 2026;
  var MAX_YEAR  = 2035;

  // Category name → sprite id. Unknowns fall back to i-package.
  var CAT_ICON = {
    'דיור':            'i-house',
    'תחבורה':          'i-car',
    'ילדים':           'i-kids',
    'טיפוח אישי':      'i-spark',
    'בילוי ובידור':    'i-cup',
    'בריאות וביטוחים': 'i-heart',
    'שונות':           'i-package',
    'בנק והלוואות':    'i-bank',
    'הוצאות לדירה':    'i-bolt',
    'הכנסות':          'i-coin',
  };
  function catIcon(name) { return CAT_ICON[name] || 'i-package'; }

  // Payment-method group → sprite id.
  function pmIcon(pm) {
    var g = (pm && (pm.group || pm.name)) || '';
    if (g.indexOf('אשראי') !== -1) return 'i-card';
    if (g.indexOf('העברה') !== -1) return 'i-bank';
    if (g.indexOf('קבע')   !== -1) return 'i-bank';
    if (g.indexOf('מזומן') !== -1) return 'i-coin';
    return 'i-wallet';
  }
  function pmIconByName(name) {
    var pm = DB.listPaymentMethods().find(function(p){ return p.name===name; });
    return pmIcon(pm || { name: name });
  }

  // Global app state
  function clampMonth(m) { return (!m || m < MIN_MONTH) ? MIN_MONTH : m; }
  var state = {
    month: clampMonth(DB.getSettings().defaultMonth || DB.currentMonth()),
    year:  Math.max(MIN_YEAR, new Date().getFullYear()),
    txEditing: null,
    txFilter: 'all',   // 'all' | 'expense' | 'income'
    txSearch: '',
    txPaymentFilter: 'all', // 'all' | payment method name
    incomeModalOpen: false,
    expenseModalOpen: false,
    pmCarouselIndex: 0,
  };
  var activeChartInstances = [];

  function esc(s) {
    if (s===null || s===undefined) return '';
    return String(s).replace(/[&<>"']/g, function(c){ return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; });
  }
  function icon(id, cls) {
    return '<svg class="ic '+(cls||'')+'"><use href="#'+id+'"/></svg>';
  }
  function currentRoute() {
    var h = (location.hash || '#/month').replace(/^#\//,'');
    var parts = h.split('/');
    return { page: parts[0] || 'month', arg: parts[1] };
  }
  function navigate(page, arg) {
    location.hash = '#/' + page + (arg ? '/'+arg : '');
  }
  function destroyCharts() {
    activeChartInstances.forEach(function(c){ try { c.destroy(); } catch(e){} });
    activeChartInstances = [];
  }

  // User initials for the avatar
  function avatarText(user) {
    if (!user) return '?';
    var n = user.displayName || user.email || '';
    if (!n) return '?';
    var parts = n.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    var a = (parts[0] || '').charAt(0);
    var b = (parts[1] || '').charAt(0);
    return (a + b).toUpperCase() || n.charAt(0).toUpperCase();
  }

  // ------------------------------------------------------------
  // Render shell
  // ------------------------------------------------------------
  function render() {
    destroyCharts();
    document.body.classList.remove('nav-open');
    var r = currentRoute();
    var route = ROUTES.find(function(x){return x.path===r.page;}) || ROUTES[0];
    var title = route.label;
    var showMonth = ['month','transactions'].indexOf(r.page) !== -1;

    var root = document.getElementById('root');
    var user = window.AUTH && window.AUTH.currentUser;
    var userBadge = user ?
      '<button class="btn btn-ghost btn-sm user-badge-text" id="btn-signout">יציאה</button>' : '';

    root.innerHTML =
      '<div class="app">' +
        '<div class="sidebar-backdrop" id="sidebar-backdrop"></div>' +
        renderSidebar(r.page, user) +
        '<main>' +
          '<header class="topbar">' +
            '<div class="flex gap-2" style="align-items:center">' +
              '<button class="hamburger" id="btn-hamburger" aria-label="תפריט">☰</button>' +
              '<div class="pagetitle">' +
                '<div class="crumb">'+esc(title)+'</div>' +
                '<h1>'+esc(title)+'</h1>' +
              '</div>' +
            '</div>' +
            '<div class="flex gap-2" style="align-items:center">' +
              (showMonth ? renderMonthPicker() : '') +
              userBadge +
            '</div>' +
          '</header>' +
          '<div class="content" id="page"></div>' +
        '</main>' +
      '</div>';

    attachSidebarEvents();
    if (showMonth) attachMonthPickerEvents();
    var signOutBtn = document.getElementById('btn-signout');
    if (signOutBtn) signOutBtn.addEventListener('click', function(){ window.AUTH.signOut(); });

    // Mobile drawer wiring
    function closeDrawer() { document.body.classList.remove('nav-open'); }
    var burger = document.getElementById('btn-hamburger');
    if (burger) burger.addEventListener('click', function(){ document.body.classList.toggle('nav-open'); });
    var backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeDrawer);
    Array.prototype.forEach.call(document.querySelectorAll('.sidebar .nav-link'), function(a){
      a.addEventListener('click', closeDrawer);
    });

    switch (r.page) {
      case 'month':        renderMonth(); break;
      case 'transactions': renderTransactions(); break;
      case 'yearly':       renderYearly(r.arg); break;
      case 'categories':   renderCategories(); break;
      case 'payments':     renderPayments(); break;
      case 'settings':     renderSettings(); break;
      default:             renderMonth();
    }
  }

  function renderSidebar(active, user) {
    // Split into two sections visually (ראשי + הגדרות)
    var mainLinks = ROUTES.slice(0,2).map(function(r){
      return '<a class="nav-link '+(active===r.path?'active':'')+'" href="#/'+r.path+'">' +
             icon(r.icon) + '<span>'+esc(r.label)+'</span></a>';
    }).join('');
    var settingsLinks = ROUTES.slice(2).map(function(r){
      return '<a class="nav-link '+(active===r.path?'active':'')+'" href="#/'+r.path+'">' +
             icon(r.icon) + '<span>'+esc(r.label)+'</span></a>';
    }).join('');

    var userBlock = user ?
      '<div class="sidebar-foot">' +
        '<div class="avatar">'+esc(avatarText(user))+'</div>' +
        '<div style="min-width:0">' +
          '<div class="user-name">'+esc(user.displayName || user.email || 'משתמש')+'</div>' +
          (user.email ? '<div class="user-mail">'+esc(user.email)+'</div>' : '') +
        '</div>' +
      '</div>' : '';

    return '<aside class="sidebar">' +
             '<div class="logo">' +
               '<div class="badge">₪</div>' +
               '<div>' +
                 '<div class="brand-name">BudgetPlus</div>' +
                 '<div class="brand-tag">ניהול תקציב חכם</div>' +
               '</div>' +
             '</div>' +
             '<nav>' +
               '<div class="nav-section-label">ראשי</div>' +
               mainLinks +
               '<div class="nav-section-label" style="margin-top:8px">הגדרות</div>' +
               settingsLinks +
             '</nav>' +
             userBlock +
           '</aside>';
  }
  function attachSidebarEvents() { /* plain anchor hrefs handle nav */ }

  function renderMonthPicker() {
    var months = [];
    for (var y = MIN_YEAR; y <= MAX_YEAR; y++) {
      for (var m = 1; m <= 12; m++) months.push(y + '-' + String(m).padStart(2,'0'));
    }
    var opts = months.map(function(m){
      return '<option value="'+m+'"'+(m===state.month?' selected':'')+'>'+esc(DB.monthLabel(m))+'</option>';
    }).join('');
    return '<div class="month-pick">' +
             '<select id="month-picker">'+opts+'</select>' +
           '</div>';
  }
  function attachMonthPickerEvents() {
    var el = document.getElementById('month-picker');
    if (el) el.addEventListener('change', function(e){ state.month = e.target.value; render(); });
  }

  // ------------------------------------------------------------
  // Dashboard (hero + KPIs + charts)
  // ------------------------------------------------------------
  function heroBlockHtml(s) {
    var sign = s.net >= 0 ? '+' : '−';
    var cls  = s.net >= 0 ? 'pos' : 'neg';
    var income = s.incomeTotal || 0;
    var actual = s.totals.actual || 0;
    var budget = s.totals.budget || 0;
    var maxRef = Math.max(income, actual, budget, 1);

    return '<section class="hero">' +
      '<div class="hero-main">' +
        '<div class="hero-eyebrow">המאזן שלך · '+esc(DB.monthLabel(s.month))+'</div>' +
        '<div class="hero-balance '+cls+'"><span class="sign">'+sign+'</span>'+esc(CALC.fmt(Math.abs(s.net)))+'</div>' +
        '<div class="hero-sub">' +
          '<span>'+(s.net>=0 ? 'יתרה חיובית — עבודה יפה!' : 'חרגת מהתקציב החודש')+'</span>' +
        '</div>' +
      '</div>' +
      '<div class="hero-bars">' +
        heroBar('הכנסות', income, maxRef, 'income') +
        heroBar('הוצאות', actual, maxRef, 'expense') +
        heroBar('תקציב',  budget, maxRef, 'budget') +
      '</div>' +
    '</section>';
  }
  function heroBar(label, val, max, cls) {
    var w = Math.round(Math.min(100, (val / max) * 100));
    return '<div class="hero-bar-row">' +
      '<div class="hero-bar-label">'+esc(label)+'</div>' +
      '<div class="hero-bar-track"><div class="hero-bar-fill '+cls+'" style="width:'+w+'%"></div></div>' +
      '<div class="hero-bar-value">'+esc(CALC.fmt(val))+'</div>' +
    '</div>';
  }

  function kpiRowHtml(s) {
    var util = s.totals.budget > 0 ? Math.round((s.totals.actual / s.totals.budget) * 100) : 0;
    return '<div class="grid grid-cols-4">' +
      kpi('הכנסות בפועל', CALC.fmt(s.incomeTotal), 'good', 'i-coin', '', { editAction: 'open-income-modal', editLabel: 'עריכת הכנסות' }) +
      kpi('הוצאות החודש', CALC.fmt(s.totals.actual), 'accent', 'i-bag', util + '% מהתקציב', { editAction: 'open-expense-modal', editLabel: 'עריכת הוצאות' }) +
      kpi('תקציב כולל',   CALC.fmt(s.totals.budget), '', 'i-scales') +
      kpi('מאזן',          CALC.fmt(s.net), s.net>=0?'good':'bad', 'i-spark') +
    '</div>';
  }
  function kpi(label, value, flavor, iconId, foot, opts) {
    var editBtn = (opts && opts.editAction)
      ? '<button type="button" class="kpi-edit" data-action="'+esc(opts.editAction)+'" aria-label="'+esc(opts.editLabel||'עריכה')+'" title="'+esc(opts.editLabel||'עריכה')+'">'+icon('i-pencil')+'</button>'
      : '';
    return '<div class="kpi '+(flavor||'')+'">' +
      '<div class="kpi-head">' +
        '<div class="kpi-label">'+esc(label)+'</div>' +
        '<div class="kpi-actions">' + editBtn + '<div class="kpi-icon">'+icon(iconId||'i-coin')+'</div></div>' +
      '</div>' +
      '<div class="kpi-value">'+esc(value)+'</div>' +
      (foot ? '<div class="kpi-foot">'+esc(foot)+'</div>' : '') +
    '</div>';
  }

  function incomeModalHtml(s, incomeRowsHtml) {
    if (!state.incomeModalOpen) return '';
    return '<div class="income-modal-backdrop" data-action="close-income-modal-backdrop">' +
      '<div class="income-modal" role="dialog" aria-modal="true" aria-labelledby="income-modal-title">' +
        '<div class="card-head">' +
          '<div>' +
            '<div class="card-title" id="income-modal-title">הכנסות (משוער)</div>' +
            '<div class="card-sub">ערך ברירת-מחדל או תנועות בפועל</div>' +
          '</div>' +
          '<button type="button" class="income-modal-close" data-action="close-income-modal" aria-label="סגור">'+icon('i-chevron-r')+'</button>' +
        '</div>' +
        '<div class="income-list">' + incomeRowsHtml + '</div>' +
        '<div class="income-total">' +
          '<span>סה"כ הכנסות</span>' +
          '<span class="amt">'+esc(CALC.fmt(s.incomeTotal))+'</span>' +
        '</div>' +
        '<div class="income-add">' +
          '<input class="input" id="new-income" placeholder="סוג הכנסה חדש"/>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="add-income">'+icon('i-plus')+'הוסף</button>' +
        '</div>' +
        '<p class="muted" style="font-size:12px;margin-top:10px">* אם לא נרשמה הכנסה בפועל, יילקח הערך שלצד השורה.</p>' +
      '</div>' +
    '</div>';
  }

  function expenseModalHtml(s, catListHtml) {
    if (!state.expenseModalOpen) return '';
    return '<div class="expense-modal-backdrop" data-action="close-expense-modal-backdrop">' +
      '<div class="expense-modal" role="dialog" aria-modal="true" aria-labelledby="expense-modal-title">' +
        '<div class="card-head">' +
          '<div>' +
            '<div class="card-title" id="expense-modal-title">הוצאות החודש</div>' +
            '<div class="card-sub">ניצול תקציב החודש</div>' +
          '</div>' +
          '<button type="button" class="expense-modal-close" data-action="close-expense-modal" aria-label="סגור">'+icon('i-chevron-r')+'</button>' +
        '</div>' +
        '<div class="cat-list">' + catListHtml + '</div>' +
        '<div class="cat-total-row">' +
          '<span>סה"כ</span>' +
          '<div class="nums">' +
            '<span class="muted">תקציב '+esc(CALC.fmt(s.totals.budget))+'</span>' +
            '<span>'+esc(CALC.fmt(s.totals.actual))+'</span>' +
            '<span class="'+(s.totals.remaining<0?'text-red':'text-em')+'">'+esc(CALC.fmt(s.totals.remaining))+'</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // Donut SVG — 6 top categories + "other"
  function donutHtml(expenseRows, total) {
    var colors = [
      'oklch(0.62 0.13 45)',
      'oklch(0.70 0.11 60)',
      'oklch(0.56 0.11 155)',
      'oklch(0.68 0.12 75)',
      'oklch(0.60 0.1 300)',
      'oklch(0.55 0.02 65)',
      'oklch(0.50 0.08 220)',
    ];
    var rows = expenseRows.filter(function(r){ return r.actual > 0; })
      .slice().sort(function(a,b){ return b.actual - a.actual; });
    if (rows.length === 0) {
      return '<div class="muted text-center">אין הוצאות החודש</div>';
    }
    var sum = rows.reduce(function(s,r){ return s+r.actual; }, 0) || 1;
    var circ = 100; // stroke-dasharray space using pathLength-like r=15.915
    var offset = 25; // start at top (rotate -90 also applied)
    var segs = '';
    var legend = '';
    rows.forEach(function(r, i){
      var frac = r.actual / sum;
      var len  = frac * circ;
      var color = colors[i % colors.length];
      segs += '<circle cx="21" cy="21" r="15.915" fill="none" stroke="'+color+'" stroke-width="5" ' +
              'stroke-dasharray="'+len.toFixed(2)+' '+(circ-len).toFixed(2)+'" ' +
              'stroke-dashoffset="'+offset.toFixed(2)+'" transform="rotate(-90 21 21)"/>';
      offset -= len;
      legend += '<div class="legend-item">' +
        '<span class="legend-swatch" style="background:'+color+'"></span>' +
        '<span class="legend-name">'+esc(r.category)+'</span>' +
        '<span class="legend-val">'+esc(CALC.fmt(r.actual))+'</span>' +
      '</div>';
    });

    return '<div class="donut-wrap">' +
      '<svg viewBox="0 0 42 42" width="180" height="180" aria-hidden="true">' +
        '<circle cx="21" cy="21" r="15.915" fill="none" stroke="var(--bg-sunk)" stroke-width="5"/>' +
        segs +
      '</svg>' +
      '<div class="donut-center"><div>' +
        '<div class="big">'+esc(CALC.fmt(total))+'</div>' +
        '<div class="lbl">סה"כ הוצאה</div>' +
      '</div></div>' +
    '</div>' +
    '<div class="legend">'+legend+'</div>';
  }

  function paymentStripHtml(pmPivot, monthTxs) {
    var totals = pmPivot.map(function(r){
      return { group: r.group, total: r.acct1 + r.acct2 + r.none };
    }).filter(function(r){ return r.total > 0; })
      .sort(function(a,b){ return b.total - a.total; })
      .slice(0, 6);

    var pms = DB.listPaymentMethods();
    var creditCards = pms.filter(function(p){
      var label = (p.group || p.name || '');
      return label.indexOf('אשראי') !== -1;
    });

    var byMethod = {};
    (monthTxs || []).forEach(function(t){
      var name = t.paymentMethod || '';
      if (!name) return;
      byMethod[name] = (byMethod[name] || 0) + (Number(t.amount) || 0);
    });

    var items = [];
    creditCards.forEach(function(p){
      var rawTail = ((p.name || '').match(/\d+/g) || []).join('');
      var tail = rawTail ? rawTail.slice(-4).padStart(4, '0') : '8630';
      var total = Math.abs(byMethod[p.name] || 0);
      items.push({
        kind: 'card',
        key: p.name,
        html: '<div class="pm-pill pm-pill-card" data-card-index="'+items.length+'" style="--card-index:'+items.length+'">' +
          '<div class="cc-top">' +
            '<div class="cc-holder">'+esc(p.name)+'</div>' +
            '<div class="cc-last4">' +
              '<span class="cc-num">'+esc(tail)+'</span>' +
              '<span class="cc-mask"><span></span><span></span><span></span><span></span></span>' +
            '</div>' +
          '</div>' +
          '<div class="cc-bottom">' +
            '<span class="cc-due">חיוב חודשי</span>' +
            '<span class="cc-amount">'+esc(CALC.fmt(total))+'</span>' +
          '</div>' +
        '</div>'
      });
    });

    totals.filter(function(r){
      return (r.group || '').indexOf('אשראי') === -1;
    }).forEach(function(r){
      items.push({
        kind: 'group',
        key: r.group,
        html: '<div class="pm-pill" data-card-index="'+items.length+'" style="--card-index:'+items.length+'">' +
          '<span class="name">'+esc(r.group)+'</span>' +
          '<span class="val">'+esc(CALC.fmt(r.total))+'</span>' +
        '</div>'
      });
    });

    if (!items.length) return '<div class="muted text-center">אין נתונים</div>';

    var activeIndex = Math.max(0, Math.min(state.pmCarouselIndex, items.length - 1));
    state.pmCarouselIndex = activeIndex;

    var finalHtml = items.map(function(item, idx){
      var focusCls = idx === activeIndex ? ' pm-pill-focus' : ' pm-pill-side';
      return item.html.replace('class="pm-pill', 'class="pm-pill'+focusCls);
    }).join('');

    return '<div class="pm-strip">' + finalHtml + '</div>';
  }

  // ------------------------------------------------------------
  // Month view — hero + KPIs + category list + income + donut + tx
  // ------------------------------------------------------------
  function renderMonth() {
    var s = CALC.monthlySummary(state.month);
    var pmPivot = CALC.paymentMethodPivot(state.month);

    // Category card-list (replaces expense table)
    var catListHtml = s.expenseRows.map(function(r){
      var util = r.utilization || 0;
      var barW = Math.min(100, Math.round(util * 100));
      var status = r.remaining < 0 ? 'bad' : (util >= 0.85 ? 'warn' : '');
      var remCls = r.remaining < 0 ? 'neg' : 'pos';
      var remPfx = r.remaining < 0 ? '−' : '';
      var utilPct = r.budget > 0 ? Math.round(util*100)+'%' : '—';

      return '<div class="cat-row">' +
        '<div class="cat-ico">'+icon(catIcon(r.category))+'</div>' +
        '<div>' +
          '<div class="cat-name">'+esc(r.category)+'</div>' +
          '<div class="cat-sub">'+esc(CALC.fmt(r.actual))+' מתוך '+esc(CALC.fmt(r.budget))+'</div>' +
        '</div>' +
        '<div class="cat-meter">' +
          '<div class="cat-meter-track"><div class="cat-meter-fill '+status+'" style="width:'+barW+'%"></div></div>' +
          '<div class="cat-meter-nums">' +
            '<span class="spent">'+esc(utilPct)+'</span>' +
            '<span>'+esc(CALC.fmt(r.budget))+'</span>' +
          '</div>' +
        '</div>' +
        '<div class="cat-budget-edit">' +
          '<label>תקציב</label>' +
          '<input type="number" data-budget-cat="'+esc(r.category)+'" value="'+r.budget+'"/>' +
        '</div>' +
        '<div class="cat-right">' +
          '<div class="cat-remaining '+remCls+'">'+remPfx+esc(CALC.fmt(Math.abs(r.remaining)))+'</div>' +
          '<div class="cat-pct">'+(r.remaining<0?'חריגה':'נותרו')+'</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Income list (with inline edit for projectedDefault)
    var incomeRowsHtml = s.incomeLines.map(function(l){
      return '<div class="income-row">' +
        '<div class="income-name">'+esc(l.description)+'</div>' +
        '<input type="number" class="income-amt-input" data-income-default="'+esc(l.description)+'" value="'+l.projectedDefault+'"/>' +
        '<button class="income-remove" data-action="del-income" data-arg="'+esc(l.description)+'" aria-label="הסר">'+icon('i-trash')+'</button>' +
      '</div>';
    }).join('') || '<div class="text-center muted">אין סוגי הכנסה מוגדרים</div>';

    document.getElementById('page').innerHTML =
      '<div class="grid">' +

        // Hero balance
        heroBlockHtml(s) +

        // KPI row
        kpiRowHtml(s) +

        expenseModalHtml(s, catListHtml) +
        incomeModalHtml(s, incomeRowsHtml) +

        // Dashboard row (expense panel + payment-method strip)
        '<div class="section-head">' +
          '<h2>פילוח החודש</h2>' +
          '<button class="btn btn-ghost btn-sm" id="export-month">'+icon('i-download')+'ייצוא ל-Excel</button>' +
        '</div>' +
        '<div class="charts-row">' +
          '<div class="card payment-method-section payment-method-carousel">' +
            '<div class="card-head">' +
              '<div><div class="card-title">אמצעי תשלום</div><div class="card-sub">חלוקה לקבוצות</div></div>' +
            '</div>' +
            '<div class="carousel-shell">' +
              '<button type="button" class="btn btn-ghost btn-sm carousel-nav carousel-nav-left" id="pm-prev" aria-label="הקודם">'+icon('i-chevron-l')+'</button>' +
              '<button type="button" class="btn btn-ghost btn-sm carousel-nav carousel-nav-right" id="pm-next" aria-label="הבא">'+icon('i-chevron-r')+'</button>' +
              paymentStripHtml(pmPivot, s.transactions) +
            '</div>' +
          '</div>' +
          '<div class="card dashboard-expense-card">' +
            '<div class="card-head"><div>' +
              '<div class="card-title">הוצאות החודש</div>' +
              '<div class="card-sub">ניצול תקציב החודש</div>' +
            '</div></div>' +
            '<div class="cat-list dashboard-expense-list">' + catListHtml + '</div>' +
            '<div class="cat-total-row">' +
              '<span>סה"כ</span>' +
              '<div class="nums">' +
                '<span class="muted">תקציב '+esc(CALC.fmt(s.totals.budget))+'</span>' +
                '<span>'+esc(CALC.fmt(s.totals.actual))+'</span>' +
                '<span class="'+(s.totals.remaining<0?'text-red':'text-em')+'">'+esc(CALC.fmt(s.totals.remaining))+'</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Transactions
        '<div id="tx-container"></div>' +
      '</div>';

    // Inline-edit bindings for budget per row
    Array.prototype.forEach.call(document.querySelectorAll('[data-budget-cat]'), function(el){
      el.addEventListener('change', function(e){
        DB.setMonthBudget(state.month, el.getAttribute('data-budget-cat'), e.target.value);
        render();
      });
    });
    // Inline income-default persist
    Array.prototype.forEach.call(document.querySelectorAll('[data-income-default]'), function(el){
      el.addEventListener('change', function(e){
        var desc = el.getAttribute('data-income-default');
        var cats = DB.listCategories();
        var inc = cats.find(function(c){ return c.kind==='income'; });
        if (!inc) return;
        var pdMap = Object.assign({}, inc.projectedDefaults || {});
        pdMap[desc] = Number(e.target.value)||0;
        DB.upsertCategory(Object.assign({}, inc, { projectedDefaults: pdMap }));
        render();
      });
    });
    document.getElementById('export-month').addEventListener('click', function(){ exportMonthXlsx(state.month); });

    var pmStrip = document.querySelector('.payment-method-carousel .pm-strip');
    var pmCards = pmStrip ? Array.prototype.slice.call(pmStrip.children) : [];
    if (pmCards.length) {
      state.pmCarouselIndex = Math.max(0, Math.min(state.pmCarouselIndex, pmCards.length - 1));
      var prevBtn = document.getElementById('pm-prev');
      var nextBtn = document.getElementById('pm-next');
      if (prevBtn) prevBtn.addEventListener('click', function(){ state.pmCarouselIndex = Math.max(0, state.pmCarouselIndex - 1); render(); });
      if (nextBtn) nextBtn.addEventListener('click', function(){ state.pmCarouselIndex = Math.min(pmCards.length - 1, state.pmCarouselIndex + 1); render(); });
      requestAnimationFrame(function(){
        var active = pmStrip.querySelector('.pm-pill-focus');
        if (active) active.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
      });
    }

    initDashboardCharts(s);
    renderTxTable(document.getElementById('tx-container'), true);
  }

  function initDashboardCharts(s) {
    if (!window.Chart) return;
    var accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || 'oklch(0.62 0.13 45)';
    var hair   = getComputedStyle(document.body).getPropertyValue('--hair-strong').trim() || '#cbd5e1';
    var ink    = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#1e293b';
    var barEl  = document.getElementById('c-bar');
    if (!barEl) return;
    activeChartInstances.push(new Chart(barEl, {
      type:'bar',
      data:{ labels: s.expenseRows.map(function(r){return r.category;}),
             datasets:[
               { label:'תקציב', data: s.expenseRows.map(function(r){return r.budget;}), backgroundColor: hair, borderRadius: 6 },
               { label:'בפועל', data: s.expenseRows.map(function(r){return r.actual;}), backgroundColor: accent, borderRadius: 6 },
             ] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ rtl:true, labels: { color: ink } } },
        scales:{
          y:{ beginAtZero:true, ticks: { color: ink }, grid: { color: hair } },
          x:{ ticks: { color: ink }, grid: { display: false } },
        },
      },
    }));
  }

  // ------------------------------------------------------------
  // Transactions page (redesigned)
  // ------------------------------------------------------------
  function renderTransactions() {
    document.getElementById('page').innerHTML = '<div id="tx-container"></div>';
    renderTxTable(document.getElementById('tx-container'), true);
  }

  function renderTxTable(container, showImport) {
    var allTxs = DB.listTxByMonth(state.month).slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    var cats = DB.listCategories();
    var subs = DB.listSubcategories();
    var pms  = DB.listPaymentMethods();
    var pmOpts = ['<option value="all">כל אמצעי התשלום</option>']
      .concat(pms.map(function(p){
        return '<option value="'+esc(p.name)+'"'+(state.txPaymentFilter===p.name?' selected':'')+'>'+esc(p.name)+'</option>';
      })).join('');

    // Filter + search
    var incomeNames = cats.filter(function(c){ return c.kind==='income'; }).map(function(c){ return c.name; });
    var isIncomeTx = function(t){ return incomeNames.indexOf(t.category) !== -1; };
    var q = (state.txSearch || '').trim().toLowerCase();
    var txs = allTxs.filter(function(t){
      if (state.txFilter === 'income'  && !isIncomeTx(t)) return false;
      if (state.txFilter === 'expense' &&  isIncomeTx(t)) return false;
      if (state.txPaymentFilter !== 'all' && (t.paymentMethod || '') !== state.txPaymentFilter) return false;
      if (q) {
        var hay = [t.category, t.subcategory, t.paymentMethod, t.detail, t.notes].filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    // Group by date
    var groups = [];
    var byDate = {};
    txs.forEach(function(t){
      var d = t.date || '—';
      if (!byDate[d]) { byDate[d] = []; groups.push(d); }
      byDate[d].push(t);
    });

    function dateLabel(d) {
      if (d === '—') return d;
      var today = new Date();
      var yest  = new Date(today.getTime() - 86400000);
      var ymd   = function(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); };
      if (d === ymd(today)) return 'היום · ' + d;
      if (d === ymd(yest))  return 'אתמול · ' + d;
      return d;
    }

    var rowsHtml = '';
    if (txs.length === 0) {
      rowsHtml = '<div class="tx-empty">אין תנועות להצגה</div>';
    } else {
      groups.forEach(function(d){
        rowsHtml += '<div class="tx-group-label">'+esc(dateLabel(d))+'</div>';
        byDate[d].forEach(function(t){
          var amountNum = Number(t.amount) || 0;
          var income = isIncomeTx(t);
          var creditByAmount = amountNum < 0;
          var incomeStyle = income || creditByAmount;
          var amt = (incomeStyle ? '+' : '') + CALC.fmt(Math.abs(amountNum));
          var pm = pmIconByName(t.paymentMethod);
          rowsHtml +=
            '<div class="tx-row">' +
              '<div class="tx-ico'+(incomeStyle?' income-ico':'')+'">'+icon(incomeStyle ? 'i-coin' : catIcon(t.category))+'</div>' +
              '<div class="tx-main">' +
                '<div class="tx-desc">'+esc(t.subcategory || t.detail || t.category || '—')+'</div>' +
                '<div class="tx-meta">'+esc(t.category)+(t.detail?' · '+esc(t.detail):'')+(t.notes?' · '+esc(t.notes):'')+'</div>' +
              '</div>' +
              '<div class="tx-cat">'+esc(t.category||'')+'</div>' +
              '<div>'+ (t.paymentMethod ? '<span class="tx-pm">'+icon(pm)+esc(t.paymentMethod)+'</span>' : '') +'</div>' +
              '<div class="tx-amt'+(incomeStyle?' income':'')+'">'+esc(amt)+'</div>' +
              '<div class="tx-actions">' +
                '<button type="button" data-action="edit-tx" data-arg="'+t.id+'" aria-label="ערוך">'+icon('i-pencil')+'</button>' +
                '<button type="button" class="del" data-action="del-tx" data-arg="'+t.id+'" aria-label="מחק">'+icon('i-trash')+'</button>' +
              '</div>' +
            '</div>';
        });
      });
    }

    var formHtml = state.txEditing ? renderTxForm(state.txEditing, cats, subs, pms) : '';

    container.innerHTML =
      '<div class="card tx-card">' +
        '<div class="tx-head">' +
          '<div>' +
            '<div class="card-title">תנועות — '+esc(DB.monthLabel(state.month))+'</div>' +
            '<div class="card-sub">'+allTxs.length+' תנועות בחודש</div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
            '<div class="tx-filters">' +
              '<button class="tx-filter '+(state.txFilter==='all'?'active':'')+'" data-filter="all">הכל</button>' +
              '<button class="tx-filter '+(state.txFilter==='expense'?'active':'')+'" data-filter="expense">הוצאה</button>' +
              '<button class="tx-filter '+(state.txFilter==='income'?'active':'')+'" data-filter="income">הכנסה</button>' +
            '</div>' +
            '<div class="tx-search">' +
              icon('i-search') +
              '<input type="text" id="tx-search" placeholder="חיפוש…" value="'+esc(state.txSearch)+'"/>' +
            '</div>' +
            '<select class="select tx-payment-filter" id="tx-payment-filter">'+pmOpts+'</select>' +
            (showImport ? '<label class="btn btn-ghost btn-sm">'+icon('i-upload')+'ייבוא Excel<input type="file" id="import-xlsx" accept=".xlsx,.xls" class="hidden"/></label>' : '') +
            '<button class="btn btn-primary btn-sm" id="tx-new">'+icon('i-plus')+'תנועה חדשה</button>' +
          '</div>' +
        '</div>' +
        (formHtml ? '<div style="padding:0 24px 16px">'+formHtml+'</div>' : '') +
        rowsHtml +
      '</div>';

    document.getElementById('tx-new').addEventListener('click', function(){
      state.txEditing = { date: state.month + '-01', category:'', subcategory:'', amount:'', paymentMethod:'', detail:'', notes:'' };
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function(el){
      el.addEventListener('click', function(){
        state.txFilter = el.getAttribute('data-filter');
        render();
      });
    });
    var searchEl = document.getElementById('tx-search');
    if (searchEl) {
      searchEl.addEventListener('input', function(e){
        state.txSearch = e.target.value;
        // Debounced re-render on each input (cheap; dataset is small).
        clearTimeout(searchEl._t);
        searchEl._t = setTimeout(render, 120);
      });
    }
    var payFilterEl = document.getElementById('tx-payment-filter');
    if (payFilterEl) {
      payFilterEl.addEventListener('change', function(e){
        state.txPaymentFilter = e.target.value || 'all';
        render();
      });
    }
    var imp = document.getElementById('import-xlsx');
    if (imp) imp.addEventListener('change', importXlsxHandler);

    if (state.txEditing) bindTxFormEvents();
  }

  function renderTxForm(t, cats, subs, pms) {
    var catOpts = '<option value="">— בחר —</option>' + cats.map(function(c){
      return '<option value="'+esc(c.name)+'"'+(t.category===c.name?' selected':'')+'>'+esc(c.name)+'</option>';
    }).join('');
    var descs = subs[t.category] || [];
    var subOpts = '<option value="">— בחר —</option>' + descs.map(function(d){
      return '<option value="'+esc(d)+'"'+(t.subcategory===d?' selected':'')+'>'+esc(d)+'</option>';
    }).join('');
    var pmOpts = '<option value="">— בחר —</option>' + pms.map(function(p){
      return '<option value="'+esc(p.name)+'"'+(t.paymentMethod===p.name?' selected':'')+'>'+esc(p.name)+'</option>';
    }).join('');

    return '<div class="edit-form">' +
      '<div class="grid grid-cols-4">' +
        '<label class="field"><span>תאריך</span><input type="date" class="input num" id="f-date" value="'+esc(t.date||'')+'"/></label>' +
        '<label class="field"><span>קטגוריה</span><select class="select" id="f-cat">'+catOpts+'</select></label>' +
        '<label class="field"><span>תיאור</span><select class="select" id="f-sub" '+(!t.category?'disabled':'')+'>'+subOpts+'</select></label>' +
        '<label class="field"><span>סכום</span><input type="number" step="0.01" class="input num" id="f-amt" value="'+esc(t.amount)+'"/></label>' +
        '<label class="field"><span>אמצעי תשלום</span><select class="select" id="f-pm">'+pmOpts+'</select></label>' +
        '<label class="field"><span>פירוט</span><input class="input" id="f-det" value="'+esc(t.detail||'')+'"/></label>' +
        '<label class="field" style="grid-column: span 2"><span>הערות</span><input class="input" id="f-not" value="'+esc(t.notes||'')+'"/></label>' +
      '</div>' +
      '<div class="flex gap-2 mt-3" style="justify-content:flex-end">' +
        '<button class="btn btn-ghost" id="f-cancel">ביטול</button>' +
        '<button class="btn btn-primary" id="f-save">שמור</button>' +
      '</div>' +
    '</div>';
  }

  function bindTxFormEvents() {
    var get = function(id){ return document.getElementById(id); };
    get('f-cat').addEventListener('change', function(e){
      state.txEditing.category = e.target.value;
      state.txEditing.subcategory = '';
      render();
    });
    get('f-cancel').addEventListener('click', function(){ state.txEditing = null; render(); });
    get('f-save').addEventListener('click', function(){
      var t = {
        id: state.txEditing.id,
        date: get('f-date').value,
        category: get('f-cat').value,
        subcategory: get('f-sub').value,
        amount: Number(get('f-amt').value)||0,
        paymentMethod: get('f-pm').value,
        detail: get('f-det').value,
        notes:  get('f-not').value,
      };
      if (!t.date || !t.category || !t.amount) { alert('חובה: תאריך, קטגוריה וסכום'); return; }
      DB.upsertTransaction(t);
      state.txEditing = null;
      render();
    });
  }

  // ------------------------------------------------------------
  // Yearly summary
  // ------------------------------------------------------------
  function renderYearly(argYear) {
    var y = Math.max(MIN_YEAR, Number(argYear) || state.year);
    state.year = y;
    var data = CALC.yearlySummary(y);

    var yearOpts = '';
    for (var yy = MIN_YEAR; yy <= MAX_YEAR; yy++) {
      yearOpts += '<option value="'+yy+'"'+(yy===y?' selected':'')+'>'+yy+'</option>';
    }

    var rowsHtml = data.rows.map(function(r){
      return '<tr>' +
        '<td>'+esc(DB.monthLabel(r.month))+'</td>' +
        '<td class="num">'+CALC.fmt(r.income)+'</td>' +
        '<td class="num">'+CALC.fmt(r.expense)+'</td>' +
        '<td class="num">'+CALC.fmt(r.budget)+'</td>' +
        '<td class="num '+(r.net>=0?'text-em':'text-red')+'" style="font-weight:600">'+CALC.fmt(r.net)+'</td>' +
      '</tr>';
    }).join('');

    document.getElementById('page').innerHTML =
      '<div class="grid">' +
        '<div class="card flex-between">' +
          '<div>' +
            '<div class="card-title">סיכום שנתי</div>' +
            '<div class="card-sub">תצוגת כל החודשים בשנה</div>' +
          '</div>' +
          '<select class="select w-auto" id="year-picker">'+yearOpts+'</select>' +
        '</div>' +
        '<div class="grid grid-cols-4">' +
          kpi('הכנסות שנתי',  CALC.fmt(data.totals.income),  'good',   'i-coin') +
          kpi('הוצאות שנתי',  CALC.fmt(data.totals.expense), 'accent', 'i-bag') +
          kpi('תקציב שנתי',   CALC.fmt(data.totals.budget),  '',       'i-scales') +
          kpi('מאזן שנתי',    CALC.fmt(data.totals.net),     data.totals.net>=0?'good':'bad', 'i-spark') +
        '</div>' +
        (window.Chart ? '<div class="card hide-mobile"><div class="chart-canvas-wrap"><canvas id="c-year"></canvas></div></div>' : '') +
        '<div class="card"><div class="scroll-x"><table class="tbl">' +
          '<thead><tr><th>חודש</th><th>הכנסות</th><th>הוצאות</th><th>תקציב</th><th>מאזן</th></tr></thead>' +
          '<tbody>'+rowsHtml +
            '<tr class="totals">' +
              '<td>סה"כ שנתי</td>' +
              '<td class="num">'+CALC.fmt(data.totals.income)+'</td>' +
              '<td class="num">'+CALC.fmt(data.totals.expense)+'</td>' +
              '<td class="num">'+CALC.fmt(data.totals.budget)+'</td>' +
              '<td class="num '+(data.totals.net>=0?'text-em':'text-red')+'">'+CALC.fmt(data.totals.net)+'</td>' +
            '</tr>' +
          '</tbody></table></div></div>' +
      '</div>';

    document.getElementById('year-picker').addEventListener('change', function(e){
      navigate('yearly', e.target.value);
    });

    if (window.Chart) {
      var good   = getComputedStyle(document.body).getPropertyValue('--good').trim()   || '#16a34a';
      var accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#dc2626';
      var ink    = getComputedStyle(document.body).getPropertyValue('--ink').trim()    || '#1e293b';
      var hair   = getComputedStyle(document.body).getPropertyValue('--hair').trim()   || '#e2e8f0';
      activeChartInstances.push(new Chart(document.getElementById('c-year'), {
        type:'bar',
        data:{ labels: data.rows.map(function(r){return DB.monthLabel(r.month);}),
               datasets:[
                 { label:'הכנסות', data: data.rows.map(function(r){return r.income;}),  backgroundColor: good,   borderRadius: 6 },
                 { label:'הוצאות', data: data.rows.map(function(r){return r.expense;}), backgroundColor: accent, borderRadius: 6 },
               ] },
        options:{
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ rtl:true, labels:{ color: ink } } },
          scales:{
            y:{ beginAtZero:true, ticks:{ color: ink }, grid:{ color: hair } },
            x:{ ticks:{ color: ink }, grid:{ display: false } },
          },
        },
      }));
    }
  }

  // ------------------------------------------------------------
  // Categories
  // ------------------------------------------------------------
  var selectedCat = null;
  function renderCategories() {
    var cats = DB.listCategories().sort(function(a,b){return a.order-b.order;});
    if (!selectedCat && cats[0]) selectedCat = cats[0].name;
    var subs = DB.listSubcategories();

    var catRows = cats.map(function(c){
      var isSel = selectedCat===c.name;
      return '<tr'+(isSel?' style="background:var(--accent-soft)"':'')+'>' +
        '<td><button class="btn btn-ghost btn-sm" style="width:100%;text-align:right;justify-content:flex-start" data-pick="'+esc(c.name)+'">'+icon(catIcon(c.name))+' '+esc(c.name)+'</button></td>' +
        '<td>'+(c.kind==='income'?'הכנסה':'הוצאה')+'</td>' +
        '<td><input type="number" class="input num" data-cat-budget="'+c.id+'" value="'+(c.budget||0)+'"/></td>' +
        '<td class="actions"><button class="btn btn-danger btn-sm" data-del-cat="'+c.id+'">מחק</button></td>' +
      '</tr>';
    }).join('');

    var subList = (subs[selectedCat]||[]).map(function(s){
      return '<li style="display:flex;justify-content:space-between;align-items:center;border:1px solid var(--hair);border-radius:10px;padding:8px 12px;margin-bottom:6px;background:var(--surface-soft)">' +
        '<span>'+esc(s)+'</span>' +
        '<button class="btn btn-danger btn-sm" data-del-sub="'+esc(s)+'">הסר</button>' +
      '</li>';
    }).join('');
    if (!subList) subList = '<li class="muted">אין תתי-קטגוריה</li>';

    document.getElementById('page').innerHTML =
      '<div class="grid grid-cols-2">' +
        '<div class="card">' +
          '<div class="card-head"><div class="card-title">קטגוריות ראשיות</div></div>' +
          '<div class="scroll-x"><table class="tbl">' +
            '<thead><tr><th>שם</th><th>סוג</th><th>תקציב ברירת-מחדל</th><th></th></tr></thead>' +
            '<tbody>'+catRows+'</tbody>' +
          '</table></div>' +
          '<div class="flex gap-2 mt-3">' +
            '<input class="input" id="new-cat" placeholder="שם קטגוריה חדשה"/>' +
            '<button class="btn btn-primary" id="add-cat">הוסף</button>' +
          '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-head"><div class="card-title">תתי-קטגוריה של "'+esc(selectedCat||'—')+'"</div></div>' +
          (selectedCat ?
            '<div class="flex gap-2 mb-3">' +
              '<input class="input" id="new-sub" placeholder="תיאור חדש"/>' +
              '<button class="btn btn-primary" id="add-sub">הוסף</button>' +
            '</div>' +
            '<ul style="list-style:none;padding:0;margin:0">'+subList+'</ul>'
            : '') +
        '</div>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('[data-pick]'), function(el){
      el.addEventListener('click', function(){ selectedCat = el.getAttribute('data-pick'); render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-cat-budget]'), function(el){
      el.addEventListener('change', function(e){
        var id = el.getAttribute('data-cat-budget');
        var c = DB.listCategories().find(function(x){return x.id===id;});
        DB.upsertCategory(Object.assign({}, c, { budget: Number(e.target.value)||0 }));
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-del-cat]'), function(el){
      el.addEventListener('click', function(){
        if (confirm('למחוק קטגוריה זו?')) { DB.deleteCategory(el.getAttribute('data-del-cat')); render(); }
      });
    });
    document.getElementById('add-cat').addEventListener('click', function(){
      var v = document.getElementById('new-cat').value.trim();
      if (v) { DB.upsertCategory({ name:v, kind:'expense', budget:0 }); render(); }
    });
    if (selectedCat) {
      document.getElementById('add-sub').addEventListener('click', function(){
        var v = document.getElementById('new-sub').value.trim();
        if (v) { DB.addSubcategory(selectedCat, v); render(); }
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-del-sub]'), function(el){
        el.addEventListener('click', function(){
          DB.removeSubcategory(selectedCat, el.getAttribute('data-del-sub')); render();
        });
      });
    }
  }

  // ------------------------------------------------------------
  // Payment methods
  // ------------------------------------------------------------
  function renderPayments() {
    var pms = DB.listPaymentMethods();
    var rowsHtml = pms.map(function(pm){
      var acctOpts = '<option value=""'+(pm.account===null?' selected':'')+'>ללא</option>' +
                     '<option value="1"'+(pm.account===1?' selected':'')+'>חשבון 1</option>' +
                     '<option value="2"'+(pm.account===2?' selected':'')+'>חשבון 2</option>';
      return '<tr>' +
        '<td><input class="input" data-pm-name="'+pm.id+'" value="'+esc(pm.name)+'"/></td>' +
        '<td><input class="input" data-pm-group="'+pm.id+'" value="'+esc(pm.group||'')+'"/></td>' +
        '<td><select class="select" data-pm-acct="'+pm.id+'">'+acctOpts+'</select></td>' +
        '<td class="actions"><button class="btn btn-danger btn-sm" data-del-pm="'+pm.id+'">מחק</button></td>' +
      '</tr>';
    }).join('');

    document.getElementById('page').innerHTML =
      '<div class="card">' +
        '<div class="card-head"><div class="card-title">אמצעי תשלום</div></div>' +
        '<div class="scroll-x"><table class="tbl">' +
          '<thead><tr><th>שם</th><th>קבוצה</th><th>חשבון</th><th></th></tr></thead>' +
          '<tbody>'+rowsHtml+'</tbody>' +
        '</table></div>' +
        '<div class="grid grid-cols-4 mt-3">' +
          '<input class="input" id="np-name" placeholder="שם"/>' +
          '<input class="input" id="np-group" placeholder="קבוצה"/>' +
          '<select class="select" id="np-acct"><option value="">ללא חשבון</option><option value="1">חשבון 1</option><option value="2">חשבון 2</option></select>' +
          '<button class="btn btn-primary" id="np-add">הוסף</button>' +
        '</div>' +
      '</div>';

    function upd(id, patch) {
      var pm = DB.listPaymentMethods().find(function(x){return x.id===id;});
      DB.upsertPaymentMethod(Object.assign({}, pm, patch));
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-pm-name]'), function(el){
      el.addEventListener('change', function(e){ upd(el.getAttribute('data-pm-name'), { name: e.target.value }); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pm-group]'), function(el){
      el.addEventListener('change', function(e){ upd(el.getAttribute('data-pm-group'), { group: e.target.value }); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pm-acct]'), function(el){
      el.addEventListener('change', function(e){
        var v = e.target.value; upd(el.getAttribute('data-pm-acct'), { account: v===''?null:Number(v) });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-del-pm]'), function(el){
      el.addEventListener('click', function(){ if (confirm('למחוק?')) { DB.deletePaymentMethod(el.getAttribute('data-del-pm')); render(); } });
    });
    document.getElementById('np-add').addEventListener('click', function(){
      var name = document.getElementById('np-name').value.trim();
      var group = document.getElementById('np-group').value.trim();
      var acct = document.getElementById('np-acct').value;
      if (!name) return;
      DB.upsertPaymentMethod({ name: name, group: group||name, account: acct===''?null:Number(acct) });
      render();
    });
  }

  // ------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------
  function renderSettings() {
    var s = DB.getSettings();
    var checked = s.darkMode ? 'checked' : '';

    var cats = DB.listCategories();
    var incomeCat = cats.find(function(c){ return c.kind==='income'; });
    var base = incomeCat ? (DB.listSubcategories()[incomeCat.name] || []) : [];
    var adds = DB.getIncomeAdditions();
    var seen = {}, names = [];
    base.forEach(function(n){ if (!seen[n]) { seen[n]=1; names.push(n); } });
    Object.keys(adds).forEach(function(m){
      (adds[m]||[]).forEach(function(n){ if (!seen[n]) { seen[n]=1; names.push(n); } });
    });
    var pdGlobal = incomeCat && incomeCat.projectedDefault!=null ? incomeCat.projectedDefault : 7500;
    var pdMap = (incomeCat && incomeCat.projectedDefaults) || {};

    var incomeDefaultsHtml = names.map(function(n){
      var v = pdMap[n] != null ? Number(pdMap[n]) : pdGlobal;
      return '<tr>' +
        '<td>'+esc(n)+'</td>' +
        '<td><input type="number" class="input num inline-edit" data-inc-default="'+esc(n)+'" value="'+v+'"/></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="2" class="text-center muted">אין סוגי הכנסה</td></tr>';

    document.getElementById('page').innerHTML =
      '<div class="grid" style="max-width:680px">' +
        '<div class="card">' +
          '<div class="flex-between">' +
            '<div>' +
              '<div class="card-title">מצב תצוגה</div>' +
              '<div class="card-sub">החלפה בין מצב בהיר למצב כהה</div>' +
            '</div>' +
            '<label class="switch">' +
              '<input type="checkbox" id="s-dark" '+checked+'/>' +
              '<span class="slider"></span>' +
            '</label>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-head"><div>' +
            '<div class="card-title">ערכי ברירת-מחדל להכנסות</div>' +
            '<div class="card-sub">כל חודש יתחיל עם הערכים האלה, עד שיועבר להם ערך אחר.</div>' +
          '</div></div>' +
          '<table class="tbl">' +
            '<thead><tr><th>סוג הכנסה</th><th>סכום ברירת-מחדל</th></tr></thead>' +
            '<tbody>'+incomeDefaultsHtml+'</tbody>' +
          '</table>' +
          '<label class="field mt-3"><span>ברירת-מחדל כללית (כאשר אין ערך ספציפי)</span>' +
            '<input type="number" class="input num inline-edit" id="s-inc-global" value="'+pdGlobal+'"/>' +
          '</label>' +
        '</div>' +
      '</div>';

    document.getElementById('s-dark').addEventListener('change', function(e){
      DB.setSettings({ darkMode: !!e.target.checked });
      applyTheme();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-inc-default]'), function(el){
      el.addEventListener('change', function(e){
        var name = el.getAttribute('data-inc-default');
        var incs = DB.listCategories();
        var inc = incs.find(function(c){ return c.kind==='income'; });
        if (!inc) return;
        var map = Object.assign({}, inc.projectedDefaults || {});
        map[name] = Number(e.target.value)||0;
        DB.upsertCategory(Object.assign({}, inc, { projectedDefaults: map }));
      });
    });
    var incGlobal = document.getElementById('s-inc-global');
    if (incGlobal) incGlobal.addEventListener('change', function(e){
      var incs = DB.listCategories();
      var inc = incs.find(function(c){ return c.kind==='income'; });
      if (!inc) return;
      DB.upsertCategory(Object.assign({}, inc, { projectedDefault: Number(e.target.value)||0 }));
    });
  }

  // ------------------------------------------------------------
  // Import / Export
  // ------------------------------------------------------------
  function normalizeImportedCategoryName(name) {
    if (name === null || name === undefined) return '';
    return String(name).replace(/_/g, ' ').trim();
  }

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function exportAllJson() {
    var snap = {
      categories: DB.listCategories(),
      subcategories: DB.listSubcategories(),
      paymentMethods: DB.listPaymentMethods(),
      budgets: DB.getBudgetsMap(),
      transactions: DB.listTransactions(),
      settings: DB.getSettings(),
    };
    downloadBlob(new Blob([JSON.stringify(snap,null,2)], { type:'application/json' }), 'budgetplus-backup.json');
  }
  function importAllJson(e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function(){
      try {
        var data = JSON.parse(r.result);
        if (data.categories) {
          data.categories = data.categories.map(function(c){
            return Object.assign({}, c, { name: normalizeImportedCategoryName(c.name) });
          });
          localStorage.setItem('budgetplus.categories', JSON.stringify(data.categories));
        }
        if (data.subcategories) {
          var normalizedSubs = {};
          Object.keys(data.subcategories).forEach(function(k){
            normalizedSubs[normalizeImportedCategoryName(k)] = data.subcategories[k];
          });
          localStorage.setItem('budgetplus.subcategories', JSON.stringify(normalizedSubs));
        }
        if (data.paymentMethods) localStorage.setItem('budgetplus.paymentMethods', JSON.stringify(data.paymentMethods));
        if (data.budgets) {
          var normalizedBudgets = {};
          Object.keys(data.budgets).forEach(function(ym){
            var row = data.budgets[ym] || {};
            normalizedBudgets[ym] = {};
            Object.keys(row).forEach(function(cat){
              normalizedBudgets[ym][normalizeImportedCategoryName(cat)] = row[cat];
            });
          });
          localStorage.setItem('budgetplus.budgets', JSON.stringify(normalizedBudgets));
        }
        if (data.transactions) {
          data.transactions = data.transactions.map(function(t){
            return Object.assign({}, t, { category: normalizeImportedCategoryName(t.category) });
          });
          localStorage.setItem('budgetplus.transactions', JSON.stringify(data.transactions));
        }
        if (data.settings)       localStorage.setItem('budgetplus.settings', JSON.stringify(data.settings));
        alert('הנתונים יובאו בהצלחה'); location.reload();
      } catch (err) { alert('קובץ לא תקין: '+err.message); }
    };
    r.readAsText(f);
  }

  function exportMonthXlsx(month) {
    if (!window.XLSX) { alert('SheetJS לא נטען — ייצוא Excel לא זמין. ניתן לייצא JSON בהגדרות.'); return; }
    var s = CALC.monthlySummary(month);
    var wb = XLSX.utils.book_new();
    var summary = [
      ['דוח הוצאות והכנסות עבור חודש '+DB.monthLabel(month)], [],
      ['הכנסות משוער','סוג הוצאה','תקציב','חיוב בפועל','יתרה בפועל'],
    ];
    s.expenseRows.forEach(function(r,i){
      summary.push([ s.incomeLines[i] ? s.incomeLines[i].projected : '', r.category, r.budget, r.actual, r.remaining ]);
    });
    summary.push(['סה"כ','', s.totals.budget, s.totals.actual, s.totals.remaining]);
    summary.push([]); summary.push(['סה"כ הכנסות (משוער)', s.incomeTotal]); summary.push(['מאזן', s.net]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'סיכום');

    var txHdr = ['תאריך','קטגוריה','תיאור','סכום','אמצעי תשלום','פירוט','הערות'];
    var txRows = s.transactions.map(function(t){
      return [t.date, t.category, t.subcategory, t.amount, t.paymentMethod, t.detail||'', t.notes||''];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([txHdr].concat(txRows)), 'תנועות');
    XLSX.writeFile(wb, 'budgetplus-'+month+'.xlsx');
  }

  function importXlsxHandler(e) {
    if (!window.XLSX) { alert('SheetJS לא נטען — ייבוא Excel לא זמין.'); return; }
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function(){
      try {
        var wb = XLSX.read(r.result, { type:'binary' });
        var imported = 0;
        wb.SheetNames.forEach(function(name){
          var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1 });
          var hdrIdx = -1;
          for (var i = 0; i < aoa.length; i++) {
            var row = aoa[i];
            if (row && row.indexOf('סכום')!==-1 && (row.indexOf('קטגוריה')!==-1 || row.indexOf('תיאור')!==-1)) { hdrIdx = i; break; }
          }
          if (hdrIdx === -1) return;
          var hdr = aoa[hdrIdx].map(function(x){ return String(x); });
          function col(h) { return hdr.findIndex(function(x){ return x.trim()===h; }); }
          var cDate = col('ת. העסקה'); if (cDate===-1) cDate = col('תאריך');
          var cCat = col('קטגוריה'), cSub = col('תיאור'), cAmt = col('סכום');
          var cPay = col('א. תשלום'); if (cPay===-1) cPay = col('אמצעי תשלום');
          var cDet = col('פירוט'), cNot = col('הערות');
          var rows = [];
          for (var j = hdrIdx+1; j < aoa.length; j++) {
            var rr = aoa[j]; if (!rr || !rr[cAmt]) continue;
            var date = rr[cDate];
            if (typeof date === 'number') {
              var d = XLSX.SSF.parse_date_code(date);
              if (d) date = d.y + '-' + String(d.m).padStart(2,'0') + '-' + String(d.d).padStart(2,'0');
            } else if (date instanceof Date) {
              date = date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
            } else if (!date) continue;
            rows.push({
              date: String(date).slice(0,10),
              category: normalizeImportedCategoryName(rr[cCat] || ''),
              subcategory: rr[cSub] || '',
              amount: Number(rr[cAmt])||0,
              paymentMethod: rr[cPay] || '',
              detail: rr[cDet] || '',
              notes: rr[cNot] || '',
            });
          }
          DB.bulkInsertTransactions(rows);
          imported += rows.length;
        });
        alert('יובאו '+imported+' תנועות'); render();
      } catch (err) { alert('שגיאת ייבוא: '+err.message); }
    };
    r.readAsBinaryString(f);
  }

  // ------------------------------------------------------------
  // Global delegated click handler
  // ------------------------------------------------------------
  document.addEventListener('click', function(e){
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    var arg = el.getAttribute('data-arg');
    switch (action) {
      case 'open-income-modal': {
        state.incomeModalOpen = true;
        state.expenseModalOpen = false;
        render();
        break;
      }
      case 'close-income-modal': {
        state.incomeModalOpen = false;
        render();
        break;
      }
      case 'close-income-modal-backdrop': {
        if (e.target !== el) return;
        state.incomeModalOpen = false;
        render();
        break;
      }
      case 'open-expense-modal': {
        state.expenseModalOpen = true;
        state.incomeModalOpen = false;
        render();
        break;
      }
      case 'close-expense-modal': {
        state.expenseModalOpen = false;
        render();
        break;
      }
      case 'close-expense-modal-backdrop': {
        if (e.target !== el) return;
        state.expenseModalOpen = false;
        render();
        break;
      }
      case 'edit-tx': {
        var t = DB.listTransactions().find(function(x){ return x.id === arg; });
        if (t) { state.txEditing = Object.assign({}, t); render(); }
        break;
      }
      case 'del-tx': {
        if (!confirm('למחוק תנועה זו?')) return;
        DB.deleteTransaction(arg);
        render();
        break;
      }
      case 'add-income': {
        var input = document.getElementById('new-income');
        var name = input && input.value.trim();
        if (!name) return;
        DB.addIncomeForMonth(state.month, name);
        state.incomeModalOpen = true;
        render();
        break;
      }
      case 'del-income': {
        if (!confirm('להסיר את סוג ההכנסה "'+arg+'" מחודש זה בלבד?')) return;
        DB.removeIncomeForMonth(state.month, arg);
        state.incomeModalOpen = true;
        render();
        break;
      }
    }
  });

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && state.incomeModalOpen) {
      state.incomeModalOpen = false;
      render();
      return;
    }
    if (e.key === 'Escape' && state.expenseModalOpen) {
      state.expenseModalOpen = false;
      render();
    }
  });

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  function boot() {
    DB.ensureSeed();
    DB.migrateUnderscores();
    DB.migratePaymentMethods();
    DB.repairIds();
    applyTheme();
    state.month = clampMonth(DB.getSettings().defaultMonth || DB.currentMonth());
    window.addEventListener('hashchange', render);
    render();
  }

  window.APP = {
    rerender: function(){ applyTheme(); render(); },
  };

  if (window.AUTH) window.AUTH.onReady(boot);
  else boot();
})();
