const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 1. GET all posts (ordered by newest first)
app.get('/posts', async (req, res) => {
    const { data, error } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) return res.status(400).json(error);
    res.json(data);
});

// 2. POST a new post
app.post('/posts', async (req, res) => {
    const { username, content } = req.body;
    const { data, error } = await supabase
        .from('posts')
        .insert([{ username, content }]);

    if (error) return res.status(400).json(error);
    res.status(201).json({ message: "Post created!", data });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on http://localhost:${PORT}`));