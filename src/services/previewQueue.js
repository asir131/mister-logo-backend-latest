let queue = [];
let isRunning = false;

async function runNext() {
  if (isRunning) return;
  const next = queue.shift();
  if (!next) return;
  isRunning = true;
  try {
    await next();
  } catch (err) {
    console.error('Preview queue task failed:', err?.message || err);
  } finally {
    isRunning = false;
    if (queue.length) {
      setImmediate(runNext);
    }
  }
}

function enqueuePreviewTask(task, { priority = false } = {}) {
  if (typeof task !== 'function') return;
  if (priority) queue.unshift(task);
  else queue.push(task);
  setImmediate(runNext);
}

module.exports = {
  enqueuePreviewTask,
};
