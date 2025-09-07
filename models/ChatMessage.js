const { v4: uuidv4 } = require("uuid");

class ChatMessage {
  constructor({
    text,
    messageType = "text",
    originType = "USER",
    uuid = uuidv4(),
    readCount = 0,
    deliveryCount = 0,
    erroredCount = 0,
    replyMessageId = null,
    replyMessage = null,
    senderUser,
    messageTime = Date.now(),
    messageMetadata = {},
  }) {
    this.message = {
      text,
      messageType,
    };
    this.messageOriginType = originType;
    this.id = uuid; // ✅ system ID, not wamid
    this.readCount = readCount;
    this.deliveryCount = deliveryCount;
    this.erroredCount = erroredCount;
    this.dateCreated = new Date().toISOString();
    this.dateUpdated = new Date().toISOString();
    this.replyMessageId = replyMessageId;
    this.messageTime = messageTime;
    this.totalCount = 1;
    this.errorMessage = null;
    this.adReferralData = null;
    this.replyMessage = replyMessage;
    this.senderUser = senderUser;
    this.messageMetadata = messageMetadata;
  }

  // 🔹 Factory: Transform WhatsApp Webhook → Internal Model
  static async fromWhatsAppMessage(msg, contactProfile, redisService,originType) {
    // ✅ Generate system UUID
    const systemId = uuidv4();

    // ✅ Store mapping wamid → uuid
    await redisService.cacheMessageMapping(msg.id, systemId);

    let replyMessageId = null;
    let replyMessage = null;

    if (msg.context?.id) {
      // ✅ Lookup systemId for the wamid
      const mappedId = await redisService.getSystemIdFromWamid(msg.context.id);
      replyMessageId = mappedId || msg.context.id;

      // ✅ Try to load full previous message
      if (mappedId) {
        replyMessage = await redisService.getMessage(mappedId);
      }

      // ✅ Try to load full previous message
      let prevMsg = null;
      if (mappedId) {
        prevMsg = await redisService.getMessage(mappedId);
      }

      // ✅ Build replyMessage from previous one (if found)
      replyMessage = {
        id: replyMessageId,
        messageOriginType: prevMsg?.messageOriginType || "CUSTOMER",
        message: prevMsg?.message || {
          text:  null,
          messageType: "text",
        },
        senderUser: {
          id: prevMsg?.senderUser?.id || null,
          name: prevMsg?.senderUser?.name || null,
          phoneNumber: prevMsg?.senderUser?.phoneNumber || msg.context.from,
        },
        messageTime: prevMsg?.messageTime || null,
      };
    }

    const newMessage = new ChatMessage({
      text: msg.text?.body,
      messageType: msg.type,
      originType: originType,
      uuid: systemId,
      replyMessageId,
      replyMessage,
      senderUser: {
        id: null,
        name: contactProfile?.name || null,
        phoneNumber: msg.from,
      },
      messageTime: Number(msg.timestamp) * 1000,
    });

    // ✅ Cache the new message too
    await redisService.cacheMessage(newMessage.id, newMessage);

    return newMessage;
  }
}

module.exports = ChatMessage;
