"use strict";
(() => {
const CFG = window.ACOMP_CONFIG || {}, DEMO = !CFG.supabaseUrl;
const $app = document.getElementById("app"), $modal = document.getElementById("modal"), $aviso = document.getElementById("aviso");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dt = s => s ? new Date(String(s).length === 10 ? s + "T12:00" : s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }) : "";
const dtc = s => s ? dt(s).slice(0, 5) : "";
const ERROS = { sem_permissao: "Este usuário não tem acesso ao RH.", ja_enviada: "Esta etapa já foi respondida.", nao_aplicavel: "Esta etapa não se aplica a esta pessoa.", sessao_invalida: "Este preenchimento não está mais ativo.", motivo_obrigatorio: "Informe o motivo.", texto_vazio: "Escreva a observação." };
const msgErro = e => e && e.rede ? "Sem conexão com o servidor. Verifique a internet." : ERROS[e && e.message] || "Não foi possível concluir. Tente novamente.";
let tempo; const avisa = m => { $aviso.textContent = m; $aviso.className = "on"; clearTimeout(tempo); tempo = setTimeout(() => { $aviso.textContent = ""; $aviso.className = ""; }, 3800); };

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

/* ===== Entrada do RH ===== */
const emailSalvo = () => { try { return localStorage.getItem("acomp_email") || ""; } catch (e) { return ""; } };
const selo = () => DEMO ? `<span class="selo">DEMONSTRAÇÃO: pessoas fictícias, dados só neste aparelho</span>` : "";
function telaLogin(erro) {
  $app.innerHTML = `${selo()}<div class="login"><form id="fl" novalidate><img src="assets/logos/vertical.png" alt="Metrocasa Construtora"><h1>Acompanhamento Comercial</h1><p class="muted">Acesso do RH Comercial</p>
  <div class="campo"><label for="em">E-mail</label><input id="em" type="email" autocomplete="username" autocapitalize="none" value="${esc(emailSalvo() || (DEMO ? "rh@demonstracao.local" : ""))}"></div>
  <div class="campo"><label for="se">Senha</label><input id="se" type="password" autocomplete="current-password" ${DEMO ? 'placeholder="Qualquer senha na demonstração"' : ""}></div>
  <button class="btn">Entrar</button><div class="erro" id="er">${esc(erro || "")}</div></form></div>`;
  document.getElementById("fl").onsubmit = async ev => { ev.preventDefault(); const b = ev.target.querySelector("button"), er = document.getElementById("er"), em = document.getElementById("em").value.trim(), se = document.getElementById("se").value; if (!em || !se) { er.textContent = "Informe e-mail e senha."; return; } b.disabled = true; er.textContent = ""; try { await entrar(em, se); await enviaPendente(); perfil = await rpc("rh_perfil"); vai("hoje"); } catch (e) { rhS = null; er.textContent = e.rede ? msgErro(e) : e.message === "sem_permissao" ? ERROS.sem_permissao : "E-mail ou senha incorretos."; b.disabled = false; } };
}

/* ===== Área do RH ===== */
let perfil = null, rota = "hoje", dados = null, filtro = { t: "", g: "", d: "", s: "" }, fichaId = null;
const ROT = { a_fazer: "A fazer", atrasada: "Atrasada", realizada: "Realizada", em_andamento: "Em andamento", futura: "Ainda não abriu", nao_aplicavel: "Não se aplica", nao_realizada: "Não realizada" };
const chip = s => `<span class="chip ${s}">${ROT[s]}</span>`;
function casca(html) {
  const n = dados ? dados.alertas_abertos : 0, ab = [["hoje", "Hoje"], ["consultores", "Consultores"], ["alertas", "Alertas"], ["tablet", "Tablet"]];
  $app.innerHTML = `<div class="rh">${selo()}<header class="topo"><div class="l1"><img src="assets/logos/horizontal-branco.png" alt="Metrocasa Construtora"><div class="eu">${esc(perfil.nome)}</div><button class="sair" data-a="sair">Sair</button></div>
  <nav class="abas">${ab.map(([k, t]) => `<button data-r="${k}" class="${rota === k || (rota === "ficha" && k === "consultores") ? "on" : ""}">${t}${k === "alertas" && n ? `<span class="num">${n}</span>` : ""}</button>`).join("")}</nav></header><main class="pag">${banner()}${html}</main></div>`;
}
const banner = () => F ? `<div class="cartao"><b>Preenchimento de ${esc(F.nome)} (${F.etapa} dias) ${F.pendente ? "aguardando envio" : "em andamento"}.</b>${F.erro ? `<div class="erro">O servidor recusou o envio. Fale com o responsável pelo sistema.</div>` : ""}<div class="acoes mt"><button class="btn peq" data-a="retomar">${F.pendente ? "Tentar enviar" : "Devolver à pessoa"}</button><button class="btn sec peq" data-a="encerrar">Liberar o tablet</button></div></div>` : "";
const carregando = () => casca(`<p class="muted">Carregando…</p>`);
async function vai(r, arg) { rota = r; if (r === "ficha") fichaId = arg; window.scrollTo(0, 0); fechaM(); carregando(); try { await desenha(); } catch (e) { if (e.status === 401 || e.message === "sem_permissao") { await sairRH(); telaLogin("Sua sessão terminou. Entre novamente."); } else casca(`<div class="vazio">${esc(msgErro(e))}<br><br><button class="btn sec peq" data-r="${r}">Tentar novamente</button></div>`); } }
async function desenha() {
  if (rota === "tablet") { dados = dados || await rpc("rh_painel"); return vTablet(); } dados = await rpc("rh_painel");
  if (rota === "hoje") return vHoje(); if (rota === "consultores") return vCons(); if (rota === "alertas") return vAlertas(await rpc("rh_alertas")); if (rota === "ficha") return vFicha(await rpc("rh_ficha", { p_jornada: fichaId }));
}
const tudo = () => dados.jornadas.flatMap(j => j.etapas.map(e => ({ j, e })));
function vHoje() {
  const l = tudo(), af = l.filter(x => x.e.status === "a_fazer").sort((a, b) => a.e.fim < b.e.fim ? -1 : 1), at = l.filter(x => x.e.status === "atrasada"), an = l.filter(x => x.e.status === "em_andamento");
  const linha = ({ j, e }) => `<div class="item"><div class="tx"><b>${esc(j.nome)}</b><div class="muted peq">${e.etapa} dias · ${esc(j.gerente || "Sem gerente")} · ${e.status === "atrasada" ? "janela terminou em " + dtc(e.fim) : "até " + dtc(e.fim)}</div></div><div class="acoes"><button class="btn sec peq" data-f="${j.jornada_id}">Ficha</button><button class="btn peq" data-ap="${j.jornada_id}|${e.etapa}">${e.status === "em_andamento" ? "Continuar" : "Aplicar"}</button></div></div>`;
  casca(`<h1>Hoje</h1><p class="sub">${dt(dados.hoje)}</p><div class="kpis"><div class="kpi"><b>${af.length}</b><span>A aplicar</span></div><div class="kpi ${at.length ? "crit" : ""}"><b>${at.length}</b><span>${at.length ? "▲ " : ""}Atrasadas</span></div><div class="kpi"><b>${an.length}</b><span>Em andamento</span></div><div class="kpi ${dados.alertas_abertos ? "crit" : ""}"><b>${dados.alertas_abertos}</b><span>${dados.alertas_abertos ? "▲ " : ""}Alertas abertos</span></div></div>
  <h2>Selecione a pessoa para aplicar</h2><div class="lista">${[...an, ...af].map(linha).join("") || `<div class="vazio">Nenhuma avaliação na janela hoje.</div>`}</div>${at.length ? `<h2>Atrasadas</h2><div class="lista">${at.map(linha).join("")}</div>` : ""}`);
}
function vCons() {
  const uni = k => [...new Set(dados.jornadas.map(j => j[k]).filter(Boolean))].sort(), op = (l, v) => l.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  casca(`<h1>Consultores</h1><p class="sub">Jornadas dos primeiros 90 dias</p><div class="filtros"><div class="bus"><input id="ft" placeholder="Buscar por nome ou apelido" aria-label="Buscar" value="${esc(filtro.t)}"></div><select id="fg" aria-label="Gerente"><option value="">Todos os gerentes</option>${op(uni("gerente"), filtro.g)}</select><select id="fd" aria-label="Diretoria"><option value="">Todas as diretorias</option>${op(uni("diretor"), filtro.d)}</select><select id="fs" aria-label="Situação"><option value="">Todas as situações</option>${["a_fazer", "atrasada", "em_andamento"].map(k => `<option value="${k}" ${filtro.s === k ? "selected" : ""}>${ROT[k]}</option>`).join("")}</select></div><div id="tb"></div>${perfil.papel === "admin" ? `<div class="mt"><button class="btn sec peq" data-a="exportar">Exportar respostas (CSV)</button></div>` : ""}`);
  const pinta = () => { const nk = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(), t = nk(filtro.t), l = dados.jornadas.filter(j => (!t || nk(j.nome + " " + j.apelido).includes(t)) && (!filtro.g || j.gerente === filtro.g) && (!filtro.d || j.diretor === filtro.d) && (!filtro.s || j.etapas.some(e => e.status === filtro.s)));
    document.getElementById("tb").innerHTML = l.length ? `<div class="tab"><table><thead><tr><th>Consultor</th><th>Gerente</th><th>Entrada</th><th>15 dias</th><th>30 dias</th><th>60 dias</th><th>90 dias</th></tr></thead><tbody>${l.map(j => `<tr class="lk" data-f="${j.jornada_id}"><td><span class="nm">${esc(j.nome)}</span><div class="muted peq">${j.dias} dias de casa</div></td><td>${esc(j.gerente)}</td><td>${dtc(j.entrada)}</td>${j.etapas.map(e => `<td>${chip(e.status)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="vazio">Ninguém encontrado com esses filtros.</div>`; };
  pinta(); const liga = (id, k) => document.getElementById(id).oninput = ev => { filtro[k] = ev.target.value; pinta(); }; liga("ft", "t"); liga("fg", "g"); liga("fd", "d"); liga("fs", "s");
}
const SIN = { C: "Crítico", A: "Atenção" }, COMUNS = ["SUP", "C_FALTA", "FEED", "MESA", "C_MESA", "PERM", "C_MOTIVO", "LEADS", "GANHOS", "RETOMA", "OBS"];
let fichaAtual = null;
function vFicha(f) {
  fichaAtual = f; const linhas = []; f.etapas.forEach(e => e.respostas.forEach(r => { const k = COMUNS.includes(r.chave) ? r.chave : r.pergunta_id; let l = linhas.find(x => x.k === k); if (!l) { l = { k, chave: r.chave, texto: r.texto, c: {} }; linhas.push(l); } l.c[e.etapa] = r; }));
  const comuns = COMUNS.map(k => linhas.find(l => l.k === k)).filter(Boolean), proprias = linhas.filter(l => !COMUNS.includes(l.k));
  const cel = (e, r) => !r ? "" : `<button class="cel" ${r.chave === "OBS" ? "disabled" : `data-c="${e.avaliacao_id}|${r.pergunta_id}"`}>${esc(r.alternativa || "")}${r.livre ? `<small>“${esc(r.livre)}”</small>` : ""}${SIN[r.sinal] ? `<span class="sinal ${r.sinal}">${r.sinal === "C" ? "▲ " : "• "}${SIN[r.sinal]}</span>` : ""}${r.corrigida ? `<small>Corrigida pelo RH</small>` : ""}</button>`;
  const lin = l => `<tr class="${l.chave.startsWith("C_") ? "cond" : ""}"><td>${esc(l.texto)}</td>${f.etapas.map(e => `<td>${cel(e, l.c[e.etapa])}</td>`).join("")}</tr>`;
  const acoes = e => ["a_fazer", "atrasada", "em_andamento"].includes(e.status) ? `<button class="btn txt peq" data-ap="${f.jornada_id}|${e.etapa}">Aplicar</button><button class="btn txt peq" data-nr="${e.etapa}">Não realizada</button>` : "";
  casca(`<button class="voltar" data-r="consultores">‹ Consultores</button><div class="ficha-h"><div><h1>${esc(f.nome)}</h1><p class="sub">${esc(f.gerente || "")}${f.superintendente ? " · " + esc(f.superintendente) : ""} · entrada ${dt(f.entrada)} · ${f.dias} dias de casa</p></div></div>
  <div class="tab"><table class="cmp"><thead><tr><th>Evolução por etapa</th>${f.etapas.map(e => `<th>${e.etapa} dias ${chip(e.status)}${e.gerente && e.gerente !== f.gerente ? `<div class="muted peq">Gerente na época: ${esc(e.gerente)}</div>` : ""}${e.motivo ? `<div class="muted peq">${esc(e.motivo)}</div>` : ""}${acoes(e)}</th>`).join("")}</tr></thead><tbody>${comuns.map(lin).join("")}${proprias.map(lin).join("")}${linhas.length ? "" : `<tr><td colspan="5" class="muted">Ainda não há respostas.</td></tr>`}</tbody></table></div>
  <p class="muted peq">Atenção e Crítico são pontos para o RH avaliar, não uma conclusão sobre a pessoa. Toque em uma resposta para corrigi-la.</p>
  <h2>Observações do RH</h2><div class="nova-obs"><label for="ob">Registrar a conversa ou uma observação</label><textarea id="ob" maxlength="4000"></textarea><button class="btn peq" data-a="obs">Salvar observação</button></div><div class="lista">${f.observacoes.map(o => `<div class="obs">${esc(o.texto)}<div class="muted peq">${esc(o.autor || "")} · ${dt(o.em)}${o.etapa ? ` · ${o.etapa} dias` : ""}</div></div>`).join("")}</div>`);
}
const TIPO = { resposta_critica: "Resposta crítica", comentario: "Comentário", revisar_coerencia: "Revisar" };
function vAlertas(l) { dados.alertas_abertos = l.filter(a => a.status === "aberto").length; casca(`<h1>Alertas</h1><p class="sub">Pontos que pedem leitura ou conversa do RH</p><div class="lista">${l.map(a => `<div class="item"><div class="tx"><span class="chip ${a.status === "aberto" ? "atrasada" : ""}">${a.status === "aberto" ? TIPO[a.tipo] : "Tratado"}</span> <b>${esc(a.nome)}</b> <span class="muted peq">${a.etapa} dias</span><div>${esc(a.descricao)}</div>${a.nota ? `<div class="muted peq">Nota: ${esc(a.nota)}</div>` : ""}</div><div class="acoes"><button class="btn sec peq" data-f="${a.jornada_id}">Ficha</button>${a.status === "aberto" ? `<button class="btn peq" data-tr="${a.id}">Tratar</button>` : ""}</div></div>`).join("") || `<div class="vazio">Nenhum alerta.</div>`}</div>`); }
function vTablet() {
  const P = { ipad: ["iPad", ["Abra este endereço no Safari.", "Toque em Compartilhar e em “Adicionar à Tela de Início”.", "Abra o app Acompanhamento pelo novo ícone.", "Em Ajustes > Acessibilidade, ative “Acesso Guiado”.", "Com o app aberto, clique três vezes no botão lateral e inicie o Acesso Guiado."]], android: ["Android", ["Abra este endereço no Chrome.", "Toque em “Instalar aplicativo” abaixo ou no menu ⋮ > Instalar aplicativo.", "Abra o app Acompanhamento pelo novo ícone.", "Em Configurações > Segurança, ative “Fixar app”.", "Abra os apps recentes, toque no ícone do Acompanhamento e escolha “Fixar”."]], outro: ["este aparelho", ["Abra este endereço no tablet para ver o passo a passo do iPad ou do Android."]] }[PLAT];
  casca(`<h1>Tablet</h1><p class="sub">Aparelho reconhecido: ${P[0]} · ${INSTALADO() ? "instalado como aplicativo" : "aberto no navegador"}</p><div class="cartao"><h3>Preparar este tablet</h3><ol class="passos">${P[1].map(x => `<li>${esc(x)}</li>`).join("")}</ol>${pedidoInstalar ? `<button class="btn peq" data-a="instalar">Instalar aplicativo</button>` : ""}</div><div class="cartao"><h3>Atualizações</h3><p class="muted">O site baixa novas versões sozinho e nunca recarrega durante um preenchimento.</p></div>${DEMO ? `<button class="btn sec peq" data-a="reset">Reiniciar demonstração</button>` : ""}<p class="rodape">Versão ${esc(VER)}</p>`);
}
const fechaM = () => { $modal.innerHTML = ""; };
function modal(html) { $modal.innerHTML = `<div class="fundo-m"><div class="janela" role="dialog" aria-modal="true">${html}</div></div>`; const f = $modal.querySelector("input,textarea,select"); if (f && f.type !== "radio") f.focus(); return $modal.firstChild; }
function confirmaAplicar(jid, et) {
  const j = dados.jornadas.find(x => x.jornada_id === jid), e = j.etapas.find(x => x.etapa === et), fora = ["futura", "atrasada"].includes(e.status);
  if (F) return avisa("Conclua ou encerre o preenchimento em andamento primeiro.");
  modal(`<h2>Entregar o tablet a ${esc(j.nome)}?</h2><p>Etapa de <b>${et} dias</b>${fora ? `, fora da janela (${dtc(e.inicio)} a ${dtc(e.fim)})` : ""}. Confira se é a pessoa certa.</p><p class="muted">Depois de iniciar, a área do RH fica bloqueada até você digitar sua senha.</p><div class="bts"><button class="btn txt" data-a="fecha">Cancelar</button><button class="btn" id="go">Iniciar e entregar</button></div><div class="erro" id="er"></div>`);
  document.getElementById("go").onclick = async ev => { ev.target.disabled = true; try { const s = await rpc("rh_iniciar", { p_jornada: jid, p_etapa: et, p_dispositivo: DISPOSITIVO(), p_fora: fora }); F = { token: s.token, avaliacao_id: s.avaliacao_id, etapa: s.etapa, nome: s.primeiro_nome, perguntas: s.perguntas, r: {}, seq: 0, sujo: {}, fase: "aviso", atual: null, inicio: Date.now(), revendo: false }; (s.respostas || []).forEach(x => { F.r[x.q] = { a: x.a, t: x.t, s: x.s }; F.seq = Math.max(F.seq, x.s || 0); }); await guardaF(); await filaGrava; await sairRH(); perfil = null; dados = null; fechaM(); tela(); } catch (e) { document.getElementById("er").textContent = msgErro(e); ev.target.disabled = false; } };
}
function dlgCorrige(av, q) { const r = fichaAtual.etapas.flatMap(e => e.respostas).find((x, i, a) => x.pergunta_id === q); modal(`<h2>Corrigir resposta</h2><p>${esc(r.texto)}</p><div class="campo"><label for="ca">Resposta correta</label><select id="ca">${r.opcoes.map(o => `<option value="${o.id}" ${o.id === r.alternativa_id ? "selected" : ""}>${esc(o.texto)}</option>`).join("")}</select></div><div class="campo"><label for="cm">Motivo da correção</label><textarea id="cm"></textarea></div><p class="muted peq">A resposta original fica guardada no histórico.</p><div class="bts"><button class="btn txt" data-a="fecha">Cancelar</button><button class="btn" id="go">Salvar correção</button></div><div class="erro" id="er"></div>`); document.getElementById("go").onclick = async () => { try { await rpc("rh_corrigir", { p_avaliacao: av, p_pergunta: q, p_alternativa: document.getElementById("ca").value, p_motivo: document.getElementById("cm").value }); vai("ficha", fichaId); avisa("Correção registrada."); } catch (e) { document.getElementById("er").textContent = msgErro(e); } }; }
function dlgTexto(tit, rot, fn, obrig) { modal(`<h2>${esc(tit)}</h2><div class="campo"><label for="tx">${esc(rot)}</label><textarea id="tx"></textarea></div><div class="bts"><button class="btn txt" data-a="fecha">Cancelar</button><button class="btn" id="go">Salvar</button></div><div class="erro" id="er"></div>`); document.getElementById("go").onclick = async () => { const v = document.getElementById("tx").value; if (obrig && !v.trim()) { document.getElementById("er").textContent = "Preencha este campo."; return; } try { await fn(v); } catch (e) { document.getElementById("er").textContent = msgErro(e); } }; }
async function exportar() { try { const l = await rpc("rh_exportar"), C = ["nome", "apelido", "entrada", "etapa", "enviada_em", "gerente", "superintendente", "diretor", "pergunta_id", "pergunta", "resposta", "complemento", "sinal", "versao"], c = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; const csv = "﻿USO INTERNO\r\n" + C.join(";") + "\r\n" + l.map(r => C.map(k => c(r[k])).join(";")).join("\r\n"), a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `acompanhamento_respostas_${dados.hoje}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } catch (e) { avisa(msgErro(e)); } }

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
function topoF(pct) { queueMicrotask(() => document.querySelectorAll("[data-p]").forEach(e => e.style.width = e.dataset.p + "%")); return `${selo()}<div class="f-top"><img src="assets/logos/casinha.png" alt="Metrocasa"><span class="et">Acompanhamento · ${F ? F.etapa + " dias" : ""}</span><button class="rhb" data-a="desbloq">RH</button></div><div class="barra"><i data-p="${pct || 0}"></i></div>`; }
function tela() { if (!F) { return telaFim(true); } liga(); if (F.fase === "aviso") return tAviso(); if (F.fase === "perguntas") return tPerg(); if (F.fase === "revisao") return tRev(); return telaFim(!F.pendente); }
function tAviso() { $app.innerHTML = `<div class="f">${topoF(0)}<div class="f-c"><div class="central"><img src="assets/logos/vertical.png" alt="Metrocasa Construtora"><h1>Olá, ${esc(F.nome)}</h1><p>Queremos saber como está sendo sua experiência nos primeiros <b>${F.etapa} dias</b>. Responda com tranquilidade: leva poucos minutos.</p><p class="conf">Este acompanhamento é conduzido pelo RH Comercial. Suas respostas são confidenciais, mas não anônimas: o RH saberá quem respondeu. Seu gerente não tem acesso às suas respostas individuais. Se algo exigir proteção de pessoas ou providência obrigatória, o RH poderá agir.</p><button class="btn" data-a="comecar">Começar</button></div></div></div>`; }
function tPerg() {
  const l = visiveis(); let q = pq(F.atual); if (!q || !vis(q)) { q = l[0]; F.atual = q.id; } const n = l.indexOf(q) + 1, r = F.r[q.id] || {}, op = q.alternativas.find(a => a.id === r.a), mostra = op && op.livre;
  const corpo = q.tipo === "texto" ? `<div class="ops"><textarea id="lv" maxlength="1000" aria-label="Comentário" placeholder="Opcional">${esc(r.t || "")}</textarea></div>` : `<div class="ops" role="radiogroup" aria-label="${esc(q.texto)}">${q.alternativas.map(a => `<button class="op" role="radio" aria-checked="${a.id === r.a}" data-op="${a.id}"><i></i>${esc(a.texto)}</button>`).join("")}${mostra ? `<div class="livre"><label for="lv">Conte em poucas palavras</label><input id="lv" maxlength="300" value="${esc(r.t || "")}"></div>` : ""}</div>`;
  $app.innerHTML = `<div class="f">${topoF(Math.round((n - 1) / l.length * 100))}<div class="f-c"><div class="q"><div><div class="cnt">Pergunta ${n} de ${l.length}</div>${q.contexto ? `<p class="ctx">Antes, você apontou: <b>${esc(q.contexto)}</b></p>` : ""}<h1>${esc(q.texto)}</h1></div>${corpo}</div></div><div class="rede" id="rede"></div><div class="f-b"><button class="btn txt" data-a="volta" ${n === 1 && !F.revendo ? "disabled" : ""}>‹ Voltar</button>${q.tipo === "texto" || mostra ? `<button class="btn" data-a="segue">Continuar</button>` : ""}</div></div>`;
  rede(navigator.onLine);
}
function guardaLivre() { const e = document.getElementById("lv"); if (!e || !F.atual) return; const r = F.r[F.atual] || {}, v = e.value.trim(); if ((r.t || "") !== v) { marca(F.atual, r.a ?? null, v || null); } }
function avanca() { guardaLivre(); limpaOcultas(); const l = visiveis(), i = l.findIndex(q => q.id === F.atual); let prox; if (F.revendo) { prox = l.find(q => q.tipo === "unica" && !(F.r[q.id] && F.r[q.id].a)); } else prox = l[i + 1]; if (prox) { F.atual = prox.id; F.fase = "perguntas"; } else { F.fase = "revisao"; F.revendo = false; } salvaAgora(); tela(); window.scrollTo(0, 0); }
function tRev() { const l = visiveis().filter(q => F.r[q.id] && (F.r[q.id].a || F.r[q.id].t)); $app.innerHTML = `<div class="f">${topoF(100)}<div class="f-c"><h1>Confira suas respostas</h1><p class="muted">Toque em uma resposta se quiser mudar.</p><div class="rev">${l.map(q => { const r = F.r[q.id], a = q.alternativas.find(x => x.id === r.a); return `<button data-ed="${q.id}"><span>${esc(q.texto)}</span><b>${esc(a ? a.texto : r.t)}${a && r.t ? ": " + esc(r.t) : ""}</b></button>`; }).join("")}</div></div><div class="rede" id="rede"></div><div class="f-b"><button class="btn txt" data-a="volta">‹ Voltar</button><button class="btn" data-a="enviar">Enviar respostas</button></div></div>`; rede(navigator.onLine); }
async function enviar(b) {
  if (b) b.disabled = true; limpaOcultas(); const falta = unicaFalta(); if (falta) { F.atual = falta.id; F.fase = "perguntas"; F.revendo = true; return tela(); }
  F.fase = "fim"; F.pendente = true; await guardaF(); await filaGrava; await tentaEnvio(); tela();
}
async function tentaEnvio() { if (!F || !F.pendente) return true; const copia = F; try { await rpc("tab_enviar", { p_token: copia.token, p_itens: itensDe(Object.keys(copia.r)), p_segundos: Math.round((Date.now() - copia.inicio) / 1000) }, true); await apagaF(); await kv("put", "bloqueado", true); return true; } catch (e) { if (!e.rede) { if (String(e.message).startsWith("incompleta:")) { const id = e.message.split(":")[1].split(",")[0]; if (pq(id)) { F.fase = "perguntas"; F.atual = id; F.revendo = true; F.pendente = false; await guardaF(); } } else { F.erro = e.message; await guardaF(); } } return false; } }
const enviaPendente = async () => { if (F && F.pendente) await tentaEnvio(); };
function telaFim(ok) { solta(); $app.innerHTML = `<div class="f">${ok ? `${selo()}<div class="f-top"><img src="assets/logos/casinha.png" alt="Metrocasa"><button class="rhb" data-a="desbloq">RH</button></div>` : topoF(100)}<div class="f-c"><div class="central"><img src="assets/logos/vertical.png" alt="Metrocasa Construtora"><h1>${ok ? "Respostas registradas" : "Respostas guardadas"}</h1><p>${ok ? "Obrigado por contar como está sendo sua experiência." : "Elas serão enviadas assim que a conexão voltar."}</p><p class="muted">Agora, entregue o tablet ao RH.</p></div></div></div>`; if (!ok && !F.espera) { F.espera = 1; const t = setInterval(async () => { if (!F || !F.pendente) { clearInterval(t); if (!F) tela(); return; } if (await tentaEnvio()) { clearInterval(t); tela(); } }, 8000); } }
function dlgDesbloq() {
  modal(`<h2>Acesso do RH</h2><p class="muted">${F && F.fase !== "fim" ? "O preenchimento fica guardado e pode continuar depois." : "Digite sua senha para voltar à área do RH."}</p><form id="fd" novalidate><div class="campo"><label for="em2">E-mail</label><input id="em2" type="email" autocapitalize="none" autocomplete="off" value="${esc(emailSalvo())}"></div><div class="campo"><label for="se2">Senha</label><input id="se2" type="password" autocomplete="off"></div><div class="bts"><button type="button" class="btn txt" data-a="fecha">Cancelar</button><button class="btn">Entrar</button></div><div class="erro" id="er"></div></form>`);
  document.getElementById("fd").onsubmit = async ev => { ev.preventDefault(); const er = document.getElementById("er"), em = document.getElementById("em2").value.trim(), se = document.getElementById("se2").value; if (!em || !se) { er.textContent = "Informe e-mail e senha."; return; } try { await entrar(em, se); perfil = await rpc("rh_perfil"); solta(); await enviaPendente(); await kv("del", "bloqueado"); vai("hoje"); } catch (e) { rhS = null; perfil = null; er.textContent = e.rede ? "Sem internet para confirmar a senha." : "E-mail ou senha incorretos."; } };
}
function liga() { if ("wakeLock" in navigator && !travaTela && document.visibilityState === "visible") navigator.wakeLock.request("screen").then(t => { travaTela = t; t.onrelease = () => travaTela = null; }).catch(() => { }); cutuca(); if (!liga.t) liga.t = setInterval(sincroniza, 15000); }
function solta() { clearTimeout(inatividade); if (travaTela) travaTela.release().catch(() => { }); }
function cutuca() { clearTimeout(inatividade); if (F && F.fase !== "fim" && !rhS) inatividade = setTimeout(pausa, 180000); }
function pausa() { if (pausado || rhS) return; pausado = true; const d = document.createElement("button"); d.className = "pausa"; d.id = "pausa"; d.innerHTML = `<img src="assets/logos/vertical.png" alt="Metrocasa Construtora"><b>Preenchimento pausado</b><span class="muted">Toque para continuar</span>`; d.onclick = () => { d.remove(); pausado = false; cutuca(); }; document.body.append(d); }

/* ===== Cliques ===== */
document.addEventListener("click", async ev => {
  cutuca(); const b = ev.target.closest("button,tr[data-f]"); if (!b) return; const D = b.dataset;
  if (D.r) return vai(D.r); if (D.f) return vai("ficha", D.f); if (D.ap) { const [j, e] = D.ap.split("|"); return confirmaAplicar(j, +e); }
  if (D.c) { const [av, q] = D.c.split("|"); return dlgCorrige(av, q); } if (D.nr) return dlgTexto("Avaliação não realizada", "Motivo", async v => { await rpc("rh_nao_realizada", { p_jornada: fichaId, p_etapa: +D.nr, p_motivo: v }); vai("ficha", fichaId); }, true);
  if (D.tr) return dlgTexto("Tratar alerta", "O que foi feito (opcional)", async v => { await rpc("rh_tratar_alerta", { p_id: +D.tr, p_nota: v }); vai("alertas"); });
  if (D.op) { const a = pq(F.atual).alternativas.find(x => x.id === D.op), ant = F.r[F.atual] || {}; marca(F.atual, a.id, a.livre && ant.a === a.id ? ant.t : null); limpaOcultas(); if (a.livre) { salvaAgora(); return tPerg(); } $app.querySelectorAll(".op").forEach(o => o.setAttribute("aria-checked", o === b)); salvaAgora(); setTimeout(() => { if (F && F.fase === "perguntas") avanca(); }, 170); return; }
  if (D.ed) { F.atual = D.ed; F.fase = "perguntas"; F.revendo = true; guardaF(); return tela(); }
  switch (D.a) {
    case "fecha": return fechaM(); case "desbloq": return dlgDesbloq();
    case "sair": await sairRH(); perfil = null; dados = null; return F ? tela() : telaLogin();
    case "comecar": F.fase = "perguntas"; F.inicio = Date.now(); F.atual = visiveis()[0].id; salvaAgora(); return tela();
    case "segue": return avanca();
    case "volta": { if (F.fase === "revisao") { F.fase = "perguntas"; F.atual = visiveis().at(-1).id; } else if (F.revendo) { guardaLivre(); F.fase = "revisao"; F.revendo = false; } else { guardaLivre(); const l = visiveis(), i = l.findIndex(q => q.id === F.atual); if (i > 0) F.atual = l[i - 1].id; } salvaAgora(); return tela(); }
    case "enviar": return enviar(b);
    case "retomar": if (F.pendente) { await tentaEnvio(); if (F) return avisa("Ainda não foi possível enviar."); avisa("Respostas enviadas."); return vai("hoje"); } await sairRH(); perfil = null; dados = null; return tela();
    case "encerrar": await sincroniza(); if (F.pendente || Object.keys(F.sujo).length) return avisa("Ainda há respostas sem enviar. Conecte o tablet à internet."); await apagaF(); return vai("hoje");
    case "obs": { const t = document.getElementById("ob"); if (!t.value.trim()) return avisa(ERROS.texto_vazio); try { await rpc("rh_observacao", { p_jornada: fichaId, p_etapa: null, p_texto: t.value }); vai("ficha", fichaId); } catch (e) { avisa(msgErro(e)); } return; }
    case "exportar": return exportar(); case "instalar": pedidoInstalar.prompt(); pedidoInstalar = null; return;
    case "reset": if (window.AcompDemo) AcompDemo.reiniciar(); dados = null; return vai("hoje");
  }
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
