// services/RedisService.js
const Redis = require("ioredis");

class RedisService {
  constructor(url) {
    this.redis = new Redis(url);
  }

  async cacheMessageMapping(wamid, uuid) {
    try {
      await this.redis.set(`map:${wamid}`, uuid, "EX", 60 * 60 * 24); // 1 day TTL
    } catch (err) {
      console.error("❌ Redis cacheMessageMapping error:", err);
    }
  }

  async getSystemIdFromWamid(wamid) {
    try {
      return await this.redis.get(`map:${wamid}`);
    } catch (err) {
      console.error("❌ Redis getSystemIdFromWamid error:", err);
      return null;
    }
  }

  async cacheMessage(uuid, message) {
    try {
      await this.redis.set(`msg:${uuid}`, JSON.stringify(message), "EX", 60 * 60 * 24);
    } catch (err) {
      console.error("❌ Redis cacheMessage error:", err);
    }
  }

  async getMessage(uuid) {
    try {
      const data = await this.redis.get(`msg:${uuid}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error("❌ Redis getMessage error:", err);
      return null;
    }
  }
}

module.exports = RedisService;
