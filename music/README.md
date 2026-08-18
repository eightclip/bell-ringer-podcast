# Music

Drop MP3s into `_inbox/` and run:

```bash
npm run music
```

It measures each track (LUFS, loudness range, spectral centroid) and files it
as a **theme**, **sting**, or **bed** by what it actually sounds like rather
than by filename. Re-run `npm run assemble <show> <week>` to hear a change —
nothing else needs touching.

Target **3–5 themes, 6–10 stings, 4–8 beds**. With one of each, the same button
plays five mornings running.

## Placing it

Tracks are half of it. Where the music goes is the other half, and that lives
in the script rather than in config:

```
And the ground is quietly getting out of the way.

[MUSIC in]

He spent four years on it. Four years, by hand, on a planet
that would not fit a circle.

[MUSIC out]

So. What actually happens if you throw hard enough?

[PAUSE 3s]
```

`[MUSIC in]` and `[MUSIC out]` go on their own line between paragraphs. The bed
fades up over two seconds and down over two and a half, so place a cue a beat
*before* the line it supports — the music should already be there when the line
arrives. `pipeline/script.mjs` teaches the writer the editorial rules; the short
version is: default to silence, music under story and never under mechanism,
and cut it before the reveal so the reveal lands in the clear.

`npm run voice` prints where each cue landed (`music: in@0:34 out@1:16`) so you
can check it went where you meant.

Two rules:

- **No lead vocals.** A voice under a voice is unlistenable.
- **Nothing here is committed.** `*.mp3` is gitignored. Your production-music
  licence almost certainly permits use in the show and not redistribution from
  a public repo.

Blue Dot Sessions is free, CC-licensed, and close to the intended sound.

The pipeline renders with silent breaks of the correct length if these folders
are empty, so timing stays right and you can add music later.
