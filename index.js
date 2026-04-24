const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase with service role for backend operations
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ==========================================
// 1. GET ALL USERS (NEW ENDPOINT)
// ==========================================
app.get('/api/users', async (req, res) => {
    try {
        const { search } = req.query;
        
        let query = supabase
            .from('profiles')
            .select('id, username, created_at')
            .order('username', { ascending: true });
        
        if (search) {
            query = query.ilike('username', `%${search}%`);
        }
        
        const { data: users, error } = await query;
        
        if (error) throw error;
        
        res.status(200).json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. START OR FIND CHAT ROOM
// ==========================================
app.post('/api/chat/start', async (req, res) => {
    const { userA_id, userB_id } = req.body;

    if (!userA_id || !userB_id) {
        return res.status(400).json({ error: 'Both user IDs are required' });
    }

    try {
        // Find existing room
        const { data: existingRooms, error: searchError } = await supabase
            .from('participants')
            .select('room_id')
            .in('user_id', [userA_id, userB_id]);

        if (searchError) throw searchError;

        // Find room with both users
        const roomCounts = {};
        let sharedRoomId = null;
        
        if (existingRooms) {
            existingRooms.forEach(p => {
                roomCounts[p.room_id] = (roomCounts[p.room_id] || 0) + 1;
                if (roomCounts[p.room_id] === 2) sharedRoomId = p.room_id;
            });
        }

        if (sharedRoomId) {
            return res.status(200).json({ 
                room_id: sharedRoomId, 
                message: "Existing room found",
                is_new: false
            });
        }

        // Create new room
        const { data: newRoom, error: roomError } = await supabase
            .from('rooms')
            .insert([{}])
            .select('id')
            .single();

        if (roomError) throw roomError;

        // Add participants
        const { error: participantError } = await supabase
            .from('participants')
            .insert([
                { room_id: newRoom.id, user_id: userA_id },
                { room_id: newRoom.id, user_id: userB_id }
            ]);

        if (participantError) throw participantError;

        res.status(201).json({ 
            room_id: newRoom.id, 
            message: "New room created",
            is_new: true
        });

    } catch (error) {
        console.error('Error starting chat:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 3. SEND MESSAGE
// ==========================================
app.post('/api/chat/message', async (req, res) => {
    const { room_id, sender_id, content } = req.body;

    if (!room_id || !sender_id || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Verify sender is participant of the room
        const { data: participant, error: participantError } = await supabase
            .from('participants')
            .select('id')
            .eq('room_id', room_id)
            .eq('user_id', sender_id)
            .single();

        if (participantError || !participant) {
            return res.status(403).json({ error: 'Not a participant of this room' });
        }

        // Insert message
        const { data: message, error } = await supabase
            .from('messages')
            .insert([{ 
                room_id, 
                user_id: sender_id, 
                content: content.trim() 
            }])
            .select('id, room_id, user_id, content, created_at')
            .single();

        if (error) throw error;

        res.status(201).json({ 
            success: true, 
            message 
        });

    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 4. GET CHAT HISTORY
// ==========================================
app.get('/api/chat/:room_id/history', async (req, res) => {
    const { room_id } = req.params;
    const { limit = 50, before } = req.query;

    try {
        let query = supabase
            .from('messages')
            .select('id, user_id, content, created_at')
            .eq('room_id', room_id)
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        // For pagination
        if (before) {
            query = query.lt('created_at', before);
        }

        const { data: messages, error } = await query;

        if (error) throw error;

        // Reverse to get chronological order
        const orderedMessages = messages ? messages.reverse() : [];

        res.status(200).json({ 
            messages: orderedMessages,
            has_more: messages ? messages.length === parseInt(limit) : false
        });

    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 5. GET USER'S CHAT ROOMS
// ==========================================
app.get('/api/chat/rooms/:user_id', async (req, res) => {
    const { user_id } = req.params;

    try {
        const { data: rooms, error } = await supabase
            .from('participants')
            .select(`
                room_id,
                rooms!inner(id, created_at),
                user_id
            `)
            .eq('user_id', user_id);

        if (error) throw error;

        // Get other participants for each room
        const roomDetails = await Promise.all(
            rooms.map(async (room) => {
                const { data: participants } = await supabase
                    .from('participants')
                    .select('user_id, profiles!inner(username)')
                    .eq('room_id', room.room_id)
                    .neq('user_id', user_id);

                return {
                    room_id: room.room_id,
                    other_user: participants ? participants[0]?.profiles?.username : 'Unknown',
                    created_at: room.rooms.created_at
                };
            })
        );

        res.status(200).json({ rooms: roomDetails });

    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✨ Chat API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
});