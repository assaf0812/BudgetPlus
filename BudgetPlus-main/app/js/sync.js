// Firestore sync layer — mirrors the localStorage keys that DB.js owns into
// a single Firestore doc at users/{uid}/data/all. No schema changes to DB.js.
//
// Flow:
//   1. Login fires -> pullFromCloud(uid):
//        - if cloud doc exists: overwrite local keys with its contents
//        - else: push whatever is currently local (first-time)
//      then renderCallback() re-renders the app.
//   2. Any subsequent DB.* call goes through the localStorage shim below, which
//      debounces pushToCloud() after each write. Writes include this tab's
//      `writerId` so the live listener can skip echoes of our own pushes.
//   3. startLiveSync(uid, onRemoteChange) subscribes to onSnapshot. When another
//      device writes, local storage is overwritten and the render callback runs
//      so the UI picks up the new data without a manual refresh.
//   4. Logout -> stop listener, wipe local keys, fall back to seed on next sign-in.
(function () {
  var LS_KEYS = [
    'budgetplus.categories',
    'budgetplus.subcategories',
    'budgetplus.paymentMethods',
    'budgetplus.budgets',
    'budgetplus.transactions',
    'budgetplus.settings',
    'budgetplus.incomeAdditions',
    'budgetplus.incomeDeletions',
  ];
  // A unique id for this browser tab so onSnapshot can ignore echoes of our own writes.
  var writerId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  var currentUid = null;
  var pushTimer = null;
  var suspended = false; // true while we're overwriting local from cloud — don't re-push
  var unsubscribeLive = null;

  function snapshotLocal() {
    var snap = {};
    LS_KEYS.forEach(function(k){
      var v = localStorage.getItem(k);
      snap[k] = v == null ? null : v; // store raw JSON strings
    });
    return snap;
  }
  function writeLocalFromSnap(snap) {
    suspended = true;
    try {
      // Clear first so keys removed on another device also disappear here.
      LS_KEYS.forEach(function(k){ localStorage.removeItem(k); });
      LS_KEYS.forEach(function(k){
        if (snap && snap[k] != null) localStorage.setItem(k, snap[k]);
      });
    } finally {
      suspended = false;
    }
  }

  function schedulePush() {
    if (!currentUid || suspended) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){ pushToCloud(currentUid); }, 400);
  }

  function pushToCloud(uid) {
    if (!uid || !window.firebase) return;
    var db = firebase.firestore();
    db.collection('users').doc(uid).collection('data').doc('all')
      .set({ payload: snapshotLocal(), updatedAt: Date.now(), writerId: writerId })
      .catch(function(err){ console.warn('Firestore push failed', err); });
  }

  function pullFromCloud(uid, renderCallback) {
    currentUid = uid;
    if (!window.firebase) { renderCallback(); return; }
    var db = firebase.firestore();
    db.collection('users').doc(uid).collection('data').doc('all').get()
      .then(function(doc){
        if (doc.exists && doc.data() && doc.data().payload) {
          writeLocalFromSnap(doc.data().payload);
          localStorage.setItem('budgetplus.seeded', '1');
        }
        // If no cloud doc yet, ensureSeed() will populate localStorage and
        // schedulePush() will sync it to Firestore automatically.
        renderCallback();
      })
      .catch(function(err){
        console.warn('Firestore pull failed, using local only:', err);
        renderCallback();
      });
  }

  // Subscribe to remote changes. onRemoteChange() runs AFTER local has been
  // overwritten with the new payload, so the caller can re-render.
  function startLiveSync(uid, onRemoteChange) {
    if (!uid || !window.firebase) return;
    stopLiveSync();
    var db = firebase.firestore();
    unsubscribeLive = db.collection('users').doc(uid).collection('data').doc('all')
      .onSnapshot(function(doc){
        if (!doc.exists) return;
        var data = doc.data();
        if (!data || !data.payload) return;
        // Skip echoes of our own writes (both pending and server-acked).
        if (data.writerId === writerId) return;
        // Skip un-acked local writes (not ours, but still intermediate).
        if (doc.metadata && doc.metadata.hasPendingWrites) return;
        writeLocalFromSnap(data.payload);
        try { onRemoteChange && onRemoteChange(); } catch (e) { console.error(e); }
      }, function(err){
        console.warn('Firestore live sync error', err);
      });
  }
  function stopLiveSync() {
    if (unsubscribeLive) { try { unsubscribeLive(); } catch(e){} unsubscribeLive = null; }
  }

  function clearLocal() {
    stopLiveSync();
    LS_KEYS.forEach(function(k){ localStorage.removeItem(k); });
    localStorage.removeItem('budgetplus.seeded');
    localStorage.removeItem('budgetplus.migrated_underscores');
    localStorage.removeItem('budgetplus.migrated_pms_v2');
    currentUid = null;
  }

  // Wrap localStorage.setItem so every DB.js write triggers a cloud push.
  var origSet = localStorage.setItem.bind(localStorage);
  var origRemove = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(k, v) {
    origSet(k, v);
    if (LS_KEYS.indexOf(k) !== -1) schedulePush();
  };
  localStorage.removeItem = function(k) {
    origRemove(k);
    if (LS_KEYS.indexOf(k) !== -1) schedulePush();
  };

  window.SYNC = {
    pullFromCloud: pullFromCloud,
    pushToCloud: pushToCloud,
    startLiveSync: startLiveSync,
    stopLiveSync: stopLiveSync,
    clearLocal: clearLocal,
  };
})();
