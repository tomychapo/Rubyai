const get = id => document.getElementById(id);
const chat = get("chat");
const message = get("message");
const status = get("status");
const code = get("code");
const mic = get("mic");
const speak = get("speak");
const voice = get("voice");
const synth = window.speechSynthesis;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let entries = [];
try {
  const saved = JSON.parse(localStorage.getItem("ruby-history") || "[]");
  if (Array.isArray(saved)) entries = saved.filter(item =>
    ["You", "Ruby"].includes(item?.who) && typeof item.text === "string"
  ).slice(-100);
  speak.checked = localStorage.getItem("ruby-speak") !== "off";
} catch {}
let busy = false;
let listening = false;

function save(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function draw(entry) {
  const bubble = document.createElement("p");
  bubble.className = entry.who === "You" ? "bubble me" : "bubble";
  bubble.textContent = entry.who + ": " + entry.text;
  chat.append(bubble);
  chat.scrollTop = chat.scrollHeight;
}

function add(who, text) {
  const entry = { who, text };
  entries.push(entry);
  if (entries.length > 100) {
    entries.shift();
    chat.firstElementChild?.remove();
  }
  save("ruby-history", JSON.stringify(entries));
  draw(entry);
}

function say(text) {
  if (!synth || !text) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const selected = voices.find(item => item.voiceURI === voice.value)
    || voices.find(item => item.lang.toLowerCase() === "en-au");
  if (selected) utterance.voice = selected;
  utterance.lang = selected?.lang || "en-AU";
  utterance.rate = 0.95;
  utterance.onerror = event => {
    if (["canceled", "interrupted"].includes(event.error)) return;
    status.textContent = "Tap Replay last reply in Settings to hear Ruby.";
  };
  synth.speak(utterance);
}

if (synth) {
  const populate = () => {
    const previous = voice.value;
    voice.length = 1;
    for (const item of synth.getVoices().filter(item => /^en/i.test(item.lang))) {
      voice.add(new Option(item.name + " (" + item.lang + ")", item.voiceURI));
    }
    if (Array.from(voice.options).some(option => option.value === previous)) voice.value = previous;
  };
  populate();
  synth.addEventListener("voiceschanged", populate);
}
get("replay").disabled = !synth;
get("replay").onclick = () => say(entries.findLast(entry => entry.who === "Ruby")?.text);
speak.onchange = () => {
  save("ruby-speak", speak.checked ? "on" : "off");
  if (!speak.checked) synth?.cancel();
};

async function send(event) {
  event?.preventDefault();
  const text = message.value.trim();
  if (!text || busy) return;
  if (!code.value.trim()) {
    get("settings").open = true;
    status.textContent = "Enter your Ruby access code first.";
    code.focus();
    return;
  }
  const history = entries.slice(-12).map(entry => ({
    role: entry.who === "You" ? "user" : "model",
    text: entry.text.slice(0, 1000)
  }));
  busy = true;
  get("send").disabled = true;
  mic.disabled = true;
  synth?.cancel();
  status.textContent = "Ruby is thinking…";
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + code.value.trim() },
      body: JSON.stringify({ message: text, history }),
      signal: AbortSignal.timeout(32000)
    });
    const result = await response.json();
    if (!response.ok || typeof result.reply !== "string") {
      status.textContent = result.error || "Ruby didn’t return a reply. Try again.";
      if (response.status === 401) {
        get("settings").open = true;
        code.focus();
      }
      return;
    }
    add("You", text);
    add("Ruby", result.reply);
    if (message.value.trim() === text) message.value = "";
    status.textContent = "";
    if (speak.checked) say(result.reply);
  } catch {
    status.textContent = "Couldn’t connect to Ruby. Your message is ready to retry.";
  } finally {
    busy = false;
    get("send").disabled = false;
    mic.disabled = false;
  }
}
get("composer").addEventListener("submit", send);

if (Recognition) {
  const recognition = new Recognition();
  recognition.lang = "en-AU";
  recognition.onstart = () => {
    listening = true;
    mic.setAttribute("aria-pressed", "true");
    mic.setAttribute("aria-label", "Stop microphone");
    status.textContent = "Listening…";
  };
  recognition.onend = () => {
    listening = false;
    mic.setAttribute("aria-pressed", "false");
    mic.setAttribute("aria-label", "Start microphone");
    if (status.textContent === "Listening…") status.textContent = "";
  };
  recognition.onresult = event => {
    message.value = event.results[event.resultIndex][0].transcript.slice(0, 2000);
    send();
  };
  recognition.onerror = () => {
    status.textContent = "Voice input is unavailable. Check microphone permission or type your message.";
  };
  mic.onclick = () => {
    if (listening) return recognition.stop();
    synth?.cancel();
    try { recognition.start(); } catch { status.textContent = "Microphone is already starting."; }
  };
} else {
  mic.onclick = () => { status.textContent = "This browser doesn’t support voice input. You can still type."; };
}

if (entries.length) entries.forEach(draw);
else draw({ who: "Ruby", text: "Hey Chapo 💜 Tap the mic or type a message. Ready when you are." });
