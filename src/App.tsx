import { useState, useEffect, useRef } from 'react'

declare global {
  interface Window {
    adsbygoogle: any[];
  }
}

const AdSenseWidget = () => {
    useEffect(() => {
        try { if (window.adsbygoogle) { window.adsbygoogle.push({}); } } catch (e) { console.error("AdSense Error:", e); }
    }, []);
    return (
        <div 
            className="mt-4 flex justify-center w-full min-h-[50px] overflow-hidden rounded-xl bg-slate-50/50"
            dangerouslySetInnerHTML={{ __html: '<ins class="adsbygoogle" style="display:inline-block;width:320px;height:50px" data-ad-client="ca-pub-4602831549339313" data-ad-slot="請在此填入廣告單元ID"></ins>' }}
        />
    );
};

const Icon = ({ name, size = 24, className = "" }) => {
    const paths = {
        'dices': <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
        'camera': <><rect x="3" y="4" width="18" height="15" rx="2" /><circle cx="12" cy="11.5" r="3.5" /></>,
        'hand': <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v10l-4-4-2 2 6 6h6a2 2 0 0 0 2-2v-5z" />,
        'trophy': <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-2.34c3.37-.4 6-3.24 6-6.66V4H4v4c0 3.42 2.63 6.26 6 6.66z" />,
        'settings': <circle cx="12" cy="12" r="3" />,
        'rotate-ccw': <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />,
        'trash': <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
        'grid': <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>,
        'sparkles': <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>,
        'users': <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M16 3.13a4 4 0 0 1 0 7.75M23 21v-2a4 4 0 0 0-3-3.87M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
        'edit': <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>,
        'check': <path d="M20 6L9 17l-5-5"/>,
        'fullscreen-enter': <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>,
        'fullscreen-exit': <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>{paths[name] || <circle cx="12" cy="12" r="10" />}</svg>;
};

const DiceFace = ({ value, isRolling }) => {
    const dotPositions = {
        1: [{ x: 50, y: 50, r: 22, color: '#e11d48' }],
        2: [{ x: 25, y: 25, r: 8, color: '#1e293b' }, { x: 75, y: 75, r: 8, color: '#1e293b' }],
        3: [{ x: 20, y: 20, r: 8, color: '#1e293b' }, { x: 50, y: 50, r: 8, color: '#1e293b' }, { x: 80, y: 80, r: 8, color: '#1e293b' }],
        4: [{ x: 25, y: 25, r: 8, color: '#e11d48' }, { x: 75, y: 25, r: 8, color: '#e11d48' }, { x: 25, y: 75, r: 8, color: '#e11d48' }, { x: 75, y: 75, r: 8, color: '#e11d48' }],
        5: [{ x: 25, y: 25, r: 8, color: '#e11d48' }, { x: 75, y: 25, r: 8, color: '#e11d48' }, { x: 50, y: 50, r: 8, color: '#e11d48' }, { x: 25, y: 75, r: 8, color: '#e11d48' }, { x: 75, y: 75, r: 8, color: '#e11d48' }],
        6: [{ x: 25, y: 20, r: 8, color: '#1e293b' }, { x: 75, y: 20, r: 8, color: '#1e293b' }, { x: 25, y: 50, r: 8, color: '#1e293b' }, { x: 75, y: 50, r: 8, color: '#1e293b' }, { x: 25, y: 80, r: 8, color: '#1e293b' }, { x: 75, y: 80, r: 8, color: '#1e293b' }]
    };
    return (
        <div className={`w-14 h-14 bg-white rounded-xl shadow-lg border border-slate-200 p-1 ${isRolling ? 'animate-bounce' : ''}`}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
                {(dotPositions[value] || []).map((dot, i) => <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} fill={dot.color} />)}
            </svg>
        </div>
    );
};

const BuiltInTile = ({ id, className = "", onClick }) => {
    const drawDots = () => {
        const dots = {
            'T1': [{x:20, y:28, r:14, c:'#dc2626'}],
            'T2': [{x:20, y:14, r:8, c:'#0284c7'}, {x:20, y:42, r:8, c:'#16a34a'}],
            'T3': [{x:10, y:12, r:6, c:'#0284c7'}, {x:20, y:28, r:6, c:'#dc2626'}, {x:30, y:44, r:6, c:'#16a34a'}],
            'T4': [{x:12, y:16, r:7, c:'#0284c7'}, {x:28, y:16, r:7, c:'#16a34a'}, {x:12, y:40, r:7, c:'#16a34a'}, {x:28, y:40, r:7, c:'#0284c7'}],
            'T5': [{x:10, y:12, r:6, c:'#0284c7'}, {x:30, y:12, r:6, c:'#16a34a'}, {x:20, y:28, r:6, c:'#dc2626'}, {x:10, y:44, r:6, c:'#16a34a'}, {x:30, y:44, r:6, c:'#0284c7'}],
            'T6': [{x:12, y:12, r:6, c:'#16a34a'}, {x:28, y:12, r:6, c:'#16a34a'}, {x:12, y:28, r:6, c:'#dc2626'}, {x:28, y:28, r:6, c:'#dc2626'}, {x:12, y:44, r:6, c:'#dc2626'}, {x:28, y:44, r:6, c:'#dc2626'}],
            'T7': [{x:8, y:8, r:5, c:'#dc2626'}, {x:20, y:14, r:5, c:'#dc2626'}, {x:32, y:20, r:5, c:'#dc2626'}, {x:12, y:34, r:5, c:'#0284c7'}, {x:28, y:34, r:5, c:'#16a34a'}, {x:12, y:46, r:5, c:'#16a34a'}, {x:28, y:46, r:5, c:'#0284c7'}],
            'T8': [{x:12, y:8, r:5, c:'#0284c7'}, {x:28, y:8, r:5, c:'#0284c7'}, {x:12, y:20, r:5, c:'#16a34a'}, {x:28, y:20, r:5, c:'#16a34a'}, {x:12, y:36, r:5, c:'#dc2626'}, {x:28, y:36, r:5, c:'#dc2626'}, {x:12, y:48, r:5, c:'#dc2626'}, {x:28, y:48, r:5, c:'#dc2626'}],
            'T9': [{x:8, y:12, r:5.5, c:'#0284c7'},{x:20, y:12, r:5.5, c:'#0284c7'},{x:32, y:12, r:5.5, c:'#0284c7'}, {x:8, y:28, r:5.5, c:'#dc2626'},{x:20, y:28, r:5.5, c:'#dc2626'},{x:32, y:28, r:5.5, c:'#dc2626'}, {x:8, y:44, r:5.5, c:'#16a34a'},{x:20, y:44, r:5.5, c:'#16a34a'},{x:32, y:44, r:5.5, c:'#16a34a'}]
        };
        return (dots[id] || []).map((d, i) => (
            <g key={i}><circle cx={d.x} cy={d.y} r={d.r} fill={d.c} />{d.r > 7 && <circle cx={d.x-d.r/3} cy={d.y-d.r/3} r={d.r/4} fill="rgba(255,255,255,0.4)" />}</g>
        ));
    };

    const drawBamboos = () => {
        if (id === 'S1') return <g><path d="M20 10 Q32 15 25 28 Q35 38 20 48 Q5 38 15 28 Q8 15 20 10" fill="#16a34a" /><circle cx="20" cy="18" r="3" fill="#dc2626" /><path d="M15 28 Q20 35 25 28" stroke="#dc2626" strokeWidth="2" fill="none" /></g>;
        const drawStick = (x, y, c, i) => <g key={i}><rect x={x-2.5} y={y-7} width="5" height="14" rx="2.5" fill={c} /><line x1={x-2} y1={y-2} x2={x+2} y2={y-2} stroke="rgba(255,255,255,0.5)" strokeWidth="1" /><line x1={x-2} y1={y+2} x2={x+2} y2={y+2} stroke="rgba(255,255,255,0.5)" strokeWidth="1" /></g>;
        const sticks = {
            'S2': [{x:20, y:16, c:'#16a34a'}, {x:20, y:40, c:'#0284c7'}],
            'S3': [{x:20, y:14, c:'#0284c7'}, {x:12, y:40, c:'#16a34a'}, {x:28, y:40, c:'#16a34a'}],
            'S4': [{x:12, y:16, c:'#16a34a'}, {x:28, y:16, c:'#0284c7'}, {x:12, y:40, c:'#16a34a'}, {x:28, y:40, c:'#0284c7'}],
            'S5': [{x:10, y:12, c:'#16a34a'}, {x:30, y:12, c:'#0284c7'}, {x:20, y:28, c:'#dc2626'}, {x:10, y:44, c:'#0284c7'}, {x:30, y:44, c:'#16a34a'}],
            'S6': [{x:10, y:16, c:'#16a34a'}, {x:20, y:16, c:'#16a34a'}, {x:30, y:16, c:'#16a34a'}, {x:10, y:40, c:'#0284c7'}, {x:20, y:40, c:'#0284c7'}, {x:30, y:40, c:'#0284c7'}],
            'S7': [{x:20, y:8, c:'#dc2626'}, {x:10, y:26, c:'#16a34a'}, {x:20, y:26, c:'#16a34a'}, {x:30, y:26, c:'#16a34a'}, {x:10, y:46, c:'#0284c7'}, {x:20, y:46, c:'#0284c7'}, {x:30, y:46, c:'#0284c7'}],
            'S8': [{x:12, y:12, c:'#16a34a'}, {x:28, y:12, c:'#16a34a'}, {x:12, y:28, c:'#dc2626'}, {x:28, y:28, c:'#dc2626'}, {x:12, y:44, c:'#0284c7'}, {x:28, y:44, c:'#0284c7'}, {x:20, y:12, c:'#16a34a'}, {x:20, y:44, c:'#0284c7'}],
            'S9': [{x:8, y:12, c:'#dc2626'}, {x:20, y:12, c:'#0284c7'}, {x:32, y:12, c:'#16a34a'}, {x:8, y:28, c:'#dc2626'}, {x:20, y:28, c:'#0284c7'}, {x:32, y:28, c:'#16a34a'}, {x:8, y:44, c:'#dc2626'}, {x:20, y:44, c:'#0284c7'}, {x:32, y:44, c:'#16a34a'}]
        };
        return (sticks[id] || []).map((s, i) => drawStick(s.x, s.y, s.c, i));
    };

    const drawWan = () => {
        const num = ['一','二','三','四','五','六','七','八','九'][parseInt(id[1])-1];
        return <g className="mj-font"><text x="20" y="22" fontSize="20" textAnchor="middle" className="mj-black">{num}</text><text x="20" y="46" fontSize="22" textAnchor="middle" className="mj-red">萬</text></g>;
    };

    const drawHonor = () => {
        const names = {'F1':'東', 'F2':'南', 'F3':'西', 'F4':'北', 'J1':'中', 'J2':'發'};
        const colors = {'F1':'mj-black', 'F2':'mj-black', 'F3':'mj-black', 'F4':'mj-black', 'J1':'mj-red', 'J2':'mj-green'};
        if (id === 'J3') return <rect x="8" y="10" width="24" height="36" rx="2" fill="none" stroke="#0284c7" strokeWidth="4" />;
        return <text x="20" y="38" fontSize="28" textAnchor="middle" className={`mj-font ${colors[id]}`}>{names[id]}</text>;
    };

    const drawFlower = () => {
        const names = {'H1':'春', 'H2':'夏', 'H3':'秋', 'H4':'冬', 'H5':'梅', 'H6':'蘭', 'H7':'竹', 'H8':'菊'};
        const bgColors = {'H1':'#fce7f3','H2':'#ecfeff','H3':'#fef3c7','H4':'#f1f5f9','H5':'#fdf4ff','H6':'#faf5ff','H7':'#f0fdf4','H8':'#fffbeb'};
        return <g><circle cx="20" cy="28" r="14" fill={bgColors[id]} stroke="#e2e8f0" strokeWidth="1" /><text x="20" y="35" fontSize="20" textAnchor="middle" className="mj-font mj-red">{names[id]}</text></g>;
    };

    let content;
    if (id.startsWith('W')) content = drawWan();
    else if (id.startsWith('T')) content = drawDots();
    else if (id.startsWith('S')) content = drawBamboos();
    else if (id.startsWith('F') || id.startsWith('J')) content = drawHonor();
    else if (id.startsWith('H')) content = drawFlower();

    return <div className={`mahjong-tile-3d ${className}`} onClick={onClick}><svg viewBox="0 0 40 56" className="w-full h-full drop-shadow-sm">{content}</svg></div>;
};

const MahjongEngine = {
    getWindId: (windName) => ({ '東': 'F1', '南': 'F2', '西': 'F3', '北': 'F4' }[windName] || 'F1'),
    evaluate: function(tiles, flowers, roundWindName, seatWindName, mode) {
        const requiredTiles = mode === 'TW' ? 17 : 14;
        if (tiles.length !== requiredTiles) return { error: `此模式必須選取 ${requiredTiles} 隻牌！` };
        let counts = {}; tiles.forEach(t => counts[t] = (counts[t] || 0) + 1);
        let uniqueTiles = Object.keys(counts);
        let flowerFan = 0; let flowerDetails = [];
        const seatIdx = ['東','南','西','北'].indexOf(seatWindName);
        const hasSeasons = ['H1','H2','H3','H4'].every(f => flowers.includes(f));
        const hasPlants = ['H5','H6','H7','H8'].every(f => flowers.includes(f));
        if (hasSeasons) { flowerFan += 2; flowerDetails.push(mode === 'TW' ? "春夏秋冬 +2台" : "一台花 +2"); }
        else if (flowers.includes(`H${seatIdx+1}`)) { flowerFan += 1; flowerDetails.push(mode === 'TW' ? `正花 +1台` : `正花 +1`); }
        if (hasPlants) { flowerFan += 2; flowerDetails.push(mode === 'TW' ? "梅蘭竹菊 +2台" : "一台花 +2"); }
        else if (flowers.includes(`H${seatIdx+5}`)) { flowerFan += 1; flowerDetails.push(mode === 'TW' ? `正花 +1台` : `正花 +1`); }
        if (mode === 'HK') {
            const orphans = ["W1","W9","T1","T9","S1","S9","F1","F2","F3","F4","J1","J2","J3"];
            if (orphans.every(o => counts[o] >= 1) && uniqueTiles.length === 13) return { valid: true, handName: "十三么", handFan: 13, flowerFan: flowerFan, details: ["十三么 +13", ...flowerDetails] };
        }
        let validParses = []; const targetMelds = mode === 'TW' ? 5 : 4;
        for (let i = 0; i < uniqueTiles.length; i++) {
            let eye = uniqueTiles[i];
            if (counts[eye] >= 2) {
                let tempCounts = { ...counts }; tempCounts[eye] -= 2;
                this.findMelds(tempCounts, [], targetMelds, validParses, eye);
            }
        }
        if (validParses.length === 0) return { error: "未能湊齊基本糊牌牌型！" };
        let bestScore = -1; let bestResult = null;
        validParses.forEach(parse => {
            let res = this.scoreParse(parse.melds, parse.eye, uniqueTiles, roundWindName, seatWindName, mode);
            if (res.handFan > bestScore) { bestScore = res.handFan; bestResult = res; }
        });
        return { ...bestResult, flowerFan: flowerFan, details: [...bestResult.details, ...flowerDetails] };
    },
    findMelds: function(counts, currentMelds, needed, allParses, eye) {
        if (needed === 0) { allParses.push({ eye, melds: [...currentMelds] }); return; }
        let available = Object.keys(counts).filter(k => counts[k] > 0).sort();
        if (available.length === 0) return;
        let t = available[0];
        if (counts[t] >= 3) {
            counts[t] -= 3; currentMelds.push({ type: 'pung', tile: t });
            this.findMelds(counts, currentMelds, needed - 1, allParses, eye);
            currentMelds.pop(); counts[t] += 3;
        }
        let suit = t.charAt(0); let val = parseInt(t.charAt(1));
        if (['W', 'T', 'S'].includes(suit) && val <= 7) {
            let t2 = suit + (val + 1); let t3 = suit + (val + 2);
            if (counts[t2] > 0 && counts[t3] > 0) {
                counts[t]--; counts[t2]--; counts[t3]--;
                currentMelds.push({ type: 'chow', tiles: [t, t2, t3] });
                this.findMelds(counts, currentMelds, needed - 1, allParses, eye);
                currentMelds.pop(); counts[t]++; counts[t2]++; counts[t3]++;
            }
        }
    },
    scoreParse: function(melds, eye, uniqueTiles, roundWindName, seatWindName, mode) {
        let fan = 0; let details = [];
        let isAllPung = melds.every(m => m.type === 'pung');
        let isPingHu = melds.every(m => m.type === 'chow');
        let hasW = uniqueTiles.some(t => t.startsWith('W'));
        let hasT = uniqueTiles.some(t => t.startsWith('T'));
        let hasS = uniqueTiles.some(t => t.startsWith('S'));
        let hasHonor = uniqueTiles.some(t => t.startsWith('F') || t.startsWith('J'));
        let suitCount = [hasW, hasT, hasS].filter(Boolean).length;
        let unit = mode === 'TW' ? '台' : '番';

        let baseName = mode === 'TW' ? "底台" : "雞糊";
        if (mode === 'TW') {
            if (suitCount === 0 && hasHonor) { baseName = "字一色"; fan += 16; details.push(`字一色 +16${unit}`); } 
            else if (suitCount === 1 && !hasHonor) { baseName = "清一色"; fan += 8; details.push(`清一色 +8${unit}`); } 
            else if (suitCount === 1 && hasHonor) { baseName = "混一色"; fan += 4; details.push(`混一色 +4${unit}`); } 
            else if (isPingHu) { baseName = "平胡"; fan += 2; details.push(`平胡 +2${unit}`); } 
            else if (isAllPung) { baseName = "碰碰胡"; fan += 4; details.push(`碰碰胡 +4${unit}`); }
        } else {
            if (suitCount === 0 && hasHonor) { baseName = "字一色"; fan += 10; details.push(`字一色 +10${unit}`); } 
            else if (suitCount === 1 && !hasHonor) { baseName = "清一色"; fan += 7; details.push(`清一色 +7${unit}`); } 
            else if (suitCount === 1 && hasHonor) { baseName = "混一色"; fan += 3; details.push(`混一色 +3${unit}`); } 
            else if (isPingHu) { baseName = "平糊"; fan += 1; details.push(`平糊 +1${unit}`); } 
            else if (isAllPung) { baseName = "對對糊"; fan += 3; details.push(`對對糊 +3${unit}`); }
        }

        let dragonPungs = melds.filter(m => m.type === 'pung' && m.tile.startsWith('J')).length;
        let hasDragonEye = eye.startsWith('J');
        if (dragonPungs === 3) { baseName = "大三元"; fan += 8; details = [`大三元 +8${unit}`]; } 
        else if (dragonPungs === 2 && hasDragonEye) { fan += (mode==='TW'?4:5); details.push(`小三元 +${mode==='TW'?4:5}${unit}`); } 
        else { melds.forEach(m => { if (m.type === 'pung' && m.tile.startsWith('J')) { fan += 1; details.push(`三元刻 +1${unit}`); } }); }

        let windPungs = melds.filter(m => m.type === 'pung' && m.tile.startsWith('F')).length;
        let hasWindEye = eye.startsWith('F');
        if (windPungs === 4) { baseName = "大四喜"; fan += (mode==='TW'?16:13); details = [`大四喜 +${mode==='TW'?16:13}${unit}`]; } 
        else if (windPungs === 3 && hasWindEye) { fan += (mode==='TW'?8:6); details.push(`小四喜 +${mode==='TW'?8:6}${unit}`); } 
        else {
            let roundWindId = this.getWindId(roundWindName);
            let seatWindId = this.getWindId(seatWindName);
            melds.forEach(m => {
                if (m.type === 'pung' && m.tile === roundWindId) { fan += 1; details.push(`圈風 +1${unit}`); }
                if (m.type === 'pung' && m.tile === seatWindId) { fan += 1; details.push(`門風 +1${unit}`); }
            });
        }
        return { valid: true, handName: baseName, handFan: fan, details: details };
    }
};

const App = () => {
    const [gameMode, setGameMode] = useState(localStorage.getItem('mahjong_mode') || 'HK'); 
    const [baseScore, setBaseScore] = useState(parseInt(localStorage.getItem('tw_base')||'100')); 
    const [taiScore, setTaiScore] = useState(parseInt(localStorage.getItem('tw_tai')||'50')); 

    const defaultHkScores = [1, 2, 4, 8, 16, 32, 64, 128, 192, 256];
    const [hkScores, setHkScores] = useState(() => {
        const saved = localStorage.getItem('hk_scores');
        return saved ? JSON.parse(saved) : defaultHkScores;
    });

    const [activeTab, setActiveTab] = useState('dice'); 

    // ⭐ Fullscreen toggle (browser Fullscreen API)
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    const toggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch (e) {
            console.warn('Fullscreen toggle failed:', e);
        }
    };
    
    // ⭐ 名單管理
    const [players, setPlayers] = useState(() => {
        const saved = localStorage.getItem('players_list');
        return saved ? JSON.parse(saved) : [
            { id: 1, name: '玩家 A', score: 0 }, { id: 2, name: '玩家 B', score: 0 },
            { id: 3, name: '玩家 C', score: 0 }, { id: 4, name: '玩家 D', score: 0 }
        ];
    });
    const [newPlayerName, setNewPlayerName] = useState("");
    // 編輯模式狀態
    const [editingPlayerId, setEditingPlayerId] = useState(null);
    const [editingName, setEditingName] = useState("");

    useEffect(() => { localStorage.setItem('players_list', JSON.stringify(players)); }, [players]);

    const [activePlayerIds, setActivePlayerIds] = useState(() => players.slice(0,4).map(p=>p.id));

    const [dealerId, setDealerId] = useState(players[0]?.id || 1);
    const [roundWind, setRoundWind] = useState('東');
    const [streak, setStreak] = useState(0);
    
    const [handFan, setHandFan] = useState(gameMode === 'TW' ? 0 : 3);
    const [flowerFan, setFlowerFan] = useState(0);
    
    const [winnerId, setWinnerId] = useState(activePlayerIds[0]);
    const [loserId, setLoserId] = useState(activePlayerIds[1]);
    const [isSelfDraw, setIsSelfDraw] = useState(false);
    
    const [diceMode, setDiceMode] = useState('auto'); 
    const [manualDiceSum, setManualDiceSum] = useState("");
    const [diceValues, setDiceValues] = useState([1, 1, 1]);
    const [isRolling, setIsRolling] = useState(false);
    const [history, setHistory] = useState([]);
    
    const [mode, setMode] = useState('select'); 
    const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || "");
    const [tempApiKey, setTempApiKey] = useState(apiKey);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [aiResult, setAiResult] = useState(null);
    const [previewImage, setPreviewImage] = useState(null);
    const fileInputRef = useRef(null);
    
    const [selectedTiles, setSelectedTiles] = useState([]);
    const [selectedFlowers, setSelectedFlowers] = useState([]);

    const requiredTileCount = gameMode === 'TW' ? 17 : 14;

    const getActivePlayers = () => activePlayerIds.map(id => players.find(p => p.id === id)).filter(Boolean);
    const getSeatName = (id) => {
        const idx = activePlayerIds.indexOf(id);
        if (idx === -1) return "未知";
        return ['東','南','西','北'][idx];
    };

    const changeGameMode = (m) => {
        setGameMode(m); localStorage.setItem('mahjong_mode', m);
        setHandFan(m === 'TW' ? 0 : 3);
        setSelectedTiles([]); setAiResult(null);
    };

    const applyApiKey = () => { localStorage.setItem('gemini_api_key', tempApiKey); setApiKey(tempApiKey); alert("API Key 已套用！"); };

    const analyzeWithAI = async (base64) => {
        if (!apiKey) { alert("請先設定 API Key。"); return; }
        setIsAnalyzing(true); setAiResult(null);
        const winnerName = getSeatName(winnerId);
        const prompt = gameMode === 'TW' 
            ? `你是台灣麻將裁判。環境：${roundWind}風圈，贏家：${winnerName}位。分析照片糊牌。返回 JSON: { "handName": "名稱", "handFan": 數字, "flowerFan": 數字, "details": ["細項"], "explanation": "簡介" }`
            : `你是廣東麻雀裁判。環境：${roundWind}圈，贏家：${winnerName}位。分析照片糊牌。返回 JSON: { "handName": "名稱", "handFan": 數字, "flowerFan": 數字, "details": ["細項"], "explanation": "簡介" }`;

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: base64.split(',')[1] } }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            const res = JSON.parse(data.candidates[0].content.parts[0].text);
            setAiResult({ valid: true, fan: res.handFan+res.flowerFan, ...res });
            setHandFan(res.handFan || 0); setFlowerFan(res.flowerFan || 0);
        } catch (e) {
            setAiResult({ error: "AI 分析出錯：" + e.message });
        } finally { setIsAnalyzing(false); }
    };

    const handleFile = (e) => { const f = e.target.files[0]; if(f){ const r = new FileReader(); r.onloadend = () => { setPreviewImage(r.result); analyzeWithAI(r.result); }; r.readAsDataURL(f); } };

    const handleTileClick = (tileId) => {
        if (tileId.startsWith('H')) {
            if (selectedFlowers.includes(tileId)) setSelectedFlowers(selectedFlowers.filter(f => f !== tileId));
            else setSelectedFlowers([...selectedFlowers, tileId]);
        } else {
            if (selectedTiles.length >= requiredTileCount) return;
            let count = selectedTiles.filter(t => t === tileId).length;
            if (count >= 4) { alert("最多只能有 4 隻相同的牌！"); return; }
            const order = ['W','T','S','F','J'];
            let newTiles = [...selectedTiles, tileId].sort((a,b) => {
                if (a[0] !== b[0]) return order.indexOf(a[0]) - order.indexOf(b[0]);
                return parseInt(a[1]) - parseInt(b[1]);
            });
            setSelectedTiles(newTiles);
        }
        setAiResult(null);
    };
    const removeTile = (index) => { let newTiles = [...selectedTiles]; newTiles.splice(index, 1); setSelectedTiles(newTiles); setAiResult(null); };

    const evaluateSelectedTiles = () => {
        const winnerName = getSeatName(winnerId);
        const result = MahjongEngine.evaluate(selectedTiles, selectedFlowers, roundWind, winnerName, gameMode);
        if (result.valid) { setAiResult({ ...result, fan: result.handFan + result.flowerFan }); setHandFan(result.handFan); setFlowerFan(result.flowerFan); } else setAiResult(result);
    };

    const renderKeyboard = () => {
        const groups = [{ prefix: 'W', count: 9 }, { prefix: 'T', count: 9 }, { prefix: 'S', count: 9 }];
        const honors = ['F1', 'F2', 'F3', 'F4', 'J1', 'J2', 'J3'];
        const flowers = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'];
        return (
            <div className="space-y-3">
                {groups.map(g => (
                    <div key={g.prefix} className="grid grid-cols-9 gap-1.5">
                        {[...Array(g.count)].map((_, i) => <BuiltInTile key={i} id={`${g.prefix}${i+1}`} className="mahjong-tile-sm aspect-[3/4]" onClick={() => handleTileClick(`${g.prefix}${i+1}`)} />)}
                    </div>
                ))}
                <div className="grid grid-cols-9 gap-1.5 pt-1 border-t border-emerald-200/50">
                    {honors.map(h => <BuiltInTile key={h} id={h} className="mahjong-tile-sm aspect-[3/4]" onClick={() => handleTileClick(h)} />)}
                </div>
                <div className="pt-2 mt-2 border-t border-emerald-200/50">
                    <span className="text-[10px] font-bold text-emerald-800 tracking-widest uppercase block mb-1.5">花牌 (點擊切換)</span>
                    <div className="grid grid-cols-8 gap-1.5">
                        {flowers.map(h => {
                            const isSel = selectedFlowers.includes(h);
                            return <div key={h} className={`transition-all ${isSel ? 'ring-2 ring-pink-500 scale-[0.85] opacity-50 rounded bg-pink-100' : ''}`}><BuiltInTile id={h} className="mahjong-tile-sm aspect-[3/4]" onClick={() => handleTileClick(h)} /></div>;
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const handleSettle = () => {
        const isWinnerDealer = winnerId === dealerId;
        const newPlayers = [...players];
        const winIdx = newPlayers.findIndex(p => p.id === winnerId);
        let totalScoreChange = 0; let detailsText = "";

        if (gameMode === 'HK') {
            const totalFan = Math.min(handFan + flowerFan, hkScores.length);
            if (totalFan === 0) { alert("不能結算 0 番"); return; }
            let base = hkScores[totalFan - 1]; 

            if (isSelfDraw) {
                activePlayerIds.forEach((pid) => {
                    if (pid === winnerId) return;
                    let pay = base;
                    if (isWinnerDealer || pid === dealerId) pay *= 2;
                    const idx = newPlayers.findIndex(p => p.id === pid);
                    newPlayers[idx].score -= pay;
                    totalScoreChange += pay;
                });
            } else {
                let pay = base;
                const isLoserDealer = loserId === dealerId;
                if (isWinnerDealer || isLoserDealer) pay *= 2;
                const loseIdx = newPlayers.findIndex(p => p.id === loserId);
                newPlayers[loseIdx].score -= pay;
                totalScoreChange += pay;
            }
            detailsText = `${totalFan}番 ${isSelfDraw?'自摸':'食糊'}`;
        } else {
            let totalTai = handFan + flowerFan;
            if (isSelfDraw) totalTai += 1; 
            
            const calcPayout = (payerId) => {
                let currentTai = totalTai;
                if (winnerId === dealerId || payerId === dealerId) {
                    currentTai += 1; 
                    if (streak > 0) currentTai += (streak * 2); 
                }
                return baseScore + (currentTai * taiScore);
            };

            if (isSelfDraw) {
                activePlayerIds.forEach((pid) => {
                    if (pid === winnerId) return;
                    let pay = calcPayout(pid);
                    const idx = newPlayers.findIndex(p => p.id === pid);
                    newPlayers[idx].score -= pay;
                    totalScoreChange += pay;
                });
            } else {
                let pay = calcPayout(loserId);
                const loseIdx = newPlayers.findIndex(p => p.id === loserId);
                newPlayers[loseIdx].score -= pay;
                totalScoreChange += pay;
            }
            detailsText = `底${baseScore}/台${taiScore} (共${totalTai}台)`;
        }

        newPlayers[winIdx].score += totalScoreChange;
        setPlayers(newPlayers);
        setHistory([{ id: Date.now(), text: `${players.find(p=>p.id===winnerId).name} 贏 ${detailsText}`, time: new Date().toLocaleTimeString() }, ...history]);

        if (winnerId !== dealerId) {
            const currentIdx = activePlayerIds.indexOf(dealerId);
            const nextDealerId = activePlayerIds[(currentIdx + 1) % 4];
            setDealerId(nextDealerId);
            setStreak(0);
            if (((currentIdx + 1) % 4) === 0) setRoundWind(w => ['東','南','西','北'][(['東','南','西','北'].indexOf(w)+1)%4]);
        } else {
            setStreak(s => s + 1);
        }
        
        setActiveTab('dice'); setHandFan(gameMode === 'TW' ? 0 : 3); setFlowerFan(0); setAiResult(null); setSelectedTiles([]); setSelectedFlowers([]); setPreviewImage(null);
    };

    const getDiceInstruction = () => {
        let sum = diceMode === 'manual' ? parseInt(manualDiceSum) || 0 : diceValues.reduce((a,b) => a+b, 0);
        if (sum === 0) return { sum: 0, targetPos: '-', direction: '-', count: 0 };
        
        const targetIdx = (sum - 1) % 4;
        const targetSeat = ['東 (自己)', '南 (下家)', '西 (對家)', '北 (上家)'][targetIdx];
        const direction = sum % 2 === 0 ? '右' : '左';
        return { sum, targetPos: targetSeat, direction, count: sum };
    };

    // ⭐ 編輯玩家名稱邏輯
    const addPlayer = () => {
        if (!newPlayerName.trim()) return;
        const newId = Date.now();
        setPlayers([...players, { id: newId, name: newPlayerName.trim(), score: 0 }]);
        setNewPlayerName("");
    };
    const toggleActivePlayer = (pid) => {
        if (activePlayerIds.includes(pid)) {
            if (activePlayerIds.length <= 4) { alert("場上必須保持 4 位玩家！"); return; }
            setActivePlayerIds(activePlayerIds.filter(id => id !== pid));
        } else {
            if (activePlayerIds.length >= 4) { alert("場上最多只能有 4 位玩家，請先將一人換下。"); return; }
            setActivePlayerIds([...activePlayerIds, pid]);
        }
    };
    const savePlayerName = (pid) => {
        if (!editingName.trim()) return;
        const newPlayers = players.map(p => p.id === pid ? { ...p, name: editingName.trim() } : p);
        setPlayers(newPlayers);
        setEditingPlayerId(null);
    };

    return (
        <div className="flex flex-col min-h-screen pb-24">
            <header className="bg-emerald-950 text-white p-4 sticky top-0 z-50 shadow-md flex justify-between items-center border-b-4 border-emerald-900">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="bg-red-500 px-1.5 py-0.5 rounded text-[10px] font-black italic shadow">PRO</span>
                        <h1 className="text-xl font-black tracking-tight leading-none">麻雀神器</h1>
                    </div>
                    <p className="text-[10px] opacity-80 font-bold uppercase mt-1.5 tracking-widest text-emerald-300">
                        {gameMode === 'HK' ? '廣東牌 14張' : '台灣牌 16張'} | {roundWind}圈 | {streak}連莊
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={toggleFullscreen} title={isFullscreen ? '退出全螢幕' : '全螢幕'} className="p-2.5 bg-white/10 rounded-xl hover:bg-white/20"><Icon name={isFullscreen ? 'fullscreen-exit' : 'fullscreen-enter'} size={20} /></button>
                    <button onClick={() => window.location.reload()} className="p-2.5 bg-white/10 rounded-xl hover:bg-white/20"><Icon name="rotate-ccw" size={20} /></button>
                </div>
            </header>

            <main className="flex-1 max-w-md mx-auto w-full p-4 space-y-4">
                <div className="grid grid-cols-4 gap-2">
                    {getActivePlayers().map((p, idx) => {
                        const seat = ['東','南','西','北'][idx];
                        return (
                            <div key={p.id} onClick={() => setWinnerId(p.id)} className={`p-2 rounded-xl border-b-4 transition-all text-center relative cursor-pointer ${winnerId === p.id ? 'border-emerald-600 bg-emerald-50' : p.id === dealerId ? 'border-red-400 bg-red-50' : 'bg-white border-slate-200'}`}>
                                {p.id === dealerId && <span className="absolute -top-2 -right-1 bg-red-600 text-white text-[9px] px-1.5 py-0.5 rounded-full font-black shadow-sm border border-white">莊</span>}
                                <div className="flex items-center justify-center gap-1 mb-0.5">
                                    <span className="text-[8px] bg-slate-200 px-1 rounded text-slate-500 font-bold">{seat}</span>
                                    <p className="text-[10px] font-bold text-slate-600 truncate max-w-[40px]">{p.name}</p>
                                </div>
                                <p className={`text-base font-black ${p.score < 0 ? 'text-red-600' : 'text-slate-800'}`}>{p.score}</p>
                            </div>
                        )
                    })}
                </div>

                {activeTab === 'dice' && (
                    <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 text-center animate-in fade-in space-y-4">
                        <div className="flex justify-center bg-slate-100 p-1 rounded-2xl w-max mx-auto mb-4">
                            <button onClick={()=>setDiceMode('auto')} className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${diceMode === 'auto' ? 'bg-white shadow-sm text-emerald-800' : 'text-slate-500'}`}>自動擲骰</button>
                            <button onClick={()=>setDiceMode('manual')} className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${diceMode === 'manual' ? 'bg-white shadow-sm text-emerald-800' : 'text-slate-500'}`}>手動輸入</button>
                        </div>

                        {diceMode === 'auto' ? (
                            <>
                                <div className="flex justify-center gap-4 py-2">
                                    {diceValues.map((v, i) => <DiceFace key={i} value={v} isRolling={isRolling} />)}
                                </div>
                                <button onClick={() => { setIsRolling(true); const i = setInterval(() => setDiceValues([Math.floor(Math.random()*6)+1,Math.floor(Math.random()*6)+1,Math.floor(Math.random()*6)+1]), 80); setTimeout(() => { clearInterval(i); setIsRolling(false); }, 700); }} disabled={isRolling} className="w-full py-5 bg-emerald-800 text-white rounded-[1.5rem] font-black shadow-lg border-b-4 border-emerald-950 active:scale-95 transition-all text-xl">開始擲骰</button>
                            </>
                        ) : (
                            <div className="py-4 border border-slate-200 bg-slate-50 rounded-[2rem] p-6 shadow-inner">
                                <label className="text-xs font-bold text-slate-500 block mb-3 tracking-widest uppercase">輸入實體骰子點數總和</label>
                                <input type="number" value={manualDiceSum} onChange={e => setManualDiceSum(e.target.value)} placeholder="例如: 12" className="w-full text-center text-5xl font-black bg-white border border-emerald-200 rounded-2xl py-6 outline-none focus:border-emerald-500 shadow-sm text-emerald-900" />
                            </div>
                        )}
                        
                        <div className="bg-emerald-50 rounded-[2rem] p-5 border border-emerald-100 shadow-inner mt-4">
                            <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-emerald-200/50">
                                <div><p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest mb-1">總點數</p><p className="text-4xl font-black text-emerald-900">{getDiceInstruction().sum}</p></div>
                                <div><p className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest mb-1">開牌方位</p><p className="text-xl font-black text-emerald-900 mt-2">{getDiceInstruction().targetPos}</p></div>
                            </div>
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-emerald-100">
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">拿牌指示</p>
                                <p className="text-lg font-black text-emerald-700">
                                    由<span className="text-red-600">{getDiceInstruction().direction}</span>邊數起第 <span className="text-red-600">{getDiceInstruction().count}</span> 疊
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'calc' && (
                    <div className="space-y-3 animate-in slide-in-from-bottom-2">
                        <div className="flex bg-emerald-100/50 p-1.5 rounded-2xl border border-emerald-200/50 shadow-inner">
                            <button onClick={()=>setMode('select')} className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${mode === 'select' ? 'bg-white text-emerald-900 shadow-sm border border-emerald-200' : 'text-emerald-700/60'}`}><Icon name="grid" size={16} /> 實體選牌</button>
                            <button onClick={()=>setMode('camera')} className={`flex-1 py-2.5 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${mode === 'camera' ? 'bg-white text-emerald-900 shadow-sm border border-emerald-200' : 'text-emerald-700/60'}`}><Icon name="camera" size={16} /> AI 拍照</button>
                        </div>

                        {mode === 'select' && (
                            <div className="bg-white/80 backdrop-blur border border-emerald-100 p-4 rounded-[2rem] shadow-sm space-y-4">
                                <div className="bg-emerald-800/5 border border-emerald-900/10 p-3 rounded-2xl min-h-[90px] relative">
                                    <div className="flex justify-between items-center mb-3 px-1">
                                        <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">手牌: {selectedTiles.length}/{requiredTileCount}</span>
                                        {selectedTiles.length > 0 && <button onClick={()=>{setSelectedTiles([]); setSelectedFlowers([]); setAiResult(null);}} className="text-[10px] text-red-600 font-bold bg-white px-2 py-1 rounded shadow-sm border border-red-100 flex items-center gap-1"><Icon name="trash" size={12}/>清空</button>}
                                    </div>
                                    <div className="flex flex-wrap gap-x-[2px] gap-y-2 px-1">
                                        {selectedTiles.map((t, i) => (
                                            <div key={i} className="w-[10.5%]"><BuiltInTile id={t} className="w-full aspect-[3/4] mahjong-tile-sm" onClick={() => removeTile(i)} /></div>
                                        ))}
                                        {selectedTiles.length === 0 && <span className="text-xs text-emerald-700/50 font-bold w-full text-center py-4 absolute inset-0 flex items-center justify-center pointer-events-none">點擊下方麻雀加入手牌</span>}
                                    </div>
                                </div>

                                <div className="bg-emerald-50/50 p-3 rounded-2xl border border-emerald-100/50">{renderKeyboard()}</div>

                                {selectedTiles.length === requiredTileCount && !aiResult && (
                                    <button onClick={evaluateSelectedTiles} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black shadow-lg text-lg tracking-widest active:scale-95 transition-transform border-b-4 border-emerald-800">結算{gameMode==='TW'?'台數':'番數'}</button>
                                )}

                                {aiResult && (
                                    <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border-2 border-emerald-400 shadow-md">
                                        {aiResult.error ? <p className="text-red-600 font-black text-center">{aiResult.error}</p> : (
                                            <>
                                                <div className="flex justify-between items-center mb-3">
                                                    <h3 className="font-black text-2xl text-emerald-950 tracking-tight">{aiResult.handName}</h3>
                                                    <span className="bg-emerald-800 text-emerald-50 px-4 py-1.5 rounded-xl text-lg font-black shadow-inner border border-emerald-950">{aiResult.fan} {gameMode==='TW'?'台':'番'}</span>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 mb-5">
                                                    {aiResult.details.map((d,i)=><span key={i} className="text-[10px] bg-white px-2 py-1 rounded text-emerald-800 font-bold border border-emerald-200 shadow-sm">{d}</span>)}
                                                </div>
                                                <button onClick={()=>setActiveTab('score')} className="w-full py-4 bg-emerald-900 text-emerald-50 rounded-xl font-black text-sm shadow-lg active:scale-95 transition-transform border-b-4 border-emerald-950">應用並結算入賬</button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {mode === 'camera' && (
                            <div className="bg-white p-6 rounded-[2rem] border border-emerald-100 shadow-sm">
                                {!apiKey && <div className="mb-4 bg-amber-50 p-4 rounded-xl border border-amber-200"><p className="text-xs font-bold text-amber-800">未設定 API Key</p><p className="text-[10px] text-amber-600">請在設定填入 Key 以開啟 AI。</p></div>}
                                <div onClick={() => apiKey && fileInputRef.current?.click()} className={`aspect-square bg-slate-50 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center relative overflow-hidden transition-all ${!apiKey ? 'opacity-50 border-slate-300' : 'border-emerald-400 hover:bg-emerald-50 cursor-pointer shadow-inner'}`}>
                                    {previewImage ? <img src={previewImage} className="w-full h-full object-cover rounded-3xl" /> : <div className="text-emerald-700/50 font-bold"><Icon name="camera" size={48} className="mx-auto mb-2" />拍攝手牌照片</div>}
                                    {isAnalyzing && <div className="absolute inset-0 bg-emerald-900/80 backdrop-blur flex items-center justify-center text-white"><span className="font-black tracking-widest animate-pulse">AI 分析中...</span></div>}
                                </div>
                                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleFile} />
                                
                                {aiResult && !aiResult.error && (
                                    <div className="mt-4 p-5 bg-emerald-50 rounded-2xl border-2 border-emerald-400">
                                        <div className="flex justify-between items-center mb-2">
                                            <h3 className="font-black text-xl text-emerald-900">{aiResult.handName}</h3>
                                            <span className="bg-emerald-800 text-white px-3 py-1 rounded-xl font-black">{aiResult.fan} {gameMode==='TW'?'台':'番'}</span>
                                        </div>
                                        <button onClick={()=>setActiveTab('score')} className="w-full mt-4 py-3 bg-emerald-900 text-white rounded-xl font-black shadow-lg">結算入賬</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'score' && (
                    <div className="space-y-4 animate-in slide-in-from-bottom-2">
                        <div className="bg-emerald-900 p-6 rounded-[2rem] text-white shadow-xl relative border-b-4 border-emerald-950">
                            <div className="flex justify-between items-center mb-5">
                                <h3 className="font-black text-xl">結算入賬</h3>
                                <div className="bg-emerald-800 px-3 py-1 rounded-xl font-black text-sm border border-emerald-700 shadow-inner">共 {handFan + flowerFan} {gameMode==='TW'?'台':'番'}</div>
                            </div>
                            <div className="space-y-5">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-black/20 p-3 rounded-2xl">
                                        <label className="text-[9px] font-bold opacity-50 block mb-1">牌面{gameMode==='TW'?'台':'番'}</label>
                                        <div className="flex justify-between items-center">
                                            <button onClick={()=>setHandFan(Math.max(0, handFan-1))} className="px-3 font-black text-lg opacity-50">-</button>
                                            <span className="text-2xl font-black">{handFan}</span>
                                            <button onClick={()=>setHandFan(handFan+1)} className="px-3 font-black text-lg opacity-50">+</button>
                                        </div>
                                    </div>
                                    <div className="bg-black/20 p-3 rounded-2xl">
                                        <label className="text-[9px] font-bold opacity-50 block mb-1">花牌{gameMode==='TW'?'台':'番'}</label>
                                        <div className="flex justify-between items-center">
                                            <button onClick={()=>setFlowerFan(Math.max(0, flowerFan-1))} className="px-3 font-black text-lg opacity-50">-</button>
                                            <span className="text-2xl font-black">{flowerFan}</span>
                                            <button onClick={()=>setFlowerFan(flowerFan+1)} className="px-3 font-black text-lg opacity-50">+</button>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex bg-black/30 p-1.5 rounded-xl gap-1">
                                    <button onClick={()=>setIsSelfDraw(false)} className={`flex-1 py-3 text-sm font-black rounded-lg ${!isSelfDraw ? 'bg-emerald-50 text-emerald-950 shadow-sm' : 'opacity-50'}`}>出沖</button>
                                    <button onClick={()=>setIsSelfDraw(true)} className={`flex-1 py-3 text-sm font-black rounded-lg ${isSelfDraw ? 'bg-emerald-50 text-emerald-950 shadow-sm' : 'opacity-50'}`}>自摸{gameMode==='TW'&&'(+1台)'}</button>
                                </div>
                                
                                {!isSelfDraw && (
                                    <div>
                                        <label className="text-[9px] font-bold opacity-50 mb-2 block uppercase tracking-widest">邊個出沖？(可從全名單選擇)</label>
                                        <div className="flex flex-wrap gap-2">
                                            {players.filter(p => p.id !== winnerId).map(p => (
                                                <button 
                                                    key={p.id} 
                                                    onClick={() => setLoserId(p.id)} 
                                                    className={`py-2 px-3 rounded-xl text-xs font-black border-b-4 transition-all ${loserId === p.id ? 'bg-red-500 border-red-700 text-white shadow-lg' : 'bg-black/20 border-transparent text-emerald-50 hover:bg-black/30'}`}
                                                >
                                                    {p.name} {!activePlayerIds.includes(p.id) && '(外)'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {gameMode === 'TW' ? (
                                    <div className="bg-black/20 p-3 rounded-xl text-[10px] font-bold text-emerald-200 text-center">
                                        台灣牌結算: 底({baseScore}) + 台({taiScore}) | 莊家/連莊自動計算
                                    </div>
                                ) : (
                                    <div className="bg-black/20 p-3 rounded-xl text-[10px] font-bold text-emerald-200 text-center">
                                        目前 {handFan+flowerFan} 番 = {hkScores[Math.min(handFan+flowerFan, hkScores.length)-1] || 0} 分 (未計莊家翻倍)
                                    </div>
                                )}
                                <button onClick={handleSettle} className="w-full py-4 bg-emerald-500 text-emerald-950 rounded-xl font-black shadow-lg text-lg border-b-4 border-emerald-700 active:scale-95 transition-transform">確認結算</button>
                            </div>
                        </div>
                        <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
                            <h3 className="text-[10px] font-black text-slate-400 mb-4 uppercase tracking-widest flex items-center gap-2"><Icon name="trophy" size={14}/> 戰報紀錄</h3>
                            <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-hide">
                                {history.length === 0 ? <p className="text-center py-6 text-slate-300 italic text-sm font-bold">尚未有紀錄</p> : 
                                    history.map(h => (
                                        <div key={h.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100 animate-in fade-in">
                                            <span className="text-xs font-black text-slate-700">{h.text}</span>
                                            <span className="text-[9px] text-slate-400 font-mono font-bold">{h.time}</span>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'settings' && (
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 space-y-6">
                        <h3 className="font-black text-lg text-slate-800">遊戲設定</h3>
                        
                        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                            <label className="text-[10px] font-bold text-emerald-800 block mb-3 uppercase tracking-widest">麻雀模式切換</label>
                            <div className="flex gap-2 mb-4">
                                <button onClick={()=>changeGameMode('HK')} className={`flex-1 py-3 rounded-xl text-sm font-black border-2 transition-all ${gameMode === 'HK' ? 'border-emerald-600 bg-white text-emerald-800 shadow' : 'border-transparent text-emerald-600/50'}`}>廣東牌</button>
                                <button onClick={()=>changeGameMode('TW')} className={`flex-1 py-3 rounded-xl text-sm font-black border-2 transition-all ${gameMode === 'TW' ? 'border-emerald-600 bg-white text-emerald-800 shadow' : 'border-transparent text-emerald-600/50'}`}>台灣牌</button>
                            </div>

                            {gameMode === 'HK' && (
                                <div className="mt-4 pt-4 border-t border-emerald-200/50">
                                    <label className="text-[10px] font-bold text-emerald-800 block mb-2 uppercase tracking-widest">自訂番數對應分數 (修改後即時生效)</label>
                                    <div className="grid grid-cols-5 gap-2">
                                        {hkScores.map((score, idx) => (
                                            <div key={idx} className="flex flex-col">
                                                <span className="text-[8px] text-emerald-600 font-bold mb-0.5 text-center">{idx+1}番</span>
                                                <input 
                                                    type="number" 
                                                    value={score} 
                                                    onChange={(e) => {
                                                        const newScores = [...hkScores];
                                                        newScores[idx] = parseInt(e.target.value) || 0;
                                                        setHkScores(newScores);
                                                        localStorage.setItem('hk_scores', JSON.stringify(newScores));
                                                    }}
                                                    className="w-full text-center text-xs font-black p-1 rounded bg-white border border-emerald-200 outline-none focus:border-emerald-500"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[8px] text-emerald-600/70 mt-2">* 預設 10 番封頂 = 256分 (可按家規修改)</p>
                                </div>
                            )}

                            {gameMode === 'TW' && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-emerald-800 block mb-1">底注金額</label>
                                        <input type="number" value={baseScore} onChange={e=>{setBaseScore(parseInt(e.target.value)||0); localStorage.setItem('tw_base',e.target.value);}} className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 font-black text-sm outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-emerald-800 block mb-1">每台金額</label>
                                        <input type="number" value={taiScore} onChange={e=>{setTaiScore(parseInt(e.target.value)||0); localStorage.setItem('tw_tai',e.target.value);}} className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-2 font-black text-sm outline-none" />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* ⭐ 玩家名單管理 (含修改名字功能) */}
                        <div className="border border-slate-200 p-4 rounded-2xl">
                            <label className="text-[10px] font-bold text-slate-500 block mb-3 uppercase tracking-widest flex items-center gap-1"><Icon name="users" size={14}/> 玩家名單管理 (多人輪替)</label>
                            
                            <div className="flex gap-2 mb-4">
                                <input type="text" value={newPlayerName} onChange={e=>setNewPlayerName(e.target.value)} placeholder="新增玩家名字..." className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-emerald-500" />
                                <button onClick={addPlayer} className="bg-slate-800 text-white px-4 rounded-lg text-xs font-bold shadow">+</button>
                            </div>

                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                {players.map(p => {
                                    const isActive = activePlayerIds.includes(p.id);
                                    const isEditing = editingPlayerId === p.id;
                                    return (
                                        <div key={p.id} className={`flex items-center justify-between p-2 rounded-xl border ${isActive ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-100'}`}>
                                            <div className="flex items-center gap-2 flex-1">
                                                {isEditing ? (
                                                    <input 
                                                        type="text" 
                                                        autoFocus
                                                        value={editingName} 
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        className="text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded px-2 py-1 w-24 outline-none"
                                                    />
                                                ) : (
                                                    <span className="text-xs font-bold text-slate-700 truncate max-w-[100px]">{p.name} <span className="text-[9px] text-slate-400 font-normal">({p.score}分)</span></span>
                                                )}
                                                
                                                {isEditing ? (
                                                    <button onClick={() => savePlayerName(p.id)} className="text-emerald-600"><Icon name="check" size={14}/></button>
                                                ) : (
                                                    <button onClick={() => { setEditingPlayerId(p.id); setEditingName(p.name); }} className="text-slate-400 hover:text-emerald-600"><Icon name="edit" size={12}/></button>
                                                )}
                                            </div>
                                            
                                            <button 
                                                onClick={() => toggleActivePlayer(p.id)}
                                                className={`text-[9px] font-bold px-3 py-1.5 rounded-lg shadow-sm ${isActive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}
                                            >
                                                {isActive ? '場上' : '換入'}
                                            </button>
                                        </div>
                                    )
                                })}
                            </div>
                            <p className="text-[8px] text-slate-400 mt-3 font-bold leading-relaxed">* 必須保持 4 位玩家在「場上」。結算時可選擇出沖給場外玩家。<br/>* 點擊 ✏️ 圖示即可修改玩家真實姓名。</p>
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-400 block mb-2">Gemini API Key</label>
                            <div className="flex gap-2">
                                <input type="password" value={tempApiKey} onChange={e => setTempApiKey(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono outline-none" />
                                <button onClick={applyApiKey} className="bg-emerald-800 text-white px-4 rounded-xl font-bold text-xs">套用</button>
                            </div>
                        </div>
                        <div className="pt-2 border-t border-slate-100">
                            <button onClick={()=>{if(confirm('重設所有分數？')){setPlayers(players.map(p=>({...p,score:0})));setHistory([]);}}} className="w-full py-3 bg-red-50 text-red-600 rounded-xl font-bold text-sm border border-red-100">重設遊戲數據</button>
                        </div>
                    </div>
                )}
                
                <AdSenseWidget />
                
                <div className="text-center pt-4 pb-2">
                    <a href="https://comparetiger.com" target="_blank" rel="noopener noreferrer" className="text-[10px] text-slate-400 font-bold tracking-widest uppercase hover:text-emerald-600 transition-colors">
                        comparetiger 創作
                    </a>
                </div>
            </main>

            <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-emerald-100 px-6 py-4 flex justify-around items-center z-50 pb-8">
                <NavButton active={activeTab === 'dice'} icon="dices" label="開局" onClick={() => setActiveTab('dice')} />
                <NavButton active={activeTab === 'calc'} icon="grid" label="計番" onClick={() => setActiveTab('calc')} />
                <NavButton active={activeTab === 'score'} icon="trophy" label="結算" onClick={() => setActiveTab('score')} />
                <NavButton active={activeTab === 'settings'} icon="settings" label="設定" onClick={() => setActiveTab('settings')} />
            </nav>
        </div>
    );
};

const NavButton = ({ active, icon, label, onClick }) => (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 transition-all ${active ? 'text-emerald-800 scale-110 font-black' : 'text-slate-400 font-bold'}`}>
        <div className={`p-2 ${active ? 'bg-emerald-100 rounded-xl' : ''}`}><Icon name={icon} size={24} /></div>
        <span className="text-[10px] tracking-widest">{label}</span>
    </button>
);

export default App;
