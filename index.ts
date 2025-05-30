import 'dotenv/config';
import express, { Express, Request, Response } from "express";
import { MongoClient } from "mongodb";
import { callAgent } from './agent';
import cors from 'cors';


const app: Express = express();
app.use(express.json());
app.use(cors());

// Initialize MongoDB client
const client = new MongoClient(process.env.ATLAS_CONNECTION_STRING as string);
  const db = client.db("users");
  const usersCollection = db.collection<UserDocument>('info'); // if your collection is named 'info'

  interface ResponseEntry {
    currentQuestion: string;
    response: string;
    timestamp: Date;
  }
  
  interface UserDocument {
    username: string;
    password: string;
    responses?: ResponseEntry[]; // now optional
  }
  
  
  
async function startServer() {
  try {

    await client.connect();
    await client.db("users").command({ ping: 1 });



    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    // Set up basic Express route
    app.get('/', (req: Request, res: Response) => {
      res.send('LangGraph Agent Server');
    });
    app.post('/create-account', async (req, res) => {
      console.log('/create-account has been called!');
      const {username, password} = req.body;
    
      console.log("Username:", username);
      console.log("Password:", password);
    
    try{ 
    
      await client.connect();
    
      const result = await usersCollection.insertOne({ username, password });
    
      console.log("Insert Result:", result);
    
    
    } catch (error) {
      console.log(`Error occured while fetching MongoDB: ${error}`);
      res.status(500).json({ error: "Internal Server Error" });
    } 
    
    
    });
  
  app.get('/accounts', async (req, res) =>{
  
      try{ 
       console.log('/accounts has been called!');
     
       await client.connect();
     
       const users = await usersCollection.find({}).toArray();
       res.status(200).json(users);
       } catch (error) {
         console.log(`There was an error fetching accounts:`, error);
       }
     
     })
  
  app.get('/chat-history', async (req, res) => {
  
    console.log('/chat-history route has been called!');
  
    const { username } = req.query;
  
    console.log(username)
  
    if (!username) {
      return res.status(400).json({ error: "Username is required." });
    }
  
    try {
  
      const user = await usersCollection.findOne({ username });
  
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }
  
      // If there's no responses array yet, return an empty one
      const history = user.responses || [];
  
      res.json({ history });
    } catch (error) {
      console.error("Error fetching chat history:", error);
      res.status(500).json({ error: "Something went wrong." });
    }
  });

    // API endpoint to start a new conversation
    app.post('/chat', async (req: Request, res: Response) => {
      console.log('/chat has been called')

      const {username} = req.body;
    
      console.log("Username:", username);

      const initialMessage = req.body.message;

      console.log(initialMessage)

      const threadId = Date.now().toString(); // Simple thread ID generation
      try {
        const response = await callAgent(client, initialMessage, threadId);
        res.json({ threadId, response });
     
        
              // Save response to MongoDB
    await usersCollection.updateOne(
      { username }, // find user
      {
        $push: {
          responses: {
            currentQuestion: initialMessage,
            response: response,
            timestamp: new Date(),
          },
        },
      }
    );
     
      } catch (error) {
        console.error('Error starting conversation:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // API endpoint to send a message in an existing conversation
    app.post('/chat/:threadId', async (req: Request, res: Response) => {
      const { threadId } = req.params;
      const { message } = req.body;
      try {
        const response = await callAgent(client, message, threadId);
        res.json({ response });
      } catch (error) {
        console.error('Error in chat:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
 

 
 
 
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  }



}

startServer();
