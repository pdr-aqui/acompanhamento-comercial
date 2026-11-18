"use strict";
(() => {
const CFG = window.ACOMP_CONFIG || {}, DEMO = !CFG.supabaseUrl;
const $app = document.getElementById("app"), $modal = document.getElementById("modal"), $aviso = document.getElementById("aviso");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dt = s => s ? new Date(String(s).length === 10 ? s + "T12:00" : s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }) : "";
const dtc = s => s ? dt(s).slice(0, 5) : "";
const ERROS = { sem_permissao: "Este usuário não tem acesso ao RH.", ja_enviada: "Esta etapa já foi respondida.", nao_aplicavel: "Esta etapa não se aplica a esta pessoa.", sessao_invalida: "Este preenchimento não está mais ativo.", motivo_obrigatorio: "Informe o motivo.", texto_vazio: "Escreva a observação." };
const msgErro = e => e && e.rede ? "Sem conexão com o servidor. Verifique a internet." : ERROS[e && e.message] || "Não foi possível concluir. Tente novamente.";
/* Ícones em linha: a CSP não permite imagens de fora e SVG herda a cor do texto */
const svg = (d, w = 2.2) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const IC = { check: svg("M5 12.5l4.2 4.2L19 7", 2.8), alerta: svg("M12 8v5M12 16.5v.01M10.3 3.9L2.6 17.3A2 2 0 004.3 20.3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"), busca: svg("M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4"),
  lapis: svg("M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4zM13.5 6.5l4 4"), seta: svg("M9 6l6 6-6 6"), volta: svg("M15 6l-6 6 6 6"), info: svg("M12 11v5M12 8v.01M12 21a9 9 0 100-18 9 9 0 000 18z"), tablet: svg("M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM11 18h2") };
const MENOS_MOV = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let tempo; const avisa = (m, tipo) => { $aviso.innerHTML = (tipo === "ok" ? IC.check : tipo === "erro" ? IC.alerta : "") + `<span>${esc(m)}</span>`; $aviso.className = "on " + (tipo || ""); $aviso.setAttribute("role", tipo === "erro" ? "alert" : "status"); clearTimeout(tempo); tempo = setTimeout(() => { $aviso.className = ""; }, tipo === "erro" ? 7000 : 3800); };

/* ===== Plataforma: o site se ajusta sozinho ao aparelho ===== */
const PLAT = (() => { const u = navigator.userAgent; if (/iPad|iPhone/.test(u) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ipad"; if (/Android/i.test(u)) return "android"; return "outro"; })();
document.documentElement.dataset.plataforma = PLAT;
const INSTALADO = () => matchMedia("(display-mode: standalone),(display-mode: fullscreen)").matches || navigator.standalone === true;
let pedidoInstalar = null; addEventListener("beforeinstallprompt", e => { e.preventDefault(); pedidoInstalar = e; });
const DISPOSITIVO = () => `${PLAT} ${screen.width}x${screen.height}${INSTALADO() ? " app" : ""}`;

/* ===== Guarda local protegida ===== */
const banco = () => new Promise((ok, no) => { const r = indexedDB.open("acomp", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const kv = async (modo, k, v) => { const d = await banco(); return new Promise((ok, no) => { const t = d.transaction("kv", modo === "get" ? "readonly" : "readwrite"), s = t.objectStore("kv"), r = modo === "get" ? s.get(k) : modo === "del" ? s.delete(k) : s.put(v, k); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); t.oncomplete = () => d.close(); }); };
async function chave() { let c = await kv("get", "chave"); if (!c) { c = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); await kv("put", "chave", c); } return c; }
let filaGrava = Promise.resolve();
const guardaF = () => { if (!F) return filaGrava; const copia = JSON.stringify(F); return filaGrava = filaGrava.then(async () => { const iv = crypto.getRandomValues(new Uint8Array(12)); const dados = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), new TextEncoder().encode(copia)); await kv("put", "sessao", { iv, dados }); }).catch(() => { }); };
async function leF() { const s = await kv("get", "sessao"); if (!s) return null; try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: s.iv }, await chave(), s.dados))); } catch (e) { return null; } }
const apagaF = async () => { F = null; await filaGrava; await kv("del", "sessao"); await kv("del", "chave"); };

/* ===== Servidor ===== */
let rhS = null;
class ErroRede extends Error { constructor() { super("rede"); this.rede = true; } }
async function chamar(url, op) { let r; try { r = await fetch(url, { ...op, cache: "no-store", referrerPolicy: "no-referrer" }); } catch (e) { throw new ErroRede(); } let j = null; try { j = await r.json(); } catch (e) { } if (!r.ok) { const x = new Error((j && (j.message || j.error_description || j.msg)) || "erro"); x.status = r.status; throw x; } return j; }
const H = t => ({ apikey: CFG.supabaseChavePublica, "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) });
async function carregaDemo() { if (window.AcompDemo) return; for (const s of ["demo-dados.js", "demo.js"]) await new Promise((ok, no) => { const e = document.createElement("script"); e.src = s; e.onload = ok; e.onerror = no; document.head.append(e); }); }
async function entrar(email, senha) { if (DEMO) { await carregaDemo(); rhS = { email }; } else { const j = await chamar(CFG.supabaseUrl + "/auth/v1/token?grant_type=password", { method: "POST", headers: H(), body: JSON.stringify({ email, password: senha }) }); rhS = { email, access: j.access_token, refresh: j.refresh_token }; } try { localStorage.setItem("acomp_email", email); } catch (e) { } }
async function renova() { const j = await chamar(CFG.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: H(), body: JSON.stringify({ refresh_token: rhS.refresh }) }); rhS.access = j.access_token; rhS.refresh = j.refresh_token; }
async function rpc(fn, args = {}, anon) { if (DEMO) { await carregaDemo(); return AcompDemo.rpc(fn, args); } const faz = () => chamar(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: H(anon ? null : rhS && rhS.access), body: JSON.stringify(args) }); try { return await faz(); } catch (e) { if (!anon && e.status === 401 && rhS && rhS.refresh) { await renova(); return faz(); } throw e; } }
async function sairRH() { const s = rhS; rhS = null; if (!DEMO && s && s.access) fetch(CFG.supabaseUrl + "/auth/v1/logout", { method: "POST", headers: H(s.access) }).catch(() => { }); }

const FAC = `<span class="facetas" aria-hidden="true"><i></i><i></i><i></i></span>`;
const pn = s => esc(String(s || "").split(" ")[0]);

/* ===== Entrada do RH ===== */
const emailSalvo = () => { try { return localStorage.getItem("acomp_email") || ""; } catch (e) { return ""; } };
const selo = () => DEMO ? `<span class="selo">DEMONSTRAÇÃO: pessoas fictícias, dados só neste aparelho</span>` : "";
function telaLogin(erro) {
  $app.innerHTML = `${selo()}<div class="login"><div class="login-arte">${FAC}<img class="marca" src="assets/marca/vertical-branco.png" alt="Metrocasa Construtora"><div><h1 aria-label="Mais perto de quem chega"><img src="assets/marca/mais-verde.png" alt="">perto de quem chega</h1><p>Acompanhamento dos primeiros 90 dias de cada consultor.</p></div></div>
  <form id="fl" novalidate><h2>Entrar</h2><p>Acesso do RH Comercial</p>
  <div class="campo"><label for="em">E-mail</label><input id="em" type="email" autocomplete="username" autocapitalize="none" value="${esc(emailSalvo() || (DEMO ? "rh@demonstracao.local" : ""))}"></div>
  <div class="campo"><label for="se">Senha</label><input id="se" type="password" autocomplete="current-password" ${DEMO ? 'placeholder="Qualquer senha na demonstração"' : ""}></div>
  <button class="btn">Entrar</button><div class="erro" id="er" role="alert">${esc(erro || "")}</div></form></div>`;
  document.getElementById("fl").onsubmit = async ev => { ev.preventDefault(); const b = ev.target.querySelector("button"), er = document.getElementById("er"), em = document.getElementById("em").value.trim(), se = document.getElementById("se").value; if (!em || !se) { er.textContent = "Informe e-mail e senha."; (em ? document.getElementById("se") : document.getElementById("em")).focus(); return; } b.disabled = true; b.classList.add("ocupado"); er.textContent = ""; try { await entrar(em, se); await enviaPendente(); perfil = await rpc("rh_perfil"); vai("hoje"); } catch (e) { rhS = null; er.textContent = e.rede ? msgErro(e) : e.message === "sem_permissao" ? ERROS.sem_permissao : "E-mail ou senha incorretos. Confira e tente de novo."; b.disabled = false; b.classList.remove("ocupado"); } };
}

/* ===== Área do RH ===== */
let perfil = null, rota = "hoje", dados = null, filtro = { t: "", g: "", d: "", s: "" }, fichaId = null;
const ROT = { a_fazer: "A fazer", atrasada: "Atrasada", realizada: "Realizada", em_andamento: "Em andamento", futura: "Ainda não abriu", nao_aplicavel: "Não se aplica", nao_realizada: "Não realizada" };
const ET = [15, 30, 60, 90];
const dias = (a, b) => Math.round((new Date(String(a).slice(0, 10) + "T12:00") - new Date(String(b).slice(0, 10) + "T12:00")) / 864e5);
const dataLonga = s => { const t = new Date(String(s).slice(0, 10) + "T12:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }); return t.charAt(0).toUpperCase() + t.slice(1); };
/* Trilha dos 90 dias: a mesma leitura visual no RH e no tablet */
const SIMB = { realizada: IC.check, atrasada: "!", nao_realizada: "×", agora: `<img src="assets/marca/mais-verde.png" alt="">` };
function trilha(etapas, o = {}) {
  const tipo = o.tipo || "mini", rot = o.rot || ROT;
  return `<ol class="trilha ${tipo}${o.clara ? " clara" : ""}" aria-label="${esc(o.rotulo || "Jornada de 90 dias")}">${etapas.map((e, i) => { const ant = etapas[i - 1], txt = `${e.etapa} dias: ${String(rot[e.status] || "").toLowerCase()}`;
    return `<li class="${e.status}${ant && ant.status === "realizada" ? " feito-antes" : ""}${o.foco === e.etapa ? " foco" : ""}"${tipo === "mini" ? ` title="${esc(txt)}"` : ""}><span class="pt" aria-hidden="true">${SIMB[e.status] || ""}</span>${tipo === "mini" ? `<span class="rt" aria-hidden="true">${e.etapa}</span><span class="sr">${esc(txt)}</span>` : o.info(e)}</li>`; }).join("")}</ol>`;
}
function prazo(e, hoje) {
  if (e.status === "em_andamento") return ["andamento", "Em andamento"];
  if (e.status === "atrasada") { const n = dias(hoje, e.fim); return ["atraso", `Atrasada há ${n} ${n === 1 ? "dia" : "dias"}`]; }
  if (e.status === "a_fazer") { const n = dias(e.fim, hoje); return n <= 0 ? ["hoje", "Vence hoje"] : n === 1 ? ["hoje", "Vence amanhã"] : ["", `Faltam ${n} dias`]; }
  if (e.status === "futura") return ["", `Abre em ${dtc(e.inicio)}`];
  return ["", ROT[e.status]];
}
/* Cada seção tem sua cor: vermelho para o dia e a pessoa, azul para a equipe, vinho para alertas, verde para o tablet */
const TOM = { hoje: "vermelho", consultores: "azul", ficha: "vermelho", alertas: "vinho", tablet: "verde" }, TIT = { hoje: "Hoje", consultores: "Consultores", ficha: "Ficha", alertas: "Alertas", tablet: "Tablet" };
let ultRota = null;
function casca(html, o = {}) {
  const n = dados ? dados.alertas_abertos : 0, ab = [["hoje", "Hoje"], ["consultores", "Consultores"], ["alertas", "Alertas"], ["tablet", "Tablet"]], entra = !o.esq && rota !== ultRota;
  if (!o.esq) ultRota = rota;
  $app.innerHTML = `<div class="rh">${selo()}<header class="banda t-${o.tom || TOM[rota] || "vermelho"}">${FAC}<div class="topo"><img class="marca" src="assets/logos/horizontal-branco.png" alt="Metrocasa Construtora"><nav class="abas" aria-label="Seções">${ab.map(([k, t]) => { const on = rota === k || (rota === "ficha" && k === "consultores"); return `<button data-r="${k}" class="${on ? "on" : ""}"${on ? ' aria-current="page"' : ""}>${t}${k === "alertas" && n ? `<span class="num">${n}<span class="sr"> abertos</span></span>` : ""}</button>`; }).join("")}</nav><div class="eu">${esc(perfil.nome)}</div><button class="sair" data-a="sair">Sair</button></div>
  <div class="cab"><div>${o.voltar || ""}<h1>${o.titulo || TIT[rota] || ""}</h1>${o.sub ? `<p class="sub">${o.sub}</p>` : ""}</div>${o.lado ? `<div class="lado">${o.lado}</div>` : ""}</div></header><main class="pag${entra ? " entra" : ""}">${banner()}${html}</main></div>`;
  if (entra && !$modal.innerHTML) focaTit("header h1");
}
const banner = () => F ? `<div class="cartao retomar"><div class="tx"><b>${F.pendente ? `Respostas de ${esc(F.nome)} aguardando envio` : `${esc(F.nome)} tem um preenchimento em andamento`}</b><div class="muted peq">Etapa de ${F.etapa} dias. ${F.pendente ? "Elas estão guardadas neste tablet." : "As respostas já dadas estão guardadas."}</div>${F.erro ? `<div class="erro">O servidor recusou o envio. Fale com o responsável pelo sistema.</div>` : ""}</div><div class="mt"><button class="btn claro peq" data-a="retomar">${F.pendente ? "Tentar enviar" : "Devolver à pessoa"}</button><button class="btn sec peq" data-a="encerrar">Liberar o tablet</button></div></div>` : "";
const carregando = () => casca(`<div class="esq" aria-busy="true" aria-label="Carregando"><div class="k"><i></i><i></i><i></i><i></i></div><i class="l"></i><i class="l"></i><i class="l"></i></div>`, { esq: true });
async function vai(r, arg) { rota = r; if (r === "ficha") fichaId = arg; window.scrollTo(0, 0); fechaM(true); carregando(); try { await desenha(); } catch (e) { if (e.status === 401 || e.message === "sem_permissao") { await sairRH(); telaLogin("Sua sessão terminou. Entre novamente."); } else casca(`<div class="painel"><div class="vazio"><b>Não deu para carregar</b>${esc(msgErro(e))}<br><button class="btn sec peq" data-r="${r}">Tentar novamente</button></div></div>`); } }
async function desenha() {
  if (rota === "tablet") { dados = dados || await rpc("rh_painel"); return vTablet(); } dados = await rpc("rh_painel");
  if (rota === "hoje") return vHoje(); if (rota === "consultores") return vCons(); if (rota === "alertas") return vAlertas(await rpc("rh_alertas")); if (rota === "ficha") return vFicha(await rpc("rh_ficha", { p_jornada: fichaId }));
}
const tudo = () => dados.jornadas.flatMap(j => j.etapas.map(e => ({ j, e })));
function vHoje() {
  const pz = (a, b) => a.e.fim < b.e.fim ? -1 : 1, l = tudo(), af = l.filter(x => x.e.status === "a_fazer").sort(pz), at = l.filter(x => x.e.status === "atrasada").sort(pz), an = l.filter(x => x.e.status === "em_andamento");
  const linha = (x, i, prox) => { const { j, e } = x, [tom, txt] = prazo(e, dados.hoje); return `<div class="item${prox && i === 0 ? " proxima" : ""}"><div class="tx">${prox && i === 0 ? `<span class="selo-prox"><img src="assets/marca/mais-verde.png" alt="">Próxima</span>` : ""}<span class="nome">${esc(j.nome)}</span><div class="meta">Etapa de ${e.etapa} dias · ${esc(j.gerente || "Sem gerente")}</div></div>${trilha(j.etapas, { foco: e.etapa, rotulo: "Jornada de " + j.nome })}<span class="prazo ${tom}">${txt}</span><div class="acoes"><button class="btn sec peq" data-f="${j.jornada_id}">Ficha</button><button class="btn peq" data-ap="${j.jornada_id}|${e.etapa}">${e.status === "em_andamento" ? "Continuar" : `Aplicar ${e.etapa} dias`}</button></div></div>`; };
  const kpi = (n, txt, alvo, cor) => n ? `<button class="kpi ${cor}" ${alvo}><b>${n}</b><span>${txt}</span></button>` : `<div class="kpi zero"><b>0</b><span>${txt}</span></div>`;
  const prox = l.filter(x => x.e.status === "futura").sort((a, b) => a.e.inicio < b.e.inicio ? -1 : 1)[0];
  /* Próximo passo calculado a partir dos dados do dia */
  const fala = an.length ? [`${pn(an[0].j.nome)} começou a responder e parou no meio. Dá para continuar de onde ficou.`, "dica"]
    : af.length ? [`${af.length === 1 ? "Tem uma pessoa" : `São ${af.length} pessoas`} para ouvir. Comece por ${pn(af[0].j.nome)}: ${prazo(af[0].e, dados.hoje)[1].toLowerCase()}.`, "dica"]
    : at.length ? [`${at.length === 1 ? `A etapa de ${pn(at[0].j.nome)} passou` : `${at.length} etapas passaram`} da janela. Ainda dá para aplicar.`, "atencao"]
    : [`Tudo em dia por aqui!${prox ? ` A próxima janela abre em ${dtc(prox.e.inicio)}.` : ""}`, "comemora"];
  const h = new Date().getHours(), saud = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const vazio = `<div class="vazio"><b>Ninguém na janela hoje</b>${prox ? `A próxima abre em ${dtc(prox.e.inicio)}: ${esc(prox.j.nome)}, etapa de ${prox.e.etapa} dias.` : "Quando alguém entrar na janela de 15, 30, 60 ou 90 dias, aparece aqui."}</div>`;
  casca(`<div class="kpis">${kpi(af.length, "Para aplicar", 'data-ir="s-af"', "k-verde")}${kpi(at.length, "Atrasadas", 'data-ir="s-at"', "k-verm")}${kpi(an.length, "Em andamento", 'data-ir="s-an"', "k-azul")}${kpi(dados.alertas_abertos, "Alertas abertos", 'data-r="alertas"', "k-branco")}</div>
  ${an.length ? `<h2 id="s-an"><i class="bolinha b-azul"></i>Continue de onde parou</h2><div class="painel"><div class="lista">${an.map((x, i) => linha(x, i)).join("")}</div></div>` : ""}
  <h2 id="s-af"><i class="bolinha b-verde"></i>Para aplicar agora ${af.length ? `<small>pelo prazo mais curto</small>` : ""}</h2><div class="painel"><div class="lista">${af.map((x, i) => linha(x, i, !an.length)).join("") || vazio}</div></div>
  ${at.length ? `<h2 id="s-at"><i class="bolinha b-verm"></i>Atrasadas <small>ainda podem ser aplicadas, fora da janela</small></h2><div class="painel"><div class="lista">${at.map((x, i) => linha(x, i)).join("")}</div></div>` : ""}`,
  { titulo: `${saud}, ${pn(perfil.nome)}`, sub: dataLonga(dados.hoje), lado: `<div class="proximo ${fala[1]}"><b>Próximo passo</b><p>${fala[0]}</p></div>` });
}
function vCons() {
  const uni = k => [...new Set(dados.jornadas.map(j => j[k]).filter(Boolean))].sort(), op = (l, v) => l.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  const leg = ["realizada", "a_fazer", "em_andamento", "atrasada", "futura", "nao_realizada", "nao_aplicavel"].map(s => `<li><span class="trilha" aria-hidden="true"><span class="${s}"><span class="pt">${SIMB[s] || ""}</span></span></span>${ROT[s]}</li>`).join("");
  casca(`<div class="filtros"><div class="bus">${IC.busca}<input id="ft" type="search" placeholder="Buscar por nome ou apelido" aria-label="Buscar por nome ou apelido" value="${esc(filtro.t)}"></div><select id="fg" aria-label="Gerente"><option value="">Todos os gerentes</option>${op(uni("gerente"), filtro.g)}</select><select id="fd" aria-label="Diretoria"><option value="">Todas as diretorias</option>${op(uni("diretor"), filtro.d)}</select><select id="fs" aria-label="Situação"><option value="">Todas as situações</option>${["a_fazer", "atrasada", "em_andamento"].map(k => `<option value="${k}" ${filtro.s === k ? "selected" : ""}>${ROT[k]}</option>`).join("")}</select></div><p class="contagem" id="ct" aria-live="polite"></p><ul class="legenda" aria-label="Legenda da jornada">${leg}</ul><div id="tb"></div>${perfil.papel === "admin" ? `<div class="mt"><button class="btn sec peq" data-a="exportar">Exportar respostas (CSV)</button></div>` : ""}`,
  { sub: "Jornadas dos primeiros 90 dias" });
  const pinta = () => { const nk = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(), t = nk(filtro.t), l = dados.jornadas.filter(j => (!t || nk(j.nome + " " + j.apelido).includes(t)) && (!filtro.g || j.gerente === filtro.g) && (!filtro.d || j.diretor === filtro.d) && (!filtro.s || j.etapas.some(e => e.status === filtro.s)));
    document.getElementById("ct").textContent = `${l.length} ${l.length === 1 ? "pessoa" : "pessoas"}${l.length !== dados.jornadas.length ? ` de ${dados.jornadas.length}` : ""}`;
    document.getElementById("tb").innerHTML = l.length ? `<div class="tab"><table><thead><tr><th>Consultor</th><th>Gerente</th><th>Entrada</th><th>Jornada: 15, 30, 60 e 90 dias</th></tr></thead><tbody>${l.map(j => `<tr class="lk" data-f="${j.jornada_id}"><td><button class="nm" data-f="${j.jornada_id}">${esc(j.nome)}</button><div class="muted peq">${j.dias} dias de casa</div></td><td>${esc(j.gerente)}</td><td>${dtc(j.entrada)}</td><td>${trilha(j.etapas, { rotulo: "Jornada de " + j.nome })}</td></tr>`).join("")}</tbody></table></div>` : `<div class="painel"><div class="vazio"><b>Ninguém encontrado</b>Tente outro nome ou limpe os filtros.<br><button class="btn sec peq" data-a="limpa">Limpar filtros</button></div></div>`; };
  pinta(); const liga = (id, k) => document.getElementById(id).oninput = ev => { filtro[k] = ev.target.value; pinta(); }; liga("ft", "t"); liga("fg", "g"); liga("fd", "d"); liga("fs", "s");
}
const SIN = { C: "Crítico", A: "Atenção" }, COMUNS = ["SUP", "C_FALTA", "FEED", "MESA", "C_MESA", "PERM", "C_MOTIVO", "LEADS", "GANHOS", "RETOMA", "OBS"];
let fichaAtual = null;
function vFicha(f) {
  fichaAtual = f; const linhas = []; f.etapas.forEach(e => e.respostas.forEach(r => { const k = COMUNS.includes(r.chave) ? r.chave : r.pergunta_id; let l = linhas.find(x => x.k === k); if (!l) { l = { k, chave: r.chave, texto: r.texto, c: {} }; linhas.push(l); } l.c[e.etapa] = r; }));
  const comuns = COMUNS.map(k => linhas.find(l => l.k === k)).filter(Boolean), proprias = linhas.filter(l => !COMUNS.includes(l.k));
  const cel = (e, r) => !r ? "" : `<button class="cel" ${r.chave === "OBS" ? "disabled" : `data-c="${e.avaliacao_id}|${r.pergunta_id}"`}>${esc(r.alternativa || "")}${r.livre ? `<small>“${esc(r.livre)}”</small>` : ""}${SIN[r.sinal] ? `<span class="sinal ${r.sinal}">${r.sinal === "C" ? "▲ " : "• "}${SIN[r.sinal]}</span>` : ""}${r.corrigida ? `<small>Corrigida pelo RH</small>` : ""}</button>`;
  const lin = l => `<tr class="${l.chave.startsWith("C_") ? "cond" : ""}"><td>${esc(l.texto)}</td>${f.etapas.map(e => `<td>${cel(e, l.c[e.etapa])}</td>`).join("")}</tr>`;
  const stTxt = e => ({ realizada: `Realizada${e.enviada_em ? " em " + dtc(e.enviada_em) : ""}`, a_fazer: `A fazer até ${dtc(e.fim)}`, atrasada: `Janela terminou em ${dtc(e.fim)}`, futura: `Abre em ${dtc(e.inicio)}` })[e.status] || ROT[e.status];
  const acs = e => ["a_fazer", "atrasada", "em_andamento"].includes(e.status) ? `<div class="acs"><button class="btn peq" data-ap="${f.jornada_id}|${e.etapa}">${e.status === "em_andamento" ? "Continuar" : "Aplicar"}</button><button class="btn txt peq" data-nr="${e.etapa}" aria-label="Marcar a etapa de ${e.etapa} dias como não realizada">Não realizada</button></div>` : "";
  const info = e => `<div class="info"><b>${e.etapa} dias</b><span class="st${e.status === "atrasada" ? " atraso" : ""}">${stTxt(e)}</span>${e.criticas ? `<span class="sinal C">${e.criticas} ${e.criticas === 1 ? "crítica" : "críticas"}</span>` : ""}${e.atencao ? `<span class="sinal A">${e.atencao} de atenção</span>` : ""}${e.gerente && e.gerente !== f.gerente ? `<span class="st">Gerente na época: ${esc(e.gerente)}</span>` : ""}${e.motivo ? `<span class="st">${esc(e.motivo)}</span>` : ""}${acs(e)}</div>`;
  casca(`<div class="jornada">${trilha(f.etapas, { tipo: "grande", rotulo: "Jornada de " + f.nome, info })}</div>
  <h2><i class="bolinha b-verm"></i>Respostas por etapa</h2><div class="tab"><table class="cmp"><thead><tr><th>Pergunta</th>${f.etapas.map(e => `<th>${e.etapa} dias</th>`).join("")}</tr></thead><tbody>${comuns.map(lin).join("")}${proprias.map(lin).join("")}${linhas.length ? "" : `<tr><td colspan="5" class="muted">Ainda não há respostas. Elas aparecem aqui depois do primeiro preenchimento.</td></tr>`}</tbody></table></div>
  <p class="nota">${IC.info}<span>Atenção e Crítico são pontos para o RH avaliar, não uma conclusão sobre a pessoa. Toque em uma resposta para corrigi-la.</span></p>
  <h2><i class="bolinha b-azul"></i>Observações do RH</h2><div class="painel"><div class="nova-obs"><label for="ob">Registrar a conversa ou uma observação</label><textarea id="ob" maxlength="4000" placeholder="O que foi conversado, combinado ou observado"></textarea><button class="btn peq" data-a="obs">Salvar observação</button></div>${f.observacoes.map(o => `<div class="obs">${esc(o.texto)}<div class="muted peq">${esc(o.autor || "")} · ${dt(o.em)}${o.etapa ? ` · ${o.etapa} dias` : ""}</div></div>`).join("")}</div>`,
  { titulo: esc(f.nome), voltar: `<button class="voltar" data-r="consultores">${IC.volta}Consultores</button>`, sub: `${esc(f.gerente || "Sem gerente")}${f.superintendente ? ", " + esc(f.superintendente) : ""}. Entrou em ${dt(f.entrada)}, ${f.dias} dias de casa.` });
}
const TIPO = { resposta_critica: "Resposta crítica", comentario: "Comentário", revisar_coerencia: "Revisar" };
function vAlertas(l) {
  const ab = l.filter(a => a.status === "aberto"), tr = l.filter(a => a.status !== "aberto"); dados.alertas_abertos = ab.length;
  const it = a => `<div class="item alerta ${a.status === "aberto" ? a.tipo : ""}"><div class="tx"><span class="chip ${a.status === "aberto" ? a.tipo : "tratado"}">${a.status === "aberto" ? TIPO[a.tipo] : "Tratado"}</span><span class="nome">${esc(a.nome)}</span><div class="meta">Etapa de ${a.etapa} dias${a.gerente ? " · " + esc(a.gerente) : ""}</div><div class="desc">${esc(a.descricao)}</div>${a.nota ? `<div class="muted peq">Nota do RH: ${esc(a.nota)}</div>` : ""}</div><div class="acoes"><button class="btn sec peq" data-f="${a.jornada_id}">Ficha</button>${a.status === "aberto" ? `<button class="btn peq" data-tr="${a.id}">Marcar como tratado</button>` : ""}</div></div>`;
  casca(`<div class="painel"><div class="lista">${ab.map(it).join("") || `<div class="vazio"><b>Nenhum alerta aberto</b>Tudo o que apareceu já foi tratado.</div>`}</div></div>
  ${tr.length ? `<details class="tratados"><summary>${IC.seta}Tratados (${tr.length})</summary><div class="painel"><div class="lista">${tr.map(it).join("")}</div></div></details>` : ""}`,
  { sub: ab.length ? `${ab.length} ${ab.length === 1 ? "ponto pede" : "pontos pedem"} leitura ou conversa do RH` : "Pontos que pedem leitura ou conversa do RH" });
}
function vTablet() {
  const P = { ipad: ["iPad", ["Abra este endereço no Safari.", "Toque em Compartilhar e em “Adicionar à Tela de Início”.", "Abra o app Acompanhamento pelo novo ícone.", "Em Ajustes > Acessibilidade, ative “Acesso Guiado”.", "Com o app aberto, clique três vezes no botão lateral e inicie o Acesso Guiado."]], android: ["Android", ["Abra este endereço no Chrome.", "Toque em “Instalar aplicativo” abaixo ou no menu ⋮ > Instalar aplicativo.", "Abra o app Acompanhamento pelo novo ícone.", "Em Configurações > Segurança, ative “Fixar app”.", "Abra os apps recentes, toque no ícone do Acompanhamento e escolha “Fixar”."]], outro: ["este aparelho", ["Abra este endereço no tablet para ver o passo a passo do iPad ou do Android."]] }[PLAT];
  casca(`<div class="cartao"><h3>Preparar este tablet</h3><ol class="passos">${P[1].map(x => `<li>${esc(x)}</li>`).join("")}</ol>${pedidoInstalar ? `<button class="btn peq" data-a="instalar">Instalar aplicativo</button>` : ""}</div><div class="cartao"><h3>Atualizações</h3><p class="muted">O site baixa novas versões sozinho e nunca recarrega durante um preenchimento.</p></div>${DEMO ? `<button class="btn sec peq" data-a="reset">Reiniciar demonstração</button>` : ""}<p class="rodape">Versão ${esc(VER)}</p>`,
  { sub: `Aparelho reconhecido: ${P[0]}, ${INSTALADO() ? "instalado como aplicativo" : "aberto no navegador"}` });
}
let focoAntes = null;
const fechaM = forcar => { if (!$modal.innerHTML || (forcar !== true && $modal.querySelector(".ocupado"))) return; $modal.innerHTML = ""; if (focoAntes && document.contains(focoAntes)) focoAntes.focus(); focoAntes = null; };
function modal(html) { focoAntes = document.activeElement; $modal.innerHTML = `<div class="fundo-m"><div class="janela" role="dialog" aria-modal="true" aria-labelledby="mt">${html}</div></div>`; const h = $modal.querySelector("h2"); if (h) h.id = "mt"; const f = $modal.querySelector("input,textarea,select") || $modal.querySelector("[data-a=fecha]"); if (f) f.focus(); return $modal.firstChild; }
const erMsg = t => { const e = document.getElementById("er"); if (e) e.textContent = t; };
const focaTit = sel => { const h = $app.querySelector(sel); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } };
const ocupa = (b, s) => { if (!b) return; b.disabled = s; b.classList.toggle("ocupado", s); };
function confirmaAplicar(jid, et) {
  const j = dados.jornadas.find(x => x.jornada_id === jid), e = j.etapas.find(x => x.etapa === et), fora = ["futura", "atrasada"].includes(e.status);
  if (F) return avisa("Conclua ou libere o preenchimento em andamento primeiro.", "erro");
  modal(`<h2>Entregar o tablet a ${esc(j.nome)}?</h2><div class="destaque">${trilha(j.etapas, { foco: et, rotulo: "Jornada de " + j.nome })}<div><b>Etapa de ${et} dias</b><div class="muted peq">${fora ? `Fora da janela, que era de ${dtc(e.inicio)} a ${dtc(e.fim)}` : `Dentro da janela, até ${dtc(e.fim)}`}</div></div></div><p>Confira se é a pessoa certa antes de entregar.</p><p class="muted peq">Depois de iniciar, a área do RH fica bloqueada até alguém do RH digitar a senha.</p><div class="bts"><button class="btn txt" data-a="fecha">Cancelar</button><button class="btn" id="go">Iniciar e entregar</button></div><div class="erro" id="er" role="alert"></div>`);
  document.getElementById("go").onclick = async ev => { const bt = ev.currentTarget; ocupa(bt, true); try { const s = await rpc("rh_iniciar", { p_jornada: jid, p_etapa: et, p_dispositivo: DISPOSITIVO(), p_fora: fora }); F = { token: s.token, avaliacao_id: s.avaliacao_id, etapa: s.etapa, nome: s.primeiro_nome, perguntas: s.perguntas, r: {}, seq: 0, sujo: {}, fase: "aviso", atual: null, inicio: Date.now(), revendo: false }; (s.respostas || []).forEach(x => { F.r[x.q] = { a: x.a, t: x.t, s: x.s }; F.seq = Math.max(F.seq, x.s || 0); }); await guardaF(); await filaGrava; await sairRH(); perfil = null; dados = null; focoAntes = null; fechaM(true); tela(); } catch (e) { erMsg(msgErro(e)); ocupa(bt, false); } };
}
function dlgCorrige(av, q) { const r = fichaAtual.etapas.flatMap(e => e.respostas).find((x, i, a) => x.pergunta_id === q); modal(`<h2>Corrigir resposta</h2><p>${esc(r.texto)}</p><div class="campo"><label for="ca">Resposta correta</label><select id="ca">${r.opcoes.map(o => `<option value="${o.id}" ${o.id === r.alternativa_id ? "selected" : ""}>${esc(o.texto)}</option>`).join("")}</select></div><div class="campo"><label for="cm">Motivo da correção</label><textarea id="cm"></textarea></div><p class="muted peq">A resposta original fica guardada no histórico.</p><div class="bts"><button class="btn txt" data-a="fecha">Cancelar</button><button class="btn" id="go">Salvar correção</button></div><div class="erro" id="er" role="alert"></div>`); document.getElementById("go").onclick = async ev => { const bt = ev.currentTarget; ocupa(bt, true); try { await rpc("rh_corrigir", { p_avaliacao: av, p_pergunta: q, p_alternativa: document.getElementById("ca").value, p_motivo: document.getElementById("cm").value }); focoAntes = null; await vai("ficha", fichaId); avisa("Correção registrada.", "ok"); } catch (e) { erMsg(msgErro(e)); ocupa(bt, false); } }; }
function dlgTexto(tit, rot, fn, obrig, botao = "Salvar") { modal(`<h2>${esc(tit)}</h2><div class="campo"><label for="tx">${esc(rot)}</label><textarea id="tx"></textarea></div><div class="bts"><button class="btn txt" data-a="fecha">Cancelar</button><button class="btn" id="go">${esc(botao)}</button></div><div class="erro" id="er" role="alert"></div>`); document.getElementById("go").onclick = async ev => { const bt = ev.currentTarget, v = document.getElementById("tx").value; if (obrig && !v.trim()) { document.getElementById("er").textContent = "Preencha este campo."; document.getElementById("tx").focus(); return; } ocupa(bt, true); try { focoAntes = null; await fn(v); } catch (e) { erMsg(msgErro(e)); ocupa(bt, false); } }; }
async function exportar() { try { const l = await rpc("rh_exportar"), C = ["nome", "apelido", "entrada", "etapa", "enviada_em", "gerente", "superintendente", "diretor", "pergunta_id", "pergunta", "resposta", "complemento", "sinal", "versao"], c = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; const csv = "﻿USO INTERNO\r\n" + C.join(";") + "\r\n" + l.map(r => C.map(k => c(r[k])).join(";")).join("\r\n"), a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `acompanhamento_respostas_${dados.hoje}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); avisa(`Arquivo baixado com ${l.length} respostas.`, "ok"); } catch (e) { avisa(msgErro(e), "erro"); } }

/* ===== Preenchimento pelo consultor ===== */
let F = null, timerSync = null, inatividade = null, pausado = false, travaTela = null;
const vis = q => { const g = q.gatilho; if (!g || g.retomada) return true; return g.qualquer.some(c => F.r[c.q] && c.em.includes(F.r[c.q].a)); };
const visiveis = () => F.perguntas.filter(vis), unicaFalta = () => visiveis().find(q => q.tipo === "unica" && !(F.r[q.id] && F.r[q.id].a));
const pq = id => F.perguntas.find(q => q.id === id);
const marca = (id, a, t) => { F.seq++; F.r[id] = { a, t: t ?? null, s: F.seq, em: new Date().toISOString() }; F.sujo[id] = 1; };
function limpaOcultas() { F.perguntas.forEach(q => { if (!vis(q) && F.r[q.id] && F.r[q.id].a) marca(q.id, null, null); }); }
const itensDe = ids => ids.map(q => ({ q, a: F.r[q].a, t: F.r[q].t, s: F.r[q].s, em: F.r[q].em }));
async function sincroniza() { if (!F || F.fase === "fim" || !Object.keys(F.sujo).length) return; const ids = Object.keys(F.sujo), seqs = ids.map(i => F.r[i].s); try { await rpc("tab_salvar", { p_token: F.token, p_itens: itensDe(ids) }, true); ids.forEach((i, n) => { if (F && F.r[i].s === seqs[n]) delete F.sujo[i]; }); if (F) guardaF(); rede(true); } catch (e) { rede(!e.rede); } }
function rede(ok) { const r = document.getElementById("rede"); if (r) r.textContent = ok ? "" : "Sem internet. Suas respostas estão guardadas e serão enviadas depois."; }
const salvaAgora = () => { guardaF(); clearTimeout(timerSync); timerSync = setTimeout(sincroniza, 250); };
let ultPct = 0, ultQ = null, sentido = 1;
function topoF(pct) {
  pct = pct || 0; const ant = ultPct; ultPct = pct;
  queueMicrotask(() => document.querySelectorAll("[data-p]").forEach(e => { e.style.width = ant + "%"; e.getBoundingClientRect(); e.style.width = e.dataset.p + "%"; e.classList.toggle("cheia", +e.dataset.p >= 100); }));
  return `${selo()}<div class="f-banda">${FAC}${topoMarca()}<div class="barra" role="progressbar" aria-label="Progresso do preenchimento" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i data-p="${pct}"><span class="ponta"><img src="assets/marca/mais-verde.png" alt=""></span></i></div></div>`;
}
const topoMarca = () => `<div class="f-top"><img src="assets/marca/casinha-branca.png" alt="Metrocasa"><span class="et">${F ? `Acompanhamento de ${F.etapa} dias` : "Acompanhamento"}</span><button class="rhb" data-a="desbloq" aria-label="Acesso do RH">RH</button></div>`;
function tela() { if (!F) { return telaFim(true); } liga(); if (F.fase === "aviso") return tAviso(); if (F.fase === "perguntas") return tPerg(); if (F.fase === "revisao") return tRev(); return telaFim(!F.pendente); }
function tAviso() {
  const n = visiveis().length, min = Math.max(2, Math.round(n * 13 / 60)), passos = ET.map(et => ({ etapa: et, status: et < F.etapa ? "passou" : et === F.etapa ? "agora" : "futura" }));
  const trilhaF = trilha(passos, { tipo: "grande", clara: true, rotulo: `Você está na etapa de ${F.etapa} dias`, info: e => `<div class="info"><b>${e.etapa} dias</b>${e.status === "agora" ? `<span class="st">Você está aqui</span>` : ""}</div>` });
  $app.innerHTML = `<div class="boas">${FAC}${selo()}${topoMarca()}<div class="boas-c"><div><h1>Olá, ${esc(F.nome)}!</h1><p class="lead">Este é o seu acompanhamento de <b>${F.etapa} dias</b> na Metrocasa. São cerca de ${n} perguntas rápidas, uns ${min} minutos. Não existe resposta certa: conte como está sendo de verdade.</p>${trilhaF}</div>
  <div class="lado"><p class="conf">Este acompanhamento é conduzido pelo RH Comercial. Suas respostas são confidenciais, mas não anônimas: o RH saberá quem respondeu. Seu gerente não tem acesso às suas respostas individuais. Se algo exigir proteção de pessoas ou providência obrigatória, o RH poderá agir.</p><button class="btn claro" data-a="comecar">Começar</button></div></div></div>`;
}
function tPerg() {
  const l = visiveis(); let q = pq(F.atual); if (!q || !vis(q)) { q = l[0]; F.atual = q.id; } const n = l.indexOf(q) + 1, r = F.r[q.id] || {}, op = q.alternativas.find(a => a.id === r.a), mostra = op && op.livre;
  const nova = q.id !== ultQ; ultQ = q.id;
  const corpo = q.tipo === "texto" ? `<div class="ops"><textarea id="lv" maxlength="1000" aria-labelledby="qt" placeholder="Opcional. Escreva o que quiser contar ao RH.">${esc(r.t || "")}</textarea></div>` : `<div class="ops" role="radiogroup" aria-labelledby="qt">${q.alternativas.map(a => `<button class="op" role="radio" aria-checked="${a.id === r.a}" tabindex="${a.id === r.a || (!r.a && a === q.alternativas[0]) ? 0 : -1}" data-op="${a.id}"><i>${IC.check}</i>${esc(a.texto)}</button>`).join("")}${mostra ? `<div class="livre"><label for="lv">Conte em poucas palavras</label><input id="lv" maxlength="300" value="${esc(r.t || "")}"></div>` : ""}</div>`;
  /* Perguntas condicionais aumentam o total no caminho: a barra nunca recua enquanto a pessoa avança e o contador não promete um total que pode mudar */
  const gatilho = F.perguntas.some(p => p.gatilho && p.gatilho.qualquer && p.gatilho.qualquer.some(c => c.q === q.id)), ultima = n === l.length && !gatilho, base = Math.round((n - 1) / l.length * 100), pct = F.revendo ? 100 : sentido > 0 ? Math.max(base, ultPct) : base;
  $app.innerHTML = `<div class="f">${topoF(pct)}<div class="f-c"><div class="q${nova ? (sentido > 0 ? " vai" : " volta") : ""}"><div><div class="cnt${ultima ? " fim" : ""}">${ultima ? "Última pergunta" : l.length - n <= 2 ? `Pergunta ${n}. Falta pouco` : `Pergunta ${n}`}</div>${q.contexto ? `<p class="ctx">Antes, você apontou: <b>${esc(q.contexto)}</b></p>` : ""}<h1 id="qt">${esc(q.texto)}</h1></div>${corpo}</div></div><div class="rede" id="rede" role="status"></div><div class="f-b"><button class="btn txt" data-a="volta" ${n === 1 && !F.revendo ? "disabled" : ""}>${IC.volta.replace("<svg", '<svg width="20" height="20"')}Voltar</button>${q.tipo === "texto" || mostra ? `<button class="btn" data-a="segue">${ultima && !F.revendo ? "Conferir respostas" : "Continuar"}</button>` : ""}</div></div>`;
  sentido = 1; rede(navigator.onLine); if (nova) focaTit("#qt");
}
function guardaLivre() { const e = document.getElementById("lv"); if (!e || !F.atual) return; const r = F.r[F.atual] || {}, v = e.value.trim(); if ((r.t || "") !== v) { marca(F.atual, r.a ?? null, v || null); } }
function avanca() { guardaLivre(); limpaOcultas(); const l = visiveis(), i = l.findIndex(q => q.id === F.atual); let prox; if (F.revendo) { prox = l.find(q => q.tipo === "unica" && !(F.r[q.id] && F.r[q.id].a)); } else prox = l[i + 1]; if (prox) { F.atual = prox.id; F.fase = "perguntas"; } else { F.fase = "revisao"; F.revendo = false; } salvaAgora(); tela(); window.scrollTo(0, 0); }
function tRev() { ultQ = null; const l = visiveis().filter(q => F.r[q.id] && (F.r[q.id].a || F.r[q.id].t)); $app.innerHTML = `<div class="f">${topoF(100)}<div class="f-c"><div class="rev-topo vai"><div class="rev-h"><div>${unicaFalta() ? "" : `<div class="cnt fim">Tudo respondido</div>`}<h1>Confira antes de enviar</h1><p class="muted">Toque em uma resposta se quiser mudar.</p></div></div></div><div class="rev">${l.map(q => { const r = F.r[q.id], a = q.alternativas.find(x => x.id === r.a), txt = (a ? a.texto : r.t) + (a && r.t ? ": " + r.t : ""); return `<button data-ed="${q.id}" aria-label="${esc(`Alterar: ${q.texto} Resposta atual: ${txt}`)}"><span>${esc(q.texto)}</span><b>${esc(txt)}</b>${IC.lapis}</button>`; }).join("")}</div></div><div class="rede" id="rede" role="status"></div><div class="f-b"><button class="btn txt" data-a="volta">${IC.volta.replace("<svg", '<svg width="20" height="20"')}Voltar</button><button class="btn" data-a="enviar">Enviar respostas</button></div></div>`; rede(navigator.onLine); }
async function enviar(b) {
  ocupa(b, true); limpaOcultas(); const falta = unicaFalta(); if (falta) { F.atual = falta.id; F.fase = "perguntas"; F.revendo = true; return tela(); }
  F.fase = "fim"; F.pendente = true; await guardaF(); await filaGrava; await tentaEnvio(); tela();
}
async function tentaEnvio() { if (!F || !F.pendente) return true; const copia = F; try { await rpc("tab_enviar", { p_token: copia.token, p_itens: itensDe(Object.keys(copia.r)), p_segundos: Math.round((Date.now() - copia.inicio) / 1000) }, true); if (!rhS) nomeFim = copia.nome; await apagaF(); if (!rhS) await kv("put", "bloqueado", true); return true; } catch (e) { if (!e.rede) { if (String(e.message).startsWith("incompleta:")) { const id = e.message.split(":")[1].split(",")[0]; if (pq(id)) { F.fase = "perguntas"; F.atual = id; F.revendo = true; F.pendente = false; await guardaF(); } } else { F.erro = e.message; await guardaF(); } } return false; } }
const enviaPendente = async () => { if (F && F.pendente) await tentaEnvio(); };
let nomeFim = null;
function telaFim(ok) { solta(); ultPct = 0; ultQ = null; const festa = ok && nomeFim; nomeFim = null;
  const marca = ok ? `<svg class="selo-fim" viewBox="0 0 112 112" aria-hidden="true"><circle cx="56" cy="56" r="56"/><path d="M34 58l15 15 30-32"/></svg>` : `<svg class="selo-fim pend" viewBox="0 0 112 112" aria-hidden="true"><circle cx="56" cy="56" r="56"/><path d="M56 34v24l15 9"/></svg>`;
  const confete = festa && !MENOS_MOV() ? `<div class="confete" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => `<i class="c${i % 3 + 1}"></i>`).join("")}</div>` : "";
  $app.innerHTML = `<div class="fim-tela${ok ? "" : " pend"}">${FAC}${confete}${selo()}${topoMarca()}<div class="fim-c" role="status">${marca}<h1>${ok ? "Respostas enviadas!" : "Respostas guardadas no tablet"}</h1><p>${ok ? "Obrigado por contar como está sendo sua experiência." : "Elas serão enviadas sozinhas assim que a internet voltar. Não precisa responder de novo."}</p><div class="devolva">${IC.tablet}Agora, entregue o tablet ao RH</div></div></div>`;
  $app.querySelectorAll(".confete i").forEach(e => { const a = Math.random() * Math.PI * 2, d = 160 + Math.random() * 340; e.style.setProperty("--dx", Math.cos(a) * d + "px"); e.style.setProperty("--dy", Math.sin(a) * d - 60 + "px"); e.style.setProperty("--rot", Math.round(Math.random() * 720 - 360) + "deg"); e.style.animationDelay = Math.round(Math.random() * 140) + "ms"; });
  if (!ok && !F.espera) { F.espera = 1; const t = setInterval(async () => { if (!F || !F.pendente) { clearInterval(t); if (!F && !rhS) tela(); return; } if (await tentaEnvio()) { clearInterval(t); if (!rhS) tela(); } }, 8000); }
}
function dlgDesbloq() {
  modal(`<h2>Acesso do RH</h2><p class="muted">${F && F.fase !== "fim" ? "O preenchimento fica guardado e pode continuar depois." : "Digite sua senha para voltar à área do RH."}</p><form id="fd" novalidate><div class="campo"><label for="em2">E-mail</label><input id="em2" type="email" autocapitalize="none" autocomplete="off" value="${esc(emailSalvo())}"></div><div class="campo"><label for="se2">Senha</label><input id="se2" type="password" autocomplete="off"></div><div class="bts"><button type="button" class="btn txt" data-a="fecha">Cancelar</button><button class="btn" id="go">Entrar</button></div><div class="erro" id="er" role="alert"></div></form>`); if (emailSalvo()) document.getElementById("se2").focus();
  document.getElementById("fd").onsubmit = async ev => { ev.preventDefault(); const er = document.getElementById("er"), em = document.getElementById("em2").value.trim(), se = document.getElementById("se2").value; if (!em || !se) { er.textContent = "Informe e-mail e senha."; return; } const bt = document.getElementById("go"); if (bt.disabled) return; ocupa(bt, true); try { await entrar(em, se); perfil = await rpc("rh_perfil"); solta(); await enviaPendente(); await kv("del", "bloqueado"); vai("hoje"); } catch (e) { rhS = null; perfil = null; ocupa(bt, false); er.textContent = e.rede ? "Sem internet para confirmar a senha." : "E-mail ou senha incorretos. Confira e tente de novo."; } };
}
function liga() { if ("wakeLock" in navigator && !travaTela && document.visibilityState === "visible") navigator.wakeLock.request("screen").then(t => { travaTela = t; t.onrelease = () => travaTela = null; }).catch(() => { }); cutuca(); if (!liga.t) liga.t = setInterval(sincroniza, 15000); }
function solta() { clearTimeout(inatividade); if (travaTela) travaTela.release().catch(() => { }); }
function cutuca() { clearTimeout(inatividade); if (F && F.fase !== "fim" && !rhS) inatividade = setTimeout(pausa, 180000); }
function pausa() { if (pausado || rhS) return; pausado = true; const d = document.createElement("button"); d.className = "pausa"; d.id = "pausa"; d.innerHTML = `${FAC}<img src="assets/marca/vertical-branco.png" alt="Metrocasa Construtora"><b>Preenchimento pausado</b><span>Toque para continuar de onde parou</span>`; d.onclick = () => { d.remove(); pausado = false; cutuca(); }; document.body.append(d); }

/* ===== Cliques ===== */
document.addEventListener("click", async ev => {
  cutuca(); if (ev.target.classList && ev.target.classList.contains("fundo-m")) return fechaM();
  const b = ev.target.closest("button,tr[data-f]"); if (!b) return; const D = b.dataset;
  if (D.ir) { const t = document.getElementById(D.ir); if (t) { t.scrollIntoView({ behavior: MENOS_MOV() ? "auto" : "smooth", block: "start" }); t.tabIndex = -1; t.focus({ preventScroll: true }); } return; }
  if (D.r) return vai(D.r); if (D.f) return vai("ficha", D.f); if (D.ap) { const [j, e] = D.ap.split("|"); return confirmaAplicar(j, +e); }
  if (D.c) { const [av, q] = D.c.split("|"); return dlgCorrige(av, q); } if (D.nr) return dlgTexto(`Marcar a etapa de ${D.nr} dias como não realizada`, "Motivo", async v => { await rpc("rh_nao_realizada", { p_jornada: fichaId, p_etapa: +D.nr, p_motivo: v }); await vai("ficha", fichaId); avisa("Etapa marcada como não realizada.", "ok"); }, true, "Marcar como não realizada");
  if (D.tr) return dlgTexto("Marcar alerta como tratado", "O que foi feito (opcional)", async v => { await rpc("rh_tratar_alerta", { p_id: +D.tr, p_nota: v }); await vai("alertas"); avisa("Alerta marcado como tratado.", "ok"); }, false, "Marcar como tratado");
  if (D.op) { if (b.disabled || $app.querySelector(".op.marcou")) return; const a = pq(F.atual).alternativas.find(x => x.id === D.op), ant = F.r[F.atual] || {}; marca(F.atual, a.id, a.livre && ant.a === a.id ? ant.t : null); limpaOcultas(); if (a.livre) { salvaAgora(); tPerg(); const lv = document.getElementById("lv"); if (lv) lv.focus(); return; } $app.querySelectorAll(".op").forEach(o => o.setAttribute("aria-checked", o === b)); b.classList.add("marcou"); salvaAgora(); setTimeout(() => { if (F && F.fase === "perguntas") avanca(); }, MENOS_MOV() ? 120 : 280); return; }
  if (D.ed) { sentido = 1; F.atual = D.ed; F.fase = "perguntas"; F.revendo = true; guardaF(); return tela(); }
  switch (D.a) {
    case "fecha": return fechaM(); case "desbloq": return dlgDesbloq();
    case "sair": await sairRH(); perfil = null; dados = null; return F ? tela() : telaLogin();
    case "comecar": F.fase = "perguntas"; F.inicio = Date.now(); F.atual = visiveis()[0].id; salvaAgora(); return tela();
    case "segue": return avanca();
    case "volta": { sentido = -1; if (F.fase === "revisao") { F.fase = "perguntas"; F.atual = visiveis().at(-1).id; } else if (F.revendo) { guardaLivre(); F.fase = "revisao"; F.revendo = false; } else { guardaLivre(); const l = visiveis(), i = l.findIndex(q => q.id === F.atual); if (i > 0) F.atual = l[i - 1].id; } salvaAgora(); return tela(); }
    case "enviar": return enviar(b);
    case "retomar": if (F.pendente) { ocupa(b, true); await tentaEnvio(); if (F) { ocupa(b, false); return avisa("Ainda não foi possível enviar. Confira a internet.", "erro"); } avisa("Respostas enviadas.", "ok"); return vai("hoje"); } await sairRH(); perfil = null; dados = null; return tela();
    case "encerrar": if (!F) return; if (!b.dataset.ok) { b.dataset.ok = 1; b.textContent = "Toque de novo para liberar"; return setTimeout(() => { if (b.isConnected) { delete b.dataset.ok; b.textContent = "Liberar o tablet"; } }, 4000); } ocupa(b, true); await sincroniza(); if (!F) return; if (F.pendente || Object.keys(F.sujo).length) return avisa("Ainda há respostas sem enviar. Conecte o tablet à internet.", "erro") || ocupa(b, false); await apagaF(); avisa("Tablet liberado.", "ok"); return vai("hoje");
    case "obs": { const t = document.getElementById("ob"); if (!t.value.trim()) { t.focus(); return avisa(ERROS.texto_vazio, "erro"); } ocupa(b, true); try { await rpc("rh_observacao", { p_jornada: fichaId, p_etapa: null, p_texto: t.value }); await vai("ficha", fichaId); avisa("Observação salva.", "ok"); } catch (e) { ocupa(b, false); avisa(msgErro(e), "erro"); } return; }
    case "limpa": filtro = { t: "", g: "", d: "", s: "" }; return vCons();
    case "exportar": ocupa(b, true); await exportar(); return ocupa(b, false); case "instalar": pedidoInstalar.prompt(); pedidoInstalar = null; return;
    case "reset": if (window.AcompDemo) AcompDemo.reiniciar(); dados = null; return vai("hoje");
  }
});
document.addEventListener("keydown", ev => {
  cutuca();
  if ($modal.innerHTML) { if (ev.key === "Escape") { ev.preventDefault(); return fechaM(); } if (ev.key === "Tab") { const fs = [...$modal.querySelectorAll("button:not([disabled]),input,select,textarea")]; if (!fs.length) return; const a = fs[0], z = fs.at(-1); if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); } else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); } } return; }
  const op = ev.target.closest && ev.target.closest(".op"); if (!op) return;
  const ops = [...$app.querySelectorAll(".op")], i = ops.indexOf(op), d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key];
  if (d) { ev.preventDefault(); const p = ops[(i + d + ops.length) % ops.length]; ops.forEach(o => o.tabIndex = o === p ? 0 : -1); p.focus(); }
});
document.addEventListener("input", cutuca); addEventListener("online", () => { sincroniza(); rede(true); if (F && F.pendente && F.fase === "fim") tentaEnvio().then(ok => ok && !rhS && tela()); }); addEventListener("offline", () => rede(false));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { if (F && !rhS && F.fase !== "fim") liga(); checaVersao(); } });
document.addEventListener("focusout", ev => { if (F && ev.target.id === "lv") { guardaLivre(); salvaAgora(); } });

/* ===== Atualização automática, sem interromper preenchimento ===== */
let VER = "1.0.0";
async function checaVersao(inicial) { try { const r = await fetch("versao.json", { cache: "no-store" }); const v = (await r.json()).versao; if (inicial) { VER = v; return; } if (v !== VER && !F && !rhS) location.reload(); else if (v !== VER && !F && rhS) avisa("Nova versão disponível. Ela entra ao sair da área do RH."); } catch (e) { } }

(async function inicio() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => { });
  checaVersao(true); setInterval(checaVersao, 600000);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); F = await leF(); } catch (e) { }
  if (F) { F.espera = 0; return tela(); }
  let bloq = false; try { bloq = await kv("get", "bloqueado"); } catch (e) { } if (bloq) return telaFim(true); telaLogin();
})();
})();
