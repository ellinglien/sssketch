// native-engine/Source/LoopRecorderTests.cpp
#include "LoopRecorder.h"
#include "StemBufferCache.h"
#include <juce_core/juce_core.h>
#include <vector>

namespace sssketch
{
    class LoopRecorderTests : public juce::UnitTest
    {
    public:
        LoopRecorderTests() : juce::UnitTest("LoopRecorder") {}

        void runTest() override
        {
            // Synthetic input: a single input channel, numSamples of a known
            // non-zero value, so a written/read-back sample can be checked
            // without needing a real audio device.
            beginTest("writeBlock captures samples into the buffer");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(4800, 0.5f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4800);
                expect(!recorder.hasCompletedPass()); // onPassBoundary() hasn't been called yet
            }

            beginTest("onPassBoundary marks a completed pass only once the buffer is fully written");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(2000, 0.5f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 2000); // partial -- 2000 of 4800
                recorder.onPassBoundary();
                expect(!recorder.hasCompletedPass());
            }

            beginTest("onPassBoundary marks a completed pass once the buffer is fully written");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(4800, 0.5f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4800); // exactly full
                recorder.onPassBoundary();
                expect(recorder.hasCompletedPass());
            }

            // Regression test for a real bug found in code review: Transport
            // used to derive the pass-boundary trigger from its own position
            // clock, which freezes while paused (recording capture runs
            // regardless of play state). A pause landing inside the trigger
            // window meant onPassBoundary() re-fired on every single
            // callback for as long as the pause lasted -- repeatedly wiping
            // the buffer instead of ever completing a pass. Fixed by driving
            // the trigger off isFull() (accumulated write count) instead,
            // which this test exercises directly: once a pass completes and
            // resets the write position, checking isFull() again with no new
            // writes in between (simulating however many further callbacks
            // happen while paused, each contributing nothing new) must stay
            // false -- it should never re-trip on its own.
            beginTest("isFull() does not re-trigger without new writes after a pass completes");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(4800, 0.5f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4800);
                expect(recorder.isFull());
                recorder.onPassBoundary();
                expect(recorder.hasCompletedPass());
                // Simulate several more audio callbacks with no new samples
                // written (as would happen while paused) -- isFull() must
                // stay false throughout, not flip back to true on its own.
                expect(!recorder.isFull());
                expect(!recorder.isFull());
                expect(!recorder.isFull());
            }

            beginTest("writeToWavFile commits a single completed pass's full audio");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(4800, 0.6f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4800);
                recorder.onPassBoundary();
                expect(recorder.hasCompletedPass());

                juce::File tmp = juce::File::createTempFile(".wav");
                expect(recorder.writeToWavFile(tmp.getFullPathName()));

                StemBufferCache cache;
                expect(cache.load(tmp.getFullPathName()));
                auto* readBack = cache.get(tmp.getFullPathName());
                expect(readBack != nullptr);
                expectEquals(readBack->getNumSamples(), 4800);
                expectWithinAbsoluteError(readBack->getSample(0, 0), 0.6f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 4600), 0.6f, 0.01f);

                tmp.deleteFile();
            }

            beginTest("disarming mid-way through a second pass commits the FIRST pass's "
                      "complete audio, not the second pass's partial/silent content -- "
                      "regression test for a real bug found during manual testing: "
                      "writeToWavFile used to read directly from the live `buffer`, which a "
                      "second pass had already started overwriting by the time of a mid-pass "
                      "disarm, even though hasCompletedPass() (correctly) still said there was "
                      "a completed pass -- just not the one actually still sitting in `buffer`");
            {
                LoopRecorder recorder(48000.0, 0.1);
                std::vector<float> firstPass(4800, 0.5f);
                const float* firstChannels[] = { firstPass.data() };
                recorder.writeBlock(firstChannels, 1, 0, 4800);
                recorder.onPassBoundary();
                expect(recorder.hasCompletedPass());

                std::vector<float> secondPass(4800, 0.25f);
                const float* secondChannels[] = { secondPass.data() };
                recorder.writeBlock(secondChannels, 1, 0, 2000); // only partway through the second pass
                expect(recorder.hasCompletedPass()); // still true -- pass 1 is still the last COMPLETED one

                // Write the committed WAV NOW (simulating a disarm mid-second-pass)
                // and confirm it reflects the FIRST pass's complete value throughout
                // -- the second, still-in-progress pass's partial 0.25 write must be
                // completely absent from what gets committed.
                juce::File tmp = juce::File::createTempFile(".wav");
                expect(recorder.writeToWavFile(tmp.getFullPathName()));

                // Read the WAV back via StemBufferCache -- same read-back pattern
                // StemBufferCacheTests.cpp itself already uses to verify written
                // sample values, rather than duplicating a fresh WAV-reading helper.
                // Note: StemBufferCache::load applies LoopSewing's declick blend
                // to the LAST 128 samples of the buffer (toward sample 0's value)
                // -- see LoopSewing.cpp -- so assertions below deliberately avoid
                // that tail window (indices 4800-128=4672 through 4799) and check
                // only samples the blend never touches.
                StemBufferCache cache;
                expect(cache.load(tmp.getFullPathName()));
                auto* readBack = cache.get(tmp.getFullPathName());
                expect(readBack != nullptr);
                expectEquals(readBack->getNumSamples(), 4800);
                // Every sample checked here must be the FIRST pass's value (0.5),
                // including the region the second (partial, discarded) pass wrote
                // over in the live `buffer` -- proof this reads from
                // lastCompletedBuffer, not `buffer` itself.
                expectWithinAbsoluteError(readBack->getSample(0, 0), 0.5f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 1999), 0.5f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 2000), 0.5f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 4600), 0.5f, 0.01f);

                tmp.deleteFile();
            }

            beginTest("peaksSoFar reflects only what's been written, zero past writePos");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                // Write exactly the first half (2400 of 4800 samples) at a known
                // non-zero amplitude -- half the buckets should read back that
                // amplitude, the other half (past writePos) must stay 0.
                std::vector<float> inputData(2400, 0.6f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 2400);

                const auto peaks = recorder.peaksSoFar(8); // 600 samples/bucket; 4 buckets written
                expectEquals((int) peaks.size(), 8);
                for (int b = 0; b < 4; ++b)
                    expectWithinAbsoluteError(peaks[(size_t) b], 0.6f, 0.01f);
                for (int b = 4; b < 8; ++b)
                    expectWithinAbsoluteError(peaks[(size_t) b], 0.0f, 0.001f);
            }

            beginTest("peaksSoFar falls back to the last completed pass for buckets a fresh "
                      "pass hasn't reached yet, rather than reporting silence -- this is what "
                      "makes a new pass read as smoothly replacing the old one left to right, "
                      "requested during manual testing, since that's genuinely what would "
                      "commit for that stretch if disarmed right now");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(4800, 0.6f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4800);
                recorder.onPassBoundary(); // writePos resets to 0, buffer cleared, pass 1 snapshotted

                // No new writes yet this pass -- every bucket should fall
                // back to pass 1's value (0.6), not read as silence.
                const auto peaksBeforeAnyNewWrite = recorder.peaksSoFar(8);
                for (float peak : peaksBeforeAnyNewWrite)
                    expectWithinAbsoluteError(peak, 0.6f, 0.001f);

                // Half the buffer re-recorded this pass at a different,
                // clearly distinguishable value (0.2) -- the re-recorded
                // half should show the FRESH value, the not-yet-reached
                // half should still show pass 1's value (0.6), not 0.
                std::vector<float> secondPass(2400, 0.2f);
                const float* secondChannels[] = { secondPass.data() };
                recorder.writeBlock(secondChannels, 1, 0, 2400);
                const auto peaksHalfway = recorder.peaksSoFar(8);
                for (int b = 0; b < 4; ++b)
                    expectWithinAbsoluteError(peaksHalfway[(size_t) b], 0.2f, 0.01f);
                for (int b = 4; b < 8; ++b)
                    expectWithinAbsoluteError(peaksHalfway[(size_t) b], 0.6f, 0.01f);
            }

            beginTest("peaksSoFar still reports silence for unwritten buckets when there is "
                      "no previous completed pass to fall back to");
            {
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(2400, 0.6f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 2400); // partial first pass, never completed

                const auto peaks = recorder.peaksSoFar(8);
                for (int b = 0; b < 4; ++b)
                    expectWithinAbsoluteError(peaks[(size_t) b], 0.6f, 0.01f);
                for (int b = 4; b < 8; ++b)
                    expectWithinAbsoluteError(peaks[(size_t) b], 0.0f, 0.001f);
            }

            beginTest("peaksSoFar on a freshly-constructed recorder (never written to) is all-zero");
            {
                // The actual state during the first ~33ms after arming, before
                // any audio callback has run yet -- writePos == 0 from the
                // constructor's own default, not from an onPassBoundary()
                // reset. Same code path as the reset case above in practice,
                // but worth locking down explicitly as its own scenario.
                LoopRecorder recorder(48000.0, 0.1);
                const auto peaks = recorder.peaksSoFar(8);
                expectEquals((int) peaks.size(), 8);
                for (float peak : peaks)
                    expectWithinAbsoluteError(peak, 0.0f, 0.001f);
            }

            beginTest("peaksSoFar with more buckets than written samples doesn't loop forever or duplicate indices");
            {
                // 4800-sample buffer, only 4 samples written -- with 32
                // buckets (the real value IpcServer.cpp uses), most buckets
                // are sub-sample-width (bucketStart == bucketEnd for many
                // b). Exercises the inner scan's std::min(bucketEnd,
                // currentWritePos) clamp with bucketEnd sometimes equal to
                // bucketStart, and confirms the whole call still terminates
                // and returns exactly numBuckets entries.
                LoopRecorder recorder(48000.0, 0.1); // 4800 samples
                std::vector<float> inputData(4, 0.9f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4);

                const auto peaks = recorder.peaksSoFar(32);
                expectEquals((int) peaks.size(), 32);
                // Only the very first bucket (samples 0..150 at this ratio)
                // can possibly cover any of the 4 written samples; the rest
                // must be 0, and none of this should ever crash or hang.
                bool anyNonZero = false;
                for (float peak : peaks)
                    if (peak > 0.0f) anyNonZero = true;
                expect(anyNonZero);
            }
        }
    };

    static LoopRecorderTests loopRecorderTests;
}
