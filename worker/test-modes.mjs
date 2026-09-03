const BASE = "https://hearsay-room.aunysillyme.workers.dev";
const code = "M" + Math.random().toString(36).slice(2, 8).toUpperCase();
const post = async (act, body) => { const r = await fetch(`${BASE}/room/${code}/${act}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + m); };
let [s, v] = await post("solo", { name: "Auny", ladder: true }); const me = v.id;
ok(v.phase === "lobby", "ladder-solo room waits in the lobby for a mode");
[s, v] = await post("join", { name: "Kaleb" }); ok(s === 200, "a second human joins"); const kal = v.id;
// solo: only me plays, others watch
[s, v] = await post("ladder", { id: me, mode: "solo" });
ok(s === 200 && v.ladder.mode === "solo" && v.ladder.participants.length === 1 && v.ladder.playing, "solo: one participant, I am playing");
let [s2, v2] = await post("answer", { id: kal, text: "x" }); ok(s2 === 400 && /watching/.test(v2.error), "spectator cannot answer");
[s, v] = await post("answer", { id: me, text: v.ladder.sentence }); ok(v.ladder.level === 2 && v.ladder.board.length === 1, "solo climbs, board has only me");
[s, v] = await post("answer", { id: me, text: "" }); ok(v.ladder.over, "solo ends on a miss");
// duel vs Kaleb
[s, v] = await post("ladder", { id: me, mode: "duel", opponent: "Kaleb" });
ok(s === 200 && v.ladder.mode === "duel" && v.ladder.participants.join() === "Auny,Kaleb", "duel: two participants");
[s, v] = await post("answer", { id: me, text: v.ladder.sentence });
ok(v.ladder.pending.includes("Kaleb") && v.ladder.level === 1, "duel waits for the opponent");
[s2, v2] = await post("answer", { id: kal, text: "nothing much" });
ok(v2.ladder.level === 2 && v2.ladder.last.roundWinner === "Auny" && v2.ladder.board[0].wins === 1, "round goes to the exact answer, wins tallied");
let guard = 0; while (!v2.ladder.over && guard++ < 10) { const sen = (await post("answer", { id: me, text: "" }))[1]; const k = await post("answer", { id: kal, text: "" }); v2 = k[1]; }
ok(v2.ladder.over, "duel ends when both miss");
// duel vs a gossip
[s, v] = await post("ladder", { id: me, mode: "duel", opponent: "Sal" });
ok(s === 200 && v.ladder.participants.join() === "Auny,Sal", "duel vs a gossip");
[s, v] = await post("answer", { id: me, text: v.ladder.sentence }); ok(v.ladder.level === 2 && v.ladder.last.results.length === 2, "gossip answered instantly, round scored");
let g2 = 0; while (!v.ladder.over && g2++ < 10) [s, v] = await post("answer", { id: me, text: "" });
ok(v.ladder.over, "duel vs gossip ends once the human keeps missing (gossip alone cannot carry it past the cap)");
// group
[s, v] = await post("ladder", { id: me, mode: "group" });
ok(v.ladder.participants.length === 6, "group: all six");
[s, v] = await post("ladder", { id: me, mode: "duel", opponent: "Nobody" }); ok(s === 400, "bad opponent refused");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
