# Record-Mode VU Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live-recording waveform overlay in `ChannelRow.tsx` (both manual/armed and gated recording) with a two-line stereo VU meter — thin horizontal bars showing real, live per-channel input level (log/dB scale, peak-hold-and-decay), appearing at full size the instant a channel arms rather than growing over time.

**Architecture:** `LoopRecorder`/`GatedLoopRecorder` each gain a lock-free `currentPeakL()`/`currentPeakR()` pair reflecting the peak of whatever was captured in the MOST RECENT `writeBlock()` call (not a growing history) — replacing the old bucket-array mechanisms (`peaksFixedWindow`, `peaks(128)` + its incremental cache) entirely, since a live meter needs "right now," not history. `IpcServer.cpp`'s existing 30Hz timer pushes the new two-float payload instead of an array. `ChannelRow.tsx` replaces both overlay blocks with one shared meter renderer, converting linear peaks to dB and applying peak-hold-and-decay ballistics client-side.

**Tech Stack:** C++/JUCE (native-engine), TypeScript/React (renderer), existing local-socket JSON IPC.

---

## Read before starting

- `docs/superpowers/specs/2026-08-15-record-mode-vu-meter-design.md` — the approved design this plan implements.
- Root `CLAUDE.md`'s native-engine rebuild instructions — after every native-engine change in this plan, rebuild (`cmake --build build` from `native-engine/`) and **fully quit and relaunch** the Electron app before manually testing. A renderer reload is not enough.

## Working directly on master, no worktree

Matches this session's established convention for every prior task tonight, including native work of comparable scope (the plugin-state-persistence plan). No worktree.

## Important note on `GatedLoopRecorder`'s existing caching

`GatedLoopRecorder::peaks(int)` has an incremental bucket-dirty-tracking cache (`cachedPeaks`/`dirtyBuckets`/`computeBucketPeak`/`markBucketsDirty`) that was built specifically to fix a real, previously-shipped bug: an earlier version rescanned the whole buffer on every 30Hz poll while holding the same lock the audio thread needs every callback, causing audible dropouts (documented in that method's own doc comment). This plan **removes `peaks()` and its entire caching subsystem outright** — not just stops calling it — because its ONLY caller (`IpcServer.cpp`'s `gated-recording-update` push) is being replaced by a completely different, much simpler mechanism (Task 2 below) that never scans the stored buffer at all — it reads directly from `writeBlock`'s own already-in-hand `inputChannelData`, computed once per audio callback, entirely independent of `bufferLock`. There is no risk of reintroducing the old bug because the new code doesn't touch the buffer-scanning path the bug lived in at all. Task 2 spells out exactly what to remove.

---

### Task 1: `LoopRecorder.h`/`.cpp` — live per-channel peak, remove the old bucket-history mechanism

**Files:**
- Modify: `native-engine/Source/LoopRecorder.h`
- Modify: `native-engine/Source/LoopRecorder.cpp`
- Modify: `native-engine/Source/LoopRecorderTests.cpp`

- [ ] **Step 1: Remove `elapsedSeconds()` and `peaksFixedWindow()` from `LoopRecorder.h`**

In `native-engine/Source/LoopRecorder.h`, delete this entire method (including its doc comment), currently right after `hasAnyAudio()`:

```cpp
        /** How much real time has been captured so far, in seconds --
         * lets the renderer size the live overlay to match how long the
         * take has actually grown to (see IpcServer.cpp's
         * capture-level-update push), rather than the recording loop
         * region's own fixed bounds, which no longer constrain capture
         * length at all (see this class's own doc comment). */
        double elapsedSeconds() const
        {
            return (double) writePos.load(std::memory_order_acquire) / sampleRate;
        }
```

Delete this entire method too (including its doc comment), currently right after `peaksSoFar`'s declaration:

```cpp
        /** Fixed-width bucketing, unlike peaksSoFar's fixed-COUNT rescaling
         * above -- one bucket per full bucketDurationSec of audio actually
         * captured so far, growing in LENGTH as more gets captured but
         * never recomputing a bucket already returned by an earlier call (a
         * bucket's own sample range, once it exists, never changes). Built
         * for the renderer's live capture overlay (see ChannelRow.tsx):
         * peaksSoFar's rescaling made that overlay visibly reshape its
         * already-drawn portion on every poll, since EVERY bucket's
         * boundaries (including bucket 0's) widened each time more got
         * captured -- not the "write once and leave it" look that's
         * actually wanted for something meant to be watched growing in
         * real time. Trade-off: the most recent partial bucket (up to
         * almost bucketDurationSec of audio) is never included -- a
         * bucket's value is only ever computed once, over its complete
         * range, so an incomplete one can't be returned without later
         * being recomputed differently once it does complete, recreating
         * the exact problem this method exists to avoid. */
        std::vector<float> peaksFixedWindow(double bucketDurationSec) const;
```

**Do not touch `peaksSoFar` — it stays, even though it's also currently unused outside its own tests.** Removing it is out of scope for this plan (not part of the approved design); leave it exactly as-is.

- [ ] **Step 2: Add `currentPeakL()`/`currentPeakR()` to `LoopRecorder.h`**

Add this right after `hasAnyAudio()`'s declaration (where `elapsedSeconds()` used to be):

```cpp
        /** Peak amplitude of whatever this recorder's own left/right
         * output channel most recently captured, in the MOST RECENT
         * writeBlock() call only -- not a growing history like
         * peaksSoFar above, a live INSTANT level for a VU-meter-style
         * display: "right now," nothing else. Lock-free -- writeBlock()
         * (audio thread) is the sole writer, these two accessors
         * (message thread, IpcConnection::timerCallback) the sole
         * readers, same std::atomic pattern as writePos above. */
        float currentPeakL() const { return currentPeakL_.load(std::memory_order_relaxed); }
        float currentPeakR() const { return currentPeakR_.load(std::memory_order_relaxed); }
```

Add the two new private members right after `std::atomic<int> writePos { 0 };`:

```cpp
        std::atomic<float> currentPeakL_ { 0.0f };
        std::atomic<float> currentPeakR_ { 0.0f };
```

- [ ] **Step 3: Update `writeBlock()` in `LoopRecorder.cpp`, and remove `peaksFixedWindow`'s implementation**

Replace the entire `writeBlock` method:

```cpp
    void LoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                   int startSample, int numSamples)
    {
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;
        const int bufferSamples = buffer.getNumSamples();
        const int startPos = writePos.load(std::memory_order_relaxed);
        for (int destCh = 0; destCh < kOutputChannels; ++destCh)
        {
            // A mono (single-channel) device has its one channel duplicated
            // onto both output channels; a device with 2+ channels maps its
            // first two straight across -- see this method's own doc
            // comment.
            const int srcCh = std::min(destCh, numInputChannels - 1);
            auto* dest = buffer.getWritePointer(destCh);
            const auto* src = inputChannelData[srcCh];
            for (int i = 0; i < numSamples; ++i)
            {
                const int destIndex = startPos + i;
                if (destIndex >= bufferSamples) break; // hit the generous ceiling -- stop capturing rather than overflow; not expected in normal use
                dest[destIndex] = src[startSample + i];
            }
        }
        // Release store: publishes both the samples just written above AND
        // this new index in one handoff, so peaksSoFar's acquire load on
        // the message thread (below) can never observe the advanced index
        // without also observing the sample data that goes with it.
        writePos.store(std::min(startPos + numSamples, bufferSamples), std::memory_order_release);
    }
```

with:

```cpp
    void LoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                   int startSample, int numSamples)
    {
        if (numInputChannels <= 0 || inputChannelData == nullptr) return;
        const int bufferSamples = buffer.getNumSamples();
        const int startPos = writePos.load(std::memory_order_relaxed);
        for (int destCh = 0; destCh < kOutputChannels; ++destCh)
        {
            // A mono (single-channel) device has its one channel duplicated
            // onto both output channels; a device with 2+ channels maps its
            // first two straight across -- see this method's own doc
            // comment.
            const int srcCh = std::min(destCh, numInputChannels - 1);
            auto* dest = buffer.getWritePointer(destCh);
            const auto* src = inputChannelData[srcCh];
            // Fused with the existing write loop below (no separate pass)
            // -- tracks this call's own peak per channel for
            // currentPeakL()/currentPeakR()'s live VU-meter reading.
            float peak = 0.0f;
            for (int i = 0; i < numSamples; ++i)
            {
                const int destIndex = startPos + i;
                if (destIndex >= bufferSamples) break; // hit the generous ceiling -- stop capturing rather than overflow; not expected in normal use
                dest[destIndex] = src[startSample + i];
                peak = std::max(peak, std::abs(src[startSample + i]));
            }
            (destCh == 0 ? currentPeakL_ : currentPeakR_).store(peak, std::memory_order_relaxed);
        }
        // Release store: publishes both the samples just written above AND
        // this new index in one handoff, so peaksSoFar's acquire load on
        // the message thread (below) can never observe the advanced index
        // without also observing the sample data that goes with it.
        writePos.store(std::min(startPos + numSamples, bufferSamples), std::memory_order_release);
    }
```

Delete the entire `peaksFixedWindow` implementation from `LoopRecorder.cpp`:

```cpp
    std::vector<float> LoopRecorder::peaksFixedWindow(double bucketDurationSec) const
    {
        std::vector<float> result;
        // Acquire load, paired with writeBlock's release store, same as
        // peaksSoFar above.
        const int currentWritePos = writePos.load(std::memory_order_acquire);
        if (currentWritePos <= 0 || bucketDurationSec <= 0.0) return result;

        const int samplesPerBucket = std::max(1, (int) std::lround(bucketDurationSec * sampleRate));
        const int numBuckets = currentWritePos / samplesPerBucket; // whole buckets only -- see this method's own doc comment on excluding the trailing partial one
        result.reserve((size_t) numBuckets);
        for (int b = 0; b < numBuckets; ++b)
        {
            const int start = b * samplesPerBucket;
            const int end = start + samplesPerBucket;
            float peak = 0.0f;
            // Peak across both channels -- same reasoning as peaksSoFar above.
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                const auto* data = buffer.getReadPointer(ch);
                for (int i = start; i < end; ++i)
                    peak = std::max(peak, std::abs(data[i]));
            }
            result.push_back(peak);
        }
        return result;
    }
```

Do NOT touch `peaksSoFar`'s implementation (right above where `peaksFixedWindow` was) — leave it exactly as-is.

- [ ] **Step 4: Update `LoopRecorderTests.cpp`**

Remove this entire `beginTest` block (the `elapsedSeconds()` test):

```cpp
            beginTest("elapsedSeconds() is 0 for a freshly-constructed recorder and reflects "
                      "however much has actually been captured -- lets the renderer size the "
                      "live overlay to match the take's own real, growing length rather than "
                      "the recording loop region's fixed bounds");
            {
                LoopRecorder recorder(48000.0);
                expectWithinAbsoluteError(recorder.elapsedSeconds(), 0.0, 0.0001);

                std::vector<float> inputData(24000, 0.5f); // 0.5s at 48kHz
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 24000);
                expectWithinAbsoluteError(recorder.elapsedSeconds(), 0.5, 0.0001);

                recorder.writeBlock(channels, 1, 0, 24000); // another 0.5s, appended
                expectWithinAbsoluteError(recorder.elapsedSeconds(), 1.0, 0.0001);
            }
```

Remove these two entire `beginTest` blocks (the `peaksFixedWindow` tests scattered through the file):

```cpp
            beginTest("peaksFixedWindow on a freshly-constructed recorder (never written to) is "
                      "empty");
            {
                LoopRecorder recorder(48000.0);
                expect(recorder.peaksFixedWindow(0.01).empty());
            }

            beginTest("peaksFixedWindow excludes a trailing partial bucket -- a bucket's value "
                      "is only ever computed once, over its complete range, so it can't be "
                      "returned before that range is fully captured");
            {
                LoopRecorder recorder(48000.0); // 0.01s bucket == 480 samples at 48kHz
                std::vector<float> inputData(300, 0.6f); // fewer than 480 samples written
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 300);

                expect(recorder.peaksFixedWindow(0.01).empty());
            }
```

and:

```cpp
            beginTest("peaksFixedWindow is append-only -- a bucket already returned by an "
                      "earlier call keeps the exact same value on a later call, even once more "
                      "audio has since been captured (the live capture overlay draws each bar "
                      "once and must not see it reshape later)");
            {
                LoopRecorder recorder(48000.0); // 0.01s bucket == 480 samples at 48kHz
                std::vector<float> quiet(480, 0.1f);
                const float* quietChannels[] = { quiet.data() };
                recorder.writeBlock(quietChannels, 1, 0, 480);

                const auto firstPoll = recorder.peaksFixedWindow(0.01);
                expectEquals((int) firstPoll.size(), 1);
                expectWithinAbsoluteError(firstPoll[0], 0.1f, 0.01f);

                std::vector<float> loud(480, 0.9f);
                const float* loudChannels[] = { loud.data() };
                recorder.writeBlock(loudChannels, 1, 0, 480);

                const auto secondPoll = recorder.peaksFixedWindow(0.01);
                expectEquals((int) secondPoll.size(), 2);
                // Bucket 0's value is identical to what firstPoll already
                // returned -- the whole point of this method over
                // peaksSoFar's rescaling.
                expectWithinAbsoluteError(secondPoll[0], 0.1f, 0.01f);
                expectWithinAbsoluteError(secondPoll[1], 0.9f, 0.01f);
            }
```

Do NOT touch any `peaksSoFar` test (there are 4: "on a freshly-constructed recorder... is empty", "rescales across whatever's been captured...", "distinguishes amplitude across buckets...", "with more buckets than written samples...") — leave those exactly as-is.

Add two new `beginTest` blocks, right after the "writeBlock captures real stereo" test (before the now-removed `peaksFixedWindow` append-only test used to be):

```cpp
            beginTest("currentPeakL/currentPeakR are 0 for a freshly-constructed recorder");
            {
                LoopRecorder recorder(48000.0);
                expectWithinAbsoluteError(recorder.currentPeakL(), 0.0f, 0.0001f);
                expectWithinAbsoluteError(recorder.currentPeakR(), 0.0f, 0.0001f);
            }

            beginTest("currentPeakL/currentPeakR reflect only the MOST RECENT writeBlock call, "
                      "independently per channel, not a running max across the whole take");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> left1(100, 0.2f);
                std::vector<float> right1(100, 0.9f);
                const float* firstChannels[] = { left1.data(), right1.data() };
                recorder.writeBlock(firstChannels, 2, 0, 100);
                expectWithinAbsoluteError(recorder.currentPeakL(), 0.2f, 0.01f);
                expectWithinAbsoluteError(recorder.currentPeakR(), 0.9f, 0.01f);

                // A second, QUIETER call should REPLACE the previous reading, not be
                // maxed against it -- this is a live "right now" meter, not a
                // running peak-of-the-whole-take.
                std::vector<float> left2(100, 0.05f);
                std::vector<float> right2(100, 0.1f);
                const float* secondChannels[] = { left2.data(), right2.data() };
                recorder.writeBlock(secondChannels, 2, 100, 100);
                expectWithinAbsoluteError(recorder.currentPeakL(), 0.05f, 0.01f);
                expectWithinAbsoluteError(recorder.currentPeakR(), 0.1f, 0.01f);
            }
```

- [ ] **Step 5: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including the two new "currentPeakL/currentPeakR..." tests, and confirm the removed tests are genuinely gone (grep the output for "peaksFixedWindow" and "elapsedSeconds" — should return nothing).

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/LoopRecorder.h native-engine/Source/LoopRecorder.cpp native-engine/Source/LoopRecorderTests.cpp
git commit -m "$(cat <<'EOF'
LoopRecorder: live per-channel currentPeakL/currentPeakR, remove peaksFixedWindow

Replaces the old bucket-history mechanism (peaksFixedWindow, and
elapsedSeconds which only existed to size that history's overlay) with
a live "right now" per-channel peak, fused into the existing writeBlock
write loop -- the new record-mode VU meter needs instant level, not a
growing array of past buckets. peaksSoFar is untouched (out of scope).
EOF
)"
```

---

### Task 2: `GatedLoopRecorder.h`/`.cpp` — live per-channel peak, remove the incremental-cache mechanism

**Files:**
- Modify: `native-engine/Source/GatedLoopRecorder.h`
- Modify: `native-engine/Source/GatedLoopRecorder.cpp`
- Modify: `native-engine/Source/GatedLoopRecorderTests.cpp`

- [ ] **Step 1: Remove `peaks()` and its whole caching subsystem from `GatedLoopRecorder.h`**

Delete this entire method declaration (including its long doc comment) from the `public:` section:

```cpp
        /** Peak amplitude across the WHOLE fixed buffer, split into
         * numBuckets evenly-sized buckets -- unlike LoopRecorder's own
         * peaksSoFar/peaksFixedWindow (both designed around a
         * monotonically-growing, append-only buffer), this buffer is a
         * fixed length for its entire lifetime (see this class's own doc
         * comment), so there's no "how much has been written so far" to
         * track. Called on the same 30Hz poll as writeToWavFile's own use
         * case (see IpcServer.cpp's timerCallback), for a live "building
         * up" waveform preview while gated recording is enabled -- see
         * ChannelRow.tsx's own overlay for the LoopRecorder equivalent
         * this mirrors.
         *
         * Incrementally cached, NOT a full rescan every call -- an earlier
         * version rescanned the entire buffer (up to several million
         * stereo samples for a long loop region) from scratch on every one
         * of these 30Hz polls, which meant holding bufferLock -- the SAME
         * lock writeBlock needs on every real-time audio callback -- for a
         * genuinely long stretch, repeatedly, for the whole time gated
         * recording was armed. Confirmed as the likely cause of real
         * reported glitching/stuttering while recording: a slow poll
         * blocking the audio thread's own lock acquisition is a textbook
         * dropout. Now only the kPeaksBucketCount buckets actually
         * touched by writeBlock since the LAST peaks() call get
         * recomputed (see markBucketsDirty/dirtyBuckets below); everything
         * else returns the still-valid cached value from last time -- the
         * lock is still taken, but only ever held for a handful of small,
         * bounded bucket scans instead of the whole buffer.
         *
         * numBuckets is expected to always be kPeaksBucketCount in
         * practice (IpcServer.cpp's only caller always asks for exactly
         * that) -- passing anything else still works, just falls back to
         * an uncached full recompute at that resolution rather than trying
         * to reconcile two different bucket granularities in one cache. */
        std::vector<float> peaks(int numBuckets) const;
```

Add this in its place (still in `public:`):

```cpp
        /** Peak amplitude of whatever this recorder's own left/right
         * output channel most recently SAW as input, in the MOST RECENT
         * writeBlock() call only -- computed regardless of gate state (so
         * the meter reflects true input level even below threshold, for
         * calibrating a mic before it's loud enough to actually start
         * capturing), and entirely independent of buffer/bufferLock/the
         * fixed loop-position buffer this class writes into -- a plain
         * lock-free atomic pair, same pattern as LoopRecorder's own
         * currentPeakL()/currentPeakR(). writeBlock() (audio thread) is
         * the sole writer, these two accessors (message thread) the sole
         * readers. */
        float currentPeakL() const { return currentPeakL_.load(std::memory_order_relaxed); }
        float currentPeakR() const { return currentPeakR_.load(std::memory_order_relaxed); }
```

Delete these entire private members and methods (the whole incremental-cache subsystem):

```cpp
        // The fixed bucket resolution peaks()'s incremental cache is kept
        // at -- see peaks()'s own doc comment on why this needs to be a
        // fixed, known-in-advance constant rather than derived from
        // whatever numBuckets a given peaks() call happens to pass: writeBlock
        // (audio thread) needs to know which bucket index a just-written
        // sample range falls into WITHOUT waiting for a peaks() call to
        // tell it. Matches IpcServer.cpp's own peaks(128) call.
        static constexpr int kPeaksBucketCount = 128;

        // cachedPeaks/dirtyBuckets are guarded by bufferLock, same as
        // buffer itself -- writeBlock (audio thread) marks buckets dirty
        // while already holding the lock for the sample write; peaks()
        // (message thread) reads/recomputes/clears them while holding the
        // lock for its own bounded per-bucket work. Both empty until the
        // first peaks(kPeaksBucketCount) call establishes them (at
        // kPeaksBucketCount size, every bucket initially dirty -- a
        // correct, if unavoidable, one-time full compute) -- see peaks()'s
        // own implementation.
        mutable std::vector<float> cachedPeaks;
        mutable std::vector<bool> dirtyBuckets;

        // Peak amplitude of ONE bucket (bucketIndex of numBuckets total),
        // scanning across every channel -- the actual per-bucket scan work
        // both peaks()'s cached path and its uncached-fallback path share.
        float computeBucketPeak(int bucketIndex, int numBuckets) const;

        // Marks whichever of kPeaksBucketCount buckets the sample range
        // [startPos, startPos + numSamples) (mod bufferLengthSamples)
        // falls into as dirty, so the next peaks() call knows to recompute
        // them instead of trusting a now-stale cached value. Called from
        // writeBlock, already holding bufferLock. A no-op before
        // dirtyBuckets exists yet (peaks() hasn't been called for the
        // first time) -- nothing to keep in sync with until there's a
        // cache to keep in sync.
        void markBucketsDirty(int startPos, int numSamples);
```

Add this in their place (still `private:`):

```cpp
        std::atomic<float> currentPeakL_ { 0.0f };
        std::atomic<float> currentPeakR_ { 0.0f };
```

- [ ] **Step 2: Update `writeBlock()` in `GatedLoopRecorder.cpp`, and remove `computeBucketPeak`/`markBucketsDirty`/`peaks`**

Replace the start of `writeBlock` (everything up through the RMS/gate decision, before the buffer-writing section) — find:

```cpp
    void GatedLoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                        int startSample, int numSamples, double loopRelativeStartBar)
    {
        if (numSamples <= 0) return;

        // RMS over this block's mono downmix decides whether ANY of it
        // gets written -- computed outside the lock, cheap and read-only.
        // Still a downmix here even though the CAPTURED audio is now
        // stereo (see below) -- the gate is a single open/closed decision
        // for the whole block, not per-channel, so a plain average is all
        // this needs.
        double sumSquares = 0.0;
```

replace with:

```cpp
    void GatedLoopRecorder::writeBlock(const float* const* inputChannelData, int numInputChannels,
                                        int startSample, int numSamples, double loopRelativeStartBar)
    {
        if (numSamples <= 0) return;

        // Live per-channel input level for the VU meter -- computed
        // UNCONDITIONALLY, before the gate/threshold decision below, so
        // the meter reflects true input signal even while below
        // threshold (useful for confirming a mic is live while
        // calibrating levels, not just "level while actively capturing
        // into the take"). Entirely independent of bufferLock/buffer --
        // reads straight from inputChannelData, the same argument the RMS
        // gate-decision calc just below also reads from, not the stored
        // recording buffer -- so this can never reintroduce the
        // whole-buffer-rescan-under-lock bug this class's own peaks()
        // method used to have (see this class's own doc comment on why
        // that method's caching existed, and this plan's own top-level
        // note on why it's now removed entirely).
        if (numInputChannels > 0 && inputChannelData != nullptr)
        {
            for (int destCh = 0; destCh < kOutputChannels; ++destCh)
            {
                const int srcCh = std::min(destCh, numInputChannels - 1);
                const auto* src = inputChannelData[srcCh];
                float peak = 0.0f;
                for (int i = 0; i < numSamples; ++i)
                    peak = std::max(peak, std::abs(src[startSample + i]));
                (destCh == 0 ? currentPeakL_ : currentPeakR_).store(peak, std::memory_order_relaxed);
            }
        }

        // RMS over this block's mono downmix decides whether ANY of it
        // gets written -- computed outside the lock, cheap and read-only.
        // Still a downmix here even though the CAPTURED audio is now
        // stereo (see below) -- the gate is a single open/closed decision
        // for the whole block, not per-channel, so a plain average is all
        // this needs.
        double sumSquares = 0.0;
```

Then find the very end of `writeBlock`, the last line before its closing `}`:

```cpp
        markBucketsDirty(startPos, numSamples);
    }
```

Replace with just:

```cpp
    }
```

(No replacement call needed — `markBucketsDirty` no longer exists.)

Delete the entire `computeBucketPeak` method:

```cpp
    float GatedLoopRecorder::computeBucketPeak(int bucketIndex, int numBuckets) const
    {
        const int bucketStart = (int) ((double) bucketIndex / numBuckets * bufferLengthSamples);
        const int bucketEnd = (int) ((double) (bucketIndex + 1) / numBuckets * bufferLengthSamples);
        float peak = 0.0f;
        // Peak across both channels -- this is just a coarse live overview
        // bar, not a true stereo waveform, matching LoopRecorder's own
        // peaksSoFar/peaksFixedWindow reasoning.
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            const auto* data = buffer.getReadPointer(ch);
            for (int i = bucketStart; i < bucketEnd; ++i)
                peak = std::max(peak, std::abs(data[i]));
        }
        return peak;
    }
```

Delete the entire `markBucketsDirty` method:

```cpp
    void GatedLoopRecorder::markBucketsDirty(int startPos, int numSamples)
    {
        if (dirtyBuckets.empty()) return; // no cache established yet -- nothing to keep in sync with
        if (numSamples <= 0) return;

        const int bucketSize = std::max(1, bufferLengthSamples / kPeaksBucketCount);
        // Walks in bucket-sized strides (not per-sample) -- a real write is
        // typically well under one bucket's own width, so this loop body
        // usually runs exactly once; it only iterates further for an
        // unusually large numSamples relative to the loop length.
        for (int offset = 0; offset < numSamples; offset += bucketSize)
        {
            const int pos = (startPos + offset) % bufferLengthSamples;
            const int bucket = std::min(kPeaksBucketCount - 1, pos / bucketSize);
            dirtyBuckets[(size_t) bucket] = true;
        }
        // The stride above can overstep the LAST sample actually written
        // (numSamples isn't necessarily an exact multiple of bucketSize) --
        // explicitly mark its own bucket too so the tail end of a write is
        // never silently left stale.
        const int lastPos = (startPos + numSamples - 1) % bufferLengthSamples;
        dirtyBuckets[(size_t) std::min(kPeaksBucketCount - 1, lastPos / bucketSize)] = true;
    }
```

Delete the entire `peaks` method:

```cpp
    std::vector<float> GatedLoopRecorder::peaks(int numBuckets) const
    {
        if (numBuckets <= 0) return {};

        const juce::ScopedLock sl(bufferLock);

        // Only kPeaksBucketCount is incrementally cached/dirty-tracked (see
        // markBucketsDirty and this method's own doc comment on why) -- a
        // request for any other resolution falls back to a plain, uncached
        // full scan at THAT resolution instead, matching this method's
        // original (pre-caching) behavior exactly. Doesn't happen in
        // practice (IpcServer.cpp always asks for kPeaksBucketCount).
        if (numBuckets != kPeaksBucketCount)
        {
            std::vector<float> result((size_t) numBuckets, 0.0f);
            for (int b = 0; b < numBuckets; ++b)
                result[(size_t) b] = computeBucketPeak(b, numBuckets);
            return result;
        }

        if ((int) cachedPeaks.size() != kPeaksBucketCount)
        {
            // First call (or a resolution change) -- nothing cached yet, so
            // every bucket needs a real scan this one time. Later calls
            // only redo whichever buckets markBucketsDirty actually flagged
            // since the last poll.
            cachedPeaks.assign((size_t) kPeaksBucketCount, 0.0f);
            dirtyBuckets.assign((size_t) kPeaksBucketCount, true);
        }

        for (int b = 0; b < kPeaksBucketCount; ++b)
        {
            if (!dirtyBuckets[(size_t) b]) continue;
            cachedPeaks[(size_t) b] = computeBucketPeak(b, kPeaksBucketCount);
            dirtyBuckets[(size_t) b] = false;
        }

        return cachedPeaks;
    }
```

The file should now end right after `writeToWavFile`'s closing `}` — confirm no dangling/orphaned code remains and the file's final `}` (closing `namespace sssketch`) is still present.

- [ ] **Step 3: Update `GatedLoopRecorderTests.cpp`**

Remove these three entire `beginTest` blocks (all reference the now-deleted `peaks()`):

```cpp
            beginTest("peaks() reflects captured audio at the right bucket, silence "
                      "elsewhere -- unlike LoopRecorder's own peaksSoFar/peaksFixedWindow, "
                      "this always spans the WHOLE fixed buffer, not 'how much so far'");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0); // 8s loop
                const auto silentPeaks = recorder.peaks(8);
                for (float p : silentPeaks) expectWithinAbsoluteError(p, 0.0f, 0.001f);

                auto loud = loudTone(4800);
                const float* channels[] = { loud.data() };
                // loopRelativeStartBar=0.0 -> writes into the very first bucket.
                recorder.writeBlock(channels, 1, 0, 4800, 0.0);
                const auto peaksAfterWrite = recorder.peaks(8);
                expectWithinAbsoluteError(peaksAfterWrite[0], 0.8f, 0.05f);
                for (size_t i = 1; i < peaksAfterWrite.size(); ++i)
                    expectWithinAbsoluteError(peaksAfterWrite[i], 0.0f, 0.001f);
            }

            beginTest("peaks(128) incrementally re-scans only buckets actually touched since "
                      "the last call, not the whole buffer every time -- the real fix for "
                      "reported glitching/stuttering while recording (see peaks()'s own doc "
                      "comment): a bucket nothing has written to since the previous call keeps "
                      "returning its cached value rather than getting needlessly rescanned");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0); // 8s loop = 384000 samples
                // 128 (kPeaksBucketCount) is the ONLY resolution this cache
                // actually applies to -- see peaks()'s own doc comment on
                // why any other numBuckets falls back to an uncached scan.
                auto peaks1 = recorder.peaks(128);
                expectEquals((int) peaks1.size(), 128);
                for (float p : peaks1) expectWithinAbsoluteError(p, 0.0f, 0.001f);

                // 384000 samples / 128 buckets = 3000 samples/bucket. Write
                // loud audio into exactly bucket 0.
                auto loud = loudTone(3000);
                const float* loudChannels[] = { loud.data() };
                recorder.writeBlock(loudChannels, 1, 0, 3000, 0.0);

                auto peaks2 = recorder.peaks(128);
                expectWithinAbsoluteError(peaks2[0], 0.8f, 0.05f);
                for (size_t i = 1; i < peaks2.size(); ++i)
                    expectWithinAbsoluteError(peaks2[i], 0.0f, 0.001f);

                // Now write loud audio into a FAR LATER bucket (50) only.
                auto loud2 = loudTone(3000);
                const float* loud2Channels[] = { loud2.data() };
                const double bar50 = (50.0 * 3000.0 / 384000.0) * 4.0; // sample 150000 as a bar position
                recorder.writeBlock(loud2Channels, 1, 0, 3000, bar50);

                auto peaks3 = recorder.peaks(128);
                // Bucket 0 STILL reads back as loud -- proves the cache from
                // the earlier call wasn't discarded/reset by this second,
                // unrelated write; only bucket 50 needed a real rescan.
                expectWithinAbsoluteError(peaks3[0], 0.8f, 0.05f);
                expectWithinAbsoluteError(peaks3[50], 0.8f, 0.05f);
                for (size_t i = 1; i < peaks3.size(); ++i)
                {
                    if (i == 50) continue;
                    expectWithinAbsoluteError(peaks3[i], 0.0f, 0.001f);
                }
            }

            beginTest("peaks() returns an empty vector for numBuckets <= 0, rather than "
                      "crashing or dividing by zero");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                expect(recorder.peaks(0).empty());
                expect(recorder.peaks(-1).empty());
            }
```

Add two new `beginTest` blocks in their place:

```cpp
            beginTest("currentPeakL/currentPeakR are 0 for a freshly-constructed recorder");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                expectWithinAbsoluteError(recorder.currentPeakL(), 0.0f, 0.0001f);
                expectWithinAbsoluteError(recorder.currentPeakR(), 0.0f, 0.0001f);
            }

            beginTest("currentPeakL/currentPeakR reflect the true input level EVEN BELOW the "
                      "gate threshold, independently per channel, and only the MOST RECENT "
                      "writeBlock call -- a live meter for calibrating input, not gated on "
                      "capture state");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                // Below threshold on purpose -- isGateOpen() must stay false, but the
                // meter should still see this real input level.
                std::vector<float> quietL(100, 0.005f);
                std::vector<float> quietR(100, 0.008f);
                const float* quietChannels[] = { quietL.data(), quietR.data() };
                recorder.writeBlock(quietChannels, 2, 0, 100, 0.0);
                expect(!recorder.isGateOpen());
                expectWithinAbsoluteError(recorder.currentPeakL(), 0.005f, 0.001f);
                expectWithinAbsoluteError(recorder.currentPeakR(), 0.008f, 0.001f);

                // A later, louder call replaces the reading, not maxed against it.
                std::vector<float> loudL(100, 0.7f);
                std::vector<float> loudR(100, 0.9f);
                const float* loudChannels[] = { loudL.data(), loudR.data() };
                recorder.writeBlock(loudChannels, 2, 100, 100, 0.001);
                expectWithinAbsoluteError(recorder.currentPeakL(), 0.7f, 0.05f);
                expectWithinAbsoluteError(recorder.currentPeakR(), 0.9f, 0.05f);
            }
```

- [ ] **Step 4: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including the two new "currentPeakL/currentPeakR..." tests. Confirm via `grep` that no reference to `peaks(`, `computeBucketPeak`, `markBucketsDirty`, or `kPeaksBucketCount` remains anywhere in `native-engine/Source/`.

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/GatedLoopRecorder.h native-engine/Source/GatedLoopRecorder.cpp native-engine/Source/GatedLoopRecorderTests.cpp
git commit -m "$(cat <<'EOF'
GatedLoopRecorder: live per-channel currentPeakL/currentPeakR, remove peaks() cache

Removes peaks() and its entire incremental bucket-dirty-tracking cache
(computeBucketPeak/markBucketsDirty/cachedPeaks/dirtyBuckets/
kPeaksBucketCount) -- that machinery existed solely to make the old
30Hz "growing waveform" IPC push cheap enough to not block the audio
thread's own lock (see its own doc comment on the dropout bug it
fixed). The new record-mode VU meter's currentPeakL/currentPeakR reads
straight from writeBlock's own inputChannelData, computed once per
audio callback, never touching buffer/bufferLock at all -- there's no
scan to cache in the first place, so the old bug class can't recur.
Computed unconditionally (before the gate/threshold decision), so the
meter reflects true input level even below threshold, for calibrating
a mic before it's loud enough to actually start capturing.
EOF
)"
```

---

### Task 3: `IpcServer.cpp` — push `{peakL, peakR}` instead of bucket arrays

**Files:**
- Modify: `native-engine/Source/IpcServer.cpp`

- [ ] **Step 1: Update the `capture-level-update` push**

In `native-engine/Source/IpcServer.cpp`'s `timerCallback`, replace:

```cpp
        if (armedRecorder)
        {
            juce::DynamicObject::Ptr capPayload = new juce::DynamicObject();
            capPayload->setProperty("channelId", armedChannelId);
            juce::Array<juce::var> peaksVar;
            // Fixed-width buckets (see peaksFixedWindow's own doc comment)
            // rather than peaksSoFar's rescale-to-N-buckets -- a bucket's
            // value never changes once returned, so the renderer's overlay
            // can draw each one once and leave it alone instead of visibly
            // reshaping already-drawn portions on every poll. 0.05s (50ms)
            // per bucket: fine enough to feel responsive at the ~33ms poll
            // rate below, coarse enough not to flood the IPC payload during
            // a multi-minute take. ChannelRow.tsx's LIVE_CAPTURE_BUCKET_SECONDS
            // must match this exactly -- it derives the overlay's pixel
            // width from bucket count, not from elapsedSeconds below.
            for (float peak : armedRecorder->peaksFixedWindow(0.05))
                peaksVar.add(peak);
            capPayload->setProperty("peaksSoFar", peaksVar);
            // Lets the renderer size the live overlay to match how long
            // the take has actually grown to, rather than the recording
            // loop region's own fixed bounds -- capture length is no
            // longer tied to the loop region at all (see LoopRecorder's
            // own doc comment), so a fixed-width overlay would otherwise
            // have to squish an ever-growing recording into the same
            // fixed pixel span, visually "shrinking" everything already
            // drawn every time more gets captured.
            capPayload->setProperty("elapsedSeconds", armedRecorder->elapsedSeconds());
            juce::DynamicObject::Ptr capObj = new juce::DynamicObject();
            capObj->setProperty("type", "capture-level-update");
            capObj->setProperty("payload", juce::var(capPayload.get()));
            sendJson(juce::var(capObj.get()));
        }
```

with:

```cpp
        if (armedRecorder)
        {
            // Live per-channel level, not a growing bucket history -- see
            // LoopRecorder::currentPeakL/currentPeakR's own doc comment.
            // The record-mode VU meter this feeds shows "right now," not
            // "how the take has built up so far."
            juce::DynamicObject::Ptr capPayload = new juce::DynamicObject();
            capPayload->setProperty("channelId", armedChannelId);
            capPayload->setProperty("peakL", armedRecorder->currentPeakL());
            capPayload->setProperty("peakR", armedRecorder->currentPeakR());
            juce::DynamicObject::Ptr capObj = new juce::DynamicObject();
            capObj->setProperty("type", "capture-level-update");
            capObj->setProperty("payload", juce::var(capPayload.get()));
            sendJson(juce::var(capObj.get()));
        }
```

- [ ] **Step 2: Update the `gated-recording-update` push**

Replace:

```cpp
        if (gatedRecorder)
        {
            juce::DynamicObject::Ptr gatedPayload = new juce::DynamicObject();
            juce::Array<juce::var> peaksVar;
            for (float peak : gatedRecorder->peaks(128))
                peaksVar.add(peak);
            gatedPayload->setProperty("peaks", peaksVar);
            juce::DynamicObject::Ptr gatedObj = new juce::DynamicObject();
            gatedObj->setProperty("type", "gated-recording-update");
            gatedObj->setProperty("payload", juce::var(gatedPayload.get()));
            sendJson(juce::var(gatedObj.get()));
        }
```

with:

```cpp
        if (gatedRecorder)
        {
            // Same live-level-not-history shape as capture-level-update
            // above -- see GatedLoopRecorder::currentPeakL/currentPeakR's
            // own doc comment.
            juce::DynamicObject::Ptr gatedPayload = new juce::DynamicObject();
            gatedPayload->setProperty("peakL", gatedRecorder->currentPeakL());
            gatedPayload->setProperty("peakR", gatedRecorder->currentPeakR());
            juce::DynamicObject::Ptr gatedObj = new juce::DynamicObject();
            gatedObj->setProperty("type", "gated-recording-update");
            gatedObj->setProperty("payload", juce::var(gatedPayload.get()));
            sendJson(juce::var(gatedObj.get()));
        }
```

- [ ] **Step 3: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures (no new automated coverage for `IpcServer.cpp`'s own message handling, matching this project's established convention that IPC wiring is typecheck/manual-walkthrough-verified — see root `CLAUDE.md`'s Testing conventions). This step just confirms the build still compiles after the signature changes from Tasks 1-2.

- [ ] **Step 4: Commit**

```bash
git add native-engine/Source/IpcServer.cpp
git commit -m "$(cat <<'EOF'
IpcServer: push {peakL, peakR} for capture-level-update/gated-recording-update

Replaces both pushes' bucket-array payloads with a plain two-float
live level, matching LoopRecorder/GatedLoopRecorder's own new
currentPeakL/currentPeakR (previous two tasks). Smaller payload, and
the renderer no longer needs to reconstruct pixel width from bucket
count -- the new VU meter's region is a fixed size set once at arm
time, not derived from how much data has streamed in.
EOF
)"
```

---

### Task 4: `preload/index.ts` — update `onCaptureLevelUpdate`/`onGatedRecordingUpdate` typed signatures

**Files:**
- Modify: `src/preload/index.ts`

`src/main/index.ts`'s `subscribeToCaptureLevelUpdates`/`subscribeToGatedRecordingUpdates` forward the payload object opaquely (`mainWindow.webContents.send('engine-capture-level-update', payload)`) with no shape-specific code — **no change needed there.** Only preload's typed bridge signatures need updating.

- [ ] **Step 1: Update `onCaptureLevelUpdate`**

In `src/preload/index.ts`, replace:

```typescript
  onCaptureLevelUpdate: (
    callback: (channelId: string, peaksSoFar: number[], elapsedSeconds: number) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { channelId: string; peaksSoFar: number[]; elapsedSeconds: number }
    ): void => callback(payload.channelId, payload.peaksSoFar, payload.elapsedSeconds)
    ipcRenderer.on('engine-capture-level-update', listener)
    return () => ipcRenderer.removeListener('engine-capture-level-update', listener)
  },
```

with:

```typescript
  onCaptureLevelUpdate: (
    callback: (channelId: string, peakL: number, peakR: number) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { channelId: string; peakL: number; peakR: number }
    ): void => callback(payload.channelId, payload.peakL, payload.peakR)
    ipcRenderer.on('engine-capture-level-update', listener)
    return () => ipcRenderer.removeListener('engine-capture-level-update', listener)
  },
```

- [ ] **Step 2: Update `onGatedRecordingUpdate`**

Replace:

```typescript
  onGatedRecordingUpdate: (callback: (peaks: number[]) => void): (() => void) => {
    const listener = (_event: unknown, payload: { peaks: number[] }): void =>
      callback(payload.peaks)
    ipcRenderer.on('engine-gated-recording-update', listener)
    return () => ipcRenderer.removeListener('engine-gated-recording-update', listener)
  },
```

with:

```typescript
  onGatedRecordingUpdate: (callback: (peakL: number, peakR: number) => void): (() => void) => {
    const listener = (_event: unknown, payload: { peakL: number; peakR: number }): void =>
      callback(payload.peakL, payload.peakR)
    ipcRenderer.on('engine-gated-recording-update', listener)
    return () => ipcRenderer.removeListener('engine-gated-recording-update', listener)
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: errors in `ChannelRow.tsx` (its callback signatures haven't been updated yet — that's Task 6). This is expected at this point in the plan; confirm the errors are ONLY in `ChannelRow.tsx`, nowhere else.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "$(cat <<'EOF'
preload: onCaptureLevelUpdate/onGatedRecordingUpdate carry {peakL, peakR}

Matches IpcServer.cpp's new payload shape (previous task). main/index.ts's
relay functions needed no change -- they forward payloads opaquely.
ChannelRow.tsx (not yet updated) will typecheck-fail until Task 6 lands;
expected at this point in the plan.
EOF
)"
```

---

### Task 5: `src/renderer/src/audio/meterBallistics.ts` — dB conversion + peak-hold-and-decay

**Files:**
- Create: `src/renderer/src/audio/meterBallistics.ts`
- Create: `src/renderer/src/audio/meterBallistics.test.ts`

Pure logic, no DOM/Electron dependency — follows this codebase's `src/renderer/src/audio/` convention (see `fadeGain.ts`/`metronome.ts` for the established style: plain exported functions, JSDoc explaining the *why*, real `vitest` TDD coverage).

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/audio/meterBallistics.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { linearToMeterFraction, nextMeterValue } from './meterBallistics'

describe('linearToMeterFraction', () => {
  it('maps 0 (silence) to 0', () => {
    expect(linearToMeterFraction(0)).toBe(0)
  })

  it('maps 1 (0dBFS, full scale) to 1', () => {
    expect(linearToMeterFraction(1)).toBeCloseTo(1, 5)
  })

  it('maps a value at the -60dB floor to 0', () => {
    const atFloor = Math.pow(10, -60 / 20)
    expect(linearToMeterFraction(atFloor)).toBeCloseTo(0, 3)
  })

  it('maps -20dB (a normal, non-silent level) to roughly 2/3 up the scale, not near-empty', () => {
    const minus20dB = Math.pow(10, -20 / 20)
    const fraction = linearToMeterFraction(minus20dB)
    // -20dB is 40dB above the -60dB floor, out of a 60dB range -- 40/60 = ~0.667.
    // The point of this test: a LINEAR mapping would put this at 0.1 (near-empty),
    // which is exactly the "meter looks dead during normal use" problem the log
    // scale exists to avoid.
    expect(fraction).toBeGreaterThan(0.6)
    expect(fraction).toBeLessThan(0.7)
  })

  it('never returns a negative value for a peak quieter than the floor', () => {
    expect(linearToMeterFraction(0.00001)).toBeGreaterThanOrEqual(0)
  })

  it('never returns more than 1 for a peak louder than 0dBFS (clipping input)', () => {
    expect(linearToMeterFraction(1.5)).toBeLessThanOrEqual(1)
  })
})

describe('nextMeterValue', () => {
  it('jumps up instantly to a louder reading', () => {
    const next = nextMeterValue(0.1, 0.8, 16)
    expect(next).toBe(0.8)
  })

  it('holds steady when the new reading equals the current value', () => {
    const next = nextMeterValue(0.5, 0.5, 16)
    expect(next).toBe(0.5)
  })

  it('eases down toward a quieter reading rather than snapping to it instantly', () => {
    const next = nextMeterValue(0.8, 0.1, 16)
    expect(next).toBeLessThan(0.8)
    expect(next).toBeGreaterThan(0.1)
  })

  it('reaches (or gets very close to) the quieter target after enough elapsed time', () => {
    // Decay window is ~300-500ms -- 1000ms of elapsed time should fully settle.
    const next = nextMeterValue(0.8, 0.1, 1000)
    expect(next).toBeCloseTo(0.1, 2)
  })

  it('decaying toward 0 (silence) eventually reaches exactly 0, not an asymptote that never lands', () => {
    let value = 1.0
    for (let i = 0; i < 50; i++) {
      value = nextMeterValue(value, 0, 100)
    }
    expect(value).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/renderer/src/audio/meterBallistics.test.ts`
Expected: FAIL with "Cannot find module './meterBallistics'"

- [ ] **Step 3: Implement `src/renderer/src/audio/meterBallistics.ts`**

```typescript
/** Peaks streamed from the engine are linear amplitude (0..~1) -- a plain
 * linear mapping onto a meter's fill fraction compresses ordinary
 * playing/talking level into a barely-visible sliver near the bottom
 * (most real audio sits well below 0dBFS), which reads as "the meter looks
 * dead" during completely normal use. This converts to dB and rescales
 * against a floor, so mid-level audio actually shows up mid-meter, the way
 * a real VU/level meter reads. */
const FLOOR_DB = -60
const CEILING_DB = 0

export function linearToMeterFraction(linearPeak: number): number {
  if (linearPeak <= 0) return 0
  const db = 20 * Math.log10(linearPeak)
  const fraction = (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)
  return Math.min(1, Math.max(0, fraction))
}

/** Classic VU-meter "peak-hold-and-decay" ballistics, expressed as one
 * step: jump up INSTANTLY to a louder reading (no attack smoothing --
 * transients should register immediately), but ease down toward a
 * quieter reading over roughly DECAY_MS rather than snapping to it, so
 * the display doesn't flicker between individual 30Hz engine polls.
 * `elapsedMs` is however long it's actually been since the last call
 * (not assumed fixed), so this still behaves correctly if polls arrive
 * at an uneven cadence. Both inputs/output are already-converted meter
 * fractions (0..1), not raw linear peaks -- call linearToMeterFraction
 * first. */
const DECAY_MS = 400

export function nextMeterValue(currentValue: number, targetValue: number, elapsedMs: number): number {
  if (targetValue >= currentValue) return targetValue
  const decayFraction = Math.min(1, elapsedMs / DECAY_MS)
  const next = currentValue - (currentValue - targetValue) * decayFraction
  // Snap fully to target once close enough that continuing to ease would
  // never actually reach it (a pure exponential-style ease never lands
  // exactly on 0) -- matches real analog VU needles settling, not hovering
  // just above rest forever.
  return next - targetValue < 0.001 ? targetValue : next
}
```

- [ ] **Step 4: Run the tests again to confirm they pass**

Run: `npx vitest run src/renderer/src/audio/meterBallistics.test.ts`
Expected: PASS, all 12 tests

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: still shows the same pre-existing `ChannelRow.tsx` errors from Task 4 (not yet fixed), nothing new from this file.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/audio/meterBallistics.ts src/renderer/src/audio/meterBallistics.test.ts
git commit -m "$(cat <<'EOF'
Add meterBallistics.ts: dB conversion + peak-hold-and-decay for the VU meter

linearToMeterFraction converts the engine's raw linear peaks to a 0-1
meter fraction on a -60..0dB log scale, so ordinary playing/talking
level reads mid-meter instead of compressed near-empty. nextMeterValue
is the peak-hold-and-decay step: instant jump up, ~400ms ease down --
classic VU-meter ballistics, expressed as pure per-call math so
ChannelRow.tsx can drive it from whatever cadence updates actually
arrive at.
EOF
)"
```

---

### Task 6: `ChannelRow.tsx` — replace both live-recording overlays with the VU meter

**Files:**
- Modify: `src/renderer/src/components/ChannelRow.tsx`

- [ ] **Step 1: Remove `LIVE_CAPTURE_BUCKET_SECONDS`**

Delete this constant block (currently lines 70-74):

```tsx
// Must match IpcServer.cpp's own armedRecorder->peaksFixedWindow(0.05) call
// exactly -- the live capture overlay below derives its pixel width from
// capturePeaks.length * this value, not from a separately-pushed elapsed
// time, so the two need to agree on what one bucket represents.
const LIVE_CAPTURE_BUCKET_SECONDS = 0.05
```

- [ ] **Step 2: Update imports**

Replace:

```tsx
import { linearWaveBars, linearWaveBarsRunningMax } from '@shared/visuals'
```

with:

```tsx
import { linearToMeterFraction, nextMeterValue } from '../audio/meterBallistics'
```

(`linearWaveBars`/`linearWaveBarsRunningMax` are no longer used anywhere in this file once Step 5 below lands — if either import is still referenced elsewhere in the file after that step, keep it; this plan's own research found no other use of either in `ChannelRow.tsx`, so expect this to be a full replacement, not an addition.)

- [ ] **Step 3: Replace `capturePeaks` state + its subscription effect**

Replace:

```tsx
  // Live "building up" waveform feedback while this channel is armed -- see
  // docs/superpowers/specs/2026-08-03-loop-recording-design.md's "Live
  // capture feedback" section. Subscribes only while armed (unsubscribes and
  // clears immediately on disarm, rather than leaving a stale bar graph
  // sitting there) since the engine only pushes capture-level-update while
  // some channel is actually armed (see IpcServer.cpp's timerCallback).
  const [capturePeaks, setCapturePeaks] = useState<number[]>([])
  useEffect(() => {
    if (!isArmed) return
    const unsubscribe = window.rifffApi.onCaptureLevelUpdate((updateChannelId, peaks) => {
      if (updateChannelId === channelId) {
        setCapturePeaks(peaks)
      }
    })
    // Reset lives in the cleanup, not the setup body -- calling setState
    // synchronously in an effect's setup trips react-hooks/set-state-in-effect
    // (see BeatPicker.tsx's identical reasoning on its own preview-stop
    // effect). Cleanup fires both when isArmed flips back to false and on
    // unmount, so the bar graph never lingers stale after a disarm.
    return () => {
      unsubscribe()
      setCapturePeaks([])
    }
  }, [isArmed, channelId])
```

with:

```tsx
  // Live VU-meter feedback while this channel is armed -- see
  // docs/superpowers/specs/2026-08-15-record-mode-vu-meter-design.md.
  // Subscribes only while armed (unsubscribes and resets to silence
  // immediately on disarm, rather than leaving a stale reading sitting
  // there) since the engine only pushes capture-level-update while some
  // channel is actually armed (see IpcServer.cpp's timerCallback). Values
  // are already-converted, already-ballistics-applied meter fractions
  // (0-1), not raw peaks -- see the useEffect body below.
  const [capturePeakL, setCapturePeakL] = useState(0)
  const [capturePeakR, setCapturePeakR] = useState(0)
  useEffect(() => {
    if (!isArmed) return
    let lastUpdateMs = performance.now()
    let displayL = 0
    let displayR = 0
    const unsubscribe = window.rifffApi.onCaptureLevelUpdate((updateChannelId, peakL, peakR) => {
      if (updateChannelId !== channelId) return
      const now = performance.now()
      const elapsedMs = now - lastUpdateMs
      lastUpdateMs = now
      displayL = nextMeterValue(displayL, linearToMeterFraction(peakL), elapsedMs)
      displayR = nextMeterValue(displayR, linearToMeterFraction(peakR), elapsedMs)
      setCapturePeakL(displayL)
      setCapturePeakR(displayR)
    })
    // Reset lives in the cleanup, not the setup body -- calling setState
    // synchronously in an effect's setup trips react-hooks/set-state-in-effect
    // (see BeatPicker.tsx's identical reasoning on its own preview-stop
    // effect). Cleanup fires both when isArmed flips back to false and on
    // unmount, so the meter never lingers at a stale reading after a disarm.
    return () => {
      unsubscribe()
      setCapturePeakL(0)
      setCapturePeakR(0)
    }
  }, [isArmed, channelId])
```

- [ ] **Step 4: Replace `gatedPeaks` state + its subscription effect**

Replace:

```tsx
  // Same live-overlay pattern as capturePeaks above, adapted for
  // GatedLoopRecorder's fixed-size buffer (see its own doc comment):
  // unlike the arm-to-disarm LoopRecorder, this buffer never grows -- it
  // always spans the WHOLE selected loop region from the moment gated
  // recording is enabled, so the overlay's width is fixed too (derived
  // from loopRegion, not from gatedPeaks.length) and uses linearWaveBars
  // (plain whole-array normalization), not linearWaveBarsRunningMax --
  // there's no "growing array retroactively rescaling" problem to guard
  // against when the array's own length never changes.
  const [gatedPeaks, setGatedPeaks] = useState<number[]>([])
  useEffect(() => {
    if (!gatedRecordingEnabled || !isGatedRecordingChannel) return
    const unsubscribe = window.rifffApi.onGatedRecordingUpdate((peaks) => {
      setGatedPeaks(peaks)
    })
    return () => {
      unsubscribe()
      setGatedPeaks([])
    }
  }, [gatedRecordingEnabled, isGatedRecordingChannel])
```

with:

```tsx
  // Same live-meter pattern as capturePeakL/capturePeakR above, for the
  // gated (threshold-triggered) recording feature. Region geometry stays
  // fixed to the whole loopRegion regardless of level (see the JSX below)
  // -- only the fill amount is live.
  const [gatedPeakL, setGatedPeakL] = useState(0)
  const [gatedPeakR, setGatedPeakR] = useState(0)
  useEffect(() => {
    if (!gatedRecordingEnabled || !isGatedRecordingChannel) return
    let lastUpdateMs = performance.now()
    let displayL = 0
    let displayR = 0
    const unsubscribe = window.rifffApi.onGatedRecordingUpdate((peakL, peakR) => {
      const now = performance.now()
      const elapsedMs = now - lastUpdateMs
      lastUpdateMs = now
      displayL = nextMeterValue(displayL, linearToMeterFraction(peakL), elapsedMs)
      displayR = nextMeterValue(displayR, linearToMeterFraction(peakR), elapsedMs)
      setGatedPeakL(displayL)
      setGatedPeakR(displayR)
    })
    return () => {
      unsubscribe()
      setGatedPeakL(0)
      setGatedPeakR(0)
    }
  }, [gatedRecordingEnabled, isGatedRecordingChannel])
```

- [ ] **Step 5: Replace both JSX overlay blocks**

Replace the entire armed-overlay JSX block:

```tsx
      {isArmed && armedLoopRegion && (
        // Rendered AFTER rifffs.map above, not before -- both are plain
        // position:absolute siblings with no explicit z-index, so DOM
        // order alone decides paint order. Placed earlier, this overlay
        // was invisible any time a recording channel already had a clip
        // on it (the normal retake case): RifffBlockRow's own opaque
        // background painted straight over it. pointerEvents: none means
        // sitting on top here still can't block clicking the clip
        // underneath.
        //
        // Positioned at armedLoopRegion's startBar (where capture
        // ACTUALLY started, matching MOVE_TO_CHANNEL's own placement at
        // disarm -- see that state's own doc comment), not the live
        // loopRegion selector -- capture length is no longer tied to the
        // loop region at all, so this needs to track "where and how much
        // has actually been recorded," not "the loop's own box." Width is
        // derived from capturePeaks.length (each entry is exactly
        // LIVE_CAPTURE_BUCKET_SECONDS of real captured audio -- see
        // peaksFixedWindow's own doc comment on the native side), NOT from
        // a separately-pushed elapsedSeconds -- growing in lockstep with
        // the bars themselves means the container only ever widens in the
        // same discrete steps new bars appear in, instead of stretching
        // smoothly between bucket arrivals (which visibly "breathed" the
        // most recently drawn bar wider each frame until the next bucket
        // landed). Math.max(2, ...) keeps it from collapsing to 0px in the
        // first instant after arming, before the first bucket exists yet.
        <div
          style={{
            position: 'absolute',
            left: armedLoopRegion.startBar * ppb,
            width: Math.max(
              2,
              ((capturePeaks.length * LIVE_CAPTURE_BUCKET_SECONDS) / ((60 / bpm) * 4)) * ppb
            ),
            // NAME_BAR_HEIGHT/ROW_HEIGHT, not top:0/bottom:0 spanning this
            // whole channel row -- the row's own container includes the
            // 18px name-bar strip above where a committed clip's Waveform
            // actually renders (see RifffBlockRow.tsx), so filling the
            // whole row stretched this overlay taller than -- and shifted
            // it vertically from -- the exact lane the finished clip's own
            // waveform will occupy. This matches that lane exactly.
            top: NAME_BAR_HEIGHT,
            height: ROW_HEIGHT,
            pointerEvents: 'none'
          }}
        >
          {/* Same linearWaveBars geometry Waveform.tsx uses for every other
              clip's waveform (centered bars in a 128x100 viewBox, edge to
              edge, crisp edges) -- not a from-scratch bar-graph look, per
              feedback asking this to read more like "the waveforms
              elsewhere." No brightness modulation (that's the zero-
              crossing-rate "spectrographic" layer Waveform.tsx also draws --
              explicitly not wanted here) and no pitch line -- still no glow
              (an earlier, separate, explicit design decision). Full
              opacity, not Waveform.tsx's usual 0.75. Uses the dedicated
              --ra-recording-live purple, which is the SAME purple
              --ra-type-audio-in now uses for a committed clip too -- live
              and final read as one continuous color language rather than
              switching partway through.

              linearWaveBarsRunningMax, not linearWaveBars -- the latter
              normalizes every bar's height against Math.max(peaks) across
              the WHOLE array, which for a live, growing array meant a
              louder bucket arriving later in the take retroactively shrank
              every bar already on screen (the "waveform looks animated"
              bug). linearWaveBarsRunningMax normalizes each bar only
              against peaks up to and including its own index -- values
              that never change once present -- so a bar's height, once
              drawn, is provably stable on every later poll, while still
              tracking toward the same auto-normalized look
              Waveform.tsx's own linearWaveBars gives the finished clip. */}
          <svg width="100%" height="100%" viewBox="0 0 128 100" preserveAspectRatio="none">
            {linearWaveBarsRunningMax(capturePeaks).map((bar, i) => (
              <rect
                key={i}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill="var(--ra-recording-live)"
                shapeRendering="crispEdges"
              />
            ))}
          </svg>
        </div>
      )}
```

with:

```tsx
      {isArmed && armedLoopRegion && (
        // Rendered AFTER rifffs.map above, not before -- both are plain
        // position:absolute siblings with no explicit z-index, so DOM
        // order alone decides paint order. pointerEvents: none means
        // sitting on top here still can't block clicking the clip
        // underneath.
        //
        // Positioned at armedLoopRegion's startBar (where capture
        // ACTUALLY started, matching MOVE_TO_CHANNEL's own placement at
        // disarm -- see that state's own doc comment), not the live
        // loopRegion selector -- capture length is no longer tied to the
        // loop region at all, so this needs to track "where recording
        // started," not "the loop's own box." Width spans the WHOLE
        // recording-so-far region at a fixed size the instant it's
        // known (armedLoopRegion is itself set at arm time) -- unlike
        // the old waveform overlay, this meter doesn't grow: it's a live
        // level reading, not a progress display.
        <div
          style={{
            position: 'absolute',
            left: armedLoopRegion.startBar * ppb,
            width: (armedLoopRegion.endBar - armedLoopRegion.startBar) * ppb,
            top: NAME_BAR_HEIGHT,
            height: ROW_HEIGHT,
            pointerEvents: 'none'
          }}
        >
          {/* Two thin fill bars, L above R, flush together (no gap, no
              border) near the bottom of the lane -- see the design doc's
              own mockup iteration for why this shape specifically. Same
              --ra-recording-live purple at every level (no clip-warning
              color change, explicit design choice), no glow/flicker
              (matches this app's existing precedent for this overlay). */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 6, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${capturePeakL * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 1, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${capturePeakR * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
        </div>
      )}
```

Replace the entire gated-overlay JSX block:

```tsx
      {gatedRecordingEnabled && isGatedRecordingChannel && loopRegion && (
        // Fixed position/width spanning the WHOLE loop region for the
        // entire time gated recording is enabled -- unlike the armed
        // overlay above (which grows from a start point as capture
        // proceeds), GatedLoopRecorder's own buffer is bounded to exactly
        // one loop pass from the start, so there's no "how far has it
        // gotten" position to track, just "redraw the whole fixed span on
        // every poll." Same NAME_BAR_HEIGHT/ROW_HEIGHT lane and
        // --ra-recording-live color as the armed overlay, for one
        // continuous "this is live capture" color language across both
        // recording paths.
        <div
          style={{
            position: 'absolute',
            left: loopRegion.startBar * ppb,
            width: (loopRegion.endBar - loopRegion.startBar) * ppb,
            top: NAME_BAR_HEIGHT,
            height: ROW_HEIGHT,
            pointerEvents: 'none'
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 128 100" preserveAspectRatio="none">
            {linearWaveBars(gatedPeaks).map((bar, i) => (
              <rect
                key={i}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill="var(--ra-recording-live)"
                shapeRendering="crispEdges"
              />
            ))}
          </svg>
        </div>
      )}
```

with:

```tsx
      {gatedRecordingEnabled && isGatedRecordingChannel && loopRegion && (
        // Fixed position/width spanning the WHOLE loop region for the
        // entire time gated recording is enabled -- same fixed-region
        // treatment as before, just a VU meter instead of a waveform now.
        // Same NAME_BAR_HEIGHT/ROW_HEIGHT lane and --ra-recording-live
        // color as the armed overlay, for one continuous "this is live
        // capture" color language across both recording paths.
        <div
          style={{
            position: 'absolute',
            left: loopRegion.startBar * ppb,
            width: (loopRegion.endBar - loopRegion.startBar) * ppb,
            top: NAME_BAR_HEIGHT,
            height: ROW_HEIGHT,
            pointerEvents: 'none'
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 6, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${gatedPeakL * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 1, height: 5 }}>
            <div
              style={{
                height: '100%',
                width: `${gatedPeakR * 100}%`,
                background: 'var(--ra-recording-live)'
              }}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 6: Check whether `bpm` is now unused in this component**

`bpm` was previously read (via `useAppSelector((s) => s.bpm)`, line 136) only to compute the old overlay's growing width. Run `npm run typecheck` after this step — if the compiler flags `bpm` as unused (`noUnusedLocals`), remove that `useAppSelector` call; if `bpm` is still referenced elsewhere in this large component (likely, given its size), leave it untouched. Do not remove it speculatively.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors anywhere (this closes out the errors Task 4 intentionally left open).

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: all pass. `ChannelRow.tsx` itself has no direct tests (per this codebase's convention — React components are typecheck/lint/manual-walkthrough-verified, not directly unit tested), so this step is confirming no OTHER test broke.

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/ChannelRow.tsx
git commit -m "$(cat <<'EOF'
ChannelRow: replace live-recording waveform overlays with a VU meter

Both the manual/armed and gated recording overlays now render two
thin, flush-stacked L/R fill bars (fed by meterBallistics.ts's dB
conversion + peak-hold-and-decay) instead of a waveform built from
capturePeaks/gatedPeaks arrays. The region itself is sized once, at
arm time, to its full final bounds -- it no longer grows over time,
since a live level meter shows "right now," not "how far the take has
built up." LIVE_CAPTURE_BUCKET_SECONDS is removed (no longer
meaningful once there's no bucket array to size against).
EOF
)"
```

---

### Task 7: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full native rebuild + test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including every new test added across Tasks 1-2. Confirm via `grep` that the output contains no reference to `peaksFixedWindow`, `elapsedSeconds`, `peaks(128)`, `computeBucketPeak`, or `markBucketsDirty`.

- [ ] **Step 2: Full TypeScript typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: all pass, with a higher total count than before this plan (2 new native-adjacent tests aren't part of the vitest count; the 12 new `meterBallistics.test.ts` tests are).

- [ ] **Step 5: Manual walkthrough — flag explicitly, don't claim it was done**

Per root `CLAUDE.md`'s Testing conventions, real recording-hardware behavior can't be automated. Before this ships, a human needs to, after a full rebuild + **fully quitting and relaunching** the Electron app (a renderer reload alone will NOT pick up the native-engine changes from Tasks 1-3):

1. Select a real audio input device, arm a channel for manual recording. Confirm the meter appears immediately (full region size, not growing), as two thin flush L/R bars near the bottom of the lane.
2. Speak/play into the mic at a normal level — confirm the bars sit roughly mid-scale, not compressed near-empty (the whole point of the dB conversion).
3. Make a loud transient (clap, hit a drum) then go quiet — confirm the bar jumps up instantly on the loud hit, then visibly eases back down over a few hundred ms rather than snapping to silence immediately.
4. Confirm L and R move independently if you can produce a genuinely different level on each channel (e.g. a mono source panned hard to one side, or covering one mic capsule on a stereo interface).
5. Disarm — confirm the meter disappears immediately and the finished clip's waveform appears shortly after (same brief gap as before this plan, unrelated/unchanged).
6. Repeat steps 1-5 for gated/threshold recording: enable gated recording on a channel, confirm the meter shows live input level even BELOW the gate threshold (this is a deliberate behavior change from the old overlay, which only ever showed captured/gated-in audio) — you should see the meter react to quiet room noise/speech even before it's loud enough to actually start capturing into the take.
7. Confirm no audible dropout/stutter during either recording mode (this plan removed `GatedLoopRecorder`'s old lock-scope-sensitive caching entirely — confirm its removal didn't reintroduce the glitching it used to fix, by recording for at least 30-60 continuous seconds while gated recording is active).

Say so explicitly in any completion report — this needs real recording hardware and cannot be completed by an implementer subagent solo.

- [ ] **Step 6: Commit (only if Steps 1-4 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```
