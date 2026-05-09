/* eslint-disable */
/*
 * Простой мессенджер на vanilla JS + Supabase.
 * Целевое устройство: iPad mini 2/3 (iOS 12 Safari/Chrome).
 * Не использовать ?., ??, BigInt, private fields, top-level await.
 */
(function () {
  'use strict';

  // === CONFIG ===
  var SUPABASE_URL = 'https://rfqdlgaxtlkhlyabwayx.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmcWRsZ2F4dGxraGx5YWJ3YXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNzM1NTcsImV4cCI6MjA5Mzg0OTU1N30.OQ5gXJS-huvIUTVw-gMHMZkwBb4GxPGU1RsfFn9M_Tc';
  var EMAIL_DOMAIN = 'msg.local';
  var ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Бесплатный публичный TURN (с лимитами). Для продакшена замени на свой.
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  // === STATE ===
  var me = null;             // { id, username, display_name }
  var contacts = [];         // [{ id, username, display_name, lastMessage, unread }]
  var currentContactId = null;
  var currentContact = null;
  var messagesByPeer = {};   // peerId -> array of messages
  var unreadByPeer = {};     // peerId -> count
  var realtimeChan = null;
  var lastNotifTitle = document.title;
  var notifPending = 0;
  var origFavicon = null;

  // === ELEMENTS ===
  var el = function (id) { return document.getElementById(id); };
  var authScreen = el('auth-screen');
  var authSub = el('auth-sub');
  var authUsername = el('auth-username');
  var authPassword = el('auth-password');
  var authSubmit = el('auth-submit');
  var authToggle = el('auth-toggle-link');
  var authError = el('auth-error');
  var app = el('app');
  var meName = el('me-name');
  var meUsername = el('me-username');
  var addContactBtn = el('add-contact-btn');
  var logoutBtn = el('logout-btn');
  var contactsList = el('contacts-list');
  var chatEmpty = el('chat-empty');
  var chatMain = el('chat-main');
  var chatAvatar = el('chat-avatar');
  var chatName = el('chat-name');
  var backBtn = el('back-btn');
  var audioCallBtn = el('audio-call-btn');
  var videoCallBtn = el('video-call-btn');
  var messagesEl = el('messages');
  var attachBtn = el('attach-btn');
  var fileInput = el('file-input');
  var textInput = el('text-input');
  var micBtn = el('mic-btn');
  var sendBtn = el('send-btn');
  var addContactModal = el('add-contact-modal');
  var addContactInput = el('add-contact-input');
  var addContactError = el('add-contact-error');
  var addContactOk = el('add-contact-ok');
  var addContactCancel = el('add-contact-cancel');
  var chatNameBtn = el('chat-name-btn');
  var editContactModal = el('edit-contact-modal');
  var editContactName = el('edit-contact-name');
  var editContactUsername = el('edit-contact-username');
  var editContactSave = el('edit-contact-save');
  var editContactCancel = el('edit-contact-cancel');
  var editContactDelete = el('edit-contact-delete');
  var msgActionsModal = el('msg-actions-modal');
  var msgDeleteBtn = el('msg-delete-btn');
  var msgActionsCancel = el('msg-actions-cancel');
  var callScreen = el('call-screen');
  var callName = el('call-name');
  var callStatus = el('call-status');
  var callControls = el('call-controls');
  var localVideo = el('local-video');
  var remoteVideo = el('remote-video');
  var ringtone = el('ringtone');

  // === UTIL ===
  function fmtTime(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function avatarLetter(name) {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function autoLink(s) {
    return escapeHtml(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function showError(elm, msg) {
    elm.textContent = msg || '';
  }
  function pairKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }
  function contactDisplayName(c) {
    if (!c) return '';
    return c.nickname || contactDisplayName(c) || '';
  }

  // === AUTH UI ===
  var authMode = 'login'; // 'login' | 'register'
  function setAuthMode(m) {
    authMode = m;
    if (m === 'login') {
      authSub.textContent = 'Войти в аккаунт';
      authSubmit.textContent = 'Войти';
      authToggle.textContent = 'Нет аккаунта? Зарегистрироваться';
    } else {
      authSub.textContent = 'Создать аккаунт';
      authSubmit.textContent = 'Зарегистрироваться';
      authToggle.textContent = 'Уже есть аккаунт? Войти';
    }
    showError(authError, '');
  }
  authToggle.addEventListener('click', function (e) {
    e.preventDefault();
    setAuthMode(authMode === 'login' ? 'register' : 'login');
  });

  function validUsername(u) {
    return /^[a-zA-Z0-9_\.\-]{3,32}$/.test(u);
  }

  authSubmit.addEventListener('click', async function () {
    var u = authUsername.value.trim().toLowerCase();
    var p = authPassword.value;
    showError(authError, '');
    if (!validUsername(u)) {
      showError(authError, 'Ник: 3-32 символа, латиница/цифры/_-.');
      return;
    }
    if (p.length < 6) {
      showError(authError, 'Пароль минимум 6 символов');
      return;
    }
    authSubmit.disabled = true;
    try {
      var email = u + '@' + EMAIL_DOMAIN;
      if (authMode === 'register') {
        // Проверка занятости ника — чтобы не создавать orphan auth user
        var pre = await sb.from('profiles').select('id').eq('username', u).maybeSingle();
        if (pre.data) { showError(authError, 'Этот ник занят'); return; }
        var resp = await sb.auth.signUp({
          email: email,
          password: p,
          options: { data: { username: u, display_name: u } }
        });
        if (resp.error) throw resp.error;
        // Если email-confirmation выключен — sign-in пройдёт
        var s = await sb.auth.signInWithPassword({ email: email, password: p });
        if (s.error) {
          if (/confirm/i.test(s.error.message)) {
            showError(authError, 'Включите аккаунт: в Supabase Dashboard → Authentication → Providers → Email отключите Confirm email.');
            return;
          }
          throw s.error;
        }
      } else {
        var s2 = await sb.auth.signInWithPassword({ email: email, password: p });
        if (s2.error) {
          if (/Invalid/.test(s2.error.message)) {
            showError(authError, 'Неверный ник или пароль');
            return;
          }
          throw s2.error;
        }
      }
      await onAuthed();
    } catch (e) {
      showError(authError, e.message || 'Ошибка');
    } finally {
      authSubmit.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', async function () {
    if (!confirm('Выйти?')) return;
    teardownRealtime();
    await sb.auth.signOut();
    location.reload();
  });

  // === BOOTSTRAP ===
  async function start() {
    var sess = await sb.auth.getSession();
    if (sess && sess.data && sess.data.session) {
      await onAuthed();
    } else {
      authScreen.classList.remove('hidden');
      app.classList.add('hidden');
    }
  }

  async function onAuthed() {
    var u = await sb.auth.getUser();
    if (!u || !u.data || !u.data.user) {
      authScreen.classList.remove('hidden');
      return;
    }
    var userId = u.data.user.id;
    // Загружаем профиль
    var pr = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (pr.error || !pr.data) {
      // На всякий случай создадим, если триггер не сработал
      var meta = u.data.user.user_metadata || {};
      var fallbackUsername = (meta.username || (u.data.user.email || '').split('@')[0] || 'user').toLowerCase();
      var ins = await sb.from('profiles').upsert({
        id: userId,
        username: fallbackUsername,
        display_name: meta.display_name || fallbackUsername
      }).select('*').single();
      if (ins.error) {
        showError(authError, 'Не удалось создать профиль: ' + ins.error.message);
        return;
      }
      me = ins.data;
    } else {
      me = pr.data;
    }
    meName.textContent = me.display_name || me.username;
    meUsername.textContent = '@' + me.username;
    authScreen.classList.add('hidden');
    app.classList.remove('hidden');
    await loadContacts();
    setupRealtime();
    initNotifications();
  }

  // === CONTACTS ===
  async function loadContacts() {
    contactsList.innerHTML = '<div style="padding:14px;color:#888;font-size:13px;">Загрузка…</div>';
    var res = await sb.from('contacts')
      .select('contact_id, nickname, profiles:contact_id (id, username, display_name, avatar_url)')
      .eq('owner_id', me.id);
    if (res.error) {
      contactsList.innerHTML = '<div style="padding:14px;color:#c00;font-size:13px;">' + escapeHtml(res.error.message) + '</div>';
      return;
    }
    contacts = (res.data || []).map(function (r) {
      var p = r.profiles;
      return {
        id: p.id, username: p.username,
        display_name: p.display_name, avatar_url: p.avatar_url,
        nickname: r.nickname || null
      };
    });
    // Подгружаем последние сообщения для preview
    await loadLastMessages();
    renderContacts();
  }

  async function loadLastMessages() {
    if (!contacts.length) return;
    var ids = contacts.map(function (c) { return c.id; });
    // Возьмём последние 1 сообщение по каждому собеседнику. Простой вариант: одним запросом — последние 50, разложим по парам.
    var res = await sb.from('messages')
      .select('*')
      .or('sender_id.in.(' + ids.join(',') + '),recipient_id.in.(' + ids.join(',') + ')')
      .order('created_at', { ascending: false })
      .limit(200);
    if (res.error) return;
    var seen = {};
    var msgs = res.data || [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var peer = (m.sender_id === me.id) ? m.recipient_id : m.sender_id;
      if (!seen[peer]) {
        seen[peer] = m;
      }
    }
    for (var j = 0; j < contacts.length; j++) {
      var c = contacts[j];
      c.lastMessage = seen[c.id] || null;
    }
    contacts.sort(function (a, b) {
      var ta = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
      var tb = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
      return tb - ta;
    });
  }

  function renderContacts() {
    if (!contacts.length) {
      contactsList.innerHTML = '<div style="padding:18px;color:#888;font-size:14px;text-align:center;">Контактов нет.<br>Нажми «+» сверху.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < contacts.length; i++) {
      var c = contacts[i];
      var preview = '';
      if (c.lastMessage) {
        if (c.lastMessage.kind === 'text') preview = c.lastMessage.content || '';
        else if (c.lastMessage.kind === 'image') preview = 'Фото';
        else if (c.lastMessage.kind === 'video') preview = 'Видео';
        else if (c.lastMessage.kind === 'voice') preview = 'Голосовое';
      }
      var unread = unreadByPeer[c.id] || 0;
      html += '<div class="contact-row' + (c.id === currentContactId ? ' active' : '') + '" data-id="' + c.id + '">' +
        '<div class="avatar">' + escapeHtml(avatarLetter(contactDisplayName(c))) + '</div>' +
        '<div class="info">' +
          '<div class="name">' + escapeHtml(contactDisplayName(c)) + '</div>' +
          '<div class="preview">' + escapeHtml(preview) + '</div>' +
        '</div>' +
        (unread ? '<div class="badge">' + unread + '</div>' : '') +
      '</div>';
    }
    contactsList.innerHTML = html;
    var rows = contactsList.querySelectorAll('.contact-row');
    for (var k = 0; k < rows.length; k++) {
      rows[k].addEventListener('click', function () {
        openChat(this.getAttribute('data-id'));
      });
    }
  }

  // === ADD CONTACT ===
  addContactBtn.addEventListener('click', function () {
    addContactInput.value = '';
    showError(addContactError, '');
    addContactModal.classList.remove('hidden');
    setTimeout(function () { addContactInput.focus(); }, 50);
  });
  addContactCancel.addEventListener('click', function () {
    addContactModal.classList.add('hidden');
  });
  addContactOk.addEventListener('click', async function () {
    var u = addContactInput.value.trim().toLowerCase();
    showError(addContactError, '');
    if (!validUsername(u)) {
      showError(addContactError, 'Неверный ник');
      return;
    }
    if (u === me.username) {
      showError(addContactError, 'Это ты сам');
      return;
    }
    addContactOk.disabled = true;
    try {
      // Используем RPC: создаёт взаимную связь обходя RLS, проверяет наличие пользователя
      var rpc = await sb.rpc('add_mutual_contact', { target_username: u });
      if (rpc.error) {
        if (/not found/.test(rpc.error.message)) showError(addContactError, 'Пользователь не найден');
        else showError(addContactError, rpc.error.message);
        return;
      }
      var added = rpc.data;
      addContactModal.classList.add('hidden');
      await loadContacts();
      renderContacts();
      if (added && added.id) openChat(added.id);
    } catch (e) {
      showError(addContactError, e.message || 'Ошибка');
    } finally {
      addContactOk.disabled = false;
    }
  });

  // === CHAT ===
  async function openChat(peerId) {
    currentContactId = peerId;
    currentContact = null;
    for (var i = 0; i < contacts.length; i++) if (contacts[i].id === peerId) currentContact = contacts[i];
    if (!currentContact) return;
    chatEmpty.classList.add('hidden');
    chatMain.classList.remove('hidden');
    chatAvatar.textContent = avatarLetter(contactDisplayName(currentContact));
    chatName.textContent = contactDisplayName(currentContact);
    document.body.classList.add('in-chat');
    unreadByPeer[peerId] = 0;
    renderContacts();
    updateGlobalUnread();
    await loadMessages(peerId);
  }
  backBtn.addEventListener('click', function () {
    document.body.classList.remove('in-chat');
    currentContactId = null;
    chatMain.classList.add('hidden');
    chatEmpty.classList.remove('hidden');
    renderContacts();
  });

  async function loadMessages(peerId) {
    messagesEl.innerHTML = '<div style="text-align:center;color:#888;padding:14px;">Загрузка…</div>';
    var res = await sb.from('messages')
      .select('*')
      .or('and(sender_id.eq.' + me.id + ',recipient_id.eq.' + peerId + '),and(sender_id.eq.' + peerId + ',recipient_id.eq.' + me.id + ')')
      .order('created_at', { ascending: true })
      .limit(500);
    if (res.error) {
      messagesEl.innerHTML = '<div style="color:#c00;text-align:center;padding:14px;">' + escapeHtml(res.error.message) + '</div>';
      return;
    }
    messagesByPeer[peerId] = res.data || [];
    renderMessages(peerId);
  }

  function renderMessages(peerId) {
    var msgs = messagesByPeer[peerId] || [];
    var html = '';
    for (var i = 0; i < msgs.length; i++) html += msgBubbleHtml(msgs[i]);
    messagesEl.innerHTML = html;
    scrollToBottom();
  }

  function msgBubbleHtml(m) {
    var out = m.sender_id === me.id;
    var inner = '';
    if (m.kind === 'text') {
      inner = '<div>' + autoLink(m.content || '') + '</div>';
    } else if (m.kind === 'image') {
      inner = '<img src="' + escapeHtml(m.media_url) + '" alt="">' +
              (m.content ? '<div style="margin-top:4px;">' + autoLink(m.content) + '</div>' : '');
    } else if (m.kind === 'video') {
      inner = '<video src="' + escapeHtml(m.media_url) + '" controls playsinline></video>' +
              (m.content ? '<div style="margin-top:4px;">' + autoLink(m.content) + '</div>' : '');
    } else if (m.kind === 'voice') {
      inner = '<audio src="' + escapeHtml(m.media_url) + '" controls preload="none"></audio>';
    }
    return '<div class="msg ' + (out ? 'out' : 'in') + '" data-msg-id="' + escapeHtml('' + m.id) + '">' +
      '<div class="bubble">' + inner + '<div class="time">' + fmtTime(m.created_at) + '</div></div>' +
    '</div>';
  }

  function appendMessage(m) {
    var peer = (m.sender_id === me.id) ? m.recipient_id : m.sender_id;
    if (!messagesByPeer[peer]) messagesByPeer[peer] = [];
    // Дедупликация
    var arr = messagesByPeer[peer];
    for (var i = arr.length - 1; i >= 0 && i >= arr.length - 30; i--) {
      if (arr[i].id === m.id) return;
    }
    arr.push(m);
    if (peer === currentContactId) {
      messagesEl.insertAdjacentHTML('beforeend', msgBubbleHtml(m));
      scrollToBottom();
    }
    // Обновим preview/sort
    for (var j = 0; j < contacts.length; j++) {
      if (contacts[j].id === peer) contacts[j].lastMessage = m;
    }
    contacts.sort(function (a, b) {
      var ta = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
      var tb = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
      return tb - ta;
    });
    renderContacts();
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function removeMessage(peerId, msgId) {
    var arr = messagesByPeer[peerId];
    if (!arr) return;
    for (var i = arr.length - 1; i >= 0; i--) {
      // == чтобы string '123' совпало с number 123 (DELETE realtime приносит number)
      if (arr[i].id == msgId) { arr.splice(i, 1); break; }
    }
    if (peerId === currentContactId) renderMessages(peerId);
  }

  // === COMPOSER ===
  function updateSendBtnVisibility() {
    var has = textInput.value.trim().length > 0;
    if (has) {
      micBtn.classList.add('hidden');
      sendBtn.classList.remove('hidden');
    } else {
      micBtn.classList.remove('hidden');
      sendBtn.classList.add('hidden');
    }
  }
  textInput.addEventListener('input', function () {
    // авто-рост
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + 'px';
    updateSendBtnVisibility();
  });
  textInput.addEventListener('keydown', function (e) {
    // Enter без модификаторов — отправка. Shift+Enter — перенос строки.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      sendText();
    }
  });
  sendBtn.addEventListener('click', sendText);

  async function sendText() {
    if (!currentContactId) return;
    var t = textInput.value.trim();
    if (!t) return;
    textInput.value = '';
    textInput.style.height = 'auto';
    updateSendBtnVisibility();
    var optimistic = {
      id: 'temp-' + Date.now(),
      sender_id: me.id, recipient_id: currentContactId,
      kind: 'text', content: t, created_at: new Date().toISOString()
    };
    appendMessage(optimistic);
    var res = await sb.from('messages').insert({
      sender_id: me.id, recipient_id: currentContactId,
      kind: 'text', content: t
    }).select('*').single();
    if (res.error) {
      removeMessage(currentContactId, optimistic.id);
      alert('Не отправлено: ' + res.error.message);
      return;
    }
    // Заменим временное на реальное (по id)
    var arr = messagesByPeer[currentContactId];
    if (arr) {
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === optimistic.id) { arr[i] = res.data; break; }
      }
      renderMessages(currentContactId);
    }
  }

  // === ATTACH (фото/видео) ===
  attachBtn.addEventListener('click', function () {
    fileInput.click();
  });
  fileInput.addEventListener('change', async function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f || !currentContactId) return;
    var kind = f.type.indexOf('video') === 0 ? 'video' : 'image';
    if (f.size > 20 * 1024 * 1024) {
      alert('Файл больше 20 МБ');
      return;
    }
    await uploadAndSend(f, kind);
  });

  async function uploadAndSend(file, kind) {
    var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    var path = me.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var optimistic = {
      id: 'temp-' + Date.now(),
      sender_id: me.id, recipient_id: currentContactId,
      kind: kind, content: 'Загрузка…', media_url: '', created_at: new Date().toISOString()
    };
    appendMessage(optimistic);
    var up = await sb.storage.from('media').upload(path, file, {
      contentType: file.type, cacheControl: '3600', upsert: false
    });
    if (up.error) {
      removeMessage(currentContactId, optimistic.id);
      alert('Загрузка не удалась: ' + up.error.message);
      return;
    }
    var pub = sb.storage.from('media').getPublicUrl(path);
    var url = pub.data.publicUrl;
    var res = await sb.from('messages').insert({
      sender_id: me.id, recipient_id: currentContactId,
      kind: kind, media_url: url
    }).select('*').single();
    if (res.error) {
      removeMessage(currentContactId, optimistic.id);
      alert('Не отправлено: ' + res.error.message);
      return;
    }
    var arr = messagesByPeer[currentContactId];
    if (arr) {
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === optimistic.id) { arr[i] = res.data; break; }
      }
      renderMessages(currentContactId);
    }
  }

  // === ГОЛОСОВЫЕ (WebAudio → WAV) ===
  var recState = null; // { ctx, stream, processor, source, samples, sampleRate, startedAt }
  var recIndicator = el('recording-indicator');
  var recTime = el('rec-time');
  var recTimer = null;
  var recCancelled = false;

  function ensureAudioContext() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    return Ctx ? new Ctx() : null;
  }

  async function startRecording() {
    if (recState) return;
    if (!currentContactId) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Микрофон не поддерживается');
      return;
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      var ctx = ensureAudioContext();
      if (!ctx) throw new Error('Нет AudioContext');
      var source = ctx.createMediaStreamSource(stream);
      var bufSize = 4096;
      var processor = (ctx.createScriptProcessor || ctx.createJavaScriptNode).call(ctx, bufSize, 1, 1);
      var samples = [];
      processor.onaudioprocess = function (e) {
        var ch = e.inputBuffer.getChannelData(0);
        // copy
        var copy = new Float32Array(ch.length);
        for (var i = 0; i < ch.length; i++) copy[i] = ch[i];
        samples.push(copy);
      };
      // Подключаем processor через gain=0 чтобы не было эха в динамиках
      var muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(ctx.destination);
      recState = {
        ctx: ctx, stream: stream, processor: processor, source: source,
        samples: samples, sampleRate: ctx.sampleRate, startedAt: Date.now()
      };
      recCancelled = false;
      micBtn.classList.add('recording');
      recIndicator.classList.remove('hidden');
      recTime.textContent = '0:00';
      recTimer = setInterval(function () {
        var s = Math.floor((Date.now() - recState.startedAt) / 1000);
        var mm = Math.floor(s / 60), ss = s % 60;
        recTime.textContent = mm + ':' + (ss < 10 ? '0' : '') + ss;
        if (s >= 120) stopRecording(); // лимит 2 минуты
      }, 250);
    } catch (e) {
      alert('Микрофон недоступен: ' + (e.message || e));
    }
  }

  function cancelRecording() {
    recCancelled = true;
    stopRecording();
  }

  function stopRecording() {
    if (!recState) return;
    var st = recState; recState = null;
    micBtn.classList.remove('recording');
    recIndicator.classList.add('hidden');
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    try { st.processor.disconnect(); } catch (e) {}
    try { st.source.disconnect(); } catch (e) {}
    try {
      var tracks = st.stream.getTracks();
      for (var i = 0; i < tracks.length; i++) tracks[i].stop();
    } catch (e) {}
    try { st.ctx.close(); } catch (e) {}

    if (recCancelled) return;
    var durationMs = Date.now() - st.startedAt;
    if (durationMs < 400) return; // слишком короткое — игнор

    // Объединяем samples
    var totalLen = 0;
    for (var i = 0; i < st.samples.length; i++) totalLen += st.samples[i].length;
    var pcm = new Float32Array(totalLen);
    var off = 0;
    for (var j = 0; j < st.samples.length; j++) {
      pcm.set(st.samples[j], off);
      off += st.samples[j].length;
    }
    // Даунсэмплируем до 16000 Гц для уменьшения размера
    var target = 16000;
    var down = downsampleBuffer(pcm, st.sampleRate, target);
    var wav = encodeWav(down, target);
    var blob = new Blob([wav], { type: 'audio/wav' });
    blob.durationMs = durationMs;
    blob.name = 'voice.wav';
    // Завернём в File-подобный объект (не везде доступен File конструктор на iOS 12)
    var file = blob;
    file.name = 'voice.wav';
    uploadAndSendVoice(file, durationMs);
  }

  async function uploadAndSendVoice(blob, durationMs) {
    if (!currentContactId) return;
    var path = me.id + '/voice-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.wav';
    var optimistic = {
      id: 'temp-' + Date.now(),
      sender_id: me.id, recipient_id: currentContactId,
      kind: 'voice', media_url: '', duration_ms: durationMs, created_at: new Date().toISOString()
    };
    appendMessage(optimistic);
    var up = await sb.storage.from('media').upload(path, blob, {
      contentType: 'audio/wav', cacheControl: '3600', upsert: false
    });
    if (up.error) {
      removeMessage(currentContactId, optimistic.id);
      alert('Не загрузилось: ' + up.error.message);
      return;
    }
    var url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
    var res = await sb.from('messages').insert({
      sender_id: me.id, recipient_id: currentContactId,
      kind: 'voice', media_url: url, duration_ms: durationMs
    }).select('*').single();
    if (res.error) {
      removeMessage(currentContactId, optimistic.id);
      alert('Не отправлено: ' + res.error.message);
      return;
    }
    var arr = messagesByPeer[currentContactId];
    if (arr) {
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i].id === optimistic.id) { arr[i] = res.data; break; }
      }
      renderMessages(currentContactId);
    }
  }

  function downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate >= sampleRate) return buffer;
    var ratio = sampleRate / outSampleRate;
    var newLen = Math.round(buffer.length / ratio);
    var result = new Float32Array(newLen);
    var offsetResult = 0, offsetBuffer = 0;
    while (offsetResult < newLen) {
      var nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      var accum = 0, count = 0;
      for (var i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i]; count++;
      }
      result[offsetResult] = count ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function encodeWav(samples, sampleRate) {
    var buffer = new ArrayBuffer(44 + samples.length * 2);
    var view = new DataView(buffer);
    function writeStr(off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    var off = 44;
    for (var i = 0; i < samples.length; i++, off += 2) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }

  // Жесты на микрофон: hold-to-record. Защита от synthetic mouse-эвентов после touch.
  function attachHoldRecord(btn) {
    var pressed = false;
    var lastTouchAt = 0;
    function down(e) {
      if (sendBtn.classList.contains('hidden') === false) return; // если виден самолётик — не записываем
      // Игнорируем synthetic mouse после touch (iOS присылает их с задержкой ~300мс)
      if (e.type.indexOf('mouse') === 0 && (Date.now() - lastTouchAt) < 800) return;
      e.preventDefault();
      pressed = true;
      startRecording();
    }
    function up(e) {
      if (e.type === 'touchend') { lastTouchAt = Date.now(); e.preventDefault(); }
      if (!pressed) return;
      pressed = false;
      stopRecording();
    }
    function cancel(e) {
      if (e && e.type === 'touchcancel') lastTouchAt = Date.now();
      if (!pressed) return;
      pressed = false;
      cancelRecording();
    }
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up);
    btn.addEventListener('touchcancel', cancel);
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', cancel);
  }
  attachHoldRecord(micBtn);

  // === MESSAGE ACTIONS (тап на свой bubble) ===
  var pendingDeleteMsgId = null;
  messagesEl.addEventListener('click', function (e) {
    var node = e.target;
    while (node && node !== messagesEl && !node.classList.contains('msg')) node = node.parentNode;
    if (!node || !node.classList || !node.classList.contains('msg')) return;
    if (!node.classList.contains('out')) return; // удалять можно только свои
    // Если кликнули по медиа-контролю (audio/video/img/a) — не показываем меню
    var t = e.target.tagName;
    if (t === 'AUDIO' || t === 'VIDEO' || t === 'A') return;
    var id = node.getAttribute('data-msg-id');
    if (!id || id.indexOf('temp-') === 0) return;
    pendingDeleteMsgId = id;
    msgActionsModal.classList.remove('hidden');
  });
  msgActionsCancel.addEventListener('click', function () {
    msgActionsModal.classList.add('hidden');
    pendingDeleteMsgId = null;
  });
  msgDeleteBtn.addEventListener('click', async function () {
    var id = pendingDeleteMsgId;
    pendingDeleteMsgId = null;
    msgActionsModal.classList.add('hidden');
    if (!id) return;
    var res = await sb.from('messages').delete().eq('id', id).eq('sender_id', me.id);
    if (res.error) { alert('Не удалось удалить: ' + res.error.message); return; }
    // Удалим локально (realtime DELETE придёт собеседнику)
    if (currentContactId) removeMessage(currentContactId, parseInt(id, 10));
    // Также обновим preview контакта если это было последнее сообщение
    refreshPreviews();
  });

  function refreshPreviews() {
    if (!currentContactId) { renderContacts(); return; }
    var arr = messagesByPeer[currentContactId];
    var last = arr && arr.length ? arr[arr.length - 1] : null;
    for (var i = 0; i < contacts.length; i++) {
      if (contacts[i].id === currentContactId) contacts[i].lastMessage = last;
    }
    renderContacts();
  }

  // === EDIT CONTACT (имя контакта в шапке чата) ===
  chatNameBtn.addEventListener('click', function () {
    if (!currentContact) return;
    editContactName.value = contactDisplayName(currentContact);
    editContactUsername.textContent = '@' + currentContact.username;
    editContactModal.classList.remove('hidden');
    setTimeout(function () { editContactName.focus(); editContactName.select(); }, 60);
  });
  editContactCancel.addEventListener('click', function () {
    editContactModal.classList.add('hidden');
  });
  editContactSave.addEventListener('click', async function () {
    if (!currentContact) return;
    var newName = editContactName.value.trim();
    // Если ввели что-то отличное от server-имени — сохраняем как nickname; если пусто — обнуляем
    var nick = (newName && newName !== (currentContact.display_name || currentContact.username)) ? newName : null;
    var res = await sb.from('contacts').update({ nickname: nick })
      .eq('owner_id', me.id).eq('contact_id', currentContact.id);
    if (res.error) { alert('Не сохранилось: ' + res.error.message); return; }
    currentContact.nickname = nick;
    chatName.textContent = contactDisplayName(currentContact);
    chatAvatar.textContent = avatarLetter(contactDisplayName(currentContact));
    renderContacts();
    editContactModal.classList.add('hidden');
  });
  editContactDelete.addEventListener('click', async function () {
    if (!currentContact) return;
    if (!confirm('Удалить контакт «' + contactDisplayName(currentContact) + '»? Переписка останется на сервере, но контакт исчезнет из списка.')) return;
    var peerId = currentContact.id;
    var res = await sb.from('contacts').delete()
      .eq('owner_id', me.id).eq('contact_id', peerId);
    if (res.error) { alert('Не удалилось: ' + res.error.message); return; }
    contacts = contacts.filter(function (c) { return c.id !== peerId; });
    delete messagesByPeer[peerId];
    delete unreadByPeer[peerId];
    currentContactId = null; currentContact = null;
    chatMain.classList.add('hidden');
    chatEmpty.classList.remove('hidden');
    document.body.classList.remove('in-chat');
    editContactModal.classList.add('hidden');
    renderContacts();
  });

  // === REALTIME ===
  function setupRealtime() {
    teardownRealtime();
    realtimeChan = sb.channel('user-' + me.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: 'recipient_id=eq.' + me.id
      }, function (payload) {
        onIncomingMessage(payload['new']);
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages'
      }, function (payload) {
        var old = payload['old'];
        if (!old || !old.id) return;
        // Удаление касается нас если мы sender или recipient
        if (old.sender_id !== me.id && old.recipient_id !== me.id) return;
        var peer = (old.sender_id === me.id) ? old.recipient_id : old.sender_id;
        removeMessage(peer, old.id);
        // Обновим preview
        if (peer === currentContactId) {
          var arr = messagesByPeer[peer];
          var last = arr && arr.length ? arr[arr.length - 1] : null;
          for (var i = 0; i < contacts.length; i++) {
            if (contacts[i].id === peer) contacts[i].lastMessage = last;
          }
          renderContacts();
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'calls',
        filter: 'callee_id=eq.' + me.id
      }, function (payload) {
        onIncomingCall(payload['new']);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls'
      }, function (payload) {
        onCallUpdate(payload['new']);
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'call_signals',
        filter: 'to_id=eq.' + me.id
      }, function (payload) {
        onCallSignal(payload['new']);
      })
      .subscribe();
  }
  function teardownRealtime() {
    if (realtimeChan) { try { sb.removeChannel(realtimeChan); } catch (e) {} realtimeChan = null; }
  }

  var loadingContacts = false;
  async function onIncomingMessage(m) {
    // Если контакта нет в списке — перечитаем (триггер на сервере уже добавил пару)
    var found = false;
    for (var i = 0; i < contacts.length; i++) if (contacts[i].id === m.sender_id) { found = true; break; }
    if (!found && !loadingContacts) {
      loadingContacts = true;
      try { await loadContacts(); } finally { loadingContacts = false; }
    }
    appendMessage(m);
    if (m.sender_id !== currentContactId || document.hidden) {
      unreadByPeer[m.sender_id] = (unreadByPeer[m.sender_id] || 0) + 1;
      renderContacts();
      bumpNotification();
      playNotifSound();
    }
  }

  // === УВЕДОМЛЕНИЯ ===
  var notifAudio = null;
  function initNotifications() {
    // короткий синтетический "блип"
    notifAudio = generateBlipDataUrl();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        notifPending = 0;
        document.title = lastNotifTitle;
        updateFavicon(0);
      }
    });
  }
  function bumpNotification() {
    if (!document.hidden) return;
    notifPending++;
    document.title = '(' + notifPending + ') ' + lastNotifTitle;
    updateFavicon(notifPending);
  }
  function playNotifSound() {
    if (!notifAudio) return;
    try {
      var a = new Audio(notifAudio);
      a.volume = 0.6;
      var p = a.play();
      if (p && p['catch']) p['catch'](function () {});
    } catch (e) {}
  }
  function updateFavicon(count) {
    var canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#517da2';
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('M', 32, 34);
    if (count > 0) {
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath(); ctx.arc(48, 16, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif';
      ctx.fillText(count > 9 ? '9+' : ('' + count), 48, 17);
    }
    var url = canvas.toDataURL('image/png');
    var link = document.querySelector("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;
  }
  function generateBlipDataUrl() {
    // 0.15s 880Hz beep WAV
    var sr = 22050, dur = 0.15, n = Math.floor(sr * dur);
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      var env = Math.min(1, t * 30) * Math.max(0, 1 - t / dur);
      var s = Math.sin(2 * Math.PI * 880 * t) * 0.5 * env;
      v.setInt16(44 + i * 2, s * 0x7fff, true);
    }
    var bytes = new Uint8Array(buf);
    var bin = '';
    for (var k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function updateGlobalUnread() {
    var total = 0;
    for (var k in unreadByPeer) if (unreadByPeer.hasOwnProperty(k)) total += unreadByPeer[k];
    if (total > 0 && document.hidden) {
      document.title = '(' + total + ') ' + lastNotifTitle;
      updateFavicon(total);
    } else {
      document.title = lastNotifTitle;
      updateFavicon(0);
    }
  }

  // === ЗВОНКИ (WebRTC) ===
  var call = null; // { id, peerId, type, role, pc, localStream, remoteStream, status, ringingTimer }

  audioCallBtn.addEventListener('click', function () { if (currentContactId) startCall(currentContactId, 'audio'); });
  videoCallBtn.addEventListener('click', function () { if (currentContactId) startCall(currentContactId, 'video'); });

  async function startCall(peerId, type) {
    if (call) return;
    var insert = await sb.from('calls').insert({
      caller_id: me.id, callee_id: peerId, type: type, status: 'ringing'
    }).select('*').single();
    if (insert.error) { alert('Не удалось позвонить: ' + insert.error.message); return; }
    call = {
      id: insert.data.id, peerId: peerId, type: type, role: 'caller',
      pc: null, localStream: null, remoteStream: null, status: 'ringing'
    };
    showCallScreen();
    setCallStatus('Вызов…');
    playRingback();
    try {
      await initPeerConnection();
      var offer = await call.pc.createOffer();
      await call.pc.setLocalDescription(offer);
      await sendSignal({ kind: 'offer', sdp: offer });
      // таймаут 40 сек
      call.ringingTimer = setTimeout(function () {
        if (call && call.status === 'ringing') {
          endCall('missed');
        }
      }, 40000);
    } catch (e) {
      alert('Ошибка камеры/микрофона: ' + (e.message || e));
      endCall('ended');
    }
  }

  async function onIncomingCall(c) {
    if (call) return; // уже в звонке — игнор
    if (c.status !== 'ringing') return;
    call = {
      id: c.id, peerId: c.caller_id, type: c.type, role: 'callee',
      pc: null, localStream: null, remoteStream: null, status: 'ringing',
      pendingRemoteOffer: null, pendingCandidates: []
    };
    var peer = null;
    for (var i = 0; i < contacts.length; i++) if (contacts[i].id === c.caller_id) peer = contacts[i];
    if (!peer) {
      // незнакомый — подгрузим профиль
      var pr = await sb.from('profiles').select('*').eq('id', c.caller_id).maybeSingle();
      if (pr.data) peer = pr.data;
    }
    callName.textContent = peer ? contactDisplayName(peer) : 'Входящий';
    showCallScreen(true);
    setCallStatus(c.type === 'video' ? 'Входящий видеозвонок' : 'Входящий аудиозвонок');
    playRingtone();
    bumpNotification();
  }

  async function acceptCall() {
    if (!call || call.role !== 'callee') return;
    stopRingtone();
    setCallStatus('Соединение…');
    try {
      await initPeerConnection();
      if (call.pendingRemoteOffer) {
        await call.pc.setRemoteDescription(new RTCSessionDescription(call.pendingRemoteOffer));
      }
      var ans = await call.pc.createAnswer();
      await call.pc.setLocalDescription(ans);
      await sendSignal({ kind: 'answer', sdp: ans });
      // применим накопленные кандидаты
      if (call.pendingCandidates && call.pendingCandidates.length) {
        for (var i = 0; i < call.pendingCandidates.length; i++) {
          try { await call.pc.addIceCandidate(call.pendingCandidates[i]); } catch (e) {}
        }
        call.pendingCandidates = [];
      }
      await sb.from('calls').update({ status: 'active' }).eq('id', call.id);
      call.status = 'active';
      setCallStatus('В разговоре');
    } catch (e) {
      alert('Ошибка: ' + (e.message || e));
      endCall('ended');
    }
  }

  async function declineCall() {
    if (!call) return;
    await sb.from('calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', call.id);
    teardownCall();
  }

  async function endCall(status) {
    if (!call) return;
    var id = call.id;
    teardownCall();
    if (id != null) {
      await sb.from('calls').update({
        status: status || 'ended',
        ended_at: new Date().toISOString()
      }).eq('id', id);
    }
  }

  function teardownCall() {
    stopRingtone();
    stopRingback();
    if (call) {
      if (call.ringingTimer) clearTimeout(call.ringingTimer);
      try { if (call.pc) call.pc.close(); } catch (e) {}
      try {
        if (call.localStream) {
          var t = call.localStream.getTracks();
          for (var i = 0; i < t.length; i++) t[i].stop();
        }
      } catch (e) {}
    }
    call = null;
    callScreen.classList.add('hidden');
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  }

  async function initPeerConnection() {
    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    call.pc = pc;
    pc.onicecandidate = function (e) {
      if (e.candidate) {
        sendSignal({ kind: 'ice', candidate: e.candidate.toJSON ? e.candidate.toJSON() : {
          candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex
        } });
      }
    };
    pc.ontrack = function (e) {
      remoteVideo.srcObject = e.streams[0];
      call.remoteStream = e.streams[0];
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected') setCallStatus('В разговоре');
      else if (pc.connectionState === 'failed') { setCallStatus('Соединение потеряно'); endCall('ended'); }
      else if (pc.connectionState === 'disconnected') setCallStatus('Связь прерывается…');
    };
    var constraints = { audio: true, video: call.type === 'video' };
    var stream = await navigator.mediaDevices.getUserMedia(constraints);
    call.localStream = stream;
    localVideo.srcObject = stream;
    var tracks = stream.getTracks();
    for (var i = 0; i < tracks.length; i++) pc.addTrack(tracks[i], stream);
    if (call.type !== 'video') {
      localVideo.style.display = 'none';
      remoteVideo.style.background = 'linear-gradient(180deg,#243447,#1d2b3a)';
    } else {
      localVideo.style.display = '';
    }
  }

  async function sendSignal(payload) {
    if (!call) return;
    await sb.from('call_signals').insert({
      call_id: call.id, from_id: me.id, to_id: call.peerId, payload: payload
    });
  }

  async function onCallSignal(s) {
    if (!call) return;
    if (s.call_id !== call.id) return;
    var p = s.payload;
    if (p.kind === 'offer') {
      // Caller offer пришёл (мы callee). Сохраним до accept.
      call.pendingRemoteOffer = p.sdp;
    } else if (p.kind === 'answer') {
      try {
        await call.pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
        if (call.pendingCandidates && call.pendingCandidates.length) {
          for (var i = 0; i < call.pendingCandidates.length; i++) {
            try { await call.pc.addIceCandidate(call.pendingCandidates[i]); } catch (ee) {}
          }
          call.pendingCandidates = [];
        }
      } catch (e) {}
    } else if (p.kind === 'ice') {
      try {
        var c = new RTCIceCandidate(p.candidate);
        if (call.pc && call.pc.remoteDescription && call.pc.remoteDescription.type) {
          await call.pc.addIceCandidate(c);
        } else {
          if (!call.pendingCandidates) call.pendingCandidates = [];
          call.pendingCandidates.push(c);
        }
      } catch (e) {}
    } else if (p.kind === 'bye') {
      teardownCall();
    }
  }

  function onCallUpdate(c) {
    if (!call || call.id !== c.id) return;
    if (c.status === 'active' && call.role === 'caller') {
      stopRingback();
      call.status = 'active';
      setCallStatus('В разговоре');
    } else if (c.status === 'ended' || c.status === 'declined' || c.status === 'missed') {
      if (c.status === 'declined') setCallStatus('Отклонён');
      else if (c.status === 'missed') setCallStatus('Не отвечает');
      setTimeout(teardownCall, 1200);
    }
  }

  function showCallScreen(incoming) {
    callScreen.classList.remove('hidden');
    var peer = currentContact;
    if (!peer && call) {
      for (var i = 0; i < contacts.length; i++) if (contacts[i].id === call.peerId) peer = contacts[i];
    }
    if (peer) callName.textContent = contactDisplayName(peer);
    callControls.innerHTML = '';
    if (incoming) {
      callControls.innerHTML =
        '<button class="ctl decline" id="ctl-decline" aria-label="Отклонить">' + iconHangup() + '</button>' +
        '<button class="ctl accept" id="ctl-accept" aria-label="Принять">' + iconPhone() + '</button>';
      el('ctl-accept').addEventListener('click', acceptCall);
      el('ctl-decline').addEventListener('click', declineCall);
    } else {
      callControls.innerHTML =
        '<button class="ctl mute" id="ctl-mute" aria-label="Микрофон">' + iconMic() + '</button>' +
        '<button class="ctl hangup" id="ctl-hangup" aria-label="Завершить">' + iconHangup() + '</button>';
      el('ctl-hangup').addEventListener('click', async function () {
        try { await sendSignal({ kind: 'bye' }); } catch (e) {}
        endCall('ended');
      });
      el('ctl-mute').addEventListener('click', function () {
        if (!call || !call.localStream) return;
        var t = call.localStream.getAudioTracks();
        if (!t.length) return;
        t[0].enabled = !t[0].enabled;
        this.classList.toggle('on', !t[0].enabled);
      });
    }
  }
  function setCallStatus(s) { callStatus.textContent = s; }

  function iconPhone() { return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>'; }
  function iconHangup() { return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>'; }
  function iconMic() { return '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'; }

  // === RINGING SOUNDS ===
  var ringbackTimer = null;
  var ringbackCtx = null;
  function playRingback() {
    stopRingback();
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ringbackCtx = new Ctx();
    var ctx = ringbackCtx;
    function tone() {
      var t0 = ctx.currentTime;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 440; o.type = 'sine';
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.1, t0 + 0.05);
      g.gain.linearRampToValueAtTime(0, t0 + 1.4);
      o.start(t0); o.stop(t0 + 1.5);
    }
    tone();
    ringbackTimer = setInterval(tone, 3000);
  }
  function stopRingback() {
    if (ringbackTimer) { clearInterval(ringbackTimer); ringbackTimer = null; }
    if (ringbackCtx) { try { ringbackCtx.close(); } catch (e) {} ringbackCtx = null; }
  }

  function ringtoneDataUrl() {
    // 1.5s tritone WAV — типа классического звонка
    var sr = 22050, dur = 1.5, n = Math.floor(sr * dur);
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    function ws(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    ws(0,'RIFF'); v.setUint32(4,36+n*2,true); ws(8,'WAVE'); ws(12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
    ws(36,'data'); v.setUint32(40,n*2,true);
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      var phase = (t % 0.5);
      var f = phase < 0.25 ? 600 : 800;
      var env = Math.min(1, phase * 12) * Math.max(0, 1 - phase * 4);
      var s = Math.sin(2 * Math.PI * f * t) * env * 0.5;
      v.setInt16(44 + i * 2, s * 0x7fff, true);
    }
    var bytes = new Uint8Array(buf), bin = '';
    for (var k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  var ringtoneUrl = null;
  function playRingtone() {
    if (!ringtoneUrl) ringtoneUrl = ringtoneDataUrl();
    ringtone.src = ringtoneUrl;
    ringtone.loop = true;
    ringtone.volume = 0.7;
    var p = ringtone.play();
    if (p && p['catch']) p['catch'](function () {});
  }
  function stopRingtone() {
    try { ringtone.pause(); ringtone.currentTime = 0; } catch (e) {}
  }

  // === ИНИЦИАЛИЗАЦИЯ ===
  setAuthMode('login');
  start();

  // Просим разрешение на звук при первом тапе (iOS требует user-gesture).
  // Также «прогреваем» <audio id="ringtone"> чтобы потом он мог играть без нового жеста.
  document.addEventListener('touchend', function unlock() {
    document.removeEventListener('touchend', unlock);
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        var c = new Ctx();
        var o = c.createOscillator(), g = c.createGain();
        g.gain.value = 0; o.connect(g); g.connect(c.destination);
        o.start(0); o.stop(0.01);
      }
      // прогрев audio: запустить и сразу остановить
      try {
        ringtone.muted = true;
        var pp = ringtone.play();
        if (pp && pp.then) pp.then(function () { ringtone.pause(); ringtone.currentTime = 0; ringtone.muted = false; }, function () { ringtone.muted = false; });
        else { ringtone.pause(); ringtone.muted = false; }
      } catch (e) {}
    } catch (e) {}
  }, false);

  // Прокрутка к нижней части чата когда появляется клавиатура (iOS клавиатура накладывается)
  textInput.addEventListener('focus', function () {
    setTimeout(function () {
      try { textInput.scrollIntoView({ block: 'end' }); } catch (e) {
        // iOS 12 fallback
        var rect = textInput.getBoundingClientRect();
        window.scrollTo(0, rect.bottom);
      }
      scrollToBottom();
    }, 350);
  });

})();
