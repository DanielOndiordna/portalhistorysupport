// ==UserScript==
// @author         DanielOnDiordna
// @name           IITC plugin: Portal History Support for all IITC versions (with cache)
// @category       Tweak
// @version        0.0.1.20210313.210700
// @updateURL      https://softspot.nl/ingress/plugins/iitc-plugin-portalhistorysupport.meta.js
// @downloadURL    https://softspot.nl/ingress/plugins/iitc-plugin-portalhistorysupport.user.js
// @description    [danielondiordna-0.0.1.20210313.210700] With this plugin the Portal History will be implemented into all versions of IITC. This plugin injects functionality from the IITC-CE TEST release (version 0.31.1.20210225.132054) plus extra modifications into all IITC versions (IITC.me / IITC-CE 0.31.1). Code will be injected into the IITC core. History results are cached and re-used automatically. Details from your COMMS captured portals are loaded automatically. Requires CORE subscription.
// @id             iitc-plugin-portalhistorysupport@danielondiordna
// @namespace      https://softspot.nl/ingress/
// @match          https://intel.ingress.com/*
// @grant          none
// ==/UserScript==

function wrapper(plugin_info) {
    // ensure plugin framework is there, even if iitc is not yet loaded
    if(typeof window.plugin !== 'function') window.plugin = function() {};

    // use own namespace for plugin
    window.plugin.portalhistorysupport = function() {};
    var self = window.plugin.portalhistorysupport;
    self.id = 'portalhistorysupport';
    self.title = 'Portal History Support';
    self.version = '0.0.1.20210313.210700';
    self.author = 'DanielOnDiordna';
    self.changelog = `
Changelog:

version 0.0.1.20210313.210700
- first release: part of the code was first used inside plugin Unique Portal History, but now moved to this separate plugin
- auto load portal details if no history is returned from entity data, only load details when map status is 'done'
- added comms monitoring for active agent captures
- auto stop/start when zooming in/out and moving the map
`;
    self.namespace = 'window.plugin.' + self.id + '.';
    self.pluginname = 'plugin-' + self.id;

    self.localstoragecache = self.pluginname + '-cache'; // localStorage["plugin-portalhistorysupport-cache"]
    self.cache = {}; // storage format: { window.PLAYER.nickname: { guid: bitarray } }

    self.localstoragesettings = self.pluginname + '-settings';
    self.settings = {};
    self.settings.autoloadmissinghistory = false;

    self.loadDetails = {
        MaxTime: 1000,
        Delay: 100,
        guid: undefined,
        DelayTimerID: undefined,
        TimeoutID: undefined,
        StartTimerID: undefined
    };

    self.commsCapturedPortals = {
        latlngportals: {},
        guidlist: {}
    };

    self.restoresettings = function() {
        if (typeof localStorage[self.localstoragesettings] === 'string' && localStorage[self.localstoragesettings] !== '') {
            try {
                var settings = JSON.parse(localStorage[self.localstoragesettings]);
                if (typeof settings === 'object' && settings instanceof Object && !(settings instanceof Array)) {
                    for (const i in self.settings) {
                        if (i in settings && typeof settings[i] === typeof self.settings[i]) self.settings[i] = settings[i];
                    }
                }
            } catch(e) {
                return false;
            }
        }
    };
    self.storesettings = function() {
        localStorage[self.localstoragesettings] = JSON.stringify(self.settings);
    };

    self.restorecache = function() {
        if (typeof localStorage[self.localstoragecache] == 'string' && localStorage[self.localstoragecache] != '') {
            try {
                var cache = JSON.parse(localStorage[self.localstoragecache]);
                if (typeof cache == 'object' && cache instanceof Object && !(cache instanceof Array)) {
                    self.cache = cache;
                }
                if (typeof self.cache[window.PLAYER.nickname] != 'object') {
                    self.cache[window.PLAYER.nickname] = {};
                }
            } catch(e) {
                return false;
            }
        }
    };
    self.storecache = function() {
        localStorage[self.localstoragecache] = JSON.stringify(self.cache);
    };

    self.countcache = function() {
        let count = {
            totalcache: 0,
            cachenevervisited: 0,
            cachevisited: 0,
            cachenevercaptured: 0,
            cachecaptured: 0,
            cachescoutControlled: 0,
            visibleportals: 0,
            visibleportalswithhistorycache: 0,
            visibleportalswithouthistorycache: 0,
            nevervisited: 0,
            visited: 0,
            captured: 0,
            scoutControlled: 0,
        }

        count.totalcache = Object.keys(self.cache[window.PLAYER.nickname]).length;
        for (const guid in self.cache[window.PLAYER.nickname]) {
            let bitarray = self.cache[window.PLAYER.nickname][guid];
            let history = self.decodeHistory(bitarray);
            if (history.visited) count.cachevisited++; else count.cachenevervisited++;
            if (history.captured) count.cachecaptured++; else count.cachenevercaptured++;
            if (history.scoutControlled) count.cachescoutControlled++;
        }

        let displayBounds = window.map.getBounds();
        for (const guid in window.portals) {
            let portal = window.portals[guid];
            if (displayBounds.contains(portal.getLatLng())) {
                count.visibleportals++;
                let history = window.portals[guid].options.data.history;
                if (history.visited) count.visited++; else count.nevervisited++;
                if (history.captured) count.captured++;
                if (history.scoutControlled) count.scoutControlled++;
                if (self.cache[window.PLAYER.nickname][guid] == undefined) {
                    count.visibleportalswithouthistorycache++;
                } else {
                    count.visibleportalswithhistorycache++;
                }
            }
        }

        return count;
    };

    self.decodeHistory = function(bitarray) {
        return {
            _raw: bitarray,
            visited:  !!(bitarray & (1|2|4)),
            captured: !!(bitarray & 2),
            scoutControlled: !!(bitarray & 4)
        };
    };

    self.getcache = function(guid) {
        if (!guid) return self.cache[window.PLAYER.nickname]; // return all
        return self.cache[window.PLAYER.nickname][guid]; // return one, or undefined if not found
    };

    self.addcache = function(guid,bitarray) {
        if (bitarray == undefined) return self.cache[window.PLAYER.nickname][guid];
        if (self.cache[window.PLAYER.nickname][guid] == bitarray) return bitarray; // no change

        // do not downgrade to 0 if cache is not 0
        // posible values:
        //   0 (000) = never visited/captured/scoutControled
        //   1 (001) = visited
        //   2 (010) = captured (can never happen, always visited)
        //   3 (011) = visited + captured
        //   4 (100) = scoutControled (can never happen, always visited)
        //   5 (101) = visited + scoutControled
        //   6 (110) = captured + scoutControled (can never happen, always visited)
        //   7 (111) = visited + captured+scoutControled

        if (self.cache[window.PLAYER.nickname][guid] > 0 && bitarray == 0) return self.cache[window.PLAYER.nickname][guid];

        self.cache[window.PLAYER.nickname][guid] = bitarray;
        self.storecache();

        return bitarray;
    };

    self.deletecache = function(guid) {
        delete self.cache[window.PLAYER.nickname][guid];
    };

    self.setupDecodeArrayPortal = function() {
        // sadly the entity_decode.js module has no global functions for easy core code injections
        // it must be done the hard way: copy and rewrite all functions
        // change function: window.decodeArray.portal

        var log = console;
        if (typeof ulog == 'function') log = ulog('entity_decode'); // only for IITC-CE
        // decode the on-network array entity format into an object format closer to that used before
        // makes much more sense as an object, means that existing code didn't need to change, and it's what the
        // stock intel site does internally too (the array format is only on the network)

        window.decodeArray = function(){};

        function parseMod(arr) {
            if (!arr) { return null; }
            return {
                owner: arr[0],
                name: arr[1],
                rarity: arr[2],
                stats: arr[3],
            };
        }
        function parseResonator(arr) {
            if (!arr) { return null; }
            return {
                owner: arr[0],
                level: arr[1],
                energy: arr[2],
            };
        }
        function parseArtifactBrief(arr) {
            if (!arr) { return null; }

            // array index 0 is for fragments at the portal. index 1 is for target portals
            // each of those is two dimensional - not sure why. part of this is to allow for multiple types of artifacts,
            // with their own targets, active at once - but one level for the array is enough for that

            // making a guess - first level is for different artifact types, second index would allow for
            // extra data for that artifact type

            function decodeArtifactArray(arr) {
                var result = {};
                for (var i=0; i<arr.length; i++) {
                    // we'll use the type as the key - and store any additional array values as the value
                    // that will be an empty array for now, so only object keys are useful data
                    result[arr[i][0]] = arr[i].slice(1);
                }
                return result;
            }

            return {
                fragment: decodeArtifactArray(arr[0]),
                target: decodeArtifactArray(arr[1]),
            };
        }

        function parseArtifactDetail(arr) {
            if (!arr) { return null; }
            // empty artifact data is pointless - ignore it
            if (arr.length === 3 && arr[0] === '' && arr[1] === '' && arr[2].length === 0) {
                return null;
            }
            return {
                type: arr[0],
                displayName: arr[1],
                fragments: arr[2],
            };
        }

        function parseHistoryDetail(bitarray) {
            return {
                _raw: bitarray,
                visited:  !!(bitarray & 1),
                captured: !!(bitarray & 2),
                scoutControlled:  !!(bitarray & 4),
            };
        }


        //there's also a 'placeholder' portal - generated from the data in links/fields. only has team/lat/lng

        var CORE_PORTAL_DATA_LENGTH = 4;
        function corePortalData(a) {
            return {
                // a[0] == type (always 'p')
                team:          a[1],
                latE6:         a[2],
                lngE6:         a[3]
            }
        }

        var SUMMARY_PORTAL_DATA_LENGTH = 14;
        var DETAILED_PORTAL_DATA_LENGTH = SUMMARY_PORTAL_DATA_LENGTH+4;
        var EXTENDED_PORTAL_DATA_LENGTH = DETAILED_PORTAL_DATA_LENGTH+1;
        function summaryPortalData(a) {
            return {
                level:         a[4],
                health:        a[5],
                resCount:      a[6],
                image:         a[7],
                title:         a[8],
                ornaments:     a[9],
                mission:       a[10],
                mission50plus: a[11],
                artifactBrief: parseArtifactBrief(a[12]),
                timestamp:     a[13]
            };
        }

        function detailsPortalData(a) {
            return {
                mods:           a[SUMMARY_PORTAL_DATA_LENGTH+0].map(parseMod),
                resonators:     a[SUMMARY_PORTAL_DATA_LENGTH+1].map(parseResonator),
                owner:          a[SUMMARY_PORTAL_DATA_LENGTH+2],
                artifactDetail: parseArtifactDetail(a[SUMMARY_PORTAL_DATA_LENGTH+3])
            }
        }

        function extendedPortalData(a) {
            return {
                history: parseHistoryDetail(a[DETAILED_PORTAL_DATA_LENGTH]), // modified to accept undefined, not default to 0
            }
        }


        window.decodeArray.dataLen = {
            core: [CORE_PORTAL_DATA_LENGTH,EXTENDED_PORTAL_DATA_LENGTH],
            summary: [SUMMARY_PORTAL_DATA_LENGTH],
            detailed: [EXTENDED_PORTAL_DATA_LENGTH, DETAILED_PORTAL_DATA_LENGTH],
            extended: [EXTENDED_PORTAL_DATA_LENGTH, SUMMARY_PORTAL_DATA_LENGTH],
            anyknown: [CORE_PORTAL_DATA_LENGTH, SUMMARY_PORTAL_DATA_LENGTH, DETAILED_PORTAL_DATA_LENGTH, EXTENDED_PORTAL_DATA_LENGTH]
        };

        window.decodeArray.portal = function(a, details) {
            if (!a) {
                log.warn('Argument not specified');
                return;
            }

            if (a[0] !== 'p') {
                throw new Error('decodeArray.portal: not a portal');
            }

            details = details || 'anyknown';
            var expected = window.decodeArray.dataLen[details];
            if (expected.indexOf(a.length) === -1) {
                log.warn('Unexpected portal data length: ' + a.length + ' (' + details + ')');
                debugger;
            }

            var data = corePortalData(a);

            if (a.length >= SUMMARY_PORTAL_DATA_LENGTH) {
                $.extend(data, summaryPortalData(a));
            }

            if (a.length >= DETAILED_PORTAL_DATA_LENGTH) {
                if (a[SUMMARY_PORTAL_DATA_LENGTH]) {
                    $.extend(data, detailsPortalData(a));
                } else if (details === 'detailed') {
                    log.warn('Portal details missing',details,a);
                    debugger;
                }
            }

            if (a.length >= EXTENDED_PORTAL_DATA_LENGTH || details === 'extended' || details === 'detailed') {
                $.extend(data, extendedPortalData(a));
            }

            return data;
        };

        window.decodeArray.portalSummary = function(a) { // deprecated!! but added to support older versions of IITC
            return window.decodeArray.portal(a, 'summary');
        };

        window.decodeArray.portalDetail = function(a) { // deprecated!! but added to support older versions of IITC
            return window.decodeArray.portal(a, 'detailed');
        };
    };

    self.setupCreatePortalEntity = function() {
        // change core function for older versions of IITC to match functions of IITC Test:

        let createPortalEntitystring = window.mapDataRequest.render.createPortalEntity.toString();

        // move var data line up in the function:
        createPortalEntitystring = createPortalEntitystring.replace('var data = decodeArray.portalSummary(ent[2]);\n',''); // older versions of IITC

        createPortalEntitystring = createPortalEntitystring.replace(/function.*var portalLevel/s,
            'function(ent, details) { // details expected in decodeArray.portal\n' +
            '  this.seenPortalsGuid[ent[0]] = true;  // flag we\'ve seen it\n' +
            '\n' +
            '  var previousData = undefined;\n' +
            '  if (details != "core") {\n' +
            '    while (ent[2].length < 19) ent[2].push(null);\n' +
            '    ent[2][18] = ' + self.namespace + 'addcache(ent[0],ent[2][18]); // store value, or restore if other value in cache\n' +
            '  }\n' +
            '\n' +
            '  //var data = decodeArray.portal(ent[2], details); // changed line:\n' +
            '  var data = decodeArray.portal(ent[2], details || \'extended\');\n' +
            '  if (!data.history || data.history._raw == undefined) data.history = ' + self.namespace + 'decodeHistory(' + self.namespace + 'getcache(ent[0])); // added line\n' +
            '\n' +
            '  // check if entity already exists\n' +
            '  if (ent[0] in window.portals) {\n' +
            '    // yes. now check to see if the entity data we have is newer than that in place\n' +
            '    var p = window.portals[ent[0]];\n' +
            '\n' +
            '    // if (!data.history || p.options.data.history === data.history) // changed line:\n' +
            '    if (p.options.data.history._raw == data.history._raw)\n' +
            '      if (p.options.timestamp >= ent[1]) {\n' +
            '        return; // this data is identical or older - abort processing\n' +
            '      }\n' +
            '\n' +
            '    // the data we have is newer. many data changes require re-rendering of the portal\n' +
            '    // (e.g. level changed, so size is different, or stats changed so highlighter is different)\n' +
            '    // so to keep things simple we\'ll always re-create the entity in this case\n' +
            '\n' +
            '    // remember the old details, for the callback\n' +
            '\n' +
            '    previousData = p.options.data;\n' +
            '\n' +
            '    // preserve history\n' +
            '    //if (!data.history) { // disabled line\n' +
            '    //  data.history = previousData.history; // disabled line\n' +
            '    //} // disabled line\n' +
            '\n' +
            '    this.deletePortalEntity(ent[0]);\n' +
            '  }\n' +
            '\n' +
            '  var portalLevel');
        if (createPortalEntitystring.match('log.log')) createPortalEntitystring = createPortalEntitystring.replace('\n','\n  var log = ulog(\'map_data_render\');\n'); // IITC-CE fix
        eval('window.mapDataRequest.render.createPortalEntity = ' + createPortalEntitystring);
/*
        createPortalEntitystring = createPortalEntitystring.replace('function(ent)','function(ent, details)');

        // move var data line up in the function:
        createPortalEntitystring = createPortalEntitystring.replace('var data = decodeArray.portalSummary(ent[2]);','');
        createPortalEntitystring = createPortalEntitystring.replace('(ent[2], details);',"(ent[2], details || 'extended');");
        if (!createPortalEntitystring.match(/undefined;\s+var data/)) createPortalEntitystring = createPortalEntitystring.replace('undefined;',"undefined;\n\n  var data = decodeArray.portal(ent[2], details || 'extended');");
        createPortalEntitystring = createPortalEntitystring.replace(
            "'extended');",
            "'extended');\n" +
            "  //console.log('createPortalEntity',details,ent[0],data.history," + self.namespace + "getcache(ent[0]));\n" +
            "  if (!data.history || data.history._raw == undefined) data.history = " + self.namespace + "decodeHistory(" + self.namespace + "getcache(ent[0]));");

        // inject extra if statement:
        // abort if: new data contains no history, or new data does contain history, but is the same

        if (createPortalEntitystring.match(/if \(!data\.history \|\| p\.options\.data\.history === data\.history\)/)) { // IITC-CE Test/Beta
            createPortalEntitystring = createPortalEntitystring.replace(
                'if (!data.history || p.options.data.history === data.history)',
                'if (p.options.data.history._raw == data.history._raw)');
        } else {
            createPortalEntitystring = createPortalEntitystring.replace(
                'if (p.options.timestamp',
                "// if (p.options.data.history._raw == data.history._raw && p.options.timestamp >= ent[1]) console.log('createPortalEntity skip',details,ent[0],p.options.data.history._raw,data.history._raw);\n" +
                'if (p.options.data.history._raw == data.history._raw)\n' +
                '      if (p.options.timestamp');
        }

        createPortalEntitystring = createPortalEntitystring.replace(
            'if (!data.history)\n' +
            '      data.history = previousData.history;',
            '// code removed');
        createPortalEntitystring = createPortalEntitystring.replace(
            'if (!data.history) {\n' +
            '      data.history = previousData.history;\n' +
            '    }',
            '// code removed');

        if (createPortalEntitystring.match('log.log')) createPortalEntitystring = createPortalEntitystring.replace('{','{\n  var log = ulog(\'map_data_render\');'); // IITC-CE fix
        createPortalEntitystring = createPortalEntitystring.replace(
            "window.runHooks",
            "//console.log('portalAdded',ent[0],marker.options.data,previousData);\n" +
            "  window.runHooks");
        eval('window.mapDataRequest.render.createPortalEntity = ' + createPortalEntitystring);
*/
        if (!window._hooks.portalDetailLoaded[0].toString().match(/'detailed'/)) { // lucky guess to pick the first one
            let oldfunction = _hooks;
            window.removeHook('portalDetailLoaded',window._hooks.portalDetailLoaded[0]);
            window.addHook('portalDetailLoaded', function(data){
                if(data.success) {
                    window.mapDataRequest.render.createPortalEntity(data.ent, 'detailed');
                }
            });
        }

        let processGameEntitiesstring = window.mapDataRequest.render.processGameEntities.toString();
        processGameEntitiesstring = processGameEntitiesstring.replace('function(entities)','function(entities, details)');
        processGameEntitiesstring = processGameEntitiesstring.replace('this.createPortalEntity(ent);','this.createPortalEntity(ent, details || \'extended\');');
        eval('window.mapDataRequest.render.processGameEntities = ' + processGameEntitiesstring);

        let createPlaceholderPortalEntitystring = window.mapDataRequest.render.createPlaceholderPortalEntity.toString();
        createPlaceholderPortalEntitystring = createPlaceholderPortalEntitystring.replace('this.createPortalEntity(ent);','this.createPortalEntity(ent, \'core\');');
        eval('window.mapDataRequest.render.createPlaceholderPortalEntity = ' + createPlaceholderPortalEntitystring);
    };

    self.setupRenderPortalDetails = function() {
        // add new function to use during renderPortalDetails:
        window.getPortalHistoryDetails = function (d) {
            if (!d.history) {
                return '<div id="historydetails" class="missing">History missing (hint: zoom in)</div>';
            }
            var classParts = {};
            ['visited', 'captured', 'scoutControlled'].forEach(function (k) {
                classParts[k] = d.history[k] ? 'class="completed"' : "";
            });

            return L.Util.template('<div id="historydetails">History: '
                                   + '<span id="visited" {visited}>visited</span> | '
                                   + '<span id="captured" {captured}>captured</span> | '
                                   + '<span id="scout-controlled" {scoutControlled}>scout controlled</span>'
                                   + '</div>', classParts);
        }

        let renderPortalDetailsstring = window.renderPortalDetails.toString();
        if (!renderPortalDetailsstring.match('getPortalHistoryDetails(data)')) renderPortalDetailsstring = renderPortalDetailsstring.replace('get(guid);','get(guid);\n\n  var historyDetails = window.getPortalHistoryDetails(data);');
        renderPortalDetailsstring = renderPortalDetailsstring.replace('\'</div>\'\n','\'</div>\',\n      historyDetails'); // older IITC
        renderPortalDetailsstring = renderPortalDetailsstring.replace('linkDetails\n','linkDetails,\n      historyDetails\n'); // IITC-CE
        eval('window.renderPortalDetails = ' + renderPortalDetailsstring);

        $('head').append(
            '<style>\
/* history details */\
#historydetails {\
  text-align: center;\
  color: #ffce00;\
}\
\
#historydetails .missing {\
}\
\
#historydetails span {\
  color: #ff4a4a;\
}\
\
#historydetails span.completed {\
  color: #03fe03;\
}\
            </style>');
    };

    self.setupRenderQueue = function() {
        // change core function to inject portal history bit at the first moment of the entity code handling:
        let processRenderQueuestring = window.mapDataRequest.processRenderQueue.toString();
/* // this functionality is moved to createPortalEntity:
        processRenderQueuestring = processRenderQueuestring.replace(
            'entities.splice(0,drawEntityLimit);',
            'entities.splice(0,drawEntityLimit);\n' +
            '      for (let cnt = 0, lng = drawThisPass.length; cnt < lng; cnt++) {\n' +
            '          if (drawThisPass[cnt][2][0] == "p") {\n' +
            '              while (drawThisPass[cnt][2].length < 19) drawThisPass[cnt][2].push(null);\n' +
            '              drawThisPass[cnt][2][18] = ' + self.namespace + 'addcache(drawThisPass[cnt][0],drawThisPass[cnt][2][18]); // store value, or restore if other value in cache\n' +
            '          }\n' +
            '      }');
*/
        processRenderQueuestring = processRenderQueuestring.replace('processGameEntities(drawThisPass)',"processGameEntities(drawThisPass,'extended')");
        if (processRenderQueuestring.match('log.log')) processRenderQueuestring = processRenderQueuestring.replace('{','{\n  var log = ulog(\'map_data_request\');'); // IITC-CE fix
        eval('window.mapDataRequest.processRenderQueue = ' + processRenderQueuestring);
    };

    self.setupPortalDetailrequest = function() {
        // rewrite core function to inject cache history storage usage at an early stage

        var log = console;
        if (typeof ulog == 'function') log = ulog('portal_detail');
        /// PORTAL DETAIL //////////////////////////////////////
        // code to retrieve the new portal detail data from the servers

        // NOTE: the API for portal detailed information is NOT FINAL
        // this is a temporary measure to get things working again after a major change to the intel map
        // API. expect things to change here

        var cache;
        var requestQueue = {};

        window.portalDetail = function() {};

        window.portalDetail.setup = function() {
            cache = new DataCache();

            cache.startExpireInterval(20);
        }

        window.portalDetail.get = function(guid) {
            return cache.get(guid);
        }

        window.portalDetail.isFresh = function(guid) {
            return cache.isFresh(guid);
        }

        var handleResponse = function(deferred, guid, data, success) {
            if (!data || data.error || !data.result) {
                success = false;
            }

            if (success) {
                // *** modification start ***
                // detailed data contains bit, or does not contain bitarry, but must be 0
                if (data.result.length == 18) data.result.push(0); // add extra element
                data.result[18] = self.addcache(guid,data.result[18]); // store value, or restore if other value in cache
                // *** modification end ***

                var dict = decodeArray.portal(data.result, 'detailed');

                // entity format, as used in map data
                var ent = [guid,dict.timestamp,data.result];

                cache.store(guid,dict);

                //FIXME..? better way of handling sidebar refreshing...

                if (guid == selectedPortal) {
                    renderPortalDetails(guid);
                }

                deferred.resolve(dict);
                //console.log('handleResponse runHooks portalDetailLoaded',guid);
                window.runHooks ('portalDetailLoaded', {guid:guid, success:success, details:dict, ent:ent});

            } else {
                if (data && data.error == "RETRY") {
                    // server asked us to try again
                    doRequest(deferred, guid);
                } else {
                    deferred.reject();
                    window.runHooks ('portalDetailLoaded', {guid:guid, success:success});
                }
            }

        }

        var doRequest = function(deferred, guid) {
            window.postAjax('getPortalDetails', {guid:guid},
                            function(data,textStatus,jqXHR) { handleResponse(deferred, guid, data, true); },
                            function() { handleResponse(deferred, guid, undefined, false); }
                           );
        }

        window.portalDetail.request = function(guid) {
            if (!requestQueue[guid]) {
                var deferred = $.Deferred();
                requestQueue[guid] = deferred.promise();
                deferred.always(function() { delete requestQueue[guid]; });

                doRequest(deferred, guid);
            }

            return requestQueue[guid];
        }

        window.portalDetail.setup();
    };

    self.onportalDetailLoaded = function(data) {
        // data = {guid:guid, success:success, details:dict, ent:ent}
        self.cancelLoadDetails();
        self.startLoadDetails();
    };

    self.loadDetailsTimeout = function() {
        console.log('loadDetailsTimeout load guid',self.loadDetails.guid);
        self.cancelLoadDetails();
        self.startLoadDetails();
    };

    self.cancelLoadDetails = function() {
        clearTimeout(self.loadDetails.StartTimerID);
        self.loadDetails.StartTimerID = undefined;
        clearTimeout(self.loadDetails.TimeoutID);
        self.loadDetails.TimeoutID = undefined;
        clearTimeout(self.loadDetails.DelayTimerID);
        self.loadDetails.DelayTimerID = undefined;
        self.loadDetails.guid = undefined;
        self.updatemenu();
    };

    self.startLoadDetails = function() {
        self.findcommsCapturedPortalsGuids();
        self.updatemenu();
        if (!self.settings.autoloadmissinghistory) return;
        if (self.loadDetails.guid) return; // busy
        if (self.loadDetails.StartTimerID) return; // busy
        if (self.loadDetails.DelayTimerID) return; // busy
        if (window.mapDataRequest.status.short != 'done') { // wait until map is fully loaded
            self.loadDetails.StartTimerID = setTimeout(function() {
                self.loadDetails.StartTimerID = undefined;
                self.startLoadDetails();
            },1000); // wait and retry
            return;
        }

        // find next undefined portal, try comms portals first
        self.loadDetails.guid = self.loadcommsCapturedPortals();
        if (!self.loadDetails.guid) { // nothing found, try to find first portal without history
            if (window.getMapZoomTileParameters(window.map.getZoom()).minLinkLength == 0) { // limit details loading to zoom levels all portals or all links
                let displayBounds = window.map.getBounds();
                for (const guid in window.portals) {
                    let portal = window.portals[guid];
                    if (displayBounds.contains(portal.getLatLng()) && self.getcache(guid) == undefined) {
                        self.loadDetails.guid = guid;
                        break;
                    }
                }
            }
        }

        if (!self.loadDetails.guid) return; // nothing found

        $('#' + self.id + '_count_loadingportaldetails').html('Busy loading');

        // request portal details, with a safe delay between requests and a timeout for failures
        self.loadDetails.DelayTimerID = setTimeout(function() {
            self.loadDetails.DelayTimerID = undefined;
            self.loadDetails.TimeoutID = setTimeout(self.loadDetails.Timeout,self.loadDetails.MaxTime);
            window.portalDetail.request(self.loadDetails.guid);
        },self.loadDetails.Delay);
    };

    self.findcommsCapturedPortalsGuids = function() {
        // convert latlng list to guid list for loaded portals
        for (const latE6lngE6 in self.commsCapturedPortals.latlngportals) {
            let portal = self.commsCapturedPortals.latlngportals[latE6lngE6];
            var guid = window.findPortalGuidByPositionE6(portal.latE6, portal.lngE6);
            if (guid && window.portals[guid]) {
                delete self.commsCapturedPortals.latlngportals[latE6lngE6];
                if (!self.decodeHistory(self.getcache(guid)).captured)
                    self.commsCapturedPortals.guidlist[guid] = portal;
                else // portal is detected as captured
                    delete self.commsCapturedPortals.guidlist[guid];
            }
        }
    };

    self.loadcommsCapturedPortals = function() {
        // find first visible portal guid
        let displayBounds = window.map.getBounds();
        let loadguid = undefined;
        for (const guid in self.commsCapturedPortals.guidlist) {
            if (!self.decodeHistory(self.getcache(guid)).captured) {
                if (window.portals[guid] && displayBounds.contains(window.portals[guid].getLatLng())) {
                    loadguid = guid;
                    break;
                }
            } else // portal is detected as captured
                delete self.commsCapturedPortals.guidlist[guid];
        }

        return loadguid;
    };

    self.capturedFromComms = function(data) {
        // data = {raw: data, result: data.result, processed: chat._public.data}
        var playernickname = window.PLAYER.nickname;
        data.result.forEach(function(msg) {
            let plext = msg[2].plext;
            let markup = plext.markup;
            if (plext.plextType == 'SYSTEM_BROADCAST' && markup.length == 3 &&
                markup[0][0] == 'PLAYER' && markup[0][1].plain == playernickname &&
                markup[1][0] == 'TEXT' && markup[1][1].plain == ' captured ' &&
                markup[2][0] == 'PORTAL') {
                var portal = markup[2][1];
                var guid = window.findPortalGuidByPositionE6(portal.latE6, portal.lngE6);
                if (!guid) {
                    // capturedFromComms no guid found, try later when map is moved
                    self.commsCapturedPortals.latlngportals[portal.latE6 + ',' + portal.lngE6] = portal; // store and load later when map is moved
                } else {
                    delete self.commsCapturedPortals.latlngportals[portal.latE6 + ',' + portal.lngE6];
                    if (!self.decodeHistory(self.getcache(guid)).captured)
                        self.commsCapturedPortals.guidlist[guid] = portal;
                    else // portal is detected as captured
                        delete self.commsCapturedPortals.guidlist[guid];
                }
            }
        });
    };

    self.refreshcacheclicked = function() {
        let countcache = 0;
        let displayBounds = window.map.getBounds();
        for (const guid in window.portals) {
            let portal = window.portals[guid];
            if (displayBounds.contains(portal.getLatLng()) && self.getcache(guid) != undefined) {
                countcache++;
            }
        }

        if (countcache == 0) {
            alert('There is no cached History data to refresh for all visible portals.')
            return;
        }

        if (!confirm('Are you sure you want to refresh cached History data for all visible portals?\nCached History: ' + countcache)) return;

        for (const guid in window.portals) {
            let portal = window.portals[guid];
            if (displayBounds.contains(portal.getLatLng()) && self.getcache(guid) != undefined) {
                self.deletecache(guid);
            }
        }

        window.resetHighlightedPortals();
        self.startLoadDetails();
    };

    self.about = function() {
        let html = '<div>' +
            'Thank you for choosing this plugin.<br />' +
            '<br />' +
            'This plugin uses code from IITC-CE Beta, combined with extra modifications not found in IITC, to make (all) History plugins work on all versions of IITC.<br />' +
            'This plugin changes IITC core functions to enable History data processing. It works also on older versions of IITC.<br />' +
            '<br />' +
            'NIA has designed Intel to only load History at zoom level "all portals". But even then, Intel does not always contain the History data.<br />' +
            'To overcome this problem this plugin offers these solutions:<br />' +
            'Cache: All received History data is cached, and used when it\'s missing from Intel.<br />' +
            'Gather: For portals of which no history data is received, this plugin can automatically gather the History data by loading all portal details, one by one (when at zoom level all portals or all links).<br />' +
            'Detect: Captured portals are mentioned in COMMS (Visits and Scout Control actions are not mentioned). This plugin will almost instantly update the History for all your new captured portals.<br />' +
            '<br />' +
            'This plugin works/was tested on these versions of IITC:<br />' +
            '0.26.0.20170108.21732 - <a href="https://iitc.me" target="_blank">IITC.me</a> version<br />' +
            '0.31.1 - <a href="https://iitc.app" target="_blank">IITC-CE</a> release version<br />' +
            '0.31.1.20210219.164429 - IITC-CE Beta version<br />' +
            '0.31.1.20210302.152616 - IITC-CE Beta version<br />' +
            '0.31.1.20210219.082130 - IITC-CE Test version<br />' +
            '0.31.1.20210225.132054 - IITC-CE Test version<br />' +
            '<br />' +
            '<span style="font-style: italic; font-size: smaller">' + self.title + ' version ' + self.version + ' by ' + self.author + '</span>' +
            '</div>';

        window.dialog({
            html: html,
            id: self.pluginname + '-dialog',
            dialogClass: 'ui-dialog-' + self.pluginname,
            width: 'auto',
            title: self.title + ' - About'
        }).dialog('option', 'buttons', {
            '< Main menu': function() { self.menu(); },
            'Changelog': function() { alert(self.changelog); },
            'Close': function() { $(this).dialog('close'); },
        });
    };

    self.updatemenu = function() {
        if (!$('#dialog-' + self.pluginname + '-dialog').length) return;

        var count = self.countcache();
        count.loadingportaldetails = (self.loadDetails.guid?'Busy loading':(window.getMapZoomTileParameters(window.map.getZoom()).minLinkLength > 0?'Zoom in to load history':''));

        for (const id in count) {
            $('#' + self.id + '_count_' + id).html(count[id]);
        }
    };

    self.menu = function() {
        let html = '<div>' +
            'Visible portals: <span id="' + self.id + '_count_visibleportals"></span> v:<span id="' + self.id + '_count_visited"></span>/c:<span id="' + self.id + '_count_captured"></span>/s:<span id="' + self.id + '_count_scoutControlled"></span><br />' +
            'Cached History: <span id="' + self.id + '_count_visibleportalswithhistorycache"></span><br />' +
            '<input type="button" id="' + self.id + '_refreshbutton" value="Refresh history for visible portals" onclick="' + self.namespace + 'refreshcacheclicked();"><br />' +
            'Missing history: <span id="' + self.id + '_count_visibleportalswithouthistorycache"></span><br />';
        html +=
            '<input type="checkbox" onclick="' + self.namespace + 'settings.autoloadmissinghistory = this.checked; ' + self.namespace + 'storesettings(); ' + self.namespace + 'startLoadDetails();" id="autoloadmissinghistorytoggle"' + (self.settings.autoloadmissinghistory?' checked':'') + '>' +
            '<label for="autoloadmissinghistorytoggle" style="user-select: none">Auto load missing history</label><br />' +
            '<span id="' + self.id + '_count_loadingportaldetails"></span><br />';
        html +=
            'Total cached history: <span id="' + self.id + '_count_totalcache"></span><br />' +
            'Visited: <span id="' + self.id + '_count_cachevisited"></span> (never: <span id="' + self.id + '_count_cachenevervisited"></span>)<br />' +
            'Captured: <span id="' + self.id + '_count_cachecaptured"></span> (never: <span id="' + self.id + '_count_cachenevercaptured"></span>)<br />' +
            'ScoutControlled: <span id="' + self.id + '_count_cachescoutControlled"></span>';
        html +=
            '</div>';

        if (window.useAndroidPanes()) window.show('map'); // hide sidepane
        window.dialog({
            html: html,
            id: self.pluginname + '-dialog',
            dialogClass: 'ui-dialog-' + self.pluginname,
            title: self.title,
            width: 'auto'
        }).dialog('option', 'buttons', {
            'About': function() { self.about(); },
            'Ok': function() { $(this).dialog('close'); },
        });

        self.updatemenu();
    };

    self.setup = function() {
        $('#toolbox').append('<a onclick="' + self.namespace + 'menu(); return false;" href="#">' + self.title + '</a>');
        self.restoresettings();

        window.addHook('publicChatDataAvailable', self.capturedFromComms);
        window.addHook('portalDetailLoaded', self.onportalDetailLoaded);
        window.addHook('mapDataRefreshEnd', function() { self.startLoadDetails(); });
        window.map.on('zoomstart movestart', function() { self.cancelLoadDetails(); });
        window.map.on('zoomend moveend zoomlevelschange', function() { self.startLoadDetails(); });

        console.log('IITC plugin loaded: ' + self.title + ' version ' + self.version);
    };

    self.checkforolderplugin = function() {
        let disableplugin = false;
        if (!window.plugin.uniqueportalhistory || !("storagehistoryraw" in window.plugin.uniqueportalhistory)) return disableplugin;

        console.log('IITC plugin WARNING: ' + self.title + ' version ' + self.version + ' - Plugin conflict with ' + window.plugin.uniqueportalhistory.title);

        let html = '<div class="' + self.pluginname + '">Thank you for choosing this plugin.<br />' +
            '<br />' +
            'This plugin contains conflicting code with the old plugin version "' + window.plugin.uniqueportalhistory.title + '".<br />' +
            '<br />' +
            'Before you can use this new plugin, you must <u>update the old plugin</u> "' + window.plugin.uniqueportalhistory.title + '".<br />' +
            'You can download it here: <a href="https://softspot.nl/ingress/" target="_blank">softspot.nl</a><br />' +
            '<br />' +
            'The new plugin will not run until this is changed.<br />' +
            '<span style="font-style: italic; font-size: smaller">version ' + self.version + ' by ' + self.author + '</span>' +
            '</div>';
        disableplugin = true;

        window.dialog({
            html: html,
            id: self.pluginname + '-dialog',
            dialogClass: 'ui-dialog-' + self.pluginname,
            title: self.title,
            width: 'auto'
        });

        return disableplugin;
    };

    var setup = function() {
        if (self.checkforolderplugin()) return; // prevent conflicts with the previous plugin

        switch (window.script_info.script.version) {
            case '0.26.0.20170108.21732': // IITC.me version
            case '0.31.1': // IITC-CE release version
            case '0.31.1.20210219.164429': // IITC-CE Beta version
            case '0.31.1.20210302.152616': // IITC-CE Beta version
            case '0.31.1.20210219.082130': // IITC-CE Test version
            case '0.31.1.20210225.132054': // IITC-CE Test version
                break;
            default:
                console.log('IITC plugin WARNING: ' + self.title + ' version ' + self.version + ' - Plugin not tested on this version of IITC: ' + window.script_info.script.version);
        }

        self.cache[window.PLAYER.nickname] = {};
        self.restorecache();
        if (!Object.keys(self.cache[window.PLAYER.nickname]).length)
            self.about();
        else
            console.log(self.id + ' - restored records: ' + Object.keys(self.cache[window.PLAYER.nickname]).length,self.countcache());

        self.setupDecodeArrayPortal();
        self.setupCreatePortalEntity();
        self.setupRenderPortalDetails();
        self.setupPortalDetailrequest();
        self.setupRenderQueue();

        window.addHook('iitcLoaded',self.setup);
    };

    setup.info = plugin_info; //add the script info data to the function as a property
    if(!window.bootPlugins) window.bootPlugins = [];
    window.bootPlugins.push(setup);
    // if IITC has already booted, immediately run the 'setup' function
    if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);
