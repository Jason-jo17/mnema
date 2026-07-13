/**
 * Google Drive sync worker (Phase 10).
 *
 * Consumes drive-sync jobs (manual "Sync now", push webhook, reconcile cron) and
 * runs syncLink() for the link — pulling Drive→Mnema and/or pushing Mnema→Drive
 * per the link's direction. Idempotent; safe to re-run.
 */
import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { config } from '../../config/env.js';
import { db } from '../../db/index.js';
import { driveFolderLinks } from '../../db/schema.js';
import { syncLink } from '../../lib/drive-sync.js';
import { DRIVE_SYNC_QUEUE_NAME, type DriveSyncJobData } from '../../queue/drive-sync.js';

export function startDriveSyncWorker(): Worker<DriveSyncJobData> {
  // Dedicated connection for the worker (separate from queue connection).
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker<DriveSyncJobData>(
    DRIVE_SYNC_QUEUE_NAME,
    async (job) => {
      const rows = await db.select().from(driveFolderLinks)
        .where(eq(driveFolderLinks.id, job.data.linkId)).limit(1);
      const link = rows[0];
      if (!link) return;
      const res = await syncLink(link);
      // eslint-disable-next-line no-console
      console.log(`[drive-sync] ${job.data.linkId} reason=${job.data.reason}`, res);
    },
    { connection, concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[drive-sync] ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? '?'}):`, err.message);
  });
  worker.on('error', (err) => { console.error('[drive-sync] worker error:', err); });

  return worker;
}
