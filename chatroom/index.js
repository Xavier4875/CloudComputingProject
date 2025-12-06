require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');
const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// DynamoDB client
const db = new DynamoDBClient({
  region: "us-east-2", 
});

// Helper function to save messages
async function saveMessage(username, message) {
  const item = {
    messageID: { S: crypto.randomUUID() },
    timestamp: { N: Date.now().toString() },
    username: { S: username },
    message: { S: message },
  };

  const command = new PutItemCommand({
    TableName: "ChatMessages",
    Item: item,
  });

  try {
    await db.send(command);
    console.log(`Saved message: ${username}: ${message}`);
  } catch (err) {
    console.error("Error saving message to DynamoDB:", err);
  }
}

// Socket.IO connection
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // Store username in socket.data
  socket.on("set username", (username) => {
    socket.data.username = username || "Anonymous";
    console.log(`Username set: ${socket.data.username} (${socket.id})`);
  });

  // Handle chat messages
  socket.on("chat message", async (data) => {
    const username = data.username || "Anonymous";
    const message = data.message;

    // Broadcast user message
    io.emit("chat message", { username, message });

    // Save user message
    await saveMessage(username, message);

    // Handle bot
    const trimmed = message.trim();
    if (trimmed.startsWith("@bot")) {
      const prompt = trimmed.replace(/@bot/i, "").trim();

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
        });

        const aiReply = response.choices[0].message.content;

        // Broadcast bot reply
        io.emit("chat message", {
          username: "🤖 Bot",
          message: aiReply,
        });

        // Save bot reply
        await saveMessage("🤖 Bot", aiReply);

      } catch (err) {
        console.error("OpenAI error:", err.message);

        const errorMessage = "Sorry, I'm having trouble responding right now.";

        io.emit("chat message", {
          username: "🤖 Bot",
          message: errorMessage,
        });

        await saveMessage("🤖 Bot", errorMessage);
      }
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.data.username || "Unknown"} (${socket.id})`);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});


