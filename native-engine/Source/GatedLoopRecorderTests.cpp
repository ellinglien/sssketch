// native-engine/Source/GatedLoopRecorderTests.cpp
#include "GatedLoopRecorder.h"
#include <juce_core/juce_core.h>
#include <vector>

namespace sssketch
{
    namespace
    {
        // 48kHz throughout -- matches every other native test's own
        // convention (TransportTests.cpp, LoopRecorderTests.cpp).
        constexpr double kSampleRate = 48000.0;

        std::vector<float> silence(int numSamples) { return std::vector<float>((size_t) numSamples, 0.0f); }
        std::vector<float> loudTone(int numSamples) { return std::vector<float>((size_t) numSamples, 0.8f); }

        // Reads back just the LEFT channel of what's now always a stereo
        // 16-bit WAV, as floats -- enough for every existing test below
        // that only ever fed a single (then mono-duplicated) input
        // channel, so its left and right channels are identical anyway.
        // See readWavStereo below for tests that need to tell the two
        // channels apart.
        std::vector<float> readWavSamples(const juce::String& path)
        {
            juce::WavAudioFormat wavFormat;
            std::unique_ptr<juce::AudioFormatReader> reader(
                wavFormat.createReaderFor(new juce::FileInputStream(juce::File(path)), true));
            if (reader == nullptr) return {};
            juce::AudioBuffer<float> buf(1, (int) reader->lengthInSamples);
            reader->read(&buf, 0, (int) reader->lengthInSamples, 0, true, false);
            return std::vector<float>(buf.getReadPointer(0), buf.getReadPointer(0) + buf.getNumSamples());
        }

        struct StereoSamples
        {
            std::vector<float> left, right;
            int numChannels = 0;
        };

        // Reads back BOTH channels of a stereo 16-bit WAV -- for tests that
        // specifically need to confirm left and right captured/blended
        // independently, not just a duplicated mono signal.
        StereoSamples readWavStereo(const juce::String& path)
        {
            juce::WavAudioFormat wavFormat;
            std::unique_ptr<juce::AudioFormatReader> reader(
                wavFormat.createReaderFor(new juce::FileInputStream(juce::File(path)), true));
            if (reader == nullptr) return {};
            juce::AudioBuffer<float> buf(2, (int) reader->lengthInSamples);
            reader->read(&buf, 0, (int) reader->lengthInSamples, 0, true, true);
            return { std::vector<float>(buf.getReadPointer(0), buf.getReadPointer(0) + buf.getNumSamples()),
                      std::vector<float>(buf.getReadPointer(1), buf.getReadPointer(1) + buf.getNumSamples()),
                      (int) reader->numChannels };
        }
    }

    class GatedLoopRecorderTests : public juce::UnitTest
    {
    public:
        GatedLoopRecorderTests() : juce::UnitTest("GatedLoopRecorder") {}

        void runTest() override
        {
            beginTest("isGateOpen() is false for a freshly-constructed recorder");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                expect(!recorder.isGateOpen());
            }

            beginTest("stays closed and writes nothing while input stays below the gate threshold");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0); // 4 bars * 2s/bar = 8s loop
                auto quiet = silence(4800); // 0.1s of true silence, well below threshold
                const float* channels[] = { quiet.data() };
                recorder.writeBlock(channels, 1, 0, 4800, 0.0);
                expect(!recorder.isGateOpen());

                const juce::String path =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_silence.wav")
                        .getFullPathName();
                expect(recorder.writeToWavFile(path));
                auto samples = readWavSamples(path);
                for (float s : samples) expectWithinAbsoluteError(s, 0.0f, 0.001f);
            }

            beginTest("opens the gate and captures audio once input crosses the threshold, at the "
                      "correct loop-relative buffer position");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0); // 8s loop = 384000 samples
                auto loud = loudTone(4800); // 0.1s well above threshold
                const float* channels[] = { loud.data() };
                // loopRelativeStartBar=2.0 out of 4.0 bars total -> halfway through the buffer.
                recorder.writeBlock(channels, 1, 0, 4800, 2.0);
                expect(recorder.isGateOpen());

                const juce::String path =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_capture.wav")
                        .getFullPathName();
                expect(recorder.writeToWavFile(path));
                auto samples = readWavSamples(path);
                const int expectedStart = (int) samples.size() / 2; // halfway through the buffer
                // The written span should be non-silent starting at the expected position...
                expectWithinAbsoluteError(samples[(size_t) expectedStart], 0.8f, 0.05f);
                // ...and silent well before it (nothing captured there this lap).
                expectWithinAbsoluteError(samples[(size_t) expectedStart - 1000], 0.0f, 0.001f);
            }

            beginTest("keeps writing through a brief dip below threshold (release hangover), "
                      "rather than cutting off the instant level drops");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                auto loud = loudTone(4800);
                auto quiet = silence(4800);
                const float* loudChannels[] = { loud.data() };
                const float* quietChannels[] = { quiet.data() };

                recorder.writeBlock(loudChannels, 1, 0, 4800, 0.0);
                expect(recorder.isGateOpen());
                // A short dip well inside the several-second hangover -- gate should still
                // read as open, and this block's own (silent) content should still be written
                // (capturing straight through the dip, not truncating it).
                recorder.writeBlock(quietChannels, 1, 0, 4800, 0.1);
                expect(recorder.isGateOpen());
            }

            beginTest("closes the gate once the input has been below threshold for the full "
                      "release hangover duration");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                auto loud = loudTone(4800);
                auto quiet = silence(48000); // 1s per block
                const float* loudChannels[] = { loud.data() };
                const float* quietChannels[] = { quiet.data() };

                double pos = 0.0;
                recorder.writeBlock(loudChannels, 1, 0, 4800, pos);
                pos += 4800.0 / kSampleRate / 2.0; // bars advanced (secPerBar=2.0)
                expect(recorder.isGateOpen());

                // Feed well over 6 seconds of continuous silence, one second at a time.
                for (int i = 0; i < 8; ++i)
                {
                    recorder.writeBlock(quietChannels, 1, 0, 48000, pos);
                    pos += 48000.0 / kSampleRate / 2.0;
                }
                expect(!recorder.isGateOpen());
            }

            beginTest("never clears the buffer between laps, so a lock-in backfills from an "
                      "earlier lap wherever the current lap hasn't (re)written a position");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                auto loud = loudTone(4800);
                const float* channels[] = { loud.data() };
                // First lap: capture something near the start.
                recorder.writeBlock(channels, 1, 0, 4800, 0.0);

                const juce::String path1 =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_lap1.wav")
                        .getFullPathName();
                recorder.writeToWavFile(path1);
                auto lap1 = readWavSamples(path1);
                expectWithinAbsoluteError(lap1[0], 0.8f, 0.05f);

                // Let the release hangover fully expire (same pattern as the "closes the
                // gate" test above) advancing well past position 0 first, so the gate is
                // genuinely closed -- not just still coasting on hangover from the write
                // above -- by the time the new lap reaches position 0 again.
                auto quiet = silence(48000);
                const float* quietChannels[] = { quiet.data() };
                double pos = 0.05; // just past the loud write, matching its own advance
                for (int i = 0; i < 8; ++i)
                {
                    recorder.writeBlock(quietChannels, 1, 0, 48000, pos);
                    pos += 48000.0 / kSampleRate / 2.0;
                }
                expect(!recorder.isGateOpen());

                // New lap begins -- position wraps back down to 0 instead of continuing to
                // advance. Below-threshold and the gate is genuinely closed now, so nothing
                // new gets written at this position -- the earlier lap's audio there should
                // still be present (backfilled), not cleared, so a lock-in during this lap
                // still reflects a full loop.
                auto quietShort = silence(4800);
                const float* quietShortChannels[] = { quietShort.data() };
                recorder.writeBlock(quietShortChannels, 1, 0, 4800, 0.0);
                expect(!recorder.isGateOpen());

                const juce::String path2 =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_lap2.wav")
                        .getFullPathName();
                recorder.writeToWavFile(path2);
                auto lap2 = readWavSamples(path2);
                expectWithinAbsoluteError(lap2[0], 0.8f, 0.05f);
            }

            beginTest("writeBlock duplicates a mono (single-channel) input onto BOTH output "
                      "channels, rather than leaving channel 1 silent -- per direct feedback "
                      "(\"is it recording in stereo? it seems like mono\"), this recorder's "
                      "own output is always stereo now regardless of what the input device "
                      "provides");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                auto mono = loudTone(4800);
                const float* channels[] = { mono.data() };
                recorder.writeBlock(channels, 1, 0, 4800, 0.0);

                const juce::String path =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_mono_duplicated.wav")
                        .getFullPathName();
                expect(recorder.writeToWavFile(path));
                auto stereo = readWavStereo(path);
                expectEquals(stereo.numChannels, 2);
                expectWithinAbsoluteError(stereo.left[0], 0.8f, 0.05f);
                expectWithinAbsoluteError(stereo.right[0], 0.8f, 0.05f);
            }

            beginTest("writeBlock captures real stereo -- two distinct input channels land on "
                      "their own matching output channel, not averaged/downmixed together");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                std::vector<float> left(4800, 0.2f);
                std::vector<float> right(4800, 0.8f);
                const float* channels[] = { left.data(), right.data() };
                recorder.writeBlock(channels, 2, 0, 4800, 0.0);

                const juce::String path =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_stereo_capture.wav")
                        .getFullPathName();
                expect(recorder.writeToWavFile(path));
                auto stereo = readWavStereo(path);
                expectEquals(stereo.numChannels, 2);
                expectWithinAbsoluteError(stereo.left[0], 0.2f, 0.05f);
                expectWithinAbsoluteError(stereo.right[0], 0.8f, 0.05f);
            }

            beginTest("writeToWavFile can be called repeatedly without disrupting ongoing capture "
                      "-- locking in a take doesn't stop or reset the recorder");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0);
                auto loud = loudTone(4800);
                const float* channels[] = { loud.data() };
                recorder.writeBlock(channels, 1, 0, 4800, 0.0);

                const juce::String path =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_lockin.wav")
                        .getFullPathName();
                expect(recorder.writeToWavFile(path));
                // Still open/capturing right after -- writeToWavFile didn't detach anything.
                expect(recorder.isGateOpen());
                recorder.writeBlock(channels, 1, 4800, 4800, 0.1);
                expect(recorder.isGateOpen());
                expect(recorder.writeToWavFile(path)); // callable again, still fine
            }

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

            beginTest("writeToWavFile blends the buffer's own loop seam -- the exported tail "
                      "eases toward the head's value instead of jumping, so the take tiles "
                      "seamlessly once looped on playback");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0); // 8s loop = 384000 samples
                auto head = loudTone(2400); // fills exactly the fade window (50ms @ 48kHz) at 0.8
                const float* headChannels[] = { head.data() };
                recorder.writeBlock(headChannels, 1, 0, 2400, 0.0);

                // Distinct tail value (0.3) filling the last 4800 samples of the buffer --
                // still comfortably more than the (now longer) fade window, so most of it
                // stays untouched by the blend.
                auto tail = std::vector<float>(4800, 0.3f);
                const float* tailChannels[] = { tail.data() };
                // startPos = 384000 - 4800 = 379200 samples -> as a loop-relative bar position.
                const double tailStartBar = (384000.0 - 4800.0) / 384000.0 * 4.0;
                recorder.writeBlock(tailChannels, 1, 0, 4800, tailStartBar);

                const juce::String path =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_seamblend.wav")
                        .getFullPathName();
                expect(recorder.writeToWavFile(path));
                auto samples = readWavSamples(path);
                const int n = (int) samples.size();

                // Well before the fade region: untouched, still the plain tail value.
                expectWithinAbsoluteError(samples[(size_t) (n - 4800 + 100)], 0.3f, 0.05f);
                // Right at the very last sample: fully eased to the head's own value.
                expectWithinAbsoluteError(samples[(size_t) (n - 1)], 0.8f, 0.05f);
                // Partway into the fade: strictly between the tail and head values --
                // true of both the old linear curve and the new equal-power one, so this
                // alone doesn't distinguish them (see the stereo blend test below for
                // regression coverage of the specific bug fixed alongside the curve
                // change: the blend used to only touch channel 0).
                const float midFade = samples[(size_t) (n - 2400 + 1200)];
                expect(midFade > 0.3f && midFade < 0.8f);

                // The head itself is left untouched by the blend.
                expectWithinAbsoluteError(samples[0], 0.8f, 0.05f);
            }

            beginTest("writeToWavFile blends BOTH channels at the loop seam, not just channel "
                      "0 -- regression coverage for the mono-only blend this recorder had "
                      "before real stereo capture landed (would have left channel 1's own "
                      "seam completely unblended)");
            {
                GatedLoopRecorder recorder(kSampleRate, 4.0, 2.0); // 8s loop = 384000 samples
                std::vector<float> headL(2400, 0.8f);
                std::vector<float> headR(2400, 0.6f);
                const float* headChannels[] = { headL.data(), headR.data() };
                recorder.writeBlock(headChannels, 2, 0, 2400, 0.0);

                std::vector<float> tailL(4800, 0.3f);
                std::vector<float> tailR(4800, 0.2f);
                const float* tailChannels[] = { tailL.data(), tailR.data() };
                const double tailStartBar = (384000.0 - 4800.0) / 384000.0 * 4.0;
                recorder.writeBlock(tailChannels, 2, 0, 4800, tailStartBar);

                const juce::String path =
                    juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("sssketch_gated_seamblend_stereo.wav")
                        .getFullPathName();
                expect(recorder.writeToWavFile(path));
                auto stereo = readWavStereo(path);
                expectEquals(stereo.numChannels, 2);
                const int n = (int) stereo.left.size();

                // Both channels fully eased to their own head value at the very last sample.
                expectWithinAbsoluteError(stereo.left[(size_t) (n - 1)], 0.8f, 0.05f);
                expectWithinAbsoluteError(stereo.right[(size_t) (n - 1)], 0.6f, 0.05f);
                // Both channels strictly mid-transition partway into the fade -- if the
                // blend still only touched channel 0, the right channel here would read
                // exactly 0.2 (the plain, unblended tail value) instead.
                const float midLeft = stereo.left[(size_t) (n - 2400 + 1200)];
                const float midRight = stereo.right[(size_t) (n - 2400 + 1200)];
                expect(midLeft > 0.3f && midLeft < 0.8f);
                expect(midRight > 0.2f && midRight < 0.6f);
            }
        }
    };

    static GatedLoopRecorderTests gatedLoopRecorderTests;
}
