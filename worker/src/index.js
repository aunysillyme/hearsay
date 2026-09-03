/* hearsay - the room worker.

   One Durable Object per room, addressed by name, so idFromName(CODE) is the
   whole room system. No database, no schema.

   The rule that matters lives HERE: a player is only ever handed the single
   version that reached them. The view is built per player, so the client
   cannot see the chain even if it wanted to. The reveal is the only time the
   full record leaves the room. */

const MAX_PLAYERS = 6;
const MAX_TEXT = 500;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", ...CORS },
  });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const p = url.pathname.split("/").filter(Boolean);
    if (p[0] === "room" && p[1]) {
      const code = p[1].toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      if (!code) return json({ error: "No room." }, 400);
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      return stub.fetch(
        new Request("https://room/" + code + "/" + (p[2] || "") + url.search, {
          method: req.method,
          body: req.method === "POST" ? req.body : undefined,
          headers: req.headers,
        })
      );
    }
    return json({ error: "Not found." }, 404);
  },
};

/* The gossips. Each one bends a message a known way, so a solo player still
   gets a chain with every mutation class in it. */
const BOTS = [
  { name: "Mo", persona: "embellisher", bio: "makes it bigger", prompt: "You exaggerate. Make at least one number or quantity larger, and add one dramatic word. Keep everything else." },
  { name: "Dee", persona: "forgetful", bio: "loses a detail", prompt: "You are forgetful. Leave out one or two specific details (a name, a number, a place, a time). Do not add anything." },
  { name: "Fabi", persona: "fabricator", bio: "adds what was never said", prompt: "You add exactly one plausible detail that was never in the message, stated as fact. Keep the rest." },
  { name: "Sal", persona: "faithful", bio: "nearly gets it right", prompt: "You try to repeat it exactly, but you misremember one small thing: a number off by a little, or a name slightly wrong." },
  { name: "Rae", persona: "spinner", bio: "shifts the blame", prompt: "You change who did it or who said it, so a different person gets the credit or the blame. Keep the rest." },
];

const SEEDS = [
  "Priya said the landlord is raising rent by $75 in March, but only for the two units facing the street.",
  "Marcus saw three raccoons get into the office kitchen on Tuesday and eat the entire tray of samosas.",
  "The CEO's flight got diverted to Denver, so the all-hands is moving to Thursday at 2pm.",
  "Jordan's cousin got a small part in a Netflix show, filming in Atlanta for six weeks starting in May.",
  "The coffee machine on floor 3 is being replaced next Monday with one that only takes cards.",
  "Sam ran the 10K in 52 minutes and finished 40th out of 300 runners.",
  "Lena's dog ate half a birthday cake at the party and was completely fine by the next morning.",
  "The bakery on 5th is closing for two weeks in July because the owner is getting married in Portugal.",
];

const INTENSIFIERS = ["apparently", "literally", "honestly", "basically"];

/* Mechanical fallback: if the model is down, a bot still bends the message in
   its own direction. Deterministic-ish, never empty, never identical. */
function mutate(text, persona, seed) {
  const words = text.split(/\s+/);
  const pick = (n) => Math.abs(seed) % Math.max(1, n);
  if (persona === "embellisher") {
    let done = false;
    const out = text.replace(/\d+/, (m) => { done = true; return String(Math.round(Number(m) * 3)); });
    return (done ? out : "Everyone is saying " + text.charAt(0).toLowerCase() + text.slice(1)) + " Huge.";
  }
  if (persona === "forgetful") {
    const parts = text.split(/,\s*/);
    if (parts.length > 1) return parts.slice(0, -1).join(", ").replace(/[,;]\s*$/, "") + ".";
    if (words.length > 6) { words.splice(2 + pick(words.length - 4), 2); return words.join(" "); }
    return words.slice(0, -1).join(" ") + ".";
  }
  if (persona === "fabricator") {
    const adds = ["and someone said the police were called.", "and it was all over the group chat.", "and it happened right after the meeting.", "and there is apparently a video of it."];
    return text.replace(/[.!?]\s*$/, "") + ", " + adds[pick(adds.length)];
  }
  if (persona === "spinner") {
    const names = ["Jordan", "Alex", "the manager", "someone from HR"];
    const m = text.match(/\b[A-Z][a-z]+\b/);
    if (m) return text.replace(m[0], names[pick(names.length)]);
    return "I heard from Alex that " + text.charAt(0).toLowerCase() + text.slice(1);
  }
  // faithful
  return text.replace(/\d+/, (m) => String(Number(m) + 1 + pick(3))).replace(/\bsaid\b/, "told me");
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  blank(code) {
    return { code, players: [], phase: "lobby", chains: [], hop: 0, narr: {}, game: 0, createdAt: Date.now() };
  }

  async fetch(req) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const code = parts[0];
    const act = parts[1] || "";

    if (req.method === "GET") {
      const r = (await this.state.storage.get("r")) || this.blank(code);
      return json(this.view(r, url.searchParams.get("me")));
    }

    let body = {};
    try { body = await req.json(); } catch (e) { body = {}; }

    let out;
    await this.state.blockConcurrencyWhile(async () => {
      const r = (await this.state.storage.get("r")) || this.blank(code);
      out = await this.act(r, act, body);
      if (!out.error) await this.state.storage.put("r", r);
    });
    return json(out, out.error ? 400 : 200);
  }

  clean(t) {
    return String(t || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }

  holder(r, c, h) {
    return (c + h) % r.players.length;
  }

  async act(r, act, body) {
    const me = body.id ? r.players.findIndex((p) => p.id === body.id) : -1;

    if (act === "join") {
      const name = this.clean(body.name).slice(0, 24);
      if (!name) return { error: "Say who you are." };
      if (r.phase !== "lobby") return { error: "That game already started. Wait for the reveal, or start a new room." };
      if (r.players.length >= MAX_PLAYERS) return { error: "Room is full (" + MAX_PLAYERS + ")." };
      if (r.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { error: "Someone here already has that name." };
      const id = crypto.randomUUID();
      r.players.push({ id, name, bot: false, joinedAt: Date.now() });
      return { id, ...this.view(r, id) };
    }

    if (act === "bot") {
      if (r.phase !== "lobby") return { error: "Game already started." };
      if (r.players.length >= MAX_PLAYERS) return { error: "Room is full." };
      const used = new Set(r.players.filter((p) => p.bot).map((p) => p.persona));
      const b = BOTS.find((x) => !used.has(x.persona));
      if (!b) return { error: "All five gossips are already here." };
      r.players.push({ id: crypto.randomUUID(), name: b.name, bot: true, persona: b.persona, bio: b.bio, joinedAt: Date.now() });
      return this.view(r, body.id);
    }

    if (act === "solo") {
      const name = this.clean(body.name).slice(0, 24) || "You";
      if (r.players.length) return { error: "Room already in use." };
      const id = crypto.randomUUID();
      r.players.push({ id, name, bot: false, joinedAt: Date.now() });
      for (const b of BOTS.slice(0, 4)) r.players.push({ id: crypto.randomUUID(), name: b.name, bot: true, persona: b.persona, bio: b.bio, joinedAt: Date.now() });
      this.begin(r);
      return { id, ...this.view(r, id) };
    }

    if (me < 0) return { error: "You are not in this room." };

    if (act === "start") {
      if (r.phase !== "lobby") return { error: "Already started." };
      if (r.players.length < 3) return { error: "Need at least 3 in the room. Add a gossip if you are short." };
      this.begin(r);
      return this.view(r, body.id);
    }

    if (act === "seed") {
      if (r.phase !== "seed") return { error: "Not the time to start a rumor." };
      const text = this.clean(body.text);
      if (text.length < 8) return { error: "Give the rumor some substance. A name, a number, a place." };
      if (r.chains[me].versions.length) return { error: "You already started yours." };
      r.chains[me].versions.push({ by: me, text, at: Date.now() });
      await this.settle(r);
      return this.view(r, body.id);
    }

    if (act === "pass") {
      if (r.phase !== "play") return { error: "Nothing to pass right now." };
      const c = r.chains.findIndex((ch, i) => this.holder(r, i, r.hop) === me);
      if (c < 0) return { error: "You are not holding anything." };
      if (r.chains[c].versions.length !== r.hop) return { error: "You already passed this one on." };
      const text = this.clean(body.text);
      if (text.length < 3) return { error: "Say something. Even a mangled version counts." };
      r.chains[c].versions.push({ by: me, text, at: Date.now() });
      await this.settle(r);
      return this.view(r, body.id);
    }

    if (act === "recall") {
      if (r.phase !== "recall") return { error: "Not the time for the memory test." };
      if (r.players[me].bot) return { error: "Gossips do not sit the test." };
      if (r.recall[me]) return { error: "You already answered." };
      const text = this.clean(body.text);
      if (text.length < 3) return { error: "Whatever you remember. Even a fragment counts." };
      r.recall[me] = { text, at: Date.now() };
      const humans = r.players.map((p, i) => i).filter((i) => !r.players[i].bot);
      if (humans.every((i) => r.recall[i])) { r.phase = "reveal"; r.revealedAt = Date.now(); }
      return this.view(r, body.id);
    }

    if (act === "narrate") {
      if (r.phase !== "reveal") return { error: "Nothing to narrate yet." };
      const c = Number(body.chain);
      if (!(c >= 0 && c < r.chains.length)) return { error: "No such chain." };
      if (r.narr[c]) return { chain: c, text: r.narr[c] };
      const facts = this.clean(body.facts).slice(0, 1800);
      let text = "";
      if (this.env.AI && facts) {
        try {
          const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
            messages: [
              { role: "system", content: "You are a gossip columnist closing a report on how a rumor changed hands. Write exactly two short sentences. Sentence one: the single biggest change and who made it. Sentence two: what the group now believes that was never in the original. Use ONLY the listed facts, quote the exact words, never add a fact that is not listed." },
              { role: "user", content: facts },
            ],
            max_tokens: 160,
          });
          text = res && typeof res.response === "string" ? res.response.trim().replace(/^["']|["']$/g, "") : "";
        } catch (e) { text = ""; }
      }
      if (!text) return { chain: c, text: "", fallback: true };
      r.narr[c] = text.slice(0, 600);
      return { chain: c, text: r.narr[c] };
    }

    if (act === "again") {
      if (r.phase !== "reveal") return { error: "Finish this one first." };
      r.phase = "lobby"; r.chains = []; r.hop = 0; r.narr = {}; r.recall = {}; r.game++;
      return this.view(r, body.id);
    }

    return { error: "Unknown action." };
  }

  begin(r) {
    // Shuffle seating so the same human is not always followed by the same bot.
    r.players.sort(() => Math.random() - 0.5);
    r.phase = "seed";
    r.hop = 0;
    r.narr = {};
    r.recall = {};
    r.chains = r.players.map((p, i) => ({ seedBy: i, versions: [] }));
    const used = new Set();
    r.players.forEach((p, i) => {
      if (p.bot) {
        let s; do { s = SEEDS[Math.floor(Math.random() * SEEDS.length)]; } while (used.has(s) && used.size < SEEDS.length);
        used.add(s);
        r.chains[i].versions.push({ by: i, text: s, at: Date.now() });
      }
    });
    r.startedAt = Date.now();
  }

  /* Advance hops while every chain has caught up, and let bots take their turn
     whenever a hop opens. A human holds exactly one chain per hop, so bots can
     never finish a hop on their own; this always returns quickly. */
  async settle(r) {
    const N = r.players.length;
    for (let guard = 0; guard < N + 2; guard++) {
      const allIn = r.chains.every((ch) => ch.versions.length >= r.hop + 1);
      if (allIn) {
        if (r.phase === "seed") r.phase = "play";
        r.hop++;
        if (r.hop >= N) {
          r.recall = r.recall || {};
          if (r.players.some((p) => !p.bot)) { r.phase = "recall"; r.recallAt = Date.now(); }
          else { r.phase = "reveal"; r.revealedAt = Date.now(); }
          return;
        }
      }
      const jobs = [];
      r.chains.forEach((ch, c) => {
        const h = this.holder(r, c, r.hop);
        if (r.players[h].bot && ch.versions.length === r.hop) jobs.push(this.botPass(r, c, h));
      });
      if (!jobs.length && !allIn) return;
      await Promise.all(jobs);
      if (!jobs.length) {
        // hop advanced but nothing for bots to do: humans are up.
        return;
      }
    }
  }

  async botPass(r, c, h) {
    const bot = r.players[h];
    const prev = r.chains[c].versions[r.hop - 1].text;
    const spec = BOTS.find((b) => b.persona === bot.persona) || BOTS[3];
    let text = "";
    if (this.env.AI) {
      try {
        const res = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
          messages: [
            { role: "system", content: "You are playing a telephone game. You heard a message once and are now repeating it to the next person from memory. " + spec.prompt + " Reply with ONLY the retold message, one to two sentences, no quotes, no preamble." },
            { role: "user", content: prev },
          ],
          max_tokens: 120,
        });
        text = res && typeof res.response === "string" ? res.response.trim() : "";
        text = text.replace(/^["'“]+|["'”]+$/g, "").replace(/^(here'?s?|sure|okay)[^:]*:\s*/i, "").trim();
      } catch (e) { text = ""; }
    }
    const same = text.replace(/\W+/g, "").toLowerCase() === prev.replace(/\W+/g, "").toLowerCase();
    if (!text || text.length > MAX_TEXT || same || text.length < 8) {
      text = mutate(prev, bot.persona, c * 7 + r.hop * 13 + h);
      if (text.replace(/\W+/g, "").toLowerCase() === prev.replace(/\W+/g, "").toLowerCase()) text = "I think " + text.charAt(0).toLowerCase() + text.slice(1);
    }
    r.chains[c].versions.push({ by: h, text: this.clean(text), at: Date.now(), bot: true, model: same || !text ? "fallback" : "workers-ai" });
  }

  /* The per-player view. Everything a client is allowed to know, and nothing
     else: during play, only the one version that reached you. */
  view(r, me) {
    const N = r.players.length;
    const mi = me ? r.players.findIndex((p) => p.id === me) : -1;
    const players = r.players.map((p, i) => {
      let done = null;
      if (r.phase === "seed") done = r.chains[i].versions.length > 0;
      if (r.phase === "play") {
        const c = r.chains.findIndex((ch, ci) => this.holder(r, ci, r.hop) === i);
        done = c >= 0 ? r.chains[c].versions.length > r.hop : null;
      }
      return { name: p.name, bot: p.bot, bio: p.bio || null, done, me: i === mi };
    });
    const v = { code: r.code, phase: r.phase, hop: r.hop, hops: Math.max(0, N - 1), n: N, game: r.game, players, me: mi, host: mi === 0 || (mi >= 0 && !r.players.some((p, i) => !p.bot && i < mi)) };
    if (mi >= 0 && r.phase === "seed") v.seeded = r.chains[mi].versions.length > 0;
    if (mi >= 0 && r.phase === "play") {
      const c = r.chains.findIndex((ch, ci) => this.holder(r, ci, r.hop) === mi);
      if (c >= 0) {
        const ch = r.chains[c];
        const passed = ch.versions.length > r.hop;
        const last = ch.versions[r.hop - 1];
        v.task = { chain: c, passed, from: r.players[last.by].name, text: passed ? null : last.text };
      }
    }
    if (r.phase === "recall") {
      const humans = r.players.map((p, i) => i).filter((i) => !r.players[i].bot);
      v.recall = { done: mi >= 0 && !!(r.recall || {})[mi], pending: humans.filter((i) => !(r.recall || {})[i]).map((i) => r.players[i].name) };
      players.forEach((p, i) => { p.done = r.players[i].bot ? null : !!(r.recall || {})[i]; });
    }
    if (r.phase === "reveal") {
      v.memory = r.players.map((p, i) => {
        if (p.bot) return null;
        const c = r.chains.findIndex((ch, ci) => this.holder(r, ci, 1) === i);
        const target = c >= 0 && r.chains[c].versions[0] ? r.chains[c].versions[0].text : null;
        const rec = (r.recall || {})[i];
        return { name: p.name, target, from: c >= 0 ? r.players[r.chains[c].seedBy].name : null, said: rec ? rec.text : null, gapMs: rec && r.startedAt ? rec.at - r.startedAt : null };
      }).filter(Boolean);
      v.chains = r.chains.map((ch, c) => ({
        chain: c,
        seedBy: r.players[ch.seedBy].name,
        versions: ch.versions.map((x) => ({ by: r.players[x.by].name, bot: !!r.players[x.by].bot, text: x.text, model: x.model || null })),
        narration: r.narr[c] || null,
      }));
      v.startedAt = r.startedAt; v.revealedAt = r.revealedAt;
    }
    return v;
  }
}
