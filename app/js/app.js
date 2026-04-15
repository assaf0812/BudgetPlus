// Vanilla-JS single-page app. No modules, no React. Pure DOM + template strings.
(function () {
  DB.ensureSeed();
  DB.migrateUnderscores();
  DB.migratePaymentMethods();
  DB.repairIds();

  var ROUTES = [
    { path:'dashboard',  label:'דשבורד',       icon:'📊' },
    { path:'month',      label:'חודש נוכחי',    icon:'📅' },
    { path:'yearly',     label:'סיכום שנתי',    icon:'📈' },
    { path:'categories', label:'קטגוריות',      icon:'🗂️' },
    { path:'payments',   label:'אמצעי תשלום',   icon:'💰' },
    { path:'settings',   label:'הגדרות',        icon:'⚙️' },
  ];
  var MIN_MONTH = '2026-01';
  var MIN_YEAR  = 2026;
  var MAX_YEAR  = 2035;

  // Global app state
  function clampMonth(m) { return (!m || m < MIN_MONTH) ? MIN_MONTH : m; }
  var state = {
    month: clampMonth(DB.getSettings().defaultMonth || DB.currentMonth()),
    year:  Math.max(MIN_YEAR, new Date().getFullYear()),
    txEditing: null,
  };
  var activeChartInstances = [];

  function esc(s) {
    if (s===null || s===undefined) return '';
    return String(s).replace(/[&<>"']/g, function(c){ return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; });
  }
  function currentRoute() {
    var h = (location.hash || '#/dashboard').replace(/^#\//,'');
    var parts = h.split('/');
    return { page: parts[0] || 'dashboard', arg: parts[1] };
  }
  function navigate(page, arg) {
    location.hash = '#/' + page + (arg ? '/'+arg : '');
  }
  function destroyCharts() {
    activeChartInstances.forEach(function(c){ try { c.destroy(); } catch(e){} });
    activeChartInstances = [];
  }

  // ------------------------------------------------------------
  // Render shell
  // ------------------------------------------------------------
  function render() {
    destroyCharts();
    var r = currentRoute();
    var title = (ROUTES.find(function(x){return x.path===r.page;}) || ROUTES[0]).label;
    var showMonth = ['dashboard','month','transactions'].indexOf(r.page) !== -1;

    var root = document.getElementById('root');
    root.innerHTML =
      '<div class="app">' +
        renderSidebar(r.page) +
        '<main>' +
          '<header class="topbar">' +
            '<h1>'+esc(title)+'</h1>' +
            '<div class="flex gap-2">' + (showMonth ? renderMonthPicker() : '') + '</div>' +
          '</header>' +
          '<div class="content" id="page"></div>' +
        '</main>' +
      '</div>';

    attachSidebarEvents();
    if (showMonth) attachMonthPickerEvents();

    switch (r.page) {
      case 'dashboard':    renderDashboard(); break;
      case 'month':        renderMonth(); break;
      case 'transactions': renderTransactions(); break;
      case 'yearly':       renderYearly(r.arg); break;
      case 'categories':   renderCategories(); break;
      case 'payments':     renderPayments(); break;
      case 'settings':     renderSettings(); break;
      default:             renderDashboard();
    }
  }

  function renderSidebar(active) {
    var links = ROUTES.map(function(r){
      return '<a class="nav-link '+(active===r.path?'active':'')+'" href="#/'+r.path+'">' +
             '<span>'+r.icon+'</span><span>'+esc(r.label)+'</span></a>';
    }).join('');
    return '<aside class="sidebar">' +
             '<div class="logo"><div class="badge">₪</div>' +
               '<div><div style="font-weight:700">BudgetPlus</div>' +
               '<div style="font-size:12px;color:#64748b">ניהול תקציב חכם</div></div>' +
             '</div>' +
             '<nav>'+links+'</nav>' +
           '</aside>';
  }
  function attachSidebarEvents() { /* plain anchor hrefs handle nav */ }

  function renderMonthPicker() {
    // Fixed range: Jan 2026 .. Dec MAX_YEAR
    var months = [];
    for (var y = MIN_YEAR; y <= MAX_YEAR; y++) {
      for (var m = 1; m <= 12; m++) months.push(y + '-' + String(m).padStart(2,'0'));
    }
    var opts = months.map(function(m){
      return '<option value="'+m+'"'+(m===state.month?' selected':'')+'>'+esc(DB.monthLabel(m))+'</option>';
    }).join('');
    return '<label class="flex gap-2" style="align-items:center;font-size:14px">' +
           '<span class="muted">חודש:</span>' +
           '<select class="select w-auto" id="month-picker">'+opts+'</select>' +
           '</label>';
  }
  function attachMonthPickerEvents() {
    var el = document.getElementById('month-picker');
    if (el) el.addEventListener('change', function(e){ state.month = e.target.value; render(); });
  }

  // ------------------------------------------------------------
  // Dashboard
  // ------------------------------------------------------------
  function renderDashboard() {
    var s = CALC.monthlySummary(state.month);
    var pmPivot = CALC.paymentMethodPivot(state.month);

    var kpis =
      kpi('הכנסות (חודש)', CALC.fmt(s.incomeTotal), 'text-em') +
      kpi('תקציב הוצאות',  CALC.fmt(s.totals.budget)) +
      kpi('הוצאות בפועל',  CALC.fmt(s.totals.actual), 'text-red') +
      kpi('מאזן',           CALC.fmt(s.net), s.net>=0?'text-em':'text-red');

    var pmRows = pmPivot.map(function(r){
      var total = r.acct1+r.acct2+r.none;
      return '<tr><td>'+esc(r.group)+'</td>' +
             '<td class="num" style="font-weight:600">'+CALC.fmt(total)+'</td></tr>';
    }).join('');

    document.getElementById('page').innerHTML =
      '<div class="grid">' +
        '<div class="flex-between">' +
          '<h2 style="font-weight:600;font-size:18px">דשבורד — '+esc(DB.monthLabel(state.month))+'</h2>' +
        '</div>' +
        '<div class="grid grid-cols-4">'+kpis+'</div>' +
        '<div class="card">' +
          '<div class="charts-row">' +
            (window.Chart ?
              '<div class="chart-box chart-pie">' +
                '<div style="font-weight:600;margin-bottom:8px">פילוח הוצאות</div>' +
                '<div class="chart-canvas-wrap"><canvas id="c-pie"></canvas></div>' +
              '</div>' +
              '<div class="chart-box chart-bar">' +
                '<div style="font-weight:600;margin-bottom:8px">תקציב מול ביצוע</div>' +
                '<div class="chart-canvas-wrap"><canvas id="c-bar"></canvas></div>' +
              '</div>'
            : '<div class="muted">הגרפים לא נטענו (Chart.js לא זמין).</div>') +
            '<div class="chart-box chart-pm">' +
              '<div style="font-weight:600;margin-bottom:8px">פילוח לפי אמצעי תשלום</div>' +
              '<div class="pm-table-wrap"><table class="tbl">' +
                '<thead><tr><th>קבוצה</th><th>סה"כ</th></tr></thead>' +
                '<tbody>'+(pmRows || '<tr><td colspan="2" class="text-center muted">אין נתונים</td></tr>')+'</tbody>' +
              '</table></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (window.Chart) {
      var colors = ['#2563eb','#7c3aed','#db2777','#ea580c','#16a34a','#0891b2','#facc15','#64748b','#9333ea','#22c55e'];
      activeChartInstances.push(new Chart(document.getElementById('c-pie'), {
        type:'doughnut',
        data:{ labels: s.expenseRows.map(function(r){return r.category;}),
               datasets:[{ data: s.expenseRows.map(function(r){return r.actual;}), backgroundColor: colors }] },
        options:{
          plugins:{ legend:{ position:'left', rtl:true, labels:{ boxWidth:10, boxHeight:10, padding:6, font:{ size:11 } } } },
          maintainAspectRatio:false,
        },
      }));
      activeChartInstances.push(new Chart(document.getElementById('c-bar'), {
        type:'bar',
        data:{ labels: s.expenseRows.map(function(r){return r.category;}),
               datasets:[
                 { label:'תקציב', data: s.expenseRows.map(function(r){return r.budget;}), backgroundColor:'#cbd5e1' },
                 { label:'בפועל', data: s.expenseRows.map(function(r){return r.actual;}), backgroundColor:'#2563eb' },
               ] },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ rtl:true } }, scales:{ y:{ beginAtZero:true } } },
      }));
    }
  }
  function kpi(label, value, cls) {
    return '<div class="kpi"><div class="label">'+esc(label)+'</div>' +
           '<div class="value '+(cls||'')+'">'+esc(value)+'</div></div>';
  }

  // ------------------------------------------------------------
  // Month view (Excel B6:F17) + transaction table
  // ------------------------------------------------------------
  function renderMonth() {
    var s = CALC.monthlySummary(state.month);

    var expenseRowsHtml = s.expenseRows.map(function(r){
      var status = CALC.budgetStatus(r.utilization, r.remaining);
      return '<tr>' +
        '<td style="font-weight:500">'+esc(r.category)+'</td>' +
        '<td><input type="number" class="input num inline-edit" data-budget-cat="'+esc(r.category)+'" value="'+r.budget+'" /></td>' +
        '<td class="num">'+CALC.fmt(r.actual)+'</td>' +
        '<td class="num '+(r.remaining<0?'text-red':'text-em')+'" style="font-weight:600">'+CALC.fmt(r.remaining)+'</td>' +
        '<td><span class="pill '+status+'">'+(r.budget>0 ? Math.round(r.utilization*100)+'%' : '—')+'</span></td>' +
      '</tr>';
    }).join('');
    var totalStatusCls = s.totals.remaining<0 ? 'text-red' : 'text-em';

    var incomeRowsHtml = s.incomeLines.map(function(l){
      return '<tr>' +
        '<td>'+esc(l.description)+'</td>' +
        '<td><input type="number" class="input num inline-edit" data-income-default="'+esc(l.description)+'" value="'+l.projectedDefault+'"/></td>' +
        '<td class="num text-em" style="font-weight:600">'+CALC.fmt(l.projected)+'</td>' +
        '<td class="actions"><button type="button" class="btn btn-danger btn-sm" data-action="del-income" data-arg="'+esc(l.description)+'">הסר</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="4" class="text-center muted">אין סוגי הכנסה מוגדרים</td></tr>';

    document.getElementById('page').innerHTML =
      '<div class="grid">' +
        '<div class="flex-between mb-3">' +
          '<h2 style="font-weight:600;font-size:18px">דוח הוצאות והכנסות עבור חודש '+esc(DB.monthLabel(state.month))+'</h2>' +
          '<div class="flex gap-2">' +
            '<button class="btn btn-ghost" id="export-month">ייצוא ל-Excel</button>' +
          '</div>' +
        '</div>' +

        '<div class="grid grid-cols-2">' +
          '<div class="card">' +
            '<h3 style="font-weight:600;margin-bottom:12px">הכנסות (משוער)</h3>' +
            '<div class="scroll-x"><table class="tbl">' +
              '<thead><tr><th>סוג הכנסה</th><th>ברירת-מחדל</th><th>משוער</th><th></th></tr></thead>' +
              '<tbody>' + incomeRowsHtml +
                '<tr style="background:#f1f5f9;font-weight:700">' +
                  '<td>סה"כ הכנסות</td>' +
                  '<td></td>' +
                  '<td class="num text-em">'+CALC.fmt(s.incomeTotal)+'</td>' +
                  '<td></td>' +
                '</tr>' +
              '</tbody>' +
            '</table></div>' +
            '<div class="flex gap-2 mt-3">' +
              '<input class="input" id="new-income" placeholder="סוג הכנסה חדש"/>' +
              '<button type="button" class="btn btn-primary" data-action="add-income">+ הוסף</button>' +
            '</div>' +
            '<p class="muted" style="font-size:12px;margin-top:8px">* אם לא נרשמה הכנסה בפועל לסוג מסוים, נלקח ערך ברירת-המחדל (לדוגמה ₪7,500).</p>' +
          '</div>' +

          '<div class="card">' +
            '<h3 style="font-weight:600;margin-bottom:12px">הוצאות</h3>' +
            '<div class="scroll-x"><table class="tbl">' +
              '<thead><tr><th>סוג הוצאה</th><th>תקציב</th><th>חיוב בפועל</th><th>יתרה בפועל</th><th>ניצול</th></tr></thead>' +
              '<tbody>' + expenseRowsHtml +
                '<tr style="background:#f1f5f9;font-weight:700">' +
                  '<td>סה"כ</td>' +
                  '<td class="num">'+CALC.fmt(s.totals.budget)+'</td>' +
                  '<td class="num">'+CALC.fmt(s.totals.actual)+'</td>' +
                  '<td class="num '+totalStatusCls+'">'+CALC.fmt(s.totals.remaining)+'</td>' +
                  '<td></td>' +
                '</tr>' +
              '</tbody>' +
            '</table></div>' +
          '</div>' +
        '</div>' +

        '<div class="card" style="background:linear-gradient(135deg,#eef6ff,#fff);border:1px solid #bfdbfe">' +
          '<div class="flex-between">' +
            '<div>' +
              '<div class="muted" style="font-size:12px">מאזן חודשי (הכנסות − הוצאות)</div>' +
              '<div class="num" style="font-size:28px;font-weight:700" class="'+(s.net>=0?'text-em':'text-red')+'">'+CALC.fmt(s.net)+'</div>' +
            '</div>' +
            '<div class="muted" style="font-size:13px">' +
              'הכנסות: '+CALC.fmt(s.incomeTotal)+' | הוצאות: '+CALC.fmt(s.totals.actual) +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div id="tx-container"></div>' +
      '</div>';

    // Bind budget inline edits
    Array.prototype.forEach.call(document.querySelectorAll('[data-budget-cat]'), function(el){
      el.addEventListener('change', function(e){
        DB.setMonthBudget(state.month, el.getAttribute('data-budget-cat'), e.target.value);
        render();
      });
    });
    // Bind income-default inline edits (persist per-subcategory on income category)
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

    renderTxTable(document.getElementById('tx-container'), true);
  }

  // ------------------------------------------------------------
  // Transactions page
  // ------------------------------------------------------------
  function renderTransactions() {
    document.getElementById('page').innerHTML = '<div id="tx-container"></div>';
    renderTxTable(document.getElementById('tx-container'), true);
  }

  function renderTxTable(container, showImport) {
    var txs = DB.listTxByMonth(state.month).slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    var cats = DB.listCategories();
    var subs = DB.listSubcategories();
    var pms  = DB.listPaymentMethods();

    var rowsHtml = txs.length === 0
      ? '<tr><td colspan="8" class="text-center muted">אין תנועות בחודש זה</td></tr>'
      : txs.map(function(t){
        return '<tr>' +
          '<td class="num">'+esc(t.date)+'</td>' +
          '<td>'+esc(t.category)+'</td>' +
          '<td>'+esc(t.subcategory)+'</td>' +
          '<td class="num" style="font-weight:500">'+CALC.fmt(t.amount)+'</td>' +
          '<td>'+esc(t.paymentMethod)+'</td>' +
          '<td>'+esc(t.detail||'')+'</td>' +
          '<td class="muted">'+esc(t.notes||'')+'</td>' +
          '<td class="actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-action="edit-tx" data-arg="'+t.id+'">ערוך</button>' +
            '<button type="button" class="btn btn-danger btn-sm" data-action="del-tx" data-arg="'+t.id+'">מחק</button>' +
          '</td>' +
        '</tr>';
      }).join('');

    var formHtml = state.txEditing ? renderTxForm(state.txEditing, cats, subs, pms) : '';

    container.innerHTML =
      '<div class="card">' +
        '<div class="flex-between mb-3">' +
          '<h2 style="font-weight:600;font-size:18px">תנועות — '+esc(DB.monthLabel(state.month))+'</h2>' +
          '<div class="flex gap-2">' +
            (showImport ? '<label class="btn btn-ghost">ייבוא Excel<input type="file" id="import-xlsx" accept=".xlsx,.xls" class="hidden"/></label>' : '') +
            '<button class="btn btn-primary" id="tx-new">+ תנועה חדשה</button>' +
          '</div>' +
        '</div>' +
        formHtml +
        '<div class="scroll-x"><table class="tbl">' +
          '<thead><tr><th>תאריך</th><th>קטגוריה</th><th>תיאור</th><th>סכום</th><th>אמצעי תשלום</th><th>פירוט</th><th>הערות</th><th></th></tr></thead>' +
          '<tbody>'+rowsHtml+'</tbody>' +
        '</table></div>' +
      '</div>';

    document.getElementById('tx-new').addEventListener('click', function(){
      state.txEditing = { date: state.month + '-01', category:'', subcategory:'', amount:'', paymentMethod:'', detail:'', notes:'' };
      render();
    });
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
          '<div style="font-weight:600;font-size:18px">סיכום שנתי</div>' +
          '<select class="select w-auto" id="year-picker">'+yearOpts+'</select>' +
        '</div>' +
        (window.Chart ? '<div class="card"><canvas id="c-year" height="100"></canvas></div>' : '') +
        '<div class="card"><div class="scroll-x"><table class="tbl">' +
          '<thead><tr><th>חודש</th><th>הכנסות</th><th>הוצאות</th><th>תקציב</th><th>מאזן</th></tr></thead>' +
          '<tbody>'+rowsHtml +
            '<tr style="background:#f1f5f9;font-weight:700">' +
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
      activeChartInstances.push(new Chart(document.getElementById('c-year'), {
        type:'bar',
        data:{ labels: data.rows.map(function(r){return DB.monthLabel(r.month);}),
               datasets:[
                 { label:'הכנסות', data: data.rows.map(function(r){return r.income;}),  backgroundColor:'#16a34a' },
                 { label:'הוצאות', data: data.rows.map(function(r){return r.expense;}), backgroundColor:'#dc2626' },
                 { label:'מאזן',   data: data.rows.map(function(r){return r.net;}),     type:'line', borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,.15)', tension:.3 },
               ] },
        options:{ plugins:{ legend:{ rtl:true } } },
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
      return '<tr'+(selectedCat===c.name?' style="background:#eef6ff"':'')+'>' +
        '<td><button class="btn btn-ghost btn-sm" style="width:100%;text-align:right" data-pick="'+esc(c.name)+'">'+esc(c.name)+'</button></td>' +
        '<td>'+(c.kind==='income'?'הכנסה':'הוצאה')+'</td>' +
        '<td><input type="number" class="input num" data-cat-budget="'+c.id+'" value="'+(c.budget||0)+'"/></td>' +
        '<td class="actions"><button class="btn btn-danger btn-sm" data-del-cat="'+c.id+'">מחק</button></td>' +
      '</tr>';
    }).join('');

    var subList = (subs[selectedCat]||[]).map(function(s){
      return '<li style="display:flex;justify-content:space-between;align-items:center;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;margin-bottom:6px">' +
        '<span>'+esc(s)+'</span>' +
        '<button class="btn btn-danger btn-sm" data-del-sub="'+esc(s)+'">הסר</button>' +
      '</li>';
    }).join('');
    if (!subList) subList = '<li class="muted">אין תתי-קטגוריה</li>';

    document.getElementById('page').innerHTML =
      '<div class="grid grid-cols-2">' +
        '<div class="card">' +
          '<h2 style="font-weight:600;margin-bottom:12px">קטגוריות ראשיות</h2>' +
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
          '<h2 style="font-weight:600;margin-bottom:12px">תתי-קטגוריה של "'+esc(selectedCat||'—')+'"</h2>' +
          (selectedCat ?
            '<div class="flex gap-2 mb-3">' +
              '<input class="input" id="new-sub" placeholder="תיאור חדש"/>' +
              '<button class="btn btn-primary" id="add-sub">הוסף</button>' +
            '</div>' +
            '<ul style="list-style:none;padding:0;margin:0">'+subList+'</ul>'
            : '') +
        '</div>' +
      '</div>';

    // Bind
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
        '<h2 style="font-weight:600;margin-bottom:12px">אמצעי תשלום</h2>' +
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
    document.getElementById('page').innerHTML =
      '<div class="grid grid-cols-2">' +
        '<div class="card">' +
          '<h2 style="font-weight:600;margin-bottom:12px">כללי</h2>' +
          '<label class="field"><span>מטבע</span><input class="input" id="s-currency" value="'+esc(s.currency||'₪')+'"/></label>' +
          '<label class="field"><span>חודש ברירת-מחדל (YYYY-MM)</span><input class="input num" id="s-defmonth" value="'+esc(s.defaultMonth||'')+'"/></label>' +
        '</div>' +
        '<div class="card">' +
          '<h2 style="font-weight:600;margin-bottom:12px">נתונים</h2>' +
          '<div class="flex gap-2" style="flex-wrap:wrap">' +
            '<button class="btn btn-ghost" id="export-json">ייצוא JSON</button>' +
            '<label class="btn btn-ghost">ייבוא JSON<input type="file" id="import-json" accept="application/json" class="hidden"/></label>' +
            '<label class="btn btn-ghost">ייבוא Excel<input type="file" id="import-xlsx-settings" accept=".xlsx,.xls" class="hidden"/></label>' +
            '<button class="btn btn-danger" id="reset-all">איפוס נתונים</button>' +
          '</div>' +
          '<p class="muted" style="font-size:12px;margin-top:12px">הנתונים נשמרים מקומית בדפדפן (localStorage). השתמש/י בייצוא לגיבוי.</p>' +
        '</div>' +
      '</div>';

    document.getElementById('s-currency').addEventListener('change', function(e){ DB.setSettings({ currency: e.target.value }); });
    document.getElementById('s-defmonth').addEventListener('change', function(e){ DB.setSettings({ defaultMonth: e.target.value }); });
    document.getElementById('export-json').addEventListener('click', exportAllJson);
    document.getElementById('import-json').addEventListener('change', importAllJson);
    document.getElementById('import-xlsx-settings').addEventListener('change', importXlsxHandler);
    document.getElementById('reset-all').addEventListener('click', function(){
      if (confirm('איפוס כל הנתונים? פעולה זו אינה הפיכה.')) { DB.resetAll(); location.reload(); }
    });
  }

  // ------------------------------------------------------------
  // Import / Export
  // ------------------------------------------------------------
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
        if (data.categories)     localStorage.setItem('budgetplus.categories', JSON.stringify(data.categories));
        if (data.subcategories)  localStorage.setItem('budgetplus.subcategories', JSON.stringify(data.subcategories));
        if (data.paymentMethods) localStorage.setItem('budgetplus.paymentMethods', JSON.stringify(data.paymentMethods));
        if (data.budgets)        localStorage.setItem('budgetplus.budgets', JSON.stringify(data.budgets));
        if (data.transactions)   localStorage.setItem('budgetplus.transactions', JSON.stringify(data.transactions));
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
              category: rr[cCat] || '',
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
  // Global delegated click handler — one place for all data-action buttons.
  // ------------------------------------------------------------
  document.addEventListener('click', function(e){
    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    var arg = el.getAttribute('data-arg');
    switch (action) {
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
        var cats = DB.listCategories();
        var inc = cats.find(function(c){ return c.kind==='income'; });
        if (!inc) return;
        DB.addSubcategory(inc.name, name);
        render();
        break;
      }
      case 'del-income': {
        if (!confirm('להסיר את סוג ההכנסה "'+arg+'"?')) return;
        var cats2 = DB.listCategories();
        var inc2 = cats2.find(function(c){ return c.kind==='income'; });
        if (!inc2) return;
        DB.removeSubcategory(inc2.name, arg);
        // Also clear any stored projected default for this subcategory.
        if (inc2.projectedDefaults && inc2.projectedDefaults[arg] !== undefined) {
          var pd = Object.assign({}, inc2.projectedDefaults);
          delete pd[arg];
          DB.upsertCategory(Object.assign({}, inc2, { projectedDefaults: pd }));
        }
        render();
        break;
      }
    }
  });

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  window.addEventListener('hashchange', render);
  render();
})();
