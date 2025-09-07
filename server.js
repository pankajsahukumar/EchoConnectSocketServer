const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Kafka } = require("kafkajs");
const ChatMessage = require("./models/ChatMessage");
const RedisService = require("./services/RedisService");

// ---------------------------
// SERVICES SETUP
// ---------------------------
const redisService = new RedisService("redis://:foobaredtest@localhost:6379");

// ✅ Kafka producer setup
const kafka = new Kafka({
  clientId: "webhook-service",
  brokers: [process.env.KAFKA_BROKER || "localhost:9094"], // external listener
});

const producer = kafka.producer();

async function connectKafka() {
  try {
    await producer.connect();
    console.log("✅ Kafka producer connected");
  } catch (err) {
    console.error("❌ Error connecting Kafka producer:", err);
  }
}
connectKafka();

const app = express();
app.use(bodyParser.json());

// ✅ Store active WebSocket connections
const clients = new Map(); // Map<WebSocket, string (userId)>
const userSockets = new Map(); // Map<string (userId), WebSocket>

// 🔹 Facebook credentials
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || "my_verify_token";
const PAGE_ACCESS_TOKEN =
  process.env.FB_PAGE_ACCESS_TOKEN || "<YOUR_PAGE_ACCESS_TOKEN>";

// ---------------------------
// FACEBOOK WEBHOOK ENDPOINTS
// ---------------------------

// Verify webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  console.log("mode:", mode, "token:", token, "challenge:", challenge);
  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Facebook webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 🔹 Webhook receiver
app.post("/webhook", (req, res) => {
  const body = req.body;
  res.status(200).send("EVENT_RECEIVED");

  (async () => {
    try {
      await producer.send({
        topic: "WebhookMessage4",
        messages: [{ key: "testing", value: JSON.stringify(body) }],
      });
      if (body.object === "whatsapp_business_account") {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            const value = change.value;
            const messages = value.messages || [];
            await producer.send({
              topic: "WebhookMessage2",
              messages: [{ key: entry.id, value: JSON.stringify(messages) }],
            });
            await producer.send({
              topic: "WebhookMessage3",
              messages: [{ key: entry.id, value: JSON.stringify(body) }],
            });
            for (const msg of messages) {
              if (msg.type === "text") {
                const transformed = await ChatMessage.fromWhatsAppMessage(
                  msg,
                  value.contacts?.[0]?.profile,
                  redisService,
                  "CUSTOMER"
                );
              
                // ✅ Cache full system message by systemId
                await redisService.cacheMessage(transformed.id, transformed);
              
                // ✅ Send to Kafka
                await producer.send({
                  topic: "WebhookMessage",
                  messages: [{ key: entry.id, value: JSON.stringify(transformed) }],
                });
                sendToUser("cfaad35d-07a3-4447-a6c3-d8c3d54fd5df", "chatMessage", transformed);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("❌ Webhook processing error:", err);
    }
  })();
});

// ---------------------------
// SEND MESSAGE TO FACEBOOK
// ---------------------------
async function sendMessageToFB(psid, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: psid },
        message: { text },
      }
    );
    console.log(`✅ Sent message to FB user ${psid}: ${text}`);
  } catch (error) {
    console.error(
      "❌ Error sending to FB:",
      error.response?.data || error.message
    );
  }
}
function sendToUser(userId, type, payload) {
  const ws = userSockets.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

// ---------------------------
// WEBSOCKET SERVER
// ---------------------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("🌐 WebSocket client connected");

  ws.on("message", (msg) => {
    try {
      const { type, payload } = JSON.parse(msg);
      console.log(type,payload,"this is info");

      switch (type) {
        case "register":
          const { userId } = payload;
          clients.set(ws, userId);
          userSockets.set(userId, ws);
          console.log(`✅ Website user ${userId} registered`);
          ws.send(JSON.stringify({ type: "registered", payload: { userId } }));
          break;

        case "chatMessage":
          const { senderId, receiverId, content } = payload;
          console.log(`💬 ${senderId} → ${receiverId}: ${content}`);

          if (receiverId.startsWith("fb:")) {
            // Send to Facebook Messenger user
            const fbUserId = receiverId.replace("fb:", "");
            sendMessageToFB(fbUserId, content);
          } else {
            // Send to website user
            const receiverSocket = userSockets.get(receiverId);
            if (receiverSocket && receiverSocket.readyState === WebSocket.OPEN) {
              receiverSocket.send(
                JSON.stringify({
                  type: "chatMessage",
                  payload: {
                    senderId,
                    receiverId,
                    content,
                    timestamp: Date.now(),
                  },
                })
              );
            }
          }
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              payload: { message: "Unknown message type." },
            })
          );
      }
    } catch (err) {
      console.error("❌ Error handling WS message:", err);
    }
  });

  ws.on("close", () => {
    const userId = clients.get(ws);
    if (userId) {
      clients.delete(ws);
      userSockets.delete(userId);
      console.log(`⚡ Website user ${userId} disconnected`);
    }
  });
});

// ---------------------------
// START SERVER
// ---------------------------
const PORT = process.env.PORT || 8081;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 WebSocket: ws://localhost:${PORT}`);
  console.log(`📩 Facebook Webhook: http://localhost:${PORT}/webhook`);
});
