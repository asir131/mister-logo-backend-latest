const UBlast = require('../models/UBlast');
const BLOCK_DAYS = Number(process.env.UBLAST_BLOCK_DAYS || 90);

async function releaseScheduledUblasts() {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const scheduled = await UBlast.find({
    status: 'scheduled',
    scheduledFor: { $lte: now },
  }).lean();

  if (scheduled.length === 0) return;

  for (const ublast of scheduled) {
    await UBlast.updateOne(
      { _id: ublast._id },
      {
        $set: {
          status: 'released',
          releasedAt: now,
          expiresAt,
        },
      },
    );
  }
}

async function expireUblasts() {
  const now = new Date();
  await UBlast.updateMany(
    {
      status: 'released',
      expiresAt: { $lte: now },
    },
    {
      $set: { status: 'expired' },
    },
  );
}

function startUblastJobs() {
  const intervalMs = 60 * 1000;
  setInterval(() => {
    releaseScheduledUblasts().catch((err) =>
      console.error('UBlast release job failed:', err),
    );
    expireUblasts().catch((err) =>
      console.error('UBlast expiry job failed:', err),
    );
  }, intervalMs);

  console.log(
    `UBlast jobs scheduled (block ${BLOCK_DAYS}d).`,
  );
}

module.exports = { startUblastJobs };
