# Fonts, music, and images

## What ships in this repo

| Asset | Licence | Redistributable |
|---|---|---|
| `assets/fonts/Anton-Regular.ttf` | SIL OFL 1.1 | yes |
| `assets/fonts/ArchivoBlack-Regular.ttf` | SIL OFL 1.1 | yes |
| `site/public/fonts/Rokkitt-*.woff2` | SIL OFL 1.1 | yes |
| Music | — | **none bundled** |
| Cover photography | — | **none bundled** |

Everything here is OFL on purpose, so a fresh clone renders correctly without
anyone having to buy anything.

## Swapping the typefaces

There are two independent surfaces. Changing one does not change the other.

### A. Cover artwork — rendered by ImageMagick

Needs a real `.ttf` or `.otf` file.

1. Drop the file in `assets/fonts/`.
2. Point `ART.titleFont` at it in `config/show.mjs`, with anything you'd accept
   as a substitute in `ART.fallbackFonts`:

   ```js
   titleFont: 'YourFace-Bold.ttf',
   fallbackFonts: ['Anton-Regular.ttf', 'ArchivoBlack-Regular.ttf'],
   ```

3. `npm run cover && npm run art <show> <week>` to see it.

`pipeline/art.mjs` walks that list and uses the first file that exists, so a
wrong filename degrades to the fallback instead of crashing. Type is fitted to a
box rather than set at a fixed point size, so a much wider or narrower face
still fits — that is what makes this swap safe.

### B. The website — three CSS variables

Needs `.woff2`.

1. Drop the files in `site/public/fonts/`.
2. In `site/app/globals.css`, replace the `@font-face` blocks at the top.
3. Point the three variables in `:root` at the new family names:

   ```css
   --font-display: 'Your Display';  /* wordmark + headings */
   --font-label:   'Your Label';    /* small letterspaced eyebrows */
   --font-body:    'Your Body';     /* everything else */
   ```

Every rule in the stylesheet reads those variables — no family name is hardcoded
anywhere else — so those three lines are the whole change. Set all three to the
same family if you only want one.

Good sources: [Google Fonts](https://fonts.google.com) (all OFL),
[Fontsource](https://fontsource.org) (npm-installable, OFL), and
[Velvetyne](https://velvetyne.fr) or [Collletttivo](https://www.collletttivo.it)
for open display faces with more character than the Google defaults.

### Licensing, whichever you pick

**Only commit a font you are allowed to redistribute.** A public repo *is*
redistribution, and most commercial EULAs prohibit it — webfont licences are
frequently domain-scoped and do not survive someone forking you. If the face is
licensed, add it to `.gitignore` and name it in the README as something the user
supplies.

If it is open, ship its licence file alongside it (`OFL.txt` for SIL fonts).
OFL 1.1 §2 accepts the notice in the font's own metadata *or* as a text file;
the metadata is there but is Brotli-compressed inside a `.woff2` and needs a
library to read, so the text file is the unambiguous version. Every Google Fonts
download includes one.

## Music

`music/{theme,sting,bed}/` is empty and gitignored. Drop MP3s in, then:

```bash
npm run music     # measures LUFS, loudness range, spectral centroid; sorts by role
```

It sorts by measurement rather than by filename, so tracks land in the right
slot without you tagging them.

Aim for **3–5 themes, 6–10 stings, 4–8 beds**. With one of each, the same
button plays five mornings running and the show starts to feel automated.

Two things worth knowing:

- **Avoid anything with a lead vocal.** A voice under a voice is unlistenable.
- **Do not commit the audio.** `*.mp3` is gitignored. A production-music
  subscription licenses you to *use* tracks in your show, essentially never to
  redistribute the source files from a public repository.

Blue Dot Sessions is free, CC-licensed, and close to the intended sound.

## Cover photography

With `UNSPLASH_ACCESS_KEY` set, `npm run art` pulls a source photo and applies
a duotone. Unsplash requires photographer attribution — the pipeline records it
and writes it into the episode notes automatically. Generated covers are
gitignored.

Episode art deliberately carries no type: a podcast app already prints the
title next to it, so a slab of display face over the top just covers the thing
worth looking at.
