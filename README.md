# Portal History Support
Ingress IITC plugin: Portal History Support for all IITC versions (with cache)

With this plugin the Portal History will be implemented into all versions of IITC. This plugin injects functionality from the IITC-CE TEST release (version 0.31.1.20210225.132054) plus extra modifications into all IITC versions (IITC.me 0.26 / IITC-CE 0.31.1). Code will be injected into the IITC core. History results are cached and re-used automatically. Details from your COMMS captured portals are loaded automatically.

This plugin uses code from IITC-CE Beta, combined with extra modifications not found in IITC, to make (all) History plugins work on all versions of IITC.
This plugin changes IITC core functions to enable History data processing. It works also on older versions of IITC.

NIA has designed Intel to only load History at zoom level "all portals". But even then, Intel does not always contain the History data.
To overcome this problem this plugin offers these solutions:
Cache: All received History data is cached, and used when it's missing from Intel.
Gather: For portals of which no history data is received, this plugin can automatically gather the History data by loading all portal details, one by one (when at zoom level all portals or all links).
Detect: Captured portals are mentioned in COMMS (Visits and Scout Control actions are not mentioned). This plugin will almost instantly update the History for all your new captured portals.

This plugin works/was tested on these versions of IITC:
0.26.0.20170108.21732 - IITC.me version
0.31.1 - IITC-CE release version
0.31.1.20210219.164429 - IITC-CE Beta version
0.31.1.20210302.152616 - IITC-CE Beta version
0.31.1.20210219.082130 - IITC-CE Test version
0.31.1.20210225.132054 - IITC-CE Test version
