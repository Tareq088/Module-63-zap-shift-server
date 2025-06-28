require('dotenv').config()
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb');
const app = express();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);
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
    const paymentCollection = db.collection('payments')
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
        res.status(200).send(parcels);
      } catch (err) {
        res.status(500).send({ error: 'Internal Server Error' });
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
   app.get('/parcels/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // Check for valid MongoDB ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid parcel ID' });
    }

    const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });

    if (!parcel) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    res.json(parcel);
  } catch (error) {
    console.error('Error fetching parcel by ID:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
   });
    // DELETE a parcel by ID
  app.delete('/parcels/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);

    } catch (error) {
      console.error('Error deleting parcel:', error);
      res.status(500).send({ message: 'Internal server error' });
    }
  }); 
  app.post('/payments', async (req, res) => {
  try {
    const { parcelId, amount, created_by, payment_method, transaction_id } = req.body;
    console.log(req.body)
    const paidAtTime = new Date();
    // 1. Update parcel: mark as paid and set paidAtTime
    const updateResult = await parcelCollection.updateOne(
      { _id: new ObjectId(parcelId) },
      {
        $set: {
          payment_status: 'paid',
          paidAtTime,
        }
      }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(404).json({ error: 'Parcel not found or already paid' });
    }

    // 2. Insert into payment history
    const paymentDoc = {
      parcelId: new ObjectId(parcelId),
      amount,
      created_by,
      payment_method,
      transaction_id,
      paidAtTimeString:paidAtTime.toISOString(),
      paidAtTime, // store the same value for consistency
    };
    const result = await paymentCollection.insertOne(paymentDoc);
    res.status(200).send({
      message: 'Payment recorded, parcel updated',
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
  });
  app.get('/payments', async (req, res) => {
  try {
    const { email } = req.query;

    const filter = email ? { created_by: email } : {};
    const payments = await paymentCollection
      .find(filter)
      .sort({ paidAtTime: -1 })
      .toArray();
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
  });



  app.post('/create-payment-intent', async (req, res) => {
            
    const {amountInCents,parcelI} = req.body;
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents, // Amount in cents
        currency: 'usd',
        payment_method_types: ['card'],
      });

      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
      res.status(500).json({ error: error.message });
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
