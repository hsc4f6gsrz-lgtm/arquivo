'use strict';
/* Arquivo — arquivo de documentos em papel. Tudo fica guardado só neste dispositivo. */
const VERSION = '1.9';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- Base de dados local (IndexedDB) ---------------- */
let DB;
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('arquivo-docs', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const st of ['docs', 'pages', 'files']) if (!d.objectStoreNames.contains(st)) d.createObjectStore(st, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
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
const S = { docs: [], cars: [], carFilter: 'todos', carTab: 'contas', carYear: null, carDraft: null, pendingCar: null, folders: [], rules: {}, set: { ignoreNifs: '', lastBackup: 0, lastFull: 0, bkFreq: '7', bkSnooze: 0 }, draft: null, q: '' };

/* ---------------- Pastas por omissão ---------------- */
// "!" = palavra-chave forte. Tudo sem acentos e em minúsculas.
const DEFAULT_FOLDERS = [
  { id: 'financas', name: 'Finanças', emoji: '💶', kw: ['!autoridade tributaria', 'financas', '!portal das financas', 'contribuinte'] },
  { id: 'fin-irs', parent: 'financas', name: 'IRS e impostos', kw: ['!irs', '!nota de liquidacao', '!declaracao de rendimentos', 'modelo 3', '!reembolso', 'imposto', 'coleta', '!demonstracao de liquidacao', 'e-fatura', 'rendimento coletavel'] },
  { id: 'fin-ss', parent: 'financas', name: 'Segurança Social', kw: ['!seguranca social', '!niss', 'contribuicoes', 'prestacoes sociais', 'abono', 'subsidio de desemprego', 'trabalhadores independentes'] },
  { id: 'fin-banco', parent: 'financas', name: 'Banco e crédito', kw: ['!extrato', 'iban', '!credito', 'emprestimo', 'prestacao', 'taeg', 'cartao de credito', 'caixa geral de depositos', 'millennium', 'santander', 'novo banco', 'bpi', 'montepio', 'credito agricola', 'activobank', 'revolut', 'banco', 'saldo'] },
  { id: 'fin-seguros', parent: 'financas', name: 'Seguros', kw: ['apolice', 'seguro', 'premio', 'tomador do seguro', 'segurado', 'fidelidade', 'tranquilidade', 'allianz', 'ageas', 'generali', 'zurich', 'liberty', 'sinistro', 'acidente de trabalho'] },
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
  const keys = ['liquido a receber', 'total liquido', 'valor liquido', 'liquido a pagar', 'total a pagar', 'valor a pagar', 'montante a pagar', 'importancia a pagar', 'valor a reembolsar', 'a pagar', 'total geral', 'total documento', 'total', 'valor total', 'montante', 'importancia', 'valor'];
  for (const k of keys) {
    for (let i = 0; i < lines.length; i++) {
      const j = lines[i].indexOf(k); if (j < 0) continue;
      if (k === 'total' && /subtotal|total iva|total de iva|total s\/ iva|total sem iva|base|descontos|abonos|ilíquido|iliquido/.test(lines[i])) continue;
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
function findPlate(t) { const b = bestPlate(t); return b && b.sc <= -0.38 ? b.plate : null; }
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
  const lab = /(?:^|\n)\s*(?:senhorio|senhoria|emitente|fornecedor|entidade empregadora|empregador|entidade patronal|vendedor)\s*:?\s*([^\n,;|]{3,45})/i.exec(text);
  if (lab) { const v = lab[1].split(/\.\s/)[0].replace(/\s*(NIF|NIPC|Contribuinte).*$/i, '').trim(); if (v.length >= 3) return v; }
  const firstLines = text.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 4).join('\n'), fl = norm(firstLines);
  for (const [k, name] of ENTITIES) { const r = rxFor(k); if (r.exec(fl)) return name; }
  const cand = firstLineEntity(text); if (cand) return cand;
  let best = null;
  const cut = Math.max(350, Math.floor(n.length * 0.3)); const hn = n.slice(0, cut), ht = text.slice(0, cut);
  for (const [k, name] of ENTITIES) { const r = rxFor(k); const m = r.exec(hn); if (m && (!best || m.index < best.i)) best = { i: m.index, name }; }
  if (/\bNOS\b/.test(ht) && (!best || ht.search(/\bNOS\b/) < best.i)) best = { i: 0, name: 'NOS' };
  return best ? best.name : '';
}
function firstLineEntity(text) {
  const bad = /fatura|recibo|data|pagina|original|duplicado|rep[uú]blica|certificado|n\.?º|contribuinte|nif|exmo|cliente|documento|aviso|nome|tomador|arrendat|inquilino|per[ií]odo|^\W*$|:/i;
  for (const l of text.split('\n').slice(0, 6)) {
    const s = l.trim(); const letters = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    if (s.length >= 3 && s.length <= 45 && letters / s.length > 0.65 && !bad.test(s)) return s.replace(/\s+/g, ' ').replace(/[,.\s]+$/, '');
  }
  return '';
}
const TYPES = [['nota de liquidacao', 'Nota de liquidação'], ['demonstracao de liquidacao', 'Liquidação'], ['fatura-recibo', 'Fatura-recibo'], ['fatura recibo', 'Fatura-recibo'], ['fatura simplificada', 'Fatura simplificada'], ['nota de credito', 'Nota de crédito'], ['recibo de vencimento', 'Recibo de vencimento'], ['auto de contraordenacao', 'Auto de contraordenação'], ['ficha de inspecao', 'Ficha de inspeção'], ['contrato', 'Contrato'], ['fatura', 'Fatura'], ['recibo', 'Recibo'], ['orcamento', 'Orçamento'], ['apolice', 'Apólice'], ['aviso', 'Aviso'], ['notificacao', 'Notificação'], ['declaracao', 'Declaração'], ['certificado', 'Certificado'], ['extrato', 'Extrato'], ['receita', 'Receita'], ['relatorio', 'Relatório'], ['guia', 'Guia'], ['carta', 'Carta']];
function findType(n) {
  let best = null; const head = n.slice(0, Math.max(400, Math.floor(n.length * 0.35)));
  for (const [k, name] of TYPES) { const r = rxFor(k); const m = r.exec(head); if (m && (!best || m.index < best.i)) best = { i: m.index, name }; }
  return best ? best.name : '';
}
function ignoredNifs() { return (S.set.ignoreNifs || '').split(/[^\d]+/).filter(x => x.length === 9); }

/* Assinaturas: conjuntos de expressões que, juntas, identificam um tipo de documento com segurança */
const DOC_SIGS = [
  { f: 'trab-rec', type: 'Recibo de vencimento', min: 3, k: ['recibo de vencimento', 'vencimento base', 'liquido a receber', 'total de abonos', 'total abonos', 'total de descontos', 'total descontos', 'subsidio de alimentacao', 'subsidio alimentacao', 'seguranca social', 'irs', 'remuneracao', 'categoria profissional', 'niss', 'vencimento', 'abonos', 'descontos', 'retencao', 'horas extra', 'diuturnidades', 'ferias', 'natal'] },
  { f: 'car-iuc', type: 'IUC', min: 2, k: ['imposto unico de circulacao', 'iuc', 'ano do imposto', 'matricula', 'categoria b', 'cilindrada', 'documento de cobranca'] },
  { f: 'fin-irs', type: 'IRS', min: 2, k: ['nota de liquidacao', 'demonstracao de liquidacao', 'rendimento coletavel', 'coleta', 'reembolso', 'declaracao de rendimentos', 'modelo 3', 'irs', 'deducoes a coleta', 'imposto a pagar'] },
  { f: 'casa-energia', type: 'Fatura de eletricidade', min: 2, k: ['kwh', 'potencia contratada', 'cpe', 'eletricidade', 'energia ativa', 'termo de potencia', 'gas natural', 'cui', 'contribuicao audiovisual', 'imposto especial de consumo'] },
  { f: 'casa-agua', type: 'Fatura da água', min: 3, k: ['agua', 'm3', 'saneamento', 'residuos', 'contador', 'tarifa fixa', 'tarifa variavel', 'consumo de agua'] },
  { f: 'casa-telecom', type: 'Fatura de telecomunicações', min: 3, k: ['tarifario', 'internet', 'mensalidade', 'telemovel', 'chamadas', 'dados moveis', 'fibra', 'televisao', 'box', 'roaming', 'numero de telefone', 'pacote'] },
  { f: 'casa-renda', type: 'Recibo de renda', min: 2, k: ['renda', 'senhorio', 'senhoria', 'arrendatario', 'contrato de arrendamento', 'recibo de renda', 'locado', 'inquilino'] },
  { f: 'casa-cond', type: 'Condomínio', min: 2, k: ['condominio', 'quota', 'quotas', 'fracao', 'fundo comum de reserva', 'administracao', 'condominos'] },
  { f: 'casa-imi', type: 'IMI', min: 2, k: ['imposto municipal sobre imoveis', 'imi', 'valor patrimonial', 'artigo matricial', 'predio', 'caderneta predial'] },
  { f: 'car-insp', type: 'Ficha de inspeção', min: 3, k: ['inspecao', 'periodica', 'deficiencias', 'centro de inspecao', 'resultado', 'aprovado', 'reprovado', 'proxima inspecao', 'quilometros'] },
  { f: 'car-seg', type: 'Seguro automóvel', min: 3, k: ['apolice', 'seguro automovel', 'carta verde', 'matricula', 'responsabilidade civil', 'danos proprios', 'tomador', 'premio', 'veiculo seguro'] },
  { f: 'fin-seguros', type: 'Apólice de seguro', min: 3, k: ['apolice', 'tomador', 'premio', 'seguradora', 'coberturas', 'franquia', 'capital seguro', 'segurado', 'periodo de seguro', 'condicoes particulares'] },
  { f: 'car-multas', type: 'Multa', min: 2, k: ['contraordenacao', 'coima', 'infracao', 'ansr', 'auto de contraordenacao', 'codigo da estrada', 'excesso de velocidade', 'estacionamento proibido'] },
  { f: 'car-cv', type: 'Compra e venda', min: 3, k: ['comprador', 'vendedor', 'matricula', 'preco', 'declaracao de venda', 'contrato de compra e venda', 'veiculo', 'requerimento de registo'] },
  { f: 'car-port', type: 'Portagens', min: 2, k: ['via verde', 'portagem', 'portagens', 'identificador', 'brisa', 'ascendi', 'passagens'] },
  { f: 'fin-ss', type: 'Segurança Social', min: 2, k: ['seguranca social', 'niss', 'contribuicoes', 'trabalhador independente', 'declaracao trimestral', 'base de incidencia', 'prestacao'] },
  { f: 'fin-banco', type: 'Extrato bancário', min: 3, k: ['extrato', 'iban', 'saldo', 'movimentos', 'saldo disponivel', 'saldo contabilistico', 'debito', 'credito', 'conta n'] },
  { f: 'saude-cons', type: 'Saúde', min: 2, k: ['utente', 'consulta', 'taxa moderadora', 'sns', 'medico', 'exame', 'analises', 'receita', 'hospital', 'centro de saude', 'diagnostico'] },
  { f: 'animais', type: 'Veterinário', min: 2, k: ['veterinari', 'vacina', 'microchip', 'canideo', 'raca', 'desparasitacao', 'antirrabica'] },
  { f: 'trab-cont', type: 'Contrato de trabalho', min: 2, k: ['contrato de trabalho', 'periodo experimental', 'entidade empregadora', 'trabalhador', 'retribuicao', 'horario de trabalho', 'termo certo', 'termo incerto'] },
];
let nbCache = null; // modelo que aprende com os documentos que confirmaste
function nbTokens(n) { return new Set((n.match(/[a-z]{4,}/g) || []).filter(w => w.length <= 20)); }
function nbModel() {
  if (nbCache) return nbCache;
  const m = { f: {}, vocab: new Set(), total: 0 };
  for (const d of S.docs) {
    if (d.review || !d.folder || d.folder === 'outros' || !d._t) continue;
    const F = m.f[d.folder] ||= { docs: 0, n: 0, c: new Map() }; F.docs++; m.total++;
    for (const t of nbTokens(d._t)) { F.c.set(t, (F.c.get(t) || 0) + 1); F.n++; m.vocab.add(t); }
  }
  return nbCache = m;
}
function nbScores(n) {
  const m = nbModel(); const ids = Object.keys(m.f).filter(id => m.f[id].docs >= 1 && folderById(id)); if (ids.length < 2 && m.total < 2) return {};
  const toks = [...nbTokens(n)]; const V = m.vocab.size + 1; const ll = {};
  for (const id of ids) { const F = m.f[id]; let s = Math.log(F.docs / m.total); for (const t of toks) if (m.vocab.has(t)) s += Math.log(((F.c.get(t) || 0) + 0.5) / (F.docs + 1)); ll[id] = s; }
  const mx = Math.max(...Object.values(ll)); let z = 0; for (const id in ll) z += Math.exp(ll[id] - mx);
  const p = {}; for (const id in ll) p[id] = Math.exp(ll[id] - mx) / z; return p;
}
function analyze(text) {
  const n = norm(text);
  const dates = findDates(n);
  let due = dateAfter(n, dates, ['data limite de pagamento', 'data-limite de pagamento', 'data limite', 'data-limite', 'pagar ate', 'pagamento ate', 'a pagar ate', 'prazo de pagamento', 'data de vencimento', 'data vencimento', 'valido ate', 'ate ao dia', 'prazo limite']);
  const nm = n.replace(/data de (admissao|nascimento|validade|inicio de funcoes|entrada|antiguidade|vencimento)|data[ -]limite|proxima inspecao|valido ate|validade/g, m => '#'.repeat(m.length));
  let date = dateAfter(nm, findDates(nm), ['data de emissao', 'data emissao', 'data da fatura', 'data do documento', 'emitido em', 'emitida em', 'data de recebimento', 'periodo', 'referente a', 'data:', 'data '], 40);
  if (!date) { const lim = addDays(todayISO(), 1), d = findDates(nm).find(x => x.iso !== due && x.iso <= lim); date = d ? d.iso : null; }
  const ign = ignoredNifs();
  const nifs = findNifs(n).filter(x => !ign.includes(x));
  const nif = nifs[0] || '';
  const entity = findEntity(text, n);
  const amount = findAmount(n);
  const plate = findPlate(text);
  let type = findType(n);
  // pontuação das pastas: o cabeçalho conta mais; expressões partidas pelo OCR também contam
  const cut = Math.max(400, Math.floor(n.length * 0.35)), head = n.slice(0, cut);
  const nc = n.replace(/[^a-z0-9]/g, ''), hc = head.replace(/[^a-z0-9]/g, '');
  const kwHit = k => {
    let c = countKw(n, k), ch = countKw(head, k);
    const kc = k.replace(/[^a-z0-9]/g, '');
    if (!c && kc.length >= 8 && nc.includes(kc)) { c = 1; ch = hc.includes(kc) ? 1 : 0; }
    return ch + (c - ch) * 0.5;
  };
  const own = {};
  for (const f of S.folders) {
    let s = 0;
    for (let k of f.kw || []) { let w = 1; if (k.startsWith('!')) { w = 4; k = k.slice(1); } else if (k.includes(' ')) w = 2; if (!k) continue; s += w * kwHit(k); }
    own[f.id] = s;
  }
  const sigType = {};
  for (const g of DOC_SIGS) {
    if (!folderById(g.f)) continue;
    let hits = 0; for (const k of g.k) if (kwHit(k) > 0) hits++;
    if (hits >= g.min) { own[g.f] = (own[g.f] || 0) + 6 * hits; sigType[g.f] = g.type; }
  }
  const score = {};
  for (const f of S.folders) score[f.id] = own[f.id] + (f.parent ? 0.5 * (own[f.parent] || 0) : 0) + (f.parent ? 0.01 : 0);
  // o que aprendeu com os documentos que confirmaste
  const nb = nbScores(n);
  for (const id in nb) if (nb[id] > 0.5 && score[id] !== undefined) score[id] += 20 * nb[id];
  // regras aprendidas
  const ek = 'ent:' + norm(entity);
  for (const k of [...nifs.map(x => 'nif:' + x), entity ? ek : null]) { const f = k && S.rules[k]; if (f && score[f] !== undefined) score[f] += 40; }
  const ranked = Object.entries(score).filter(([id]) => id !== 'outros').sort((a, b) => b[1] - a[1]);
  const folder = ranked.length && ranked[0][1] >= 3 ? ranked[0][0] : 'outros';
  const sugg = ranked.filter(([, s]) => s >= 2).slice(0, 4).map(([id]) => id);
  const fo = folderById(folder);
  if (sigType[folder] && ['', 'Fatura', 'Recibo', 'Aviso', 'Carta', 'Apólice', 'Declaração', 'Guia', 'Certificado', 'Notificação', 'Extrato', 'Fatura simplificada'].includes(type)) type = sigType[folder];
  if (folder === 'trab-rec') due = null;
  const label = type || (fo && fo.id !== 'outros' ? fo.name : 'Documento');
  const when = date ? ` · ${MES_C[+date.slice(5, 7) - 1]} ${date.slice(0, 4)}` : '';
  const title = [label, entity && !norm(label).includes(norm(entity)) && !norm(entity).includes(norm(label)) ? entity : '', plate || ''].filter(Boolean).join(' ').slice(0, 70) + when;
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
function folderOptions(sel, withNew) {
  return (withNew ? '<option value="__new">＋ Criar pasta nova…</option>' : '') + tops().map(t => `<optgroup label="${esc(t.emoji + ' ' + t.name)}"><option value="${t.id}"${sel === t.id ? ' selected' : ''}>${esc(t.name)} (geral)</option>${kids(t.id).map(k => `<option value="${k.id}"${sel === k.id ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</optgroup>`).join('');
}
async function saveFolders() { await dbPut('kv', S.folders, 'folders'); }

/* ---------------- Documentos ---------------- */
function indexDoc(d) {
  const dt = d.date ? `${d.date} ${fmtDate(d.date)} ${MESES[+d.date.slice(5, 7) - 1]} ${d.date.slice(5, 7)}/${d.date.slice(0, 4)}` : '';
  const amt = d.amount != null ? `${String(d.amount.toFixed(2)).replace('.', ',')} ${d.amount.toFixed(2)}` : '';
  d._h = norm([d.title, d.entity, d.plate, folderPath(d.folder), d.type, ...(d.files || []).map(f => f.name)].join(' '));
  d._t = norm(d.text || '');
  d._s = d._h + ' ' + norm([d.nif, d.notes, dt, amt, d.due ? 'prazo ' + fmtDate(d.due) : ''].join(' ')) + ' ' + d._t;
  d._sp = d._s.replace(/[\s\-.·]+/g, '');
  return d;
}
function clean(d) { const o = {}; for (const k in d) if (k[0] !== '_') o[k] = d[k]; return o; }
async function saveDoc(d) { d.updated = Date.now(); indexDoc(d); nbCache = null; await dbPut('docs', clean(d)); }
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
/* Pré-processamento para o OCR: tira sombras e fundo, aumenta o contraste, usa mais resolução */
function normalizeImageData(id) {
  const { width: w, height: h, data: d } = id, n = w * h, g = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  const f = 16, sw = Math.ceil(w / f), sh = Math.ceil(h / f), cell = new Float32Array(sw * sh);
  for (let cy = 0; cy < sh; cy++) for (let cx = 0; cx < sw; cx++) {
    let sm = 0, c = 0; const y1 = Math.min(h, (cy + 1) * f), x1 = Math.min(w, (cx + 1) * f);
    for (let y = cy * f; y < y1; y += 2) for (let x = cx * f; x < x1; x += 2) { sm += g[y * w + x]; c++; }
    cell[cy * sw + cx] = sm / c;
  }
  const R = 2, dil = new Float32Array(sw * sh); // fundo = o mais claro à volta (o texto é escuro)
  for (let cy = 0; cy < sh; cy++) for (let cx = 0; cx < sw; cx++) {
    let mx = 0; for (let yy = Math.max(0, cy - R); yy <= Math.min(sh - 1, cy + R); yy++) for (let xx = Math.max(0, cx - R); xx <= Math.min(sw - 1, cx + R); xx++) { const v = cell[yy * sw + xx]; if (v > mx) mx = v; }
    dil[cy * sw + cx] = mx;
  }
  const B = 3, bg = new Float32Array(sw * sh);
  for (let cy = 0; cy < sh; cy++) for (let cx = 0; cx < sw; cx++) {
    let sm = 0, c = 0; for (let yy = Math.max(0, cy - B); yy <= Math.min(sh - 1, cy + B); yy++) for (let xx = Math.max(0, cx - B); xx <= Math.min(sw - 1, cx + B); xx++) { sm += dil[yy * sw + xx]; c++; }
    bg[cy * sw + cx] = Math.max(30, sm / c);
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1.001, Math.max(0, y / f - 0.5)), y0 = fy | 0, ty = fy - y0, y1 = Math.min(sh - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1.001, Math.max(0, x / f - 0.5)), x0 = fx | 0, tx = fx - x0, x1 = Math.min(sw - 1, x0 + 1);
      const b = (bg[y0 * sw + x0] * (1 - tx) + bg[y0 * sw + x1] * tx) * (1 - ty) + (bg[y1 * sw + x0] * (1 - tx) + bg[y1 * sw + x1] * tx) * ty;
      let v = g[y * w + x] * 255 / b; v = (v - 70) * 255 / (232 - 70);
      const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return id;
}
async function ocrPrep(src, extraRot = 0) {
  const blob = src instanceof Blob ? src : (src.orig || src.blob); const rot = ((src instanceof Blob ? 0 : (src.rot || 0)) + extraRot) % 360;
  const im = await loadImg(blob); let w = im.naturalWidth, h = im.naturalHeight; const k = Math.min(1, 3000 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas'); c.width = rot % 180 ? h : w; c.height = rot % 180 ? w : h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 180); x.drawImage(im, -w / 2, -h / 2, w, h); x.setTransform(1, 0, 0, 1, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height); normalizeImageData(id); x.putImageData(id, 0, 0);
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); c.width = c.height = 0; return out;
}
const ocrQuality = r => { const ws = (r.data.words || []).filter(w => w.confidence > 60 && /[A-Za-zÀ-ÿ]{3,}/.test(w.text)); return ws.length * (r.data.confidence || 0) / 100; };
async function ocrBlobs(blobs) {
  const texts = []; ocrBlobs.rots = [];
  busy(true, 'A preparar o leitor de texto…', 0);
  try {
    const w = await getWorker();
    for (let i = 0; i < blobs.length; i++) {
      const lbl = blobs.length > 1 ? `A ler a página ${i + 1} de ${blobs.length}…` : 'A ler o documento…';
      busy(true, lbl, i / blobs.length);
      ocrLog = m => { if (m.status === 'recognizing text') busy(true, lbl, (i + m.progress) / blobs.length); };
      let best = await w.recognize(await ocrPrep(blobs[i])), q = ocrQuality(best), bestRot = 0;
      if ((best.data.confidence || 0) < 65 || q < 8) { // talvez a página esteja de lado ou ao contrário
        for (const rr of [90, 270, 180]) {
          busy(true, lbl.replace('…', '') + ' (a tentar outra orientação)…', (i + 0.5) / blobs.length);
          const r2 = await w.recognize(await ocrPrep(blobs[i], rr)), q2 = ocrQuality(r2);
          if (q2 > q * 1.5 + 2) { best = r2; q = q2; bestRot = rr; if ((r2.data.confidence || 0) > 70) break; }
        }
      }
      texts.push((best.data.text || '').replace(/\n{3,}/g, '\n\n').trim()); ocrBlobs.rots.push(bestRot);
    }
  } finally { ocrLog = null; }
  return texts;
}

/* ---------------- Interface: utilitários ---------------- */
function busy(on, txt, p) { const b = $('#busy'); b.hidden = !on; if (txt) $('#busyTxt').textContent = txt; $('#busyBar').style.width = p == null ? '0' : Math.round(p * 100) + '%'; $('#busyBar').parentNode.style.visibility = p == null ? 'hidden' : 'visible'; }
let toastT; function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2600); }
function sheet(html, top) { $('#sheet').innerHTML = html; $('#sheet').classList.toggle('top', !!top); $('#sheetWrap').hidden = false; }
function closeSheet() { $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheetBg').onclick = closeSheet;
function go(h) { location.hash = h; }
function setBar(title, back, gear) { $('#title').textContent = title; $('#back').hidden = !back; $('#gear').hidden = !gear; }
$('#back').onclick = () => { if (history.length > 1 && !location.hash.match(/^#\/?$/)) history.back(); else go('#/'); };
$('#gear').onclick = () => go('#/s');

let shareItem = null;
function offerFile(blob, name, label, onDone) {
  shareItem = { blob, name, onDone };
  sheet(`<div class="grp"><p>${esc(label || name)}</p><button class="it b" data-act="doShare">Guardar ou partilhar</button></div><div class="grp"><button class="it" data-act="closeSheet">Cancelar</button></div>`);
}
async function doShare() {
  if (!shareItem) return; const { blob, name, onDone } = shareItem; shareItem = null; closeSheet(); away();
  const file = new File([blob], name, { type: blob.type || mimeOf(name) });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); onDone && onDone(); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  onDone && onDone();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
const MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', zip: 'application/zip' };
function fileExt(n) { const m = /\.([a-z0-9]+)$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; }
function mimeOf(n) { return MIME[fileExt(n)] || 'application/octet-stream'; }
function fileIcon(n) { const e = fileExt(n); return e === 'pdf' ? '📕' : /^(docx?|odt|rtf|txt|pages)$/.test(e) ? '📝' : /^(xlsx?|ods|csv|numbers)$/.test(e) ? '📊' : /^(pptx?|odp|key)$/.test(e) ? '📽️' : /^(jpe?g|png|heic|webp|gif)$/.test(e) ? '🖼' : '📎'; }
function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function iconThumb(n) {
  const e = (fileExt(n) || 'doc').toUpperCase().slice(0, 4); const col = { PDF: '#d9342b', DOC: '#2b5cd9', DOCX: '#2b5cd9', ODT: '#2b5cd9', XLS: '#1e8e3e', XLSX: '#1e8e3e', ODS: '#1e8e3e', CSV: '#1e8e3e', PPT: '#d96a2b', PPTX: '#d96a2b' }[e] || '#6b6b70';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="120"><rect x="1" y="1" width="88" height="118" rx="8" fill="#fff" stroke="#ccc"/><rect x="14" y="20" width="62" height="6" rx="3" fill="#ddd"/><rect x="14" y="34" width="50" height="6" rx="3" fill="#ddd"/><rect x="14" y="48" width="58" height="6" rx="3" fill="#ddd"/><rect x="1" y="76" width="88" height="28" fill="${col}"/><text x="45" y="96" font-family="Arial" font-weight="bold" font-size="18" fill="#fff" text-anchor="middle">${e}</text></svg>`);
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
  <h2>Pastas</h2><div class="grid">${tops().map(t => { const c = countIn(t.id); return `<button class="fold" data-go="#/f/${t.id}"><span class="em">${t.emoji || '📁'}</span><b>${esc(t.name)}</b><small>${t.id === 'carros' && S.cars.length ? `${S.cars.length} carro${S.cars.length === 1 ? '' : 's'} · ` : ''}${c} doc${c === 1 ? '' : 's'}</small></button>`; }).join('')}<button class="fold add" data-act="newFolder"><span class="em">＋</span><b>Nova pasta</b><small>criar uma pasta tua</small></button></div>
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
  const cars = S.cars.filter(c => { const h = norm([c.plate, np(c.plate), c.brand, c.model, c.version, c.vin].join(' ')); return terms.every(t => h.includes(t)); });
  r.innerHTML = (cars.length ? `<h2>Carros</h2><div class="card">${cars.map(carRow).join('')}</div>` : '') + (list.length ? `<h2>${list.length} documento${list.length === 1 ? '' : 's'}</h2><div class="card">${list.slice(0, 100).map(d => docRow(d, snippet(d, terms))).join('')}</div>` : cars.length ? '' : `<div class="empty"><p>Nada encontrado para «${esc(q)}».</p></div>`);
}
function vFolder(id) {
  if (id === 'carros' && folderById('carros')) return vGarage();
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
  if (!f.parent) html += `<button class="btn" data-act="newFolder" data-p="${id}">＋ Nova subpasta em ${esc(f.name)}</button>`;
  html += `<button class="btn" data-go="#/fe/${id}">Editar pasta e palavras-chave</button>`;
  $('#view').innerHTML = html;
}
async function vDoc(id) {
  const d = docById(id); if (!d) return go('#/');
  setBar(d.title || 'Documento', true, false);
  const fo = folderById(d.folder);
  const sugg = (d.sugg || []).filter(x => folderById(x));
  let html = '';
  const car = carOfDoc(d);
  html += carPrompt(d, car);
  if (d.review) {
    html += `<div class="review"><p>Arquivei em <b>${esc(folderEmoji(d.folder) + ' ' + folderPath(d.folder))}</b>. Está certo?</p>
    <div class="chips"><button class="chip on" data-act="confirm">✓ Sim</button>${sugg.filter(x => x !== d.folder).map(x => `<button class="chip" data-act="setFolder" data-f="${x}">${esc(folderPath(x))}</button>`).join('')}<button class="chip" data-act="pickFolder">Outra…</button></div></div>`;
  }
  const files = d.files || [];
  if (d.pages.length) html += `<div class="pages" id="pages">${d.pages.map((p, i) => `<div class="pg"><img data-pid="${p}" alt="Página ${i + 1}"><span class="num">${i + 1}/${d.pages.length}</span><div class="tools"><button data-act="rotPage" data-i="${i}" aria-label="Rodar">↻</button>${d.pages.length > 1 || files.length ? `<button data-act="delPage" data-i="${i}" aria-label="Apagar página">✕</button>` : ''}</div></div>`).join('')}</div>`;
  if (files.length) html += `<h2>Ficheiros originais</h2><div class="card">${files.map((f, i) => `<div class="row"><span class="em">${fileIcon(f.name)}</span><div class="mid"><div class="t">${esc(f.name)}</div><div class="s">${fmtSize(f.size || 0)}</div></div><button class="chip" data-act="openFile" data-i="${i}">Abrir</button></div>`).join('')}</div>`;
  const dueInfo = d.due ? (d.paid ? '<span class="badge b-gr">pago</span>' : (n => n < 0 ? `<span class="badge b-red">atrasado ${-n} d</span>` : `<span class="badge b-or">${n === 0 ? 'hoje' : 'faltam ' + n + ' d'}</span>`)(daysTo(d.due))) : '';
  html += `<h2>Dados</h2><div class="card form">
   <div class="f"><label>Título</label><input data-field="title" value="${esc(d.title)}"></div>
   <div class="f"><label>Pasta</label><select data-field="folder">${folderOptions(d.folder, true)}</select></div>
   <div class="f"><label>Data</label><input type="date" data-field="date" value="${esc(d.date || '')}"></div>
   <div class="f"><label>Entidade</label><input data-field="entity" value="${esc(d.entity)}" placeholder="—"></div>
   <div class="f"><label>NIF</label><input data-field="nif" inputmode="numeric" value="${esc(d.nif)}" placeholder="—"></div>
   <div class="f"><label>Valor (€)</label><input data-field="amount" inputmode="decimal" value="${d.amount != null ? String(d.amount.toFixed(2)).replace('.', ',') : ''}" placeholder="—"></div>
   <div class="f"><label>Prazo</label><input type="date" data-field="due" value="${esc(d.due || '')}">${dueInfo}</div>
   ${d.due ? `<div class="f"><label>Já paguei</label><span style="flex:1"></span><input type="checkbox" data-field="paid"${d.paid ? ' checked' : ''}></div>` : ''}
   <div class="f"><label>Matrícula</label><input data-field="plate" value="${esc(d.plate || '')}" placeholder="—" autocapitalize="characters"></div>
   ${S.cars.length ? `<div class="f"><label>Carro</label><select data-field="carId"><option value=""${!d.carId ? ' selected' : ''}>Automático${!d.carId ? ` (${car ? esc(fmtPlate(car.plate)) : 'nenhum'})` : ''}</option><option value="none"${d.carId === 'none' ? ' selected' : ''}>Nenhum</option>${S.cars.map(c => `<option value="${c.id}"${d.carId === c.id ? ' selected' : ''}>${esc(fmtPlate(c.plate) + ' ' + carName(c))}</option>`).join('')}</select></div>
   ${car ? `<div class="f"><label>No carro é</label><select data-field="carCat">${CAR_CATS.map(([k, n]) => `<option value="${k}"${carCat(d, car) === k ? ' selected' : ''}>${n}</option>`).join('')}</select></div><button class="row chev" data-go="#/car/${car.id}"><span class="em">🚗</span><div class="mid"><div class="t">Abrir a ficha do ${esc(fmtPlate(car.plate))}</div><div class="s">${esc(carName(car))}</div></div></button>` : ''}` : ''}
   <div class="f col"><label>Notas</label><textarea data-field="notes" rows="2" placeholder="Escreve aqui o que quiseres">${esc(d.notes || '')}</textarea></div>
  </div>
  ${d.due ? `<button class="btn pri" data-act="calendar">📅 Adicionar prazo ao Calendário</button>` : ''}
  <div class="btns">${d.origPdf ? '<button class="btn" data-act="pdf">📄 Partilhar PDF</button>' : d.pages.length ? '<button class="btn" data-act="pdf">📄 Exportar PDF</button>' : ''}<button class="btn" data-act="addPage">＋ Adicionar</button></div>
  <h2>Texto lido</h2><button class="btn" data-act="pasteText">📋 Colar texto lido pelo iPhone</button><details class="card"><summary>${d.text ? 'Ver e corrigir o texto' : 'Sem texto'}</summary><textarea data-field="text" spellcheck="false">${esc(d.text || '')}</textarea></details>
  ${!files.length && d.pages.length ? '<button class="btn" data-act="reocr">🔍 Ler o texto outra vez</button>' : ''}
  <button class="btn red" data-act="delDoc">Apagar documento</button>
  <p class="muted" style="text-align:center;margin-top:16px">Criado em ${fmtDate(isoFromTs(d.created))}</p>`;
  const v = $('#view'); v.innerHTML = html;
  for (const img of v.querySelectorAll('img[data-pid]')) pageURL(img.dataset.pid).then(u => img.src = u);
}
function isoFromTs(ts) { const d = new Date(ts); return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

function vNew() {
  const dr = S.draft;
  if (!dr || (!dr.pages.length && !dr.files.length)) return go('#/');
  setBar(dr.docId ? 'Adicionar ao documento' : dr.carId && carById(dr.carId) ? 'Documento do ' + fmtPlate(carById(dr.carId).plate) : 'Novo documento', true, false);
  const nItems = dr.files.length + (dr.pages.length ? 1 : 0);
  $('#view').innerHTML = `${dr.pages.length ? `<p class="muted">Confirma que as fotografias estão direitas (usa ↻ para rodar). As fotografias ficam como páginas do mesmo documento.</p>
  <div class="dgrid">${dr.pages.map((p, i) => `<div class="dp"><img src="${p.url}" alt=""><span class="num">${i + 1}</span><div class="tools"><span><button data-act="dMove" data-i="${i}" data-d="-1"${i === 0 ? ' hidden' : ''}>◀</button> <button data-act="dMove" data-i="${i}" data-d="1"${i === dr.pages.length - 1 ? ' hidden' : ''}>▶</button></span><span><button data-act="dRot" data-i="${i}">↻</button> <button data-act="dDel" data-i="${i}">✕</button></span></div></div>`).join('')}</div>` : ''}
  ${dr.files.length ? `<h2>Ficheiros</h2><div class="card">${dr.files.map((f, i) => `<div class="row"><span class="em">${fileIcon(f.name)}</span><div class="mid"><div class="t">${esc(f.name)}</div><div class="s">${fmtSize(f.blob.size)}</div></div><button class="chip" data-act="dDelF" data-i="${i}">✕</button></div>`).join('')}</div>` : ''}
  <div class="btns"><button class="btn" data-act="cam">📷 Foto</button><button class="btn" data-act="gal">🖼 Galeria</button><button class="btn" data-act="fil">📄 Ficheiro</button></div>
  ${dr.docId ? '<button class="btn pri" data-act="process">Ler e juntar ao documento</button>'
    : nItems > 1 ? `<button class="btn pri" data-act="process" data-sep="1">Arquivar em separado (${nItems} documentos)</button><button class="btn" data-act="process">Juntar tudo num só documento</button>`
    : '<button class="btn pri" data-act="process">Ler e arquivar</button>'}
  <button class="btn red" data-act="dCancel">Cancelar</button>`;
}

async function vSettings() {
  setBar('Definições', true, false);
  let est = null; try { est = await navigator.storage?.estimate(); } catch (e) { }
  let pers = null; try { pers = await navigator.storage?.persisted(); } catch (e) { }
  const mb = x => (x / 1048576).toFixed(x > 1e8 ? 0 : 1) + ' MB';
  const bio = L.cfg ? await bioAvailable() : false;
  const fq = S.set.bkFreq || '7';
  $('#view').innerHTML = `<h2>Cópia de segurança</h2><div class="card form">
   <div class="f"><label>Última</label><span style="flex:1;text-align:right">${S.set.lastBackup ? fmtDate(isoFromTs(S.set.lastBackup)) : 'nunca'}</span></div>
   <div class="f"><label>Automática</label><select data-set="bkFreq">${[['7', 'todas as semanas'], ['14', 'de 2 em 2 semanas'], ['30', 'todos os meses'], ['off', 'desligada']].map(([v, t]) => `<option value="${v}"${fq === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div>
  <button class="btn pri" data-act="backup">💾 Fazer cópia completa agora</button>
  <button class="btn" data-act="restore">Importar cópia</button>
  <p class="muted">Com a cópia automática ligada, quando abres a app e já passou o tempo escolhido, ela prepara a cópia sozinha e só te pede um toque para a guardar: escolhe «Guardar em Ficheiros», sempre na mesma pasta (de preferência em «No meu iPhone» ou numa pen). As cópias automáticas levam só o que é novo ou mudou; uma vez por mês a cópia é completa. Para recuperar, importa os ficheiros todos, por qualquer ordem. O .zip abre-se em qualquer computador e tem os documentos organizados por pastas.</p>
  <h2>Armazenamento</h2><div class="card form">
   <div class="f"><label>Documentos</label><span style="flex:1;text-align:right">${S.docs.length}</span></div>
   ${est ? `<div class="f"><label>Espaço usado</label><span style="flex:1;text-align:right">${mb(est.usage || 0)}</span></div>` : ''}
   <div class="f"><label>Proteção</label><span style="flex:1;text-align:right">${pers ? '✅ persistente' : pers === false ? 'normal' : '—'}</span></div></div>
   ${pers === false ? '<button class="btn" data-act="persist">Pedir armazenamento persistente</button>' : ''}
  <h2>Código de acesso</h2><div class="card form">
   <div class="f"><label>Código</label><span style="flex:1;text-align:right">${L.cfg ? `✅ ativo (${L.cfg.len} dígitos)` : 'desligado'}</span></div>
   ${L.cfg ? `<div class="f"><label>Bloquear</label><select data-lock="mode"><option value="0"${L.cfg.mode === '0' ? ' selected' : ''}>logo ao sair da app</option><option value="60"${L.cfg.mode === '60' ? ' selected' : ''}>após 1 minuto fora</option><option value="300"${L.cfg.mode === '300' ? ' selected' : ''}>após 5 minutos fora</option></select></div>
   ${bio ? `<div class="f"><label>Face ID</label><span style="flex:1;text-align:right">${L.cfg.cred ? '✅ ativo' : 'desligado'}</span></div>` : ''}` : ''}
  </div>
  ${L.cfg ? `${bio ? (L.cfg.cred ? '<button class="btn" data-act="bioOff">Desligar Face ID</button>' : '<button class="btn" data-act="bioOn">Desbloquear também com Face ID</button>') : ''}
   <div class="btns"><button class="btn" data-act="lockNow">🔒 Bloquear já</button><button class="btn" data-act="pinChange">Mudar código</button></div>
   <button class="btn red" data-act="pinOff">Desligar código</button>` : '<button class="btn pri" data-act="pinOn">🔒 Ativar código de acesso</button>'}
  <p class="muted">Se te esqueceres do código, a única saída é apagar os documentos da app e importar uma cópia de segurança. Faz cópias regularmente.</p>
  <h2>Os vossos NIF</h2><div class="card form"><div class="f col"><label>NIFs a ignorar na identificação da entidade (o teu, o da tua companheira…)</label><input data-set="ignoreNifs" inputmode="numeric" value="${esc(S.set.ignoreNifs || '')}" placeholder="123456789, 987654321"></div></div>
  <h2>Pastas</h2><div class="card">${tops().map(t => `<button class="row chev" data-go="#/fe/${t.id}"><span class="em">${t.emoji || '📁'}</span><div class="mid"><div class="t">${esc(t.name)}</div><div class="s">${kids(t.id).map(k => esc(k.name)).join(', ') || 'sem subpastas'}</div></div></button>`).join('')}</div>
  <button class="btn" data-act="newFolder">＋ Nova pasta</button>
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
  ${isTop ? `<h2>Subpastas</h2><div class="card">${kids(id).map(k => `<button class="row chev" data-go="#/fe/${k.id}"><span class="em">📂</span><div class="mid"><div class="t">${esc(k.name)}</div></div></button>`).join('') || '<div class="row muted">Sem subpastas</div>'}</div><button class="btn" data-act="newFolder" data-p="${id}">＋ Nova subpasta</button>` : ''}
  ${id !== 'outros' ? `<button class="btn red" data-act="delFolder" data-f="${id}">Apagar pasta</button>` : ''}`;
}

function render() {
  closeSheet();
  const h = location.hash.replace(/^#\/?/, ''); const [a, b] = h.split('/');
  window.scrollTo(0, 0);
  $('#fab').hidden = !(a === '' || a === 'f' || (a === 'car' && b !== 'new'));
  if (a === 'f') vFolder(b);
  else if (a === 'car') { if (b === 'new') vCarNew(); else vCar(b); }
  else if (a === 'd') vDoc(b);
  else if (a === 'new') vNew();
  else if (a === 's') vSettings();
  else if (a === 'fe') vFolderEdit(b);
  else { vHome(); setTimeout(maybeAutoBackup, 1200); }
}

/* ---------------- Ações ---------------- */
let pickFor = null; // null = novo documento; id = adicionar ao documento
$('#fab').onclick = () => { pickFor = null; const m = location.hash.match(/^#\/car\/(?!new)(.+)$/); S.pendingCar = m ? m[1] : null; addSheet(); };
function addSheet() {
  sheet(`<div class="grp"><p>💡 Para papéis com muito texto: na app <b>Ficheiros</b> → <b>⋯</b> → <b>Digitalizar documentos</b> o iPhone endireita e limpa a folha; depois escolhe esse PDF em «Escolher ficheiro».</p><button class="it" data-act="cam">📷 Tirar fotografia</button><button class="it" data-act="gal">🖼 Escolher da galeria</button><button class="it" data-act="fil">📄 Escolher ficheiro (PDF, Word…)</button></div><div class="grp"><button class="it b" data-act="closeSheet">Cancelar</button></div>`);
}
const isImg = f => /^image\/(jpeg|png|webp|gif|heic|heif)/.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name || '');
async function onPicked(files) {
  files = [...files]; if (!files.length) return;
  closeSheet();
  if (!S.draft || (S.draft.docId || null) !== pickFor || (S.draft.carId || null) !== (S.pendingCar || null)) { clearDraft(); S.draft = { docId: pickFor, pages: [], files: [], carId: S.pendingCar || null }; }
  busy(true, 'A preparar…', null);
  for (const f of files) {
    if (isImg(f)) { try { const r = await prepImage(f); S.draft.pages.push({ blob: r.blob, url: URL.createObjectURL(r.blob), orig: f, rot: 0 }); continue; } catch (e) { /* imagem que não abre: fica como ficheiro */ } }
    S.draft.files.push({ blob: f, name: f.name || 'ficheiro', type: f.type || mimeOf(f.name) });
  }
  busy(false);
  if (location.hash === '#/new') vNew(); else go('#/new');
}
function clearDraft() { if (S.draft) for (const p of S.draft.pages) URL.revokeObjectURL(p.url); S.draft = null; }
$('#camIn').onchange = e => { onPicked(e.target.files); e.target.value = ''; };
$('#galIn').onchange = e => { onPicked(e.target.files); e.target.value = ''; };
$('#filIn').onchange = e => { onPicked(e.target.files); e.target.value = ''; };
$('#impIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };

/* ---------------- Leitura de ficheiros (PDF, Word, Excel, texto) ---------------- */
let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = new Promise((res, rej) => {
    if (window.pdfjsLib) return res(window.pdfjsLib);
    const sc = document.createElement('script'); sc.src = 'vendor/pdfjs/pdf.min.js';
    sc.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; res(pdfjsLib); };
    sc.onerror = () => { pdfjsP = null; rej(new Error('Não consegui carregar o leitor de PDF')); };
    document.head.appendChild(sc);
  });
  return pdfjsP;
}
const MAX_RENDER = 40;
async function extractPdf(blob, onp) {
  const lib = await loadPdfjs(); const base = new URL('./', location.href).href;
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: base + 'vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: base + 'vendor/pdfjs/standard_fonts/', isEvalSupported: false }).promise;
  const pageTexts = [], pages = [], needOcr = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onp && onp(i, pdf.numPages);
    const pg = await pdf.getPage(i);
    let t = '';
    try { const tc = await pg.getTextContent(); t = tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim(); } catch (e) { }
    pageTexts.push(t);
    if (i <= MAX_RENDER) {
      const v1 = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: Math.min(4, 2000 / Math.max(v1.width, v1.height)) });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: x, viewport: vp }).promise;
      pages.push(await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82))); c.width = c.height = 0;
      if (t.replace(/\s/g, '').length < 30) needOcr.push(i - 1);
    }
    pg.cleanup();
  }
  await pdf.destroy();
  return { pageTexts, pages, needOcr };
}
const decodeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
async function extractOffice(blob, ext) {
  const z = await readZip(blob);
  const pick = ext === 'docx' ? ['word/document.xml'] : ext === 'xlsx' ? ['xl/sharedStrings.xml'] : ext === 'pptx' ? z.names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)) : ['content.xml'];
  let out = '';
  for (const nm of pick) {
    const b = await z.blob(nm); if (!b) continue;
    out += decodeXml((await b.text()).replace(/<\/(w:p|a:p|text:p|text:h|si|row)>/g, '\n').replace(/<(w:tab|text:tab)\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')) + '\n';
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
async function extractFile(f, onp) {
  const e = fileExt(f.name), t = f.type || '';
  try {
    if (e === 'pdf' || t === 'application/pdf') return { kind: 'pdf', ...(await extractPdf(f.blob, onp)) };
    if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(e)) return { kind: 'office', text: await extractOffice(f.blob, e) };
    if (['txt', 'csv', 'md', 'xml', 'json', 'html', 'htm', 'rtf'].includes(e) || t.startsWith('text/')) {
      let x = (await f.blob.text()).slice(0, 300000);
      if (e === 'rtf') x = x.replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\[a-z]+-?\d* ?|[{}]/gi, '');
      if (/^html?$/.test(e)) x = x.replace(/<[^>]+>/g, ' ');
      return { kind: 'text', text: x };
    }
  } catch (err) { console.warn(err); if (e === 'pdf') toast('Não consegui abrir o PDF: ' + (err.message || err)); }
  return { kind: 'other', text: '' };
}
// junta fotografias e ficheiros: devolve páginas, texto e ficheiros originais
async function collect(g) {
  const pageBlobs = [...g.photos], texts = g.photos.map((_, i) => (g.preTexts && g.preTexts[i]) || ''), ocrIdx = g.preTexts ? [] : g.photos.map((_, i) => i), extra = [];
  for (const f of g.files) {
    const r = await extractFile(f, (i, n) => busy(true, `A abrir «${f.name}» (página ${i} de ${n})…`, i / n));
    f.kind = r.kind;
    if (r.kind === 'pdf') {
      const base = pageBlobs.length;
      r.pages.forEach((b, i) => { pageBlobs.push(b); texts.push(r.pageTexts[i] || ''); if (r.needOcr.includes(i)) ocrIdx.push(base + i); });
      if (r.pageTexts.length > r.pages.length) extra.push(r.pageTexts.slice(r.pages.length).join('\n\n'));
    } else if (r.text) extra.push(r.text);
  }
  const todo = ocrIdx.slice(0, 30);
  if (todo.length) {
    let ot = [];
    const srcs = todo.map(i => (g.photoSrc && i < g.photos.length) ? g.photoSrc[i] : pageBlobs[i]);
    try { ot = await ocrBlobs(srcs); } catch (e) { console.error(e); toast('Não consegui ler o texto de algumas páginas'); }
    const rots = ocrBlobs.rots || [];
    for (let k = 0; k < todo.length; k++) {
      const pi = todo[k]; if (ot[k]) texts[pi] = ot[k];
      if (rots[k]) { const sr = srcs[k]; pageBlobs[pi] = (sr instanceof Blob ? await prepImage(sr, rots[k]) : await prepImage(sr.orig, (sr.rot + rots[k]) % 360)).blob; } // endireita a página guardada
    }
  }
  return { pageBlobs, text: [...texts, ...extra].filter(x => x && x.trim()).join('\n\n'), files: g.files, pdfOnly: !g.photos.length && g.files.length === 1 && g.files[0].kind === 'pdf' };
}
async function storeParts(docId, c) {
  const pages = [], files = [];
  for (const b of c.pageBlobs) { const pid = uid(); await dbPut('pages', { id: pid, docId, blob: b }); pages.push(pid); }
  for (const f of c.files) { const fid = uid(); const type = f.type || mimeOf(f.name); await dbPut('files', { id: fid, docId, name: f.name, type, blob: f.blob }); files.push({ id: fid, name: f.name, type, size: f.blob.size }); }
  return { pages, files };
}
async function buildDoc(g) {
  const c = await collect(g);
  busy(true, 'A arquivar…', 1);
  const a = analyze(c.text); const id = uid();
  const { pages, files } = await storeParts(id, c);
  const fname = (g.files[0]?.name || '').replace(/\.[^.]+$/, '');
  const title = fname && !a.type && !a.entity ? fname : a.title;
  const d = { id, created: Date.now(), pages, files, origPdf: c.pdfOnly ? files[0].id : null, thumb: c.pageBlobs.length ? await makeThumb(c.pageBlobs[0]) : iconThumb(g.files[0]?.name), text: c.text, title, folder: a.folder, sugg: a.sugg, date: a.date || todayISO(), due: a.due || '', paid: false, amount: a.amount, nif: a.nif, entity: a.entity, plate: a.plate || '', type: a.type, notes: '', review: true };
  if (g.carId && carById(g.carId)) { d.carId = g.carId; if (!d.plate) d.plate = fmtPlate(carById(g.carId).plate); }
  if (g.title) d.title = g.title; if (g.folder && folderById(g.folder)) { d.folder = g.folder; d.review = false; }
  S.docs.push(d); await saveDoc(d);
  return d;
}
async function processDraft(el) {
  const dr = S.draft; if (!dr) return;
  const photos = dr.pages.map(p => p.blob), photoSrc = dr.pages.map(p => ({ orig: p.orig || p.blob, rot: p.orig ? (p.rot || 0) : 0 }));
  try {
    if (dr.docId) {
      const d = docById(dr.docId); if (!d) throw new Error('Documento não encontrado');
      const c = await collect({ photos, photoSrc, files: dr.files });
      busy(true, 'A arquivar…', 1);
      const r = await storeParts(d.id, c);
      d.pages.push(...r.pages); d.files = [...(d.files || []), ...r.files]; d.origPdf = null;
      d.text = [d.text, c.text].filter(Boolean).join('\n\n');
      if (!d.pages.length || d.thumb?.startsWith('data:image/svg')) { if (c.pageBlobs.length && d.pages.length === r.pages.length) d.thumb = await makeThumb(c.pageBlobs[0]); }
      await saveDoc(d); clearDraft(); busy(false);
      history.replaceState(null, '', '#/d/' + d.id); render(); toast('Adicionado ao documento');
      return;
    }
    const groups = (el && el.dataset.sep ? [...(photos.length ? [{ photos, photoSrc, files: [] }] : []), ...dr.files.map(f => ({ photos: [], files: [f] }))] : [{ photos, photoSrc, files: dr.files }]).map(g => ({ ...g, carId: dr.carId }));
    const made = [];
    for (let k = 0; k < groups.length; k++) {
      if (groups.length > 1) busy(true, `Documento ${k + 1} de ${groups.length}…`, k / groups.length);
      made.push(await buildDoc(groups[k]));
    }
    clearDraft(); busy(false); askPersist();
    if (made.length === 1) { history.replaceState(null, '', '#/d/' + made[0].id); render(); }
    else { history.replaceState(null, '', '#/'); render(); toast(`${made.length} documentos arquivados — confirma as pastas em «Por confirmar»`); }
  } catch (e) { busy(false); console.error(e); alert('Erro ao arquivar: ' + (e.message || e)); }
}

async function askPersist() { try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { } }

function curDoc() { const m = location.hash.match(/^#\/d\/(.+)$/); return m && docById(m[1]); }
async function setDocFolder(d, f) { d.folder = f; d.review = false; learn(d); await saveDoc(d); }

/* ---------------- Código de acesso (PIN) ---------------- */
const L = { cfg: null, locked: false, hiddenAt: 0, grace: 0 };
let pinCb = null, pinBuf = '', pinLen = 4;
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
async function pinHash(pin, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: 200000 }, k, 256));
}
function drawDots(err) { $('#dots').innerHTML = Array.from({ length: pinLen }, (_, i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join(''); if (err) { const d = $('#dots'); d.classList.remove('err'); void d.offsetWidth; d.classList.add('err'); } }
function showPad(msg, len, cb, o = {}) {
  pinBuf = ''; pinLen = len; pinCb = cb;
  $('#lkMsg').textContent = msg; $('#lkSub').textContent = o.sub || '';
  $('#lkCancel').hidden = !o.cancel; $('#lkForgot').hidden = !o.forgot; $('#lkBio').hidden = !o.bio;
  drawDots(); $('#lock').hidden = false; document.activeElement?.blur?.();
}
function hidePad() { $('#lock').hidden = true; pinCb = null; pinBuf = ''; }
function padErr(msg) { pinBuf = ''; drawDots(true); $('#lkSub').textContent = msg; if (navigator.vibrate) navigator.vibrate(200); }
for (const b of document.querySelectorAll('#lock [data-k]')) b.onclick = () => {
  if (!pinCb || pinBuf.length >= pinLen) return;
  pinBuf += b.dataset.k; drawDots();
  if (pinBuf.length === pinLen) { const v = pinBuf; setTimeout(() => pinCb && pinCb(v), 120); }
};
$('#lkDel').onclick = () => { pinBuf = pinBuf.slice(0, -1); drawDots(); };
$('#lkCancel').onclick = () => hidePad();
function getFails() { try { return JSON.parse(localStorage.getItem('arqFails') || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } }
function setFails(f) { try { localStorage.setItem('arqFails', JSON.stringify(f)); } catch (e) { } }
function lockNow() {
  if (!L.cfg) return; L.locked = true; closeSheet(); $('#viewer').hidden = true;
  showPad('Introduz o código', L.cfg.len, tryUnlock, { forgot: true, bio: !!L.cfg.cred });
}
async function tryUnlock(v) {
  const f = getFails();
  if (Date.now() < f.until) return padErr(`Espera ${Math.ceil((f.until - Date.now()) / 1000)} s`);
  if (await pinHash(v, L.cfg.salt) === L.cfg.hash) { setFails({ n: 0, until: 0 }); return unlock(); }
  f.n++; if (f.n >= 5) f.until = Date.now() + 30000 * 2 ** Math.min(f.n - 5, 6);
  setFails(f); padErr(f.n >= 5 ? `Código errado. Espera ${Math.ceil((f.until - Date.now()) / 1000)} s` : 'Código errado');
}
function unlock() { L.locked = false; hidePad(); setTimeout(maybeAutoBackup, 700); }
function away() { L.grace = Date.now() + 5 * 60000; } // câmara, galeria, partilhar: não bloquear ao voltar
document.addEventListener('visibilitychange', () => {
  if (!L.cfg) return;
  if (document.hidden) { L.hiddenAt = Date.now(); if (L.cfg.mode === '0' && !L.locked && Date.now() > L.grace) lockNow(); }
  else {
    if (Date.now() < L.grace) { L.grace = 0; return; }
    if (!L.locked && Date.now() - L.hiddenAt >= (+L.cfg.mode || 0) * 1000) lockNow();
  }
});
$('#lkBio').onclick = async () => {
  try {
    await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(L.cfg.cred) }], userVerification: 'required', timeout: 60000 } });
    setFails({ n: 0, until: 0 }); unlock();
  } catch (e) { $('#lkSub').textContent = 'Face ID não confirmou — usa o código'; }
};
$('#lkForgot').onclick = async () => {
  if (!confirm('Sem o código não há forma de abrir os documentos.\n\nQueres APAGAR TODOS os documentos desta app e começar de novo? (Depois podes importar uma cópia de segurança.)')) return;
  if (!confirm('Tens a certeza? Isto não se pode desfazer.')) return;
  DB.close(); await new Promise(r => { const q = indexedDB.deleteDatabase('arquivo-docs'); q.onsuccess = q.onerror = q.onblocked = r; });
  setFails({ n: 0, until: 0 }); location.replace('./');
};
async function saveLock() { await dbPut('kv', L.cfg, 'lock'); }
function setupPin(len, done) {
  showPad(`Escolhe um código de ${len} dígitos`, len, v1 => {
    showPad('Repete o código', len, async v2 => {
      if (v1 !== v2) { toast('Os códigos não coincidem. Tenta outra vez.'); return setupPin(len, done); }
      const salt = b64(rnd(16));
      L.cfg = { len, salt, hash: await pinHash(v1, salt), mode: L.cfg?.mode || '0', cred: L.cfg?.cred || null };
      await saveLock(); hidePad(); toast('Código de acesso ativo'); done && done();
    }, { cancel: true });
  }, { cancel: true });
}
function verifyPin(msg, ok) {
  showPad(msg, L.cfg.len, async v => { if (await pinHash(v, L.cfg.salt) === L.cfg.hash) { hidePad(); ok(); } else padErr('Código errado'); }, { cancel: true });
}
async function bioAvailable() { try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } }

const EMOJIS = ['📁', '🏠', '🚗', '💶', '🔧', '💼', '🩺', '🐕', '🧾', '🎓', '⚖️', '🏦', '✈️', '📦', '👶', '🏍️', '🔑', '❤️'];
let nfDoc = null;
function newFolderSheet(parent, docId) {
  nfDoc = docId || null;
  const p = parent && folderById(parent) && !folderById(parent).parent ? parent : '';
  sheet(`<div class="grp"><p>Nova pasta</p><div class="nf">
   <input id="nfName" placeholder="Nome (ex.: Casa da Quinta, Mota, Escola)" autocomplete="off" enterkeyhint="done">
   <label>Dentro de</label>
   <select id="nfPar"><option value="">Nenhuma (pasta principal)</option>${tops().filter(t => t.id !== 'outros').map(t => `<option value="${t.id}"${t.id === p ? ' selected' : ''}>${esc((t.emoji || '📁') + ' ' + t.name)}</option>`).join('')}</select>
   <div id="nfEm" class="ems"${p ? ' hidden' : ''}>${EMOJIS.map((e, i) => `<button class="emb${i === 0 ? ' on' : ''}" data-act="nfEmoji">${e}</button>`).join('')}</div>
   <label>Palavras que costumam aparecer nestes papéis (opcional)</label>
   <input id="nfKw" placeholder="ex.: escola, propinas, matrícula escolar" autocomplete="off">
  </div><button class="it b" data-act="nfOk">Criar pasta</button></div><div class="grp"><button class="it" data-act="closeSheet">Cancelar</button></div>`, true);
  $('#nfPar').onchange = e => { $('#nfEm').hidden = !!e.target.value; };
  setTimeout(() => $('#nfName')?.focus(), 80);
}
async function createFolder() {
  const name = $('#nfName').value.trim(); if (!name) { $('#nfName').focus(); return toast('Escreve o nome da pasta'); }
  const parent = $('#nfPar').value || undefined;
  const emoji = parent ? undefined : ($('#nfEm .on')?.textContent || '📁');
  const kw = $('#nfKw').value.split(/[,;\n]+/).map(x => norm(x.trim())).filter(Boolean).map(x => '!' + x);
  const dup = S.folders.find(f => norm(f.name) === norm(name) && (f.parent || '') === (parent || ''));
  if (dup) return toast('Já existe uma pasta com esse nome');
  const f = { id: 'u-' + uid(), name, kw }; if (parent) f.parent = parent; else f.emoji = emoji;
  if (parent) S.folders.push(f); else S.folders.splice(Math.max(0, S.folders.findIndex(x => x.id === 'outros')), 0, f);
  await saveFolders(); closeSheet();
  if (nfDoc) { const d = docById(nfDoc); nfDoc = null; await setDocFolder(d, f.id); toast('Arquivado em ' + folderPath(f.id)); return vDoc(d.id); }
  toast('Pasta criada');
  if (location.hash.startsWith('#/s') || location.hash.startsWith('#/fe')) render(); else go('#/f/' + f.id);
}
const ACT = {
  closeSheet, doShare,
  newFolder: el => newFolderSheet(el.dataset.p, el.dataset.doc),
  pinOn: () => sheet(`<div class="grp"><p>Que tamanho de código queres?</p><button class="it" data-act="pinLen" data-n="4">4 dígitos</button><button class="it" data-act="pinLen" data-n="6">6 dígitos (mais seguro)</button></div><div class="grp"><button class="it b" data-act="closeSheet">Cancelar</button></div>`),
  pinLen: el => { closeSheet(); setupPin(+el.dataset.n, vSettings); },
  pinChange: () => verifyPin('Código atual', () => sheet(`<div class="grp"><p>Novo código</p><button class="it" data-act="pinLen" data-n="4">4 dígitos</button><button class="it" data-act="pinLen" data-n="6">6 dígitos</button></div><div class="grp"><button class="it b" data-act="closeSheet">Cancelar</button></div>`)),
  pinOff: () => verifyPin('Código atual para desligar', async () => { L.cfg = null; await dbDel('kv', 'lock'); toast('Código de acesso desligado'); vSettings(); }),
  lockNow: () => lockNow(),
  bioOn: async () => {
    try {
      const c = await navigator.credentials.create({ publicKey: { challenge: rnd(32), rp: { name: 'Arquivo' }, user: { id: rnd(16), name: 'arquivo', displayName: 'Arquivo de documentos' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000, attestation: 'none' } });
      L.cfg.cred = b64(c.rawId); await saveLock(); toast('Face ID ativo'); vSettings();
    } catch (e) { alert('Não foi possível ativar o Face ID: ' + (e.message || e.name)); }
  },
  bioOff: async () => { L.cfg.cred = null; await saveLock(); toast('Face ID desligado'); vSettings(); },
  nfEmoji: el => { for (const b of el.parentNode.children) b.classList.remove('on'); el.classList.add('on'); },
  nfOk: createFolder,
  cam: () => { closeSheet(); away(); $('#camIn').click(); },
  gal: () => { closeSheet(); away(); $('#galIn').click(); },
  fil: () => { closeSheet(); away(); $('#filIn').click(); },
  dDelF: el => { S.draft.files.splice(+el.dataset.i, 1); if (!S.draft.pages.length && !S.draft.files.length) { clearDraft(); history.back(); } else vNew(); },
  openFile: async el => { const d = curDoc(); const f = d.files[+el.dataset.i]; const r = await dbGet('files', f.id); if (!r) return toast('Ficheiro não encontrado'); offerFile(r.blob, f.name, `«${f.name}» — abrir, guardar ou partilhar`); },
  bkLater: async () => { S.set.bkSnooze = Date.now() + 864e5; await dbPut('kv', S.set, 'set'); closeSheet(); toast('Lembro-te amanhã'); },
  process: el => processDraft(el),
  dCancel: () => { clearDraft(); history.back(); },
  dRot: async el => { const p = S.draft.pages[+el.dataset.i]; p.rot = ((p.rot || 0) + 90) % 360; const r = p.orig ? await prepImage(p.orig, p.rot) : await prepImage(p.blob, 90, 4000, 0.9); URL.revokeObjectURL(p.url); p.blob = r.blob; p.url = URL.createObjectURL(r.blob); vNew(); },
  dDel: el => { const p = S.draft.pages.splice(+el.dataset.i, 1)[0]; URL.revokeObjectURL(p.url); if (!S.draft.pages.length && !S.draft.files.length) { clearDraft(); history.back(); } else vNew(); },
  dMove: el => { const i = +el.dataset.i, j = i + +el.dataset.d, a = S.draft.pages; [a[i], a[j]] = [a[j], a[i]]; vNew(); },
  confirm: async () => { const d = curDoc(); await setDocFolder(d, d.folder); toast('Arquivado em ' + folderPath(d.folder)); vDoc(d.id); },
  setFolder: async el => { const d = curDoc(); await setDocFolder(d, el.dataset.f); toast('Movido para ' + folderPath(d.folder)); vDoc(d.id); },
  pickFolder: () => { const d = curDoc(); sheet(`<div class="grp"><p>Escolhe a pasta</p><div style="padding:8px 14px 14px"><select id="pf" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg)">${folderOptions(d.folder)}</select></div><button class="it b" data-act="pickOk">Guardar</button><button class="it" data-act="newFolder" data-doc="${d.id}">＋ Criar pasta nova</button></div><div class="grp"><button class="it" data-act="closeSheet">Cancelar</button></div>`); },
  pickOk: async () => { const d = curDoc(); const f = $('#pf').value; closeSheet(); await setDocFolder(d, f); toast('Arquivado em ' + folderPath(f)); vDoc(d.id); },
  rotPage: async el => {
    const d = curDoc(); const pid = d.pages[+el.dataset.i]; const p = await dbGet('pages', pid);
    busy(true, 'A rodar…', null); const r = await prepImage(p.blob, 90, 4000, 0.9); p.blob = r.blob; await dbPut('pages', p); dropURL(pid);
    if (+el.dataset.i === 0) d.thumb = await makeThumb(r.blob);
    await saveDoc(d); busy(false); vDoc(d.id);
  },
  delPage: async el => { const d = curDoc(); if (!confirm('Apagar esta página?')) return; const pid = d.pages.splice(+el.dataset.i, 1)[0]; await dbDel('pages', pid); dropURL(pid); d.origPdf = null; if (+el.dataset.i === 0) { const p = d.pages[0] && await dbGet('pages', d.pages[0]); d.thumb = p ? await makeThumb(p.blob) : iconThumb(d.files?.[0]?.name); } await saveDoc(d); vDoc(d.id); },
  addPage: () => { pickFor = curDoc().id; addSheet(); },
  pasteText: async () => {
    const d = curDoc(); let t = '';
    try { t = await navigator.clipboard.readText(); } catch (e) { }
    if (!t || t.trim().length < 5) return alert('Não há texto copiado.\n\nPara usar o leitor do iPhone (muito bom):\n1. Abre a fotografia do papel na app Fotos (ou toca e mantém na imagem aqui).\n2. Toca no ícone de Texto ao Vivo (o quadrado com linhas) → «Selecionar tudo» → «Copiar».\n3. Volta aqui e toca outra vez em «Colar texto lido pelo iPhone».');
    if (d.text && d.text.trim() && !confirm('Substituir o texto lido pela app pelo texto que copiaste?')) return;
    d.text = t.trim(); const a = analyze(d.text);
    for (const k of ['date', 'due', 'amount', 'nif', 'entity', 'plate', 'type']) if (a[k] && (d.review || !d[k])) d[k] = a[k];
    if (d.review) { d.folder = a.folder; d.sugg = a.sugg; d.title = a.title; }
    await saveDoc(d); vDoc(d.id); toast('Texto do iPhone guardado');
  },
  reocr: async () => {
    const d = curDoc(); if (!confirm('Ler o texto outra vez? O texto atual (e as correções que fizeste) é substituído.')) return;
    const blobs = []; for (const pid of d.pages) blobs.push((await dbGet('pages', pid)).blob);
    try { const t = await ocrBlobs(blobs); d.text = t.join('\n\n'); const a = analyze(d.text); for (const k of ['date', 'due', 'amount', 'nif', 'entity', 'plate', 'type']) if (!d[k] && a[k]) d[k] = a[k]; d.sugg = a.sugg; await saveDoc(d); busy(false); vDoc(d.id); toast('Texto atualizado'); }
    catch (e) { busy(false); alert('Não consegui ler: ' + (e.message || e)); }
  },
  delDoc: async () => { const d = curDoc(); if (!confirm('Apagar este documento de vez?')) return; for (const pid of d.pages) { await dbDel('pages', pid); dropURL(pid); } for (const f of d.files || []) await dbDel('files', f.id); await dbDel('docs', d.id); S.docs = S.docs.filter(x => x !== d); toast('Documento apagado'); history.back(); },
  pdf: async () => {
    const d = curDoc();
    if (d.origPdf) { const f = await dbGet('files', d.origPdf); if (f) return offerFile(f.blob, f.name, `«${f.name}»`); }
    if (!d.pages.length) return toast('Este documento não tem páginas para PDF');
    busy(true, 'A criar o PDF…', null);
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
    const blob = new Blob([ics], { type: 'text/calendar' }); away();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = safeName(sum) + '.ics'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 8000);
    toast('Toca em «Adicionar» para guardar no Calendário (avisos 3 dias antes e no próprio dia)');
  },
  backup: () => exportBackup(),
  restore: () => { away(); $('#impIn').click(); },
  persist: async () => { await askPersist(); vSettings(); },
  clearRules: async () => { if (!confirm('Esquecer todas as regras aprendidas?')) return; S.rules = {}; await dbPut('kv', S.rules, 'rules'); vSettings(); },
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
    if (k === 'carId') { if (v) d.carId = v; else delete d.carId; await saveDoc(d); return vDoc(d.id); }
    if (k === 'carCat') { d.carCat = v; await saveDoc(d); return vDoc(d.id); }
    if (k === 'folder' && v === '__new') { el.value = d.folder; return newFolderSheet(folderById(d.folder)?.parent || d.folder, d.id); }
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
  } else if (el.dataset.car || el.dataset.exp || el.dataset.cd) {
    return carChange(el);
  } else if (el.dataset.lock) {
    L.cfg[el.dataset.lock] = el.value; await saveLock(); toast('Guardado');
  } else if (el.dataset.set) {
    S.set[el.dataset.set] = el.value; await dbPut('kv', S.set, 'set'); toast('Guardado');
  }
});


/* ---------------- Garagem: carros ---------------- */
const np = p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const fmtPlate = p => { const c = np(p); return c.length === 6 ? `${c.slice(0, 2)}-${c.slice(2, 4)}-${c.slice(4)}` : String(p || '').toUpperCase(); };
const carById = id => S.cars.find(c => c.id === id);
const carName = c => [c.brand, c.model].filter(Boolean).join(' ') || 'Carro';
const sum = a => a.reduce((x, y) => x + (+y || 0), 0);
async function saveCars() { await dbPut('kv', S.cars, 'cars'); }
async function saveCar(c) { c.updated = Date.now(); await saveCars(); }
const STATUS = { stock: ['Em stock', 'b-ac'], venda: ['À venda', 'b-or'], vendido: ['Vendido', 'b-gr'], pessoal: ['Pessoal', 'b-gy'] };
const CAR_CATS = [['compra', 'Compra e transferência', '🤝'], ['dua', 'Documento Único', '🪪'], ['iuc', 'IUC', '💶'], ['insp', 'Inspeção', '🔍'], ['seguro', 'Seguro', '🛡️'], ['rep', 'Reparações e peças', '🔧'], ['multas', 'Multas e portagens', '🚨'], ['venda', 'Venda', '💰'], ['outros', 'Outros', '📄']];
const EXP_CATS = ['Peças', 'Mão de obra (oficina)', 'Pneus', 'Inspeção', 'IUC', 'Registo e documentos', 'Seguro', 'Limpeza e estética', 'Transporte/reboque', 'Anúncios', 'Combustível', 'Multas e portagens', 'Outros'];
const CAT2EXP = { rep: 'Peças', insp: 'Inspeção', iuc: 'IUC', seguro: 'Seguro', multas: 'Multas e portagens', dua: 'Registo e documentos', compra: 'Registo e documentos', outros: 'Outros' };
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }
function carOfDoc(d) {
  if (d.carId === 'none') return null;
  if (d.carId) return carById(d.carId) || null;
  const p = np(d.plate);
  if (p.length === 6) { const c = S.cars.find(c => np(c.plate) === p); if (c) return c; }
  for (const c of S.cars) { const cp = np(c.plate).toLowerCase(); if (cp.length === 6 && d._sp && d._sp.includes(cp)) return c; }
  return null;
}
const docsOfCar = c => S.docs.filter(d => carOfDoc(d) === c);
function carCat(d, c) {
  if (d.carCat) return d.carCat;
  if (d.folder === 'car-cv') {
    if (c.sellDate && d.date && d.date >= addDays(c.sellDate, -20)) return 'venda';
    if (c.buyDate && d.date && d.date > addDays(c.buyDate, 30) && c.status === 'vendido') return 'venda';
    return 'compra';
  }
  return { 'car-doc': 'dua', 'car-iuc': 'iuc', 'car-insp': 'insp', 'car-seg': 'seguro', 'fin-seguros': 'seguro', 'car-multas': 'multas', 'car-port': 'multas', 'car-rep': 'rep', 'ativ-forn': 'rep', 'ativ-cli': 'rep' }[d.folder] || 'outros';
}
function tradeSrc(c) { const a = c.fromTrade && carById(c.fromTrade); return a && a.trade && a.trade.on && a.trade.carId === c.id ? a : null; }
function carCalc(c) {
  const src = tradeSrc(c);
  const buyRaw = src ? src.trade.value : c.buyPrice;
  const buy = buyRaw != null && buyRaw !== '' ? +buyRaw : 0;
  const exp = sum((c.expenses || []).map(e => e.amount));
  const cost = buy + exp;
  const tr = c.trade && c.trade.on ? c.trade : null;
  const sellVal = tr ? ((tr.cash != null || tr.value != null) ? (+tr.cash || 0) + (+tr.value || 0) : null) : (c.sellPrice != null && c.sellPrice !== '' ? +c.sellPrice : null);
  const sold = sellVal != null;
  const profit = sold ? sellVal - cost : null;
  const end = c.sellDate || todayISO();
  const days = c.buyDate ? Math.max(0, daysBetween(c.buyDate, end)) : null;
  const tVal = tr ? (+tr.value || 0) : 0, tCar = tr && tr.carId ? carById(tr.carId) : null;
  const tCarSold = tCar ? (tCar.trade && tCar.trade.on ? (tCar.trade.cash != null || tCar.trade.value != null) : tCar.sellPrice != null && tCar.sellPrice !== '') : false;
  const pending = sold && tr && tVal > 0 && !tCarSold ? tVal : 0; // lucro ainda «preso» no carro da retoma
  return { buy, exp, cost, sold, sellVal, profit, margin: sold && cost ? profit / cost : null, days, perDay: sold && days ? profit / days : null, tr, tVal, tCar, pending, cashIn: tr ? (+tr.cash || 0) : sellVal, src };
}
function chainOf(c) {
  let r = c, g = 0; while (tradeSrc(r) && g++ < 30) r = tradeSrc(r);
  const arr = [r]; g = 0;
  while (r.trade && r.trade.on && r.trade.carId && carById(r.trade.carId) && g++ < 30) { r = carById(r.trade.carId); arr.push(r); }
  return arr;
}
function syncTrade(a) {
  const b = a.trade && a.trade.carId && carById(a.trade.carId); if (!b) return null;
  b.fromTrade = a.id; b.buyPrice = a.trade.value ?? null; if (a.sellDate) b.buyDate = a.sellDate; if (!b.buyFrom && a.sellTo) b.buyFrom = a.sellTo; b.updated = Date.now(); return b;
}
const eur0 = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 });
function carThumb(c) { return c.thumb || 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110"><rect width="160" height="110" fill="#dde3ec"/><text x="80" y="70" font-size="48" text-anchor="middle">🚗</text></svg>'); }
function statusBadge(c) { const [t, cl] = STATUS[c.status] || STATUS.stock; return `<span class="badge ${cl}">${t}</span>`; }
function carRow(c) {
  const k = carCalc(c);
  const line = c.status === 'pessoal' ? `Gastos: ${eur0(k.exp)}` : k.sold ? `Lucro ${eur0(k.profit)}` : `Investido ${eur0(k.cost)}${k.days != null ? ` · ${k.days} dias` : ''}`;
  return `<button class="row carrow" data-go="#/car/${c.id}"><img class="cth" src="${carThumb(c)}" alt=""><div class="mid"><div class="pl">${esc(fmtPlate(c.plate) || 'sem matrícula')}</div><div class="t">${esc(carName(c))}${c.year ? ` <span class="muted">${esc(String(c.year).slice(0, 4))}</span>` : ''}</div><div class="s">${statusBadge(c)} <span class="${k.sold ? (k.profit >= 0 ? 'pos' : 'neg') : ''}">${line}</span></div>${k.src ? `<div class="s">🔁 retoma do ${esc(fmtPlate(k.src.plate))}</div>` : ''}${k.pending ? `<div class="s">⏳ ${eur0(k.pending)} ainda no carro da retoma</div>` : ''}</div></button>`;
}
function vGarage() {
  const f = folderById('carros'); setBar(`${f.emoji || '🚗'} ${f.name}`, true, false);
  const years = [...new Set(S.cars.filter(c => c.status === 'vendido' && c.sellDate).map(c => +c.sellDate.slice(0, 4)))].sort((a, b) => b - a);
  const thisY = new Date().getFullYear(); if (!years.includes(thisY)) years.unshift(thisY);
  const yr = S.carYear || thisY;
  const biz = S.cars.filter(c => c.status !== 'pessoal');
  const sold = biz.filter(c => c.status === 'vendido' && (c.sellDate || '').startsWith(String(yr)));
  const stock = biz.filter(c => c.status !== 'vendido');
  const ks = sold.map(carCalc);
  const profit = sum(ks.map(k => k.profit)), dd = ks.map(k => k.days).filter(x => x != null), pend = sum(ks.map(k => k.pending));
  const flt = S.carFilter;
  const list = S.cars.filter(c => flt === 'todos' || (flt === 'stock' ? ['stock', 'venda'].includes(c.status) : c.status === flt))
    .sort((a, b) => (a.status === 'vendido') - (b.status === 'vendido') || (b.sellDate || b.buyDate || '').localeCompare(a.sellDate || a.buyDate || '') || b.created - a.created);
  let html = '';
  if (biz.length) html += `<div class="stats"><div class="st"><small>Lucro ${yr}</small><b class="${profit >= 0 ? 'pos' : 'neg'}">${eur0(profit)}</b>${pend ? `<small>já em dinheiro: <b class="${profit - pend >= 0 ? 'pos' : 'neg'}">${eur0(profit - pend)}</b></small><small>${eur0(pend)} em retomas por vender</small>` : ''}</div><div class="st"><small>Vendidos ${yr}</small><b>${sold.length}</b></div><div class="st"><small>Em stock</small><b>${stock.length}</b><small>${eur0(sum(stock.map(c => carCalc(c).cost)))} investidos</small></div><div class="st"><small>Média até vender</small><b>${dd.length ? Math.round(sum(dd) / dd.length) + ' dias' : '—'}</b><small>${sold.length ? 'lucro médio ' + eur0(profit / sold.length) : ''}</small></div></div>
  ${years.length > 1 ? `<div class="chips" style="margin-top:8px">${years.map(y => `<button class="chip${y === yr ? ' on' : ''}" data-act="carYear" data-y="${y}">${y}</button>`).join('')}</div>` : ''}`;
  html += `<div class="chips" style="margin:14px 0 8px">${[['todos', 'Todos'], ['stock', 'Em stock'], ['vendido', 'Vendidos'], ['pessoal', 'Pessoais']].map(([k, t]) => `<button class="chip${flt === k ? ' on' : ''}" data-act="carFlt" data-f="${k}">${t}</button>`).join('')}</div>`;
  html += list.length ? `<div class="card">${list.map(carRow).join('')}</div>` : `<div class="empty"><div class="big">🚗</div><p>${S.cars.length ? 'Nenhum carro neste filtro.' : 'Ainda não tens carros. Cria o primeiro: o mais rápido é fotografar o Documento Único.'}</p></div>`;
  html += `<button class="btn pri" data-go="#/car/new">＋ Novo carro</button>`;
  const loose = sortDocs(S.docs.filter(d => (d.folder === 'carros' || (folderById(d.folder)?.parent === 'carros')) && !carOfDoc(d)));
  if (loose.length) html += `<h2>Documentos sem carro associado</h2><div class="card">${loose.slice(0, 30).map(d => docRow(d)).join('')}</div>`;
  const subs = kids('carros');
  html += `<h2>Todos os documentos por tipo</h2><div class="card">${subs.map(k => `<button class="row chev" data-go="#/f/${k.id}"><span class="em">${k.emoji || '📂'}</span><div class="mid"><div class="t">${esc(k.name)}</div></div><span class="n">${S.docs.filter(d => d.folder === k.id).length}</span></button>`).join('')}</div>
  <div class="btns"><button class="btn" data-act="garCsv">📊 Exportar tabela (Excel)</button><button class="btn" data-act="newFolder" data-p="carros">＋ Subpasta</button></div>`;
  $('#view').innerHTML = html;
}

// ---- criar carro
function carDraftFields() { return S.carDraft || (S.carDraft = { f: { status: 'stock', buyDate: todayISO() } }); }
function vCarNew() {
  setBar('Novo carro', true, false);
  const dr = carDraftFields(), f = dr.f;
  const inp = (k, lbl, extra = '') => `<div class="f"><label>${lbl}</label><input data-cd="${k}" value="${esc(f[k] ?? '')}" ${extra}></div>`;
  $('#view').innerHTML = `${dr.thumb ? `<img class="carhero" src="${dr.thumb}" alt="">` : ''}
  <p class="muted">O mais rápido é fotografar o <b>Documento Único</b>: leio a matrícula, a marca, o modelo e o resto. A fotografia do carro serve de capa (tento ler a matrícula, mas numa foto de rua nem sempre consigo).</p>
  <div class="btns"><button class="btn${dr.dua ? '' : ' pri'}" data-act="carDua">🪪 ${dr.dua ? 'DUA lido ✓' : 'Fotografar DUA'}</button><button class="btn" data-act="carPic">🚗 ${dr.photo ? 'Mudar foto' : 'Foto do carro'}</button></div>
  ${dr.photoOrig ? '<button class="btn" data-act="carTapPlate">📍 Ler a matrícula tocando na foto</button>' : ''}
  <h2>Dados</h2><div class="card form">
   ${inp('plate', 'Matrícula', 'autocapitalize="characters" placeholder="AA-00-BB"')}
   ${inp('brand', 'Marca', 'placeholder="Toyota"')}
   ${inp('model', 'Modelo', 'placeholder="Corolla"')}
   ${inp('year', '1.ª matrícula', 'type="date"')}
   <div class="f"><label>Estado</label><select data-cd="status">${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
   ${f.status !== 'pessoal' ? (() => {
      const elig = tradeEligible(null);
      const oa = f.origin && carById(f.origin);
      let h = elig.length || oa ? `<button class="row chev pick" data-act="pickOrigin"><span class="em">${oa ? '🔁' : '🛒'}</span><div class="mid"><div class="t">${oa ? `Retoma do ${esc(fmtPlate(oa.plate))} ${esc(carName(oa))}` : 'Compra normal'}</div><div class="s">${oa ? 'Toca para mudar' : 'Foi uma retoma? Toca para escolher o carro vendido'}</div></div></button>` : '';
      h += inp('buyDate', f.origin ? 'Data da troca' : 'Data compra', 'type="date"');
      if (f.origin) { const a = carById(f.origin); h += inp('tradeValue', 'Avaliação €', 'inputmode="decimal" placeholder="o que pagarias por ele"') + inp('tradeCash', 'Dinheiro recebido €', `inputmode="decimal" placeholder="na venda do ${esc(fmtPlate(a?.plate))}"`); }
      else h += inp('buyPrice', 'Valor compra €', 'inputmode="decimal" placeholder="0,00"') + inp('buyFrom', 'Comprado a', 'placeholder="—"');
      return h; })() : ''}
   ${inp('km_in', 'Km', 'inputmode="numeric" placeholder="—"')}
  </div>
  <button class="btn pri" data-act="carSave">Criar carro</button>
  <button class="btn red" data-act="carCancel">Cancelar</button>`;
}
const BRANDS = [['alfa romeo', 'Alfa Romeo'], ['mercedes-benz', 'Mercedes-Benz'], ['mercedes', 'Mercedes-Benz'], ['land rover', 'Land Rover'], ['volkswagen', 'Volkswagen'], ['vw', 'Volkswagen'], ['toyota', 'Toyota'], ['renault', 'Renault'], ['peugeot', 'Peugeot'], ['citroen', 'Citroën'], ['seat', 'SEAT'], ['cupra', 'Cupra'], ['skoda', 'Škoda'], ['audi', 'Audi'], ['bmw', 'BMW'], ['opel', 'Opel'], ['ford', 'Ford'], ['fiat', 'Fiat'], ['nissan', 'Nissan'], ['honda', 'Honda'], ['mazda', 'Mazda'], ['mitsubishi', 'Mitsubishi'], ['hyundai', 'Hyundai'], ['kia', 'Kia'], ['dacia', 'Dacia'], ['volvo', 'Volvo'], ['mini', 'MINI'], ['smart', 'Smart'], ['suzuki', 'Suzuki'], ['lancia', 'Lancia'], ['jeep', 'Jeep'], ['porsche', 'Porsche'], ['tesla', 'Tesla'], ['lexus', 'Lexus'], ['chevrolet', 'Chevrolet'], ['subaru', 'Subaru'], ['jaguar', 'Jaguar'], ['mg', 'MG'], ['byd', 'BYD'], ['ds', 'DS'], ['saab', 'Saab'], ['rover', 'Rover'], ['daewoo', 'Daewoo'], ['chrysler', 'Chrysler'], ['dodge', 'Dodge'], ['iveco', 'Iveco'], ['isuzu', 'Isuzu'], ['ssangyong', 'SsangYong']];
function parseDua(text) {
  const up = text.toUpperCase(), n = norm(text), out = {};
  out.plate = findPlate(up) || '';
  const lines = up.split('\n');
  const code = (rx) => { for (const l of lines) { const m = rx.exec(l); if (m && m[1].trim().length > 1) return m[1].trim(); } return ''; };
  let brand = ''; for (const [k, v] of BRANDS) { const r = rxFor(k); const m = r.exec(n); if (m) { brand = v; break; } }
  out.brand = brand || titleCase(code(/\bD\.?\s?1\.?\s*[:\-]?\s*([A-Z][A-Z\- ]{1,20})/));
  let model = code(/\bD\.?\s?3\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9 \-.\/]{1,28})/);
  if (!model && brand) { const i = n.indexOf(norm(brand)); if (i >= 0) { const rest = text.slice(i + brand.length, i + brand.length + 30).split('\n')[0].trim(); if (/^[A-Za-z0-9]/.test(rest)) model = rest.split(/\s{2,}/)[0]; } }
  out.model = titleCase(model.replace(/\s+/g, ' ').trim());
  const vins = up.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || up.replace(/[ \t]/g, '').match(/[A-HJ-NPR-Z0-9]{17}/g); if (vins) out.vin = vins.find(v => /\d/.test(v) && /[A-Z]/.test(v)) || '';
  const ds = findDates(n).map(x => x.iso).sort(); if (ds.length) out.year = ds[0];
  out.fuel = /gasoleo|diesel/.test(n) ? 'Gasóleo' : /eletric|electric/.test(n) ? 'Elétrico' : /hibrid/.test(n) ? 'Híbrido' : /\bgpl\b/.test(n) ? 'GPL' : /gasolina/.test(n) ? 'Gasolina' : '';
  const cc = code(/\bP\.?\s?1\.?\s*[:\-]?\s*(\d{3,4})\b/) || (up.match(/\b(\d{3,4})\s?(?:CM3|CM³|CC)\b/) || [])[1]; if (cc) out.cc = cc;
  return out;
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s\-\/])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Gti|Tdi|Hdi|Dci|Tsi|Tfsi|Cdi|Crdi|Vti|Gt|Rs|St|Sw|Xdi|D4d|D-4d|Vvt-I)\b/g, x => x.toUpperCase()); }
async function grayCrop(blob, x0, y0, x1, y1, maxW = 2000) {
  const im = await loadImg(blob); const W = im.naturalWidth, H = im.naturalHeight;
  const sx = x0 * W, sy = y0 * H, sw = (x1 - x0) * W, sh = (y1 - y0) * H; const k = Math.min(3, maxW / sw);
  const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const x = c.getContext('2d'); x.filter = 'grayscale(1) contrast(1.4)'; x.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); c.width = c.height = 0; return out;
}
const L2D = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', T: '7', Z: '2', S: '5', B: '8', G: '6', A: '4' }, D2L = { 0: 'O', 1: 'I', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B' };
const PLATE_FMT = [['L', 'D', 'L'], ['D', 'L', 'D'], ['D', 'D', 'L'], ['L', 'D', 'D']];
// procura uma matrícula portuguesa (AA-00-AA, 00-AA-00, 00-00-AA, AA-00-00), corrigindo confusões do OCR (O/0, I/1, S/5, B/8…)
function bestPlate(text) {
  let best = null;
  const FMT = [['D', 'D', 'L'], ['L', 'D', 'L'], ['D', 'L', 'D'], ['L', 'D', 'D']];
  const tryGroups = (gs, base) => {
    FMT.forEach((fm, fi) => {
      let cost = 0, ok = true; const out = [];
      for (let k = 0; k < 3 && ok; k++) {
        let gg = '';
        for (const ch of gs[k]) {
          if (fm[k] === 'D') { if (/\d/.test(ch)) gg += ch; else if (L2D[ch]) { gg += L2D[ch]; cost += 1; } else ok = false; }
          else { if (/[A-Z]/.test(ch)) gg += ch; else if (D2L[ch]) { gg += D2L[ch]; cost += 1.2; } else ok = false; }
        }
        out.push(gg);
      }
      if (ok && cost <= 1.2) { const sc = base + cost + fi * 0.01; if (!best || sc < best.sc) best = { plate: out.join('-'), sc }; }
    });
  };
  for (let line of String(text || '').toUpperCase().split('\n')) {
    line = line.replace(/^\W*P\s+(?=[A-Z0-9]{2}\W)/, ''); // «P» da faixa azul
    // 1) com separadores: AA-00-AA, AA·00·AA, AA 00 AA
    const rx = /(?:^|[^A-Z0-9])([A-Z0-9]{2})(\s?[-–·.:]\s?|\s)([A-Z0-9]{2})(\s?[-–·.:]\s?|\s)([A-Z0-9]{2})(?=$|[^A-Z0-9])/g; let m;
    while ((m = rx.exec(line))) { const p1 = /[-–·.:]/.test(m[2]), p2 = /[-–·.:]/.test(m[4]); tryGroups([m[1], m[3], m[5]], p1 && p2 ? -0.5 : !p1 && !p2 ? 0 : 0.4); rx.lastIndex = m.index + 1; }
    // 2) sem separadores, mas a começar no início de uma palavra
    const toks = line.split(/[^A-Z0-9]+/).filter(Boolean);
    for (let t = 0; t < toks.length; t++) {
      const s = toks.slice(t, t + 3).join('');
      if (s.length >= 6 && toks[t].length <= 6) tryGroups([s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)], s.length === 6 ? 0.3 : 0.6);
    }
  }
  return best;
}
function plateIn(t) { const b = bestPlate(t); return b && b.sc <= 1.3 ? b.plate : ''; }
async function cropPrep(blob, x0, y0, x1, y1, outW = 1400) {
  const im = await loadImg(blob); const W = im.naturalWidth, H = im.naturalHeight;
  const sx = Math.max(0, x0 * W), sy = Math.max(0, y0 * H), sw = Math.min(W - sx, (x1 - x0) * W), sh = Math.min(H - sy, (y1 - y0) * H);
  const k = Math.min(4, outW / sw); const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const id = x.getImageData(0, 0, c.width, c.height); normalizeImageData(id); x.putImageData(id, 0, 0);
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); c.width = c.height = 0; return out;
}
async function readPlate(blob) {
  const w = await getWorker();
  const zones = [[0, 0, 1, 1], [0, 0.35, 1, 1], [0.1, 0.45, 0.9, 0.95], [0, 0.2, 1, 0.8], [0.2, 0.55, 0.8, 0.9]];
  let best = null;
  try {
    for (let i = 0; i < zones.length; i++) {
      busy(true, 'A procurar a matrícula na fotografia…', i / zones.length);
      const b = bestPlate((await w.recognize(await cropPrep(blob, ...zones[i], 2400))).data.text);
      if (b && (!best || b.sc < best.sc)) best = b; if (best && best.sc <= 0) break;
    }
    return best && best.sc <= 1.3 ? best.plate : '';
  } catch (e) { console.warn(e); return ''; }
  finally { busy(false); }
}
// o utilizador toca na matrícula: lê só essa zona, em vários tamanhos
function tapPlate(blob) {
  return new Promise(resolve => {
    const ov = $('#tap'), img = $('#tapImg'), box = $('#tapBox'); const u = URL.createObjectURL(blob);
    img.src = u; ov.hidden = false; box.hidden = true; $('#tapMsg').textContent = 'Toca no centro da matrícula';
    const done = v => { ov.hidden = true; img.onclick = null; $('#tapCancel').onclick = null; URL.revokeObjectURL(u); resolve(v); };
    $('#tapCancel').onclick = () => done('');
    img.onclick = async e => {
      const r = img.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      const ar = img.naturalWidth / img.naturalHeight;
      box.style.left = (fx * 100 - 15) + '%'; box.style.top = `calc(${fy * 100}% - ${r.width * 0.3 / 4.5 / 2}px)`; box.style.width = '30%'; box.style.height = (r.width * 0.3 / 4.5) + 'px'; box.hidden = false;
      $('#tapMsg').textContent = 'A ler…';
      const w = await getWorker(); let best = null;
      for (const bw of [0.22, 0.32, 0.45, 0.16]) {
        const bh = bw * ar / 4.2 * 1.6;
        const t = (await w.recognize(await cropPrep(blob, fx - bw / 2, fy - bh / 2, fx + bw / 2, fy + bh / 2))).data.text;
        const b = bestPlate(t); if (b && (!best || b.sc < best.sc)) best = b; if (best && best.sc <= 0) break;
      }
      if (best) done(best.plate); else { $('#tapMsg').textContent = 'Não consegui ler. Toca outra vez, mais ao centro da matrícula'; box.hidden = true; }
    };
  });
}
let carPickMode = null;
function pickCarImage(mode) { carPickMode = mode; away(); $('#carIn').click(); }
$('#carIn').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const mode = carPickMode; carPickMode = null;
  try {
    busy(true, 'A preparar a fotografia…', null);
    if (mode === 'dua' || mode === 'dua-car') {
      const r = await prepImage(file); const [t] = await ocrBlobs([r.blob]); busy(false);
      const info = parseDua(t || '');
      if (mode === 'dua') {
        const dr = carDraftFields(); dr.dua = { blob: r.blob, text: t };
        for (const k of ['plate', 'brand', 'model', 'year', 'fuel', 'cc', 'vin']) if (info[k] && !dr.f[k]) dr.f[k] = info[k];
        toast(info.plate ? `Li ${info.plate}${info.brand ? ' · ' + info.brand : ''}${info.model ? ' ' + info.model : ''} — confirma os dados` : 'Não consegui ler a matrícula — escreve-a tu');
        vCarNew();
      } else {
        const c = curCar(); let n = 0;
        for (const k of ['plate', 'brand', 'model', 'year', 'fuel', 'cc', 'vin']) if (info[k] && !c[k]) { c[k] = info[k]; n++; }
        await saveCar(c);
        await buildDoc({ photos: [r.blob], files: [], preTexts: [t], carId: c.id, title: 'Documento Único ' + fmtPlate(c.plate), folder: 'car-doc' });
        busy(false); toast(`DUA arquivado no carro${n ? ` · ${n} campo${n === 1 ? '' : 's'} preenchido${n === 1 ? '' : 's'}` : ''}`); vCar(c.id);
      }
    } else {
      const r = await prepImage(file, 0, 1600, 0.8); const thumb = await makeThumb(r.blob);
      if (mode === 'pic') {
        const dr = carDraftFields(); dr.photo = r.blob; dr.thumb = thumb;
        dr.photoOrig = file;
        if (!dr.f.plate) {
          let p = await readPlate(file);
          if (!p) { busy(false); p = await tapPlate(file); }
          if (p) { dr.f.plate = p; toast(`Li ${p} — confirma`); } else toast('Não consegui ler a matrícula — escreve-a ou fotografa o DUA');
        }
        busy(false); vCarNew();
      } else {
        const c = curCar();
        if (!c.plate) { let p = await readPlate(file); if (!p) { busy(false); p = await tapPlate(file); } if (p) { c.plate = p; toast(`Li ${p}`); } }
        if (c.photo) await dbDel('pages', c.photo);
        c.photo = 'cp-' + uid(); await dbPut('pages', { id: c.photo, docId: 'car:' + c.id, blob: r.blob }); c.thumb = thumb; await saveCar(c); dropURL(c.photo);
        busy(false); vCar(c.id);
      }
    }
  } catch (err) { busy(false); alert('Erro: ' + (err.message || err)); }
};
let gpCb = null;
function garagePicker(title, cars, onPick, extra = '') {
  gpCb = onPick;
  sheet(`<div class="grp"><p><b>${title}</b></p><div class="gp">${cars.map(x => `<button class="row carrow" data-act="gpPick" data-id="${x.id}"><img class="cth" src="${carThumb(x)}" alt=""><div class="mid"><div class="pl">${esc(fmtPlate(x.plate) || 'sem matrícula')}</div><div class="t">${esc(carName(x))}</div><div class="s">${statusBadge(x)}${x.sellDate ? ` <span class="muted">vendido ${fmtDate(x.sellDate)}</span>` : x.buyDate ? ` <span class="muted">desde ${fmtDate(x.buyDate)}</span>` : ''}</div></div></button>`).join('') || '<div class="row muted">Não há carros para escolher</div>'}</div>${extra}</div><div class="grp"><button class="it" data-act="closeSheet">Cancelar</button></div>`);
}
function tradeEligibleB(a) { return S.cars.filter(b => b !== a && !tradeSrc(b) && !chainOf(b).includes(a) && b.status !== 'vendido'); }
function tradeEligible(b) { return S.cars.filter(a => a !== b && a.status !== 'pessoal' && !(a.trade && a.trade.on && a.trade.carId && carById(a.trade.carId)) && !(b && chainOf(a).includes(b))); }
// liga o carro vendido A ao carro B recebido em retoma
async function linkTrade(a, b, value, cash) {
  a.trade ||= { on: false, cash: null, value: null, carId: null };
  if (value == null) value = a.trade.value ?? (b.buyPrice != null && b.buyPrice !== '' ? +b.buyPrice : null);
  if (cash == null) cash = a.trade.on ? a.trade.cash : null;
  if (cash == null && a.sellPrice != null && a.sellPrice !== '') {
    cash = confirm(`A venda do ${fmtPlate(a.plate)} estava registada por ${eur0(+a.sellPrice)}.\n\nEsse valor JÁ INCLUI a retoma de ${eur0(value || 0)}?\n\nOK = sim (o dinheiro recebido foi ${eur0(+a.sellPrice - (value || 0))})\nCancelar = não (recebeste ${eur0(+a.sellPrice)} em dinheiro mais o carro)`) ? +a.sellPrice - (value || 0) : +a.sellPrice;
  }
  Object.assign(a.trade, { on: true, cash, value, carId: b.id });
  if (a.status !== 'vendido') { a.status = 'vendido'; if (!a.sellDate) a.sellDate = b.buyDate || todayISO(); }
  a.sellPrice = carCalc(a).sellVal; syncTrade(a); await saveCar(a);
}
async function createCar() {
  const dr = carDraftFields(), f = dr.f;
  if (!np(f.plate) && !f.brand && !f.model) return toast('Escreve pelo menos a matrícula ou a marca e o modelo');
  if (np(f.plate) && S.cars.some(c => np(c.plate) === np(f.plate))) { if (!confirm(`Já existe um carro com a matrícula ${fmtPlate(f.plate)}. Criar outro na mesma? (Útil se o voltaste a comprar.)`)) return; }
  const { origin, tradeValue, tradeCash, ...ff } = f;
  const c = { id: uid(), created: Date.now(), expenses: [], ...ff, plate: fmtPlate(f.plate) };
  if (c.buyPrice != null && c.buyPrice !== '') c.buyPrice = parseNum(c.buyPrice);
  const srcA = origin && carById(origin);
  if (srcA && (tradeValue == null || String(tradeValue).trim() === '')) return toast('Escreve a avaliação da retoma');
  if (dr.photo) { c.photo = 'cp-' + uid(); await dbPut('pages', { id: c.photo, docId: 'car:' + c.id, blob: dr.photo }); c.thumb = dr.thumb; }
  S.cars.push(c); await saveCar(c);
  if (srcA) await linkTrade(srcA, c, parseNum(tradeValue), tradeCash != null && String(tradeCash).trim() !== '' ? parseNum(tradeCash) : null);
  if (dr.dua) { busy(true, 'A arquivar o DUA…', null); await buildDoc({ photos: [dr.dua.blob], files: [], preTexts: [dr.dua.text], carId: c.id, title: 'Documento Único ' + fmtPlate(c.plate), folder: 'car-doc' }); busy(false); }
  S.carDraft = null; history.replaceState(null, '', '#/car/' + c.id); render(); toast('Carro criado');
}
function parseNum(v) { if (typeof v === 'number') return v; v = String(v || '').replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); const n = parseFloat(v); return isNaN(n) ? null : n; }
const curCar = () => { const m = location.hash.match(/^#\/car\/(.+)$/); return m && carById(m[1]); };

// ---- ficha do carro
async function vCar(id) {
  const c = carById(id); if (!c) return go('#/f/carros');
  setBar(fmtPlate(c.plate) || carName(c), true, false);
  const k = carCalc(c), tab = S.carTab, docs = docsOfCar(c), pess = c.status === 'pessoal';
  let html = `<div class="carhead"><img class="cimg" src="${c.photo ? '' : carThumb(c)}" data-cphoto="${c.photo || ''}" data-act="carPhotoAct" alt="">
   <div class="cinfo"><div class="plate">${esc(fmtPlate(c.plate) || '—')}</div><div class="t">${esc(carName(c))}</div><div class="s">${esc([c.year ? String(c.year).slice(0, 4) : '', c.fuel, c.cc ? c.cc + ' cm³' : ''].filter(Boolean).join(' · '))}</div>
   <select data-car="status" class="stsel">${Object.entries(STATUS).map(([s, [t]]) => `<option value="${s}"${c.status === s ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div>`;
  if (!pess) html += `<div class="profit ${k.sold ? (k.profit >= 0 ? 'pos' : 'neg') : ''}"><div><small>${k.sold ? (k.pending ? 'Lucro (provisório)' : 'Lucro') : 'Investido até agora'}</small><b>${k.sold ? eur0(k.profit) : eur0(k.cost)}</b></div><div><small>${k.sold ? 'Margem' : 'Dias em stock'}</small><b>${k.sold ? (k.margin != null ? Math.round(k.margin * 100) + '%' : '—') : (k.days ?? '—')}</b></div><div><small>${k.sold ? 'Dias até vender' : 'Preço pedido'}</small><b>${k.sold ? (k.days ?? '—') : (c.askPrice ? eur0(c.askPrice) : '—')}</b></div></div>`;
  html += `<div class="seg">${[['contas', pess ? 'Gastos' : 'Contas'], ['docs', `Documentos (${docs.length})`], ['dados', 'Dados']].map(([t, n]) => `<button class="${tab === t ? 'on' : ''}" data-act="carTab" data-t="${t}">${n}</button>`).join('')}</div>`;
  const inp = (key, lbl, extra = '', val) => `<div class="f"><label>${lbl}</label><input data-car="${key}" value="${esc(val ?? c[key] ?? '')}" ${extra}></div>`;
  const money = key => (c[key] != null && c[key] !== '' ? String(Number(c[key]).toFixed(2)).replace('.', ',') : '');
  if (tab === 'contas') {
    const ch = chainOf(c);
    if (ch.length > 1) {
      const sold = ch.filter(x => carCalc(x).sold), last = ch[ch.length - 1], lk = carCalc(last);
      const tot = sum(sold.map(x => carCalc(x).profit)), pendC = lk.sold ? 0 : (carCalc(ch[ch.length - 2]).tVal || 0);
      html += `<div class="sec s-trade"><div class="sh"><span>🔁 Cadeia de retomas</span><b>${eur0(tot)}</b></div>
       ${ch.map((x, i) => { const kx = carCalc(x); return `<button class="row${x === c ? ' cur' : ''}" data-go="#/car/${x.id}"><span class="em">${i + 1}</span><div class="mid"><div class="t">${esc(fmtPlate(x.plate) || 'sem matrícula')} · ${esc(carName(x))}</div><div class="s">${kx.sold ? `vendido por ${eur0(kx.sellVal)}${kx.tr ? ` (${eur0(kx.tr.cash || 0)} + retoma ${eur0(kx.tVal)})` : ''}` : 'por vender'}</div></div><b class="${kx.sold ? (kx.profit >= 0 ? 'pos' : 'neg') : ''}">${kx.sold ? eur0(kx.profit) : '—'}</b></button>`; }).join('')}
       <div class="r2">${lk.sold ? 'Cadeia fechada: este é o lucro real de todas as trocas.' : `Lucro já em dinheiro: <b>${eur0(tot - pendC)}</b> · ainda no ${esc(fmtPlate(last.plate) || 'último carro')}: <b>${eur0(pendC)}</b> (só fica certo quando o venderes)`}</div></div>`;
    }
    if (!pess) {
      html += `<div class="sec s-buy"><div class="sh"><span>🛒 Compra</span><b>${eur0(k.buy)}</b></div><div class="form">${inp('buyDate', 'Data', 'type="date"')}`;
      if (k.src) html += `<div class="f"><label>Valor</label><span class="ro">${eur0(k.buy)}</span></div><button class="row chev" data-go="#/car/${k.src.id}"><span class="em">🔁</span><div class="mid"><div class="t">Recebido em retoma do ${esc(fmtPlate(k.src.plate))}</div><div class="s">O valor vem da avaliação feita nessa venda — muda-o lá</div></div></button>`;
      else {
        html += inp('buyPrice', 'Valor €', 'inputmode="decimal" placeholder="0,00"', money('buyPrice'));
        const elig = tradeEligible(c);
        if (elig.length) html += `<button class="row chev pick" data-act="pickFromLink"><span class="em">🔁</span><div class="mid"><div class="t">Foi retoma?</div><div class="s">Toca para escolher na garagem o carro que vendeste</div></div></button>`;
      }
      html += `${inp('buyFrom', 'Comprado a', 'placeholder="—"')}${inp('km_in', 'Km', 'inputmode="numeric" placeholder="—"')}</div></div>`;
    }
    html += `<div class="sec s-exp"><div class="sh"><span>🔧 ${pess ? 'Gastos' : 'Despesas'}</span><b>${eur0(k.exp)}</b></div>${(c.expenses || []).map((e, i) => `<div class="exp">
      <input class="ed" data-exp="desc" data-i="${i}" value="${esc(e.desc || '')}" placeholder="Descrição">
      <input class="ea" data-exp="amount" data-i="${i}" inputmode="decimal" value="${e.amount != null ? String(Number(e.amount).toFixed(2)).replace('.', ',') : ''}" placeholder="0,00 €">
      <input class="edt" type="date" data-exp="date" data-i="${i}" value="${esc(e.date || '')}">
      <select class="ec" data-exp="cat" data-i="${i}">${EXP_CATS.map(x => `<option${e.cat === x ? ' selected' : ''}>${x}</option>`).join('')}</select>
      <span class="eb">${e.docId && docById(e.docId) ? `<button data-go="#/d/${e.docId}" aria-label="Ver fatura">📎 fatura</button>` : ''}<button data-act="expDel" data-i="${i}" aria-label="Apagar">✕</button></span></div>`).join('') || '<div class="row muted">Ainda sem despesas</div>'}
      <button class="addl" data-act="expAdd">＋ Adicionar despesa</button></div>`;
    if (!pess) {
      const tr = c.trade || {};
      html += `<div class="sec s-sell"><div class="sh"><span>💰 Venda</span><b>${k.sold ? eur0(k.sellVal) : '—'}</b></div><div class="form">
        ${k.sold ? '' : inp('askPrice', 'Preço pedido €', 'inputmode="decimal" placeholder="—"', money('askPrice')) + inp('minPrice', 'Mínimo aceito €', 'inputmode="decimal" placeholder="—"', money('minPrice'))}
        ${inp('sellDate', 'Data venda', 'type="date"')}
        <div class="f"><label>Houve retoma?</label><span style="flex:1"></span><input type="checkbox" data-car="tradeOn"${tr.on ? ' checked' : ''}></div>
        ${tr.on ? `${inp('tradeCash', 'Dinheiro recebido €', 'inputmode="decimal" placeholder="0,00 (negativo se pagaste tu)"', tr.cash != null ? String(Number(tr.cash).toFixed(2)).replace('.', ',') : '')}
          ${inp('tradeValue', 'Avaliação da retoma €', 'inputmode="decimal" placeholder="o que pagarias pelo carro"', tr.value != null ? String(Number(tr.value).toFixed(2)).replace('.', ',') : '')}
          <div class="f"><label>Venda total</label><span class="ro">${k.sold ? `${eur0(k.cashIn)} + ${eur0(k.tVal)} = <b>${eur0(k.sellVal)}</b>` : '—'}</span></div>`
          : inp('sellPrice', 'Valor venda €', 'inputmode="decimal" placeholder="—"', money('sellPrice'))}
        ${inp('sellTo', 'Vendido a', 'placeholder="—"')}${inp('km_out', 'Km venda', 'inputmode="numeric" placeholder="—"')}</div>
        ${tr.on ? (k.tCar ? `<button class="row chev" data-go="#/car/${k.tCar.id}"><span class="em">🔁</span><div class="mid"><div class="t">Carro da retoma: ${esc(fmtPlate(k.tCar.plate) || 'sem matrícula')} ${esc(carName(k.tCar))}</div><div class="s">${carCalc(k.tCar).sold ? 'já vendido' : 'por vender'}</div></div></button>`
          : `<button class="addl" data-act="pickTradeCar">🚗 Escolher da garagem o carro da retoma</button>`) : ''}
      </div>`;
      const byCat = {}; for (const e of c.expenses || []) byCat[e.cat || 'Outros'] = (byCat[e.cat || 'Outros'] || 0) + (+e.amount || 0);
      html += `<div class="sec s-sum"><div class="sh"><span>📊 Resumo</span><b class="${k.sold ? (k.profit >= 0 ? 'pos' : 'neg') : ''}">${k.sold ? eur0(k.profit) : ''}</b></div><div class="sum">
       <div class="r"><span>Compra${k.src ? ' (retoma)' : ''}</span><b>${eur0(k.buy)}</b></div>
       <div class="r"><span>Despesas</span><b>${eur0(k.exp)}</b></div>
       ${Object.entries(byCat).map(([n, v]) => `<div class="r sub"><span>${esc(n)}</span><span>${eur0(v)}</span></div>`).join('')}
       <div class="r big"><span>Custo total</span><b>${eur0(k.cost)}</b></div>
       ${k.sold ? `${k.tr ? `<div class="r"><span>Dinheiro recebido</span><b>${eur0(k.cashIn)}</b></div><div class="r"><span>Retoma (avaliação)</span><b>${eur0(k.tVal)}</b></div>` : ''}
       <div class="r"><span>Venda${k.tr ? ' total' : ''}</span><b>${eur0(k.sellVal)}</b></div>
       <div class="r big ${k.profit >= 0 ? 'pos' : 'neg'}"><span>Lucro${k.pending ? ' (provisório)' : ''}</span><b>${eur0(k.profit)}</b></div>
       ${k.pending ? `<div class="r"><span>Já em dinheiro</span><b class="${k.profit - k.pending >= 0 ? 'pos' : 'neg'}">${eur0(k.profit - k.pending)}</b></div><div class="r sub"><span>Ainda no carro da retoma: ${eur0(k.pending)} — só fica certo quando o venderes</span><span></span></div>` : ''}
       <div class="r"><span>Margem sobre o custo</span><b>${k.margin != null ? (k.margin * 100).toFixed(1).replace('.', ',') + '%' : '—'}</b></div>
       ${k.days != null ? `<div class="r"><span>Dias em stock</span><b>${k.days}</b></div>${k.perDay != null ? `<div class="r"><span>Lucro por dia</span><b>${eur0(k.perDay)}</b></div>` : ''}` : ''}
       ${k.src ? `<div class="r sub"><span>${k.profit >= 0 ? '✓ A avaliação da retoma confirmou-se' : '⚠️ A retoma foi avaliada acima do que rendeu'}</span><span></span></div>` : ''}`
        : `<div class="r"><span>Vender acima de</span><b>${eur0(k.cost)}</b></div><div class="r sub"><span>para não perder dinheiro</span><span></span></div>
       ${c.askPrice ? `<div class="r"><span>Lucro ao preço pedido</span><b class="${c.askPrice - k.cost >= 0 ? 'pos' : 'neg'}">${eur0(c.askPrice - k.cost)}</b></div>` : ''}
       ${c.minPrice ? `<div class="r"><span>Lucro ao preço mínimo</span><b class="${c.minPrice - k.cost >= 0 ? 'pos' : 'neg'}">${eur0(c.minPrice - k.cost)}</b></div>` : ''}
       ${k.days != null ? `<div class="r"><span>Dias em stock</span><b>${k.days}</b></div>` : ''}`}
      </div></div>`;
    }
    html += `<button class="btn" data-act="carCsv">📊 Exportar contas (Excel)</button>`;
  } else if (tab === 'docs') {
    const groups = {}; for (const d of docs) (groups[carCat(d, c)] ||= []).push(d);
    const missing = [];
    if (!groups.dua) missing.push('Documento Único');
    if (!pess && !groups.compra) missing.push('documento de compra/transferência');
    if (c.status === 'vendido' && !groups.venda) missing.push('documento de venda');
    if (missing.length) html += `<div class="note">⚠️ Falta: ${missing.join(', ')}.</div>`;
    for (const [key, name, em] of CAR_CATS) { const g = groups[key]; if (!g) continue; html += `<div class="sec c-${key}"><div class="sh"><span>${em} ${name}</span><b>${g.length}</b></div>${sortDocs(g).map(d => docRow(d)).join('')}</div>`; }
    if (!docs.length) html += `<div class="empty"><p>Ainda não há documentos deste carro.<br>Todos os documentos que arquivares com a matrícula ${esc(fmtPlate(c.plate))} aparecem aqui sozinhos.</p></div>`;
    html += `<button class="btn pri" data-act="carAddDoc">＋ Adicionar documento a este carro</button>`;
  } else {
    html += `<div class="sec s-data"><div class="sh"><span>🪪 Dados do carro</span></div><div class="form">${inp('plate', 'Matrícula', 'autocapitalize="characters"')}${inp('brand', 'Marca')}${inp('model', 'Modelo')}${inp('version', 'Versão', 'placeholder="—"')}${inp('year', '1.ª matrícula', 'type="date"')}
     <div class="f"><label>Combustível</label><select data-car="fuel"><option value="">—</option>${['Gasolina', 'Gasóleo', 'Híbrido', 'Elétrico', 'GPL'].map(x => `<option${c.fuel === x ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
     ${inp('cc', 'Cilindrada cm³', 'inputmode="numeric" placeholder="—"')}${inp('vin', 'VIN / quadro', 'autocapitalize="characters" placeholder="—"')}${inp('color', 'Cor', 'placeholder="—"')}
     <div class="f col"><label>Notas</label><textarea data-car="notes" rows="3" placeholder="Estado, defeitos, o que falta fazer…">${esc(c.notes || '')}</textarea></div></div></div>
     <div class="btns"><button class="btn" data-act="carPhotoNew">📷 Mudar fotografia</button><button class="btn" data-act="carDuaRead">🪪 Ler o DUA</button></div>
     <button class="btn red" data-act="carDel">Apagar carro</button><p class="muted">Apagar o carro não apaga os documentos dele.</p>`;
  }
  const v = $('#view'); v.innerHTML = html;
  const im = v.querySelector('img[data-cphoto]'); if (im && im.dataset.cphoto) pageURL(im.dataset.cphoto).then(u => im.src = u || carThumb(c));
}
async function carChange(el) {
  if (el.dataset.cd) {
    const dr = carDraftFields(), k = el.dataset.cd; dr.f[k] = el.value;
    if (k === 'origin' && el.value) { const a = carById(el.value); if (a?.trade?.cash != null && !dr.f.tradeCash) dr.f.tradeCash = String(a.trade.cash).replace('.', ','); if (a?.sellDate && !dr.f.buyDate) dr.f.buyDate = a.sellDate; }
    if (k === 'status' || k === 'origin') vCarNew(); return;
  }
  const c = curCar(); if (!c) return;
  if (el.dataset.car === 'fromLink') {
    const a = el.value && carById(el.value); if (!a) return;
    if (c.buyPrice == null || c.buyPrice === '') { const v = prompt(`Avaliação da retoma (o que pagaste por este carro na troca com o ${fmtPlate(a.plate)}), em €:`); if (v == null || !v.trim()) { el.value = ''; return; } c.buyPrice = parseNum(v); }
    await linkTrade(a, c, +c.buyPrice, null); await saveCar(c); toast(`Ligado como retoma do ${fmtPlate(a.plate)}`); return vCar(c.id);
  }
  if (el.dataset.car && el.dataset.car.startsWith('trade')) {
    const key = el.dataset.car; c.trade ||= { on: false, cash: null, value: null, carId: null };
    if (key === 'tradeOn') { c.trade.on = el.checked; if (el.checked && c.trade.cash == null && c.sellPrice != null && c.sellPrice !== '') c.trade.cash = +c.sellPrice; if (el.checked && !c.trade.carId) setTimeout(() => ACT.pickTradeCar(), 250); }
    else if (key === 'tradeCash' || key === 'tradeValue') c.trade[key === 'tradeCash' ? 'cash' : 'value'] = el.value.trim() ? parseNum(el.value) : null;
    else if (key === 'tradeLink') { if (!el.value) return; const b = carById(el.value); if (!b) return; await linkTrade(c, b, c.trade.value ?? (b.buyPrice != null && b.buyPrice !== '' ? +b.buyPrice : null), c.trade.cash); return vCar(c.id); }
    const kk = carCalc(c);
    c.sellPrice = c.trade.on ? (kk.sold ? kk.sellVal : null) : c.sellPrice;
    if (c.trade.on && kk.sold && c.status !== 'vendido') { c.status = 'vendido'; if (!c.sellDate) c.sellDate = todayISO(); toast('Marcado como vendido'); }
    syncTrade(c); await saveCar(c); return vCar(c.id);
  }
  if (el.dataset.car) {
    const key = el.dataset.car; let v = el.value;
    if (['buyPrice', 'sellPrice', 'askPrice', 'minPrice'].includes(key)) v = v.trim() ? parseNum(v) : null;
    if (key === 'plate') v = fmtPlate(v);
    c[key] = v;
    if (key === 'sellPrice' && v != null && c.status !== 'vendido') { c.status = 'vendido'; if (!c.sellDate) c.sellDate = todayISO(); toast('Marcado como vendido'); }
    if (key === 'status' && v === 'vendido' && !c.sellDate) c.sellDate = todayISO();
    if (key === 'sellDate' || key === 'sellTo') syncTrade(c);
    await saveCar(c); S.docs.forEach(indexDoc);
    if (['notes', 'buyFrom', 'sellTo', 'color', 'vin', 'version'].includes(key)) toast('Guardado'); else vCar(c.id);
  } else if (el.dataset.exp) {
    const e = c.expenses[+el.dataset.i]; if (!e) return; const key = el.dataset.exp;
    e[key] = key === 'amount' ? parseNum(el.value) : el.value;
    await saveCar(c); if (key === 'amount') vCar(c.id);
  }
}
function carPrompt(d, car) {
  if (!car || d.amount == null || d.carAsked) return '';
  const cat = carCat(d, car), p = esc(fmtPlate(car.plate)), a = eur0(d.amount);
  if (cat === 'compra') return car.status !== 'pessoal' && (car.buyPrice == null || car.buyPrice === '') ? `<div class="review"><p>🚗 Usar <b>${a}</b> como <b>valor de compra</b> do ${p}?</p><div class="chips"><button class="chip on" data-act="carUse" data-k="buy">Sim</button><button class="chip" data-act="carNo">Não</button></div></div>` : '';
  if (cat === 'venda') return car.status !== 'pessoal' && (car.sellPrice == null || car.sellPrice === '') ? `<div class="review"><p>🚗 Usar <b>${a}</b> como <b>valor de venda</b> do ${p}?</p><div class="chips"><button class="chip on" data-act="carUse" data-k="sell">Sim</button><button class="chip" data-act="carNo">Não</button></div></div>` : '';
  if ((car.expenses || []).some(e => e.docId === d.id)) return '';
  return `<div class="review"><p>🚗 Adicionar <b>${a}</b> às despesas do ${p}?</p><div class="chips"><button class="chip on" data-act="carUse" data-k="exp">Adicionar</button><button class="chip" data-act="carNo">Não</button></div></div>`;
}
function csvCell(v) { v = v == null ? '' : typeof v === 'number' ? (Number.isInteger(v) && Math.abs(v) < 100000 && false ? String(v) : String(v.toFixed(2)).replace('.', ',')) : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function csvBlob(rows) { return new Blob(['﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv' }); }
Object.assign(ACT, {
  carFlt: el => { S.carFilter = el.dataset.f; vGarage(); },
  carYear: el => { S.carYear = +el.dataset.y; vGarage(); },
  carTab: el => { S.carTab = el.dataset.t; vCar(curCar().id); },
  carDua: () => pickCarImage('dua'),
  carTapPlate: async () => { const dr = carDraftFields(); const p = await tapPlate(dr.photoOrig); if (p) { dr.f.plate = p; toast(`Li ${p} — confirma`); vCarNew(); } },
  carPic: () => pickCarImage('pic'),
  carPhotoNew: () => pickCarImage('photo'),
  carDuaRead: () => pickCarImage('dua-car'),
  carPhotoAct: () => { const c = curCar(); if (c && !c.photo) return pickCarImage('photo'); const im = $('img[data-cphoto]'); if (im?.src) { $('#vImg').src = im.src; $('#viewer').hidden = false; } },
  carSave: () => createCar(),
  carCancel: () => { S.carDraft = null; history.back(); },
  carAddDoc: () => { pickFor = null; S.pendingCar = curCar().id; addSheet(); },
  gpPick: el => { const cb = gpCb; gpCb = null; closeSheet(); cb && cb(carById(el.dataset.id)); },
  pickTradeCar: () => {
    const a = curCar();
    garagePicker('Qual foi o carro que recebeste em retoma?', tradeEligibleB(a), async b => { await linkTrade(a, b, a.trade?.value ?? (b.buyPrice != null && b.buyPrice !== '' ? +b.buyPrice : null), a.trade?.cash ?? null); toast(`Retoma: ${fmtPlate(b.plate)}`); vCar(a.id); },
      `<button class="it b" data-act="tradeNew">＋ Ainda não está na garagem — criar agora</button>`);
  },
  pickFromLink: () => {
    const b = curCar();
    garagePicker('Este carro foi retoma de qual venda?', tradeEligible(b), async a => {
      if (b.buyPrice == null || b.buyPrice === '') { const v = prompt(`Avaliação da retoma (o que pagaste por este carro na troca com o ${fmtPlate(a.plate)}), em €:`); if (v == null || !v.trim()) return; b.buyPrice = parseNum(v); }
      await linkTrade(a, b, +b.buyPrice, null); await saveCar(b); toast(`Ligado como retoma do ${fmtPlate(a.plate)}`); vCar(b.id);
    });
  },
  pickOrigin: () => {
    const dr = carDraftFields();
    garagePicker('Este carro novo foi retoma de qual venda?', tradeEligible(null), a => {
      dr.f.origin = a.id; if (a.trade?.cash != null && !dr.f.tradeCash) dr.f.tradeCash = String(a.trade.cash).replace('.', ','); if (a.sellDate) dr.f.buyDate = a.sellDate; vCarNew();
    }, carDraftFields().f.origin ? `<button class="it" data-act="originNone">Não, foi uma compra normal</button>` : '');
  },
  originNone: () => { closeSheet(); const dr = carDraftFields(); delete dr.f.origin; vCarNew(); },
  tradeNew: async () => {
    closeSheet(); const a = curCar(); a.trade ||= { on: true };
    const b = { id: uid(), created: Date.now(), expenses: [], status: 'stock', plate: '', brand: '', model: '', fromTrade: a.id, buyPrice: a.trade.value ?? null, buyDate: a.sellDate || todayISO(), buyFrom: a.sellTo || '' };
    S.cars.push(b); a.trade.carId = b.id; syncTrade(a); await saveCar(a);
    S.carTab = 'dados'; go('#/car/' + b.id); toast('Carro da retoma criado — fotografa o DUA para preencher os dados');
  },
  carDel: async () => { const c = curCar(); if (!confirm(`Apagar o carro ${fmtPlate(c.plate)}? Os documentos ficam no arquivo.`)) return;
    for (const x of S.cars) { if (x.trade && x.trade.carId === c.id) x.trade.carId = null; if (x.fromTrade === c.id) { x.buyPrice = carCalc(x).buy; delete x.fromTrade; } } if (c.photo) await dbDel('pages', c.photo); for (const d of S.docs) if (d.carId === c.id) { delete d.carId; await saveDoc(d); } S.cars = S.cars.filter(x => x !== c); await saveCars(); history.replaceState(null, '', '#/f/carros'); render(); },
  expAdd: async () => { const c = curCar(); (c.expenses ||= []).push({ id: uid(), date: todayISO(), desc: '', cat: 'Peças', amount: null }); await saveCar(c); vCar(c.id); setTimeout(() => { const l = [...document.querySelectorAll('.exp .ed')].pop(); l && l.focus(); }, 50); },
  expDel: async el => { const c = curCar(); const e = c.expenses[+el.dataset.i]; if ((e.desc || e.amount) && !confirm('Apagar esta despesa?')) return; c.expenses.splice(+el.dataset.i, 1); await saveCar(c); vCar(c.id); },
  carUse: async el => {
    const d = curDoc(), car = carOfDoc(d); if (!car) return;
    if (el.dataset.k === 'buy') { car.buyPrice = d.amount; if (!car.buyDate && d.date) car.buyDate = d.date; }
    else if (el.dataset.k === 'sell') { car.sellPrice = d.amount; car.status = 'vendido'; if (!car.sellDate) car.sellDate = d.date || todayISO(); }
    else (car.expenses ||= []).push({ id: uid(), date: d.date || todayISO(), desc: [d.type, d.entity].filter(Boolean).join(' ') || d.title, cat: CAT2EXP[carCat(d, car)] || 'Outros', amount: d.amount, docId: d.id });
    d.carAsked = true; await saveCar(car); await saveDoc(d); toast(`Guardado no ${fmtPlate(car.plate)}`); vDoc(d.id);
  },
  carNo: async () => { const d = curDoc(); d.carAsked = true; await saveDoc(d); vDoc(d.id); },
  carCsv: () => {
    const c = curCar(), k = carCalc(c);
    const rows = [['Carro', fmtPlate(c.plate), carName(c)], [], ['Data', 'Descrição', 'Categoria', 'Valor (€)'], [c.buyDate || '', (k.src ? 'Retoma do ' + fmtPlate(k.src.plate) : 'Compra') + (c.buyFrom ? ' a ' + c.buyFrom : ''), 'Compra', k.buy]];
    for (const e of c.expenses || []) rows.push([e.date || '', e.desc || '', e.cat || '', +e.amount || 0]);
    rows.push([], ['', 'Custo total', '', k.cost]);
    if (k.sold && k.tr) rows.push([c.sellDate || '', 'Dinheiro recebido' + (c.sellTo ? ' de ' + c.sellTo : ''), 'Venda', k.cashIn], [c.sellDate || '', 'Retoma: ' + (k.tCar ? fmtPlate(k.tCar.plate) + ' ' + carName(k.tCar) : 'carro'), 'Venda', k.tVal]);
    if (k.sold) rows.push([c.sellDate || '', 'Venda total' + (c.sellTo ? ' a ' + c.sellTo : ''), 'Venda', k.sellVal], ['', k.pending ? 'Lucro (provisório até vender a retoma)' : 'Lucro', '', k.profit], ['', 'Dias em stock', '', k.days != null ? String(k.days) : '']);
    offerFile(csvBlob(rows), `Contas ${fmtPlate(c.plate)} ${carName(c)}.csv`, 'Contas do carro (abre no Excel ou Numbers)');
  },
  garCsv: () => {
    const rows = [['Matrícula', 'Marca', 'Modelo', 'Estado', 'Origem', 'Data compra', 'Compra (€)', 'Despesas (€)', 'Custo total (€)', 'Data venda', 'Dinheiro recebido (€)', 'Retoma (€)', 'Carro da retoma', 'Venda total (€)', 'Lucro (€)', 'Por realizar (€)', 'Dias em stock']];
    for (const c of S.cars) { const k = carCalc(c); rows.push([fmtPlate(c.plate), c.brand || '', c.model || '', (STATUS[c.status] || STATUS.stock)[0], k.src ? 'Retoma do ' + fmtPlate(k.src.plate) : 'Compra', c.buyDate || '', k.buy, k.exp, k.cost, c.sellDate || '', k.sold ? k.cashIn : '', k.tr ? k.tVal : '', k.tCar ? fmtPlate(k.tCar.plate) : '', k.sold ? k.sellVal : '', k.sold ? k.profit : '', k.pending || '', k.days != null ? String(k.days) : '']); }
    offerFile(csvBlob(rows), `Carros ${todayISO()}.csv`, 'Tabela de todos os carros (abre no Excel ou Numbers)');
  },
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
  if (p < 0) throw new Error('O ficheiro não é um .zip válido.');
  const n = tail.getUint16(p + 10, true), cs = tail.getUint32(p + 12, true), co = tail.getUint32(p + 16, true);
  const cd = new DataView(await file.slice(co, co + cs).arrayBuffer()); const dec = new TextDecoder(); const ent = {}; let q = 0;
  for (let k = 0; k < n; k++) {
    const nl = cd.getUint16(q + 28, true), el = cd.getUint16(q + 30, true), cl = cd.getUint16(q + 32, true);
    ent[dec.decode(new Uint8Array(cd.buffer, q + 46, nl))] = { method: cd.getUint16(q + 10, true), size: cd.getUint32(q + 20, true), lo: cd.getUint32(q + 42, true) };
    q += 46 + nl + el + cl;
  }
  return {
    names: Object.keys(ent),
    has: nm => !!ent[nm],
    async blob(nm, type) {
      const e = ent[nm]; if (!e) return null;
      const h = new DataView(await file.slice(e.lo, e.lo + 30).arrayBuffer()); const s = e.lo + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const raw = file.slice(s, s + e.size);
      if (e.method === 0) return type ? new Blob([raw], { type }) : raw;
      if (e.method === 8 && window.DecompressionStream) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      throw new Error('Formato de compressão não suportado.');
    },
  };
}
async function buildBackup(docs, full, onp) {
  const files = [], meta = { app: 'arquivo', version: 3, cars: S.cars.map(c => ({ ...c })), partial: !full, exported: new Date().toISOString(), folders: S.folders, rules: S.rules, set: { ignoreNifs: S.set.ignoreNifs }, docs: [] };
  const used = new Set();
  for (const d of sortDocs([...docs])) {
    const fo = folderById(d.folder), par = fo && fo.parent ? folderById(fo.parent) : null;
    const dir = 'documentos/' + [par ? par.name : null, fo ? fo.name : 'Outros'].filter(Boolean).map(safeName).join('/') + '/' + safeName(`${d.date || ''} ${d.title}`);
    let dd = dir, k = 2; while (used.has(dd)) dd = dir + ' (' + k++ + ')'; used.add(dd);
    const pages = [], fl = [], names = new Set();
    for (let i = 0; i < d.pages.length; i++) { const p = await dbGet('pages', d.pages[i]); if (!p) continue; const path = `${dd}/pagina-${i + 1}.jpg`; files.push({ name: path, data: p.blob }); pages.push({ id: p.id, path }); }
    for (const f of d.files || []) {
      const r = await dbGet('files', f.id); if (!r) continue;
      let nm = safeName(f.name), c = 2; while (names.has(nm)) nm = c++ + '-' + safeName(f.name); names.add(nm);
      files.push({ name: `${dd}/${nm}`, data: r.blob }); fl.push({ ...f, path: `${dd}/${nm}` });
    }
    if (d.text) files.push({ name: `${dd}/texto.txt`, data: d.text });
    meta.docs.push({ ...clean(d), pages, files: fl });
  }
  for (const c of meta.cars) {
    if (!c.photo || (!full && (c.updated || c.created || 0) <= (S.set.lastBackup || 0))) continue;
    const ph = await dbGet('pages', c.photo); if (!ph) continue;
    c.photoPath = `carros/${safeName(fmtPlate(c.plate) || c.id)} ${safeName(carName(c))}/foto.jpg`; files.push({ name: c.photoPath, data: ph.blob });
  }
  files.unshift({ name: 'arquivo.json', data: JSON.stringify(meta) });
  return makeZip(files, onp);
}
async function markBackup(full) { S.set.lastBackup = Date.now(); if (full) S.set.lastFull = Date.now(); S.set.bkSnooze = 0; await dbPut('kv', S.set, 'set'); if (location.hash === '#/s') vSettings(); }
async function exportBackup() {
  if (!S.docs.length) return toast('Ainda não há documentos');
  busy(true, 'A preparar a cópia…', 0);
  try {
    const zip = await buildBackup(S.docs, true, p => busy(true, 'A preparar a cópia…', p));
    busy(false);
    offerFile(zip, `Arquivo-copia-completa-${todayISO()}.zip`, `Cópia pronta: ${S.docs.length} documentos, ${fmtSize(zip.size)}. Escolhe «Guardar em Ficheiros».`, () => markBackup(true));
  } catch (e) { busy(false); alert('Erro na cópia: ' + e.message); }
}
let bkChecked = 0;
async function maybeAutoBackup() {
  if (Date.now() - bkChecked < 12 * 3600e3 || L.locked || (S.set.bkFreq || '7') === 'off' || !S.docs.length) return;
  if (!['', '#', '#/'].includes(location.hash) || S.draft || !$('#busy').hidden || !$('#sheetWrap').hidden) return;
  const last = S.set.lastBackup || 0;
  if (Date.now() - last < (+S.set.bkFreq || 7) * 864e5 || Date.now() < (S.set.bkSnooze || 0)) return;
  const changed = S.docs.filter(d => (d.updated || d.created) > last);
  const carsChanged = S.cars.some(c => (c.updated || c.created) > last);
  if (last && !changed.length && !carsChanged) return;
  bkChecked = Date.now();
  const full = !S.set.lastFull || Date.now() - S.set.lastFull > 30 * 864e5;
  const lbl = 'A preparar a cópia de segurança automática…';
  busy(true, lbl, 0);
  try {
    const zip = await buildBackup(full ? S.docs : changed, full, p => busy(true, lbl, p));
    busy(false);
    shareItem = { blob: zip, name: `Arquivo-${full ? 'copia-completa' : 'copia-novos'}-${todayISO()}.zip`, onDone: () => markBackup(full) };
    sheet(`<div class="grp"><p><b>💾 Cópia de segurança automática</b><br>${full ? `Cópia completa: ${S.docs.length} documentos` : `${changed.length} documento${changed.length === 1 ? '' : 's'} novo${changed.length === 1 ? '' : 's'} ou alterado${changed.length === 1 ? '' : 's'}`} · ${fmtSize(zip.size)}<br>Toca em «Guardar» e escolhe «Guardar em Ficheiros».</p><button class="it b" data-act="doShare">Guardar</button></div><div class="grp"><button class="it" data-act="bkLater">Lembrar amanhã</button></div>`);
  } catch (e) { busy(false); console.error(e); }
}
async function importBackup(file) {
  busy(true, 'A ler a cópia…', 0);
  try {
    const z = await readZip(file); if (!z.has('arquivo.json')) throw new Error('Este .zip não é uma cópia do Arquivo.');
    const meta = JSON.parse(await (await z.blob('arquivo.json')).text());
    for (const f of meta.folders || []) if (!folderById(f.id)) S.folders.push(f);
    for (const c of meta.cars || []) {
      const ex = carById(c.id); if (ex && (ex.updated || ex.created || 0) >= (c.updated || c.created || 0)) continue;
      const { photoPath, ...car } = c;
      if (photoPath) { const b = await z.blob(photoPath); if (b) await dbPut('pages', { id: car.photo, docId: 'car:' + car.id, blob: new Blob([await b.arrayBuffer()], { type: 'image/jpeg' }) }); }
      if (ex) S.cars[S.cars.indexOf(ex)] = car; else S.cars.push(car);
    }
    await saveCars();
    S.rules = { ...meta.rules, ...S.rules };
    if (!S.set.ignoreNifs && meta.set?.ignoreNifs) S.set.ignoreNifs = meta.set.ignoreNifs;
    let added = 0, updated = 0, skipped = 0;
    for (let i = 0; i < meta.docs.length; i++) {
      busy(true, 'A importar…', i / meta.docs.length);
      const m = meta.docs[i]; const ex = docById(m.id);
      if (ex && (ex.updated || ex.created || 0) >= (m.updated || m.created || 0)) { skipped++; continue; }
      if (ex) { for (const pid of ex.pages) { await dbDel('pages', pid); dropURL(pid); } for (const f of ex.files || []) await dbDel('files', f.id); S.docs = S.docs.filter(x => x !== ex); }
      const ids = [], fl = [];
      for (const p of m.pages || []) { const b = await z.blob(p.path); if (!b) continue; await dbPut('pages', { id: p.id, docId: m.id, blob: new Blob([await b.arrayBuffer()], { type: 'image/jpeg' }) }); ids.push(p.id); }
      for (const f of m.files || []) { const b = await z.blob(f.path); if (!b) continue; await dbPut('files', { id: f.id, docId: m.id, name: f.name, type: f.type, blob: new Blob([await b.arrayBuffer()], { type: f.type || mimeOf(f.name) }) }); const { path, ...rest } = f; fl.push(rest); }
      const d = { ...m, pages: ids, files: fl }; S.docs.push(indexDoc(d)); await dbPut('docs', clean(d));
      ex ? updated++ : added++;
    }
    await saveFolders(); await dbPut('kv', S.rules, 'rules'); await dbPut('kv', S.set, 'set');
    busy(false); alert(`Cópia importada: ${added} documentos novos${updated ? `, ${updated} atualizados` : ''}${skipped ? `, ${skipped} já estavam iguais` : ''}.`); render();
  } catch (e) { busy(false); alert('Erro ao importar: ' + e.message); }
}

/* ---------------- Arranque ---------------- */
(async function init() {
  try { DB = await idbOpen(); } catch (e) { $('#view').innerHTML = `<div class="empty"><p>Este browser não deixa guardar dados (${esc(e.message)}). Sai do modo privado e tenta outra vez.</p></div>`; return; }
  S.folders = (await dbGet('kv', 'folders')) || DEFAULT_FOLDERS.map(f => ({ ...f, kw: [...f.kw] }));
  S.rules = (await dbGet('kv', 'rules')) || {};
  { const fs = S.folders.find(f => f.id === 'fin-seguros'); if (fs && fs.kw.includes('!apolice')) { fs.kw = fs.kw.map(k => k === '!apolice' ? 'apolice' : k); await saveFolders(); } }
  S.cars = (await dbGet('kv', 'cars')) || [];
  S.set = Object.assign(S.set, (await dbGet('kv', 'set')) || {});
  S.docs = ((await dbAll('docs')) || []).map(indexDoc);
  L.cfg = (await dbGet('kv', 'lock')) || null;
  if ((S.set.anaV || 1) < 2) { // nova versão da identificação: reavaliar os documentos ainda por confirmar
    for (const d of S.docs) if (d.review && d.text) {
      const a = analyze(d.text);
      Object.assign(d, { folder: a.folder, sugg: a.sugg, type: a.type, entity: a.entity || d.entity, amount: a.amount ?? d.amount, due: a.due || '', date: a.date || d.date });
      if (!d.files?.length || a.type || a.entity) d.title = a.title;
      await saveDoc(d);
    }
    S.set.anaV = 2; await dbPut('kv', S.set, 'set');
  }
  if (L.cfg) lockNow();
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => { });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!had) return; if (!S.draft && $('#busy').hidden) location.reload(); else toast('Há uma versão nova — fecha e volta a abrir a app'); });
  }
})();
