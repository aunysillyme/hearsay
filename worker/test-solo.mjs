
const BASE = process.argv[2] || "https://hearsay-room.aunysillyme.workers.dev";
const code = "T" + Math.random().toString(36).slice(2, 8).toUpperCase();
const post = async (act, body) => { const r = await fetch(`${BASE}/room/${code}/${act}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };
const get = async (me) => (await fetch(`${BASE}/room/${code}?me=${me || ""}`)).json();
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + m); };
let [s, v] = await post("solo", { name: "Auny" }); const me = v.id;
ok(s === 200 && v.phase === "seed" && v.n === 5 && v.starter === true, "solo: seed phase, I am the starter");
[s, v] = await post("seed", { id: me, text: "short" }); ok(s === 400, "seed too short refused");
const SEED = "Priya said the landlord is raising rent by $75 in March for the two street-facing units.";
[s, v] = await post("seed", { id: me, text: SEED });
ok(s === 200, "seed accepted -> phase " + v.phase + " hop " + v.hop);
// four gossips pass in one settle: the chain comes straight back to reveal or recall
ok(v.phase === "reveal", "with four gossips after me the whole line runs and reveals (no human receiver, so no recall round)");
ok(v.chains.length === 1, "exactly one chain");
ok(v.chains[0].versions.length === 5 && v.chains[0].versions[0].text === SEED, "5 versions, the first is MY sentence verbatim");
ok(v.chains[0].versions.slice(1).every(x => x.bot && x.text.length > 3), "four bot versions follow, none empty");
const chain = v.chains[0].versions.map(x => x.by).join(" > "); console.log("     line:", chain);
ok(new Set(v.chains[0].versions.map(x => x.by)).size === 5, "every seat touched it exactly once");
[s, v] = await post("narrate", { id: me, chain: 0, facts: "Original: " + SEED + "\nFinal: " + v.chains[0].versions[4].text });
ok(s === 200 && (v.text || v.fallback), "narration or honest fallback");
[s, v] = await post("again", { id: me }); ok(v.phase === "lobby", "again -> lobby");
// two humans: the second one receives and gets a recall round
[s, v] = await post("join", { name: "Kaleb" }); const kal = v.id; ok(s === 200, "second human joins");
[s, v] = await post("start", { id: me }); ok(v.phase === "seed" && v.starter, "host starts, host seeds");
let [s2, v2] = await post("seed", { id: kal, text: SEED }); ok(s2 === 400, "non-starter cannot seed");
[s, v] = await post("seed", { id: me, text: SEED });
ok(v.phase === "play" || v.phase === "recall", "chain moving: " + v.phase + " hop " + v.hop);
let guard = 0; v2 = await get(kal);
while (v2.phase === "play" && guard++ < 10) { if (v2.task && !v2.task.passed) { ok(typeof v2.task.text === "string", "Kaleb is handed one version from " + v2.task.from); [s2, v2] = await post("pass", { id: kal, text: "I heard the rent is going up seventy five bucks" }); } else { await new Promise(r => setTimeout(r, 400)); v2 = await get(kal); } }
ok(v2.phase === "recall" && v2.recall && v2.recall.done === false, "Kaleb (a receiver) gets the recall round");
v = await get(me); ok(v.phase === "recall" && v.recall.done === true, "starter is already done with recall (nothing reached them)");
[s2, v2] = await post("recall", { id: kal, text: "Priya said rent up $75 in March" });
ok(v2.phase === "reveal" && v2.memory.length === 1 && v2.memory[0].name === "Kaleb" && v2.memory[0].target, "reveal: memory test for Kaleb only, with the text he was handed");
ok(v2.chains[0].versions[0].text === SEED, "the original is still the starter's sentence verbatim");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
