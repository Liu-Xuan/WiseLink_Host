# WiseLink Host source status

Current canonical source: `b1b57306f96bcd3d3f74debf9589f27ccd86549b` (parent `ae9399a4519eeb748509ceefa9bca20e7950636b`).

This snapshot connects current Native identity and scoped Source authorization to daily TDMS intake, exact-member reads and immutable candidate upload associations. The existing three client routes, import receipt and Host version/CAS decisions remain in place. It includes the existing-session Native factory and the selectively reviewed SB pure consumers from Source 0.2.73; newer Source closures are adopted separately after review.

Local validation includes both TypeScript checks, affected consumer tests, receiver PostgreSQL tests and independent member-policy checks. The exact source completed a full build with all 4028 tracked inputs restored, four physical deployment-package checks, and full AppModule startup with nine actual HTTP checks. Full application checks used declared external SDK/database fixtures; the actual entry, 43 modules, 56 controllers, business service/repository/Drizzle reads and refusal paths were preserved, with no model invocation.

[Receiver wiring and Native factory](TDMS_RECEIVER_RUNTIME_20261018.md) documents the code and activation prerequisites. Production database/Source provisioning, live deployment and real ingestion have their own acceptance records. This public tree contains the accepted code and this technical summary; private operational records are excluded.
