const express = require('express');
const app = express()
require("dotenv").config();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_SK);
const port = process.env.PORT || 5001;



//middleware
app.use(cors({
    origin: ['http://localhost:5174', 'http://localhost:5173']
}))
app.use(express.json());







const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.klmlttn.mongodb.net/?retryWrites=true&w=majority`;

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
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        const usersCollection = client.db("bistroDB").collection("users");
        const menuCollection = client.db("bistroDB").collection("menu");
        const reviewsCollection = client.db("bistroDB").collection("reviews");
        const cartCollection = client.db("bistroDB").collection("cart");
        const paymentsCollection = client.db("bistroDB").collection("payments");

        //jwt token generating.
        app.post('/api/v1/jwt', async (req, res) => {
            const user = req.body;
            const token = await jwt.sign(user, process.env.SECRET_ACCESS_TOKEN, { expiresIn: '10d' });
            res.send({ token })
        })

        //middleware
        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'Forbidden Access.' });
            };
            const token = req.headers.authorization.split(' ')[1];

            jwt.verify(token, process.env.SECRET_ACCESS_TOKEN, (err, decoded) => {
                if (err) return res.status(401).send({ message: 'Forbidden Access.' });
                req.decoded = decoded;
                next();
            });
        };




        //use verify admin after verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin'
            if (!isAdmin) return res.status(403).send({ message: 'Forbidden Access.' });
            next()

        }


        //user related api
        app.get('/api/v1/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        })

        app.get('/api/v1/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'UnAuthorized Access.' });
            };
            const query = { email: email };
            const user = await usersCollection.findOne(query);

            let admin = false
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin })
        })

        app.post('/api/v1/users', async (req, res) => {
            const user = req.body;
            //insert user if email doesn't exist in my db.
            //I can do this it many way (1. unique email, 2. upsert, 3.simple checking.)
            const query = { email: user.email };
            const isExist = await usersCollection.findOne(query);
            if (isExist) return res.send({ message: 'User Already exist.', insertedId: null })
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        app.patch('/api/v1/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await usersCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })


        app.delete('/api/v1/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        })






        //menu related apis
        app.get('/api/v1/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        });

        app.delete('/api/v1/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result)
        })
        app.post('/api/v1/menu', verifyToken, verifyAdmin, async (req, res) => {
            const menu = req.body;
            const result = await menuCollection.insertOne(menu);
            res.send(result);
        });
        app.get('/api/v1/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(query);
            res.send(result);

        })

        app.patch('/api/v1/menu/:id', async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    name: item.name,
                    image: item.image,
                    price: item.price,
                    category: item.category,
                    recipe: item.recipe,

                }
            }
            const result = await menuCollection.updateOne(filter, updatedDoc);
            res.send(result);

        })


        app.get('/api/v1/reviews', async (req, res) => {
            const result = await reviewsCollection.find().toArray();
            res.send(result);
        })

        //carts collection
        app.post('/api/v1/carts', async (req, res) => {
            const cart = req.body;
            const result = await cartCollection.insertOne(cart);
            res.send(result);
        })
        app.get('/api/v1/carts', async (req, res) => {
            const userEmail = req.query?.email;
            let query = {}
            if (userEmail) {
                query.email = userEmail
            }
            const result = await cartCollection.find(query).toArray();
            res.send(result)

        })
        app.delete('/api/v1/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        })




        //payment intent.
        app.post('/api/v1/create-payment-intent', async (req, res) => {
            try {
                const { price } = req.body;
                const amount = parseInt(price * 100);
                const paymentIntent = await stripe.paymentIntents.create({
                    amount,
                    currency: 'usd',
                    payment_method_types: ['card'],
                });
                res.send({
                    clientSecret: paymentIntent.client_secret,
                })
            } catch (error) {
                console.log('error catched', error.message)
            }
        })

        // app.get('/api/v1/payments', async (req, res) => {
        //     try {
        //         const result = await paymentsCollection.find().toArray();
        //         res.send(result);
        //     } catch (error) {
        //         console.log(error.message)
        //     }
        // })

        app.get('/api/v1/payments/:email', verifyToken, async (req, res) => {
            try {
                const query = { email: req.params.email }
                if (req.params.email !== req.decoded.email) {
                    return res.status(403).send({ message: 'UnAuthorized Access.' });
                };
                const result = await paymentsCollection.find(query).toArray();
                res.send(result);
            } catch (error) {
                console.log(error.message)
            }
        })
        //
        app.post('/api/v1/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentsCollection.insertOne(payment);
            //carefully delete each item from  the cart.
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }

            const deleteResult = await cartCollection.deleteMany(query)
            res.send({ paymentResult, deleteResult })
        })


        //admin stats
        app.get('/api/v1/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await usersCollection.estimatedDocumentCount();
            const menuItems = await menuCollection.estimatedDocumentCount();
            const orders = await paymentsCollection.estimatedDocumentCount()

            // //this is not the best way.
            // const payments = await paymentsCollection.find().toArray();
            // const revenues = payments.reduce((total, payment) => total + payment.price, 0)
            // const revenue = parseFloat(revenues.toFixed(2))

            const payments = await paymentsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray()

            const revenue = payments.length > 0 ? payments[0].totalRevenue : 0;
            res.send({
                users,
                menuItems,
                orders,
                revenue
            });
        })


        //using aggregate pipeline
        app.get('/api/v1/order-stats', async (req, res) => {
            const result = await paymentsCollection.aggregate([

                {
                    $addFields: {
                        menuItemsObjectIds: {
                            $map: {
                                input: "$menuItemIds",
                                as: "itemId",
                                in: { $toObjectId: "$$itemId" },
                            },
                        },
                    },
                },
                {
                    $lookup: {
                        from: "menu",
                        localField: "menuItemsObjectIds",
                        foreignField: "_id",
                        as: "menuItemsData",
                    },
                },
                {
                    $unwind: '$menuItemsData'
                },
                {
                    $group: {
                        _id: '$menuItemsData.category',
                        quantity: { $sum: 1 },
                        total: { $sum: '$menuItemsData.price' }
                    }
                },
                {
                    $project: {
                        category: '$_id',
                        quantity: 1,
                        revenue: { $round: ['$total', 2] },
                        _id: 0
                    }
                }
            ]).toArray();
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);







app.get('/', async (req, res) => {
    res.send('Boss is running successfully.')
})

app.listen(port, () => {
    console.log(`server runnig on PORT: ${port}`)
})


/**
 * -----------------------
 *   Naming Convention
 * -----------------------
 * app.get('/users')
 * app.post('/users)
 * app.delete('/users/:id')
 * app.put('/users/:id')
 * app.patch('/users/:id')
 * 
 * 
 * 
 */