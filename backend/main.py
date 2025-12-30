from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from database import get_room_state, update_room_state
from connection_manager import ConnectionManager
from youtubesearchpython import VideosSearch 
import time

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

@app.get("/search")
async def search_youtube(q: str = Query(..., min_length=1)):
    try:
        videos_search = VideosSearch(q, limit=5)
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

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await manager.connect(websocket, room_id)

    state = await get_room_state(room_id)

    if state["is_playing"] and not state["started_at"]:
        state["started_at"] = int(time.time() * 1000)

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

                await manager.broadcast({
                    "type": "PLAY",
                    "payload": {"started_at": started_at}
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