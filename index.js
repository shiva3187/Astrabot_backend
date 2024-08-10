import express from "express";
import cors from "cors";
import path from "path";
import url, { fileURLToPath } from "url";
import dotenv from "dotenv";
import ImageKit from "imagekit";
import mongoose from "mongoose";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";

// Load environment variables from .env file
dotenv.config();

const port = process.env.PORT || 3000;
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: process.env.CLIENT_URL || "*", // Change to a specific origin in production
    credentials: true,
  })
);

app.use(express.json());

// MongoDB Connection
const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1); // Exit process if MongoDB connection fails
  }
};

mongoose.connection.on("connected", () => {
  console.log("MongoDB connected");
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
  process.exit(1); // Exit process on MongoDB connection error
});

connect();

// Ensure environment variables are loaded correctly
if (!process.env.IMAGE_KIT_ENDPOINT || !process.env.IMAGE_KIT_PUBLIC_KEY || !process.env.IMAGE_KIT_PRIVATE_KEY) {
  throw new Error('Missing ImageKit configuration');
}

const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});

app.get("/", (req, res) => {
  res.send("Hello");
});

app.get("/api/upload", (req, res) => {
  const result = imagekit.getAuthenticationParameters();
  res.send(result);
});

app.post("/api/chats", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;
  const { text } = req.body;

  try {
    // CREATE A NEW CHAT
    const newChat = new Chat({
      userId: userId,
      history: [{ role: "user", parts: [{ text }] }],
    });

    const savedChat = await newChat.save();

    // CHECK IF THE USERCHATS EXISTS AND UPDATE OR CREATE IT
    await UserChats.findOneAndUpdate(
      { userId: userId },
      {
        $push: {
          chats: {
            _id: savedChat._id,
            title: text.substring(0, 40),
          },
        },
      },
      { new: true, upsert: true } // Creates a new document if none exists
    );

    res.status(201).send(newChat._id);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating chat!");
  }
});

app.get("/api/userchats", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;

  try {
    const userChats = await UserChats.findOne({ userId });

    if (userChats) {
      res.status(200).send(userChats.chats);
    } else {
      res.status(404).send("No chats found for this user.");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching user chats!");
  }
});

app.get("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;

  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });

    if (chat) {
      res.status(200).send(chat);
    } else {
      res.status(404).send("Chat not found!");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching chat!");
  }
});

app.put("/api/chats/:id", ClerkExpressRequireAuth(), async (req, res) => {
  const userId = req.auth.userId;
  const { question, answer, img } = req.body;

  const newItems = [
    ...(question
      ? [{ role: "user", parts: [{ text: question }], ...(img && { img }) }]
      : []),
    { role: "model", parts: [{ text: answer }] },
  ];

  try {
    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      {
        $push: {
          history: {
            $each: newItems,
          },
        },
      }
    );

    res.status(200).send(updatedChat);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error adding conversation!");
  }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Internal Server Error");
});

// Serve static files for production
app.use(express.static(path.join(__dirname, "../client")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client", "index.html"));
});
