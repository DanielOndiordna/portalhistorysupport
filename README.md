# Portal History Support
Ingress IITC plugin: Portal History Support for all IITC versions (with cache)

With this plugin the Portal History will be implemented into all versions of IITC. This plugin injects functionality from the IITC-CE TEST release (version 0.31.1.20210225.132054) plus extra modifications into all IITC versions (IITC.me / IITC-CE 0.31.1). Code will be injected into the IITC core. History results are cached and re-used automatically. Details from your COMMS captured portals are loaded automatically.

Changelog:

version 0.0.1.20210308.115000
- first release: part of the code was first used inside plugin Unique Portal History, but now moved to this separate plugin
- auto load portal details if no history is returned from entity data, only load details when map status is 'done'
- added comms monitoring for active agent captures
- auto stop/start when zooming in/out and moving the map
- button to refresh history for visible portals
