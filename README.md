# hearsay

**A rumor's chain of custody.** Pass a message down the line. Everyone gets one look at what reached them, then retells it from memory. At the end every version is laid out, every change is tagged exaggerated, dropped or invented, and each one is pinned to the person who made it.

Built live for Camp AI, Season 2 Episode 8 ("Rumor Mill").

- Live: https://aunysillyme.github.io/hearsay/
- Room worker: `hearsay-room.aunysillyme.workers.dev` (Cloudflare Worker + one SQLite-backed Durable Object per room, under `worker/`)

## How it works

1. One person starts a rumor. In a room of N, everyone starts one, and every rumor visits everyone else once (round robin), so nobody sits idle.
2. The version that reached you shows for twelve seconds, then it is gone. Pasting is off. The room only ever hands you the single version that reached you; the chain is built per player on the server, so the client cannot see it.
3. When every rumor has done the full lap, the record opens: original beside final, per-hop word diff (mechanical, LCS-based, so it cannot hallucinate), each hop tagged exaggerated / dropped / invented, fidelity per hop, the hop that bent it most, and a per-player ledger with a verdict.
4. Four gossips with known habits (Mo exaggerates, Dee forgets, Fabi fabricates, Sal nearly gets it right, Rae shifts blame) fill empty chairs, on Workers AI with a mechanical fallback in the same direction. A closing "gossip columnist" line is narrated by the model from the diff's facts only.

## Run it

```
cd worker && npx wrangler deploy
node worker/test-solo.mjs            # end-to-end against the deployed worker
```

The frontend is one self-contained HTML file. No build step, no dependencies.
