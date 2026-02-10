from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from database import get_room_state, update_room_state
from connection_manager import ConnectionManager
from youtubesearchpython import VideosSearch 
import time
import requests
import json

app = FastAPI()
manager = ConnectionManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],    
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"status": "ok", "message": "Sync-Song API is running"}

@app.post("/room/{room_id}/create")
async def create_room(room_id: str):
    if room_id in manager.rooms:
        return {"error": "Room already exists"}
    # Create the room state
    await get_room_state(room_id)
    return {"success": True}

@app.get("/room/{room_id}/exists")
async def room_exists(room_id: str):
    from database import room_states
    # Check if room has been created
    if room_id in room_states:
        return {"exists": True}
    return {"exists": False}

@app.get("/search")
async def search_youtube(q: str = Query(..., min_length=1)):
    try:
        videos_search = VideosSearch(q, limit=10)
        results = videos_search.result()
        formatted_results = []
        if results and 'result' in results:
            for video in results['result']:
                formatted_results.append({
                    'title': video['title'],
                    'duration': video.get('duration'),
                    'thumbnail': video['thumbnails'][0]['url'],
                    'url': video['link'],
                    'channel': video['channel']['name']
                })
        return formatted_results
    except Exception:
        return []

@app.get("/suggestions")
async def get_suggestions(q: str = Query(..., min_length=1)):
    try:
        # YouTube autocomplete API
        url = f"https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q={q}"
        headers = {"User-Agent": "Mozilla/5.0"}
        response = requests.get(url, headers=headers, params={"client": "firefox"})
        if response.status_code == 200:
            data = response.json()
            # data[1] contains the suggestion strings
            suggestions = data[1] if len(data) > 1 else []
            return suggestions[:8]
        return []
    except Exception as e:
        print(f"Suggestions error: {e}")
        return []

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    from database import room_states
    if room_id not in room_states:
        await websocket.close()
        return
    await manager.connect(websocket, room_id)
    role = manager.get_user_role(websocket, room_id)

    await websocket.send_json({
        "type": "YOU_ARE",
        "payload": {
            "role": role
        }
    })

    users, count = manager.get_room_users(room_id)

    await manager.broadcast({
        "type": "ROOM_USERS",
        "payload": {
            "users": users,
            "count": count
        }
    }, room_id)

    state = await get_room_state(room_id)

    if state["is_playing"] and not state["started_at"]:
        state["started_at"] = int(time.time() * 1000)

    # Calculate exact seek position for new joiner
    current_time = int(time.time() * 1000)
    if state["is_playing"] and state["started_at"]:
        seek_to_seconds = (current_time - state["started_at"]) / 1000.0
        state["seek_to"] = seek_to_seconds
        state["server_time"] = current_time

    await websocket.send_json({
        "type": "SYNC_STATE",
        "payload": state
    })

    try:
        while True:
            data = await websocket.receive_json()
            action = data["type"]
            payload = data.get("payload", {})

            now = int(time.time() * 1000)

            if action == "PLAY":
                room = await get_room_state(room_id)

                if not room["url"]:
                    continue

                if room["paused_at"]:
                    elapsed = room["paused_at"] - room["started_at"]
                    started_at = now - elapsed
                else:
                    started_at = now

                await update_room_state(room_id, {
                    "is_playing": True,
                    "started_at": started_at,
                    "paused_at": None
                })

                # Calculate exact seek position on server side for precise sync
                seek_to_seconds = (now - started_at) / 1000.0

                await manager.broadcast({
                    "type": "PLAY",
                    "payload": {
                        "started_at": started_at,
                        "seek_to": seek_to_seconds,
                        "server_time": now
                    }
                }, room_id)

            elif action == "PAUSE":
                await update_room_state(room_id, {
                    "is_playing": False,
                    "paused_at": now
                })

                await manager.broadcast({
                    "type": "PAUSE",
                    "payload": {"paused_at": now}
                }, room_id)

            elif action == "CHANGE_URL":
                await update_room_state(room_id, {
                    "url": payload["url"],
                    "is_playing": True,
                    "started_at": now,
                    "paused_at": None
                })

                await manager.broadcast({
                    "type": "CHANGE_URL",
                    "payload": {
                        "url": payload["url"],
                        "started_at": now
                    }
                }, room_id)

            elif action == "SEEK":
                await update_room_state(room_id, {
                    "started_at": now - int(payload["time"] * 1000)
                })

                await manager.broadcast({
                    "type": "SEEK",
                    "payload": {"time": payload["time"]}
                }, room_id)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)

        users, count = manager.get_room_users(room_id)

        await manager.broadcast({
            "type": "ROOM_USERS",
            "payload": {
                "users": users,
                "count": count
            }
        }, room_id)
