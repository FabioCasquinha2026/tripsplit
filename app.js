const cfg = window.TRIPSPLIT_CONFIG || {};
const hasSupabase = Boolean(cfg.supabaseUrl && cfg.supabaseKey);

let sb = null;
let state = {
  trip: null,
  participants: [],
  expenses: [],
  selectedParticipants: new Set(),
  recognition: null,
  listening: false
};

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const esc = s => String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));

function show(id,on=true){$(id).classList.toggle("hidden",!on)}
function setError(id,msg){$(id).textContent=msg;show(id,Boolean(msg))}
function slug(s){return s.trim().replace(/\s+/g," ").toLowerCase()}

function localKey(){return "tripsplit_state_"+(state.trip?.code||"default")}
function loadLocal(){
  try{
    const x=JSON.parse(localStorage.getItem(localKey())||"null");
    if(x){state.participants=x.participants||[];state.expenses=x.expenses||[]}
  }catch(e){}
}
function saveLocal(){localStorage.setItem(localKey(),JSON.stringify({participants:state.participants,expenses:state.expenses}))}

async function initSupabase(){
  if(!hasSupabase) return;
  const src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
  try{
    const mod=await import(src);
    sb=mod.createClient(cfg.supabaseUrl,cfg.supabaseKey);
  }catch(e){console.warn("Supabase indisponível; modo local.",e)}
}

async function findTrip(code){
  if(sb){
    const {data,error}=await sb.from("trips").select("*").eq("code",code).maybeSingle();
    if(error) throw error;
    return data;
  }
  return JSON.parse(localStorage.getItem("tripsplit_trip_"+code)||"null");
}

async function createTrip(code,name){
  if(sb){
    const {data,error}=await sb.from("trips").insert({code,name}).select().single();
    if(error) throw error;
    return data;
  }
  const trip={id:crypto.randomUUID(),code,name,created_at:new Date().toISOString()};
  localStorage.setItem("tripsplit_trip_"+code,JSON.stringify(trip));
  return trip;
}

async function loadData(){
  if(sb){
    const [p,e]=await Promise.all([
      sb.from("participants").select("*").eq("trip_id",state.trip.id).order("created_at"),
      sb.from("expenses").select("*").eq("trip_id",state.trip.id).order("created_at",{ascending:false})
    ]);
    if(p.error) throw p.error;
    if(e.error) throw e.error;
    state.participants=p.data||[];
    const expenses=e.data||[];
    const ids=expenses.map(x=>x.id);
    let links=[];
    if(ids.length){
      const r=await sb.from("expense_participants").select("*").in("expense_id",ids);
      if(r.error) throw r.error;
      links=r.data||[];
    }
    state.expenses=expenses.map(x=>({...x,participant_ids:links.filter(l=>l.expense_id===x.id).map(l=>l.participant_id)}));
  }else loadLocal();
  state.selectedParticipants=new Set(state.participants.map(p=>p.id));
  render();
}

function render(){
  $("tripName").textContent=`${state.trip.name} · ${state.trip.code}`;
  $("tripTitle").textContent=state.trip.name;
  $("participantsList").innerHTML=state.participants.map(p=>`
    <div class="chip">${esc(p.name)} <button class="remove" data-remove="${p.id}" title="Remover">×</button></div>`).join("") || '<span class="muted">Nenhum participante</span>';
  $("payerInput").innerHTML=state.participants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  renderChecks(); renderExpenses(); renderBalances();
}

function renderChecks(){
  $("beneficiariesList").innerHTML=state.participants.map(p=>`
    <label class="check"><input type="checkbox" data-participant="${p.id}" ${state.selectedParticipants.has(p.id)?"checked":""}> ${esc(p.name)}</label>`).join("");
}
function renderExpenses(){
  $("expensesList").innerHTML=state.expenses.length ? state.expenses.map(e=>{
    const payer=state.participants.find(p=>p.id===e.payer_id)?.name||"—";
    const names=(e.participant_ids||[]).map(id=>state.participants.find(p=>p.id===id)?.name).filter(Boolean);
    return `<div class="expense">
      <div class="expense-title">${esc(e.description)}</div>
      <div class="expense-meta">${Number(e.amount).toLocaleString("pt-PT")} ${esc(e.currency)} · ${money(e.amount_eur)} · Pago por ${esc(payer)}</div>
      <div class="expense-meta">Participantes: ${names.length?names.map(esc).join(", "):"nenhum"}</div>
    </div>`;
  }).join("") : '<p class="muted">Nenhuma despesa.</p>';
}

function renderBalances(){
  const bal={}; state.participants.forEach(p=>bal[p.id]=0);
  for(const e of state.expenses){
    const ids=e.participant_ids||[];
    if(e.payer_id in bal) bal[e.payer_id]+=Number(e.amount_eur);
    if(ids.length){
      const share=Number(e.amount_eur)/ids.length;
      ids.forEach(id=>{if(id in bal) bal[id]-=share});
    }
  }
  $("balances").innerHTML=state.participants.map(p=>{
    const v=bal[p.id]||0;
    const text=v>0.005?`recebe ${money(v)}`:v<-0.005?`deve ${money(-v)}`:"recebe 0,00 €";
    return `<div class="balance"><strong>${esc(p.name)}</strong>: ${text}</div>`;
  }).join("");
  const creditors=[],debtors=[];
  for(const p of state.participants){
    const v=bal[p.id]||0;
    if(v>0.005) creditors.push({id:p.id,v});
    if(v<-0.005) debtors.push({id:p.id,v:-v});
  }
  const lines=[];
  let i=0,j=0;
  while(i<debtors.length&&j<creditors.length){
    const d=debtors[i],c=creditors[j],amt=Math.min(d.v,c.v);
    const dn=state.participants.find(p=>p.id===d.id)?.name, cn=state.participants.find(p=>p.id===c.id)?.name;
    lines.push(`<div class="settlement">${esc(dn)} deve pagar ${esc(cn)} ${money(amt)}</div>`);
    d.v-=amt;c.v-=amt;if(d.v<0.005)i++;if(c.v<0.005)j++;
  }
  $("settlements").innerHTML=lines.join("")||'<p class="muted">Não há acertos pendentes.</p>';
  const preview=calcPreview();
  $("conversionBox").textContent=preview;
}

function calcPreview(){
  const a=Number($("amountInput").value);
  if(!a) return "Conversão: —";
  const cur=$("currencyInput").value;
  if(cur==="EUR") return `Conversão: ${money(a)}`;
  const r=Number($("rateInput").value);
  if(!r) return "Conversão: indique a taxa para EUR";
  const eur=a*r;
  const n=state.selectedParticipants.size;
  return `${a.toLocaleString("pt-PT")} ${cur} = ${money(eur)}${n?` · ${n} participante(s) = ${money(eur/n)} por pessoa`:""}`;
}

async function addParticipant(){
  const name=$("participantInput").value.trim();
  setError("participantError","");
  if(!name) return setError("participantError","Introduza um nome.");
  if(state.participants.some(p=>slug(p.name)===slug(name))) return setError("participantError","Esse participante já existe.");
  try{
    let p;
    if(sb){
      const r=await sb.from("participants").insert({trip_id:state.trip.id,name}).select().single();
      if(r.error) throw r.error;p=r.data;
    }else p={id:crypto.randomUUID(),trip_id:state.trip.id,name,created_at:new Date().toISOString()};
    state.participants.push(p);state.selectedParticipants.add(p.id);$("participantInput").value="";saveLocal();render();
  }catch(e){setError("participantError",e.message||"Não foi possível adicionar.")}
}

async function removeParticipant(id){
  if(sb){
    const r=await sb.from("participants").delete().eq("id",id);
    if(r.error){setError("participantError",r.error.message);return}
  }
  state.participants=state.participants.filter(p=>p.id!==id);
  state.expenses=state.expenses.map(e=>({...e,participant_ids:(e.participant_ids||[]).filter(x=>x!==id)}));
  state.selectedParticipants.delete(id);saveLocal();render();
}

async function saveExpense(){
  setError("joinError","");
  const description=$("descriptionInput").value.trim();
  const amount=Number($("amountInput").value);
  const currency=$("currencyInput").value;
  const rate=currency==="EUR"?1:Number($("rateInput").value);
  const payer=$("payerInput").value;
  const ids=[...state.selectedParticipants];
  if(!description) return $("saveStatus").textContent="Indique a descrição.";
  if(!amount||amount<=0) return $("saveStatus").textContent="Indique um valor válido.";
  if(!rate||rate<=0) return $("saveStatus").textContent="Indique uma taxa válida.";
  if(!payer) return $("saveStatus").textContent="Adicione pelo menos um participante.";
  const eur=amount*rate;
  try{
    let e;
    if(sb){
      const r=await sb.from("expenses").insert({trip_id:state.trip.id,description,amount,currency,rate_to_eur:rate,amount_eur:eur,payer_id:payer}).select().single();
      if(r.error) throw r.error;e=r.data;
      if(ids.length){
        const r2=await sb.from("expense_participants").insert(ids.map(id=>({expense_id:e.id,participant_id:id})));
        if(r2.error) throw r2.error;
      }
    }else e={id:crypto.randomUUID(),trip_id:state.trip.id,description,amount,currency,rate_to_eur:rate,amount_eur:eur,payer_id:payer,participant_ids:ids,created_at:new Date().toISOString()};
    state.expenses.unshift({...e,participant_ids:ids});
    saveLocal();
    $("saveStatus").textContent=`Despesa guardada: ${money(eur)}`;
    $("descriptionInput").value="";$("amountInput").value="";$("rateInput").value="";
    state.selectedParticipants=new Set(state.participants.map(p=>p.id));render();
  }catch(e){$("saveStatus").textContent=e.message||"Não foi possível guardar a despesa."}
}

function setupVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){$("voiceStatus").textContent="O reconhecimento de voz não está disponível neste browser.";return}
  const r=new SR();r.lang="pt-PT";r.interimResults=true;r.continuous=false;
  state.recognition=r;
  r.onstart=()=>{state.listening=true;$("voiceBtn").textContent="🔴 A ouvir...";$("voiceStatus").textContent="Diga, por exemplo: jantar 100 euros";}
  r.onresult=e=>{
    const text=[...e.results].map(x=>x[0].transcript).join(" ").trim();
    parseVoice(text);$("voiceStatus").textContent=`Ouvido: ${text}`;
  };
  r.onerror=e=>{state.listening=false;$("voiceBtn").textContent="🎙️ Introduzir por voz";$("voiceStatus").textContent=e.error==="not-allowed"?"O microfone foi bloqueado. Permita o microfone para esta página.":"Não consegui interpretar a voz."};
  r.onend=()=>{state.listening=false;$("voiceBtn").textContent="🎙️ Introduzir por voz"};
  $("voiceBtn").onclick=()=>state.listening?r.stop():r.start();
}
function parseVoice(text){
  const original = text.trim();

  // Normaliza o texto apenas para facilitar a procura do nome.
  const normalized = original
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // 1. Procurar quem pagou.
  // Exemplos:
  // "pago pelo Fábio"
  // "pago pela Rosa"
  // "Rosa pagou"
  // "foi pago pelo Gongo"
  let payer = null;

  const payerPatterns = [
    /(?:pago|pagou|paga|pagamento)\s+(?:pelo|pela|por)\s+(.+?)(?=\s+(?:e|para|dos|das|de|no|na)\b|$)/i,
    /(?:foi\s+)?pago\s+(?:pelo|pela|por)\s+(.+?)(?=\s+(?:e|para|dos|das|de|no|na)\b|$)/i,
    /^(.+?)\s+pagou\b/i
  ];

  for (const pattern of payerPatterns) {
    const match = normalized.match(pattern);

    if (match) {
      const spokenName = match[1].trim();

      payer = state.participants.find(p => {
        const participantName = p.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();

        return (
          participantName === spokenName ||
          participantName.includes(spokenName) ||
          spokenName.includes(participantName)
        );
      });

      if (payer) break;
    }
  }

  // 2. Procurar valor e moeda.
  const amountMatch = original.match(
    /(\d+(?:[.,]\d+)?)\s*(euros?|€|cop|pesos?)/i
  );

  if (amountMatch) {
    $("amountInput").value = amountMatch[1].replace(",", ".");

    if (/cop|peso/i.test(amountMatch[2])) {
      $("currencyInput").value = "COP";
    } else {
      $("currencyInput").value = "EUR";
    }
  }

  // 3. Retirar do texto a parte do valor/moeda.
  let description = original
    .replace(
      /(\d+(?:[.,]\d+)?)\s*(euros?|€|cop|pesos?)/gi,
      ""
    )
    .trim();

  // 4. Retirar a informação "pago pelo..." da descrição.
  description = description
    .replace(
      /\b(?:foi\s+)?pago\s+(?:pelo|pela|por)\s+.+$/i,
      ""
    )
    .replace(
      /\b(?:pago|pagou)\s+(?:pelo|pela|por)\s+.+$/i,
      ""
    )
    .trim();

  // 5. Se encontramos o participante, seleccioná-lo como pagador.
  if (payer) {
    $("payerInput").value = payer.id;
  }

  // 6. Se não houver descrição, usar "Despesa".
  $("descriptionInput").value = description || "Despesa";

  renderBalances();
}

$("joinBtn").onclick=async()=>{
  const code=$("tripCodeInput").value.trim().toUpperCase();setError("joinError","");
  if(!code)return setError("joinError","Introduza o código.");
  try{
    const t=await findTrip(code);
    if(!t)return setError("joinError","Viagem não encontrada.");
    state.trip=t;show("joinView",false);show("tripView",true);loadData();
  }catch(e){setError("joinError",e.message||"Não foi possível ligar à viagem.")}
};
$("createBtn").onclick=async()=>{
  const code=$("tripCodeInput").value.trim().toUpperCase();setError("joinError","");
  if(!code)return setError("joinError","Introduza o código.");
  try{
    const existing=await findTrip(code);if(existing)return setError("joinError","Esse código já existe. Use Ligar.");
    state.trip=await createTrip(code,"Colômbia 2026");show("joinView",false);show("tripView",true);state.participants=[];state.expenses=[];render();
  }catch(e){setError("joinError",e.message||"Não foi possível criar a viagem.")}
};
$("addParticipantBtn").onclick=addParticipant;
$("participantInput").addEventListener("keydown",e=>{if(e.key==="Enter")addParticipant()});
$("participantsList").addEventListener("click",e=>{const id=e.target.dataset.remove;if(id)removeParticipant(id)});
$("beneficiariesList").addEventListener("change",e=>{if(e.target.dataset.participant){const id=e.target.dataset.participant;if(e.target.checked)state.selectedParticipants.add(id);else state.selectedParticipants.delete(id);$("conversionBox").textContent=calcPreview()}});
$("allBtn").onclick=()=>{state.selectedParticipants=new Set(state.participants.map(p=>p.id));renderChecks();$("conversionBox").textContent=calcPreview()};
$("noneBtn").onclick=()=>{state.selectedParticipants.clear();renderChecks();$("conversionBox").textContent=calcPreview()};
["amountInput","currencyInput","rateInput"].forEach(id=>$(id).addEventListener("input",()=>{$("conversionBox").textContent=calcPreview()}));
$("saveExpenseBtn").onclick=saveExpense;

(async()=>{
  await initSupabase();
  setupVoice();
})();
