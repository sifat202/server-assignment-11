require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

const serviceAccount = require('./admin.json');

const app = express();
const port = process.env.PORT || 3000;

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.use(cors({
    origin: ['http://localhost:5173'],
    credentials: true,
}));

app.use(express.json());


async function verifyFirebaseToken(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'Unauthorized Access: Invalid token header.' });
    }

    const token = authorization.split(' ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);

        req.user = decodedToken;
        next();

    } catch (error) {
        console.error("Firebase ID Token verification failed:", error);
        res.status(401).send({ message: 'Unauthorized Access: Invalid Firebase ID Token.' });
    }
}


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
        await client.connect();

        const db = client.db("CenterDB");

        const issuesCollection = db.collection("issues");
        const usersCollection = db.collection("users");

        console.log("MongoDB connected successfully. Collections ready.");

        app.get('/', (req, res) => {
            res.send('PIIRS Server is running!');
        });

        app.post('/users', async (req, res) => {
            const userdata = req.body

            const { email } = userdata;

            const query = { email: email }

            const test = await usersCollection.findOne(query)

            if (test) {
                return res.status(201).send({ message: 'Your data won`t be re-uploaded' })
            }


            const result = await usersCollection.insertOne(userdata);

            res.status(201).send(result);
        });

        app.get('/getusers', verifyFirebaseToken, async (req, res) => {
            const result = await usersCollection.find().toArray()
            res.send(result)
        });
        app.get('/getuser/:email', async (req, res) => {
            const { email } = req.params;
            const query = { email: email };
            const result = await usersCollection.findOne(query);
            res.send(result);
        });
        app.patch('/countposts/:email', async (req, res) => {
            const { email } = req.params;
            const query = { email: email };

            const updateDoc = {
                $inc: {
                    postsmade: 1
                },
            };

            try {
                const result = await usersCollection.updateOne(query, updateDoc);

                

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Error updating post count", error });
            }
        });

        app.get('/secret', verifyFirebaseToken, (req, res) => {
            res.send({
                message: "You accessed a secret route!",
                userEmail: req.user.email
            });
        });

        app.post('/issues', verifyFirebaseToken, async (req, res) => {
            const issueData = req.body;

            if (!issueData.reporterEmail || !issueData.title || !issueData.description || !issueData.issueType) {
                return res.status(400).send({ message: 'Missing required report fields: reporterEmail, title, description, and issueType are required.' });
            }

            const finalIssueData = {
                ...issueData,
                // Ensure status and priority are standardized on the server side
                status: issueData.status || 'pending',
                priority: issueData.priority || 'normal',
                createdAt: new Date(issueData.createdAt) || new Date(),
                updatedAt: new Date(),
            };

            try {
                const result = await issuesCollection.insertOne(finalIssueData);
                res.status(201).send(result);
            } catch (error) {
                console.error("MongoDB insertion error:", error);
                res.status(500).send({ message: 'Failed to save issue to database.' });
            }
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