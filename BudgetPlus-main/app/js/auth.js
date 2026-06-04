// Auth gate. Shows login screen until user is authenticated, then boots the app.
// Exposes window.AUTH.{currentUser, signOut, onReady(cb)}.
(function () {
  var app = null, auth = null, ready = false;
  var readyHandlers = [];
  var currentUser = null;

  function initFirebase() {
    if (!window.firebase || !window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === 'REPLACE_ME') {
      renderConfigMissing();
      return false;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    app = firebase.app();
    auth = firebase.auth();
    return true;
  }

  function renderConfigMissing() {
    document.getElementById('root').innerHTML =
      '<div style="max-width:520px;margin:80px auto;padding:24px" class="card">' +
        '<h2 style="font-weight:700;margin-bottom:8px">הגדרות Firebase חסרות</h2>' +
        '<p class="muted">יש למלא את <code>app/js/firebase-config.js</code> עם ה-firebaseConfig מ-Firebase Console ולרענן את הדף.</p>' +
      '</div>';
  }

  function renderLogin(errorMsg) {
    var err = errorMsg ? '<div style="background:var(--bad-bg);color:var(--bad-fg);padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:13px">'+errorMsg+'</div>' : '';
    document.getElementById('root').innerHTML =
      '<div style="min-height:100vh;display:grid;place-items:center;padding:24px">' +
        '<div class="card" style="width:100%;max-width:420px">' +
          '<div class="logo" style="display:flex;align-items:center;gap:8px;margin-bottom:16px">' +
            '<div style="width:40px;height:40px;border-radius:12px;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:bold">₪</div>' +
            '<div style="font-weight:700;font-size:18px">BudgetPlus</div>' +
          '</div>' +
          err +
          '<button class="btn btn-ghost" id="g-signin" style="width:100%;justify-content:center;margin-bottom:12px">' +
            '<span>🔑</span><span>התחברות עם Google</span>' +
          '</button>' +
          '<div class="muted" style="text-align:center;font-size:12px;margin:8px 0">— או —</div>' +
          '<label class="field"><span>אימייל</span><input id="a-email" class="input" type="email" autocomplete="email"/></label>' +
          '<label class="field"><span>סיסמה (לפחות 6 תווים)</span><input id="a-pass" class="input" type="password" autocomplete="current-password"/></label>' +
          '<div class="flex gap-2" style="margin-top:12px">' +
            '<button class="btn btn-primary" id="a-login" style="flex:1;justify-content:center">כניסה</button>' +
            '<button class="btn btn-ghost" id="a-register" style="flex:1;justify-content:center">הרשמה</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('g-signin').addEventListener('click', function(){
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(function(e){ renderLogin(humanizeAuthError(e)); });
    });
    document.getElementById('a-login').addEventListener('click', function(){
      var email = document.getElementById('a-email').value.trim();
      var pass = document.getElementById('a-pass').value;
      auth.signInWithEmailAndPassword(email, pass).catch(function(e){ renderLogin(humanizeAuthError(e)); });
    });
    document.getElementById('a-register').addEventListener('click', function(){
      var email = document.getElementById('a-email').value.trim();
      var pass = document.getElementById('a-pass').value;
      auth.createUserWithEmailAndPassword(email, pass).catch(function(e){ renderLogin(humanizeAuthError(e)); });
    });
  }

  function humanizeAuthError(e) {
    var code = (e && e.code) || '';
    var map = {
      'auth/invalid-email': 'אימייל לא תקין',
      'auth/user-not-found': 'משתמש לא קיים',
      'auth/wrong-password': 'סיסמה שגויה',
      'auth/invalid-credential': 'פרטי התחברות שגויים',
      'auth/email-already-in-use': 'האימייל כבר רשום',
      'auth/weak-password': 'הסיסמה חלשה מדי (לפחות 6 תווים)',
      'auth/popup-closed-by-user': 'החלון נסגר לפני השלמת ההתחברות',
      'auth/popup-blocked': 'הדפדפן חסם את חלון ה-popup',
      'auth/unauthorized-domain': 'הדומיין אינו מורשה — הוסף אותו ב-Firebase → Auth → Settings → Authorized domains',
    };
    return map[code] || (e && e.message) || 'שגיאה בהתחברות';
  }

  function signOut() {
    auth.signOut().then(function(){
      window.SYNC && window.SYNC.clearLocal();
      location.reload();
    });
  }

  function onReady(cb) {
    if (ready) cb(currentUser);
    else readyHandlers.push(cb);
  }

  if (!initFirebase()) return;

  auth.onAuthStateChanged(function(user){
    currentUser = user;
    if (!user) {
      renderLogin();
      return;
    }
    // Logged in → pull cloud data, then boot the app once data is local.
    window.SYNC.pullFromCloud(user.uid, function(){
      ready = true;
      readyHandlers.forEach(function(cb){ try { cb(user); } catch(e){ console.error(e); } });
      readyHandlers = [];
      // After the app has rendered once, start live sync so remote changes from
      // another device flow in and re-render this tab automatically.
      window.SYNC.startLiveSync(user.uid, function(){
        if (window.APP && window.APP.rerender) window.APP.rerender();
      });
    });
  });

  window.AUTH = {
    get currentUser() { return currentUser; },
    signOut: signOut,
    onReady: onReady,
  };
})();
