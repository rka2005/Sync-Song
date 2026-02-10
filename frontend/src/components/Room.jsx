import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { WS_URL, API_BASE_URL } from '../config';
import './Room.css';

const SearchIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
);


const Room = () => {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const playerRef = useRef(null);
    const userActionRef = useRef(false);
    const lastSeekTimeRef = useRef(0);

    // Room users
    const [users, setUsers] = useState([]);
    const [userCount, setUserCount] = useState(0);
    const [myRole, setMyRole] = useState(null);

    // --- STATE ---
    const [url, setUrl] = useState('');
    const [playing, setPlaying] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [player, setPlayer] = useState(null);
    const ignoreNextStateChange = useRef(false);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const searchContainerRef = useRef(null);

    // Close suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Debounced suggestions
    useEffect(() => {
        const trimmed = searchQuery.trim();
        if (!trimmed || trimmed.length < 1 || trimmed.startsWith('http')) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        const delayDebounceFn = setTimeout(() => {
            fetchSuggestions(trimmed);
        }, 250);

        return () => clearTimeout(delayDebounceFn);
    }, [searchQuery]);

    const fetchSuggestions = async (query) => {
        try {
            // Use the /search endpoint to get rich suggestion data (title + thumbnail)
            const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) throw new Error('Failed to fetch suggestions');
            const data = await response.json();
            const results = Array.isArray(data) ? data : [];
            // keep only top 6 suggestions
            const top = results.slice(0, 6).map(v => ({
                title: v.title,
                thumbnail: v.thumbnail,
                url: v.url,
                channel: v.channel,
                duration: v.duration
            }));
            setSuggestions(top);
            setShowSuggestions(top.length > 0);
        } catch (error) {
            console.error('Suggestions error:', error);
            setSuggestions([]);
            setShowSuggestions(false);
        }
    };

    const performSearch = async (query) => {
        setIsSearching(true);
        setShowSuggestions(false);
        try {
            const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            const results = Array.isArray(data) ? data : [];
            setSearchResults(results);
            return results;
        } catch (error) {
            console.error('Search error:', error);
            setSearchResults([]);
            return [];
        }
        setIsSearching(false);
    };

    // Search and automatically select (play) the first result
    const searchAndSelect = async (query) => {
        setIsSearching(true);
        setShowSuggestions(false);
        try {
            const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            const results = Array.isArray(data) ? data : [];
            setSearchResults(results);
            if (results.length > 0 && results[0].url) {
                selectVideo(results[0].url);
            }
            return results;
        } catch (error) {
            console.error('Search error:', error);
            setSearchResults([]);
            return [];
        } finally {
            setIsSearching(false);
        }
    };

    useEffect(() => {
        setIsReady(false);
    }, [url]);

    // --- WEBSOCKET CONNECTION ---
    const { sendMessage, lastJsonMessage, readyState } = useWebSocket(`${WS_URL}/${roomId}`, {
        shouldReconnect: (closeEvent) => true,
    });

    // --- SYNC LOGIC ---
    useEffect(() => {
        if (lastJsonMessage !== null) {
            const { type, payload } = lastJsonMessage;

            switch (type) {
                case 'ROOM_USERS': {
                    setUsers(payload.users);
                    setUserCount(payload.count);
                    break;
                }

                case 'YOU_ARE': {
                    setMyRole(payload.role);
                    break;
                }

                case 'SYNC_STATE': {
                    const { url, is_playing, started_at, seek_to, server_time } = payload;

                    if (url) setUrl(url);

                    if (player && is_playing && started_at) {
                        // Use server-calculated position for precise sync
                        let seekPosition = seek_to || 0;
                        
                        // Better network delay compensation + buffer delay
                        const bufferDelaySeconds = 0.15; // 150ms buffer for all devices
                        if (server_time) {
                            const clientReceiveTime = Date.now();
                            const networkDelay = (clientReceiveTime - server_time) / 1000;
                            // Add network delay + buffer delay to account for setTimeout
                            seekPosition += Math.min(networkDelay, 1) + bufferDelaySeconds;
                        } else {
                            seekPosition += bufferDelaySeconds;
                        }

                        ignoreNextStateChange.current = true;
                        
                        // Pause first to ensure clean state
                        player.pauseVideo();
                        
                        // Seek to position (already compensated for the upcoming delay)
                        player.seekTo(seekPosition, true);
                        
                        // Delay to allow buffering, then play
                        setTimeout(() => {
                            player.playVideo();
                            setPlaying(true);
                        }, 150);
                    } else {
                        setPlaying(false);
                    }
                    break;
                }
                case 'PLAY': {
                    if (!player) break;

                    // Use server-calculated seek position for precise sync
                    let seekPosition = payload.seek_to || 0;
                    
                    // Better network delay compensation + buffer delay
                    const bufferDelaySeconds = 0.15; // 150ms buffer for all devices
                    if (payload.server_time) {
                        const clientReceiveTime = Date.now();
                        const networkDelay = (clientReceiveTime - payload.server_time) / 1000;
                        // Add network delay + buffer delay to account for setTimeout
                        seekPosition += Math.min(networkDelay, 1) + bufferDelaySeconds;
                    } else {
                        seekPosition += bufferDelaySeconds;
                    }

                    ignoreNextStateChange.current = true;
                    
                    // Pause first to ensure clean state
                    player.pauseVideo();
                    
                    // Seek to position (already compensated for the upcoming delay)
                    player.seekTo(seekPosition, true);
                    
                    // Delay to allow buffering across all devices, then play
                    setTimeout(() => {
                        player.playVideo();
                        setPlaying(true);
                    }, 150);
                    break;
                }
                case 'PAUSE':
                    ignoreNextStateChange.current = true;
                    player.pauseVideo();
                    setPlaying(false);
                    break;
                case 'CHANGE_URL':
                    if (payload.url) {
                        setUrl(payload.url);
                        setPlaying(false);
                        setSearchResults([]);
                        setSearchQuery('');
                    }
                    break;
                case 'SEEK':
                    ignoreNextStateChange.current = true;
                    player.seekTo(payload.time, true);
                    break;
                default: break;
            }
        }
    }, [lastJsonMessage, player, sendMessage]);

    // Extract YouTube video ID from URL
    const getYouTubeId = (url) => {
        if (!url) return null;
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7].length === 11) ? match[7] : null;
    };

    const videoId = getYouTubeId(url);

    // Load YouTube IFrame API
    useEffect(() => {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }
    }, []);

    const handleSeek = () => {
        if (!player) return;

        const time = player.getCurrentTime();
        const diff = Math.abs(time - lastSeekTimeRef.current);

        if (diff > 1.2) {   // real seek
            lastSeekTimeRef.current = time;
            sendMessage(JSON.stringify({
                type: 'SEEK',
                payload: { time }
            }));
        }
    };

    // Initialize player when iframe loads
    useEffect(() => {
        if (videoId && window.YT && window.YT.Player) {
            const initPlayer = () => {

                const ytPlayer = new window.YT.Player(`youtube-player-${roomId}`, {
                    events: {
                        onReady: (event) => {
                            setPlayer(event.target);
                            setIsReady(true);
                        },
                        onStateChange: (event) => {
                            const YT_STATE = window.YT.PlayerState;

                            // USER initiated actions (mouse click / seek)
                            if (event.data === YT_STATE.PLAYING) {
                                userActionRef.current = true;
                            }

                            if (event.data === YT_STATE.PAUSED) {
                                userActionRef.current = true;
                            }

                            if (ignoreNextStateChange.current) {
                                ignoreNextStateChange.current = false;
                                userActionRef.current = false;
                                return;
                            }

                            if (event.data === YT_STATE.PLAYING && userActionRef.current) {
                                userActionRef.current = false;
                                sendMessage(JSON.stringify({ type: 'PLAY' }));
                            }

                            if (event.data === YT_STATE.PAUSED && userActionRef.current) {
                                userActionRef.current = false;
                                sendMessage(JSON.stringify({ type: 'PAUSE' }));
                            }

                            if (event.data === YT_STATE.BUFFERING && userActionRef.current) {
                                userActionRef.current = false;
                                handleSeek();
                            }
                        }
                    }
                });
            };

            if (window.YT.loaded) {
                initPlayer();
            } else {
                window.onYouTubeIframeAPIReady = initPlayer;
            }
        }
    }, [videoId, roomId]);

    // --- ACTIONS ---

    // --- SEARCH & SELECTION LOGIC ---

    const handleSearch = async (e) => {
        e.preventDefault();
        if (searchQuery.startsWith('http')) {
            selectVideo(searchQuery);
            return;
        }

        if (!searchQuery.trim()) return;

        // On Enter, search and auto-play the top result (like YouTube)
        await searchAndSelect(searchQuery);
    };

    const handleSuggestionClick = (suggestion) => {
        setSearchQuery(suggestion);
        setShowSuggestions(false);
        // When a suggestion is clicked, search and auto-play top result
        searchAndSelect(suggestion);
    };

    const selectVideo = (videoUrl) => {
        let cleanUrl = videoUrl.trim();
        try {
            const urlObj = new URL(cleanUrl);

            if (urlObj.hostname === 'youtu.be') {
                const videoId = urlObj.pathname.substring(1);
                cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
            } else if (urlObj.hostname.includes('youtube.com')) {
                urlObj.searchParams.delete('si');
                urlObj.searchParams.delete('feature');
                cleanUrl = urlObj.toString();
            }
        } catch (e) {
            // URL parsing failed, use original
        }

        // 1. Update LOCAL state immediately
        setUrl(cleanUrl);
        setPlaying(false);
        setSearchResults([]);
        setSearchQuery('');

        // 2. Send message to server
        sendMessage(JSON.stringify({
            type: 'CHANGE_URL',
            payload: { url: cleanUrl }
        }));
    };

    // --- RENDER ---

    const connectionStatus = {
        [ReadyState.CONNECTING]: 'Connecting',
        [ReadyState.OPEN]: 'Connected',
        [ReadyState.CLOSING]: 'Closing',
        [ReadyState.CLOSED]: 'Disconnected',
        [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
    }[readyState];

    if (readyState !== ReadyState.OPEN && !isReady) {
        return <div className="title">Connecting to Room...</div>;
    }

    return (
        <div className="room-container">

            {/* Header */}
            <div className="room-header">
                <div>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0, marginBottom: '5px' }}>🎵 Room: <span className="badge">{roomId}</span></h2>
                    <span style={{ fontSize: '0.8rem', color: readyState === ReadyState.OPEN ? '#00D9FF' : '#ef4444', fontWeight: '500' }}>
                        ● {connectionStatus}
                    </span>

                    <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#aaa' }}>
                        👥 {userCount} members
                    </div>

                    <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                        {['admin', 'member'].map((roleType) => {
                            if (!users.includes(roleType)) return null;
                            const isYourRole = roleType === myRole;
                            return (
                                <div key={roleType}>
                                    {roleType === 'admin' ? '👑 Admin' : '👤 Member'}
                                    {isYourRole ? ' (You)' : ''}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ padding: '10px 20px', background: 'rgba(255,59,59,0.15)', border: '1px solid rgba(255,59,59,0.3)', color: '#ff6b6b', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', transition: 'all 0.3s ease' }}>
                    Leave Room
                </button>
            </div>

            {/* Video Player */}
            <div className="player-wrapper">
                {!url ? (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100%',
                        color: '#00D9FF',
                        fontSize: '1.5rem',
                        textAlign: 'center',
                        padding: '20px'
                    }}>
                        🎵 Paste a YouTube URL below to start watching together!
                    </div>
                ) : videoId ? (
                    <iframe
                        id={`youtube-player-${roomId}`}
                        ref={playerRef}
                        src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&origin=${window.location.origin}`}
                        title="YouTube video player"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            border: 'none'
                        }}
                    />
                ) : (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100%',
                        color: '#ff6b6b',
                        fontSize: '1.2rem',
                        textAlign: 'center',
                        padding: '20px'
                    }}>
                        ❌ Invalid YouTube URL. Please paste a valid YouTube link.
                    </div>
                )}
            </div>

            {/* Search Bar */}
            <div className="search-container" ref={searchContainerRef}>
                <div style={{ position: 'relative', width: '100%' }}>
                    <form onSubmit={handleSearch} className="input-group" style={{ marginTop: 0 }}>
                        <div className="search-input-wrapper">
                            <input
                                className="search-input"
                                type="text"
                                placeholder="Search song OR paste URL..."
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    if (!e.target.value.trim()) {
                                        setSearchResults([]);
                                    }
                                }}
                                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                            />
                            <div style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', color: '#666', pointerEvents: 'none' }}>
                                <SearchIcon />
                            </div>
                        </div>
                        <button type="submit" className="btn-search" disabled={isSearching}>
                            {isSearching ? '⏳ Searching...' : 'Go'}
                        </button>
                    </form>

                    {/* Suggestions Dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: '0',
                            right: '0',
                            background: '#1a1a2e',
                            border: '1px solid rgba(0,217,255,0.3)',
                            borderTop: 'none',
                            borderRadius: '0 0 10px 10px',
                            maxHeight: '250px',
                            overflowY: 'auto',
                            zIndex: 1000,
                            boxShadow: '0 8px 25px rgba(0, 0, 0, 0.5)'
                        }}>
                            {suggestions.map((suggestion, index) => (
                                <div
                                    key={index}
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    style={{
                                        padding: '10px 15px 10px 45px',
                                        cursor: 'pointer',
                                        borderBottom: index < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                                        color: '#e0e0e0',
                                        fontSize: '0.9rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        transition: 'background 0.15s ease'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.background = 'rgba(0,217,255,0.15)';
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'transparent';
                                    }}
                                >
                                    <span style={{ color: '#666', fontSize: '0.8rem' }}>🔍</span>
                                    {suggestion}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Search Results */}
                {searchResults.length > 0 && (
                    <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                        <h3 style={{ fontSize: '0.9rem', color: '#00D9FF', marginBottom: '5px', textAlign: 'left', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            ✨ Select to play:
                        </h3>
                        {searchResults.map((video, index) => (
                            <div
                                key={index}
                                onClick={(e) => {
                                    e.preventDefault();
                                    selectVideo(video.url);
                                }}
                                style={{
                                    display: 'flex',
                                    gap: '15px',
                                    padding: '12px',
                                    background: 'rgba(79,70,229,0.08)',
                                    borderRadius: '10px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    alignItems: 'center',
                                    textAlign: 'left',
                                    border: '1px solid rgba(0,217,255,0.15)'
                                }}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.background = 'rgba(79,70,229,0.15)';
                                    e.currentTarget.style.borderColor = 'rgba(0,217,255,0.35)';
                                    e.currentTarget.style.transform = 'translateX(5px)';
                                    e.currentTarget.style.boxShadow = '0 8px 20px rgba(0, 217, 255, 0.25)';
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.background = 'rgba(79,70,229,0.08)';
                                    e.currentTarget.style.borderColor = 'rgba(0,217,255,0.15)';
                                    e.currentTarget.style.transform = 'translateX(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                            >
                                <img
                                    src={video.thumbnail}
                                    alt="thumb"
                                    style={{ width: '100px', borderRadius: '4px', aspectRatio: '16/9', objectFit: 'cover', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)', transition: 'all 0.3s ease', cursor: 'pointer' }}
                                    onMouseOver={(e) => { e.style.transform = 'scale(1.05)'; e.style.boxShadow = '0 6px 16px rgba(0, 217, 255, 0.3)'; }}
                                    onMouseOut={(e) => { e.style.transform = 'scale(1)'; e.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)'; }}
                                />
                                <div style={{ flex: 1 }}>
                                    <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#fff', marginBottom: '4px' }}>
                                        {video.title}
                                    </h4>
                                    <p style={{ fontSize: '0.8rem', color: '#aaa' }}>
                                        {video.channel} • {video.duration}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <p className="subtitle" style={{ marginTop: '30px', fontSize: '0.95rem', background: 'linear-gradient(135deg, #4F46E5, #00D9FF)', backgroundClip: 'text', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: '600' }}>
                {playing ? '▶️ Now Playing' : '⏸️ Paused'} • Synced via WebSocket
            </p>
        </div>
    );
};

export default Room;