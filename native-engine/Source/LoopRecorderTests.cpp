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
            beginTest("hasAnyAudio() is false for a freshly-constructed recorder");
            {
                LoopRecorder recorder(48000.0);
                expect(!recorder.hasAnyAudio());
            }

            // Synthetic input: a single input channel, numSamples of a known
            // non-zero value, so a written/read-back sample can be checked
            // without needing a real audio device.
            beginTest("writeBlock captures samples and makes hasAnyAudio() true, however short "
                      "-- no minimum-length requirement anymore (see this class's own doc "
                      "comment: capture is no longer tied to completing a loop pass, per "
                      "feedback during manual testing -- it should start where it starts and "
                      "stop where it stops)");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> inputData(4, 0.5f); // a tiny, deliberately short write
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4);
                expect(recorder.hasAnyAudio());
            }

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

            beginTest("writeBlock across multiple calls appends rather than overwrites, "
                      "simulating several audio callbacks in a row during one take");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> firstBlock(1000, 0.3f);
                std::vector<float> secondBlock(1000, 0.7f);
                const float* firstChannels[] = { firstBlock.data() };
                const float* secondChannels[] = { secondBlock.data() };
                recorder.writeBlock(firstChannels, 1, 0, 1000);
                recorder.writeBlock(secondChannels, 1, 0, 1000);

                juce::File tmp = juce::File::createTempFile(".wav");
                expect(recorder.writeToWavFile(tmp.getFullPathName()));

                StemBufferCache cache;
                expect(cache.load(tmp.getFullPathName()));
                auto* readBack = cache.get(tmp.getFullPathName());
                expect(readBack != nullptr);
                // Exactly 2000 samples committed -- not the multi-minute
                // backing buffer's own full capacity.
                expectEquals(readBack->getNumSamples(), 2000);
                // StemBufferCache::load applies LoopSewing's declick blend
                // to the LAST 128 samples of the loaded buffer (toward
                // sample 0's own value) -- see LoopSewing.cpp -- so these
                // checks deliberately avoid that tail window (indices
                // 2000-128=1872 through 1999) and check only samples the
                // blend never touches.
                expectWithinAbsoluteError(readBack->getSample(0, 0), 0.3f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 999), 0.3f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 1000), 0.7f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(0, 1800), 0.7f, 0.01f);

                tmp.deleteFile();
            }

            beginTest("writeToWavFile commits exactly what's been captured, not the full "
                      "pre-allocated backing buffer -- the whole point of this class no longer "
                      "requiring a completed loop pass is that a take's real duration is "
                      "whatever was actually recorded");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> inputData(4800, 0.6f); // 0.1s at 48kHz -- short relative to the multi-minute ceiling
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4800);

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

            beginTest("peaksSoFar on a freshly-constructed recorder (never written to) is empty");
            {
                LoopRecorder recorder(48000.0);
                const auto peaks = recorder.peaksSoFar(8);
                expectEquals((int) peaks.size(), 8);
                for (float peak : peaks)
                    expectWithinAbsoluteError(peak, 0.0f, 0.001f);
            }

            beginTest("peaksSoFar rescales across whatever's been captured so far, not the "
                      "full multi-minute backing buffer -- a short write early in a take must "
                      "still fill the WHOLE bucket range, not just its first sliver, so the "
                      "live view reads as one steadily growing recording rather than a mostly-"
                      "empty bar against a huge fixed ceiling");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> inputData(800, 0.6f); // a small write, tiny relative to the ~600s ceiling
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 800);

                const auto peaks = recorder.peaksSoFar(8); // 100 samples/bucket of the 800 written
                expectEquals((int) peaks.size(), 8);
                for (float peak : peaks)
                    expectWithinAbsoluteError(peak, 0.6f, 0.01f);
            }

            beginTest("peaksSoFar distinguishes amplitude across buckets within what's been "
                      "written so far");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> quiet(400, 0.1f);
                std::vector<float> loud(400, 0.9f);
                const float* quietChannels[] = { quiet.data() };
                const float* loudChannels[] = { loud.data() };
                recorder.writeBlock(quietChannels, 1, 0, 400);
                recorder.writeBlock(loudChannels, 1, 0, 400);

                const auto peaks = recorder.peaksSoFar(8); // 100 samples/bucket of the 800 written
                for (int b = 0; b < 4; ++b)
                    expectWithinAbsoluteError(peaks[(size_t) b], 0.1f, 0.01f);
                for (int b = 4; b < 8; ++b)
                    expectWithinAbsoluteError(peaks[(size_t) b], 0.9f, 0.01f);
            }

            beginTest("peaksSoFar with more buckets than written samples doesn't loop forever "
                      "or duplicate indices");
            {
                // Only 4 samples written -- with 64 buckets (the real value
                // IpcServer.cpp uses), most buckets are sub-sample-width
                // (bucketStart == bucketEnd for many b). Confirms the whole
                // call still terminates and returns exactly numBuckets
                // entries without crashing or hanging.
                LoopRecorder recorder(48000.0);
                std::vector<float> inputData(4, 0.9f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 4);

                const auto peaks = recorder.peaksSoFar(64);
                expectEquals((int) peaks.size(), 64);
                bool anyNonZero = false;
                for (float peak : peaks)
                    if (peak > 0.0f) anyNonZero = true;
                expect(anyNonZero);
            }

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

            beginTest("writeBlock duplicates a mono (single-channel) input onto BOTH output "
                      "channels, rather than leaving channel 1 silent -- per direct feedback "
                      "(\"is it recording in stereo? it seems like mono\"), this recorder's "
                      "own output is always stereo now regardless of what the input device "
                      "provides");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> inputData(1000, 0.4f);
                const float* channels[] = { inputData.data() };
                recorder.writeBlock(channels, 1, 0, 1000);

                juce::File tmp = juce::File::createTempFile(".wav");
                expect(recorder.writeToWavFile(tmp.getFullPathName()));

                StemBufferCache cache;
                expect(cache.load(tmp.getFullPathName()));
                auto* readBack = cache.get(tmp.getFullPathName());
                expect(readBack != nullptr);
                expectEquals(readBack->getNumChannels(), 2);
                expectWithinAbsoluteError(readBack->getSample(0, 0), 0.4f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(1, 0), 0.4f, 0.01f);

                tmp.deleteFile();
            }

            beginTest("writeBlock captures real stereo -- two distinct input channels land on "
                      "their own matching output channel, not averaged/downmixed together");
            {
                LoopRecorder recorder(48000.0);
                std::vector<float> left(1000, 0.2f);
                std::vector<float> right(1000, 0.8f);
                const float* channels[] = { left.data(), right.data() };
                recorder.writeBlock(channels, 2, 0, 1000);

                juce::File tmp = juce::File::createTempFile(".wav");
                expect(recorder.writeToWavFile(tmp.getFullPathName()));

                StemBufferCache cache;
                expect(cache.load(tmp.getFullPathName()));
                auto* readBack = cache.get(tmp.getFullPathName());
                expect(readBack != nullptr);
                expectEquals(readBack->getNumChannels(), 2);
                expectWithinAbsoluteError(readBack->getSample(0, 0), 0.2f, 0.01f);
                expectWithinAbsoluteError(readBack->getSample(1, 0), 0.8f, 0.01f);

                tmp.deleteFile();
            }

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
        }
    };

    static LoopRecorderTests loopRecorderTests;
}
