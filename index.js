require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

                // firebase admin key for jwt
var serviceAccount = require("firebase-adminSdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


//mongo db er coder copy,paste
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.taikvqz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
            // firebase jwt middleware
const verifyFbToken = async(req,res,next) =>{
  console.log("headers in middleware",req.headers.authorization);
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ error: 'Unauthorized: No token' });
  }
   const token = authHeader.split(' ')[1];
     try {
      const decodedUser = await admin.auth().verifyIdToken(token);
      req.decoded = decodedUser;
      console.log(req.decoded)
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      return res.status(403).send({ error: 'Forbidden: Invalid token' });
    }
}
const verifyEmail = (req,res,next) =>{
  if(req.decoded.email != req.query.email){
      return res.status(403).send({ error: 'Access denied' });
    }
  next();
}

async function run() {
  try {
    const db = client.db("parcelService");
    const usersCollection = db.collection("users");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");

    app.post("/users", async(req,res)=>{
      const email = req.body.email;
      const userExists = await usersCollection.findOne({email});
      if(userExists){
              //update last login time
        const updateResult = await usersCollection.updateOne(
            {email: email},
            {$set: {last_log_In: new Date().toISOString()}},
            {upsert:true})
        return res.status(200).send({ message: 'User already exists' });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result)
    })

    app.get("/parcels", async (req, res) => {
      try {
        
        const { email } = req.query;
        const filter = {};
        // If email is provided, filter by created_by field
        if (email) {
          filter.created_by = email;
        }
        const parcels = await parcelCollection
          .find(filter)
          .sort({ createdAt: -1 }) // Newest first
          .toArray();
        res.status(200).send(parcels);
      } catch (err) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // POST route to add parcel
    app.post("/parcels", async (req, res) => {
      try {
        const parcelData = req.body;
        console.log(parcelData);
        const result = await parcelCollection.insertOne(parcelData);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error saving parcel:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Check for valid MongoDB ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: "Invalid parcel ID" });
        }

        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).json({ error: "Parcel not found" });
        }

        res.json(parcel);
      } catch (error) {
        console.error("Error fetching parcel by ID:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });
    // DELETE a parcel by ID
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await parcelCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });
    app.post("/tracking", async (req, res) => {
      try {
        const { trackingId, parcelId, status, location } = req.body;
        const update = {
          trackingId,
          parcelId,
          status,
          location,
          timestamp: new Date(),
        };

        const result = await db.collection("tracking").insertOne(update);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to insert tracking update", error });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, amount, created_by, payment_method, transaction_id } =
          req.body;
        console.log(req.body);
        const paidAtTime = new Date();
        // 1. Update parcel: mark as paid and set paidAtTime
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              payment_status: "paid",
              paidAtTime,
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(404)
            .json({ error: "Parcel not found or already paid" });
        }

        // 2. Insert into payment history
        const paymentDoc = {
          parcelId: new ObjectId(parcelId),
          amount,
          created_by,
          payment_method,
          transaction_id,
          paidAtTimeString: paidAtTime.toISOString(),
          paidAtTime, // store the same value for consistency
        };
        const result = await paymentCollection.insertOne(paymentDoc);
        res.status(200).send({
          message: "Payment recorded, parcel updated",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Payment processing error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });
    app.get("/payments", verifyFbToken, verifyEmail, async (req, res) => {
      // console.log(req.headers.authorization)
      try {
        const { email } = req.query;
        const filter = email ? { created_by: email } : {};
        const payments = await paymentCollection
          .find(filter)
          .sort({ paidAtTime: -1 })
          .toArray();
        res.json(payments);
      } catch (error) {
        console.error("Error fetching payment history:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      const { amountInCents, parcelI } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents, // Amount in cents
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  // server e show kore
  res.send("zap shift server is running");
});

app.listen(port, () => {
  // cmd te show kore
  console.log("server is running on port:", port);
});
