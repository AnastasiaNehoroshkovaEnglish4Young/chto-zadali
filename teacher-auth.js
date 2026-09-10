(function () {
  'use strict';

  const appRoot = document.querySelector('.app');
  if (!appRoot || !window.firebase || !firebase.auth) return;

  appRoot.hidden = true;

  const style = document.createElement('style');
  style.textContent = `
    .teacher-auth-gate{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f6f3ff;color:#27243b;font-family:Arial,sans-serif}
    .teacher-auth-card{width:min(440px,100%);padding:34px;border-radius:24px;background:#fff;box-shadow:0 18px 50px rgba(55,44,105,.14);text-align:center}
    .teacher-auth-mark{width:58px;height:58px;margin:0 auto 18px;display:grid;place-items:center;border-radius:18px;background:#6e56cf;color:#fff;font-size:28px;font-weight:900}
    .teacher-auth-card h1{margin:0 0 8px;font-size:28px}.teacher-auth-card p{margin:0 0 22px;color:#706b84;line-height:1.5}
    .teacher-google-button{width:100%;min-height:50px;border:0;border-radius:14px;background:#6e56cf;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
    .teacher-google-button:disabled{opacity:.65;cursor:wait}.teacher-auth-status{min-height:22px;margin-top:14px;font-size:14px;color:#706b84}
  `;
  document.head.append(style);

  const gate = document.createElement('main');
  gate.className = 'teacher-auth-gate';
  gate.innerHTML = `
    <section class="teacher-auth-card" aria-labelledby="teacherAuthTitle">
      <div class="teacher-auth-mark">✓</div>
      <h1 id="teacherAuthTitle">Кабинет учителя</h1>
      <p>Войдите через Google, чтобы открыть журнал и редактировать домашние задания.</p>
      <button class="teacher-google-button" id="teacherGoogleSignIn" type="button">Войти через Google</button>
      <div class="teacher-auth-status" id="teacherAuthStatus" role="status" aria-live="polite">Проверяем вход…</div>
    </section>`;
  document.body.append(gate);

  const auth = firebase.auth();
  const provider = new firebase.auth.GoogleAuthProvider();
  const button = document.getElementById('teacherGoogleSignIn');
  const status = document.getElementById('teacherAuthStatus');
  let appLoaded = false;

  function loadTeacherApp() {
    if (appLoaded) return;
    appLoaded = true;
    gate.remove();
    appRoot.hidden = false;
    const script = document.createElement('script');
    script.src = 'teacher.js';
    script.defer = true;
    document.body.append(script);
  }

  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((error) => {
    console.warn('Firebase Auth persistence:', error);
  });

  auth.onAuthStateChanged((user) => {
    if (user) {
      loadTeacherApp();
      return;
    }
    button.disabled = false;
    status.textContent = 'Нажмите кнопку и выберите ваш Google-аккаунт.';
  }, (error) => {
    console.error(error);
    button.disabled = false;
    status.textContent = 'Не удалось проверить вход. Обновите страницу и попробуйте ещё раз.';
  });

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Открываем вход Google…';
    try {
      await auth.signInWithPopup(provider);
    } catch (error) {
      console.error(error);
      button.disabled = false;
      if (error && error.code === 'auth/unauthorized-domain') {
        status.textContent = 'Этот адрес сайта пока не разрешён в Firebase. Добавьте домен GitHub Pages в Authorized domains.';
      } else if (error && error.code === 'auth/popup-blocked') {
        status.textContent = 'Всплывающее окно заблокировано. Переходим на страницу Google…';
        try {
          await auth.signInWithRedirect(provider);
        } catch (redirectError) {
          console.error(redirectError);
          status.textContent = 'Не удалось открыть вход Google. Разрешите всплывающие окна и попробуйте снова.';
        }
      } else if (error && error.code === 'auth/popup-closed-by-user') {
        status.textContent = 'Вход отменён. Нажмите кнопку, когда будете готовы.';
      } else {
        status.textContent = 'Не удалось войти через Google. Попробуйте ещё раз.';
      }
    }
  });
}());
