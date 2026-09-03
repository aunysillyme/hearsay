// Drives a solo game end to end against the deployed worker and asserts the
// blindness rule, hop advancement, bot fallbacks and the reveal shape.
const BASE = process.argv[2] || "https://hearsay-room.aunysillyme.workers.dev";
const code = "T" + Math.random().toString(36).slice(2, 8).toUpperCase();
const post = async (act, body) => { const r = await fetch(`${BASE}/room/${code}/${act}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };
const get = async (me) => (await fetch(`${BASE}/room/${code}?me=${me || ""}`)).json();
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + m); };

let [s, v] = await post("solo", { name: "Auny" });
ok(s === 200 && v.id, "solo creates a room and returns an id");
const me = v.id;
ok(v.phase === "seed" && v.n === 5, "solo: 5 seats, seed phase");
ok(v.players.filter(p => p.bot).length === 4, "4 gossips seated");
ok(v.seeded === false, "human has not seeded");
[s, v] = await post("seed", { id: me, text: "short" });
ok(s === 400, "seed too short is refused with 400");
[s, v] = await post("pass", { id: me, text: "nope" });
ok(s === 400, "pass during seed refused");
[s, v] = await post("seed", { id: me, text: "Priya said the landlord is raising rent by $75 in March for the two street-facing units." });
ok(s === 200 && v.phase === "play" && v.hop === 1, "seed accepted, play opens at hop 1");
ok(v.task && typeof v.task.text === "string" && v.task.passed === false, "human holds exactly one text at hop 1");
ok(!v.chains, "blindness: no chains in the play view");
const stranger = await get("nobody");
ok(!stranger.task && !stranger.chains, "stranger sees no task and no chains");
let hops = 0;
while (v.phase === "play" && hops < 10) {
  hops++;
  const seen = v.task.text;
  [s, v] = await post("pass", { id: me, text: "I heard " + seen.slice(0, 60) + " and it was huge." });
  ok(s === 200, "pass at hop " + hops + " accepted -> phase " + v.phase + " hop " + v.hop);
  [s, v] = [s, await get(me)];
}
ok(v.phase === "reveal", "reached reveal after " + hops + " human passes");
ok(v.chains && v.chains.length === 5, "5 chains revealed");
ok(v.chains.every(c => c.versions.length === 5), "every chain has 5 versions (seed + 4 hops)");
const bots = v.chains.flatMap(c => c.versions.filter(x => x.bot));
ok(bots.length === 20, "20 bot-authored versions (4 seeds + 16 passes), got " + bots.length);
ok(bots.every(b => b.text && b.text.length >= 3), "no empty bot version");
const ai = bots.filter(b => b.model === "workers-ai").length;
console.log("     workers-ai:", ai, "fallback:", bots.length - ai);
const byName = {}; v.chains.forEach(c => c.versions.forEach((x, i) => { if (i) byName[x.by] = (byName[x.by] || 0) + 1; }));
ok(Object.values(byName).every(n => n === 4), "each player passed exactly 4 times " + JSON.stringify(byName));
[s, v] = await post("narrate", { id: me, chain: 0, facts: "Original: " + v.chains[0].versions[0].text + "\nFinal: " + v.chains[0].versions[4].text + "\nHop 1 by " + v.chains[0].versions[1].by + ": dropped [landlord], added [huge]" });
ok(s === 200 && (v.text || v.fallback), "narrate returns text or an honest fallback: " + (v.text || "(fallback)").slice(0, 80));
[s, v] = await post("again", { id: me });
ok(s === 200 && v.phase === "lobby", "again returns the room to lobby");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
