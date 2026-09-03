const cfg = window.TRIPSPLIT_CONFIG || {};
const hasSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseKey);

let sb = null;

let state = {
  trip: null,
  participants: [],
  expenses: [],
  selectedParticipants: new Set(),
  recognition: null,
  listening: false,
  editingExpenseId: null
};

const $ = id => document.getElementById(id);

const money = n =>
  new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR"
  }).format(Number(n) || 0);

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));

function show(id, on = true) {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !on);
}

function setError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  show(id, Boolean(msg));
}

function slug(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function localKey() {
  return "tripsplit_state_" + (state.trip?.code || "default");
}

function loadLocal() {
  try {
    const x = JSON.parse(
      localStorage.getItem(localKey()) || "null"
    );

    if (x) {
      state.participants = x.participants || [];
      state.expenses = x.expenses || [];
    }
  } catch (e) {
    console.warn("Erro ao carregar dados locais.", e);
  }
}

function saveLocal() {
  localStorage.setItem(
    localKey(),
    JSON.stringify({
      participants: state.participants,
      expenses: state.expenses
    })
  );
}

async function initSupabase() {
  if (!hasSupabase) return;

  try {
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );

    sb = mod.createClient(
      cfg.supabaseUrl,
      cfg.supabaseKey
    );
  } catch (e) {
    console.warn(
      "Supabase indisponível; modo local.",
      e
    );
  }
}

async function findTrip(code) {
  if (sb) {
    const {
      data,
      error
    } = await sb
      .from("trips")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (error) throw error;

    return data;
  }

  return JSON.parse(
    localStorage.getItem("tripsplit_trip_" + code) ||
    "null"
  );
}

async function createTrip(code, name) {
  if (sb) {
    const {
      data,
      error
    } = await sb
      .from("trips")
      .insert({
        code,
        name
      })
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  const trip = {
    id: crypto.randomUUID(),
    code,
    name,
    created_at: new Date().toISOString()
  };

  localStorage.setItem(
    "tripsplit_trip_" + code,
    JSON.stringify(trip)
  );

  return trip;
}

async function loadData() {
  if (sb) {
    const [p, e] = await Promise.all([
      sb
        .from("participants")
        .select("*")
        .eq("trip_id", state.trip.id)
        .order("created_at"),

      sb
        .from("expenses")
        .select("*")
        .eq("trip_id", state.trip.id)
        .order("created_at", {
          ascending: false
        })
    ]);

    if (p.error) throw p.error;
    if (e.error) throw e.error;

    state.participants = p.data || [];

    const expenses = e.data || [];
    const ids = expenses.map(x => x.id);

    let links = [];

    if (ids.length) {
      const r = await sb
        .from("expense_participants")
        .select("*")
        .in("expense_id", ids);

      if (r.error) throw r.error;

      links = r.data || [];
    }

    state.expenses = expenses.map(x => ({
      ...x,
      participant_ids: links
        .filter(l => l.expense_id === x.id)
        .map(l => l.participant_id)
    }));
  } else {
    loadLocal();
  }

  state.selectedParticipants =
    new Set(state.participants.map(p => p.id));

  render();
}

function render() {
  if (!state.trip) return;

  $("tripName").textContent =
    `${state.trip.name} · ${state.trip.code}`;

  $("tripTitle").textContent =
    state.trip.name;

  $("participantsList").innerHTML =
    state.participants.length
      ? state.participants
          .map(p => `
            <div class="chip">
              ${esc(p.name)}
              <button
                class="remove"
                data-remove="${p.id}"
                title="Remover">
                ×
              </button>
            </div>
          `)
          .join("")
      : '<span class="muted">Nenhum participante</span>';

  $("payerInput").innerHTML =
    state.participants
      .map(p => `
        <option value="${p.id}">
          ${esc(p.name)}
        </option>
      `)
      .join("");

  renderChecks();
  renderExpenses();
  renderBalances();
  renderTripSummary();
}
function renderTripSummary() {
  const total = state.expenses.reduce(
    (sum, e) => sum + (Number(e.amount_eur) || 0),
    0
  );

  const participantCount = state.participants.length;
  const expenseCount = state.expenses.length;

  const average = participantCount
    ? total / participantCount
    : 0;

  const payments = state.participants.map(p => {
    const paid = state.expenses
      .filter(e => e.payer_id === p.id)
      .reduce(
        (sum, e) => sum + (Number(e.amount_eur) || 0),
        0
      );

    return `
      <div class="summary-person">
        <strong>${esc(p.name)}</strong>
        <span>${money(paid)}</span>
      </div>
    `;
  }).join("");

  const el = $("tripSummary");

  if (!el) return;

  el.innerHTML = `
    <div class="summary-item">
      <span>Total gasto</span>
      <strong>${money(total)}</strong>
    </div>

    <div class="summary-item">
      <span>Média por pessoa</span>
      <strong>${money(average)}</strong>
    </div>

    <div class="summary-item">
      <span>Despesas</span>
      <strong>${expenseCount}</strong>
    </div>

    <div class="summary-item">
      <span>Participantes</span>
      <strong>${participantCount}</strong>
    </div>

    <div class="summary-payments">
      <strong>Total pago por participante</strong>
      ${payments || '<span class="muted">Nenhum pagamento.</span>'}
    </div>
  `;
}
function renderChecks() {
  $("beneficiariesList").innerHTML =
    state.participants
      .map(p => `
        <label class="check">
          <input
            type="checkbox"
            data-participant="${p.id}"
            ${
              state.selectedParticipants.has(p.id)
                ? "checked"
                : ""
            }>
          ${esc(p.name)}
        </label>
      `)
      .join("");
}

function renderExpenses() {
  $("expensesList").innerHTML =
    state.expenses.length
      ? state.expenses
          .map(e => {
            const payer =
              state.participants.find(
                p => p.id === e.payer_id
              )?.name || "—";

            const names =
              (e.participant_ids || [])
                .map(id =>
                  state.participants.find(
                    p => p.id === id
                  )?.name
                )
                .filter(Boolean);

            return `
              <div class="expense">

                <div class="expense-title">
                  ${esc(e.description)}
                </div>

                <div class="expense-meta">
                  ${Number(e.amount).toLocaleString("pt-PT")}
                  ${esc(e.currency)}
                  · ${money(e.amount_eur)}
                  · Pago por ${esc(payer)}
                </div>

                <div class="expense-meta">
                  Participantes:
                  ${
                    names.length
                      ? names.map(esc).join(", ")
                      : "nenhum"
                  }
                </div>

                <div class="expense-actions">

                  <button
  class="secondary expense-edit"
  data-edit-expense="${e.id}">
  Editar
</button>

<button
  class="secondary expense-duplicate"
  data-duplicate-expense="${e.id}">
  Duplicar
</button>

<button
  class="secondary expense-delete"
  data-delete-expense="${e.id}">
  Apagar
</button>

                </div>

              </div>
            `;
          })
          .join("")
      : '<p class="muted">Nenhuma despesa.</p>';
}

function renderBalances() {
  const bal = {};

  state.participants.forEach(
    p => (bal[p.id] = 0)
  );

  for (const e of state.expenses) {
    const ids = e.participant_ids || [];

    const amount =
      Number(e.amount_eur) || 0;

    if (e.payer_id in bal) {
      bal[e.payer_id] += amount;
    }

    if (ids.length) {
      const share =
        amount / ids.length;

      ids.forEach(id => {
        if (id in bal) {
          bal[id] -= share;
        }
      });
    }
  }

  $("balances").innerHTML =
    state.participants
      .map(p => {
        const v = bal[p.id] || 0;

        const text =
          v > 0.005
            ? `recebe ${money(v)}`
            : v < -0.005
              ? `deve ${money(-v)}`
              : "recebe 0,00 €";

        return `
          <div class="balance">
            <strong>${esc(p.name)}</strong>: ${text}
          </div>
        `;
      })
      .join("");

  const creditors = [];
  const debtors = [];

  for (const p of state.participants) {
    const v = bal[p.id] || 0;

    if (v > 0.005) {
      creditors.push({
        id: p.id,
        v
      });
    }

    if (v < -0.005) {
      debtors.push({
        id: p.id,
        v: -v
      });
    }
  }

  const lines = [];

  let i = 0;
  let j = 0;

  while (
    i < debtors.length &&
    j < creditors.length
  ) {
    const d = debtors[i];
    const c = creditors[j];

    const amount =
      Math.min(d.v, c.v);

    const debtorName =
      state.participants.find(
        p => p.id === d.id
      )?.name || "—";

    const creditorName =
      state.participants.find(
        p => p.id === c.id
      )?.name || "—";

    lines.push(`
      <div class="settlement">
        ${esc(debtorName)}
        deve pagar
        ${esc(creditorName)}
        ${money(amount)}
      </div>
    `);

    d.v -= amount;
    c.v -= amount;

    if (d.v < 0.005) i++;
    if (c.v < 0.005) j++;
  }

  $("settlements").innerHTML =
    lines.join("") ||
    '<p class="muted">Não há acertos pendentes.</p>';

  $("conversionBox").textContent =
    calcPreview();
}

function calcPreview() {
  const amount =
    Number($("amountInput").value);

  if (!amount) {
    return "Conversão: —";
  }

  const currency =
    $("currencyInput").value;

  if (currency === "EUR") {
    return `Conversão: ${money(amount)}`;
  }

  const rate =
    Number($("rateInput").value);

  if (!rate) {
    return "Conversão: indique a taxa para EUR";
  }

  const eur = amount * rate;

  const n =
    state.selectedParticipants.size;

  return `
    ${amount.toLocaleString("pt-PT")}
    ${currency}
    = ${money(eur)}
    ${
      n
        ? ` · ${n} participante(s) = ${money(
            eur / n
          )} por pessoa`
        : ""
    }
  `;
}

async function addParticipant() {
  const name =
    $("participantInput").value.trim();

  setError("participantError", "");

  if (!name) {
    return setError(
      "participantError",
      "Introduza um nome."
    );
  }

  if (
    state.participants.some(
      p => slug(p.name) === slug(name)
    )
  ) {
    return setError(
      "participantError",
      "Esse participante já existe."
    );
  }

  try {
    let p;

    if (sb) {
      const r = await sb
        .from("participants")
        .insert({
          trip_id: state.trip.id,
          name
        })
        .select()
        .single();

      if (r.error) throw r.error;

      p = r.data;
    } else {
      p = {
        id: crypto.randomUUID(),
        trip_id: state.trip.id,
        name,
        created_at:
          new Date().toISOString()
      };
    }

    state.participants.push(p);

    state.selectedParticipants.add(
      p.id
    );

    $("participantInput").value = "";

    saveLocal();
    render();

  } catch (e) {
    setError(
      "participantError",
      e.message ||
        "Não foi possível adicionar."
    );
  }
}

async function removeParticipant(id) {
  const hasExpenses =
    state.expenses.some(
      e =>
        e.payer_id === id ||
        (e.participant_ids || []).includes(id)
    );

  if (hasExpenses) {
    return setError(
      "participantError",
      "Não é possível remover um participante que já está associado a despesas."
    );
  }

  if (sb) {
    const r = await sb
      .from("participants")
      .delete()
      .eq("id", id);

    if (r.error) {
      return setError(
        "participantError",
        r.error.message
      );
    }
  }

  state.participants =
    state.participants.filter(
      p => p.id !== id
    );

  state.selectedParticipants.delete(id);

  saveLocal();
  render();
}

function resetExpenseForm() {
  state.editingExpenseId = null;

  $("descriptionInput").value = "";
  $("amountInput").value = "";
  $("rateInput").value = "";

  state.selectedParticipants =
    new Set(
      state.participants.map(
        p => p.id
      )
    );

  $("saveExpenseBtn").textContent =
    "Guardar despesa";

  $("saveStatus").classList.add(
    "hidden"
  );

  renderChecks();
  renderBalances();
}

function startEditExpense(id) {
  const expense =
    state.expenses.find(
      e => e.id === id
    );

  if (!expense) return;

  state.editingExpenseId = id;

  $("descriptionInput").value =
    expense.description || "";

  $("amountInput").value =
    expense.amount ?? "";

  $("currencyInput").value =
    expense.currency || "EUR";

  $("rateInput").value =
    expense.currency === "EUR"
      ? ""
      : expense.rate_to_eur ?? "";

  $("payerInput").value =
    expense.payer_id || "";

  state.selectedParticipants =
    new Set(
      expense.participant_ids || []
    );

  $("saveExpenseBtn").textContent =
    "Guardar alterações";

  $("saveStatus").textContent =
    "A editar despesa.";

  $("saveStatus").classList.remove(
    "hidden"
  );

  renderChecks();
  renderBalances();

  $("descriptionInput").focus();
}
function duplicateExpense(id){
  const expense = state.expenses.find(e => e.id === id);

  if(!expense) return;

  state.editingExpenseId = null;

  $("descriptionInput").value =
    expense.description || "";

  $("amountInput").value =
    expense.amount ?? "";

  $("currencyInput").value =
    expense.currency || "EUR";

  $("rateInput").value =
    expense.currency === "EUR"
      ? ""
      : expense.rate_to_eur ?? "";

  $("payerInput").value =
    expense.payer_id || "";

  state.selectedParticipants =
    new Set(expense.participant_ids || []);

  $("saveExpenseBtn").textContent =
    "Guardar despesa";

  $("saveStatus").textContent =
    "Despesa duplicada. Pode alterar os dados antes de guardar.";

  $("saveStatus").classList.remove("hidden");

  renderChecks();
  renderBalances();

  $("descriptionInput").focus();
}
async function deleteExpense(id) {
  const expense =
    state.expenses.find(
      e => e.id === id
    );

  if (!expense) return;

  const confirmed =
    window.confirm(
      `Apagar a despesa "${expense.description}"?\\n\\nEsta ação não pode ser desfeita.`
    );

  if (!confirmed) return;

  try {
    if (sb) {
      const relationResult =
        await sb
          .from("expense_participants")
          .delete()
          .eq("expense_id", id);

      if (relationResult.error) {
        throw relationResult.error;
      }

      const expenseResult =
        await sb
          .from("expenses")
          .delete()
          .eq("id", id);

      if (expenseResult.error) {
        throw expenseResult.error;
      }
    }

    state.expenses =
      state.expenses.filter(
        e => e.id !== id
      );

    if (
      state.editingExpenseId === id
    ) {
      resetExpenseForm();
    }

    saveLocal();
    render();

  } catch (e) {
    alert(
      e.message ||
        "Não foi possível apagar a despesa."
    );
  }
}

async function saveExpense() {
  const description =
    $("descriptionInput").value.trim();

  const amount =
    Number($("amountInput").value);

  const currency =
    $("currencyInput").value;

  const rate =
    currency === "EUR"
      ? 1
      : Number($("rateInput").value);

  const payer =
    $("payerInput").value;

  const ids =
    [...state.selectedParticipants]
      .filter(id =>
        state.participants.some(
          p => p.id === id
        )
      );

  $("saveStatus").classList.remove(
    "hidden"
  );

  if (!description) {
    $("saveStatus").textContent =
      "Indique a descrição.";
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    $("saveStatus").textContent =
      "Indique um valor válido.";
    return;
  }

  if (!Number.isFinite(rate) || rate <= 0) {
    $("saveStatus").textContent =
      "Indique uma taxa válida.";
    return;
  }

  if (
    !payer ||
    !state.participants.some(
      p => p.id === payer
    )
  ) {
    $("saveStatus").textContent =
      "Selecione quem pagou.";
    return;
  }

  if (!ids.length) {
    $("saveStatus").textContent =
      "Selecione pelo menos um participante.";
    return;
  }

  const eur =
    Number(
      (amount * rate).toFixed(2)
    );

  try {
    if (state.editingExpenseId) {
      await updateExpense(
        state.editingExpenseId,
        {
          description,
          amount,
          currency,
          rate,
          eur,
          payer,
          ids
        }
      );

      $("saveStatus").textContent =
        `Despesa atualizada: ${money(eur)}`;

    } else {
      await createExpense({
        description,
        amount,
        currency,
        rate,
        eur,
        payer,
        ids
      });

      $("saveStatus").textContent =
        `Despesa guardada: ${money(eur)}`;
    }

    resetExpenseForm();
    render();

  } catch (e) {
    $("saveStatus").textContent =
      e.message ||
      "Não foi possível guardar a despesa.";
  }
}

async function createExpense(data) {
  let expense;

  if (sb) {
    const r = await sb
      .from("expenses")
      .insert({
        trip_id: state.trip.id,
        description: data.description,
        amount: data.amount,
        currency: data.currency,
        rate_to_eur: data.rate,
        amount_eur: data.eur,
        payer_id: data.payer
      })
      .select()
      .single();

    if (r.error) throw r.error;

    expense = r.data;

    const r2 = await sb
      .from("expense_participants")
      .insert(
        data.ids.map(id => ({
          expense_id: expense.id,
          participant_id: id
        }))
      );

    if (r2.error) {
      await sb
        .from("expenses")
        .delete()
        .eq("id", expense.id);

      throw r2.error;
    }

  } else {
    expense = {
      id: crypto.randomUUID(),
      trip_id: state.trip.id,
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      rate_to_eur: data.rate,
      amount_eur: data.eur,
      payer_id: data.payer,
      participant_ids: data.ids,
      created_at:
        new Date().toISOString()
    };
  }

  state.expenses.unshift({
    ...expense,
    participant_ids: data.ids
  });

  saveLocal();
}

async function updateExpense(id, data) {
  const index =
    state.expenses.findIndex(
      e => e.id === id
    );

  if (index === -1) {
    throw new Error(
      "Despesa não encontrada."
    );
  }

  if (sb) {
    const r = await sb
      .from("expenses")
      .update({
        description: data.description,
        amount: data.amount,
        currency: data.currency,
        rate_to_eur: data.rate,
        amount_eur: data.eur,
        payer_id: data.payer
      })
      .eq("id", id);

    if (r.error) throw r.error;

    const del =
      await sb
        .from("expense_participants")
        .delete()
        .eq("expense_id", id);

    if (del.error) {
      throw del.error;
    }

    const ins =
      await sb
        .from("expense_participants")
        .insert(
          data.ids.map(
            participantId => ({
              expense_id: id,
              participant_id:
                participantId
            })
          )
        );

    if (ins.error) {
      throw ins.error;
    }
  }

  state.expenses[index] = {
    ...state.expenses[index],
    description: data.description,
    amount: data.amount,
    currency: data.currency,
    rate_to_eur: data.rate,
    amount_eur: data.eur,
    payer_id: data.payer,
    participant_ids: data.ids
  };

  saveLocal();
}

function setupVoice() {
  const SR =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SR) {
    $("voiceStatus").textContent =
      "O reconhecimento de voz não está disponível neste browser.";
    return;
  }

  const r = new SR();

  r.lang = "pt-PT";
  r.interimResults = true;
  r.continuous = false;

  state.recognition = r;

  r.onstart = () => {
    state.listening = true;

    $("voiceBtn").textContent =
      "A ouvir...";

    $("voiceStatus").textContent =
      "Diga, por exemplo: jantar 100 euros pago pela Rosa";
  };

  r.onresult = e => {
    const text =
      [...e.results]
        .map(x => x[0].transcript)
        .join(" ")
        .trim();

    parseVoice(text);

    $("voiceStatus").textContent =
      `Ouvido: ${text}`;
  };

  r.onerror = e => {
    state.listening = false;

    $("voiceBtn").textContent =
      "Introduzir por voz";

    $("voiceStatus").textContent =
      e.error === "not-allowed"
        ? "O microfone foi bloqueado. Permita o microfone para esta página."
        : "Não consegui interpretar a voz.";
  };

  r.onend = () => {
    state.listening = false;

    $("voiceBtn").textContent =
      "Introduzir por voz";
  };

  $("voiceBtn").onclick =
    () =>
      state.listening
        ? r.stop()
        : r.start();
}

function parseVoice(text) {
  const original =
    String(text || "").trim();

  const normalized =
    normalizeName(original);

  /*
    Procuramos primeiro o nome de cada
    participante dentro da frase.

    Isto permite frases como:
    "Rosa pago 100 euros"
    "Rosa pagou 100 euros"
    "100 euros pago pela Rosa"
    "Jantar 100 euros, a Rosa pagou"
  */

  let payer = null;

  const orderedParticipants =
    [...state.participants].sort(
      (a, b) =>
        normalizeName(b.name).length -
        normalizeName(a.name).length
    );

  for (const participant of orderedParticipants) {
    const name =
      normalizeName(participant.name);

    if (!name) continue;

    const namePattern =
      new RegExp(
        `(^|\\s)${name.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}(?=\\s|$|[,.;:])`,
        "i"
      );

    if (namePattern.test(normalized)) {
      payer = participant;
      break;
    }
  }

  const amountMatch =
    original.match(
      /(\d+(?:[.,]\d+)?)\s*(euros?|€|cop|pesos?)/i
    );

  if (amountMatch) {
    $("amountInput").value =
      amountMatch[1].replace(
        ",",
        "."
      );

    if (
      /cop|peso/i.test(
        amountMatch[2] || ""
      )
    ) {
      $("currencyInput").value =
        "COP";
    } else {
      $("currencyInput").value =
        "EUR";
    }
  }

  let description =
    original
      .replace(
        /(\d+(?:[.,]\d+)?)\s*(euros?|€|cop|pesos?)/gi,
        ""
      )
      .trim();

  if (payer) {
    const payerName =
      payer.name.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    description =
      description
        .replace(
          new RegExp(
            `\\b${payerName}\\b`,
            "i"
          ),
          ""
        )
        .replace(
          /\b(?:pago|pagou|paga|paguei|pagamento)\b/gi,
          ""
        )
        .replace(
          /\b(?:pelo|pela|por)\b/gi,
          ""
        )
        .replace(
          /\b(?:foi|a|o)\b/gi,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();
  }

  $("descriptionInput").value =
    description ||
    "Despesa";

  if (payer) {
    $("payerInput").value =
      payer.id;
  }

  renderBalances();
}

function wireEvents() {
  $("joinBtn").onclick =
    async () => {
      const code =
        $("tripCodeInput")
          .value
          .trim()
          .toUpperCase();

      setError("joinError", "");

      if (!code) {
        return setError(
          "joinError",
          "Introduza o código."
        );
      }

      try {
        const t =
          await findTrip(code);

        if (!t) {
          return setError(
            "joinError",
            "Viagem não encontrada."
          );
        }

        state.trip = t;

        show(
          "joinView",
          false
        );

        show(
          "tripView",
          true
        );

        await loadData();

      } catch (e) {
        setError(
          "joinError",
          e.message ||
            "Não foi possível ligar à viagem."
        );
      }
    };

  $("createBtn").onclick =
    async () => {
      const code =
        $("tripCodeInput")
          .value
          .trim()
          .toUpperCase();

      setError("joinError", "");

      if (!code) {
        return setError(
          "joinError",
          "Introduza o código."
        );
      }

      try {
        const existing =
          await findTrip(code);

        if (existing) {
          return setError(
            "joinError",
            "Esse código já existe. Use Ligar."
          );
        }

        state.trip =
          await createTrip(
            code,
            "Colômbia 2026"
          );

        state.participants = [];
        state.expenses = [];

        show(
          "joinView",
          false
        );

        show(
          "tripView",
          true
        );

        render();

      } catch (e) {
        setError(
          "joinError",
          e.message ||
            "Não foi possível criar a viagem."
        );
      }
    };

  $("addParticipantBtn").onclick =
    addParticipant;

  $("participantInput").addEventListener(
    "keydown",
    e => {
      if (e.key === "Enter") {
        addParticipant();
      }
    }
  );

  $("participantsList").addEventListener(
    "click",
    e => {
      const id =
        e.target.dataset.remove;

      if (id) {
        removeParticipant(id);
      }
    }
  );

  $("beneficiariesList").addEventListener(
    "change",
    e => {
      const id =
        e.target.dataset.participant;

      if (!id) return;

      if (e.target.checked) {
        state.selectedParticipants.add(
          id
        );
      } else {
        state.selectedParticipants.delete(
          id
        );
      }

      $("conversionBox").textContent =
        calcPreview();
    }
  );

  $("allBtn").onclick = () => {
    state.selectedParticipants =
      new Set(
        state.participants.map(
          p => p.id
        )
      );

    renderChecks();
    $("conversionBox").textContent =
      calcPreview();
  };

  $("noneBtn").onclick = () => {
    state.selectedParticipants.clear();

    renderChecks();

    $("conversionBox").textContent =
      calcPreview();
  };

  [
    "amountInput",
    "currencyInput",
    "rateInput"
  ].forEach(id => {
    $(id).addEventListener(
      "input",
      () => {
        $("conversionBox").textContent =
          calcPreview();
      }
    );
  });

  $("saveExpenseBtn").onclick =
    saveExpense;

  $("expensesList").addEventListener(
    "click",
    e => {
      const editId =
        e.target.dataset.editExpense;

      const deleteId =
        e.target.dataset.deleteExpense;
const duplicateId =
  e.target.dataset.duplicateExpense;
      if (editId) {
        startEditExpense(editId);
      }
if (duplicateId) {
  duplicateExpense(duplicateId);
}
      if (deleteId) {
        deleteExpense(deleteId);
      }
    }
  );
}

(async () => {
  await initSupabase();

  wireEvents();
  setupVoice();
})();
