
import OpenAI from "openai";
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(process.cwd(), "..", ".env") });

async function testStream() {
  console.log("=== Qwen 流式调用测试 ===");
  console.log("环境变量:");
  console.log("API Key:", process.env.QWEN_API_KEY ? "****" + process.env.QWEN_API_KEY.slice(-4) : "未设置");
  console.log("Base URL:", process.env.QWEN_BASE_URL);
  console.log("Model:", process.env.QWEN_MODEL);
  console.log("");

  const client = new OpenAI({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: process.env.QWEN_BASE_URL,
  });

  const startTime = Date.now();
  let firstChunkTime = null;
  let chunkCount = 0;
  let totalChars = 0;

  console.log("开始调用...");
  try {
    const stream = await client.chat.completions.create({
      model: process.env.QWEN_MODEL || "qwen3.6-flash",
      messages: [
        { role: "system", content: "你是一个友好的助手。" },
        { role: "user", content: "请用100字左右介绍一下人工智能。" },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      stream: true,
      extra_body: { enable_thinking: false },
    });

    console.log("Stream 对象获取成功，开始迭代...");
    console.log("");

    for await (const chunk of stream) {
      if (firstChunkTime === null) {
        firstChunkTime = Date.now();
        console.log(`\n✓ 首块到达时间: ${(firstChunkTime - startTime) / 1000}s`);
        console.log("\n输出内容:");
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        process.stdout.write(delta);
        chunkCount++;
        totalChars += delta.length;
      }
    }

    const endTime = Date.now();
    console.log("\n\n=== 统计信息 ===");
    console.log(`总耗时: ${(endTime - startTime) / 1000}s`);
    console.log(`首块延迟: ${(firstChunkTime - startTime) / 1000}s`);
    console.log(`块数: ${chunkCount}`);
    console.log(`总字符数: ${totalChars}`);
    console.log(`平均每个块字符数: ${(totalChars / chunkCount).toFixed(2)}`);
    console.log(`吞吐量: ${(totalChars / ((endTime - startTime) / 1000)).toFixed(2)} 字符/秒`);
    console.log("");
    console.log("✓ 测试完成！");

  } catch (error) {
    console.error("\n✗ 错误:");
    console.error(error);
  }
}

testStream();
