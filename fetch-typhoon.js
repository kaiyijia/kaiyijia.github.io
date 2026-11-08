// fetch-typhoon.js — 抓取浙江省台风路径实时发布系统（https://typhoon.slt.zj.gov.cn）数据
// 输出: data/typhoon.json（供页面展示）；抓取失败时保留旧数据并标记 stale
// 运行: node fetch-typhoon.js   （Node 18+，使用内置 fetch）
const fs = require('fs');
const path = require('path');

const BASE = 'https://typhoon.slt.zj.gov.cn/Api';
const OUT = path.join(__dirname, 'data', 'typhoon.json');

function parseRadii(s) {
  if (!s) return null;
  const parts = String(s).split('|').map(Number).filter(n => !isNaN(n));
  if (!parts.length) return null;
  return { max: Math.max(...parts), quadrants: parts };
}

function normalize(info) {
  const raw = info.points || [];
  const points = raw.map(p => ({
    time: p.time, lng: Number(p.lng), lat: Number(p.lat),
    strong: p.strong, power: Number(p.power), speed: Number(p.speed), pressure: Number(p.pressure),
    movespeed: Number(p.movespeed), movedirection: p.movedirection,
    radius7: parseRadii(p.radius7), radius10: parseRadii(p.radius10), radius12: parseRadii(p.radius12)
  }));
  // 预报路径：取最新一个实况点携带的「中国」预报
  const lastRaw = raw[raw.length - 1] || null;
  let forecast = [];
  if (lastRaw && Array.isArray(lastRaw.forecast)) {
    const cn = lastRaw.forecast.find(f => f.tm === '中国') || lastRaw.forecast[0] || null;
    if (cn && Array.isArray(cn.forecastpoints)) {
      forecast = cn.forecastpoints.map(fp => ({
        time: fp.time, lng: Number(fp.lng), lat: Number(fp.lat),
        strong: fp.strong, power: Number(fp.power), speed: Number(fp.speed), pressure: Number(fp.pressure)
      }));
    }
  }
  return {
    tfid: info.tfid, name: info.name, enname: info.enname, warnlevel: info.warnlevel,
    starttime: info.starttime, endtime: info.endtime, isactive: info.isactive,
    center: { lng: Number(info.centerlng), lat: Number(info.centerlat) },
    points, forecast
  };
}

async function main() {
  const year = new Date().getFullYear();
  const list = await (await fetch(`${BASE}/TyphoonList/${year}`)).json();
  const active = (list || []).filter(t => t.isactive === '1');
  const targets = active.length ? active : ((list || []).slice(-1)); // 无活跃台风时兜底取最近一个
  const typhoons = [];
  for (const t of targets) {
    try {
      const info = await (await fetch(`${BASE}/TyphoonInfo/${t.tfid}`)).json();
      typhoons.push(normalize(info));
    } catch (e) {
      console.error(`TyphoonInfo ${t.tfid} 抓取失败:`, e.message);
    }
  }
  const out = {
    fetchedAt: new Date().toISOString(),
    source: '浙江省台风路径实时发布系统（浙江省水利厅）',
    sourceUrl: 'https://typhoon.slt.zj.gov.cn',
    activeCount: active.length,
    typhoons
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('OK ->', OUT, '| 台风:', typhoons.map(x => `${x.name}(${x.tfid})`).join(', ') || '无');
}

main().catch(e => {
  // 失败兜底：保留旧数据并标记 stale
  console.error('FETCH FAILED:', e.message);
  if (fs.existsSync(OUT)) {
    try {
      const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
      old.stale = true; old.staleAt = new Date().toISOString(); old.error = e.message;
      fs.writeFileSync(OUT, JSON.stringify(old, null, 2));
      console.log('已保留旧数据并标记 stale:', OUT);
    } catch (_) { /* 旧数据损坏则忽略 */ }
  }
  process.exit(1);
});
