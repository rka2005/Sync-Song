import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config.js';
import '../App.css';

const Lobby = () => {
    const [roomCode, setRoomCode] = useState('');
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);
    const navigate = useNavigate();

    const createRoom = async () => {
        const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        setIsCreatingRoom(true);
        try {
            const response = await fetch(`${API_BASE_URL}/room/${newCode}/create`, {
                method: 'POST'
            });
            const data = await response.json();
            if (data.success) {
                navigate(`/room/${newCode}`);
            } else {
                setIsCreatingRoom(false);
                alert('Error creating room. Please try again.');
            }
        } catch (error) {
            setIsCreatingRoom(false);
            alert('Error creating room. Please try again.');
        }
    };

    const joinRoom = async (e) => {
        e.preventDefault();
        if (roomCode.trim()) {
            try {
                const response = await fetch(`${API_BASE_URL}/room/${roomCode.toUpperCase()}/exists`);
                const data = await response.json();
                if (data.exists) {
                    navigate(`/room/${roomCode.toUpperCase()}`);
                } else {
                    alert('Room does not exist. Please check the code and try again.');
                }
            } catch (error) {
                alert('Error checking room. Please try again.');
            }
        }
    };

    return (
        <div className="landing-container">
            {/* Loading Overlay */}
            {isCreatingRoom && (
                <div className="loading-overlay">
                    <div className="loading-content">
                        <div className="loading-spinner">
                            <div className="spinner-ring"></div>
                            <div className="spinner-ring"></div>
                            <div className="spinner-ring"></div>
                        </div>
                        <h2 className="loading-title">Creating Your Room</h2>
                        <p className="loading-subtitle">Please wait a moment...</p>
                    </div>
                </div>
            )}
            
            {/* Animated Background Blobs */}
            <div className="blob blob-1"></div>
            <div className="blob blob-2"></div>

            <div className="content-wrapper">

                {/* Left Side: Hero Text */}
                <div className="hero-text">
                    <div className="equalizer">
                        <div className="bar"></div>
                        <div className="bar"></div>
                        <div className="bar"></div>
                        <div className="bar"></div>
                        <div className="bar"></div>
                    </div>

                    <h1 className="hero-title">
                        Listen <br />
                        Together.
                    </h1>
                    <p className="hero-subtitle">
                        Experience music and video in perfect synchronization with friends,
                        no matter where they are. Create a room, share the code, and vibe.
                    </p>
                </div>

                {/* Right Side: Interactive Card */}
                <div className="join-card">
                    <div className="card-header">Start the Party</div>

                    <button onClick={createRoom} className="cta-button btn-gradient">
                        ⚡ Create New Room
                    </button>

                    <div className="divider">
                        <span>OR</span>
                    </div>

                    <form onSubmit={joinRoom}>
                        <input
                            type="text"
                            className="input-code"
                            placeholder="ENTER CODE"
                            value={roomCode}
                            onChange={(e) => setRoomCode(e.target.value)}
                            maxLength={6}
                        />
                        <button type="submit" className="cta-button btn-outline">
                            Join Existing
                        </button>
                    </form>
                </div>

            </div>
        </div>
    );
};

export default Lobby;