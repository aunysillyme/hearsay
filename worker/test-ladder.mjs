const BASE = process.argv[2] || "https://hearsay-room.aunysillyme.workers.dev";
const code = "L" + Math.random().toString(36).slice(2, 8).toUpperCase();
const post = async (act, body) => { const r = await fetch(`${BASE}/room/${code}/${act}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + m); };
let [s, v] = await post("solo", { name: "Auny" }); const me = v.id;
[s, v] = await post("ladder", { id: me });
ok(s === 200 && v.phase === "ladder" && v.ladder.level === 1 && typeof v.ladder.sentence === "string", "ladder opens at level 1 with a sentence: " + v.ladder.sentence);
ok(v.ladder.secs >= 4 && v.ladder.secs <= 10, "glance " + v.ladder.secs + "s");
ok(v.ladder.board.length === 5, "board has all 5 seats");
[s, v] = await post("close", { id: me }); ok(s === 400, "close before 45s refused");
const exact = v.ladder ? null : null;
let lvl = 1, sent = (await post("answer", { id: me, text: "" }))[1]; // empty answer scores 0 -> ends ladder
ok(sent.ladder.over === true && sent.ladder.last.results.find(x => x.name === "Auny").score === 0, "a blank answer scores 0 and ends the ladder");
[s, v] = await post("ladder", { id: me }); ok(s === 200 && v.ladder.level === 1 && !v.ladder.over, "ladder restarts from over");
let climbed = 0;
for (let i = 0; i < 12 && v.ladder && !v.ladder.over; i++) {
  const target = v.ladder.sentence;
  [s, v] = await post("answer", { id: me, text: target });
  ok(s === 200, "exact answer at level " + (i + 1) + " -> " + (v.ladder.over ? "over" : "level " + v.ladder.level));
  climbed++;
}
ok(v.ladder.over && v.ladder.level === 12, "exact answers climb to the cap (12)");
const meRow = v.ladder.board.find(b => b.name === "Auny");
ok(meRow && meRow.total === 1200 && meRow.reached === 12, "perfect total 1200, reached 12: " + JSON.stringify(meRow));
const bots = v.ladder.last.results.filter(x => x.bot);
ok(bots.length === 4 && bots.every(b => b.score < 100), "bots answered and none is perfect at level 12: " + bots.map(b => b.name + ":" + b.score).join(" "));
ok(v.ladder.board[0].name === "Auny", "human tops the board");
[s, v] = await post("answer", { id: me, text: "late" }); ok(s === 400, "answer after over refused");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
