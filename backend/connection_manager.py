from fastapi import WebSocket
from typing import Dict, List

class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Dict] = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()

        if room_id not in self.rooms:
            # First user becomes admin
            self.rooms[room_id] = {
                "admin": websocket,
                "members": []
            }
        else:
            self.rooms[room_id]["members"].append(websocket)

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id not in self.rooms:
            return

        room = self.rooms[room_id]

        # If admin leaves
        if room["admin"] == websocket:
            if room["members"]:
                # Promote first member to admin
                room["admin"] = room["members"].pop(0)
            else:
                # No one left → delete room
                del self.rooms[room_id]
                return
        else:
            if websocket in room["members"]:
                room["members"].remove(websocket)

    def get_room_users(self, room_id: str):
        if room_id not in self.rooms:
            return [], 0

        room = self.rooms[room_id]
        users = ["admin"] + ["member"] * len(room["members"])
        return users, len(users)

    def get_user_role(self, websocket: WebSocket, room_id: str):
        room = self.rooms.get(room_id)
        if not room:
            return None
        if room["admin"] == websocket:
            return "admin"
        return "member"

    async def broadcast(self, message: dict, room_id: str, exclude: WebSocket = None):
        if room_id not in self.rooms:
            return

        room = self.rooms[room_id]
        sockets = [room["admin"]] + room["members"]

        for ws in sockets:
            if ws == exclude:
                continue
            try:
                await ws.send_json(message)
            except:
                pass
