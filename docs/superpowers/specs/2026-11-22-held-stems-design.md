# Held stems: ten slots on keys 1 to 0

Status: approved in conversation (Elling, 2026-11-22), building on branch `held-stems` (off
`better-picks`). Desktop app only for now; the web radio and the phone are not in this.

Elling: "a way to quickly add some very straightforward loops ... like a kick snare ... hihats
... a few slots ... keys 1 to 0 ... where you could hold a stem there and it would be integrated
at a natural position when the key is pressed"; "a quick way to save them to those keys in
discover and radio when they show up. like 'oh that would be a great one to use i'll assign it to
5 right now'".

## What it is

- **Ten slots**, keys `1`..`9`, `0`. Each holds one stem (a Discover candidate). Saved with the
  app (Discover's settings), not the project, so they are there every session.
- **A strip of ten tiles** in Discover and radio: the number, and the stem's name when filled.
- **Assign:** hover a row that has a stem and press shift + the number. A filled slot is replaced.
  A tile's own small control clears it.
- **Play:** press the number (or click the tile). The stem joins as its own **extra row**.
  Pressed while a row is already playing that stem: that row leaves instead.
- **When:** with radio running, on the **next bar line**; Cmd + the number (or Cmd-click) is at
  once. With radio off, at once, as duplicating a row is.
- **After it lands it is an ordinary row** (Elling: "it should get phased out by the system
  naturally too, it can have a life of its own when it is added"): radio may turn its stem over
  and the arc may thin it. It arrives at its levelled gain, and the other picks' key and balance
  terms see it like any row.

## Not in this

The web radio, the phone remote, a starter set of loops, slots saved per project.

## Testing

Pure logic (key to slot, assign, clear, which row holds a stem, the stored shape's normalising)
is unit tested in `src/shared`. The keys, the strip and the landing are Elling's to try.
