const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize Supabase. 
// Note: If this backend is just an API wrapper, you might use the Service Role key here to bypass RLS, 
// but it is safer to pass the user's JWT token from the frontend to act on their behalf.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ==========================================
// 1. Start or Find a Chat Room
// ==========================================
app.post('/api/chat/start', async (req, res) => {
    const { userA_id, userB_id } = req.body;

    try {
        // Step A: Check if a room already exists between these two users.
        // We look for a room where both users are participants.
        const { data: existingRooms, error: searchError } = await supabase
            .from('participants')
            .select('room_id')
            .in('user_id', [userA_id, userB_id]);

        // Logic to find a room_id that appears exactly twice in our search
        // (meaning both userA and userB are in it)
        const roomCounts = {};
        let sharedRoomId = null;
        
        if (existingRooms) {
            existingRooms.forEach(p => {
                roomCounts[p.room_id] = (roomCounts[p.room_id] || 0) + 1;
                if (roomCounts[p.room_id] === 2) sharedRoomId = p.room_id;
            });
        }

        if (sharedRoomId) {
            return res.status(200).json({ room_id: sharedRoomId, message: "Existing room found" });
        }

        // Step B: If no room exists, create a new one
        const { data: newRoom, error: roomError } = await supabase
            .from('rooms')
            .insert([{}])
            .select('id')
            .single();

        if (roomError) throw roomError;

        // Step C: Add both users to the new room
        const { error: participantError } = await supabase
            .from('participants')
            .insert([
                { room_id: newRoom.id, user_id: userA_id },
                { room_id: newRoom.id, user_id: userB_id }
            ]);

        if (participantError) throw participantError;

        res.status(201).json({ room_id: newRoom.id, message: "New room created" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. Send a Message
// ==========================================
app.post('/api/chat/message', async (req, res) => {
    const { room_id, sender_id, content } = req.body;

    // Step A: Insert the message into the database.
    // (If Realtime is enabled, Supabase will instantly broadcast this to the frontend)
    const { data: message, error } = await supabase
        .from('messages')
        .insert([{ room_id, user_id: sender_id, content }])
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({ success: true, message });
});

// ==========================================
// 3. Fetch Chat History
// ==========================================
app.get('/api/chat/:room_id/history', async (req, res) => {
    const { room_id } = req.params;

    // Step A: Fetch all messages for the room, ordered by time
    const { data: messages, error } = await supabase
        .from('messages')
        .select('id, user_id, content, created_at')
        .eq('room_id', room_id)
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({ messages });
});

// Start the server for your Render deployment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Chat API running on port ${PORT}`);
});