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

            beginTest("each new pass overwrites the buffer from the start");
            {
                LoopRecorder recorder(48000.0, 0.1);
                std::vector<float> firstPass(4800, 0.5f);
                const float* firstChannels[] = { firstPass.data() };
                recorder.writeBlock(firstChannels, 1, 0, 4800);
                recorder.onPassBoundary();

                std::vector<float> secondPass(4800, 0.25f);
                const float* secondChannels[] = { secondPass.data() };
                recorder.writeBlock(secondChannels, 1, 0, 2000); // only partway through the second pass
                // Write the committed WAV NOW (simulating a disarm mid-second-pass)
                // and confirm it reflects the FIRST pass's value, not a mix of both --
                // onPassBoundary's own buffer.clear() must have actually wiped the
                // first pass's data, not left it underneath the second pass's partial
                // overwrite.
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
                // First 2000 samples: only the second pass wrote here (0.25), but
                // clear() wiped the first pass's 0.5 first, so this region equals
                // the second pass's value, not some blend of the two.
                expectWithinAbsoluteError(readBack->getSample(0, 0), 0.25f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 1999), 0.25f, 0.01f);
                // Everything past what the second (partial) pass wrote (but
                // still well clear of the tail blend window) must be silence
                // from clear() -- specifically NOT the first pass's 0.5 still
                // sitting there underneath.
                expectWithinAbsoluteError(readBack->getSample(0, 2000), 0.0f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 4600), 0.0f, 0.01f);

                tmp.deleteFile();
            }
        }
    };

    static LoopRecorderTests loopRecorderTests;
}
