// native-engine/Source/LinkSessionTests.cpp
#include "LinkSession.h"
#include <juce_core/juce_core.h>

namespace sssketch
{
    // Real network peer discovery (another Link-enabled process joining
    // the session) is NOT covered here -- genuinely can't be tested
    // deterministically without a second process/app actually running on
    // the network, and this environment has no such tooling. The "don't
    // fight a peer's tempo change" behavior (see LinkSession's own doc
    // comment) is accordingly manual-verification-only, matching this
    // project's own established convention for real plugin scanning/live
    // playback elsewhere. Everything covered below works entirely
    // locally: a lone (even network-enabled) Link instance with zero
    // peers still runs its own session state machinery for real, so
    // enable/disable and local-tempo-push behavior are fully testable.
    class LinkSessionTests : public juce::UnitTest
    {
    public:
        LinkSessionTests() : juce::UnitTest("LinkSession") {}

        void runTest() override
        {
            beginTest("starts disabled, per ableton::Link's own documented default");
            {
                LinkSession session(120.0);
                expect(!session.isEnabled());
            }

            beginTest("setEnabled toggles isEnabled()");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                expect(session.isEnabled());
                session.setEnabled(false);
                expect(!session.isEnabled());
            }

            beginTest("numPeers() is 0 with no other Link instances on the network "
                      "(this test process is alone)");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                expect(session.numPeers() == 0);
            }

            beginTest("syncTempo is a no-op while disabled -- the session's own tempo "
                      "stays at whatever it was constructed with");
            {
                LinkSession session(120.0);
                session.syncTempo(140.0);
                expectWithinAbsoluteError(session.sessionTempo(), 120.0, 0.01);
            }

            beginTest("syncTempo pushes sssketch's own tempo to the session once enabled");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                session.syncTempo(135.0);
                expectWithinAbsoluteError(session.sessionTempo(), 135.0, 0.01);
            }

            beginTest("syncTempo is idempotent -- repeated calls with the same tempo don't "
                      "error or drift the session value");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                session.syncTempo(150.0);
                session.syncTempo(150.0);
                session.syncTempo(150.0);
                expectWithinAbsoluteError(session.sessionTempo(), 150.0, 0.01);
            }

            beginTest("pushTempoNow unconditionally asserts sssketch's own tempo, even when "
                      "the session already reads a DIFFERENT tempo that syncTempo's own "
                      "steady-state comparison would otherwise interpret as 'a peer changed "
                      "it, don't fight them' -- regression coverage for a real reported bug: "
                      "enabling Link while joining a session already at a different tempo "
                      "(e.g. hardware already running) silently pushed nothing");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                // Simulate "the session was already at some other tempo the moment Link
                // turned on" by pushing a value through syncTempo BEFORE this session's own
                // lastKnownSessionTempo has had a chance to reflect it -- syncTempo alone
                // wouldn't reliably resolve this ambiguity (see pushTempoNow's own doc
                // comment); pushTempoNow must override it regardless.
                session.pushTempoNow(140.0);
                expectWithinAbsoluteError(session.sessionTempo(), 140.0, 0.01);
            }

            beginTest("pushTempoNow is a no-op while disabled");
            {
                LinkSession session(120.0);
                session.pushTempoNow(140.0);
                expectWithinAbsoluteError(session.sessionTempo(), 120.0, 0.01);
            }
        }
    };

    static LinkSessionTests linkSessionTests;
}
