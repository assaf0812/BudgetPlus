// Calculation layer — direct translations of the Excel formulas. Exposes window.CALC.
(function () {
  function fmt(n) {
    var v = Number(n)||0;
    return '₪' + v.toLocaleString('he-IL', { maximumFractionDigits: 2 });
  }
  function sumBy(rows, field, value) {
    return rows.reduce(function(s,r){ return r[field]===value ? s + (Number(r.amount)||0) : s; }, 0);
  }
  function actualByCategory(rows, cat) { return sumBy(rows, 'category', cat); }
  function sumByDescription(rows, desc) { return sumBy(rows, 'subcategory', desc); }
  // Replicates =IF(SUMIFS>0, SUMIFS, 7500)
  function incomeLine(rows, desc, projectedDefault) {
    if (projectedDefault === undefined) projectedDefault = 7500;
    var s = sumByDescription(rows, desc);
    return s > 0 ? s : projectedDefault;
  }

  function monthlySummary(ym) {
    var txs = DB.listTxByMonth(ym);
    var cats = DB.listCategories();
    var subs = DB.listSubcategories();

    var incomeCat = cats.find(function(c){ return c.kind==='income'; });
    var incomeDescs = incomeCat ? (subs[incomeCat.name] || []) : [];
    var pdGlobal = incomeCat && incomeCat.projectedDefault!=null ? incomeCat.projectedDefault : 7500;
    var pdMap    = (incomeCat && incomeCat.projectedDefaults) || {};
    var incomeLines = incomeDescs.map(function(d){
      var pd = pdMap[d] != null ? Number(pdMap[d]) : pdGlobal;
      return { description: d, actual: sumByDescription(txs, d), projected: incomeLine(txs, d, pd), projectedDefault: pd };
    });
    var incomeTotal = incomeLines.reduce(function(s,l){ return s + l.projected; }, 0);

    var expenseRows = cats.filter(function(c){ return c.kind==='expense'; })
      .sort(function(a,b){ return a.order-b.order; })
      .map(function(c){
        var budget = DB.getMonthBudget(ym, c.name);
        var actual = actualByCategory(txs, c.name);
        return {
          category: c.name, budget: budget, actual: actual, remaining: budget-actual,
          utilization: budget>0 ? actual/budget : (actual>0 ? Infinity : 0),
        };
      });

    var totals = expenseRows.reduce(function(a,r){
      return { budget: a.budget+r.budget, actual: a.actual+r.actual, remaining: a.remaining+r.remaining };
    }, { budget:0, actual:0, remaining:0 });

    return {
      month: ym, transactions: txs,
      incomeLines: incomeLines, incomeTotal: incomeTotal,
      expenseRows: expenseRows, totals: totals, net: incomeTotal - totals.actual,
    };
  }

  function paymentMethodPivot(ym) {
    var txs = DB.listTxByMonth(ym);
    var pms = DB.listPaymentMethods();
    var groups = {};
    pms.forEach(function(pm){
      var key = pm.group || pm.name;
      if (!groups[key]) groups[key] = { group: key, acct1: 0, acct2: 0, none: 0 };
      var s = sumBy(txs, 'paymentMethod', pm.name);
      if (pm.account===1) groups[key].acct1 += s;
      else if (pm.account===2) groups[key].acct2 += s;
      else groups[key].none += s;
    });
    return Object.keys(groups).map(function(k){ return groups[k]; });
  }

  function yearlySummary(year) {
    var months = DB.monthsOfYear(year);
    var rows = months.map(function(ym){
      var s = monthlySummary(ym);
      return { month: ym, income: s.incomeTotal, expense: s.totals.actual, budget: s.totals.budget, net: s.net };
    });
    var totals = rows.reduce(function(a,r){
      return { income:a.income+r.income, expense:a.expense+r.expense, budget:a.budget+r.budget, net:a.net+r.net };
    }, { income:0, expense:0, budget:0, net:0 });
    return { year: year, rows: rows, totals: totals };
  }

  function budgetStatus(utilization, remaining) {
    if (remaining < 0) return 'bad';
    if (utilization >= 0.8) return 'warn';
    return 'good';
  }

  window.CALC = {
    fmt: fmt, sumBy: sumBy, actualByCategory: actualByCategory, sumByDescription: sumByDescription,
    incomeLine: incomeLine, monthlySummary: monthlySummary, paymentMethodPivot: paymentMethodPivot,
    yearlySummary: yearlySummary, budgetStatus: budgetStatus,
  };
})();
