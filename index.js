require('dotenv').config()
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;

        //middleware
app.use(cors());
app.use(express.json());

        //mongo db er coder copy,paste
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.taikvqz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    const db = client.db('parcelService');
    const parcelCollection = db.collection('parcels');
    app.get('/parcels', async (req, res) => {
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

        res.status(200).json(parcels);
      } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });

                // POST route to add parcel
   app.post('/parcels', async (req, res) => {
      try {
        const parcelData = req.body;
        console.log(parcelData)
        const result = await parcelCollection.insertOne(parcelData);
        res.status(201).send(result);
      } catch (error) {
        console.error('Error saving parcel:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Send a ping to confirm a successful connection
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.get("/", (req,res)=>{
        // server e show kore
    res.send("zap shift server is running")
})

app.listen(port, ()=>{
    // cmd te show kore
    console.log("server is running on port:", port)
})
