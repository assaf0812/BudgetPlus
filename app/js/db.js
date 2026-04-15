// localStorage-backed persistence. Exposes window.DB.
(function () {
  var K = {
    cats: 'budgetplus.categories',
    subs: 'budgetplus.subcategories',
    pms:  'budgetplus.paymentMethods',
    budgets: 'budgetplus.budgets',
    tx:   'budgetplus.transactions',
    settings: 'budgetplus.settings',
    seeded: 'budgetplus.seeded',
  };
  function read(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch(e) { return fb; } }
  function write(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function uid() { return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }
  var HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  function monthLabel(ym) {
    var p = ym.split('-'); return HE_MONTHS[Number(p[1])-1] + ' ' + p[0];
  }
  function monthsAround(ym, before, after) {
    before = before || 12; after = after || 12;
    var p = ym.split('-'), y = Number(p[0]), m = Number(p[1]);
    var out = [];
    for (var i = -before; i <= after; i++) {
      var d = new Date(y, m-1+i, 1);
      out.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
    }
    return out;
  }
  function monthsOfYear(year) {
    var out = [];
    for (var i = 1; i <= 12; i++) out.push(year + '-' + String(i).padStart(2,'0'));
    return out;
  }

  // Repair any transactions that were persisted with id=undefined (past bug).
  function repairIds() {
    var arr = listTransactions();
    var fixed = false;
    arr.forEach(function(t){
      if (!t.id) { t.id = uid(); fixed = true; }
    });
    if (fixed) write(K.tx, arr);
  }

  function ensureSeed() {
    if (localStorage.getItem(K.seeded) === '1') return;
    var S = window.SEED;
    write(K.cats, S.categories.map(function(c){ return Object.assign({ id: uid() }, c); }));
    write(K.subs, Object.assign({}, S.subcategories));
    write(K.pms,  S.paymentMethods.map(function(p){ return Object.assign({ id: uid() }, p); }));
    write(K.budgets, {});
    write(K.tx, []);
    write(K.settings, { currency: '₪', defaultMonth: currentMonth() });
    localStorage.setItem(K.seeded, '1');
  }
  // One-time migration: strip underscores from Hebrew names seeded from the old Excel.
  function migrateUnderscores() {
    if (localStorage.getItem('budgetplus.migrated_underscores') === '1') return;
    var RENAMES = {
      'בילוי_ובידור': 'בילוי ובידור',
      'טיפוח_אישי': 'טיפוח אישי',
      'בריאות_וביטוחים': 'בריאות וביטוחים',
      'בנק_והלוואות': 'בנק והלוואות',
      'הוצאות_לדירה': 'הוצאות לדירה',
    };
    // Categories
    var cats = listCategories();
    cats.forEach(function(c){ if (RENAMES[c.name]) c.name = RENAMES[c.name]; });
    write(K.cats, cats);
    // Subcategory keys
    var subs = listSubcategories();
    Object.keys(RENAMES).forEach(function(oldK){
      if (subs[oldK]) {
        subs[RENAMES[oldK]] = (subs[RENAMES[oldK]] || []).concat(subs[oldK]);
        delete subs[oldK];
      }
    });
    write(K.subs, subs);
    // Transactions
    var txs = listTransactions();
    txs.forEach(function(t){ if (RENAMES[t.category]) t.category = RENAMES[t.category]; });
    write(K.tx, txs);
    // Per-month budget overrides
    var budgets = getBudgetsMap();
    Object.keys(budgets).forEach(function(ym){
      Object.keys(RENAMES).forEach(function(oldK){
        if (budgets[ym][oldK] !== undefined) {
          budgets[ym][RENAMES[oldK]] = budgets[ym][oldK];
          delete budgets[ym][oldK];
        }
      });
    });
    write(K.budgets, budgets);
    localStorage.setItem('budgetplus.migrated_underscores', '1');
  }

  function resetAll() {
    Object.keys(K).forEach(function(k){ localStorage.removeItem(K[k]); });
    localStorage.removeItem('budgetplus.migrated_underscores');
    ensureSeed();
  }

  // Categories
  function listCategories() { return read(K.cats, []); }
  function upsertCategory(c) {
    var arr = listCategories();
    if (c.id) {
      var i = arr.findIndex(function(x){ return x.id===c.id; });
      if (i>=0) arr[i] = Object.assign({}, arr[i], c);
    } else {
      arr.push(Object.assign({ id: uid(), order: arr.length, kind:'expense', budget:0 }, c));
    }
    write(K.cats, arr);
  }
  function deleteCategory(id) { write(K.cats, listCategories().filter(function(c){return c.id!==id;})); }

  // Subcategories
  function listSubcategories() { return read(K.subs, {}); }
  function setSubcategories(cat, arr) { var all = listSubcategories(); all[cat]=arr; write(K.subs, all); }
  function addSubcategory(cat, name) { var all = listSubcategories(); all[cat] = (all[cat]||[]).concat(name); write(K.subs, all); }
  function removeSubcategory(cat, name) { var all = listSubcategories(); all[cat] = (all[cat]||[]).filter(function(s){return s!==name;}); write(K.subs, all); }

  // Payment methods
  function listPaymentMethods() { return read(K.pms, []); }
  function upsertPaymentMethod(p) {
    var arr = listPaymentMethods();
    if (p.id) {
      var i = arr.findIndex(function(x){ return x.id===p.id; });
      if (i>=0) arr[i] = Object.assign({}, arr[i], p);
    } else arr.push(Object.assign({ id: uid(), account: null, group: p.name }, p));
    write(K.pms, arr);
  }
  function deletePaymentMethod(id) { write(K.pms, listPaymentMethods().filter(function(p){return p.id!==id;})); }

  // Budgets (per-month overrides)
  function getBudgetsMap() { return read(K.budgets, {}); }
  function getMonthBudget(ym, cat) {
    var map = getBudgetsMap();
    if (map[ym] && map[ym][cat] !== undefined) return Number(map[ym][cat])||0;
    var c = listCategories().find(function(x){return x.name===cat;});
    return c ? Number(c.budget)||0 : 0;
  }
  function setMonthBudget(ym, cat, amount) {
    var map = getBudgetsMap();
    map[ym] = map[ym] || {}; map[ym][cat] = Number(amount)||0; write(K.budgets, map);
  }

  // Transactions
  function listTransactions() { return read(K.tx, []); }
  function listTxByMonth(ym) { return listTransactions().filter(function(t){return t.month===ym;}); }
  function upsertTransaction(t) {
    var arr = listTransactions();
    var month = (t.date||'').slice(0,7);
    if (t.id) {
      var i = arr.findIndex(function(x){return x.id===t.id;});
      if (i>=0) arr[i] = Object.assign({}, arr[i], t, { month: month });
    } else {
      // NB: spread `t` first, then force a fresh `id` — otherwise t.id=undefined
      //     (from an empty edit form) would wipe out the generated uid via Object.assign.
      arr.push(Object.assign({}, t, { id: uid(), month: month }));
    }
    write(K.tx, arr);
  }
  function deleteTransaction(id) { write(K.tx, listTransactions().filter(function(t){return t.id!==id;})); }
  function bulkInsertTransactions(rows) {
    var arr = listTransactions();
    rows.forEach(function(r){
      arr.push(Object.assign({}, r, { id: uid(), month: (r.date||'').slice(0,7) }));
    });
    write(K.tx, arr);
  }

  // Settings
  function getSettings() { return read(K.settings, { currency:'₪', defaultMonth: currentMonth() }); }
  function setSettings(patch) { write(K.settings, Object.assign({}, getSettings(), patch)); }

  window.DB = {
    ensureSeed: ensureSeed, migrateUnderscores: migrateUnderscores, repairIds: repairIds, resetAll: resetAll,
    currentMonth: currentMonth, monthLabel: monthLabel, monthsAround: monthsAround, monthsOfYear: monthsOfYear,
    listCategories: listCategories, upsertCategory: upsertCategory, deleteCategory: deleteCategory,
    listSubcategories: listSubcategories, setSubcategories: setSubcategories, addSubcategory: addSubcategory, removeSubcategory: removeSubcategory,
    listPaymentMethods: listPaymentMethods, upsertPaymentMethod: upsertPaymentMethod, deletePaymentMethod: deletePaymentMethod,
    getBudgetsMap: getBudgetsMap, getMonthBudget: getMonthBudget, setMonthBudget: setMonthBudget,
    listTransactions: listTransactions, listTxByMonth: listTxByMonth, upsertTransaction: upsertTransaction,
    deleteTransaction: deleteTransaction, bulkInsertTransactions: bulkInsertTransactions,
    getSettings: getSettings, setSettings: setSettings,
  };
})();
