'use strict';
/* Arquivo — arquivo de documentos em papel. Tudo fica guardado só neste dispositivo. */
const VERSION = '1.0';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- Base de dados local (IndexedDB) ---------------- */
let DB;
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('arquivo-docs', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('docs', { keyPath: 'id' });
      d.createObjectStore('pages', { keyPath: 'id' });
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = DB.transaction(store, mode), s = t.objectStore(store);
    let out; const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abortado'));
  });
}
const dbGet = (st, k) => tx(st, 'readonly', s => s.get(k));
const dbAll = st => tx(st, 'readonly', s => s.getAll());
const dbPut = (st, v, k) => tx(st, 'readwrite', s => (k === undefined ? s.put(v) : s.put(v, k)));
const dbDel = (st, k) => tx(st, 'readwrite', s => s.delete(k));

/* ---------------- Estado ---------------- */
const S = { docs: [], folders: [], rules: {}, set: { ignoreNifs: '', lastBackup: 0 }, draft: null, q: '' };

/* ---------------- Pastas por omissão ---------------- */
// "!" = palavra-chave forte. Tudo sem acentos e em minúsculas.
const DEFAULT_FOLDERS = [
  { id: 'financas', name: 'Finanças', emoji: '💶', kw: ['!autoridade tributaria', 'financas', '!portal das financas', 'contribuinte'] },
  { id: 'fin-irs', parent: 'financas', name: 'IRS e impostos', kw: ['!irs', '!nota de liquidacao', '!declaracao de rendimentos', 'modelo 3', '!reembolso', 'imposto', 'coleta', '!demonstracao de liquidacao', 'e-fatura', 'rendimento coletavel'] },
  { id: 'fin-ss', parent: 'financas', name: 'Segurança Social', kw: ['!seguranca social', '!niss', 'contribuicoes', 'prestacoes sociais', 'abono', 'subsidio de desemprego', 'trabalhadores independentes'] },
  { id: 'fin-banco', parent: 'financas', name: 'Banco e crédito', kw: ['!extrato', 'iban', '!credito', 'emprestimo', 'prestacao', 'taeg', 'cartao de credito', 'caixa geral de depositos', 'millennium', 'santander', 'novo banco', 'bpi', 'montepio', 'credito agricola', 'activobank', 'revolut', 'banco', 'saldo'] },
  { id: 'fin-seguros', parent: 'financas', name: 'Seguros', kw: ['!apolice', 'seguro', 'premio', 'tomador do seguro', 'segurado', 'fidelidade', 'tranquilidade', 'allianz', 'ageas', 'generali', 'zurich', 'liberty', 'sinistro', 'acidente de trabalho'] },
  { id: 'casa', name: 'Casa', emoji: '🏠', kw: ['habitacao', 'imovel', 'morada de fornecimento', 'local de consumo', 'fracao'] },
  { id: 'casa-renda', parent: 'casa', name: 'Renda e arrendamento', kw: ['!contrato de arrendamento', '!recibo de renda', 'renda', 'senhorio', 'senhoria', 'arrendatario', 'inquilino', 'arrendamento'] },
  { id: 'casa-cond', parent: 'casa', name: 'Condomínio', kw: ['!condominio', 'quota', 'quotas', 'administracao do condominio', 'assembleia de condominos', 'condominos', 'fundo comum de reserva'] },
  { id: 'casa-imi', parent: 'casa', name: 'IMI e imóveis', kw: ['!imi', '!imposto municipal sobre imoveis', '!caderneta predial', 'artigo matricial', '!certidao permanente', 'registo predial', 'escritura', 'valor patrimonial', 'predio urbano'] },
  { id: 'casa-energia', parent: 'casa', name: 'Luz e gás', kw: ['!eletricidade', '!edp', 'kwh', 'cpe', 'potencia contratada', '!gas natural', 'botija', 'galp', 'endesa', 'iberdrola', 'goldenergy', 'energia', '!e-redes', 'cui', 'tarifa social'] },
  { id: 'casa-agua', parent: 'casa', name: 'Água', kw: ['!agua', 'm3', 'saneamento', 'residuos', 'smas', 'epal', 'aguas de', 'consumo de agua', 'contador'] },
  { id: 'casa-telecom', parent: 'casa', name: 'Internet e telemóvel', kw: ['!meo', '!vodafone', 'nowo', 'digi', 'internet', 'fibra', 'tarifario', 'telemovel', 'televisao', '!altice', 'telefone', 'pacote', 'router', 'chamadas'] },
  { id: 'casa-seguro', parent: 'casa', name: 'Seguro da casa', kw: ['!multirriscos', '!seguro habitacao', '!seguro de habitacao', 'recheio'] },
  { id: 'carros', name: 'Carros', emoji: '🚗', kw: ['viatura', 'veiculo', '!matricula', 'automovel', 'quilometros', 'ligeiro de passageiros'] },
  { id: 'car-cv', parent: 'carros', name: 'Compra e venda', kw: ['!contrato de compra e venda', '!declaracao de venda', 'comprador', 'vendedor', '!venda de veiculo', '!requerimento de registo', 'sinal', 'stand', 'preco de venda'] },
  { id: 'car-doc', parent: 'carros', name: 'Documento e registo', kw: ['!documento unico automovel', '!dua', '!certificado de matricula', '!registo automovel', 'registos e do notariado', 'irn', 'titular', 'proprietario'] },
  { id: 'car-iuc', parent: 'carros', name: 'IUC', kw: ['!iuc', '!imposto unico de circulacao', 'cilindrada', 'escalao', 'emissoes co2'] },
  { id: 'car-insp', parent: 'carros', name: 'Inspeção', kw: ['!inspecao', '!ficha de inspecao', '!centro de inspecao', '!ipo', 'periodica obrigatoria', 'deficiencias', 'aprovado', 'reprovado'] },
  { id: 'car-seg', parent: 'carros', name: 'Seguro automóvel', kw: ['!seguro automovel', '!carta verde', '!certificado internacional de seguro', 'responsabilidade civil automovel', 'danos proprios', 'assistencia em viagem'] },
  { id: 'car-multas', parent: 'carros', name: 'Multas', kw: ['!auto de contraordenacao', '!contraordenacao', '!coima', '!ansr', 'excesso de velocidade', 'estacionamento', 'emel', 'psp', 'gnr', 'infracao', 'codigo da estrada'] },
  { id: 'car-port', parent: 'carros', name: 'Portagens', kw: ['!via verde', '!portagem', 'portagens', 'brisa', 'ascendi', 'scut'] },
  { id: 'car-rep', parent: 'carros', name: 'Manutenção e reparações', kw: ['revisao', 'mudanca de oleo', 'filtro', 'pastilhas', 'pneus', 'oficina', 'reparacao', 'kms'] },
  { id: 'ativ', name: 'Atividade (oficina)', emoji: '🔧', kw: ['!recibo verde', '!fatura-recibo', 'atividade', 'trabalhador independente', 'cae'] },
  { id: 'ativ-forn', parent: 'ativ', name: 'Faturas de fornecedores', kw: ['pecas', '!auto pecas', 'fornecedor', 'referencia', 'qtd', 'quantidade', 'preco unitario', 'desconto', 'guia de remessa', 'artigo'] },
  { id: 'ativ-cli', parent: 'ativ', name: 'Faturas a clientes', kw: ['!mao de obra', '!orcamento', 'cliente', 'servico prestado'] },
  { id: 'ativ-iva', parent: 'ativ', name: 'IVA e contabilidade', kw: ['!declaracao periodica', '!iva a entregar', '!inicio de atividade', 'contabilista', 'regime de isencao', 'artigo 53', 'retencao na fonte'] },
  { id: 'trab', name: 'Trabalho', emoji: '💼', kw: ['entidade empregadora', 'empregador', 'colaborador', 'trabalhador'] },
  { id: 'trab-rec', parent: 'trab', name: 'Recibos de vencimento', kw: ['!recibo de vencimento', '!vencimento base', 'subsidio de alimentacao', 'remuneracao', 'liquido a receber', '!processamento salarial', 'descontos', 'tsu', 'abonos'] },
  { id: 'trab-cont', parent: 'trab', name: 'Contratos', kw: ['!contrato de trabalho', 'periodo experimental', 'termo certo', 'termo incerto', 'clausula', 'outorgantes'] },
  { id: 'trab-form', parent: 'trab', name: 'Formação e certificados', kw: ['!certificado de formacao', 'formacao', 'curso', 'diploma', 'certificado de habilitacoes', 'formando', 'carga horaria'] },
  { id: 'saude', name: 'Saúde', emoji: '🩺', kw: ['!sns', 'utente', 'saude'] },
  { id: 'saude-cons', parent: 'saude', name: 'Consultas e exames', kw: ['consulta', 'hospital', 'clinica', '!analises', 'exame', '!receita medica', 'medico', 'farmacia', 'centro de saude', 'urgencia', 'ortopedia', 'fisioterapia', 'relatorio medico', 'taxa moderadora'] },
  { id: 'saude-seg', parent: 'saude', name: 'Seguro de saúde', kw: ['!medis', '!multicare', '!advancecare', '!seguro de saude', 'cartao de saude'] },
  { id: 'animais', name: 'Animais', emoji: '🐕', kw: ['!veterinario', '!veterinaria', '!clinica veterinaria', 'canideo', 'canino', '!vacina antirrabica', 'microchip', 'siac', 'desparasitacao', 'boletim sanitario', 'raca'] },
  { id: 'compras', name: 'Compras e garantias', emoji: '🧾', kw: ['!garantia', 'talao', '!fatura simplificada', 'numero de serie', 'worten', 'fnac', 'ikea', 'leroy merlin', 'continente', 'pingo doce', 'lidl', 'auchan', 'radio popular', 'amazon'] },
  { id: 'outros', name: 'Outros', emoji: '📁', kw: [] },
];

/* ---------------- Utilitários de texto ---------------- */
function normChar(c) {
  const n = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return n.length === 1 ? n : (n[0] || ' ');
}
const NC = new Map();
function norm(s) {
  s = String(s || '');
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c < '\u0080') { o += c.toLowerCase(); continue; }
    let n = NC.get(c); if (n === undefined) { n = normChar(c); NC.set(c, n); }
    o += n;
  }
  return o;
}
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d} ${MES_C[+m - 1]} ${y}`; }
function fmtEUR(n) { return (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }); }
function todayISO() { const d = new Date(); return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function isoOf(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function daysTo(iso) { const t = new Date(todayISO() + 'T00:00:00'), d = new Date(iso + 'T00:00:00'); return Math.round((d - t) / 864e5); }
function validDate(y, m, d) { if (y < 100) y += 2000; if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1980 || y > 2100) return null; const dt = new Date(y, m - 1, d); return dt.getMonth() === m - 1 ? isoOf(y, m, d) : null; }

/* ---------------- Extração de dados do texto ---------------- */
const DATE_RX = /(\d{1,2})\s?[\/\-.]\s?(\d{1,2})\s?[\/\-.]\s?(\d{4}|\d{2})(?!\d)|(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?!\d)|(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?(\d{4})/g;
function findDates(n) { // n = texto normalizado
  const out = []; let m; DATE_RX.lastIndex = 0;
  while ((m = DATE_RX.exec(n))) {
    let iso = null;
    if (m[1]) iso = validDate(+m[3], +m[2], +m[1]);
    else if (m[4]) iso = validDate(+m[4], +m[5], +m[6]);
    else if (m[7]) iso = validDate(+m[9], MESES.indexOf(m[8]) + 1, +m[7]);
    if (iso) out.push({ iso, i: m.index });
  }
  return out;
}
function dateAfter(n, dates, keys, span = 90) {
  let best = null;
  for (const k of keys) {
    let i = n.indexOf(k);
    while (i >= 0) {
      const d = dates.find(x => x.i >= i && x.i <= i + k.length + span);
      if (d && (!best || i < best.k)) best = { iso: d.iso, k: i };
      i = n.indexOf(k, i + 1);
    }
    if (best) return best.iso;
  }
  return null;
}
const AMT_RX = /(?:€\s?)?(\d{1,3}(?:[ .]\d{3})+|\d+)[,.](\d{2})(?!\d)(?:\s?(?:€|eur))?/g;
function amountsIn(s) {
  const out = []; let m; AMT_RX.lastIndex = 0;
  while ((m = AMT_RX.exec(s))) { const v = parseFloat(m[1].replace(/[ .]/g, '') + '.' + m[2]); if (v > 0 && v < 1e7) out.push({ v, eur: /€|eur/.test(m[0]) }); }
  return out;
}
function findAmount(n) {
  const lines = n.split('\n');
  const keys = ['total a pagar', 'valor a pagar', 'montante a pagar', 'importancia a pagar', 'a pagar', 'total geral', 'total documento', 'total', 'valor total', 'montante', 'importancia', 'valor'];
  for (const k of keys) {
    for (let i = 0; i < lines.length; i++) {
      const j = lines[i].indexOf(k); if (j < 0) continue;
      if (/subtotal|total iva|total de iva|total s\/ iva|total sem iva|base/.test(lines[i]) && k === 'total') continue;
      let a = amountsIn(lines[i].slice(j));
      if (!a.length && lines[i + 1]) a = amountsIn(lines[i + 1]);
      if (a.length) return a[a.length - 1].v;
    }
  }
  const all = amountsIn(n).filter(x => x.eur);
  return all.length ? Math.max(...all.map(x => x.v)) : null;
}
function nifValid(s) {
  if (!/^[125689]\d{8}$/.test(s) && !/^(45|70|71|72|74|75|77|79|90|91|98|99)\d{7}$/.test(s)) return false;
  let sum = 0; for (let i = 0; i < 8; i++) sum += +s[i] * (9 - i);
  const r = sum % 11, c = r < 2 ? 0 : 11 - r; return c === +s[8];
}
function findNifs(n) {
  const out = []; const rx = /(?:nif|nipc|contribuinte|contrib\.?|n\.?\s?º?\s?fiscal|pt)\D{0,18}?(\d{3}\s?\d{3}\s?\d{3})(?!\d)/g; let m;
  while ((m = rx.exec(n))) { const v = m[1].replace(/\s/g, ''); if (nifValid(v) && !out.includes(v)) out.push(v); }
  if (!out.length) { const rx2 = /(?<!\d)([125689]\d{8})(?!\d)/g; while ((m = rx2.exec(n))) if (nifValid(m[1]) && !out.includes(m[1])) out.push(m[1]); }
  return out;
}
function findPlate(t) {
  const rx = /\b([A-Z]{2}|\d{2})\s?[-–·.]\s?([A-Z]{2}|\d{2})\s?[-–·.]\s?([A-Z]{2}|\d{2})\b/g; let m;
  while ((m = rx.exec(t))) { const g = [m[1], m[2], m[3]]; if (g.some(x => /\d/.test(x)) && g.some(x => /[A-Z]/.test(x))) return g.join('-'); }
  return null;
}
const ENTITIES = [
  ['autoridade tributaria', 'Autoridade Tributária'], ['seguranca social', 'Segurança Social'], ['e-redes', 'E-Redes'], ['edp', 'EDP'], ['galp', 'Galp'], ['endesa', 'Endesa'], ['iberdrola', 'Iberdrola'], ['goldenergy', 'Goldenergy'],
  ['meo', 'MEO'], ['vodafone', 'Vodafone'], ['nowo', 'NOWO'], ['digi', 'DIGI'], ['epal', 'EPAL'], ['smas', 'SMAS'], ['via verde', 'Via Verde'], ['brisa', 'Brisa'], ['ascendi', 'Ascendi'],
  ['ansr', 'ANSR'], ['instituto da mobilidade', 'IMT'], ['registos e do notariado', 'IRN'], ['fidelidade', 'Fidelidade'], ['tranquilidade', 'Tranquilidade'], ['generali', 'Generali'], ['allianz', 'Allianz'], ['ageas', 'Ageas'], ['zurich', 'Zurich'], ['liberty', 'Liberty'], ['ok! teleseguros', 'OK! Teleseguros'],
  ['caixa geral de depositos', 'CGD'], ['millennium', 'Millennium bcp'], ['santander', 'Santander'], ['novo banco', 'Novo Banco'], ['bpi', 'BPI'], ['montepio', 'Montepio'], ['credito agricola', 'Crédito Agrícola'], ['activobank', 'ActivoBank'], ['revolut', 'Revolut'], ['ctt', 'CTT'],
  ['medis', 'Médis'], ['multicare', 'Multicare'], ['advancecare', 'AdvanceCare'], ['worten', 'Worten'], ['fnac', 'Fnac'], ['ikea', 'IKEA'], ['leroy merlin', 'Leroy Merlin'], ['continente', 'Continente'], ['pingo doce', 'Pingo Doce'], ['lidl', 'Lidl'], ['auchan', 'Auchan'], ['radio popular', 'Rádio Popular'], ['emel', 'EMEL'],
  ['camara municipal', 'Câmara Municipal'], ['junta de freguesia', 'Junta de Freguesia'],
];
function wordRx(k) { return new RegExp('(^|[^a-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9])', 'g'); }
const RXC = new Map(); function rxFor(k) { let r = RXC.get(k); if (!r) { r = wordRx(k); RXC.set(k, r); } r.lastIndex = 0; return r; }
function countKw(n, k) { const r = rxFor(k); let c = 0; while (r.exec(n) && c < 2) c++; return c; }
function findEntity(text, n) {
  let best = null;
  for (const [k, name] of ENTITIES) { const r = rxFor(k); const m = r.exec(n); if (m && (!best || m.index < best.i)) best = { i: m.index, name }; }
  if (/\bNOS\b/.test(text) && (!best || text.search(/\bNOS\b/) < best.i)) best = { i: 0, name: 'NOS' };
  if (best) return best.name;
  const bad = /fatura|recibo|data|pagina|original|duplicado|n\.?º|contribuinte|nif|exmo|cliente|documento|^\W*$/i;
  for (const l of text.split('\n').slice(0, 8)) {
    const s = l.trim(); const letters = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (s.length >= 3 && s.length <= 40 && letters / s.length > 0.65 && !bad.test(s)) return s.replace(/\s+/g, ' ');
  }
  return '';
}
const TYPES = [['nota de liquidacao', 'Nota de liquidação'], ['demonstracao de liquidacao', 'Liquidação'], ['fatura-recibo', 'Fatura-recibo'], ['fatura recibo', 'Fatura-recibo'], ['fatura simplificada', 'Fatura simplificada'], ['nota de credito', 'Nota de crédito'], ['recibo de vencimento', 'Recibo de vencimento'], ['auto de contraordenacao', 'Auto de contraordenação'], ['ficha de inspecao', 'Ficha de inspeção'], ['contrato', 'Contrato'], ['fatura', 'Fatura'], ['recibo', 'Recibo'], ['orcamento', 'Orçamento'], ['apolice', 'Apólice'], ['aviso', 'Aviso'], ['notificacao', 'Notificação'], ['declaracao', 'Declaração'], ['certificado', 'Certificado'], ['extrato', 'Extrato'], ['receita', 'Receita'], ['relatorio', 'Relatório'], ['guia', 'Guia'], ['carta', 'Carta']];
function findType(n) {
  let best = null; const head = n.slice(0, Math.max(600, Math.floor(n.length * 0.5)));
  for (const [k, name] of TYPES) { const r = rxFor(k); const m = r.exec(head); if (m && (!best || m.index < best.i)) best = { i: m.index, name }; }
  return best ? best.name : '';
}
function ignoredNifs() { return (S.set.ignoreNifs || '').split(/[^\d]+/).filter(x => x.length === 9); }

function analyze(text) {
  const n = norm(text);
  const dates = findDates(n);
  const due = dateAfter(n, dates, ['data limite de pagamento', 'data-limite de pagamento', 'data limite', 'data-limite', 'pagar ate', 'pagamento ate', 'a pagar ate', 'prazo de pagamento', 'data de vencimento', 'vencimento', 'valido ate', 'ate ao dia', 'prazo']);
  let date = dateAfter(n, dates, ['data de emissao', 'data emissao', 'data da fatura', 'data do documento', 'emitido em', 'emitida em', 'data:', 'data '], 40);
  if (!date) { const d = dates.find(x => x.iso !== due); date = d ? d.iso : null; }
  const ign = ignoredNifs();
  const nifs = findNifs(n).filter(x => !ign.includes(x));
  const nif = nifs[0] || '';
  const entity = findEntity(text, n);
  const amount = findAmount(n);
  const plate = findPlate(text);
  const type = findType(n);
  // pontuação das pastas
  const own = {};
  for (const f of S.folders) {
    let s = 0;
    for (let k of f.kw || []) { let w = 1; if (k.startsWith('!')) { w = 4; k = k.slice(1); } else if (k.includes(' ')) w = 2; if (!k) continue; s += w * countKw(n, k); }
    own[f.id] = s;
  }
  const score = {};
  for (const f of S.folders) score[f.id] = own[f.id] + (f.parent ? 0.5 * (own[f.parent] || 0) : 0) + (f.parent ? 0.01 : 0);
  // regras aprendidas
  const ek = 'ent:' + norm(entity);
  for (const k of [...nifs.map(x => 'nif:' + x), entity ? ek : null]) { const f = k && S.rules[k]; if (f && score[f] !== undefined) score[f] += 40; }
  const ranked = Object.entries(score).filter(([id]) => id !== 'outros').sort((a, b) => b[1] - a[1]);
  const folder = ranked.length && ranked[0][1] >= 3 ? ranked[0][0] : 'outros';
  const sugg = ranked.filter(([, s]) => s >= 2).slice(0, 4).map(([id]) => id);
  const fo = folderById(folder);
  const label = type || (fo && fo.id !== 'outros' ? fo.name : 'Documento');
  const when = date ? ` · ${MES_C[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}` : '';
  const title = [label, entity && !norm(label).includes(norm(entity)) ? entity : '', plate || ''].filter(Boolean).join(' ').slice(0, 70) + when;
  return { folder, sugg, title, date, due, amount, nif, entity, plate, type };
}

function learn(doc) {
  if (!doc.folder || doc.folder === 'outros') return;
  const keys = [];
  if (doc.nif && !ignoredNifs().includes(doc.nif)) keys.push('nif:' + doc.nif);
  if (doc.entity) keys.push('ent:' + norm(doc.entity));
  for (const k of keys) {
    const cur = S.rules[k];
    if (cur && cur !== doc.folder) {
      // conflito: só muda se nenhum outro documento com esta chave estiver na pasta antiga
      const others = S.docs.filter(d => d.id !== doc.id && d.folder === cur && (k === 'nif:' + d.nif || k === 'ent:' + norm(d.entity)));
      if (others.length) continue;
    }
    S.rules[k] = doc.folder;
  }
  dbPut('kv', S.rules, 'rules');
}

/* ---------------- Pastas ---------------- */
const folderById = id => S.folders.find(f => f.id === id);
const tops = () => S.folders.filter(f => !f.parent);
const kids = id => S.folders.filter(f => f.parent === id);
function folderPath(id) { const f = folderById(id); if (!f) return 'Outros'; const p = f.parent && folderById(f.parent); return p ? `${p.name} › ${f.name}` : f.name; }
function folderEmoji(id) { const f = folderById(id); if (!f) return '📁'; return f.emoji || (f.parent && folderById(f.parent)?.emoji) || '📁'; }
function countIn(id) { const ids = new Set([id, ...kids(id).map(k => k.id)]); return S.docs.filter(d => ids.has(d.folder)).length; }
function folderOptions(sel) {
  return tops().map(t => `<optgroup label="${esc(t.emoji + ' ' + t.name)}"><option value="${t.id}"${sel === t.id ? ' selected' : ''}>${esc(t.name)} (geral)</option>${kids(t.id).map(k => `<option value="${k.id}"${sel === k.id ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</optgroup>`).join('');
}
async function saveFolders() { await dbPut('kv', S.folders, 'folders'); }

/* ---------------- Documentos ---------------- */
function indexDoc(d) {
  const dt = d.date ? `${d.date} ${fmtDate(d.date)} ${MESES[+d.date.slice(5, 7) - 1]} ${d.date.slice(5, 7)}/${d.date.slice(0, 4)}` : '';
  const amt = d.amount != null ? `${String(d.amount.toFixed(2)).replace('.', ',')} ${d.amount.toFixed(2)}` : '';
  d._h = norm([d.title, d.entity, d.plate, folderPath(d.folder), d.type].join(' '));
  d._t = norm(d.text || '');
  d._s = d._h + ' ' + norm([d.nif, d.notes, dt, amt, d.due ? 'prazo ' + fmtDate(d.due) : ''].join(' ')) + ' ' + d._t;
  d._sp = d._s.replace(/[\s\-.·]+/g, '');
  return d;
}
function clean(d) { const o = {}; for (const k in d) if (k[0] !== '_') o[k] = d[k]; return o; }
async function saveDoc(d) { d.updated = Date.now(); indexDoc(d); await dbPut('docs', clean(d)); }
const docById = id => S.docs.find(d => d.id === id);
function sortDocs(a) { return a.sort((x, y) => (y.date || '').localeCompare(x.date || '') || y.created - x.created); }

/* ---------------- Imagens ---------------- */
function loadImg(blob) {
  return new Promise((res, rej) => { const i = new Image(); const u = URL.createObjectURL(blob); i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 1000); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Não consegui abrir a imagem')); }; i.src = u; });
}
async function prepImage(blob, rot = 0, max = 2200, q = 0.82) {
  const im = await loadImg(blob);
  let w = im.naturalWidth, h = im.naturalHeight; const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
  const r = ((rot % 360) + 360) % 360; const c = document.createElement('canvas');
  c.width = r % 180 ? h : w; c.height = r % 180 ? w : h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2); x.rotate(r * Math.PI / 180); x.drawImage(im, -w / 2, -h / 2, w, h);
  const out = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
  c.width = c.height = 0;
  return { blob: out, w: r % 180 ? h : w, h: r % 180 ? w : h };
}
const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function makeThumb(blob) { const { blob: t } = await prepImage(blob, 0, 300, 0.7); return blobToDataURL(t); }
const urlCache = new Map();
async function pageURL(pid) { if (urlCache.has(pid)) return urlCache.get(pid); const p = await dbGet('pages', pid); if (!p) return ''; const u = URL.createObjectURL(p.blob); urlCache.set(pid, u); return u; }
function dropURL(pid) { const u = urlCache.get(pid); if (u) { URL.revokeObjectURL(u); urlCache.delete(pid); } }

/* ---------------- OCR (Tesseract, no próprio dispositivo) ---------------- */
let ocrWorker = null, ocrLog = null;
async function getWorker() {
  if (ocrWorker) return ocrWorker;
  const base = new URL('./', location.href).href;
  ocrWorker = await Tesseract.createWorker('por', 1, {
    workerPath: base + 'vendor/worker.min.js',
    corePath: base + 'vendor/core',
    langPath: base + 'lang',
    gzip: true, workerBlobURL: false,
    logger: m => ocrLog && ocrLog(m),
  });
  return ocrWorker;
}
async function ocrBlobs(blobs) {
  const texts = [];
  busy(true, 'A preparar o leitor de texto…', 0);
  try {
    const w = await getWorker();
    for (let i = 0; i < blobs.length; i++) {
      const lbl = blobs.length > 1 ? `A ler a página ${i + 1} de ${blobs.length}…` : 'A ler o documento…';
      busy(true, lbl, i / blobs.length);
      ocrLog = m => { if (m.status === 'recognizing text') busy(true, lbl, (i + m.progress) / blobs.length); };
      const r = await w.recognize(blobs[i]);
      texts.push((r.data.text || '').replace(/\n{3,}/g, '\n\n').trim());
    }
  } finally { ocrLog = null; }
  return texts;
}

/* ---------------- Interface: utilitários ---------------- */
function busy(on, txt, p) { const b = $('#busy'); b.hidden = !on; if (txt) $('#busyTxt').textContent = txt; $('#busyBar').style.width = p == null ? '0' : Math.round(p * 100) + '%'; $('#busyBar').parentNode.style.visibility = p == null ? 'hidden' : 'visible'; }
let toastT; function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2600); }
function sheet(html) { $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; }
function closeSheet() { $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheetBg').onclick = closeSheet;
function go(h) { location.hash = h; }
function setBar(title, back, gear) { $('#title').textContent = title; $('#back').hidden = !back; $('#gear').hidden = !gear; }
$('#back').onclick = () => { if (history.length > 1 && !location.hash.match(/^#\/?$/)) history.back(); else go('#/'); };
$('#gear').onclick = () => go('#/s');

let shareItem = null;
function offerFile(blob, name, label) {
  shareItem = { blob, name };
  sheet(`<div class="grp"><p>${esc(label || name)}</p><button class="it b" data-act="doShare">Guardar ou partilhar</button></div><div class="grp"><button class="it" data-act="closeSheet">Cancelar</button></div>`);
}
async function doShare() {
  if (!shareItem) return; const { blob, name } = shareItem; closeSheet();
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
function safeName(s) { return String(s || 'documento').replace(/[\/\\:*?"<>|\n\r]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 70) || 'documento'; }

/* ---------------- Vistas ---------------- */
function docRow(d, snip) {
  let badge = '';
  if (d.review) badge = '<span class="badge b-ac">por confirmar</span>';
  else if (d.due && !d.paid) { const n = daysTo(d.due); badge = n < 0 ? `<span class="badge b-red">atrasado ${-n} d</span>` : n <= 7 ? `<span class="badge b-or">${n === 0 ? 'hoje' : 'faltam ' + n + ' d'}</span>` : ''; }
  const meta = [d.date ? fmtDate(d.date) : '', d.amount != null ? fmtEUR(d.amount) : '', folderPath(d.folder)].filter(Boolean).join(' · ');
  return `<button class="row" data-go="#/d/${d.id}"><img class="th" src="${d.thumb || ''}" alt=""><div class="mid"><div class="t">${esc(d.title || 'Documento')}</div><div class="s">${esc(meta)}</div>${snip ? `<div class="snip">${snip}</div>` : ''}</div>${badge}</button>`;
}
function vHome() {
  setBar('Arquivo', false, true);
  const v = $('#view');
  if (!S.docs.length) {
    v.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Pesquisar nos documentos" disabled></div>
    <div class="empty"><div class="big">🗂️</div><p><b>Ainda não há documentos.</b></p><p>Toca em <b>＋</b> e tira uma fotografia a um papel. A app lê o texto, percebe o tema e arquiva-o na pasta certa.</p><p class="muted">Tudo fica guardado só neste iPhone.</p></div>
    ${standaloneNote()}`;
    return;
  }
  const review = S.docs.filter(d => d.review);
  const dues = S.docs.filter(d => d.due && !d.paid && daysTo(d.due) >= -90).sort((a, b) => a.due.localeCompare(b.due));
  const recent = [...S.docs].sort((a, b) => b.created - a.created).slice(0, 6);
  const needBk = S.docs.length >= 3 && Date.now() - (S.set.lastBackup || 0) > 30 * 864e5;
  v.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Pesquisar nos documentos" value="${esc(S.q)}" autocomplete="off" autocorrect="off" spellcheck="false"></div>
  <div id="res"></div><div id="homeBody">
  ${needBk ? `<div class="note">💾 ${S.set.lastBackup ? 'Já passou mais de um mês desde a última cópia de segurança.' : 'Ainda não fizeste nenhuma cópia de segurança.'} <a href="#/s" style="color:var(--acc)">Fazer agora</a></div>` : ''}
  ${review.length ? `<h2>Por confirmar</h2><div class="card">${review.map(d => docRow(d)).join('')}</div>` : ''}
  ${dues.length ? `<h2>Prazos de pagamento</h2><div class="card">${dues.slice(0, 6).map(d => docRow(d)).join('')}</div>` : ''}
  <h2>Pastas</h2><div class="grid">${tops().map(t => { const c = countIn(t.id); return `<button class="fold" data-go="#/f/${t.id}"><span class="em">${t.emoji || '📁'}</span><b>${esc(t.name)}</b><small>${c} doc${c === 1 ? '' : 's'}</small></button>`; }).join('')}</div>
  <h2>Recentes</h2><div class="card">${recent.map(d => docRow(d)).join('')}</div>
  ${standaloneNote()}</div>`;
  const q = $('#q'); q.oninput = () => { S.q = q.value; clearTimeout(q._t); q._t = setTimeout(renderResults, 120); };
  if (S.q) renderResults();
}
function standaloneNote() {
  const sa = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (sa) return '';
  return `<div class="note blue">📲 <b>Instala a app no ecrã principal:</b> no Safari toca em <b>Partilhar</b> (o quadrado com a seta) → <b>Adicionar ao ecrã principal</b>. Usa sempre a app a partir desse ícone: os documentos guardados aqui no Safari não aparecem lá.</div>`;
}
function search(q) {
  const terms = norm(q).split(/\s+/).filter(Boolean); if (!terms.length) return [];
  const res = [];
  for (const d of S.docs) {
    let sc = 0, ok = true;
    for (const t of terms) {
      const tp = t.replace(/[\-.·]/g, '');
      if (d._s.includes(t) || (tp.length > 3 && d._sp.includes(tp))) sc += d._h.includes(t) ? 5 : 1; else { ok = false; break; }
    }
    if (ok) res.push({ d, sc });
  }
  return res.sort((a, b) => b.sc - a.sc || (b.d.date || '').localeCompare(a.d.date || '')).map(x => x.d);
}
function snippet(d, terms) {
  const t = d.text || '', n = d._t; let i = -1;
  for (const x of terms) { i = n.indexOf(x); if (i >= 0) break; }
  if (i < 0) return '';
  const a = Math.max(0, i - 45), b = Math.min(t.length, i + 90);
  const so = t.slice(a, b).replace(/\s+/g, ' '), sn = norm(so);
  const marks = [];
  for (const x of terms) { let j = sn.indexOf(x); while (j >= 0) { marks.push([j, j + x.length]); j = sn.indexOf(x, j + x.length); } }
  marks.sort((p, q) => p[0] - q[0]);
  let out = '', pos = 0;
  for (const [s, e] of marks) { if (s < pos) continue; out += esc(so.slice(pos, s)) + '<mark>' + esc(so.slice(s, e)) + '</mark>'; pos = e; }
  out += esc(so.slice(pos));
  return (a > 0 ? '…' : '') + out + (b < t.length ? '…' : '');
}
function renderResults() {
  const r = $('#res'), hb = $('#homeBody'); if (!r) return;
  const q = S.q.trim();
  if (!q) { r.innerHTML = ''; hb.hidden = false; return; }
  hb.hidden = true;
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const list = search(q);
  r.innerHTML = list.length ? `<h2>${list.length} resultado${list.length === 1 ? '' : 's'}</h2><div class="card">${list.slice(0, 100).map(d => docRow(d, snippet(d, terms))).join('')}</div>` : `<div class="empty"><p>Nada encontrado para «${esc(q)}».</p></div>`;
}
function vFolder(id) {
  const f = folderById(id); if (!f) return go('#/');
  setBar(`${f.emoji || folderEmoji(id)} ${f.name}`, true, false);
  const subs = kids(id);
  const docs = sortDocs(S.docs.filter(d => d.folder === id));
  let html = '';
  if (subs.length) html += `<div class="card">${subs.map(k => { const c = S.docs.filter(d => d.folder === k.id).length; return `<button class="row chev" data-go="#/f/${k.id}"><span class="em">${k.emoji || '📂'}</span><div class="mid"><div class="t">${esc(k.name)}</div></div><span class="n">${c}</span></button>`; }).join('')}</div>`;
  if (docs.length) {
    html += `<h2>${subs.length ? 'Documentos gerais' : 'Documentos'}</h2><div class="card">`;
    let yr = null;
    for (const d of docs) { const y = (d.date || '').slice(0, 4) || 'Sem data'; if (y !== yr) { html += `<div class="yr">${y}</div>`; yr = y; } html += docRow(d); }
    html += '</div>';
  } else if (!subs.length) html += '<div class="empty"><p>Esta pasta está vazia.</p></div>';
  html += `<button class="btn" data-go="#/fe/${id}">Editar pasta e palavras-chave</button>`;
  $('#view').innerHTML = html;
}
async function vDoc(id) {
  const d = docById(id); if (!d) return go('#/');
  setBar(d.title || 'Documento', true, false);
  const fo = folderById(d.folder);
  const sugg = (d.sugg || []).filter(x => folderById(x));
  let html = '';
  if (d.review) {
    html += `<div class="review"><p>Arquivei em <b>${esc(folderEmoji(d.folder) + ' ' + folderPath(d.folder))}</b>. Está certo?</p>
    <div class="chips"><button class="chip on" data-act="confirm">✓ Sim</button>${sugg.filter(x => x !== d.folder).map(x => `<button class="chip" data-act="setFolder" data-f="${x}">${esc(folderPath(x))}</button>`).join('')}<button class="chip" data-act="pickFolder">Outra…</button></div></div>`;
  }
  html += `<div class="pages" id="pages">${d.pages.map((p, i) => `<div class="pg"><img data-pid="${p}" alt="Página ${i + 1}"><span class="num">${i + 1}/${d.pages.length}</span><div class="tools"><button data-act="rotPage" data-i="${i}" aria-label="Rodar">↻</button>${d.pages.length > 1 ? `<button data-act="delPage" data-i="${i}" aria-label="Apagar página">✕</button>` : ''}</div></div>`).join('')}</div>`;
  const dueInfo = d.due ? (d.paid ? '<span class="badge b-gr">pago</span>' : (n => n < 0 ? `<span class="badge b-red">atrasado ${-n} d</span>` : `<span class="badge b-or">${n === 0 ? 'hoje' : 'faltam ' + n + ' d'}</span>`)(daysTo(d.due))) : '';
  html += `<h2>Dados</h2><div class="card form">
   <div class="f"><label>Título</label><input data-field="title" value="${esc(d.title)}"></div>
   <div class="f"><label>Pasta</label><select data-field="folder">${folderOptions(d.folder)}</select></div>
   <div class="f"><label>Data</label><input type="date" data-field="date" value="${esc(d.date || '')}"></div>
   <div class="f"><label>Entidade</label><input data-field="entity" value="${esc(d.entity)}" placeholder="—"></div>
   <div class="f"><label>NIF</label><input data-field="nif" inputmode="numeric" value="${esc(d.nif)}" placeholder="—"></div>
   <div class="f"><label>Valor (€)</label><input data-field="amount" inputmode="decimal" value="${d.amount != null ? String(d.amount.toFixed(2)).replace('.', ',') : ''}" placeholder="—"></div>
   <div class="f"><label>Prazo</label><input type="date" data-field="due" value="${esc(d.due || '')}">${dueInfo}</div>
   ${d.due ? `<div class="f"><label>Já paguei</label><span style="flex:1"></span><input type="checkbox" data-field="paid"${d.paid ? ' checked' : ''}></div>` : ''}
   <div class="f"><label>Matrícula</label><input data-field="plate" value="${esc(d.plate || '')}" placeholder="—" autocapitalize="characters"></div>
   <div class="f col"><label>Notas</label><textarea data-field="notes" rows="2" placeholder="Escreve aqui o que quiseres">${esc(d.notes || '')}</textarea></div>
  </div>
  ${d.due ? `<button class="btn pri" data-act="calendar">📅 Adicionar prazo ao Calendário</button>` : ''}
  <div class="btns"><button class="btn" data-act="pdf">📄 Exportar PDF</button><button class="btn" data-act="addPage">＋ Página</button></div>
  <h2>Texto lido</h2><details class="card"><summary>${d.text ? 'Ver e corrigir o texto' : 'Sem texto'}</summary><textarea data-field="text" spellcheck="false">${esc(d.text || '')}</textarea></details>
  <button class="btn" data-act="reocr">🔍 Ler o texto outra vez</button>
  <button class="btn red" data-act="delDoc">Apagar documento</button>
  <p class="muted" style="text-align:center;margin-top:16px">Criado em ${fmtDate(isoFromTs(d.created))}</p>`;
  const v = $('#view'); v.innerHTML = html;
  for (const img of v.querySelectorAll('img[data-pid]')) pageURL(img.dataset.pid).then(u => img.src = u);
}
function isoFromTs(ts) { const d = new Date(ts); return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

function vNew() {
  const dr = S.draft;
  if (!dr || !dr.pages.length) return go('#/');
  setBar(dr.docId ? 'Adicionar páginas' : 'Novo documento', true, false);
  $('#view').innerHTML = `<p class="muted">Confirma que as páginas estão direitas (usa ↻ para rodar). Podes juntar várias páginas no mesmo documento.</p>
  <div class="dgrid">${dr.pages.map((p, i) => `<div class="dp"><img src="${p.url}" alt=""><span class="num">${i + 1}</span><div class="tools"><span><button data-act="dMove" data-i="${i}" data-d="-1"${i === 0 ? ' hidden' : ''}>◀</button> <button data-act="dMove" data-i="${i}" data-d="1"${i === dr.pages.length - 1 ? ' hidden' : ''}>▶</button></span><span><button data-act="dRot" data-i="${i}">↻</button> <button data-act="dDel" data-i="${i}">✕</button></span></div></div>`).join('')}</div>
  <div class="btns"><button class="btn" data-act="cam">📷 Mais uma</button><button class="btn" data-act="gal">🖼 Galeria</button></div>
  <button class="btn pri" data-act="process">${dr.docId ? 'Ler e juntar ao documento' : `Ler e arquivar (${dr.pages.length} página${dr.pages.length === 1 ? '' : 's'})`}</button>
  <button class="btn red" data-act="dCancel">Cancelar</button>`;
}

async function vSettings() {
  setBar('Definições', true, false);
  let est = null; try { est = await navigator.storage?.estimate(); } catch (e) { }
  let pers = null; try { pers = await navigator.storage?.persisted(); } catch (e) { }
  const mb = x => (x / 1048576).toFixed(x > 1e8 ? 0 : 1) + ' MB';
  $('#view').innerHTML = `<h2>Cópia de segurança</h2><div class="card form"><div class="f"><label>Última</label><span style="flex:1;text-align:right">${S.set.lastBackup ? fmtDate(isoFromTs(S.set.lastBackup)) : 'nunca'}</span></div></div>
  <button class="btn pri" data-act="backup">💾 Exportar cópia (.zip)</button>
  <button class="btn" data-act="restore">Importar cópia</button>
  <p class="muted">O ficheiro .zip leva todos os documentos e as fotografias, já organizados por pastas. Guarda-o em «Ficheiros → No meu iPhone», numa pen ou no computador. Se apagares a app ou os dados do Safari, só esta cópia salva os documentos.</p>
  <h2>Armazenamento</h2><div class="card form">
   <div class="f"><label>Documentos</label><span style="flex:1;text-align:right">${S.docs.length}</span></div>
   ${est ? `<div class="f"><label>Espaço usado</label><span style="flex:1;text-align:right">${mb(est.usage || 0)}</span></div>` : ''}
   <div class="f"><label>Proteção</label><span style="flex:1;text-align:right">${pers ? '✅ persistente' : pers === false ? 'normal' : '—'}</span></div></div>
   ${pers === false ? '<button class="btn" data-act="persist">Pedir armazenamento persistente</button>' : ''}
  <h2>Os vossos NIF</h2><div class="card form"><div class="f col"><label>NIFs a ignorar na identificação da entidade (o teu, o da tua companheira…)</label><input data-set="ignoreNifs" inputmode="numeric" value="${esc(S.set.ignoreNifs || '')}" placeholder="123456789, 987654321"></div></div>
  <h2>Pastas</h2><div class="card">${tops().map(t => `<button class="row chev" data-go="#/fe/${t.id}"><span class="em">${t.emoji || '📁'}</span><div class="mid"><div class="t">${esc(t.name)}</div><div class="s">${kids(t.id).map(k => esc(k.name)).join(', ') || 'sem subpastas'}</div></div></button>`).join('')}</div>
  <button class="btn" data-act="newTop">＋ Nova pasta</button>
  <h2>Aprendizagem</h2><div class="card form"><div class="f"><label>Regras</label><span style="flex:1;text-align:right">${Object.keys(S.rules).length} aprendidas</span></div></div>
  <button class="btn red" data-act="clearRules">Esquecer o que aprendeu</button>
  <p class="muted" style="text-align:center;margin-top:20px">Arquivo ${VERSION} · nada sai deste dispositivo</p>`;
}
function vFolderEdit(id) {
  const f = folderById(id); if (!f) return go('#/s');
  setBar('Editar pasta', true, false);
  const isTop = !f.parent;
  $('#view').innerHTML = `<div class="card form">
   <div class="f"><label>Nome</label><input data-ff="name" value="${esc(f.name)}"></div>
   ${isTop ? `<div class="f"><label>Ícone</label><input data-ff="emoji" value="${esc(f.emoji || '')}" maxlength="4"></div>` : `<div class="f"><label>Dentro de</label><select data-ff="parent">${tops().map(t => `<option value="${t.id}"${t.id === f.parent ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`}
  </div>
  <h2>Palavras-chave</h2><div class="card"><textarea class="kwbox" data-ff="kw" placeholder="uma por linha">${esc((f.kw || []).join('\n'))}</textarea></div>
  <p class="muted">Uma por linha, sem acentos. Começa com <b>!</b> as que identificam a pasta quase de certeza (por exemplo <b>!iuc</b>). A app também aprende sozinha quando corriges a pasta de um documento.</p>
  ${isTop ? `<h2>Subpastas</h2><div class="card">${kids(id).map(k => `<button class="row chev" data-go="#/fe/${k.id}"><span class="em">📂</span><div class="mid"><div class="t">${esc(k.name)}</div></div></button>`).join('') || '<div class="row muted">Sem subpastas</div>'}</div><button class="btn" data-act="newSub" data-f="${id}">＋ Nova subpasta</button>` : ''}
  ${id !== 'outros' ? `<button class="btn red" data-act="delFolder" data-f="${id}">Apagar pasta</button>` : ''}`;
}

function render() {
  closeSheet();
  const h = location.hash.replace(/^#\/?/, ''); const [a, b] = h.split('/');
  window.scrollTo(0, 0);
  $('#fab').hidden = !(a === '' || a === 'f');
  if (a === 'f') vFolder(b);
  else if (a === 'd') vDoc(b);
  else if (a === 'new') vNew();
  else if (a === 's') vSettings();
  else if (a === 'fe') vFolderEdit(b);
  else vHome();
}

/* ---------------- Ações ---------------- */
let pickFor = null; // null = novo documento; id = adicionar ao documento
$('#fab').onclick = () => { pickFor = null; addSheet(); };
function addSheet() {
  sheet(`<div class="grp"><button class="it" data-act="cam">📷 Tirar fotografia</button><button class="it" data-act="gal">🖼 Escolher da galeria</button></div><div class="grp"><button class="it b" data-act="closeSheet">Cancelar</button></div>`);
}
async function onPicked(files) {
  files = [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name)); if (!files.length) return;
  closeSheet();
  if (!S.draft || (S.draft.docId || null) !== pickFor) { clearDraft(); S.draft = { docId: pickFor, pages: [] }; }
  busy(true, 'A preparar as fotografias…', null);
  try {
    for (const f of files) { const r = await prepImage(f); S.draft.pages.push({ blob: r.blob, url: URL.createObjectURL(r.blob) }); }
  } catch (e) { alert(e.message); }
  busy(false);
  if (location.hash === '#/new') vNew(); else go('#/new');
}
function clearDraft() { if (S.draft) for (const p of S.draft.pages) URL.revokeObjectURL(p.url); S.draft = null; }
$('#camIn').onchange = e => { onPicked(e.target.files); e.target.value = ''; };
$('#galIn').onchange = e => { onPicked(e.target.files); e.target.value = ''; };
$('#impIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };

async function processDraft() {
  const dr = S.draft; if (!dr) return;
  let texts;
  try { texts = await ocrBlobs(dr.pages.map(p => p.blob)); }
  catch (e) { busy(false); console.error(e); alert('Não consegui ler o texto: ' + (e.message || e) + '\nO documento fica guardado na mesma e podes tentar ler outra vez mais tarde.'); texts = dr.pages.map(() => ''); }
  busy(true, 'A arquivar…', 1);
  try {
    if (dr.docId) {
      const d = docById(dr.docId); if (!d) throw new Error('Documento não encontrado');
      for (let i = 0; i < dr.pages.length; i++) { const pid = uid(); await dbPut('pages', { id: pid, docId: d.id, blob: dr.pages[i].blob }); d.pages.push(pid); }
      d.text = [d.text, ...texts].filter(Boolean).join('\n\n');
      await saveDoc(d); clearDraft(); busy(false);
      history.replaceState(null, '', '#/d/' + d.id); render(); toast('Páginas adicionadas');
      return;
    }
    const text = texts.join('\n\n');
    const a = analyze(text);
    const id = uid(); const pages = [];
    for (const p of dr.pages) { const pid = uid(); await dbPut('pages', { id: pid, docId: id, blob: p.blob }); pages.push(pid); }
    const d = { id, created: Date.now(), pages, thumb: await makeThumb(dr.pages[0].blob), text, title: a.title, folder: a.folder, sugg: a.sugg, date: a.date || todayISO(), due: a.due || '', paid: false, amount: a.amount, nif: a.nif, entity: a.entity, plate: a.plate || '', type: a.type, notes: '', review: true };
    S.docs.push(d); await saveDoc(d);
    clearDraft(); busy(false);
    askPersist();
    history.replaceState(null, '', '#/d/' + id); render();
  } catch (e) { busy(false); alert('Erro ao guardar: ' + (e.message || e)); }
}
async function askPersist() { try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { } }

function curDoc() { const m = location.hash.match(/^#\/d\/(.+)$/); return m && docById(m[1]); }
async function setDocFolder(d, f) { d.folder = f; d.review = false; learn(d); await saveDoc(d); }

const ACT = {
  closeSheet, doShare,
  cam: () => { closeSheet(); $('#camIn').click(); },
  gal: () => { closeSheet(); $('#galIn').click(); },
  process: processDraft,
  dCancel: () => { clearDraft(); history.back(); },
  dRot: async el => { const p = S.draft.pages[+el.dataset.i]; const r = await prepImage(p.blob, 90, 4000, 0.9); URL.revokeObjectURL(p.url); p.blob = r.blob; p.url = URL.createObjectURL(r.blob); vNew(); },
  dDel: el => { const p = S.draft.pages.splice(+el.dataset.i, 1)[0]; URL.revokeObjectURL(p.url); if (!S.draft.pages.length) { clearDraft(); history.back(); } else vNew(); },
  dMove: el => { const i = +el.dataset.i, j = i + +el.dataset.d, a = S.draft.pages; [a[i], a[j]] = [a[j], a[i]]; vNew(); },
  confirm: async () => { const d = curDoc(); await setDocFolder(d, d.folder); toast('Arquivado em ' + folderPath(d.folder)); vDoc(d.id); },
  setFolder: async el => { const d = curDoc(); await setDocFolder(d, el.dataset.f); toast('Movido para ' + folderPath(d.folder)); vDoc(d.id); },
  pickFolder: () => { const d = curDoc(); sheet(`<div class="grp"><p>Escolhe a pasta</p><div style="padding:8px 14px 14px"><select id="pf" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg)">${folderOptions(d.folder)}</select></div><button class="it b" data-act="pickOk">Guardar</button></div><div class="grp"><button class="it" data-act="closeSheet">Cancelar</button></div>`); },
  pickOk: async () => { const d = curDoc(); const f = $('#pf').value; closeSheet(); await setDocFolder(d, f); toast('Arquivado em ' + folderPath(f)); vDoc(d.id); },
  rotPage: async el => {
    const d = curDoc(); const pid = d.pages[+el.dataset.i]; const p = await dbGet('pages', pid);
    busy(true, 'A rodar…', null); const r = await prepImage(p.blob, 90, 4000, 0.9); p.blob = r.blob; await dbPut('pages', p); dropURL(pid);
    if (+el.dataset.i === 0) d.thumb = await makeThumb(r.blob);
    await saveDoc(d); busy(false); vDoc(d.id);
  },
  delPage: async el => { const d = curDoc(); if (!confirm('Apagar esta página?')) return; const pid = d.pages.splice(+el.dataset.i, 1)[0]; await dbDel('pages', pid); dropURL(pid); if (+el.dataset.i === 0) { const p = await dbGet('pages', d.pages[0]); d.thumb = await makeThumb(p.blob); } await saveDoc(d); vDoc(d.id); },
  addPage: () => { pickFor = curDoc().id; addSheet(); },
  reocr: async () => {
    const d = curDoc(); if (!confirm('Ler o texto outra vez? O texto atual (e as correções que fizeste) é substituído.')) return;
    const blobs = []; for (const pid of d.pages) blobs.push((await dbGet('pages', pid)).blob);
    try { const t = await ocrBlobs(blobs); d.text = t.join('\n\n'); const a = analyze(d.text); for (const k of ['date', 'due', 'amount', 'nif', 'entity', 'plate', 'type']) if (!d[k] && a[k]) d[k] = a[k]; d.sugg = a.sugg; await saveDoc(d); busy(false); vDoc(d.id); toast('Texto atualizado'); }
    catch (e) { busy(false); alert('Não consegui ler: ' + (e.message || e)); }
  },
  delDoc: async () => { const d = curDoc(); if (!confirm('Apagar este documento de vez?')) return; for (const pid of d.pages) { await dbDel('pages', pid); dropURL(pid); } await dbDel('docs', d.id); S.docs = S.docs.filter(x => x !== d); toast('Documento apagado'); history.back(); },
  pdf: async () => {
    const d = curDoc(); busy(true, 'A criar o PDF…', null);
    try {
      const { jsPDF } = window.jspdf; let pdf = null;
      for (const pid of d.pages) {
        const b = (await dbGet('pages', pid)).blob; const im = await loadImg(b); const w = im.naturalWidth, h = im.naturalHeight;
        const land = w > h; const W = land ? 297 : 210, H = land ? 210 : 297;
        if (!pdf) pdf = new jsPDF({ orientation: land ? 'l' : 'p', unit: 'mm', format: 'a4', compress: true }); else pdf.addPage('a4', land ? 'l' : 'p');
        const s = Math.min((W - 10) / w, (H - 10) / h); const iw = w * s, ih = h * s;
        pdf.addImage(new Uint8Array(await b.arrayBuffer()), 'JPEG', (W - iw) / 2, (H - ih) / 2, iw, ih);
      }
      pdf.setProperties({ title: d.title, subject: folderPath(d.folder), keywords: (d.text || '').slice(0, 2000) });
      busy(false); offerFile(pdf.output('blob'), safeName(d.title) + '.pdf', 'O PDF está pronto');
    } catch (e) { busy(false); alert('Erro a criar o PDF: ' + e.message); }
  },
  calendar: () => {
    const d = curDoc(); if (!d.due) return;
    const ymd = d.due.replace(/-/g, ''); const nx = new Date(d.due + 'T00:00:00'); nx.setDate(nx.getDate() + 1);
    const end = isoOf(nx.getFullYear(), nx.getMonth() + 1, nx.getDate()).replace(/-/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const e = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const sum = `Pagar: ${d.title}${d.amount != null ? ' (' + fmtEUR(d.amount) + ')' : ''}`;
    const desc = [d.entity, folderPath(d.folder), d.amount != null ? 'Valor: ' + fmtEUR(d.amount) : '', d.notes].filter(Boolean).join('\n');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Arquivo//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${d.id}@arquivo`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${e(sum)}`, `DESCRIPTION:${e(desc)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(sum)}`, 'TRIGGER:-P2DT15H', 'END:VALARM', 'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${e(sum)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = safeName(sum) + '.ics'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 8000);
    toast('Toca em «Adicionar» para guardar no Calendário (avisos 3 dias antes e no próprio dia)');
  },
  backup: () => exportBackup(),
  restore: () => $('#impIn').click(),
  persist: async () => { await askPersist(); vSettings(); },
  clearRules: async () => { if (!confirm('Esquecer todas as regras aprendidas?')) return; S.rules = {}; await dbPut('kv', S.rules, 'rules'); vSettings(); },
  newTop: async () => { const n = prompt('Nome da nova pasta'); if (!n) return; const f = { id: 'u-' + uid(), name: n.trim(), emoji: '📁', kw: [] }; S.folders.splice(S.folders.findIndex(x => x.id === 'outros'), 0, f); await saveFolders(); go('#/fe/' + f.id); },
  newSub: async el => { const n = prompt('Nome da nova subpasta'); if (!n) return; const f = { id: 'u-' + uid(), parent: el.dataset.f, name: n.trim(), kw: [] }; S.folders.push(f); await saveFolders(); vFolderEdit(el.dataset.f); },
  delFolder: async el => {
    const f = folderById(el.dataset.f); const ids = [f.id, ...kids(f.id).map(k => k.id)];
    const n = S.docs.filter(d => ids.includes(d.folder)).length; const dest = f.parent || 'outros';
    if (!confirm(`Apagar a pasta «${f.name}»${kids(f.id).length ? ' e as subpastas' : ''}?${n ? `\nOs ${n} documentos passam para «${folderPath(dest)}».` : ''}`)) return;
    for (const d of S.docs) if (ids.includes(d.folder)) { d.folder = dest; await saveDoc(d); }
    S.folders = S.folders.filter(x => !ids.includes(x.id)); for (const k in S.rules) if (ids.includes(S.rules[k])) delete S.rules[k];
    await saveFolders(); await dbPut('kv', S.rules, 'rules'); history.back();
  },
};
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]'); if (a) { e.preventDefault(); const f = ACT[a.dataset.act]; if (f) f(a, e); return; }
  const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const img = e.target.closest('.pg img'); if (img && img.src) { $('#vImg').src = img.src; $('#viewer').hidden = false; }
});
$('#vClose').onclick = () => { $('#viewer').hidden = true; };
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.field) {
    const d = curDoc(); if (!d) return; const k = el.dataset.field; let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'amount') { v = v.trim() ? parseFloat(v.replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) : null; if (v != null && isNaN(v)) v = null; }
    if (k === 'plate') v = v.toUpperCase();
    if (k === 'folder') { await setDocFolder(d, v); toast('Movido para ' + folderPath(v)); return vDoc(d.id); }
    d[k] = v; await saveDoc(d);
    if (k === 'title') setBar(v || 'Documento', true, false);
    if (k === 'due' || k === 'paid' || k === 'amount') vDoc(d.id); else toast('Guardado');
  } else if (el.dataset.ff) {
    const id = location.hash.split('/')[2]; const f = folderById(id); if (!f) return; const k = el.dataset.ff;
    if (k === 'kw') f.kw = el.value.split('\n').map(x => norm(x.trim())).filter(Boolean);
    else if (k === 'name') f.name = el.value.trim() || f.name;
    else f[k] = el.value;
    await saveFolders(); S.docs.forEach(indexDoc); toast('Guardado');
  } else if (el.dataset.set) {
    S.set[el.dataset.set] = el.value; await dbPut('kv', S.set, 'set'); toast('Guardado');
  }
});

/* ---------------- Cópia de segurança (ZIP sem compressão) ---------------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function makeZip(files, onp) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  const d = new Date(); const dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; onp && onp(i / files.length);
    const u8 = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
    const crc = crc32(u8), nm = enc.encode(f.name), size = u8.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true);
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, nm.length, true);
    parts.push(h.buffer, nm, typeof f.data === 'string' ? u8 : f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    cen.push(c.buffer, nm); off += 30 + nm.length + size;
  }
  let cs = 0; for (const p of cen) cs += p.byteLength;
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, e.buffer], { type: 'application/zip' });
}
async function readZip(file) {
  const tl = Math.min(file.size, 65557); const tail = new DataView(await file.slice(file.size - tl).arrayBuffer());
  let p = -1; for (let i = tl - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { p = i; break; }
  if (p < 0) throw new Error('O ficheiro não é uma cópia válida (.zip).');
  const n = tail.getUint16(p + 10, true), cs = tail.getUint32(p + 12, true), co = tail.getUint32(p + 16, true);
  const cd = new DataView(await file.slice(co, co + cs).arrayBuffer()); const dec = new TextDecoder(); const ent = {}; let q = 0;
  for (let k = 0; k < n; k++) {
    const nl = cd.getUint16(q + 28, true), el = cd.getUint16(q + 30, true), cl = cd.getUint16(q + 32, true);
    ent[dec.decode(new Uint8Array(cd.buffer, q + 46, nl))] = { method: cd.getUint16(q + 10, true), size: cd.getUint32(q + 20, true), lo: cd.getUint32(q + 42, true) };
    q += 46 + nl + el + cl;
  }
  return {
    has: nm => !!ent[nm],
    async blob(nm, type) { const e = ent[nm]; if (!e) return null; if (e.method !== 0) throw new Error('A cópia foi recomprimida por outra app e não a consigo ler.'); const h = new DataView(await file.slice(e.lo, e.lo + 30).arrayBuffer()); const s = e.lo + 30 + h.getUint16(26, true) + h.getUint16(28, true); return file.slice(s, s + e.size, type); },
  };
}
async function exportBackup() {
  if (!S.docs.length) return toast('Ainda não há documentos');
  busy(true, 'A preparar a cópia…', 0);
  try {
    const files = [], meta = { app: 'arquivo', version: 1, exported: new Date().toISOString(), folders: S.folders, rules: S.rules, set: { ignoreNifs: S.set.ignoreNifs }, docs: [] };
    const used = new Set();
    for (const d of sortDocs([...S.docs])) {
      const fo = folderById(d.folder), par = fo && fo.parent ? folderById(fo.parent) : null;
      let dir = 'documentos/' + [par ? par.name : null, fo ? fo.name : 'Outros'].filter(Boolean).map(safeName).join('/') + '/' + safeName(`${d.date || ''} ${d.title}`);
      let dd = dir, k = 2; while (used.has(dd)) dd = dir + ' (' + k++ + ')'; used.add(dd);
      const pages = [];
      for (let i = 0; i < d.pages.length; i++) { const p = await dbGet('pages', d.pages[i]); if (!p) continue; const path = `${dd}/pagina-${i + 1}.jpg`; files.push({ name: path, data: p.blob }); pages.push({ id: p.id, path }); }
      if (d.text) files.push({ name: `${dd}/texto.txt`, data: d.text });
      meta.docs.push({ ...clean(d), pages });
    }
    files.unshift({ name: 'arquivo.json', data: JSON.stringify(meta) });
    const zip = await makeZip(files, p => busy(true, 'A preparar a cópia…', p));
    S.set.lastBackup = Date.now(); await dbPut('kv', S.set, 'set');
    busy(false);
    offerFile(zip, `Arquivo-copia-${todayISO()}.zip`, `Cópia pronta: ${S.docs.length} documentos, ${(zip.size / 1048576).toFixed(1)} MB. Escolhe «Guardar em Ficheiros».`);
  } catch (e) { busy(false); alert('Erro na cópia: ' + e.message); }
}
async function importBackup(file) {
  busy(true, 'A ler a cópia…', 0);
  try {
    const z = await readZip(file); if (!z.has('arquivo.json')) throw new Error('Este .zip não é uma cópia do Arquivo.');
    const meta = JSON.parse(await (await z.blob('arquivo.json')).text());
    for (const f of meta.folders || []) if (!folderById(f.id)) S.folders.push(f);
    S.rules = { ...meta.rules, ...S.rules };
    if (!S.set.ignoreNifs && meta.set?.ignoreNifs) S.set.ignoreNifs = meta.set.ignoreNifs;
    let added = 0, skipped = 0;
    for (let i = 0; i < meta.docs.length; i++) {
      busy(true, 'A importar…', i / meta.docs.length);
      const m = meta.docs[i]; if (docById(m.id)) { skipped++; continue; }
      const ids = [];
      for (const p of m.pages) { const b = await z.blob(p.path, 'image/jpeg'); if (!b) continue; const blob = new Blob([await b.arrayBuffer()], { type: 'image/jpeg' }); await dbPut('pages', { id: p.id, docId: m.id, blob }); ids.push(p.id); }
      const d = { ...m, pages: ids }; S.docs.push(d); await saveDoc(d); added++;
    }
    await saveFolders(); await dbPut('kv', S.rules, 'rules'); await dbPut('kv', S.set, 'set');
    busy(false); alert(`Cópia importada: ${added} documentos novos${skipped ? `, ${skipped} já existiam` : ''}.`); render();
  } catch (e) { busy(false); alert('Erro ao importar: ' + e.message); }
}

/* ---------------- Arranque ---------------- */
(async function init() {
  try { DB = await idbOpen(); } catch (e) { $('#view').innerHTML = `<div class="empty"><p>Este browser não deixa guardar dados (${esc(e.message)}). Sai do modo privado e tenta outra vez.</p></div>`; return; }
  S.folders = (await dbGet('kv', 'folders')) || DEFAULT_FOLDERS.map(f => ({ ...f, kw: [...f.kw] }));
  S.rules = (await dbGet('kv', 'rules')) || {};
  S.set = Object.assign(S.set, (await dbGet('kv', 'set')) || {});
  S.docs = ((await dbAll('docs')) || []).map(indexDoc);
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
