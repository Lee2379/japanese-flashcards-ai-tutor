const DATA = window.JLPT_DATA;
const STORE_KEY = "jlpt-flashcard-progress-v1";
const CHAT_STORE_KEY = "jlpt-gemini-chat-v1";
const REVIEW_OFFSETS = [1, 3, 7, 14, 30];
const CUSTOM_SOURCES = {
  conversation: {
    label: "Conversation",
    url: "https://docs.google.com/document/d/example-conversation-doc/edit",
  },
  interview: {
    label: "Interview",
    url: "https://docs.google.com/document/d/example-interview-doc/edit",
  },
};

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  daySelect: document.querySelector("#daySelect"),
  dateLine: document.querySelector("#dateLine"),
  modeTabs: document.querySelectorAll(".mode-tabs button"),
  newCount: document.querySelector("#newCount"),
  reviewCount: document.querySelector("#reviewCount"),
  grammarCount: document.querySelector("#grammarCount"),
  conversationCount: document.querySelector("#conversationCount"),
  interviewCount: document.querySelector("#interviewCount"),
  mistakeCount: document.querySelector("#mistakeCount"),
  doneCount: document.querySelector("#doneCount"),
  searchInput: document.querySelector("#searchInput"),
  shuffleToggle: document.querySelector("#shuffleToggle"),
  sourceUnit: document.querySelector("#sourceUnit"),
  grammarRange: document.querySelector("#grammarRange"),
  modeTitle: document.querySelector("#modeTitle"),
  deckMeta: document.querySelector("#deckMeta"),
  chatToggleBtn: document.querySelector("#chatToggleBtn"),
  resetTodayBtn: document.querySelector("#resetTodayBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  progressFill: document.querySelector("#progressFill"),
  progressText: document.querySelector("#progressText"),
  importPanel: document.querySelector("#importPanel"),
  importTitle: document.querySelector("#importTitle"),
  importHelp: document.querySelector("#importHelp"),
  importText: document.querySelector("#importText"),
  importBtn: document.querySelector("#importBtn"),
  clearCustomBtn: document.querySelector("#clearCustomBtn"),
  docLink: document.querySelector("#docLink"),
  chatPanel: document.querySelector("#chatPanel"),
  avatarWrap: document.querySelector("#avatarWrap"),
  chatStatus: document.querySelector("#chatStatus"),
  chatCloseBtn: document.querySelector("#chatCloseBtn"),
  chatLog: document.querySelector("#chatLog"),
  voiceModeBtn: document.querySelector("#voiceModeBtn"),
  voiceSendBtn: document.querySelector("#voiceSendBtn"),
  voiceLangSelect: document.querySelector("#voiceLangSelect"),
  voiceStatus: document.querySelector("#voiceStatus"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  speakInputBtn: document.querySelector("#speakInputBtn"),
  cardStage: document.querySelector(".card-stage"),
  listPanel: document.querySelector(".list-panel"),
  cardKicker: document.querySelector("#cardKicker"),
  cardFront: document.querySelector("#cardFront"),
  cardAnswer: document.querySelector("#cardAnswer"),
  answerReading: document.querySelector("#answerReading"),
  answerMeaning: document.querySelector("#answerMeaning"),
  prevBtn: document.querySelector("#prevBtn"),
  nextBtn: document.querySelector("#nextBtn"),
  showBtn: document.querySelector("#showBtn"),
  ratingActions: document.querySelector("#ratingActions"),
  cardList: document.querySelector("#cardList"),
  listCount: document.querySelector("#listCount"),
};

let state = loadState();
let activeMode = "today";
let activeDay = getInitialStudyDay();
let currentDeck = [];
let activeIndex = 0;
let answerVisible = false;
let chatMessages = loadChatMessages();
let chatOpen = false;
let voiceMode = false;
let recognition = null;
let recognizing = false;
let voiceHold = false;

function setVoiceVisualState(state) {
  els.avatarWrap.classList.remove("listening", "speaking");
  els.voiceModeBtn.classList.remove("listening", "speaking");
  if (state === "listening") {
    els.avatarWrap.classList.add("listening");
    els.voiceModeBtn.classList.add("listening");
  }
  if (state === "speaking") {
    els.avatarWrap.classList.add("speaking");
    els.voiceModeBtn.classList.add("speaking");
  }
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    return {
      cards: parsed.cards || {},
      daily: parsed.daily || {},
      customDecks: hydrateCustomDecks(parsed.customDecks),
    };
  } catch {
    return { cards: {}, daily: {}, customDecks: hydrateCustomDecks() };
  }
}

function hydrateCustomDecks(saved) {
  const defaults = DATA.customDecks || { conversation: [], interview: [] };
  return {
    conversation: saved?.conversation?.length ? saved.conversation : defaults.conversation || [],
    interview: saved?.interview?.length ? saved.interview : defaults.interview || [],
  };
}

function loadChatMessages() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_STORE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveChatMessages() {
  localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(chatMessages.slice(-30)));
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function getInitialStudyDay() {
  const start = new Date(`${DATA.meta.startDate}T00:00:00`);
  const now = new Date();
  const diff = Math.floor((now - start) / 86400000) + 1;
  return clamp(diff, 1, DATA.schedule.length);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function todaySchedule() {
  return DATA.schedule[activeDay - 1];
}

function parseGrammarRange(range) {
  if (!range) return [];
  return range.split(",").flatMap((part) => {
    const trimmed = part.trim();
    if (!trimmed) return [];
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map((n) => Number(n));
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    return [Number(trimmed)];
  });
}

function cardsForDay(day) {
  const schedule = DATA.schedule[day - 1];
  if (!schedule) return [];
  return DATA.vocab.filter((card) => card.unit === schedule.newVocabUnit);
}

function grammarForDay(day) {
  const schedule = DATA.schedule[day - 1];
  if (!schedule) return [];
  const grammarNumbers = parseGrammarRange(schedule.newGrammarCards);
  return DATA.grammar.filter((card) => grammarNumbers.includes(card.cardNo));
}

function reviewCardsForDay(day) {
  const cards = [];
  REVIEW_OFFSETS.forEach((offset) => {
    const priorDay = day - offset;
    if (priorDay >= 1) cards.push(...cardsForDay(priorDay), ...grammarForDay(priorDay));
  });
  const customDue = customCards().filter((card) => {
    const progress = cardProgress(card);
    return progress.lastStudiedDay && REVIEW_OFFSETS.includes(day - progress.lastStudiedDay);
  });
  return dedupe([...cards, ...customDue]);
}

function mistakeCards() {
  const ids = Object.entries(state.cards)
    .filter(([, progress]) => progress.lastRating === "again" || progress.lastRating === "hard")
    .map(([id]) => id);
  return allCards().filter((card) => ids.includes(card.id));
}

function allCards() {
  return [...DATA.vocab, ...DATA.grammar, ...customCards()];
}

function customCards(kind) {
  const decks = state.customDecks || {};
  if (kind) return decks[kind] || [];
  return [...(decks.conversation || []), ...(decks.interview || [])];
}

function dedupe(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

function makeDeck() {
  const query = els.searchInput.value.trim().toLowerCase();
  let deck;
  if (activeMode === "today") deck = cardsForDay(activeDay);
  if (activeMode === "grammar") deck = DATA.grammar;
  if (activeMode === "conversation") deck = customCards("conversation");
  if (activeMode === "interview") deck = customCards("interview");
  if (activeMode === "review") deck = reviewCardsForDay(activeDay);
  if (activeMode === "mistakes") deck = mistakeCards();
  if (activeMode === "all") deck = allCards();
  deck = deck || [];
  if (query) {
    deck = deck.filter((card) =>
      [card.front, card.reading, card.readingHint, card.meaning, card.unit, card.level, card.sourceLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }
  if (els.shuffleToggle.checked) deck = shuffle([...deck], `${activeMode}-${activeDay}-${query}`);
  currentDeck = deck;
  activeIndex = clamp(activeIndex, 0, Math.max(0, currentDeck.length - 1));
  answerVisible = false;
}

function shuffle(cards, seedText) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  for (let i = cards.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function cardProgress(card) {
  return state.cards[card.id] || { attempts: 0, correct: 0, lastRating: "", lastStudiedDay: 0 };
}

function dayKey() {
  return `day-${activeDay}`;
}

function isDoneToday(card) {
  const daily = state.daily[dayKey()] || {};
  return Boolean(daily[card.id]);
}

function markCard(card, rating) {
  const progress = cardProgress(card);
  const correct = rating === "good" || rating === "easy";
  state.cards[card.id] = {
    attempts: progress.attempts + 1,
    correct: progress.correct + (correct ? 1 : 0),
    lastRating: rating,
    lastStudiedDay: activeDay,
    updatedAt: new Date().toISOString(),
  };
  state.daily[dayKey()] = state.daily[dayKey()] || {};
  state.daily[dayKey()][card.id] = rating;
  saveState();

  if (rating === "again") {
    const reinsertAt = clamp(activeIndex + 4, 0, currentDeck.length);
    currentDeck.splice(reinsertAt, 0, card);
  }
  goNext();
  render();
}

function renderDayOptions() {
  els.daySelect.innerHTML = DATA.schedule
    .map((item) => `<option value="${item.studyDay}">Day ${item.studyDay} · ${item.date}</option>`)
    .join("");
  els.daySelect.value = String(activeDay);
}

function renderStats() {
  const newDeck = cardsForDay(activeDay);
  const grammarDeck = DATA.grammar;
  const reviewDeck = reviewCardsForDay(activeDay);
  const mistakes = mistakeCards();
  const done = new Set(Object.keys(state.daily[dayKey()] || {}));
  els.newCount.textContent = newDeck.length;
  els.reviewCount.textContent = reviewDeck.length;
  els.grammarCount.textContent = grammarDeck.length;
  els.conversationCount.textContent = customCards("conversation").length;
  els.interviewCount.textContent = customCards("interview").length;
  els.mistakeCount.textContent = mistakes.length;
  els.doneCount.textContent = [...done].filter((id) => newDeck.some((card) => card.id === id)).length;
}

function renderShell() {
  const schedule = todaySchedule();
  const customSource = CUSTOM_SOURCES[activeMode];
  els.todayLabel.textContent = `Day ${activeDay}`;
  els.dateLine.textContent = schedule.date;
  els.sourceUnit.textContent = customSource ? `${customSource.label} Source` : schedule.newVocabUnit;
  els.grammarRange.textContent = customSource
    ? "Based on Google Docs"
    : schedule.newGrammarCards
      ? `Grammar ${schedule.newGrammarCards}`
      : "No grammar";
  els.modeTitle.textContent = {
    today: "Today",
    grammar: "Grammar",
    conversation: "Conversation",
    interview: "Interview",
    review: "Review",
    mistakes: "Mistakes",
    all: "All",
  }[activeMode];
  els.deckMeta.textContent = deckMetaText();
  els.modeTabs.forEach((button) => button.classList.toggle("active", button.dataset.mode === activeMode));
  renderImportPanel();
}

function deckMetaText() {
  if (activeMode === "today") return `${todaySchedule().newVocabUnit} · Grammar ${todaySchedule().newGrammarCards || "-"}`;
  if (activeMode === "grammar") return `All TRY N3 grammar cards · ${DATA.grammar.length}`;
  if (activeMode === "conversation") return "Memorize Google Docs conversation material as cards";
  if (activeMode === "interview") return "Memorize Google Docs interview material as cards";
  if (activeMode === "review") return REVIEW_OFFSETS.map((n) => `D-${n}`).join(" · ");
  if (activeMode === "mistakes") return "Cards marked Again or Hard";
  return `${DATA.meta.vocabCount} vocab cards · ${DATA.meta.grammarCount} grammar cards`;
}

function renderImportPanel() {
  const source = CUSTOM_SOURCES[activeMode];
  els.importPanel.classList.toggle("hidden", !source);
  if (!source) return;
  const count = customCards(activeMode).length;
  els.importTitle.textContent = `Import ${source.label} Source`;
  els.importHelp.textContent =
    count > 0
      ? `${count} cards are saved. Paste new content to replace the existing ${source.label} cards.`
      : `Automatic import is blocked by document permissions. Open the document, copy all content, and paste it here to turn it into ${source.label} cards.`;
  els.docLink.href = source.url;
}

function renderChatPanel() {
  els.chatPanel.classList.toggle("hidden", !chatOpen);
  if (!chatOpen) return;
  renderChatLog();
  checkTutorStatus();
}

function renderChatLog() {
  if (!chatMessages.length) {
    els.chatLog.innerHTML = `<div class="chat-empty">Ask for Japanese corrections, interview practice, or natural conversation expressions.</div>`;
    return;
  }
  els.chatLog.innerHTML = chatMessages
    .map(
      (message, index) => `
        <div class="chat-message ${message.role}">
          <div class="message-meta">
            <span>${message.role === "user" ? "You" : "Ishihara"}</span>
            <button class="speak-message" type="button" data-speak-index="${index}">Speak</button>
          </div>
          <p>${escapeHtml(message.text).replaceAll("\n", "<br>")}</p>
        </div>
      `,
    )
    .join("");
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function renderCard() {
  const card = currentDeck[activeIndex];
  const total = currentDeck.length;
  const doneCount = currentDeck.filter(isDoneToday).length;
  els.progressText.textContent = `${Math.min(doneCount, total)} / ${total}`;
  els.progressFill.style.width = total ? `${Math.round((doneCount / total) * 100)}%` : "0%";

  if (!card) {
    els.cardKicker.textContent = "Done";
    els.cardFront.textContent = "No cards available";
    els.cardAnswer.classList.add("hidden");
    els.ratingActions.classList.add("hidden");
    els.showBtn.disabled = true;
    return;
  }

  els.showBtn.disabled = false;
  els.cardKicker.textContent = cardLabel(card);
  els.cardFront.textContent = card.front;
  els.answerReading.textContent = card.reading || card.readingHint || "-";
  els.answerMeaning.textContent = card.meaning || "-";
  els.cardAnswer.classList.toggle("hidden", !answerVisible);
  els.ratingActions.classList.toggle("hidden", !answerVisible);
  els.showBtn.textContent = answerVisible ? "Hide Answer" : "Show Answer";
}

function cardLabel(card) {
  if (card.type === "vocab") return `${card.level} · DAY ${String(card.day).padStart(2, "0")} · #${String(card.itemNo).padStart(3, "0")}`;
  if (card.type === "custom") return `${card.sourceLabel} · #${String(card.cardNo).padStart(3, "0")}`;
  return `N3 Grammar · ${card.importance} · #${String(card.cardNo).padStart(3, "0")}`;
}

function renderList() {
  els.listCount.textContent = currentDeck.length;
  const rows = currentDeck.slice(0, 250).map((card, index) => {
    const progress = cardProgress(card);
    const badge = isDoneToday(card) ? "Done" : progress.lastRating || "";
    return `
      <button class="list-item ${index === activeIndex ? "active" : ""}" data-index="${index}">
        <strong>${escapeHtml(card.front)}</strong>
        <span>${escapeHtml(card.reading || card.readingHint || "")}</span>
        <span>${escapeHtml(card.meaning || "")}</span>
        <em class="badge">${escapeHtml(badge)}</em>
      </button>
    `;
  });
  els.cardList.innerHTML = rows.join("") || `<div class="empty-list">No cards to display</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pickJapaneseVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const japaneseVoices = voices.filter((voice) => /^ja[-_]?JP/i.test(voice.lang || ""));
  const femaleHints = ["nanami", "haruka", "kyoko", "sayaka", "female", "woman", "google 日本語"];
  return (
    japaneseVoices.find((voice) => femaleHints.some((hint) => voice.name.toLowerCase().includes(hint))) ||
    japaneseVoices[0] ||
    null
  );
}

function extractJapaneseForSpeech(text) {
  const cleaned = String(text || "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/^(日本語|답변｜일본어|질문|발음|뜻)\s*[:：]/gm, "")
    .trim();
  const japaneseLines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /[\u3040-\u30ff\u3400-\u9fff々〆ヶ]/.test(line));
  return (japaneseLines.length ? japaneseLines.join("。") : cleaned).trim();
}

function speakJapanese(text, options = {}) {
  if (options.fast) return speakWithBrowserVoice(text);
  return speakWithGeminiTts(text).catch(() => speakWithBrowserVoice(text));
}

async function speakWithGeminiTts(text) {
  const speechText = extractJapaneseForSpeech(text);
  if (!speechText) return;
  setVoiceVisualState("speaking");
  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: speechText }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "TTS request failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    await playAudioUrl(url);
    URL.revokeObjectURL(url);
  } finally {
    setVoiceVisualState(voiceMode ? "listening" : "idle");
  }
}

function playAudioUrl(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
  });
}

function speakWithBrowserVoice(text) {
  return new Promise((resolve) => {
  const speechText = extractJapaneseForSpeech(text);
  if (!speechText || !("speechSynthesis" in window)) {
    resolve();
    return;
  }
  window.speechSynthesis.cancel();
  setVoiceVisualState("speaking");
  const utterance = new SpeechSynthesisUtterance(speechText);
  utterance.lang = "ja-JP";
  utterance.rate = 1.12;
  utterance.pitch = 1.04;
  const voice = pickJapaneseVoice();
  if (voice) utterance.voice = voice;
  utterance.onend = () => {
    setVoiceVisualState(voiceMode ? "listening" : "idle");
    resolve();
  };
  utterance.onerror = () => {
    setVoiceVisualState(voiceMode ? "listening" : "idle");
    resolve();
  };
  window.speechSynthesis.speak(utterance);
  });
}

function goNext() {
  if (!currentDeck.length) return;
  activeIndex = (activeIndex + 1) % currentDeck.length;
  answerVisible = false;
}

function goPrev() {
  if (!currentDeck.length) return;
  activeIndex = (activeIndex - 1 + currentDeck.length) % currentDeck.length;
  answerVisible = false;
}

function resetToday() {
  delete state.daily[dayKey()];
  saveState();
  activeIndex = 0;
  answerVisible = false;
  render();
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jlpt-progress-day-${activeDay}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importCustomCards() {
  const source = CUSTOM_SOURCES[activeMode];
  if (!source) return;
  const cards = parseImportedText(els.importText.value, activeMode, source.label);
  if (!cards.length) {
    els.importHelp.textContent = "No card-like lines were found. Check whether questions and answers are separated by line breaks or tabs.";
    return;
  }
  state.customDecks = state.customDecks || {};
  state.customDecks[activeMode] = cards;
  els.importText.value = "";
  activeIndex = 0;
  answerVisible = false;
  saveState();
  render();
}

function clearCustomCards() {
  const source = CUSTOM_SOURCES[activeMode];
  if (!source) return;
  state.customDecks = state.customDecks || {};
  state.customDecks[activeMode] = [];
  saveState();
  activeIndex = 0;
  answerVisible = false;
  render();
}

function parseImportedText(text, kind, label) {
  const cleaned = text.replace(/\r/g, "\n").replace(/\u00a0/g, " ").trim();
  if (!cleaned) return [];
  const structuredRows = [];
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line) => {
    const tabParts = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
    if (tabParts.length >= 2) structuredRows.push([tabParts[0], tabParts.slice(1).join(" / ")]);
  });

  for (let i = 0; i < lines.length - 1; i += 1) {
    const q = lines[i].match(/^(?:Q|질문|문제|問)\s*[:：]\s*(.+)$/i);
    const a = lines[i + 1].match(/^(?:A|답변|정답|答)\s*[:：]\s*(.+)$/i);
    if (q && a) structuredRows.push([q[1].trim(), a[1].trim()]);
  }

  let rows = structuredRows;
  if (!rows.length) {
    rows = cleaned
      .split(/\n\s*\n+/)
      .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
      .filter((block) => block.length >= 2)
      .map((block) => [block[0], block.slice(1).join("\n")]);
  }

  const seen = new Set();
  return rows
    .filter(([front, meaning]) => front && meaning)
    .filter(([front, meaning]) => {
      const key = `${front}\n${meaning}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(([front, meaning], index) => ({
      id: `custom-${kind}-${Date.now()}-${index + 1}`,
      type: "custom",
      sourceKind: kind,
      sourceLabel: label,
      cardNo: index + 1,
      front,
      reading: "",
      meaning,
      importedAt: new Date().toISOString(),
    }));
}

function render() {
  makeDeck();
  renderStats();
  renderShell();
  renderChatPanel();
  renderCard();
  renderList();
}

async function checkTutorStatus() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    els.chatStatus.textContent = data.geminiReady ? "Gemini ready" : "API key required";
  } catch {
    els.chatStatus.textContent = "Local server required";
  }
}

async function sendTutorMessage(text, options = {}) {
  if (options.speakResponse) {
    voiceHold = true;
    stopVoiceRecognition(false);
  }
  chatMessages.push({ role: "user", text });
  renderChatLog();
  saveChatMessages();
  els.chatStatus.textContent = "Generating answer";
  try {
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatMessages.slice(-12) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Gemini request failed");
    chatMessages.push({ role: "model", text: data.text });
    els.chatStatus.textContent = "Gemini ready";
    if (options.speakResponse) {
      renderChatLog();
      await speakJapanese(data.text, { fast: options.fastVoice });
      voiceHold = false;
      if (voiceMode) startVoiceRecognition();
    }
  } catch (error) {
    chatMessages.push({
      role: "model",
      text: `Check the local tutor server or API key settings.\n${error.message}`,
    });
    els.chatStatus.textContent = "Needs attention";
    voiceHold = false;
    if (voiceMode) startVoiceRecognition();
  }
  saveChatMessages();
  renderChatLog();
}

function getSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const instance = new Recognition();
  instance.lang = els.voiceLangSelect.value || "ja-JP";
  instance.interimResults = true;
  instance.continuous = true;
  instance.maxAlternatives = 3;
  return instance;
}

function startVoiceRecognition() {
  if (!voiceMode || recognizing) return;
  if (!recognition) recognition = getSpeechRecognition();
  if (!recognition) {
    els.voiceStatus.textContent = "This browser does not support speech recognition";
    voiceMode = false;
    els.voiceModeBtn.textContent = "Start Voice Chat";
    return;
  }
  recognition.onstart = () => {
    recognizing = true;
    els.voiceStatus.textContent = "Listening. Speak after the green indicator turns on.";
    setVoiceVisualState("listening");
  };
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    els.voiceStatus.textContent = finalText || interimText || "Listening";
    if (finalText.trim()) {
      const existing = els.chatInput.value.trim();
      els.chatInput.value = existing ? `${existing} ${finalText.trim()}` : finalText.trim();
      els.voiceStatus.textContent = "Added to the input. Press Send to submit.";
    }
  };
  recognition.onerror = (event) => {
    recognizing = false;
    setVoiceVisualState("idle");
    els.voiceStatus.textContent = event.error === "not-allowed" ? "Microphone permission required" : "Speech recognition error";
  };
  recognition.onend = () => {
    recognizing = false;
    if (voiceMode) {
      els.voiceStatus.textContent = voiceHold ? "Waiting for Ishihara" : "Still listening";
      if (!voiceHold) window.setTimeout(startVoiceRecognition, 500);
    }
  };
  try {
    recognition.start();
  } catch {
    recognizing = false;
  }
}

function stopVoiceRecognition(turnOff = true) {
  if (turnOff) voiceMode = false;
  if (recognition && recognizing) recognition.stop();
  recognizing = false;
  if (!voiceMode) {
    els.voiceModeBtn.textContent = "Start Voice Chat";
    els.voiceStatus.textContent = "Mic standby";
    setVoiceVisualState("idle");
  }
}

els.daySelect.addEventListener("change", () => {
  activeDay = Number(els.daySelect.value);
  activeIndex = 0;
  answerVisible = false;
  render();
});

els.modeTabs.forEach((button) => {
  button.addEventListener("click", () => {
    activeMode = button.dataset.mode;
    activeIndex = 0;
    answerVisible = false;
    render();
  });
});

els.searchInput.addEventListener("input", () => {
  activeIndex = 0;
  answerVisible = false;
  render();
});

els.shuffleToggle.addEventListener("change", () => {
  activeIndex = 0;
  answerVisible = false;
  render();
});

els.showBtn.addEventListener("click", () => {
  answerVisible = !answerVisible;
  renderCard();
});

els.nextBtn.addEventListener("click", () => {
  goNext();
  render();
});

els.prevBtn.addEventListener("click", () => {
  goPrev();
  render();
});

els.ratingActions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-rating]");
  if (!button) return;
  const card = currentDeck[activeIndex];
  if (card) markCard(card, button.dataset.rating);
});

els.cardList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-index]");
  if (!item) return;
  activeIndex = Number(item.dataset.index);
  answerVisible = false;
  render();
});

els.resetTodayBtn.addEventListener("click", resetToday);
els.exportBtn.addEventListener("click", exportProgress);
els.chatToggleBtn.addEventListener("click", () => {
  chatOpen = !chatOpen;
  renderChatPanel();
});
els.chatCloseBtn.addEventListener("click", () => {
  chatOpen = false;
  renderChatPanel();
});
els.importBtn.addEventListener("click", importCustomCards);
els.clearCustomBtn.addEventListener("click", clearCustomCards);
els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  els.chatInput.value = "";
  sendTutorMessage(text, { speakResponse: voiceMode, fastVoice: voiceMode });
});

els.voiceModeBtn.addEventListener("click", () => {
  voiceMode = !voiceMode;
    if (voiceMode) {
    els.voiceModeBtn.textContent = "Stop Voice Chat";
    els.voiceStatus.textContent = "Preparing microphone. Speak after the green indicator turns on.";
    window.setTimeout(startVoiceRecognition, 350);
  } else {
    stopVoiceRecognition(true);
  }
});

els.voiceSendBtn.addEventListener("click", () => {
  const text = els.chatInput.value.trim();
  if (!text) return;
  els.chatInput.value = "";
  sendTutorMessage(text, { speakResponse: true, fastVoice: true });
});

els.voiceLangSelect.addEventListener("change", () => {
  if (recognition && recognizing) recognition.stop();
  recognition = null;
  if (voiceMode) {
    els.voiceStatus.textContent = "Language changed. Listening again.";
    window.setTimeout(startVoiceRecognition, 350);
  }
});

els.speakInputBtn.addEventListener("click", () => {
  speakJapanese(els.chatInput.value);
});

els.chatLog.addEventListener("click", (event) => {
  const button = event.target.closest("[data-speak-index]");
  if (!button) return;
  const message = chatMessages[Number(button.dataset.speakIndex)];
  if (message) speakJapanese(message.text);
});

document.addEventListener("keydown", (event) => {
  const activeEditable = document.activeElement?.closest?.("input, select, textarea, [contenteditable='true']");
  const targetEditable = event.target?.closest?.("input, select, textarea, [contenteditable='true']");
  const insideChat = chatOpen && event.target?.closest?.("#chatPanel");
  if (activeEditable || targetEditable || insideChat) return;
  if (event.key === " ") {
    event.preventDefault();
    answerVisible = !answerVisible;
    renderCard();
  }
  if (event.key === "ArrowRight") {
    goNext();
    render();
  }
  if (event.key === "ArrowLeft") {
    goPrev();
    render();
  }
  if (answerVisible && ["1", "2", "3", "4"].includes(event.key)) {
    const ratings = ["again", "hard", "good", "easy"];
    const card = currentDeck[activeIndex];
    if (card) markCard(card, ratings[Number(event.key) - 1]);
  }
});

renderDayOptions();
render();
