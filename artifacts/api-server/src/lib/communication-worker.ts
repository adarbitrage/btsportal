import { Worker } from "bullmq";
import { CommunicationService } from "./communication-service";
import { createRedisConnection } from "./redis";

let emailWorker: Worker | null = null;
let smsWorker: Worker | null = null;

export function startCommunicationWorkers(): void {
  const connection = createRedisConnection();

  emailWorker = new Worker("email", async (job) => {
    const { to, subject, html, text, fromEmail, fromName, category, userId, templateSlug, includeUnsubscribe } = job.data;
    const result = await CommunicationService.sendEmailDirect({
      to,
      subject,
      html,
      text,
      fromEmail,
      fromName,
      category,
      userId,
      templateSlug,
      includeUnsubscribe,
    });

    if (!result.success && result.error && !result.error.includes("not configured")) {
      throw new Error(result.error);
    }
  }, {
    connection,
    concurrency: 5,
  });

  emailWorker.on("failed", (job, err) => {
    console.error(`[Worker] Email job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  });

  emailWorker.on("completed", (job) => {
    console.log(`[Worker] Email job ${job.id} completed`);
  });

  smsWorker = new Worker("sms", async (job) => {
    const { to, body, userId, templateSlug } = job.data;
    const result = await CommunicationService.sendSmsDirect({
      to,
      body,
      userId,
      templateSlug,
    });

    if (!result.success && result.error && !result.error.includes("not configured") && !result.error.includes("not opted in")) {
      throw new Error(result.error);
    }
  }, {
    connection,
    concurrency: 3,
  });

  smsWorker.on("failed", (job, err) => {
    console.error(`[Worker] SMS job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  });

  smsWorker.on("completed", (job) => {
    console.log(`[Worker] SMS job ${job.id} completed`);
  });

  console.log("[Worker] Communication workers started (email + sms)");
}

export function stopCommunicationWorkers(): Promise<void[]> {
  const promises: Promise<void>[] = [];
  if (emailWorker) promises.push(emailWorker.close());
  if (smsWorker) promises.push(smsWorker.close());
  return Promise.all(promises);
}
