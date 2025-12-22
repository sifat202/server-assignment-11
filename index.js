

const express = require('express');
require('dotenv').config();
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');

// const admin = require("./admin.json");

// const serviceAccount = require('./admin.json');
const stripe = require('stripe')(`${process.env.STRIPE_SECRET}`);
const app = express();
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const serviceAccount = require("./admin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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
        // await client.connect();

        const db = client.db("CenterDB");

        const issuesCollection = db.collection("issues");
        const usersCollection = db.collection("users");
        const paymentsCollection = db.collection("payments");
        console.log("MongoDB connected successfully. Collections ready.");


        async function verifyAdmin(req, res, next) {
            const email = req.user.email;
            const user = await usersCollection.findOne({ email });

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden access' });
            }

            next();
        }
        async function verifyStaff(req, res, next) {
            const email = req.user.email;
            const user = await usersCollection.findOne({ email });

            if (!user || user.role !== "staff") {
                return res.status(403).send({ message: 'Forbidden access: Staff only' });
            }

            next();
        }

        app.patch(
  '/admin/update-staff/:email',
  verifyFirebaseToken,
  verifyAdmin,
  async (req, res) => {
    const { email } = req.params;
    const { name, photo, phone } = req.body;

    try {
      // 🔹 Step 1: Get Firebase user by email
      const userRecord = await admin.auth().getUserByEmail(email);

      // 🔹 Step 2: Update Firebase Auth user
      await admin.auth().updateUser(userRecord.uid, {
        displayName: name,
        photoURL: photo,
      });

      // 🔹 Step 3: Update MongoDB user document
      const result = await usersCollection.updateOne(
        { email },
        {
          $set: {
            name,
            photo,
            phone,
            updatedAt: new Date(),
          },
        }
      );

      res.send({ success: true, result });
    } catch (error) {
      console.error('Update staff failed:', error);
      res.status(500).send({ message: 'Failed to update staff' });
    }
  }
);

app.delete(
  '/admin/delete-staff/:email',
  verifyFirebaseToken,
  verifyAdmin,
  async (req, res) => {
    const { email } = req.params;

    const userRecord = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(userRecord.uid);
    await usersCollection.deleteOne({ email });

    res.send({ success: true });
  }
);

        app.post('/create-checkout-session', verifyFirebaseToken, async (req, res) => {
            const { price, purpose } = req.body; // purpose: 'premium' or 'boost'

            try {
                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    mode: 'payment',
                    line_items: [
                        {
                            price_data: {
                                currency: 'bdt',
                                product_data: { name: purpose === 'boost' ? 'Issue Boost' : 'Premium Membership' },
                                unit_amount: price * 100,
                            },
                            quantity: 1,
                        },
                    ],
                    success_url: 'http://localhost:5173/dashboard/payment-success',
                    cancel_url: 'http://localhost:5173/dashboard/payment-cancel',
                    customer_email: req.user.email,
                });

                // Record the payment as "pending" immediately
                await paymentsCollection.insertOne({
                    userEmail: req.user.email,
                    amount: price,
                    purpose: purpose || 'premium',
                    status: 'pending',
                    createdAt: new Date(),
                });

                res.send({ url: session.url });
            } catch (error) {
                console.error("Error creating checkout session:", error);
                res.status(500).send({ message: 'Failed to create checkout session' });
            }
        });




        app.patch('/users/premium/:email', verifyFirebaseToken, async (req, res) => {
            const email = req.params.email;
            const result = await usersCollection.updateOne(
                { email: email },
                { $set: { userStatus: 'premium' } }
            );
            res.send(result);
        });
        app.post('/admin/create-staff', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const { name, email, password, photo,phone } = req.body;

            const firebaseUser = await admin.auth().createUser({
                email,
                password,
                
                displayName: name,
                photoURL: photo,
                phone:phone
            });

            const staffUser = {
                name,
                email,
                photo,
                phone,
                role: 'staff',
                userStatus: 'active',
                createdAt: new Date()
            };

            const result = await usersCollection.insertOne(staffUser);

            res.send({ success: true, result });
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
        app.patch('/issues/status/:id', verifyFirebaseToken, verifyStaff, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;

            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );

            res.send(result);
        });
        app.get('/my-issues/:email', async (req, res) => {
            const { email } = req.params;
            const result = await issuesCollection
                .find({ reporterEmail: email })
                .toArray();
            res.send(result);
        });
        app.patch('/issues/:id', verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;
            const updateData = req.body;

            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        ...updateData,
                        updatedAt: new Date()
                    }
                }
            );

            res.send(result);
        });


        app.delete('/issues/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await issuesCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).send({ message: 'Issue not found' });
                }
                res.send({ success: true, message: `Issue ${id} deleted` });
            } catch (error) {
                res.send({ message: 'Failed to delete issue' });
            }
        });
        app.get('/issues/:id', verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;

            const issue = await issuesCollection.findOne({
                _id: new ObjectId(id)
            });

            res.send(issue);
        });

        app.patch('/issues/reject/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: 'rejected' } }
            );
            res.send(result);
        });


        app.patch('/assign/:staffEmail/:problemId', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            const { staffEmail, problemId } = req.params;

            try {
                const result = await issuesCollection.updateOne(
                    { _id: new ObjectId(problemId) },
                    {
                        $set: {
                            assigned_to: staffEmail,
                            status: 'assigned'
                        }
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: 'Issue not found' });
                }

                res.send({ success: true, message: `Staff ${staffEmail} assigned to issue ${problemId}` });
            } catch (error) {
                console.error("Error assigning staff:", error);
                res.status(500).send({ message: 'Failed to assign staff to the issue.' });
            }
        });
        app.patch('/issues/upvote/:id', async (req, res) => {
            const { id } = req.params;

            try {
                const result = await issuesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $inc: { upvotes: 1 } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: 'Issue not found' });
                }

                res.send({ success: true, message: 'Upvoted successfully' });
            } catch (error) {
                console.error("Error upvoting issue:", error);
                res.status(500).send({ message: 'Failed to upvote the issue' });
            }
        });


        app.get('/secret', verifyFirebaseToken, (req, res) => {
            res.send({
                message: "You accessed a secret route!",
                userEmail: req.user.email
            });
        });
        app.get('/issues', async (req, res) => {
            try {
                const issues = await issuesCollection.find().toArray();
                res.send(issues);
            } catch (error) {
                console.error("Error fetching issues:", error);
                res.status(500).send({ message: 'Failed to fetch issues.' });
            }
        });
        app.get('/staff', verifyFirebaseToken, async (req, res) => {

            const query = { role: 'staff' }
            try {
                const staff = await usersCollection.find(query).toArray();
                res.send(staff);
            } catch (error) {
                console.error("Error fetching staff:", error);
                res.status(500).send({ message: 'Failed to fetch staff.' });
            }
        });
        app.patch('/issues/promote/:id', verifyFirebaseToken, async (req, res) => {
            const { id } = req.params;

            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

            if (!issue) {
                return res.status(404).send({ message: 'Issue not found' });
            }

            if (issue.isPromoted === true) {
                return res.send({ message: 'Already promoted' });
            }

            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { isPromoted: true },
                    $inc: { priority: 1 } // ✅ THIS ADDS +1 TO EXISTING NUMBER
                }
            );

            res.send({ success: true });
        });
        app.get('/payments', verifyFirebaseToken, verifyAdmin, async (req, res) => {
            try {
                const payments = await paymentsCollection.find().sort({ createdAt: -1 }).toArray();
                res.send(payments);
            } catch (error) {
                console.error("Error fetching payments:", error);
                res.status(500).send({ message: 'Failed to fetch payments' });
            }
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
app.get('/', (req, res) => {
    res.send('PIIRS Server is running!');
});
app.listen(port, () => {
    console.log(`PIIRS Server listening on port ${port}`);
});

// process.on('SIGINT', async () => {
//     console.log('Server shutting down...');
//     await client.close();
//     console.log('MongoDB connection closed.');
//     process.exit(0);
// });

