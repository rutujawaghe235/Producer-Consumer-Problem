let CAP = 5;
const $ = (id) => document.getElementById(id);
const EX = [
  "Is this phone available?",
  "What is the price?",
  "Can I return this product?",
  "Is there any discount?",
  "When will my order arrive?",
  "Do you offer free shipping?",
  "Can I pay with cash?",
  "Is this product covered by warranty?",
  "How do I track my order?",
  "When is the next sale?"
];
const REPLY = [
  [/phone|available|stock/i, "Yes, this phone is in stock and ready to ship."],
  [/price|cost/i, "The price is shown on the product page; today's offer price applies."],
  [/return|refund/i, "Yes, returns are accepted within 7 days of delivery."],
  [/discount|offer|coupon/i, "A 10% festive discount is available on this item."],
  [/order|arrive|deliver/i, "Your order will arrive in 3–5 working days."]
];

let run = 0;
let paused = false;
let running = false;
let S = null;
let disableMutex = false;
let speedFactor = 1;
let resumeWaiters = [];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

class Sem {
  constructor(value) {
    this.v = value;
    this.q = [];
  }

  async wait() {
    if (this.v > 0) {
      this.v--;
      return;
    }
    await new Promise((resolve) => this.q.push(resolve));
  }

  signal() {
    if (this.q.length) {
      const resolve = this.q.shift();
      resolve();
    } else {
      this.v++;
    }
  }
}

function getCapacity() {
  const v = Number($("capacity").value);
  return Number.isFinite(v) && v > 0 ? Math.max(1, Math.round(v)) : 5;
}

async function pauseGate(currentRun) {
  while (paused && currentRun === run && running) {
    await new Promise((resolve) => resumeWaiters.push(resolve));
  }
}

async function delay(ms, currentRun) {
  const total = Math.max(0, ms / speedFactor);
  let remaining = total;
  while (remaining > 0) {
    if (currentRun !== run || !running) {
      throw new Error("Simulation stopped");
    }
    await pauseGate(currentRun);
    if (currentRun !== run || !running) {
      throw new Error("Simulation stopped");
    }
    const step = Math.min(50, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
}

function resumeAllWaiters() {
  while (resumeWaiters.length) {
    const resolve = resumeWaiters.shift();
    resolve();
  }
}

function readQueries() {
  return [...document.querySelectorAll("#inputs input")].map((el) => el.value.trim());
}

function freshState(qs) {
  return {
    n: qs.length,
    qs,
    slots: Array(CAP).fill(null),
    inn: 0,
    out: 0,
    entered: 0,
    proc: 0,
    empty: new Sem(CAP),
    full: new Sem(0),
    mutex: new Sem(1),
    owner: null,
    cs: qs.map(() => ({ s: "Waiting to start", k: "" })),
    srv: "Idle",
    busy: false,
    resp: null,
    history: []
  };
}

function buildInputs() {
  const n = Number($("n").value);
  $("inputs").innerHTML = [...Array(n)].map((_, i) => `
    <div class="qi">
      <label>Customer ${i + 1}</label>
      <input type="text" maxlength="60" value="${escapeHtml(EX[i] || "")}">
    </div>
  `).join("");
}

function buildStatic() {
  $("queue").innerHTML = [...Array(CAP)].map((_, i) => `
    <div class="slotw">
      <div class="ptr" id="pt${i}"></div>
      <div class="slot" id="sl${i}"></div>
      <div class="idx">slot ${i}</div>
    </div>
  `).join("");
}

function log(message, type) {
  const entry = document.createElement("div");
  entry.className = type || "";
  entry.textContent = message;
  $("log").prepend(entry);
}

function normalizeTextForStatus(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getMutexValue() {
  if (!S) {
    return 1;
  }
  return disableMutex ? 0 : S.mutex.v;
}

function render() {
  if (!S) {
    return;
  }

  const waitingCount = S.slots.filter(Boolean).length;
  const emptyCount = CAP - waitingCount;
  const mutexValue = getMutexValue();

  $("qCap").textContent = String(CAP);
  $("sEnt").textContent = String(S.entered);
  $("sWait").textContent = String(waitingCount);
  $("sEmp").textContent = String(emptyCount);
  $("sProc").textContent = String(S.proc);

  $("vE").textContent = String(S.empty.v);
  $("vF").textContent = String(S.full.v);
  $("vM").textContent = String(mutexValue);

  $("tE").textContent = S.empty.v === 0
    ? "Buffer is full — producers must wait."
    : `${S.empty.v} free space(s) — producers may insert.`;

  $("tF").textContent = S.full.v === 0
    ? "Queue is empty — consumer must wait."
    : `${S.full.v} query(ies) waiting — consumer may remove.`;

  if (disableMutex) {
    $("tM").textContent = "Race demo active — mutex disabled; shared queue may be modified without locking.";
  } else {
    $("tM").textContent = S.owner
      ? `LOCKED by ${S.owner} — everyone else must wait.`
      : "Free — one process may enter the critical section.";
  }

  $("mxBox").classList.toggle("lock", !!S.owner && !disableMutex);
  $("pIn").textContent = String(S.inn);
  $("pOut").textContent = String(S.out);

  for (let i = 0; i < CAP; i++) {
    const slotEl = $("sl" + i);
    const ptrEl = $("pt" + i);
    const item = S.slots[i];

    if (item) {
      slotEl.innerHTML = `<b>Q${item.c + 1}</b><span>${escapeHtml(item.text)}</span>`;
      slotEl.classList.add("full");
      slotEl.classList.toggle("leave", !!item.leaving);
      slotEl.classList.remove("pop");
      void slotEl.offsetWidth;
      slotEl.classList.add("pop");
    } else {
      slotEl.innerHTML = "Empty";
      slotEl.classList.remove("full", "leave", "pop");
    }

    ptrEl.innerHTML = (i === S.inn ? '<span class="i">IN ▼</span> ' : '') + (i === S.out ? '<span class="o">OUT ▼</span>' : '');
  }

  $("custs").innerHTML = S.qs.map((q, i) => {
    const status = S.cs[i]?.s || "Waiting to start";
    const stateClass = S.cs[i]?.k || "wait";
    return `
      <div class="cust ${stateClass}">
        <b>Customer ${i + 1}</b>
        <div>${escapeHtml(q)}</div>
        <div class="st">${escapeHtml(status)}</div>
      </div>
    `;
  }).join("");

  $("server").classList.toggle("busy", S.busy);
  $("srvTxt").innerHTML = (S.busy ? '<span class="spin"></span>' : '') + escapeHtml(S.srv);
  $("srvTxt").style.color = S.busy ? "var(--tx)" : "var(--mut)";

  const responseText = S.history.length ? S.history.join("\n") : (S.resp || "No response yet");
  $("resp").className = "resp" + (S.history.length ? " has" : "");
  $("resp").textContent = responseText;
}

function setCustomerState(index, status, kind) {
  S.cs[index] = { s: status, k: kind || "" };
  render();
}

async function acquireMutex(label) {
  if (disableMutex) {
    return;
  }
  S.owner = label;
  await S.mutex.wait();
  S.owner = label;
}

function releaseMutex() {
  if (disableMutex) {
    S.owner = null;
    return;
  }
  S.owner = null;
  S.mutex.signal();
}

async function producer(i, currentRun) {
  await delay(i * 1000, currentRun);
  setCustomerState(i, "wait(empty)…", "wait");
  log(`Customer ${i + 1}: wait(empty)`, "p");

  await S.empty.wait();
  render();

  setCustomerState(i, "wait(mutex)…", "wait");
  log(`Customer ${i + 1}: wait(mutex)`, "p");

  await acquireMutex(`Customer ${i + 1}`);
  setCustomerState(i, "Inserting query (critical section)", "act");
  log(`Customer ${i + 1}: mutex acquired, inserting at slot ${S.inn}`, "p");

  await delay(900, currentRun);
  S.slots[S.inn] = { text: S.qs[i], c: i };
  S.inn = (S.inn + 1) % CAP;
  S.entered += 1;
  log(`Customer ${i + 1}: placed "${S.qs[i]}" in slot ${(S.inn + CAP - 1) % CAP}; in = ${S.inn}`, "p");
  render();

  releaseMutex();
  S.full.signal();
  setCustomerState(i, "Query sent ✔ — signal(mutex), signal(full)", "done");
}

async function consumer(currentRun) {
  await delay(600, currentRun);

  for (let k = 0; k < S.n; k++) {
    S.srv = "wait(full)… queue empty, sleeping";
    render();
    log("AI Server: wait(full)", "c");

    await S.full.wait();
    render();

    S.srv = "wait(mutex)…";
    render();

    await acquireMutex("AI Server");

    const idx = S.out;
    const item = S.slots[idx];
    S.srv = `Removing Q${item.c + 1} from slot ${idx} (critical section)`;
    item.leaving = true;
    log(`AI Server: mutex acquired, removing "${item.text}" from slot ${idx}`, "c");
    render();

    await delay(700, currentRun);
    S.slots[idx] = null;
    S.out = (S.out + 1) % CAP;
    S.owner = null;
    releaseMutex();
    S.empty.signal();
    render();

    S.busy = true;
    S.srv = `Processing: “${item.text}”`;
    S.resp = null;
    render();

    await delay(2000, currentRun);
    const matched = REPLY.find(([pattern]) => pattern.test(item.text));
    const answer = matched ? matched[1] : "Thanks for your question! A support agent will follow up shortly.";
    S.proc += 1;
    S.busy = false;
    const replyText = `Customer ${item.c + 1}: ${answer}`;
    S.history.push(replyText);
    S.resp = replyText;
    S.srv = "Response generated ✔";
    log(`AI Server: processed query ${S.proc}/${S.n} — ${replyText}`, "c");
    render();

    await delay(1200, currentRun);
  }

  S.srv = "All done — idle";
  render();
}

function ctrl() {
  $("start").disabled = running;
  $("pause").disabled = !running || paused;
  $("resume").disabled = !running || !paused;
  $("n").disabled = running;
  $("capacity").disabled = running;
  document.querySelectorAll("#inputs input").forEach((input) => {
    input.disabled = running;
  });
}

function finalizeRunState() {
  S.empty = new Sem(CAP);
  S.full = new Sem(0);
  S.mutex = new Sem(1);
  S.owner = null;
  S.busy = false;
  S.srv = "All done — idle";
}

$("start").onclick = async () => {
  CAP = getCapacity();
  const qs = readQueries();

  if (qs.some((q) => !q)) {
    $("err").textContent = "Please enter a query for every customer.";
    return;
  }

  const unique = new Set(qs.map((q) => q.toLowerCase()));
  if (unique.size !== qs.length) {
    $("err").textContent = "Each customer must enter a different query.";
    return;
  }

  $("err").textContent = "";
  $("log").innerHTML = "";
  $("done").style.display = "none";

  run += 1;
  const currentRun = run;
  paused = false;
  running = true;
  disableMutex = $("mutexToggle").checked;
  speedFactor = Number($("speed").value);
  S = freshState(qs);
  buildStatic();
  ctrl();
  render();

  log(`Simulation started: ${qs.length} customer(s), buffer capacity ${CAP}`);

  try {
    await Promise.all([
      ...qs.map((_, i) => producer(i, currentRun)),
      consumer(currentRun)
    ]);

    running = false;
    paused = false;
    finalizeRunState();
    ctrl();
    $("done").style.display = "block";
    $("done").textContent = `✅ All queries processed! ${S.proc} processed, ${CAP - S.slots.filter(Boolean).length} empty slot(s) remain.`;
    log("All queries processed.");
    render();
  } catch (error) {
    running = false;
    paused = false;
    if (S) {
      finalizeRunState();
    }
    ctrl();
    render();
  }
};

$("pause").onclick = () => {
  paused = true;
  ctrl();
  log("Paused");
};

$("resume").onclick = () => {
  paused = false;
  resumeAllWaiters();
  ctrl();
  log("Resumed");
};

$("reset").onclick = () => {
  run += 1;
  paused = false;
  running = false;
  resumeWaiters = [];
  $("err").textContent = "";
  $("done").style.display = "none";
  $("log").innerHTML = "";

  CAP = getCapacity();
  const defaultQs = readQueries();
  S = freshState(defaultQs);
  buildStatic();
  ctrl();
  render();
};

$("n").onchange = () => {
  buildInputs();
  if (!running) {
    const currentQueries = readQueries();
    CAP = getCapacity();
    S = freshState(currentQueries);
    buildStatic();
    render();
  }
};

$("capacity").onchange = () => {
  CAP = getCapacity();
  if (!running) {
    const qs = readQueries();
    S = freshState(qs);
    buildStatic();
    render();
  }
};

$("mutexToggle").onchange = () => {
  disableMutex = $("mutexToggle").checked;
  if (S) {
    render();
  }
};

$("speed").oninput = () => {
  speedFactor = Number($("speed").value);
  $("speedValue").textContent = `${speedFactor.toFixed(1)}x`;
};

buildInputs();
buildStatic();
S = freshState(EX.slice(0, 3));
$("speedValue").textContent = `${speedFactor.toFixed(1)}x`;
ctrl();
render();

