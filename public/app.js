// Smart Talk AI - frontend logic (no frameworks, no build step)

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const el = {
    sidebar: $("#sidebar"),
    scrim: $("#scrim"),
    openSidebar: $("#openSidebar"),
    closeSidebar: $("#closeSidebar"),
    newChatBtn: $("#newChatBtn"),
    historyList: $("#historyList"),
    historyEmpty: $("#historyEmpty"),
    chatTitle: $("#chatTitle"),
    autoSpeakBtn: $("#autoSpeakBtn"),
    messages: $("#messages"),
    emptyState: $("#emptyState"),
    composer: $("#composer"),
    input: $("#input"),
    micBtn: $("#micBtn"),
    sendBtn: $("#sendBtn"),
    toast: $("#toast"),
  };

  const CHATS_KEY = "smarttalk.chats.v1";
  const SPEAK_KEY = "smarttalk.autospeak.v1";
  const REQUEST_TIMEOUT_MS = 70000;
  const APP_TITLE = "Smart Talk AI";

  const ICONS = {
    speaker:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    stop:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  };

  // ---------------------------------------------------------------- state
  let chats = loadChats();
  let activeId = null;
  let busy = false;
  let autoSpeak = safeGet(SPEAK_KEY) === "1";

  // ------------------------------------------------------------- storage
  function safeGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
  }
  function loadChats() {
    try {
      const raw = safeGet(CHATS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function saveChats() {
    const toSave = chats.filter((c) => c.messages.length > 0);
    safeSet(CHATS_KEY, JSON.stringify(toSave));
  }

  // -------------------------------------------------------------- helpers
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function getChat(id) {
    return chats.find((c) => c.id === id);
  }
  function activeChat() {
    return getChat(activeId);
  }

  let toastTimer;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 4500);
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Small, safe formatter: escapes everything first, then adds a little formatting.
  function inlineFormat(s) {
    return s
      .replace(/(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  }
  function formatBlock(text) {
    const lines = escapeHtml(text).split("\n");
    let out = "";
    let list = null;
    const closeList = () => {
      if (list) { out += `</${list}>`; list = null; }
    };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        if (list !== "ul") { closeList(); out += "<ul>"; list = "ul"; }
        out += `<li>${inlineFormat(m[1])}</li>`;
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        if (list !== "ol") { closeList(); out += "<ol>"; list = "ol"; }
        out += `<li>${inlineFormat(m[1])}</li>`;
      } else {
        closeList();
        if ((m = line.match(/^#{1,6}\s+(.*)$/))) out += `<h4>${inlineFormat(m[1])}</h4>`;
        else if (line.trim() !== "") out += `<p>${inlineFormat(line)}</p>`;
      }
    }
    closeList();
    return out;
  }
  function formatMessage(text) {
    return text
      .split("```")
      .map((part, i) => {
        if (i % 2 === 0) return formatBlock(part);
        const code = part.replace(/^[\w+-]*\n/, "").replace(/\n$/, "");
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      })
      .join("");
  }

  // ------------------------------------------------------------ rendering
  function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function renderHistory() {
    const list = chats
      .filter((c) => c.messages.length > 0)
      .sort((a, b) => b.updated - a.updated);
    el.historyList.innerHTML = "";
    el.historyEmpty.hidden = list.length > 0;

    for (const chat of list) {
      const li = document.createElement("li");
      if (chat.id === activeId) li.classList.add("active");

      const open = document.createElement("button");
      open.type = "button";
      open.className = "chat-link";
      open.textContent = chat.title;
      open.title = chat.title;
      open.addEventListener("click", () => {
        openChat(chat.id);
        closeDrawer();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.setAttribute("aria-label", `Delete chat: ${chat.title}`);
      del.innerHTML = ICONS.trash;
      del.addEventListener("click", () => deleteChat(chat.id));

      li.append(open, del);
      el.historyList.append(li);
    }
  }

  function renderMessages() {
    const chat = activeChat();
    el.messages.querySelectorAll(".msg").forEach((n) => n.remove());
    const hasMessages = chat && chat.messages.length > 0;
    el.emptyState.hidden = hasMessages;
    el.chatTitle.textContent = hasMessages ? chat.title : APP_TITLE;
    if (hasMessages) chat.messages.forEach((m) => el.messages.append(buildMessage(m)));
    scrollToBottom();
  }

  function buildMessage(m) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${m.role === "user" ? "user" : "ai"}`;

    if (m.role === "user") {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = m.content;
      wrap.append(bubble);
      return wrap;
    }

    const mark = document.createElement("img");
    mark.className = "mark";
    mark.src = "/icon.svg";
    mark.alt = "";

    const body = document.createElement("div");
    body.className = "body";

    const prose = document.createElement("div");
    prose.className = "prose";
    prose.innerHTML = formatMessage(m.content);

    const actions = document.createElement("div");
    actions.className = "actions";

    const speakBtn = document.createElement("button");
    speakBtn.type = "button";
    speakBtn.setAttribute("aria-pressed", "false");
    speakBtn.innerHTML = `${ICONS.speaker}<span>Listen</span>`;
    speakBtn.addEventListener("click", () => toggleSpeak(m.content, speakBtn));

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.innerHTML = `${ICONS.copy}<span>Copy</span>`;
    copyBtn.addEventListener("click", () => copyText(m.content, copyBtn));

    actions.append(speakBtn, copyBtn);
    body.append(prose, actions);
    wrap.append(mark, body);
    wrap._speakBtn = speakBtn;
    return wrap;
  }

  function appendMessage(m) {
    el.emptyState.hidden = true;
    const node = buildMessage(m);
    el.messages.append(node);
    scrollToBottom();
    return node;
  }

  // Loading indicator
  let typingNode = null;
  function showTyping() {
    hideTyping();
    typingNode = document.createElement("div");
    typingNode.className = "msg ai";
    typingNode.innerHTML =
      '<img class="mark" src="/icon.svg" alt="" />' +
      '<div class="body"><div class="typing" role="status">' +
      '<span class="dots"><i></i><i></i><i></i></span><span>Thinking…</span></div></div>';
    el.messages.append(typingNode);
    scrollToBottom();
  }
  function hideTyping() {
    if (typingNode) { typingNode.remove(); typingNode = null; }
  }

  // Error message with a Retry button
  let errorNode = null;
  function showError(message, onRetry) {
    hideError();
    errorNode = document.createElement("div");
    errorNode.className = "msg";
    const box = document.createElement("div");
    box.className = "error-box";
    box.setAttribute("role", "alert");
    const text = document.createElement("span");
    text.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", onRetry);
    box.append(text, retry);
    errorNode.append(box);
    errorNode.style.display = "block";
    el.messages.append(errorNode);
    scrollToBottom();
  }
  function hideError() {
    if (errorNode) { errorNode.remove(); errorNode = null; }
  }

  function setBusy(value) {
    busy = value;
    updateSendState();
  }
  function updateSendState() {
    el.sendBtn.disabled = busy || el.input.value.trim() === "";
  }

  // --------------------------------------------------------------- chats
  function newChat() {
    stopSpeaking();
    // Reuse the current chat if it is still empty
    const current = activeChat();
    if (current && current.messages.length === 0) {
      el.input.focus();
      return;
    }
    const chat = { id: uid(), title: "New chat", messages: [], updated: Date.now() };
    chats.push(chat);
    activeId = chat.id;
    hideTyping();
    hideError();
    renderMessages();
    renderHistory();
    el.input.focus();
  }

  function openChat(id) {
    if (!getChat(id)) return;
    stopSpeaking();
    activeId = id;
    hideTyping();
    hideError();
    renderMessages();
    renderHistory();
    // If a request for this chat is still running, show the indicator again
    if (busy && pendingChatId === id) showTyping();
  }

  function deleteChat(id) {
    const chat = getChat(id);
    if (!chat) return;
    if (!window.confirm(`Delete "${chat.title}"?`)) return;
    chats = chats.filter((c) => c.id !== id);
    saveChats();
    if (activeId === id) {
      activeId = null;
      newChat();
    } else {
      renderHistory();
    }
  }

  // ------------------------------------------------------------- sending
  let pendingChatId = null;

  async function requestReply(chatId) {
    const chat = getChat(chatId);
    if (!chat) return;

    hideError();
    setBusy(true);
    pendingChatId = chatId;
    if (activeId === chatId) showTyping();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chat.messages.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });

      let data = null;
      try { data = await response.json(); } catch { /* not JSON */ }

      if (!response.ok || !data || typeof data.reply !== "string") {
        throw new Error(
          (data && data.error) || `Something went wrong (error ${response.status}).`
        );
      }

      chat.messages.push({ role: "assistant", content: data.reply });
      chat.updated = Date.now();
      saveChats();
      renderHistory();

      if (activeId === chatId) {
        hideTyping();
        const node = appendMessage(chat.messages[chat.messages.length - 1]);
        if (autoSpeak && node._speakBtn) toggleSpeak(data.reply, node._speakBtn);
      }
    } catch (err) {
      let message = err.message;
      if (err.name === "AbortError") {
        message = "The request took too long. Please try again.";
      } else if (err instanceof TypeError) {
        message = "Can't reach the server. Check your internet connection and try again.";
      }
      if (activeId === chatId) {
        hideTyping();
        showError(message, () => requestReply(chatId));
      } else {
        toast(message);
      }
    } finally {
      clearTimeout(timer);
      pendingChatId = null;
      hideTyping();
      setBusy(false);
    }
  }

  function sendMessage(text) {
    text = text.trim();
    if (!text || busy) return;

    stopListening();
    if (!activeChat()) newChat();
    const chat = activeChat();

    chat.messages.push({ role: "user", content: text });
    if (chat.messages.length === 1) {
      chat.title = text.length > 42 ? text.slice(0, 42).trimEnd() + "…" : text;
    }
    chat.updated = Date.now();
    saveChats();

    el.input.value = "";
    autosize();
    renderMessages();
    renderHistory();
    requestReply(chat.id);
  }

  // ----------------------------------------------------- text-to-speech
  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  let speakingBtn = null;

  function speechText(md) {
    return md
      .replace(/```[\s\S]*?```/g, " code block. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/https?:\/\/\S+/g, " link ")
      .replace(/[*_#>]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function chunkText(text, max = 220) {
    const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [text];
    const chunks = [];
    let buf = "";
    for (const s of sentences) {
      if ((buf + s).length > max && buf) { chunks.push(buf); buf = ""; }
      buf += s;
    }
    if (buf.trim()) chunks.push(buf);
    return chunks;
  }
  function setSpeakingUI(btn, on) {
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(on));
    btn.innerHTML = on
      ? `${ICONS.stop}<span>Stop</span>`
      : `${ICONS.speaker}<span>Listen</span>`;
  }
  function stopSpeaking() {
    if (!synth) return;
    synth.cancel();
    setSpeakingUI(speakingBtn, false);
    speakingBtn = null;
  }
  function toggleSpeak(text, btn) {
    if (!synth) {
      toast("Your browser doesn't support reading aloud.");
      return;
    }
    if (speakingBtn === btn) { stopSpeaking(); return; }
    stopSpeaking();

    const chunks = chunkText(speechText(text));
    if (chunks.length === 0) return;
    speakingBtn = btn;
    setSpeakingUI(btn, true);

    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = /[\u0900-\u097F]/.test(chunk) ? "hi-IN" : "en-US";
      u.rate = 1;
      if (i === chunks.length - 1) {
        u.onend = () => { if (speakingBtn === btn) { setSpeakingUI(btn, false); speakingBtn = null; } };
      }
      u.onerror = (e) => {
        if (e.error === "canceled" || e.error === "interrupted") return;
        setSpeakingUI(btn, false);
        if (speakingBtn === btn) speakingBtn = null;
        toast("Couldn't read that aloud on this device.");
      };
      synth.speak(u);
    });
  }

  function setAutoSpeak(on) {
    autoSpeak = on;
    el.autoSpeakBtn.setAttribute("aria-checked", String(on));
    safeSet(SPEAK_KEY, on ? "1" : "0");
    if (!on) stopSpeaking();
  }

  // ---------------------------------------------------------- voice input
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let baseText = "";

  function setListeningUI(on) {
    listening = on;
    el.micBtn.classList.toggle("listening", on);
    el.micBtn.setAttribute("aria-pressed", String(on));
    el.micBtn.setAttribute("aria-label", on ? "Stop voice input" : "Start voice input");
  }

  function startListening() {
    if (!SpeechRecognition) {
      toast("Voice input isn't supported in this browser. Try Chrome, Edge or Safari.");
      return;
    }
    if (busy) return;
    stopSpeaking();

    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;

    baseText = el.input.value ? el.input.value.trimEnd() + " " : "";

    recognition.onstart = () => setListeningUI(true);
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      el.input.value = baseText + text;
      autosize();
      updateSendState();
    };
    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone access is blocked. Allow it in your browser settings and try again.",
        "service-not-allowed": "Microphone access is blocked. Allow it in your browser settings and try again.",
        "no-speech": "I didn't hear anything. Tap the microphone and try again.",
        "audio-capture": "No microphone was found on this device.",
        network: "Voice input needs an internet connection.",
      };
      if (event.error !== "aborted") {
        toast(messages[event.error] || "Voice input stopped unexpectedly.");
      }
    };
    recognition.onend = () => {
      setListeningUI(false);
      recognition = null;
    };

    try {
      recognition.start();
    } catch {
      setListeningUI(false);
      toast("Couldn't start voice input. Please try again.");
    }
  }

  function stopListening() {
    if (recognition) {
      try { recognition.stop(); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------- copy
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const label = btn.querySelector("span");
      label.textContent = "Copied";
      setTimeout(() => (label.textContent = "Copy"), 1800);
    } catch {
      toast("Couldn't copy. Select the text and copy it manually.");
    }
  }

  // ----------------------------------------------------- input behaviour
  function autosize() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px";
  }

  function openDrawer() {
    el.sidebar.classList.add("open");
    el.scrim.hidden = false;
  }
  function closeDrawer() {
    el.sidebar.classList.remove("open");
    el.scrim.hidden = true;
  }

  // ---------------------------------------------------------- listeners
  el.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    // Some phones only allow speech after a tap, so "unlock" it here
    if (autoSpeak && synth) synth.speak(new SpeechSynthesisUtterance(""));
    sendMessage(el.input.value);
  });

  el.input.addEventListener("input", () => {
    autosize();
    updateSendState();
  });
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      // On touch devices Enter should add a new line; use the Send button.
      if (window.matchMedia("(pointer: coarse)").matches) return;
      e.preventDefault();
      el.composer.requestSubmit();
    }
  });

  el.micBtn.addEventListener("click", () => (listening ? stopListening() : startListening()));
  el.newChatBtn.addEventListener("click", () => { newChat(); closeDrawer(); });
  el.openSidebar.addEventListener("click", openDrawer);
  el.closeSidebar.addEventListener("click", closeDrawer);
  el.scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  el.autoSpeakBtn.addEventListener("click", () => {
    if (!synth) { toast("Your browser doesn't support reading aloud."); return; }
    setAutoSpeak(!autoSpeak);
  });

  el.emptyState.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-prompt]");
    if (b) sendMessage(b.dataset.prompt);
  });

  window.addEventListener("beforeunload", () => { if (synth) synth.cancel(); });

  // ---------------------------------------------------------------- init
  if (!SpeechRecognition) el.micBtn.title = "Voice input isn't supported in this browser";
  setAutoSpeak(autoSpeak);
  // open the most recent saved chat, or start a blank one
  const latest = chats.filter((c) => c.messages.length > 0).sort((a, b) => b.updated - a.updated)[0];
  if (latest) openChat(latest.id);
  else newChat();
  updateSendState();
})();
