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
var serviceAccount = require("./firebase-adminSdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
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

async function run() {
  try {
    const db = client.db("parcelService");
    const ridersCollection = db.collection("riders");
    const usersCollection = db.collection("users");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const trackingsCollection = db.collection("trackings");

    // firebase jwt middleware
    const verifyFbToken = async (req, res, next) => {
      // console.log("headers in middleware", req.headers.authorization);
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ error: "Unauthorized: No token" });
      }
      const token = authHeader.split(" ")[1];
      try {
        const decodedUser = await admin.auth().verifyIdToken(token);
        req.decoded = decodedUser;
        // console.log(req.decoded);
        next();
      } catch (error) {
        console.error("Token verification failed:", error);
        return res.status(403).send({ error: "Forbidden: Invalid token" });
      }
    };
    const verifyEmail = (req, res, next) => {
      if (req.decoded.email != req.query.email) {
        return res.status(403).send({ error: "Access denied" });
      }
      next();
    };
    const verifyRider = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "rider") {
        return res.status(403).send({ message: "forbidden access, You are not Rider Rolled" });
      }
      next();
    };
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access. Not Admin Rolled" });
      }
      next();
    };

    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        //update last login time
        const updateResult = await usersCollection.updateOne(
          { email: email },
          { $set: { last_log_In: new Date().toISOString() } },
          { upsert: true }
        );
        return res.status(200).send({ message: "User already exists" });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    // 🔍 Search users by partial email (case-insensitive)
    app.get("/users/search", verifyFbToken, verifyAdmin, async (req, res) => {
      const { email } = req.query;
      if (!email) return res.status(400).send({ error: "Email required" });
      const users = await usersCollection
        .find({ email: { $regex: email, $options: "i" } }) // i = case-insensitive
        .project({ email: 1, role: 1, createdAt: 1, lastLogin: 1 }) // only return needed fields
        .limit(10) // optional: limit for autocomplete
        .toArray();
      res.send(users);
    });
    // GET /api/users/role/:email
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res
            .status(404)
            .send({ message: "User not found", role: null });
        }
        return res.status(200).send({ role: user.role });
      } catch (error) {
        console.error("Role check failed:", error);
        return res.status(500).json({ message: "Server error", role: null });
      }
    });
    app.patch("/users/role/:id",verifyFbToken,verifyAdmin,async (req, res) => {
        try {
          const { id } = req.params;
          const { role } = req.body;
          if (!role) {
            return res.status(400).json({ message: "New role is required" });
          }
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role } }
          );
          if (result.modifiedCount > 0) {
            return res
              .status(200)
              .json({ message: `User role updated to ${role}` });
          } else {
            return res
              .status(404)
              .json({ message: "User not found or role unchanged" });
          }
        } catch (error) {
          console.error("❌ Failed to update user role:", error);
          return res.status(500).json({ message: "Internal server error" });
        }
      }
    );
    app.get("/parcels", verifyFbToken, async (req, res) => {
      try {
        const { email, payment_status, delivery_status } = req.query;
        const filter = {};

        // If email is provided, filter by created_by field
        if (email) {
          filter.created_by = email;
        }
        if (payment_status) {
          filter.payment_status = payment_status;
        }
        if (delivery_status) {
          filter.delivery_status = delivery_status;
        }
        // console.log("parcel query:", req.query);
        // console.log("query:", filter);
        const parcels = await parcelCollection
          .find(filter)
          .sort({ createdAt: -1 }) // Newest first
          .toArray();
        res.status(200).send(parcels);
      } catch (err) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });
    app.get("/parcels/pending-deliveries",verifyFbToken,verifyRider, async (req, res) => {
      try {
        const { riderEmail } = req.query;
        if (!riderEmail) {
          return res.status(400).json({ message: "riderEmail is required" });
        }
        const pendingDeliveries = await parcelCollection
          .find({
            riderEmail,
            delivery_status: { $in: ["riders-assigned", "in-transit"] },
          })
          .sort({ creation_date: 1 }) // oldest first
          .toArray();
        res.status(200).send(pendingDeliveries);
      } catch (error) {
        console.error("Error fetching pending deliveries:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });
    app.get('/parcels/completed-deliveries',verifyFbToken,verifyRider, async (req, res) => {
      try {
        const { riderEmail } = req.query;
        if (!riderEmail) {
          return res.status(400).json({ message: "riderEmail is required" });
        }
        const deliveredParcels = await parcelCollection
          .find({
            riderEmail: riderEmail,
            delivery_status: { $in: ["delivered", "delivered_service_center"] }
          })
          .toArray();
        res.status(200).json(deliveredParcels);
      } catch (error) {
        console.error("Error fetching delivered parcels:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });
    // POST route to add parcel
    app.post("/parcels", async (req, res) => {
      try {
        const parcelData = req.body;
        // console.log(parcelData);
        const result = await parcelCollection.insertOne(parcelData);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error saving parcel:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
    app.patch("/parcels/assign", async (req, res) => {
      try {
        const { parcelId, riderId, riderName, riderPhone, riderEmail } =
          req.body;
        // console.log(req.body);
        if (!parcelId || !riderId) {
          return res
            .status(400)
            .json({ message: "parcelId and riderId are required" });
        }
        // Update parcel: delivery_status → in-transit
        const parcelUpdate = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              delivery_status: "riders-assigned",
              assignedRiderId: riderId, // optional for future tracking
              riderName,
              riderPhone,
              riderEmail,
            },
          }
        );
        // Update rider: status → in-delivery
        const riderUpdate = await ridersCollection.updateOne(
          { _id: new ObjectId(riderId) },
          { $set: { status: "in-delivery" } }
        );

        if (parcelUpdate.modifiedCount > 0 && riderUpdate.modifiedCount > 0) {
          return res
            .status(200)
            .send({ message: "Rider assigned successfully" });
        } else {
          return res.status(400).send({ message: "Assignment failed" });
        }
      } catch (error) {
        console.error("Error assigning rider:", error);
        return res.status(500).json({ message: "Internal server error" });
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
    // PATCH /api/parcels/:id/delivery-status
    app.patch("/parcels/:id/delivery-status", async (req, res) => {
      const parcelId = req.params.id;
      const { newStatus } = req.body;
      const updateDoc = {
          delivery_status: newStatus 
        }
     
        if(newStatus === "in-transit"){
          updateDoc.pickedAt = new Date().toISOString(); 
        }
        if(newStatus === "delivered"){
          updateDoc.deliveredAt = new Date().toISOString();
        }
      
      if (!newStatus) {
        return res.status(400).json({ message: "newStatus is required" });
      }
      const result = await parcelCollection
        .updateOne(
          { _id: new ObjectId(parcelId) },
          { $set: updateDoc}
        );
      if (result.modifiedCount > 0) {
        res
          .status(200)
          .json({ message: `Delivery status updated to "${newStatus}"` });
      } else {
        res
          .status(404)
          .json({ message: "Parcel not found or already updated" });
      }
    });
    // PATCH /parcels/cashout/:id
    app.patch('/parcels/cashout/:id', async (req, res) => {
      const parcelId = req.params.id;
      try {
        const result = await db.collection('parcels').updateOne(
          { _id: new ObjectId(parcelId), cashout: { $ne: true } }, // ✅ Allow only if not already cashed
          {
            $set: {
              cashout: true,
              cashoutTime: new Date() // optional: save timestamp
            }
          }
        );

        if (result.modifiedCount > 0) {
          return res.status(200).json({ message: 'Parcel cashed out successfully' });
        } else {
          return res.status(400).json({ message: 'Already cashed out or not found' });
        }
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
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
    // POST tracking
    app.post('/trackings', async (req, res) => {
      try {
        const { trackingId, status, details,updated_by } = req.body;

        if (!trackingId || !status || !details ||!updated_by) {
          return res.status(400).json({ message: "All fields are required" });
        }
        const newEvent = {
          trackingId, status, details,updated_by,
          timestamp: new Date(),
        };
        const result = await trackingsCollection.insertOne(newEvent);
        res.status(201).json({ message: 'Tracking event recorded', insertedId: result.insertedId });
      } catch (error) {
        console.error('Error adding tracking event:', error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.get('/tracking/:parcelId', async (req, res) => {
      try {
        const parcelId = req.params.parcelId;

        const events = await trackingsCollection
          .find({ parcelId: new ObjectId(parcelId) })
          .sort({ createdAt: 1 })
          .toArray();

        res.status(200).json(events);
      } catch (error) {
        console.error('Error fetching tracking events:', error);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.post("/riders", async (req, res) => {
      const ridersData = req.body;
      const result = await ridersCollection.insertOne(ridersData);
      res.send(result);
    });
    // GET /api/riders/match
    app.get("/riders/match", async (req, res) => {
      try {
        const { senderDistrict, receiverDistrict } = req.query;
        if (!senderDistrict || !receiverDistrict) {
          return res.status(400).json({ message: "Missing district params" });
        }
        const matchedRiders = await ridersCollection
          .find({
            status: "approved",
            district: { $in: [senderDistrict, receiverDistrict] },
          })
          .toArray();
        res.status(200).json(matchedRiders);
      } catch (error) {
        console.error("Failed to fetch riders:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    app.get("/riders/pending", verifyFbToken, verifyAdmin, async (req, res) => {
      try {
        const pendingRiders = await ridersCollection
          .find({ status: "pending" })
          .toArray();
        res.send(pendingRiders);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch pending riders", error });
      }
    });
    // GET /api/riders?status=approved
    app.get("/riders/approved",verifyFbToken,verifyAdmin,async (req, res) => {
        const { status } = req.query;
        try {
          const query = status ? { status } : {};
          const riders = await ridersCollection.find(query).toArray();
          res.send(riders);
        } catch (err) {
          console.error("Failed to fetch riders:", err);
          res.status(500).send({ error: "Internal Server Error" });
        }
      }
    );
    // Approve or cancel rider
    app.patch("/riders/status/:id", async (req, res) => {
      const { id } = req.params;
      const { status, email } = req.body;
      const result = await ridersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      //update user role = "rider" whose status is "approved"
      if (status === "approved") {
        const userQuery = { email };
        const updateDoc = {
          $set: {
            role: "rider",
          },
        };
        const updateUsersRole = await usersCollection.updateOne(
          userQuery,
          updateDoc
        );
        // console.log(updateUsersRole.modifiedCount);
      }
      res.send(result);
    });

    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, amount, created_by, payment_method, transaction_id } =
          req.body;
        // console.log(req.body);
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
