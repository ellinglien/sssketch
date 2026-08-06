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
            beginTest("starts enabled by default -- ableton::Link's own documented "
                      "default is disabled, but sssketch's LinkSession deliberately "
                      "enables it at construction so Link is on from engine startup "
                      "without requiring a manual per-session toggle");
            {
                LinkSession session(120.0);
                expect(session.isEnabled());
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
                session.setEnabled(false); // sessions now start enabled by default
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
                session.setEnabled(false); // sessions now start enabled by default
                session.pushTempoNow(140.0);
                expectWithinAbsoluteError(session.sessionTempo(), 120.0, 0.01);
            }

            // checkForExternalTempoChange's own "did a PEER change the
            // tempo" detection is gated on numPeers() > 0 (see its own doc
            // comment), and -- same limitation as this file's own top
            // comment already documents for syncTempo's peer-branch --
            // there's no deterministic way to get a real peer connected in
            // this environment (no second Link-enabled process/app on the
            // network). So the tests below cover what's actually testable
            // without one: the disabled/no-peers early-outs, and the
            // (arguably more important) regression case that this
            // session's OWN outbound pushes are never misread as an
            // external change -- exactly the bookkeeping the feedback-loop
            // prevention for the renderer's inbound listener depends on.

            beginTest("checkForExternalTempoChange returns nullopt while disabled");
            {
                LinkSession session(120.0);
                session.setEnabled(false);
                expect(!session.checkForExternalTempoChange().has_value());
            }

            beginTest("checkForExternalTempoChange returns nullopt when enabled with no peers "
                      "and nothing has changed (this test process is alone on the network)");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                expect(session.numPeers() == 0);
                expect(!session.checkForExternalTempoChange().has_value());
            }

            beginTest("checkForExternalTempoChange never reports this session's own "
                      "syncTempo push as an external change -- regression coverage for the "
                      "feedback-loop prevention the renderer's inbound listener relies on: "
                      "if this ever returned a value here, the renderer would echo its own "
                      "tempo change right back out, fighting itself in a loop");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                session.syncTempo(135.0);
                expect(!session.checkForExternalTempoChange().has_value());
            }

            beginTest("checkForExternalTempoChange never reports this session's own "
                      "pushTempoNow push as an external change either, same reasoning as "
                      "the syncTempo case above");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                session.pushTempoNow(150.0);
                expect(!session.checkForExternalTempoChange().has_value());
            }

            beginTest("checkForExternalTempoChange is idempotent when polled repeatedly with "
                      "no intervening tempo change");
            {
                LinkSession session(120.0);
                session.setEnabled(true);
                session.syncTempo(160.0);
                expect(!session.checkForExternalTempoChange().has_value());
                expect(!session.checkForExternalTempoChange().has_value());
                expect(!session.checkForExternalTempoChange().has_value());
            }
        }
    };

    static LinkSessionTests linkSessionTests;
}
