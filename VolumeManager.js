(async function VolumeManager() {
    if (!Spicetify.Player || !Spicetify.PopupModal || !Spicetify.showNotification || !Spicetify.Platform) {
        setTimeout(VolumeManager, 500);
        return;
    }

    const CONFIG_KEY = "spicetify_volume_manager";
    let config = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');

    if (!config.presets) config.presets = [];
    if (!config.songVolumes) config.songVolumes = {};
    if (!config.albumVolumes) config.albumVolumes = {};
    if (typeof config.showNotifications === 'undefined') config.showNotifications = true;
    if (typeof config.iconSize === 'undefined') config.iconSize = 19;
    if (typeof config.guiOpacity === 'undefined') config.guiOpacity = 0.05;
    if (typeof config.guiBlur === 'undefined') config.guiBlur = 0;
    if (typeof config.lastGenericVolume === 'undefined') config.lastGenericVolume = Spicetify.Player.getVolume();
    if (typeof config.volumeTransitionMode === 'undefined') config.volumeTransitionMode = "progressive";
    if (typeof config.transitionDuration === 'undefined') config.transitionDuration = 1000;
    
    if (typeof config.buttonPosition !== 'undefined') delete config.buttonPosition;
    if (typeof config.guiTheme !== 'undefined') delete config.guiTheme;

    if (config.presets && !Array.isArray(config.presets)) {
        const migratedPresets = [];
        for (const [name, vol] of Object.entries(config.presets)) {
            migratedPresets.push({ name, vol });
        }
        config.presets = migratedPresets;
    }
    
    saveConfig();

    let editorSource = "playing"; // "playing" or "page"

    function saveConfig() {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config, null, 2));
    }

    function notify(msg) {
        if (config.showNotifications) {
            Spicetify.showNotification(msg);
        }
    }

    function getCurrentTrack() {
        return Spicetify.Player.data?.item || Spicetify.Player.data?.track || null;
    }

    function getCurrentTrackUid() {
        return Spicetify.Player.data?.track?.uid || Spicetify.Player.data?.item?.uid || "";
    }

    function normalizeUri(uri) {
        if (!uri) return "";
        if (uri.startsWith("spotify:local:")) {
            const parts = uri.split(":");
            if (parts.length >= 6) {
                return parts.slice(0, 5).join(":"); 
            }
        }
        return uri;
    }

    function isLocalUri(uri) {
        return typeof uri === 'string' && uri.startsWith("spotify:local:");
    }

    function getSavedVolume(uri) {
        if (!uri) return -1;
        const norm = normalizeUri(uri);
        if (config.songVolumes[norm] !== undefined) return config.songVolumes[norm];
        if (config.songVolumes[uri] !== undefined) return config.songVolumes[uri];
        return -1;
    }

    function setSavedVolume(uri, vol) {
        if (!uri) return;
        const norm = normalizeUri(uri);
        config.songVolumes[norm] = vol;
        saveConfig();
    }

    function deleteSavedVolume(uri) {
        if (!uri) return;
        const norm = normalizeUri(uri);
        delete config.songVolumes[norm];
        delete config.songVolumes[uri]; 
        saveConfig();
    }

    function getSavedAlbumVolume(albumUri) {
        if (!albumUri) return -1;
        if (config.albumVolumes[albumUri] !== undefined) return config.albumVolumes[albumUri];
        return -1;
    }

    function setSavedAlbumVolume(albumUri, vol) {
        if (!albumUri) return;
        config.albumVolumes[albumUri] = vol;
        saveConfig();
    }

    function deleteSavedAlbumVolume(albumUri) {
        if (!albumUri) return;
        delete config.albumVolumes[albumUri];
        saveConfig();
    }

    function getEffectiveVolume(track) {
        if (!track) return { vol: -1, type: null };
        
        const albumUri = track.album?.uri || track.metadata?.album_uri || "";
        if (albumUri && albumUri.startsWith("spotify:album:")) {
            const albumVol = getSavedAlbumVolume(albumUri);
            if (albumVol !== -1) return { vol: albumVol, type: 'album' };
        }

        const trackVol = getSavedVolume(track.uri);
        if (trackVol !== -1) return { vol: trackVol, type: 'track' };
        
        return { vol: -1, type: null };
    }

    function getTargetVolumeForTrack(track) {
        if (!track) return lastGenericVolume;
        const effective = getEffectiveVolume(track);
        if (effective.vol !== -1) return effective.vol;
        return lastGenericVolume;
    }

    function getCurrentUri() {
        const track = getCurrentTrack();
        return track ? track.uri : "";
    }

    function getCurrentContextUri() {
        return Spicetify.Player.data?.context_uri || Spicetify.Player.data?.context?.uri || "";
    }

    function parseUri(uri) {
        if (!uri) return null;
        
        if (uri.includes(":collection") || uri === "spotify:library" || uri.endsWith(":collection:tracks")) {
            return { type: "collection", id: "" };
        }
        
        if (uri.includes(":playlist:")) {
            const match = uri.match(/:playlist:([a-zA-Z0-9]+)/);
            if (match) return { type: "playlist", id: match[1] };
        }
        
        const parts = uri.split(":");
        const playlistIndex = parts.indexOf("playlist");
        if (playlistIndex !== -1 && parts[playlistIndex + 1]) {
            return { type: "playlist", id: parts[playlistIndex + 1] };
        }
        
        const albumIndex = parts.indexOf("album");
        if (albumIndex !== -1 && parts[albumIndex + 1]) {
            return { type: "album", id: parts[albumIndex + 1] };
        }
        
        return null;
    }

    function getPageUri() {
        const pathname = Spicetify.Platform?.History?.location?.pathname || "";
        if (!pathname) return { uri: null, error: "Unable to retrieve current page pathname." };
        
        const parts = pathname.split("/").filter(Boolean);
        let typeIndex = -1;
        let type = "";
        
        const types = ["album", "playlist", "single", "ep"];
        for (const t of types) {
            const idx = parts.indexOf(t);
            if (idx !== -1) {
                typeIndex = idx;
                type = t;
                break;
            }
        }
        
        if (typeIndex !== -1 && parts[typeIndex + 1]) {
            const id = parts[typeIndex + 1];
            const mappedType = (type === "single" || type === "ep") ? "album" : type;
            return { uri: `spotify:${mappedType}:${id}`, type: type, id: id };
        }
        
        if (parts.length >= 2) {
            return { uri: null, error: `Invalid page type: "${parts[0]}". This feature only supports album, single, ep, or playlist pages.` };
        }
        return { uri: null, error: "Please navigate to an album, single, EP, or playlist page." };
    }

    function extractTracksFromGraphQL(obj, tracks = [], visited = new WeakSet()) {
        if (!obj || typeof obj !== "object") return tracks;
        if (visited.has(obj)) return tracks;
        visited.add(obj);
        
        if (obj.uri && typeof obj.uri === "string" && obj.uri.startsWith("spotify:track:") && obj.name) {
            let artistName = "";
            if (Array.isArray(obj.artists)) {
                artistName = obj.artists.map(a => a.name || a.profile?.name || "").filter(Boolean).join(", ");
            } else if (obj.artists && obj.artists.items) {
                artistName = obj.artists.items.map(a => a.profile?.name || a.name || "").filter(Boolean).join(", ");
            }
            tracks.push({
                uri: obj.uri,
                name: obj.name,
                artists: artistName
            });
            return tracks;
        }
        
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                extractTracksFromGraphQL(obj[key], tracks, visited);
            }
        }
        return tracks;
    }

    async function fetchContextTracks(contextUri, albumUri) {
        let tracks = [];
        if (!contextUri && !albumUri) return [];
        
        let parsed = parseUri(contextUri);
        if (!parsed) {
            parsed = parseUri(albumUri);
        }
        
        if (parsed) {
            const { type, id } = parsed;
            
            if (type === "album") {
                try {
                    const { getAlbum } = Spicetify.GraphQL.Definitions;
                    if (getAlbum) {
                        const res = await Spicetify.GraphQL.Request(getAlbum, { 
                            uri: `spotify:album:${id}`,
                            locale: "en",
                            limit: 100,
                            offset: 0 
                        });
                        tracks = extractTracksFromGraphQL(res);
                    }
                } catch (e) {
                    console.error("Local GraphQL getAlbum failed, trying pathfinder...", e);
                }
                
                if (tracks.length === 0) {
                    try {
                        const res = await Spicetify.CosmosAsync.get(
                            `https://api-partner.spotify.com/pathfinder/v1/query?operationName=getAlbum&variables={"uri":"spotify:album:${id}","locale":"en","offset":0,"limit":100}`
                        );
                        tracks = extractTracksFromGraphQL(res);
                    } catch (e) {
                        console.error("Pathfinder getAlbum Cosmos fetch failed, trying Web API fallback...", e);
                    }
                }

                if (tracks.length === 0) {
                    try {
                        const res = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/albums/${id}/tracks?limit=100`);
                        if (res && res.items) {
                            tracks = res.items.map(item => ({
                                uri: item.uri,
                                name: item.name,
                                artists: item.artists ? item.artists.map(a => a.name).join(", ") : ""
                            }));
                        }
                    } catch (e) {
                        console.error("Web API Album fetch failed", e);
                    }
                }
            } else if (type === "playlist") {
                try {
                    const { FetchPlaylistContents } = Spicetify.GraphQL.Definitions;
                    if (FetchPlaylistContents) {
                        const res = await Spicetify.GraphQL.Request(FetchPlaylistContents, {
                            uri: `spotify:playlist:${id}`,
                            offset: 0,
                            limit: 100
                        });
                        tracks = extractTracksFromGraphQL(res);
                    }
                } catch (e) {
                    console.error("Local FetchPlaylistContents GraphQL failed, trying next method...", e);
                }

                if (tracks.length === 0) {
                    try {
                        if (Spicetify.Platform?.PlaylistAPI?.getContents) {
                            const contents = await Spicetify.Platform.PlaylistAPI.getContents(`spotify:playlist:${id}`);
                            tracks = extractTracksFromGraphQL(contents);
                        }
                    } catch (e) {
                        console.error("Local PlaylistAPI fetch failed, trying next fallback...", e);
                    }
                }

                if (tracks.length === 0) {
                    try {
                        const res = await Spicetify.CosmosAsync.get(
                            `https://api-partner.spotify.com/pathfinder/v1/query?operationName=fetchPlaylistContents&variables={"uri":"spotify:playlist:${id}","offset":0,"limit":100}`
                        );
                        tracks = extractTracksFromGraphQL(res);
                    } catch (e) {
                        console.error("Pathfinder fetchPlaylistContents Cosmos query failed, trying final Web API...", e);
                    }
                }

                if (tracks.length === 0) {
                    try {
                        const res = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`);
                        if (res && res.items) {
                            tracks = res.items
                                .filter(item => item && item.track)
                                .map(item => ({
                                    uri: item.track.uri,
                                    name: item.track.name,
                                    artists: item.track.artists ? item.track.artists.map(a => a.name).join(", ") : ""
                                }));
                        }
                    } catch (e) {
                        console.error("Fallback Web API Playlist fetch failed", e);
                    }
                }
            } else if (type === "collection") {
                try {
                    if (Spicetify.Platform?.LibraryAPI?.getTracks) {
                        const collection = await Spicetify.Platform.LibraryAPI.getTracks({ limit: 100 });
                        tracks = extractTracksFromGraphQL(collection);
                    }
                } catch (e) {
                    console.error("Local LibraryAPI fetch failed, trying fallback...", e);
                }

                if (tracks.length === 0) {
                    try {
                        const res = await Spicetify.CosmosAsync.get(`https://api.spotify.com/v1/me/tracks?limit=100`);
                        if (res && res.items) {
                            tracks = res.items
                                .filter(item => item && item.track)
                                .map(item => ({
                                    uri: item.track.uri,
                                    name: item.track.name,
                                    artists: item.track.artists ? item.track.artists.map(a => a.name).join(", ") : ""
                                }));
                        }
                    } catch (e) {
                        console.error("Fallback Web API Liked Songs fetch failed", e);
                    }
                }
            }
        }

        if (tracks.length === 0) {
            try {
                const currentTrack = getCurrentTrack();
                if (currentTrack) {
                    tracks.push({
                        uri: currentTrack.uri,
                        name: currentTrack.metadata?.title || currentTrack.name || "Unknown Title",
                        artists: currentTrack.metadata?.artist_name || (currentTrack.artists && currentTrack.artists[0]?.name) || ""
                    });
                    
                    if (Spicetify.Queue && Spicetify.Queue.nextTracks) {
                        Spicetify.Queue.nextTracks.slice(0, 49).forEach(item => {
                            if (item && item.uri) {
                                tracks.push({
                                    uri: item.uri,
                                    name: item.name || item.metadata?.title || "Unknown Title",
                                    artists: item.metadata?.artist_name || (item.artists && item.artists[0]?.name) || ""
                                });
                            }
                        });
                    }
                }
            } catch (e) {
                console.error("Fallback queue fetch failed", e);
            }
        }

        const seen = new Set();
        return tracks.filter(t => {
            if (!t.uri || seen.has(t.uri)) return false;
            seen.add(t.uri);
            return true;
        });
    }

    const style = document.createElement("style");
    style.innerHTML = `
        body.volume-manager-locked [data-testid="volume-bar"] > div:not(button):not(#vol-mgr-locked-overlay),
        body.volume-manager-locked .volume-bar > div:not(button):not(#vol-mgr-locked-overlay),
        body.volume-manager-locked .x-progressBar-progressBar {
            pointer-events: none !important;
            opacity: 0.3 !important;
            filter: grayscale(100%) !important;
        }
        details summary::-webkit-details-marker {
            display: none;
        }
        details summary {
            list-style: none;
        }
    `;
    document.head.appendChild(style);

    let lastGenericVolume = config.lastGenericVolume;
    let expectedVolume = -1; 
    let lastAppliedTargetVolume = -1;
    let enforceNotifyThrottle = false;
    let isCurrentlyCustom = false; 
    
    let fadeInterval = null;
    let isFadingUnlock = false;

    let isAutomatedVolumeChangeActive = false;
    let automatedVolumeChangeCooldownTimeout = null;

    function startAutomatedVolumeChange() {
        isAutomatedVolumeChangeActive = true;
        clearTimeout(automatedVolumeChangeCooldownTimeout);
    }

    function endAutomatedVolumeChange() {
        clearTimeout(automatedVolumeChangeCooldownTimeout);
        automatedVolumeChangeCooldownTimeout = setTimeout(() => {
            isAutomatedVolumeChangeActive = false;
            isFadingUnlock = false;
        }, 350);
    }

    function applyTargetVolume(targetVol, isUnlock = false, instant = false) {
        clearInterval(fadeInterval);
        startAutomatedVolumeChange();
        
        isFadingUnlock = isUnlock;
        targetVol = Math.max(0, Math.min(1, targetVol));
        let currentVol = Spicetify.Player.getVolume();

        if (currentVol === 0) {
            expectedVolume = isUnlock ? -1 : targetVol;
            isCurrentlyCustom = !isUnlock;
            lastAppliedTargetVolume = targetVol;
            endAutomatedVolumeChange();
            return; 
        }

        const isBackground = document.hidden || !document.hasFocus();
        const isInstantMode = config.volumeTransitionMode === "instant";
        const volDifference = Math.abs(currentVol - targetVol);

        if (isBackground || volDifference < 0.01) {
            expectedVolume = isUnlock ? -1 : targetVol;
            isCurrentlyCustom = !isUnlock;
            lastAppliedTargetVolume = targetVol;
            Spicetify.Player.setVolume(targetVol); 
            endAutomatedVolumeChange();
            return;
        }

        let duration;
        let stepTime;

        if (instant || isInstantMode) {
            duration = 30; 
            stepTime = 5; 
        } else {
            duration = config.transitionDuration || 1000;
            stepTime = 10; 
        }

        const steps = Math.max(1, Math.round(duration / stepTime));
        const stepVol = (targetVol - currentVol) / steps;
        let step = 0;
        
        if (isUnlock) {
            expectedVolume = -1; 
            isCurrentlyCustom = false;
        } else {
            isCurrentlyCustom = true;
        }
        lastAppliedTargetVolume = targetVol;

        fadeInterval = setInterval(() => {
            step++;
            let v = currentVol + (stepVol * step);
            v = Math.max(0, Math.min(1, v));
            
            if (step >= steps) {
                v = targetVol;
                clearInterval(fadeInterval);
                
                if (!isUnlock) expectedVolume = targetVol;
                
                Spicetify.Player.setVolume(v);
                endAutomatedVolumeChange();
            } else {
                if (!isUnlock) expectedVolume = v; 
                
                if (origPlaybackSetVolume && Spicetify.Platform?.PlaybackAPI) {
                    origPlaybackSetVolume.call(Spicetify.Platform.PlaybackAPI, v);
                } else if (origSpicetifySetVolume) {
                    origSpicetifySetVolume.call(Spicetify.Player, v);
                }
            }
        }, stepTime);
    }

    function throttleNotify() {
        if (!enforceNotifyThrottle) {
            enforceNotifyThrottle = true;
            notify("Custom volume locked! Delete to change volume.");
            setTimeout(() => { enforceNotifyThrottle = false; }, 2500);
        }
    }

    const origSpicetifySetVolume = Spicetify.Player.setVolume;
    Spicetify.Player.setVolume = function(vol) {
        if (expectedVolume !== -1) {
            if (vol === 0) return origSpicetifySetVolume.call(this, 0); 
            
            if (Math.abs(vol - expectedVolume) <= 0.001) {
                return origSpicetifySetVolume.call(this, expectedVolume);
            }

            throttleNotify(); 
            return origSpicetifySetVolume.call(this, expectedVolume);
        } else {
            if (!isAutomatedVolumeChangeActive && !isFadingUnlock) {
                lastGenericVolume = vol;
                config.lastGenericVolume = vol;
                saveConfig();
                lastAppliedTargetVolume = vol;
            }
            return origSpicetifySetVolume.call(this, vol);
        }
    };

    let origPlaybackSetVolume = null;
    if (Spicetify.Platform && Spicetify.Platform.PlaybackAPI && Spicetify.Platform.PlaybackAPI.setVolume) {
        origPlaybackSetVolume = Spicetify.Platform.PlaybackAPI.setVolume;
        Spicetify.Platform.PlaybackAPI.setVolume = function(vol) {
            if (expectedVolume !== -1) {
                if (vol === 0) return origPlaybackSetVolume.call(this, 0); 
                if (Math.abs(vol - expectedVolume) > 0.001) {
                    throttleNotify();
                    return origPlaybackSetVolume.call(this, expectedVolume);
                }
            } else {
                if (!isAutomatedVolumeChangeActive && !isFadingUnlock) {
                    lastGenericVolume = vol;
                    config.lastGenericVolume = vol;
                    saveConfig();
                    lastAppliedTargetVolume = vol;
                }
            }
            return origPlaybackSetVolume.call(this, vol);
        };
    }

    const initTrack = getCurrentTrack();
    if (initTrack && initTrack.uri) {
        const effective = getEffectiveVolume(initTrack);
        if (effective.vol !== -1) {
            applyTargetVolume(effective.vol, false, isLocalUri(initTrack.uri));
        } else {
            lastAppliedTargetVolume = lastGenericVolume;
        }
    }

    Spicetify.Player.addEventListener("onplay", () => {
        const trackUri = getCurrentUri();
        if (trackUri) {
            const track = getCurrentTrack();
            const targetVol = getTargetVolumeForTrack(track);
            if (lastAppliedTargetVolume === -1 || Math.abs(targetVol - lastAppliedTargetVolume) > 0.001) {
                const effective = getEffectiveVolume(track);
                if (effective.vol !== -1) {
                    applyTargetVolume(effective.vol, false, isLocalUri(trackUri));
                }
            }
        }
    });

    let currentUri = getCurrentUri();
    let currentTrackUid = getCurrentTrackUid();

    function handleTrackChange(newUri) {
        if (!newUri) return;
        currentUri = newUri; 
        
        const track = getCurrentTrack();
        const targetVol = getTargetVolumeForTrack(track);
        const isLocal = isLocalUri(newUri);

        if (lastAppliedTargetVolume !== -1 && Math.abs(targetVol - lastAppliedTargetVolume) < 0.001) {
            const hoverMenu = document.getElementById('volume-manager-hover-menu');
            if (hoverMenu && hoverMenu.style.display === "flex") {
                renderHoverMenu();
            }
            if (window.volMgrUpdateTrackUI) {
                window.volMgrUpdateTrackUI();
            }
            return;
        }

        const effective = getEffectiveVolume(track);

        if (effective.vol !== -1) {
            applyTargetVolume(effective.vol, false, isLocal);
            if (effective.type === 'track') {
                notify(`Custom Volume: ${Math.round(effective.vol * 100)}% for this track.`);
            } else if (effective.type === 'album') {
                notify(`Album Custom Volume: ${Math.round(effective.vol * 100)}% active.`);
            }
        } else {
            if (expectedVolume !== -1 || isCurrentlyCustom) {
                applyTargetVolume(lastGenericVolume, true, isLocal);
                notify(`Restored base volume to ${Math.round(lastGenericVolume * 100)}%`);
            } else {
                lastAppliedTargetVolume = lastGenericVolume;
            }
        }
        
        const hoverMenu = document.getElementById('volume-manager-hover-menu');
        if (hoverMenu && hoverMenu.style.display === "flex") {
            renderHoverMenu();
        }

        if (window.volMgrUpdateTrackUI) {
            window.volMgrUpdateTrackUI();
        }
    }

    Spicetify.Player.addEventListener("songchange", () => {
        const newUri = getCurrentUri();
        handleTrackChange(newUri);
    });

    let lastProgress = 0;

    setInterval(() => {
        if (expectedVolume !== -1) {
            if (!document.body.classList.contains("volume-manager-locked")) {
                document.body.classList.add("volume-manager-locked");
            }
            let volContainer = document.querySelector('[data-testid="volume-bar"]') || document.querySelector('.volume-bar');
            if (volContainer) {
                let overlay = document.getElementById("vol-mgr-locked-overlay");
                if (!overlay) {
                    overlay = document.createElement("div");
                    overlay.id = "vol-mgr-locked-overlay";
                    overlay.title = "Volume slider disabled: Custom track or album volume is active.\nDelete the custom volume from the menu to unlock.";
                    overlay.style.cssText = "position: absolute; top: 0; right: 0; bottom: 0; left: 35px; z-index: 999; cursor: not-allowed;";
                    volContainer.style.position = "relative";
                    volContainer.appendChild(overlay);
                }
            }
        } else {
            if (document.body.classList.contains("volume-manager-locked")) {
                document.body.classList.remove("volume-manager-locked");
            }
            let overlay = document.getElementById("vol-mgr-locked-overlay");
            if (overlay) overlay.remove();
        }

        const newUid = getCurrentTrackUid();
        const newUri = getCurrentUri();
        const progress = Spicetify.Player.getProgress();
        const duration = Spicetify.Player.getDuration();

        if (typeof progress === 'number' && typeof duration === 'number' && duration > 0) {
            if (progress < lastProgress && lastProgress > 3000 && progress < 1500) {
                const track = getCurrentTrack();
                if (track) {
                    const targetVol = getTargetVolumeForTrack(track);
                    if (lastAppliedTargetVolume === -1 || Math.abs(targetVol - lastAppliedTargetVolume) > 0.001) {
                        const effective = getEffectiveVolume(track);
                        if (effective.vol !== -1) {
                            applyTargetVolume(effective.vol, false, isLocalUri(track.uri));
                        } else if (expectedVolume !== -1 || isCurrentlyCustom) {
                            applyTargetVolume(lastGenericVolume, true, isLocalUri(track.uri));
                        }
                    }
                }
            }
            lastProgress = progress;
        }

        if (newUid && newUid !== currentTrackUid) {
            currentTrackUid = newUid;
            handleTrackChange(newUri);
        }
    }, 250); 

    function attemptApplyPreset(preset) {
        const trackUri = getCurrentUri();
        if (trackUri && getSavedVolume(trackUri) !== -1) {
            notify("Cannot apply preset: This song has a custom volume! Delete it first.");
            return;
        }

        lastGenericVolume = preset.vol;
        config.lastGenericVolume = preset.vol;
        saveConfig();

        applyTargetVolume(preset.vol, true); 
        notify(`Preset applied: ${preset.name}`);
    }

    function openGUI() {
        const container = document.createElement("div");
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "20px";
        container.style.padding = "5px"; 

        let editingPresetIndex = -1;
        let deletingPresetIndex = -1;
        let clearAllConfirming = false;
        let resetAllConfirming = false;

        const btnStyle = "background: var(--spice-button, #1db954); color: var(--spice-text, #dedede); border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: all 0.2s;";
        const btnGroupStyle = "background: var(--spice-button, #1db954); color: var(--spice-text, #dedede); border: none; border-left: 1px solid rgba(0,0,0,0.2); padding: 8px 10px; cursor: pointer; font-weight: bold; transition: all 0.2s;";
        const inputStyle = "background: rgba(var(--spice-rgb-selected-row), 0.1); color: var(--spice-text, #dedede); border: 1px solid var(--spice-button, #1db954); padding: 8px; border-radius: 4px;";
        const hrStyle = "border: none; border-top: 1px solid rgba(220,220,220,0.15); margin: 0;";

        function createDelBtn(uri, slider, num, saveBtn) {
            const delRowBtn = document.createElement("button");
            delRowBtn.className = "del-row-btn";
            delRowBtn.innerText = "X";
            delRowBtn.title = "Delete custom volume";
            delRowBtn.style.cssText = btnStyle + " padding: 4px 10px; background: #e22134; font-size: 0.85em; margin-left: 4px;";
            delRowBtn.onclick = (event) => {
                event.stopPropagation();
                deleteSavedVolume(uri);
                if (uri === getCurrentUri()) {
                    applyTargetVolume(lastGenericVolume, true, isLocalUri(uri));
                }
                delRowBtn.remove();
                saveBtn.innerText = "Save";
                const currentGlobalVol = Math.round(Spicetify.Player.getVolume() * 100);
                slider.value = currentGlobalVol;
                num.value = currentGlobalVol;
                
                syncTrackVolumeUI(uri, true);
                notify(`Removed custom volume for track.`);
            };
            return delRowBtn;
        }

        function syncTrackVolumeUI(uri, isDeleted, newVol) {
            const isCurrent = (uri === getCurrentUri());
            
            if (isCurrent) {
                const mainSlider = document.getElementById("vol-mgr-curr-track-slider");
                const mainNum = document.getElementById("vol-mgr-curr-track-num");
                const mainSaveBtn = document.getElementById("vol-mgr-curr-track-save-btn");
                const mainControls = document.getElementById("vol-mgr-curr-track-controls");
                
                if (mainSlider && mainNum && mainSaveBtn) {
                    if (isDeleted) {
                        const vol100 = Math.round(Spicetify.Player.getVolume() * 100);
                        mainSlider.value = vol100;
                        mainNum.value = vol100;
                        mainSaveBtn.innerText = "Save Custom Vol";
                        const mainDelBtn = document.getElementById("vol-mgr-curr-track-delete-btn");
                        if (mainDelBtn) mainDelBtn.remove();
                    } else {
                        const vol100 = Math.round(newVol * 100);
                        mainSlider.value = vol100;
                        mainNum.value = vol100;
                        mainSaveBtn.innerText = "Update Custom Vol";
                        
                        let mainDelBtn = document.getElementById("vol-mgr-curr-track-delete-btn");
                        if (!mainDelBtn && mainControls) {
                            mainDelBtn = document.createElement("button");
                            mainDelBtn.id = "vol-mgr-curr-track-delete-btn";
                            mainDelBtn.innerText = "Delete Custom Vol";
                            mainDelBtn.title = "Remove the locked volume for this song";
                            mainDelBtn.style.cssText = btnStyle + " background: #e22134;";
                            mainDelBtn.onclick = (e) => {
                                e.stopPropagation();
                                deleteSavedVolume(uri);
                                applyTargetVolume(lastGenericVolume, true, isLocalUri(uri));
                                syncTrackVolumeUI(uri, true);
                                notify("Removed custom volume! Restored normal volume.");
                            };
                            mainControls.appendChild(mainDelBtn);
                        }
                    }
                }
            }
            
            const row = document.querySelector(`[data-track-uri="${uri}"]`);
            if (row) {
                const rowSlider = row.querySelector('.vol-mgr-row-slider');
                const rowNum = row.querySelector('.vol-mgr-row-num');
                const rowSaveBtn = row.querySelector('.vol-mgr-row-save-btn');
                const rowControls = row.querySelector('.vol-mgr-row-controls');
                
                if (rowSlider && rowNum && rowSaveBtn) {
                    if (isDeleted) {
                        const vol100 = Math.round(Spicetify.Player.getVolume() * 100);
                        rowSlider.value = vol100;
                        rowNum.value = vol100;
                        rowSaveBtn.innerText = "Save";
                        const rowDelBtn = row.querySelector('.del-row-btn');
                        if (rowDelBtn) rowDelBtn.remove();
                    } else {
                        const vol100 = Math.round(newVol * 100);
                        rowSlider.value = vol100;
                        rowNum.value = vol100;
                        rowSaveBtn.innerText = "Update";
                        
                        let rowDelBtn = row.querySelector('.del-row-btn');
                        if (!rowDelBtn && rowControls) {
                            rowDelBtn = createDelBtn(uri, rowSlider, rowNum, rowSaveBtn);
                            rowControls.appendChild(rowDelBtn);
                        }
                    }
                }
            }
        }

        const jsonArea = document.createElement("textarea");
        jsonArea.title = "Raw JSON data of your settings. You can copy this for backup.";
        jsonArea.style.cssText = inputStyle + " width: 100%; height: 120px; font-family: monospace; resize: vertical; box-sizing: border-box;";
        jsonArea.readOnly = true; 
        
        const presetSection = document.createElement("div");
        const trackSection = document.createElement("div");
        
        function updateAllUI() {
            renderPresets();
            renderTrackSection();
            renderJsonControls();
            jsonArea.value = JSON.stringify(config, null, 2);
        }

        window.volMgrUpdateTrackUI = () => { renderTrackSection(); };

        const settingsSection = document.createElement("div");
        settingsSection.innerHTML = `
            <h3 style="margin-bottom: 12px; margin-top: 0; color: var(--spice-text, #dedede);" title="General extension settings">General Settings</h3>
            <div style="display: flex; flex-direction: column; gap: 12px; background: rgba(220, 220, 220, 0.03); padding: 15px; border-radius: 8px; border: 1px solid rgba(220, 220, 220, 0.08);">
                
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(220,220,220,0.05); padding-bottom: 10px;" 
                     title="Enable Notifications">
                    <div>
                        <label style="color: var(--spice-text, #dedede); font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="vol-notify-toggle" ${config.showNotifications ? "checked" : ""}>
                            Enable Notifications
                        </label>
                        <div style="color: var(--spice-subtext); font-size: 0.85em; margin-top: 3px;">Displays desktop reminders on volume actions.</div>
                    </div>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(220,220,220,0.05); padding-bottom: 10px;"
                     title="Playback Bar Icon Size">
                    <div>
                        <label style="color: var(--spice-text, #dedede); font-weight: bold;">Playback Bar Icon Size (px)</label>
                        <div style="color: var(--spice-subtext); font-size: 0.85em; margin-top: 3px;">Adjusts the button width/height in the playbar. (Default: 19)</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="range" id="vol-btn-size-slider" min="12" max="32" value="${config.iconSize}" style="cursor: pointer;">
                        <input type="number" id="vol-btn-size" min="12" max="32" value="${config.iconSize}" style="${inputStyle} width: 60px; padding: 4px; text-align: center;">
                        <span style="color: var(--spice-text, #dedede);">px</span>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(220,220,220,0.05); padding-bottom: 10px;"
                     title="Hover Menu Opacity">
                    <div>
                        <label style="color: var(--spice-text, #dedede); font-weight: bold;">Hover Menu Opacity (%)</label>
                        <div style="color: var(--spice-subtext); font-size: 0.85em; margin-top: 3px;">Set higher (e.g. 85-100%) to solve text readability on transparent themes. (Default: 5)</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="range" id="vol-gui-opacity-slider" min="0" max="100" value="${Math.round(config.guiOpacity * 100)}" style="cursor: pointer;">
                        <input type="number" id="vol-gui-opacity" min="0" max="100" value="${Math.round(config.guiOpacity * 100)}" style="${inputStyle} width: 60px; padding: 4px; text-align: center;">
                        <span style="color: var(--spice-text, #dedede);">%</span>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(220,220,220,0.05); padding-bottom: 10px;"
                     title="Hover Menu Frosted Blur">
                    <div>
                        <label style="color: var(--spice-text, #dedede); font-weight: bold;">Hover Menu Frosted Blur (px)</label>
                        <div style="color: var(--spice-subtext); font-size: 0.85em; margin-top: 3px;">Adds an isolated background blur effect behind the hover menu. (Default: 0)</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="range" id="vol-gui-blur-slider" min="0" max="40" value="${config.guiBlur || 0}" style="cursor: pointer;">
                        <input type="number" id="vol-gui-blur" min="0" max="40" value="${config.guiBlur || 0}" style="${inputStyle} width: 60px; padding: 4px; text-align: center;">
                        <span style="color: var(--spice-text, #dedede);">px</span>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(220,220,220,0.05); padding-bottom: 10px;"
                     title="Choose how the volume changes when a track transitions">
                    <div>
                        <label style="color: var(--spice-text, #dedede); font-weight: bold;">Volume Transition Mode</label>
                        <div style="color: var(--spice-subtext); font-size: 0.85em; margin-top: 3px;">Instant changes volume immediately. Progressive transitions smoothly.</div>
                    </div>
                    <div>
                        <select id="vol-transition-mode" style="${inputStyle} cursor: pointer;">
                            <option value="instant" ${config.volumeTransitionMode === "instant" ? "selected" : ""}>Instant</option>
                            <option value="progressive" ${config.volumeTransitionMode === "progressive" ? "selected" : ""}>Progressive</option>
                        </select>
                    </div>
                </div>

                <div id="vol-transition-duration-container" style="display: ${config.volumeTransitionMode === "instant" ? "none" : "flex"} !important; justify-content: space-between; align-items: center;"
                     title="Transition Duration">
                    <div>
                        <label style="color: var(--spice-text, #dedede); font-weight: bold;">Transition Speed (ms)</label>
                        <div style="color: var(--spice-subtext); font-size: 0.85em; margin-top: 3px;">How long the progressive volume transition takes in milliseconds.</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="range" id="vol-transition-duration-slider" min="100" max="3000" step="100" value="${config.transitionDuration || 1000}" style="cursor: pointer;">
                        <input type="number" id="vol-transition-duration" min="100" max="3000" step="100" value="${config.transitionDuration || 1000}" style="${inputStyle} width: 70px; padding: 4px; text-align: center;">
                        <span style="color: var(--spice-text, #dedede);">ms</span>
                    </div>
                </div>

            </div>
        `;

        const notifyToggle = settingsSection.querySelector('#vol-notify-toggle');
        const btnSizeSlider = settingsSection.querySelector('#vol-btn-size-slider');
        const btnSizeNum = settingsSection.querySelector('#vol-btn-size');
        const opacitySlider = settingsSection.querySelector('#vol-gui-opacity-slider');
        const opacityNum = settingsSection.querySelector('#vol-gui-opacity');
        const blurSlider = settingsSection.querySelector('#vol-gui-blur-slider');
        const blurNum = settingsSection.querySelector('#vol-gui-blur');
        const transitionModeSelect = settingsSection.querySelector('#vol-transition-mode');
        const durationContainer = settingsSection.querySelector('#vol-transition-duration-container');
        const durationSlider = settingsSection.querySelector('#vol-transition-duration-slider');
        const durationNum = settingsSection.querySelector('#vol-transition-duration');

        notifyToggle.onchange = (e) => {
            config.showNotifications = e.target.checked;
            saveConfig();
        };

        const syncSize = (val) => {
            const parsed = parseInt(val);
            if (!isNaN(parsed)) {
                config.iconSize = Math.max(12, Math.min(32, parsed));
                btnSizeSlider.value = config.iconSize;
                saveConfig();
                injectButton();
            }
        };
        btnSizeSlider.oninput = (e) => {
            btnSizeNum.value = e.target.value;
            syncSize(e.target.value);
        };
        btnSizeNum.oninput = (e) => {
            const parsed = parseInt(e.target.value);
            if (!isNaN(parsed)) {
                btnSizeSlider.value = Math.max(12, Math.min(32, parsed));
                syncSize(e.target.value);
            }
        };
        btnSizeNum.onblur = () => {
            if (btnSizeNum.value.trim() === "" || isNaN(parseInt(btnSizeNum.value))) {
                const defaultVal = 19;
                config.iconSize = defaultVal;
                btnSizeNum.value = defaultVal;
                btnSizeSlider.value = defaultVal;
                saveConfig();
                injectButton();
            }
        };

        const syncOpacity = (val) => {
            const parsed = parseInt(val);
            if (!isNaN(parsed)) {
                config.guiOpacity = Math.max(0, Math.min(100, parsed)) / 100;
                opacitySlider.value = Math.round(config.guiOpacity * 100);
                saveConfig();
            }
        };
        opacitySlider.oninput = (e) => {
            opacityNum.value = e.target.value;
            syncOpacity(e.target.value);
        };
        opacityNum.oninput = (e) => {
            const parsed = parseInt(e.target.value);
            if (!isNaN(parsed)) {
                opacitySlider.value = Math.max(0, Math.min(100, parsed));
                syncOpacity(e.target.value);
            }
        };
        opacityNum.onblur = () => {
            if (opacityNum.value.trim() === "" || isNaN(parseInt(opacityNum.value))) {
                const defaultVal = 5;
                config.guiOpacity = defaultVal / 100;
                opacityNum.value = defaultVal;
                opacitySlider.value = defaultVal;
                saveConfig();
            }
        };

        const syncBlur = (val) => {
            const parsed = parseInt(val);
            if (!isNaN(parsed)) {
                config.guiBlur = Math.max(0, Math.min(40, parsed));
                blurSlider.value = config.guiBlur;
                saveConfig();
            }
        };
        blurSlider.oninput = (e) => {
            blurNum.value = e.target.value;
            syncBlur(e.target.value);
        };
        blurNum.oninput = (e) => {
            const parsed = parseInt(e.target.value);
            if (!isNaN(parsed)) {
                blurSlider.value = Math.max(0, Math.min(40, parsed));
                syncBlur(e.target.value);
            }
        };
        blurNum.onblur = () => {
            if (blurNum.value.trim() === "" || isNaN(parseInt(blurNum.value))) {
                const defaultVal = 0;
                config.guiBlur = defaultVal;
                blurNum.value = defaultVal;
                blurSlider.value = defaultVal;
                saveConfig();
            }
        };

        transitionModeSelect.onchange = (e) => {
            config.volumeTransitionMode = e.target.value;
            saveConfig();
            if (config.volumeTransitionMode === "instant") {
                durationContainer.style.setProperty('display', 'none', 'important');
            } else {
                durationContainer.style.setProperty('display', 'flex', 'important');
            }
        };

        const syncDuration = (val) => {
            const parsed = parseInt(val);
            if (!isNaN(parsed)) {
                config.transitionDuration = Math.max(100, Math.min(3000, parsed));
                durationSlider.value = config.transitionDuration;
                saveConfig();
            }
        };
        durationSlider.oninput = (e) => {
            durationNum.value = e.target.value;
            syncDuration(e.target.value);
        };
        durationNum.oninput = (e) => {
            const parsed = parseInt(e.target.value);
            if (!isNaN(parsed)) {
                durationSlider.value = Math.max(100, Math.min(3000, parsed));
                syncDuration(e.target.value);
            }
        };
        durationNum.onblur = () => {
            if (durationNum.value.trim() === "" || isNaN(parseInt(durationNum.value))) {
                const defaultVal = 1000;
                config.transitionDuration = defaultVal;
                durationNum.value = defaultVal;
                durationSlider.value = defaultVal;
                saveConfig();
            }
        };

        function renderPresets() {
            presetSection.innerHTML = "";

            const titleRow = document.createElement("div");
            titleRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;";
            
            const titleH3 = document.createElement("h3");
            titleH3.innerText = "Quick Presets";
            titleH3.style.margin = "0";
            titleH3.style.color = "var(--spice-text, #dedede)";
            titleH3.title = "Save volume levels to quickly apply them later. Click on a preset to apply it.";
            titleRow.appendChild(titleH3);

            const clearBtn = document.createElement("button");
            clearBtn.title = "Delete all of your saved presets from local storage.";
            if (clearAllConfirming) {
                clearBtn.innerText = "⚠️ Confirm Clear All?";
                clearBtn.style.cssText = "background: #d32f2f; color: #dedede; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em; font-weight: bold; animation: pulse 1s infinite;";
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    config.presets = [];
                    saveConfig();
                    clearAllConfirming = false;
                    updateAllUI();
                    notify("All presets deleted.");
                };
                setTimeout(() => {
                    if (clearAllConfirming) {
                        clearAllConfirming = false;
                        updateAllUI();
                    }
                }, 4000);
            } else {
                clearBtn.innerText = "🗑️ Clear All";
                clearBtn.style.cssText = "background: rgba(226, 33, 52, 0.1); color: #e22134; border: 1px solid #e22134; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85em; font-weight: bold;";
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    clearAllConfirming = true;
                    updateAllUI();
                };
            }
            titleRow.appendChild(clearBtn);
            presetSection.appendChild(titleRow);

            const presetList = document.createElement("div");
            presetList.style.display = "flex";
            presetList.style.flexDirection = "column";
            presetList.style.gap = "8px";
            
            if (!config.presets || config.presets.length === 0) {
                presetList.innerHTML = `<span style="color: var(--spice-subtext);">No presets created yet. Use the fields below to add one!</span>`;
            }
            
            config.presets.forEach((preset, index) => {
                const wrapper = document.createElement("div");
                wrapper.style.display = "flex";
                wrapper.style.alignItems = "stretch";
                wrapper.style.gap = "4px";

                if (editingPresetIndex === index) {
                    const renameInput = document.createElement("input");
                    renameInput.type = "text";
                    renameInput.value = preset.name;
                    renameInput.style.cssText = inputStyle + " flex-grow: 1; padding: 4px 8px;";
                    renameInput.title = "Type a new name for this preset.";
                    
                    const saveBtn = document.createElement("button");
                    saveBtn.innerText = "✓ Save";
                    saveBtn.title = "Save the new preset name.";
                    saveBtn.style.cssText = btnStyle + " padding: 4px 12px; background: #2e7d32; color: #dedede;";
                    saveBtn.onclick = (e) => {
                        e.stopPropagation();
                        const val = renameInput.value.trim();
                        if (val) {
                            preset.name = val;
                            saveConfig();
                        }
                        editingPresetIndex = -1;
                        updateAllUI();
                    };

                    const cancelBtn = document.createElement("button");
                    cancelBtn.innerText = "✗ Cancel";
                    cancelBtn.title = "Discard name change.";
                    cancelBtn.style.cssText = btnStyle + " padding: 4px 12px; background: #c62828; color: #dedede;";
                    cancelBtn.onclick = (e) => {
                        e.stopPropagation();
                        editingPresetIndex = -1;
                        updateAllUI();
                    };

                    wrapper.appendChild(renameInput);
                    wrapper.appendChild(saveBtn);
                    wrapper.appendChild(cancelBtn);
                } else {
                    const btn = document.createElement("button");
                    btn.title = `Apply preset: ${preset.name} (${Math.round(preset.vol * 100)}%)`;
                    btn.style.cssText = btnStyle + " background: var(--spice-button-active); flex-grow: 1; text-align: left; border-top-right-radius: 0; border-bottom-right-radius: 0; display: flex; justify-content: space-between; align-items: center;";
                    btn.innerHTML = `<span>${preset.name}</span> <strong style="opacity: 0.85; color: var(--spice-text, #dedede);">${Math.round(preset.vol * 100)}%</strong>`;
                    btn.onclick = () => attemptApplyPreset(preset);
                    
                    const upBtn = document.createElement("button");
                    upBtn.title = "Move preset up";
                    upBtn.style.cssText = btnGroupStyle + " border-radius: 0;";
                    upBtn.innerText = "↑";
                    upBtn.disabled = index === 0;
                    if (index === 0) upBtn.style.opacity = "0.3";
                    upBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (index > 0) {
                            [config.presets[index - 1], config.presets[index]] = [config.presets[index], config.presets[index - 1]];
                            saveConfig();
                            updateAllUI();
                        }
                    };

                    const downBtn = document.createElement("button");
                    downBtn.title = "Move preset down";
                    downBtn.style.cssText = btnGroupStyle + " border-radius: 0;";
                    downBtn.innerText = "↓";
                    downBtn.disabled = index === config.presets.length - 1;
                    if (index === config.presets.length - 1) downBtn.style.opacity = "0.3";
                    downBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (index < config.presets.length - 1) {
                            [config.presets[index + 1], config.presets[index]] = [config.presets[index], config.presets[index + 1]];
                            saveConfig();
                            updateAllUI();
                        }
                    };

                    const renBtn = document.createElement("button");
                    renBtn.title = "Rename preset";
                    renBtn.style.cssText = btnGroupStyle + " border-radius: 0;";
                    renBtn.innerText = "✎";
                    renBtn.onclick = (e) => {
                        e.stopPropagation();
                        editingPresetIndex = index;
                        updateAllUI();
                    };

                    const delBtn = document.createElement("button");
                    if (deletingPresetIndex === index) {
                        delBtn.innerText = "Confirm?";
                        delBtn.title = "Confirm deletion of this quick preset.";
                        delBtn.style.cssText = btnGroupStyle + " background: #d32f2f; color: #dedede; border-top-right-radius: 4px; border-bottom-right-radius: 4px; font-weight: bold;";
                        delBtn.onclick = (e) => {
                            e.stopPropagation();
                            config.presets.splice(index, 1);
                            saveConfig();
                            deletingPresetIndex = -1;
                            updateAllUI();
                            notify("Preset deleted.");
                        };
                        setTimeout(() => {
                            if (deletingPresetIndex === index) {
                                deletingPresetIndex = -1;
                                updateAllUI();
                            }
                        }, 3000);
                    } else {
                        delBtn.innerText = "X";
                        delBtn.title = "Delete preset";
                        delBtn.style.cssText = btnGroupStyle + " background: rgba(226, 33, 52, 0.15); color: #e22134; border-top-right-radius: 4px; border-bottom-right-radius: 4px;";
                        delBtn.onclick = (e) => {
                            e.stopPropagation();
                            deletingPresetIndex = index;
                            updateAllUI();
                        };
                    }

                    wrapper.appendChild(btn);
                    wrapper.appendChild(upBtn);
                    wrapper.appendChild(downBtn);
                    wrapper.appendChild(renBtn);
                    wrapper.appendChild(delBtn);
                }
                presetList.appendChild(wrapper);
            });
            
            presetSection.appendChild(presetList);

            const addPresetDiv = document.createElement("div");
            addPresetDiv.style.marginTop = "15px";
            addPresetDiv.style.display = "flex";
            addPresetDiv.style.gap = "10px";
            addPresetDiv.style.alignItems = "center";
            addPresetDiv.style.flexWrap = "wrap";
            addPresetDiv.style.color = "var(--spice-text, #dedede)";
            
            const presetNameInput = document.createElement("input");
            presetNameInput.type = "text";
            presetNameInput.placeholder = "Preset Name (e.g. Chill, Rock)";
            presetNameInput.title = "Enter a name for the new preset";
            presetNameInput.style.cssText = inputStyle + " flex-grow: 1;";
            
            const currentVol100 = Math.round(Spicetify.Player.getVolume() * 100);
            
            const presetVolSlider = document.createElement("input");
            presetVolSlider.type = "range";
            presetVolSlider.min = "0"; presetVolSlider.max = "100"; presetVolSlider.step = "1";
            presetVolSlider.value = currentVol100;
            presetVolSlider.title = "Drag to choose the preset volume";
            
            const presetVolNum = document.createElement("input");
            presetVolNum.type = "number";
            presetVolNum.min = "0"; presetVolNum.max = "100";
            presetVolNum.style.cssText = inputStyle + " width: 60px;";
            presetVolNum.value = currentVol100;
            presetVolNum.title = "Type a specific volume percentage";

            presetVolSlider.oninput = () => presetVolNum.value = presetVolSlider.value;
            presetVolNum.oninput = () => {
                const parsed = parseInt(presetVolNum.value);
                if (!isNaN(parsed)) {
                    presetVolSlider.value = Math.max(0, Math.min(100, parsed));
                }
            };
            
            const addPresetBtn = document.createElement("button");
            addPresetBtn.innerText = "+ Add Preset";
            addPresetBtn.title = "Save the chosen volume as a new preset";
            addPresetBtn.style.cssText = btnStyle;
            addPresetBtn.onclick = (e) => {
                e.stopPropagation();
                const name = presetNameInput.value.trim();
                if (name !== "") {
                    config.presets.push({ name: name, vol: parseFloat(presetVolNum.value) / 100 });
                    saveConfig();
                    presetNameInput.value = "";
                    updateAllUI();
                    notify(`Created preset: ${name}`);
                }
            };
            
            addPresetDiv.appendChild(presetNameInput);
            addPresetDiv.appendChild(presetVolSlider);
            addPresetDiv.appendChild(presetVolNum);
            const percentSpan = document.createElement("span");
            percentSpan.innerText = "%";
            percentSpan.style.color = "var(--spice-text, #dedede)";
            addPresetDiv.appendChild(percentSpan);
            addPresetDiv.appendChild(addPresetBtn);
            presetSection.appendChild(addPresetDiv);
        }

        function renderTrackSection() {
            trackSection.innerHTML = "";

            const track = getCurrentTrack();
            const trackUri = getCurrentUri();
            
            if (track && trackUri) {
                const title = track.metadata?.title || track.name || "Unknown Title";
                const artist = track.metadata?.artist_name || (track.artists && track.artists[0]?.name) || "Unknown Artist";
                const albumName = track.album?.name || track.metadata?.album_title || "Unknown Album";
                const albumUri = track.album?.uri || track.metadata?.album_uri || "";
                const isAlbumContext = albumUri && albumUri.startsWith("spotify:album:");

                const trackInfo = document.createElement("p");
                trackInfo.innerHTML = `Currently Playing:<br><strong style="color: var(--spice-text, #dedede); font-size: 1.1em;">${title}</strong> by ${artist}<br><span style="color: var(--spice-subtext); font-size: 0.9em;">Album: ${albumName}</span>`;
                trackInfo.style.color = "var(--spice-subtext)";
                trackInfo.style.marginBottom = "15px";
                trackSection.appendChild(trackInfo);

                const trackHeader = document.createElement("h3");
                trackHeader.innerText = "Custom Volume for Current Song";
                trackHeader.style.cssText = "margin-bottom: 10px; color: var(--spice-text, #dedede);";
                trackHeader.title = "Lock a specific volume for the currently playing song.";
                trackSection.appendChild(trackHeader);

                const trackControls = document.createElement("div");
                trackControls.id = "vol-mgr-curr-track-controls";
                trackControls.style.display = "flex";
                trackControls.style.gap = "10px";
                trackControls.style.alignItems = "center";
                trackControls.style.marginBottom = "20px";
                trackControls.style.color = "var(--spice-text, #dedede)";

                const currentVol100 = Math.round(Spicetify.Player.getVolume() * 100);
                const activeVol = getSavedVolume(trackUri);
                const hasCustomVol = activeVol !== -1; 
                let savedTrackVol = hasCustomVol ? Math.round(activeVol * 100) : currentVol100;

                const trackVolSlider = document.createElement("input");
                trackVolSlider.id = "vol-mgr-curr-track-slider";
                trackVolSlider.type = "range";
                trackVolSlider.min = "0"; trackVolSlider.max = "100"; trackVolSlider.step = "1";
                trackVolSlider.value = savedTrackVol;
                trackVolSlider.title = "Drag to choose a custom volume for this track";

                const trackVolNum = document.createElement("input");
                trackVolNum.id = "vol-mgr-curr-track-num";
                trackVolNum.type = "number";
                trackVolNum.min = "0"; trackVolNum.max = "100";
                trackVolNum.style.cssText = inputStyle + " width: 60px;";
                trackVolNum.value = savedTrackVol;
                trackVolNum.title = "Type a custom volume percentage for this track";

                trackVolSlider.oninput = () => trackVolNum.value = trackVolSlider.value;
                trackVolNum.oninput = () => {
                    const parsed = parseInt(trackVolNum.value);
                    if (!isNaN(parsed)) {
                        trackVolSlider.value = Math.max(0, Math.min(100, parsed));
                    }
                };

                const saveTrackBtn = document.createElement("button");
                saveTrackBtn.id = "vol-mgr-curr-track-save-btn";
                saveTrackBtn.innerText = hasCustomVol ? "Update Custom Vol" : "Save Custom Vol";
                saveTrackBtn.title = hasCustomVol ? "Update the locked volume for this song" : "Lock the current volume for this song";
                saveTrackBtn.style.cssText = btnStyle;
                saveTrackBtn.onclick = (e) => {
                    e.stopPropagation();
                    const newVol = parseFloat(trackVolNum.value) / 100;
                    setSavedVolume(trackUri, newVol);
                    applyTargetVolume(newVol, false, isLocalUri(trackUri));
                    
                    syncTrackVolumeUI(trackUri, false, newVol);
                    notify("Saved and locked custom volume for this track!");
                };

                const activeAlbumVol = getSavedAlbumVolume(albumUri);
                const hasAlbumVol = activeAlbumVol !== -1;

                if (hasAlbumVol) {
                    trackVolSlider.disabled = true;
                    trackVolNum.disabled = true;
                    saveTrackBtn.disabled = true;
                    saveTrackBtn.style.opacity = "0.5";
                    saveTrackBtn.style.cursor = "not-allowed";
                    
                    const warningDiv = document.createElement("div");
                    warningDiv.style.cssText = "background: rgba(226, 33, 52, 0.1); border: 1px solid #e22134; padding: 10px 12px; border-radius: 6px; margin-bottom: 15px; color: #e22134; font-weight: bold; font-size: 0.9em;";
                    warningDiv.innerText = "⚠️ Individual song volumes & Quick Editor are disabled because an entire Album Volume is active! Delete the Album Custom Volume below to re-enable.";
                    trackSection.appendChild(warningDiv);
                }

                trackControls.appendChild(trackVolSlider);
                trackControls.appendChild(trackVolNum);
                const percentSpanTrack = document.createElement("span");
                percentSpanTrack.innerText = "%";
                percentSpanTrack.style.color = "var(--spice-text, #dedede)";
                trackControls.appendChild(percentSpanTrack);
                trackControls.appendChild(saveTrackBtn);

                if (hasCustomVol) {
                    const clearTrackBtn = document.createElement("button");
                    clearTrackBtn.id = "vol-mgr-curr-track-delete-btn";
                    clearTrackBtn.innerText = "Delete Custom Vol";
                    clearTrackBtn.title = "Remove the locked volume for this song";
                    clearTrackBtn.style.cssText = btnStyle + " background: #e22134;";
                    if (hasAlbumVol) {
                        clearTrackBtn.disabled = true;
                        clearTrackBtn.style.opacity = "0.5";
                        clearTrackBtn.style.cursor = "not-allowed";
                    }
                    clearTrackBtn.onclick = (e) => {
                        e.stopPropagation();
                        deleteSavedVolume(trackUri);
                        applyTargetVolume(lastGenericVolume, true, isLocalUri(trackUri)); 
                        
                        syncTrackVolumeUI(trackUri, true);
                        notify("Removed custom volume! Restored normal volume.");
                    };
                    trackControls.appendChild(clearTrackBtn);
                }
                trackSection.appendChild(trackControls);

                if (isAlbumContext) {
                    const hrBetween = document.createElement("hr");
                    hrBetween.style.cssText = "border: none; border-top: 1px solid rgba(220,220,220,0.05); margin: 15px 0;";
                    trackSection.appendChild(hrBetween);

                    const albumHeader = document.createElement("h3");
                    albumHeader.innerText = "Custom Volume for Entire Album";
                    albumHeader.style.cssText = "margin-bottom: 10px; color: var(--spice-text, #dedede);";
                    albumHeader.title = "Lock a specific volume for the entire album.";
                    trackSection.appendChild(albumHeader);

                    const albumControls = document.createElement("div");
                    albumControls.style.display = "flex";
                    albumControls.style.gap = "10px";
                    albumControls.style.alignItems = "center";
                    albumControls.style.marginBottom = "20px";
                    albumControls.style.color = "var(--spice-text, #dedede)";

                    let savedAlbumVolVal = hasAlbumVol ? Math.round(activeAlbumVol * 100) : currentVol100;

                    const albumVolSlider = document.createElement("input");
                    albumVolSlider.type = "range";
                    albumVolSlider.min = "0"; albumVolSlider.max = "100"; albumVolSlider.step = "1";
                    albumVolSlider.value = savedAlbumVolVal;
                    albumVolSlider.title = "Drag to choose a custom volume for this entire album";

                    const albumVolNum = document.createElement("input");
                    albumVolNum.type = "number";
                    albumVolNum.min = "0"; albumVolNum.max = "100";
                    albumVolNum.style.cssText = inputStyle + " width: 60px;";
                    albumVolNum.value = savedAlbumVolVal;
                    albumVolNum.title = "Type a custom volume percentage for this entire album";

                    albumVolSlider.oninput = () => albumVolNum.value = albumVolSlider.value;
                    albumVolNum.oninput = () => {
                        const parsed = parseInt(albumVolNum.value);
                        if (!isNaN(parsed)) {
                            albumVolSlider.value = Math.max(0, Math.min(100, parsed));
                        }
                    };

                    const saveAlbumBtn = document.createElement("button");
                    saveAlbumBtn.innerText = hasAlbumVol ? "Update Album Vol" : "Save Album Vol";
                    saveAlbumBtn.title = hasAlbumVol ? "Update the locked volume for this entire album" : "Lock the current volume for this entire album";
                    saveAlbumBtn.style.cssText = btnStyle;
                    saveAlbumBtn.onclick = (e) => {
                        e.stopPropagation();
                        const newVol = parseFloat(albumVolNum.value) / 100;
                        setSavedAlbumVolume(albumUri, newVol);
                        applyTargetVolume(newVol, false, isLocalUri(trackUri));
                        setTimeout(updateAllUI, 10);
                        notify("Saved and locked custom volume for this album!");
                    };

                    albumControls.appendChild(albumVolSlider);
                    albumControls.appendChild(albumVolNum);
                    const percentSpanAlbum = document.createElement("span");
                    percentSpanAlbum.innerText = "%";
                    percentSpanAlbum.style.color = "var(--spice-text, #dedede)";
                    albumControls.appendChild(percentSpanAlbum);
                    albumControls.appendChild(saveAlbumBtn);

                    if (hasAlbumVol) {
                        const clearAlbumBtn = document.createElement("button");
                        clearAlbumBtn.innerText = "Delete Album Vol";
                        clearAlbumBtn.title = "Remove the locked volume for this album";
                        clearAlbumBtn.style.cssText = btnStyle + " background: #e22134;";
                        clearAlbumBtn.onclick = (e) => {
                            e.stopPropagation();
                            deleteSavedAlbumVolume(albumUri);
                            applyTargetVolume(lastGenericVolume, true, isLocalUri(trackUri));
                            setTimeout(updateAllUI, 10);
                            notify("Removed album custom volume! Restored normal volume.");
                        };
                        albumControls.appendChild(clearAlbumBtn);
                    }
                    trackSection.appendChild(albumControls);
                }

                const hrBetweenDropdown = document.createElement("hr");
                hrBetweenDropdown.style.cssText = "border: none; border-top: 1px solid rgba(220,220,220,0.05); margin: 15px 0;";
                trackSection.appendChild(hrBetweenDropdown);

                const details = document.createElement("details");
                details.id = "context-tracks-details";
                details.style.cssText = "background: rgba(220, 220, 220, 0.03); border: 1px solid rgba(220, 220, 220, 0.08); border-radius: 8px; padding: 12px; margin-top: 10px;";
                
                const summary = document.createElement("summary");
                summary.style.cssText = "font-weight: bold; cursor: pointer; color: var(--spice-text, #dedede); padding: 5px; outline: none; list-style: none; display: flex; align-items: center; justify-content: space-between;";
                
                const arrow = document.createElement("span");
                arrow.innerText = "▶";
                arrow.style.transition = "transform 0.2s ease";
                arrow.style.color = "var(--spice-text, #dedede)";
                
                if (hasAlbumVol) {
                    summary.innerText = "📋 Quick Track Volume Editor (Disabled - Album Vol Active)";
                    summary.style.pointerEvents = "none";
                    summary.style.opacity = "0.5";
                    details.style.opacity = "0.6";
                    details.appendChild(summary);
                } else {
                    summary.innerText = "📋 Quick Track Volume Editor (Album / Playlist)";
                    summary.appendChild(arrow);
                    details.appendChild(summary);

                    const sourceToggleDiv = document.createElement("div");
                    sourceToggleDiv.style.cssText = "display: flex; gap: 10px; margin-top: 12px; margin-bottom: 12px; align-items: center;";

                    const labelSpan = document.createElement("span");
                    labelSpan.innerText = "Toggle Source:";
                    labelSpan.style.cssText = "color: var(--spice-subtext); font-size: 0.9em; font-weight: bold;";
                    sourceToggleDiv.appendChild(labelSpan);

                    const btnPlaying = document.createElement("button");
                    btnPlaying.innerText = "Currently Playing Context";
                    btnPlaying.title = "Load tracks from your currently playing album/playlist.";

                    const btnPage = document.createElement("button");
                    btnPage.innerText = "Current Page";
                    btnPage.title = "Load tracks from the album, single, ep, or playlist page you are viewing.";

                    const updateToggleStyle = () => {
                        if (editorSource === "playing") {
                            btnPlaying.style.cssText = btnStyle + " padding: 4px 10px; background: var(--spice-button-active); font-size: 0.85em;";
                            btnPage.style.cssText = btnStyle + " padding: 4px 10px; background: rgba(220,220,220,0.05); color: var(--spice-subtext); font-size: 0.85em;";
                        } else {
                            btnPlaying.style.cssText = btnStyle + " padding: 4px 10px; background: rgba(220,220,220,0.05); color: var(--spice-subtext); font-size: 0.85em;";
                            btnPage.style.cssText = btnStyle + " padding: 4px 10px; background: var(--spice-button-active); font-size: 0.85em;";
                        }
                    };

                    updateToggleStyle();

                    const listContainer = document.createElement("div");
                    listContainer.id = "context-tracks-container";
                    listContainer.style.cssText = "margin-top: 15px; display: flex; flex-direction: column; gap: 10px; max-height: 350px; overflow-y: auto; padding-right: 5px;";
                    listContainer.innerHTML = `<span style="color: var(--spice-subtext);">Click to expand and load tracks...</span>`;

                    const renderFetchedTracks = (tracks) => {
                        if (!tracks || tracks.length === 0) {
                            listContainer.innerHTML = `<span style="color: var(--spice-subtext);">No tracks found for this context.</span>`;
                            return;
                        }

                        listContainer.innerHTML = "";
                        tracks.forEach((t, i) => {
                            const trackRow = document.createElement("div");
                            trackRow.setAttribute("data-track-uri", t.uri);
                            trackRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid rgba(220,220,220,0.04); padding-bottom: 8px;";

                            const trackInfo = document.createElement("div");
                            trackInfo.style.cssText = "flex-grow: 1; min-width: 0;";
                            trackInfo.innerHTML = `
                                <div style="font-weight: bold; color: var(--spice-text, #dedede); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${i + 1}. ${t.name}</div>
                                <div style="color: var(--spice-subtext); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.artists || "Unknown Artist"}</div>
                            `;

                            const trackVol = getSavedVolume(t.uri);
                            const hasCustom = trackVol !== -1;
                            const activeVol100 = hasCustom ? Math.round(trackVol * 100) : Math.round(Spicetify.Player.getVolume() * 100);

                            const rowControls = document.createElement("div");
                            rowControls.className = "vol-mgr-row-controls";
                            rowControls.style.cssText = "display: flex; align-items: center; gap: 8px; flex-shrink: 0;";

                            const rowSlider = document.createElement("input");
                            rowSlider.className = "vol-mgr-row-slider";
                            rowSlider.type = "range";
                            rowSlider.min = "0"; rowSlider.max = "100"; rowSlider.step = "1";
                            rowSlider.value = activeVol100;
                            rowSlider.style.width = "85px";

                            const rowNum = document.createElement("input");
                            rowNum.className = "vol-mgr-row-num";
                            rowNum.type = "number";
                            rowNum.min = "0"; rowNum.max = "100";
                            rowNum.value = activeVol100;
                            rowNum.style.cssText = inputStyle + " width: 45px; padding: 3px; text-align: center;";

                            rowSlider.oninput = () => { rowNum.value = rowSlider.value; };
                            rowNum.oninput = () => {
                                const parsed = parseInt(rowNum.value);
                                if (!isNaN(parsed)) {
                                    rowSlider.value = Math.max(0, Math.min(100, parsed));
                                }
                            };

                            const saveRowBtn = document.createElement("button");
                            saveRowBtn.className = "vol-mgr-row-save-btn";
                            saveRowBtn.innerText = hasCustom ? "Update" : "Save";
                            saveRowBtn.style.cssText = btnStyle + " padding: 4px 10px; font-size: 0.85em;";
                            saveRowBtn.onclick = (event) => {
                                event.stopPropagation();
                                const newVol = parseFloat(rowNum.value) / 100;
                                setSavedVolume(t.uri, newVol);

                                if (t.uri === getCurrentUri()) {
                                    applyTargetVolume(newVol, false, isLocalUri(t.uri));
                                }
                                
                                syncTrackVolumeUI(t.uri, false, newVol);
                                notify(`Saved custom volume for "${t.name}"!`);
                            };

                            rowControls.appendChild(rowSlider);
                            rowControls.appendChild(rowNum);
                            const percentSpanRow = document.createElement("span");
                            percentSpanRow.innerText = "%";
                            percentSpanRow.style.color = "var(--spice-text, #dedede)";
                            rowControls.appendChild(percentSpanRow);
                            rowControls.appendChild(saveRowBtn);

                            if (hasCustom) {
                                rowControls.appendChild(createDelBtn(t.uri, rowSlider, rowNum, saveRowBtn));
                            }

                            trackRow.appendChild(trackInfo);
                            trackRow.appendChild(rowControls);
                            listContainer.appendChild(trackRow);
                        });
                    };

                    const reloadTracksList = async () => {
                        listContainer.innerHTML = "";
                        if (editorSource === "playing") {
                            listContainer.innerHTML = `<span style="color: var(--spice-subtext);">Loading tracks from currently playing context...</span>`;
                            const contextUri = getCurrentContextUri();
                            const tracks = await fetchContextTracks(contextUri, albumUri);
                            renderFetchedTracks(tracks);
                        } else {
                            const pageResult = getPageUri();
                            if (pageResult.error) {
                                listContainer.innerHTML = `<div style="color: #e22134; padding: 10px; font-weight: bold; border: 1px dashed rgba(226, 33, 52, 0.3); border-radius: 6px; background: rgba(226, 33, 52, 0.05); font-size: 0.9em; line-height: 1.4;">⚠️ Error: ${pageResult.error}</div>`;
                                return;
                            }
                            listContainer.innerHTML = `<span style="color: var(--spice-subtext);">Loading tracks from current page...</span>`;
                            const tracks = await fetchContextTracks(pageResult.uri, pageResult.uri);
                            renderFetchedTracks(tracks);
                        }
                    };

                    btnPlaying.onclick = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        editorSource = "playing";
                        updateToggleStyle();
                        reloadTracksList();
                    };

                    btnPage.onclick = (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        editorSource = "page";
                        updateToggleStyle();
                        reloadTracksList();
                    };

                    sourceToggleDiv.appendChild(btnPlaying);
                    sourceToggleDiv.appendChild(btnPage);
                    details.appendChild(sourceToggleDiv);
                    details.appendChild(listContainer);

                    details.ontoggle = async () => {
                        if (details.open) {
                            arrow.innerText = "▼";
                            await reloadTracksList();
                        } else {
                            arrow.innerText = "▶";
                        }
                    };
                }
                
                trackSection.appendChild(details);

            } else {
                trackSection.innerHTML = `<h3 style="margin-bottom: 10px; color: var(--spice-text, #dedede);" title="Lock a specific volume for the currently playing song.">Custom Volume for Current Song</h3>`;
                trackSection.innerHTML += `<p style="color: var(--spice-subtext);">Play a song first to set a custom volume for it.</p>`;
            }
        }

        const jsonSection = document.createElement("div");
        jsonSection.innerHTML = `<h3 style="margin-bottom: 10px; color: var(--spice-text, #dedede);" title="Export or import your saved presets and custom song volumes.">Data Manager</h3>`;
        
        const jsonControls = document.createElement("div");
        jsonControls.style.display = "flex";
        jsonControls.style.flexWrap = "wrap";
        jsonControls.style.gap = "10px";
        jsonControls.style.marginTop = "10px";

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json";
        fileInput.style.display = "none";
        
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    if (parsed.presets && parsed.songVolumes) {
                        config = parsed;
                        if (!config.albumVolumes) config.albumVolumes = {};
                        saveConfig();
                        setTimeout(updateAllUI, 10);
                        notify("Backup imported successfully!");
                    } else { throw new Error("Invalid format"); }
                } catch(err) { notify("Error: The file is not a valid Volume Manager backup!"); }
            };
            reader.readAsText(file);
            fileInput.value = "";
        };

        function renderJsonControls() {
            jsonControls.innerHTML = "";

            const exportBtn = document.createElement("button");
            exportBtn.innerText = "📥 Download .json Backup";
            exportBtn.title = "Download your custom volumes and presets to a file as a backup.";
            exportBtn.style.cssText = btnStyle;
            exportBtn.onclick = () => {
                const dataStr = JSON.stringify(config, null, 2);
                const blob = new Blob([dataStr], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "spicetify_volume_manager.json";
                a.click();
                URL.revokeObjectURL(url);
                notify("Backup file downloaded!");
            };

            const importBtn = document.createElement("button");
            importBtn.innerText = "📂 Import .json Backup";
            importBtn.title = "Load and restore your custom volumes and presets from a backup file.";
            importBtn.style.cssText = btnStyle;
            importBtn.onclick = () => fileInput.click();

            const resetBtn = document.createElement("button");
            resetBtn.title = "Permanently clear and reset all of your presets and custom song volumes.";
            if (resetAllConfirming) {
                resetBtn.innerText = "⚠️ CONFIRM FULL RESET (CANNOT BE UNDONE)";
                resetBtn.style.cssText = btnStyle + " background: #d32f2f; color: #dedede; margin-left: auto;";
                resetBtn.onclick = (e) => {
                    e.stopPropagation();
                    config = { 
                        presets: [], 
                        songVolumes: {}, 
                        albumVolumes: {},
                        showNotifications: config.showNotifications, 
                        lastGenericVolume: lastGenericVolume, 
                        iconSize: config.iconSize, 
                        guiOpacity: config.guiOpacity,
                        guiBlur: config.guiBlur,
                        volumeTransitionMode: config.volumeTransitionMode,
                        transitionDuration: config.transitionDuration
                    };
                    saveConfig();
                    resetAllConfirming = false;
                    const isLocal = isLocalUri(getCurrentUri());
                    applyTargetVolume(lastGenericVolume, true, isLocal);
                    updateAllUI();
                    notify("All data has been reset.");
                };

                setTimeout(() => {
                    if (resetAllConfirming) {
                        resetAllConfirming = false;
                        updateAllUI();
                    }
                }, 4500);
            } else {
                resetBtn.innerText = "⚠️ Reset All Data";
                resetBtn.style.cssText = btnStyle + " background: rgba(226, 33, 52, 0.15); color: #e22134; border: 1px solid #e22134; margin-left: auto;";
                resetBtn.onclick = (e) => {
                    e.stopPropagation();
                    resetAllConfirming = true;
                    updateAllUI();
                };
            }

            jsonControls.appendChild(exportBtn);
            jsonControls.appendChild(importBtn);
            jsonControls.appendChild(resetBtn);
        }

        jsonSection.appendChild(jsonArea);
        jsonSection.appendChild(jsonControls);

        updateAllUI();

        container.appendChild(settingsSection);
        const hr0 = document.createElement("hr"); hr0.style.cssText = hrStyle; container.appendChild(hr0);
        container.appendChild(presetSection);
        const hr1 = document.createElement("hr"); hr1.style.cssText = hrStyle; container.appendChild(hr1);
        container.appendChild(trackSection);
        const hr2 = document.createElement("hr"); hr2.style.cssText = hrStyle; container.appendChild(hr2);
        container.appendChild(jsonSection);

        Spicetify.PopupModal.display({ title: "Volume Manager", content: container, isLarge: true });
    }

    const hoverMenu = document.createElement('div');
    hoverMenu.id = 'volume-manager-hover-menu';
    hoverMenu.style.cssText = `
        position: fixed;
        background: var(--spice-elevated-base);
        border: 1px solid var(--spice-button-disabled);
        border-radius: 8px;
        padding: 12px;
        z-index: 10000;
        display: none;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        min-width: 200px;
    `;
    document.body.appendChild(hoverMenu);

    function renderHoverMenu() {
        hoverMenu.innerHTML = "";
        
        const track = getCurrentTrack();
        if (track) {
            const effective = getEffectiveVolume(track);
            if (effective.vol !== -1) {
                const warningDiv = document.createElement('div');
                warningDiv.style.cssText = "background: rgba(226, 33, 52, 0.1); border: 1px solid #e22134; padding: 10px 12px; border-radius: 6px; text-align: center; margin-bottom: 5px;";
                
                const typeText = effective.type === 'album' ? 'Album Custom Volume' : 'Custom Volume';
                warningDiv.innerHTML = `<div style="color: #e22134; font-weight: bold; font-size: 0.9em; margin-bottom: 5px;">${typeText} Active (${Math.round(effective.vol * 100)}%)</div>
                                        <div style="color: var(--spice-subtext); font-size: 0.8em;">Delete to change volume</div>`;
                
                hoverMenu.appendChild(warningDiv);
            }
        }

        const presetTitle = document.createElement('div');
        presetTitle.innerText = "Presets";
        presetTitle.style.cssText = "color: var(--spice-text, #dedede); font-weight: bold; font-size: 0.9em; border-bottom: 1px solid var(--spice-button-disabled); padding-bottom: 4px;";
        hoverMenu.appendChild(presetTitle);

        if (!config.presets || config.presets.length === 0) {
            hoverMenu.innerHTML += `<div style="color: var(--spice-subtext); font-size: 0.85em;">No presets found.</div>`;
        } else {
            for (const preset of config.presets) {
                const pBtn = document.createElement('button');
                pBtn.innerText = `${preset.name} (${Math.round(preset.vol * 100)}%)`;
                pBtn.title = `Apply preset: ${preset.name}`;
                pBtn.style.cssText = "background: transparent; color: var(--spice-text, #dedede); border: 1px solid var(--spice-button); padding: 6px; border-radius: 4px; cursor: pointer; text-align: left;";
                pBtn.onmouseover = () => pBtn.style.background = "var(--spice-button-disabled)";
                pBtn.onmouseout = () => pBtn.style.background = "transparent";
                
                pBtn.onclick = () => attemptApplyPreset(preset);
                
                hoverMenu.appendChild(pBtn);
            }
        }

        const openGuiBtn = document.createElement('button');
        openGuiBtn.innerText = "⚙️ Open Full Menu";
        openGuiBtn.style.cssText = "background: var(--spice-button); color: var(--spice-text, #dedede); border: none; padding: 6px; border-radius: 4px; cursor: pointer; margin-top: 5px; font-weight: bold;";
        openGuiBtn.onclick = () => {
            hoverMenu.style.display = "none";
            openGUI();
        };
        hoverMenu.appendChild(openGuiBtn);
    }

    let hideTimeout;
    function showMenu(btnElement) {
        clearTimeout(hideTimeout);
        renderHoverMenu();
        
        const opacity = typeof config.guiOpacity !== 'undefined' ? config.guiOpacity : 0.05;
        const blurAmount = typeof config.guiBlur !== 'undefined' ? config.guiBlur : 0;
        
        const baseColorHex = getComputedStyle(document.documentElement).getPropertyValue('--spice-elevated-base').trim() || "#121212";
        let r = 18, g = 18, b = 18;
        const match = baseColorHex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
        if (match) {
            r = parseInt(match[1], 16);
            g = parseInt(match[2], 16);
            b = parseInt(match[3], 16);
        }
        
        hoverMenu.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        hoverMenu.style.backdropFilter = `blur(${blurAmount}px)`;
        hoverMenu.style.webkitBackdropFilter = `blur(${blurAmount}px)`;
        hoverMenu.style.border = "1px solid rgba(220, 220, 220, 0.08)";
        
        hoverMenu.style.display = "flex";
        
        const rect = btnElement.getBoundingClientRect();
        hoverMenu.style.bottom = (window.innerHeight - rect.top + 10) + 'px'; 
        hoverMenu.style.left = (rect.left - (hoverMenu.offsetWidth / 2) + (rect.width / 2)) + 'px';
    }

    function hideMenu() {
        hoverMenu.style.display = "none";
    }

    hoverMenu.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    hoverMenu.addEventListener('mouseleave', () => hideTimeout = setTimeout(hideMenu, 250));

    function injectButton() {
        const extraControls = document.querySelector('.main-nowPlayingBar-extraControls');
        if (!extraControls) return;

        let volBtn = document.getElementById('my-custom-vol-btn');
        if (!volBtn) {
            volBtn = document.createElement('button');
            volBtn.id = 'my-custom-vol-btn';
            
            volBtn.className = "main-genericButton-button e-10451-legacy-button e-10451-legacy-button-tertiary e-10451-overflow-wrap-anywhere e-10451-button-tertiary--icon-only-small e-10451-button-tertiary--icon-only e-10451-button-tertiary--text-subdued encore-internal-color-text-subdued";
            volBtn.setAttribute("aria-label", "Volume Manager");
            volBtn.title = "Volume Manager";
            
            volBtn.innerHTML = `
            <span aria-hidden="true" class="e-10451-button__icon-wrapper">
                <svg data-encore-id="icon" role="img" aria-hidden="true" class="e-10451-icon" viewBox="0 0 16 16" style="fill: currentColor;">
                    <path d="M3 2v4.5a1.5 1.5 0 0 0 0 3V14h2V9.5a1.5 1.5 0 0 0 0-3V2H3zm0 6a.5.5 0 1 1 2 0 .5.5 0 0 1-2 0zM11 2v1.5a1.5 1.5 0 0 0 0 3V14h2V6.5a1.5 1.5 0 0 0 0-3V2h-2zm0 3a.5.5 0 1 1 2 0 .5.5 0 0 1-2 0zM7 2v8.5a1.5 1.5 0 0 0 0 3V14h2v-.5a1.5 1.5 0 0 0 0-3V2H7zm0 10a.5.5 0 1 1 2 0 .5.5 0 0 1-2 0z"/>
                </svg>
            </span>`;

            volBtn.onclick = openGUI;
            volBtn.addEventListener('mouseenter', () => showMenu(volBtn));
            volBtn.addEventListener('mouseleave', () => hideTimeout = setTimeout(hideMenu, 250));
        }

        const svg = volBtn.querySelector('svg');
        if (svg) {
            svg.style.width = config.iconSize + "px";
            svg.style.height = config.iconSize + "px";
        }

        if (extraControls.firstChild !== volBtn) {
            extraControls.prepend(volBtn);
        }
    }

    setInterval(injectButton, 1000);

})();
