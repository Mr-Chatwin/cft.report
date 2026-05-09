#!/usr/bin/env node
// update-data.mjs — 独立 CFTC 报告生成脚本（GitHub Action / 本地运行）
// 无需 Next.js 依赖，纯 Node.js

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');

// ─── 配置 ───
const CFTC_TFF_URL = 'https://publicreporting.cftc.gov/resource/gpe5-46if.json';
const CFTC_DISAGG_URL = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json';
const LOOKBACK_DAYS = 1200;
const ZSCORE_WINDOW = 156;

const TFF_CONTRACTS = [
  { name: '标普500',       cftc: 'E-MINI S&P 500 -',   section: '股指', yf: '^GSPC' },
  { name: '纳斯达克100',   cftc: 'NASDAQ MINI',          section: '股指', yf: '^NDX' },
  { name: '罗素2000',      cftc: 'RUSSELL E-MINI',       section: '股指', yf: '^RUT' },
  { name: 'MSCI新兴市场',  cftc: 'MSCI EM INDEX',        section: '股指', yf: 'EEM' },
  { name: 'MSCI发达市场',  cftc: 'MSCI EAFE',            section: '股指', yf: 'EFA' },
  { name: '日经225',       cftc: 'NIKKEI STOCK AVERAGE', section: '股指', yf: '^N225' },
  { name: '2年期美债',    cftc: 'UST 2Y NOTE',    section: '债券', yf: 'ZT=F' },
  { name: '10年期美债',   cftc: 'UST 10Y NOTE',   section: '债券', yf: 'ZN=F' },
  { name: '超长期美债',   cftc: 'ULTRA UST BOND', section: '债券', yf: 'UB=F' },
  { name: '联邦基金',     cftc: 'FED FUNDS',      section: '利率', yf: 'ZQ=F' },
  { name: '欧元/美元',    cftc: 'EURO FX - CHICAGO',            section: '外汇/加密', yf: 'EURUSD=X' },
  { name: '英镑/美元',    cftc: 'BRITISH POUND',                section: '外汇/加密', yf: 'GBPUSD=X' },
  { name: '日元/美元',    cftc: 'JAPANESE YEN',                 section: '外汇/加密', yf: 'JPYUSD=X' },
  { name: '澳元/美元',    cftc: 'AUSTRALIAN DOLLAR',            section: '外汇/加密', yf: 'AUDUSD=X' },
  { name: '比特币',       cftc: 'BITCOIN - CHICAGO MERCANTILE', section: '外汇/加密', yf: 'BTC-USD' },
];

const DISAGG_CONTRACTS = [
  { name: 'WTI原油',  cftc: 'WTI-PHYSICAL',       section: '能源',   yf: 'CL=F' },
  { name: '天然气',    cftc: 'NAT GAS NYME',       section: '能源',   yf: 'NG=F' },
  { name: '铜',        cftc: 'COPPER- #1',         section: '金属',   yf: 'HG=F' },
  { name: '黄金',      cftc: 'GOLD - COMMODITY',   section: '金属',   yf: 'GC=F' },
  { name: '白银',      cftc: 'SILVER - COMMODITY', section: '金属',   yf: 'SI=F' },
  { name: '玉米',      cftc: 'CORN - CHICAGO',     section: '农产品', yf: 'ZC=F' },
];

// ─── 工具函数 ───
function getPreviousTuesday(refDate) {
  const d = new Date(refDate);
  const day = d.getDay();
  const diff = day === 2 ? 0 : day > 2 ? day - 2 : 7 - (2 - day);
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function zScore(val, arr) {
  const n = arr.length;
  if (n < 2) return null;
  const mean = arr.reduce((s, v) => s + v, 0) / n;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  if (std === 0) return 0;
  return (val - mean) / std;
}

// ─── 数据抓取 ───
async function fetchCftc(endpoint, startDate) {
  const isTff = endpoint.includes('gpe5-46if');
  const longPos = isTff ? 'lev_money_positions_long' : 'm_money_positions_long_all';
  const shortPos = isTff ? 'lev_money_positions_short' : 'm_money_positions_short_all';

  const params = new URLSearchParams({
    '$select': ['market_and_exchange_names', 'report_date_as_yyyy_mm_dd',
      'cftc_contract_market_code', 'open_interest_all', longPos, shortPos].join(','),
    '$where': `report_date_as_yyyy_mm_dd >= '${startDate}'`,
    '$limit': '50000',
    '$order': 'report_date_as_yyyy_mm_dd ASC',
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`${endpoint}?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return data.map(row => ({
        market_and_exchange_names: row.market_and_exchange_names,
        report_date_as_yyyy_mm_dd: row.report_date_as_yyyy_mm_dd,
        report_date: row.report_date_as_yyyy_mm_dd,
        cftc_contract_market_code: row.cftc_contract_market_code,
        open_interest_all: Number(row.open_interest_all) || 0,
        long_pos: Number(row[longPos]) || 0,
        short_pos: Number(row[shortPos]) || 0,
      }));
    } catch (e) {
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
      else throw e;
    }
  }
}

function matchCftc(rows, searchPattern) {
  const patternUpper = searchPattern.toUpperCase();
  let matched = rows.filter(r => r.market_and_exchange_names.toUpperCase() === patternUpper);
  if (!matched.length) {
    matched = rows.filter(r => r.market_and_exchange_names.toUpperCase().startsWith(patternUpper));
  }
  if (!matched.length) {
    matched = rows.filter(r => r.market_and_exchange_names.toUpperCase().includes(patternUpper));
  }
  if (!matched.length) return null;
  return matched;
}

// ─── 价格数据 ───
async function fetchPrice(yfTicker, reportDate) {
  const today = new Date(reportDate + 'T00:00:00');
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 35);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?period1=${Math.floor(startDate.getTime() / 1000)}&period2=${Math.floor(today.getTime() / 1000)}&interval=1d`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFTCReport/1.0)' }
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const result = json.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const valid = timestamps.map((t, i) => ({ t: new Date(t * 1000), c: closes[i] })).filter(d => !isNaN(d.c) && d.t <= today);

    if (valid.length < 2) return null;

    // Find closest date to reportDate (Tuesday)
    let closest = valid.reduce((best, curr) =>
      Math.abs(curr.t.getTime() - today.getTime()) < Math.abs(best.t.getTime() - today.getTime()) ? curr : best
    );
    const pxEnd = closest.c;

    // Find date ~5 days before
    const refStart = new Date(today);
    refStart.setDate(refStart.getDate() - 5);
    let startPx = valid.reduce((best, curr) =>
      curr.t <= refStart && curr.c > 0 ? curr : best, valid[0]
    );
    const pxStart = startPx.c || pxEnd;

    const ret = pxStart > 0 ? ((pxEnd - pxStart) / pxStart) * 100 : 0;

    return {
      ret: Math.round(ret * 10) / 10,
      ticker: yfTicker,
      date_start: fmt(startPx.t || refStart),
      date_end: fmt(closest.t),
      px_start: Math.round(pxStart * 100) / 100,
      px_end: Math.round(pxEnd * 100) / 100,
    };
  } catch {
    return null;
  }
}

// ─── 构建报告 ───
async function buildRows(contracts, allRows, reportDateStr) {
  const result = [];
  for (const c of contracts) {
    const matched = matchCftc(allRows, c.cftc);
    if (!matched || matched.length < 2) continue;

    const grouped = new Map();
    for (const r of matched) {
      const d = r.report_date;
      if (!grouped.has(d)) grouped.set(d, { long: 0, short: 0, count: 0 });
      const g = grouped.get(d);
      g.long += r.long_pos;
      g.short += r.short_pos;
      g.count++;
    }

    const timeline = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (timeline.length < 2) continue;

    const nets = timeline.map(([, g]) => g.long - g.short);
    const longs = timeline.map(([, g]) => g.long);
    const shorts = timeline.map(([, g]) => g.short);

    const latest = timeline[timeline.length - 1];
    const prev = timeline[timeline.length - 2];

    const netCur = latest[1].long - latest[1].short;
    const netPrev = prev[1].long - prev[1].short;
    const longCur = latest[1].long;
    const longPrev = prev[1].long;
    const shortCur = latest[1].short;
    const shortPrev = prev[1].short;

    const net_z = nets.length >= ZSCORE_WINDOW ? zScore(netCur, nets.slice(-ZSCORE_WINDOW)) : null;
    const long_z = longs.length >= ZSCORE_WINDOW ? zScore(longCur, longs.slice(-ZSCORE_WINDOW)) : null;
    const short_z = shorts.length >= ZSCORE_WINDOW ? zScore(shortCur, shorts.slice(-ZSCORE_WINDOW)) : null;

    const net_ww = netCur - netPrev;
    const long_ww = longCur - longPrev;
    const short_ww = shortCur - shortPrev;

    // Flow state
    const flow_state = classifyFlow(long_ww, short_ww, long_z, short_z);

    result.push({
      instrument: c.name,
      section: c.section,
      net: netCur,
      net_z: net_z != null ? Math.round(net_z * 100) / 100 : null,
      net_ww,
      net_ww_z: net_ww !== 0 && nets.length >= ZSCORE_WINDOW
        ? Math.round(zScore(Math.abs(net_ww), nets.slice(-ZSCORE_WINDOW).map((_, i, a) => Math.abs(a[i] - (i > 0 ? a[i-1] : a[i]))).slice(-ZSCORE_WINDOW)) * 100) / 100
        : null,
      long: longCur,
      long_z: long_z != null ? Math.round(long_z * 100) / 100 : null,
      long_ww,
      long_ww_z: null,
      short: shortCur,
      short_z: short_z != null ? Math.round(short_z * 100) / 100 : null,
      short_ww,
      short_ww_z: null,
      flow_state,
      price_chg: null,
    });
  }

  // Fetch prices
  const priceData = {};
  for (const row of result) {
    const cfg = [...TFF_CONTRACTS, ...DISAGG_CONTRACTS].find(c => c.name === row.instrument);
    if (cfg) {
      const pi = await fetchPrice(cfg.yf, reportDateStr);
      if (pi) {
        row.price_chg = pi.ret;
        priceData[row.instrument] = pi;
      }
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  return { rows: result, priceData };
}

function classifyFlow(longWW, shortWW) {
  const lUp = longWW > 0;
  const sUp = shortWW > 0;
  if (lUp && !sUp) return '多头建仓';
  if (!lUp && sUp) return '空头建仓';
  if (!lUp && !sUp) return { longWW: '多头平仓', shortWW: '空头回补' }[longWW > shortWW ? 'shortWW' : 'longWW'] || '多空双减';
  // Both up
  if (Math.abs(longWW) > Math.abs(shortWW)) return '多头挤压';
  if (Math.abs(shortWW) > Math.abs(longWW)) return '空头施压';
  return '多空双增';
}

// ─── AI 分析 ───
async function generateAnalysis(data) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const apiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  if (!apiKey) {
    console.warn('⚠ DEEPSEEK_API_KEY not set, skipping AI analysis');
    return '';
  }

  function formatRows(rows, label) {
    let text = `\n### ${label}\n`;
    let lastSection = '';
    for (const r of rows) {
      if (r.section !== lastSection) { lastSection = r.section; text += `\n**${r.section}**\n`; }
      const priceStr = r.price_chg != null ? `${r.price_chg > 0 ? '+' : ''}${r.price_chg.toFixed(1)}%` : 'N/A';
      text += `- ${r.instrument}: 净持仓=${r.net.toLocaleString()} (z=${r.net_z ?? 'N/A'}), 多头=${r.long.toLocaleString()} (z=${r.long_z ?? 'N/A'}), 空头=${r.short.toLocaleString()} (z=${r.short_z ?? 'N/A'}), 动作=${r.flow_state || '无'}, 同期涨跌=${priceStr}\n`;
    }
    return text;
  }

  const prompt = `你是一位拥有20年从业经验的全球宏观策略首席分析师。分析风格：客观理性，语言干练，逻辑条理分明，每个观点有数据支撑。

请基于以下 CFTC 持仓报告（数据截止 ${data.report_date}）进行分析。

## 数据
${formatRows(data.tff_rows, '杠杆基金 Leveraged Funds (TFF)')}
${formatRows(data.disagg_rows, '管理资金 Managed Money (Disagg)')}

## 输出格式（中文，Markdown）
### 一、本周核心变化
### 二、美股市场
### 三、固收与利率
### 四、外汇市场
### 五、大宗商品
### 六、加密货币
### 七、跨市场主题研判
### 八、风险警示

每个部分保持精炼，重点突出数据异常和边际变化。`;

  try {
    console.log('🤖 调用 AI 分析...');
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, messages: [{ role: 'system', content: '你是全球宏观策略首席分析师，服务于顶级对冲基金。' }, { role: 'user', content: prompt }],
        max_tokens: 4000, temperature: 0.2,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`❌ AI 分析失败: ${resp.status} ${err}`);
      return '';
    }

    const json = await resp.json();
    return json.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('❌ AI 分析错误:', e.message);
    return '';
  }
}

// ─── Telegram 通知 ───
async function sendTelegram(data) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const threadId = process.env.TELEGRAM_THREAD_ID;
  if (!botToken || !chatId) return;

  const baseUrl = process.env.PAGES_BASE_URL || `https://${process.env.GITHUB_REPOSITORY_OWNER || 'Mr-Chatwin'}.github.io/cft.report/`;
  const reportUrl = `${baseUrl}?date=${data.report_date}`;

  let summary = 'AI 分析生成中，请先查看数据面板。';
  if (data.ai_analysis) {
    const match = data.ai_analysis.match(/### 一、本周核心变化\n([\s\S]*?)(?=###|$)/i);
    if (match) {
      summary = match[1].trim().replace(/\*\*(.*?)\*\*/g, '$1').substring(0, 247);
      if (summary.length >= 247) summary += '...';
    }
  }

  const message = `\n<b>📊 CFTC 持仓周报已生成</b>\n📅 <b>数据日期:</b> ${data.report_date}\n🔗 <b>完整面板:</b> <a href="${reportUrl}">点击查看</a>\n\n<b>📌 核心变化:</b>\n${summary}\n`;

  try {
    const payload = { chat_id: chatId, text: message.trim(), parse_mode: 'HTML', disable_web_page_preview: false };
    if (threadId) payload.message_thread_id = parseInt(threadId, 10);
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error('❌ Telegram 推送失败:', await resp.text());
    } else {
      console.log('✅ Telegram 推送成功');
    }
  } catch (e) {
    console.error('❌ Telegram 推送错误:', e.message);
  }
}

// ─── 主流程 ───
async function main() {
  const today = new Date();
  const reportDate = getPreviousTuesday(today);
  const reportDateStr = fmt(reportDate);
  console.log(`📅 报告日期: ${reportDateStr}`);

  const startDate = fmt(new Date(reportDate.getTime() - LOOKBACK_DAYS * 86400000));
  console.log(`📥 抓取 CFTC 数据 (从 ${startDate} 开始)...`);

  const [tffRaw, disaggRaw] = await Promise.all([
    fetchCftc(CFTC_TFF_URL, startDate),
    fetchCftc(CFTC_DISAGG_URL, startDate),
  ]);
  console.log(`  TFF: ${tffRaw.length} 行 | Disagg: ${disaggRaw.length} 行`);

  console.log('📊 构建 TFF 持仓表...');
  const tffResult = await buildRows(TFF_CONTRACTS, tffRaw, reportDateStr);
  console.log(`  ${tffResult.rows.length} 个品种`);

  console.log('📊 构建 Disagg 持仓表...');
  const disaggResult = await buildRows(DISAGG_CONTRACTS, disaggRaw, reportDateStr);
  console.log(`  ${disaggResult.rows.length} 个品种`);

  // Check if report already exists
  const existingPath = join(DATA_DIR, `${reportDateStr}.json`);
  if (existsSync(existingPath)) {
    console.log(`⚠ 报告 ${reportDateStr} 已存在，跳过数据生成`);
    return;
  }

  const reportData = {
    report_date: reportDateStr,
    generated_at: new Date().toISOString(),
    tff_rows: tffResult.rows,
    disagg_rows: disaggResult.rows,
    price_data: { ...tffResult.priceData, ...disaggResult.priceData },
  };

  // AI analysis
  reportData.ai_analysis = await generateAnalysis(reportData);

  // Save report
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(existingPath, JSON.stringify(reportData, null, 2), 'utf-8');
  console.log(`💾 报告已保存: ${existingPath}`);

  // Update index
  const indexPath = join(DATA_DIR, 'index.json');
  let index = { dates: [] };
  if (existsSync(indexPath)) index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  if (!index.dates.includes(reportDateStr)) {
    index.dates.push(reportDateStr);
    index.dates.sort();
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
    console.log('📋 index.json 已更新');
  }

  // Telegram notification
  await sendTelegram(reportData);

  console.log('✅ 报告生成完成');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
