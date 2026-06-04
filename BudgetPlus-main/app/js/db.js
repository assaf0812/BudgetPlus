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
    incomeAdd: 'budgetplus.incomeAdditions',
    incomeDel: 'budgetplus.incomeDeletions',
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

  // Replace the payment-methods list with the curated seed. Preserves stored transaction
  // paymentMethod values — if a tx references a removed method, it keeps the text but
  // won't appear in the dropdown anymore.
  function migratePaymentMethods() {
    if (localStorage.getItem('budgetplus.migrated_pms_v2') === '1') return;
    write(K.pms, window.SEED.paymentMethods.map(function(p){
      return Object.assign({ id: uid() }, p);
    }));
    localStorage.setItem('budgetplus.migrated_pms_v2', '1');
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
    if (localStorage.getItem(K.seeded) === '1') {
      var existing = [];
      try { existing = JSON.parse(localStorage.getItem(K.cats) || '[]'); } catch(e){}
      if (existing.length > 0) return;
    }
    var S = window.SEED;
    write(K.cats, S.categories.map(function(c){ return Object.assign({ id: uid() }, c); }));
    write(K.subs, Object.assign({}, S.subcategories));
    write(K.pms,  S.paymentMethods.map(function(p){ return Object.assign({ id: uid() }, p); }));
    write(K.budgets, {});
    write(K.tx, []);
    write(K.settings, { currency: '₪', defaultMonth: currentMonth() });
    localStorage.setItem(K.seeded, '1');
  }
  // Migration: strip underscores from persisted category names/keys.
  // Safe to run repeatedly (idempotent).
  function migrateUnderscores() {
    function normName(s) {
      return String(s===undefined || s===null ? '' : s).replace(/_/g, ' ').trim();
    }
    // Categories
    var cats = listCategories();
    cats.forEach(function(c){ c.name = normName(c.name); });
    write(K.cats, cats);
    // Subcategory keys
    var subs = listSubcategories();
    var normSubs = {};
    Object.keys(subs).forEach(function(k){
      var nk = normName(k);
      normSubs[nk] = (normSubs[nk] || []).concat(subs[k] || []);
    });
    write(K.subs, normSubs);
    // Transactions
    var txs = listTransactions();
    txs.forEach(function(t){ t.category = normName(t.category); });
    write(K.tx, txs);
    // Per-month budget overrides
    var budgets = getBudgetsMap();
    var normBudgets = {};
    Object.keys(budgets).forEach(function(ym){
      normBudgets[ym] = {};
      Object.keys(budgets[ym] || {}).forEach(function(cat){
        normBudgets[ym][normName(cat)] = budgets[ym][cat];
      });
    });
    write(K.budgets, normBudgets);

    // Income additions/deletions month overrides
    var adds = getIncomeAdditions();
    Object.keys(adds).forEach(function(ym){
      adds[ym] = (adds[ym] || []).map(normName);
    });
    write(K.incomeAdd, adds);

    var dels = getIncomeDeletions();
    Object.keys(dels).forEach(function(ym){
      dels[ym] = (dels[ym] || []).map(normName);
    });
    write(K.incomeDel, dels);

    localStorage.setItem('budgetplus.migrated_underscores', '1');
  }

  function resetAll() {
    Object.keys(K).forEach(function(k){ localStorage.removeItem(K[k]); });
    localStorage.removeItem('budgetplus.migrated_underscores');
    localStorage.removeItem('budgetplus.migrated_pms_v2');
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

  // Per-month income subcategory overrides.
  //   incomeAdditions: { [YYYY-MM]: string[] } — added in this month; effective from this month onward.
  //   incomeDeletions: { [YYYY-MM]: string[] } — hidden in this month only (local).
  function getIncomeAdditions() { return read(K.incomeAdd, {}); }
  function getIncomeDeletions() { return read(K.incomeDel, {}); }

  function addIncomeForMonth(ym, name) {
    var adds = getIncomeAdditions();
    adds[ym] = adds[ym] || [];
    if (adds[ym].indexOf(name) === -1) adds[ym].push(name);
    write(K.incomeAdd, adds);
    // If this name was previously deleted in this same month, un-delete it.
    var dels = getIncomeDeletions();
    if (dels[ym]) {
      dels[ym] = dels[ym].filter(function(n){ return n !== name; });
      write(K.incomeDel, dels);
    }
  }
  function removeIncomeForMonth(ym, name) {
    var dels = getIncomeDeletions();
    dels[ym] = dels[ym] || [];
    if (dels[ym].indexOf(name) === -1) dels[ym].push(name);
    write(K.incomeDel, dels);
  }
  // Effective income subcategories visible in month `ym`.
  function getIncomeDescsForMonth(ym) {
    var baseCat = listCategories().find(function(c){ return c.kind==='income'; });
    var base = baseCat ? (listSubcategories()[baseCat.name] || []) : [];
    var adds = getIncomeAdditions();
    var extras = [];
    Object.keys(adds).forEach(function(m){ if (m <= ym) extras = extras.concat(adds[m]); });
    var dels = getIncomeDeletions()[ym] || [];
    var seen = {}, result = [];
    base.concat(extras).forEach(function(n){
      if (!seen[n] && dels.indexOf(n) === -1) { seen[n] = 1; result.push(n); }
    });
    return result;
  }

  // Settings
  function getSettings() { return read(K.settings, { currency:'₪', defaultMonth: currentMonth(), darkMode: false }); }
  function setSettings(patch) { write(K.settings, Object.assign({}, getSettings(), patch)); }

  window.DB = {
    ensureSeed: ensureSeed, migrateUnderscores: migrateUnderscores, migratePaymentMethods: migratePaymentMethods, repairIds: repairIds, resetAll: resetAll,
    currentMonth: currentMonth, monthLabel: monthLabel, monthsAround: monthsAround, monthsOfYear: monthsOfYear,
    listCategories: listCategories, upsertCategory: upsertCategory, deleteCategory: deleteCategory,
    listSubcategories: listSubcategories, setSubcategories: setSubcategories, addSubcategory: addSubcategory, removeSubcategory: removeSubcategory,
    listPaymentMethods: listPaymentMethods, upsertPaymentMethod: upsertPaymentMethod, deletePaymentMethod: deletePaymentMethod,
    getBudgetsMap: getBudgetsMap, getMonthBudget: getMonthBudget, setMonthBudget: setMonthBudget,
    getIncomeAdditions: getIncomeAdditions, getIncomeDeletions: getIncomeDeletions,
    addIncomeForMonth: addIncomeForMonth, removeIncomeForMonth: removeIncomeForMonth,
    getIncomeDescsForMonth: getIncomeDescsForMonth,
    listTransactions: listTransactions, listTxByMonth: listTxByMonth, upsertTransaction: upsertTransaction,
    deleteTransaction: deleteTransaction, bulkInsertTransactions: bulkInsertTransactions,
    getSettings: getSettings, setSettings: setSettings,
  };
})();
