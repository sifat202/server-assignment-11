require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000; 
app.use(cors({
    origin: ['http://localhost:5173'], // IMPORTANT: Change this to your client's production URL later
    credentials: true,
}));

app.use(express.json());


const uri = process.env.DATABASE_URL; 

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        
        
        const db = client.db("CenterDB"); 
        
        const issuesCollection = db.collection("issues");
        const usersCollection = db.collection("users");
        
        console.log("MongoDB connected successfully. Collections ready.");
        
    
        app.get('/', (req, res) => {
            res.send('PIIRS Server is running!');
        });
        
    
    } catch (err) {
        console.error("Failed to connect to MongoDB or run server logic:", err);
    }
}
run();

app.listen(port, () => {
    console.log(`PIIRS Server listening on port ${port}`);
});
process.on('SIGINT', async () => {
    console.log('Server shutting down...');
    await client.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
});