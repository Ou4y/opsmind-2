function normalizeTaskCreatedAt(task) {
  const rawValue = task?.created_at || task?.createdAt || null;
  const timestamp = rawValue ? new Date(rawValue).getTime() : 0;

  if (Number.isNaN(timestamp)) {
    return 0;
  }

  return timestamp;
}

function createTaskPoller({ client, taskRunner, getIdentity, config, logger }) {
  let timerId = null;
  let inProgress = false;

  async function pollPendingTasks() {
    if (inProgress) {
      return;
    }

    inProgress = true;

    try {
      const identity = getIdentity();
      if (!identity?.deviceId) {
        logger.warn("Skipping task polling because no device identity is loaded.");
        return;
      }

      if (taskRunner.isProcessingTask()) {
        return;
      }

      const pendingTasks = await client.getPendingTasksForDevice(identity.deviceId);
      if (!Array.isArray(pendingTasks) || pendingTasks.length === 0) {
        return;
      }

      const sorted = [...pendingTasks].sort((left, right) => normalizeTaskCreatedAt(left) - normalizeTaskCreatedAt(right));
      const nextTask = sorted[0];

      logger.info("Pending tasks found.", {
        deviceId: identity.deviceId,
        pendingCount: sorted.length,
        nextTaskId: nextTask?.id || null,
      });

      if (nextTask?.id) {
        await taskRunner.processTask(nextTask);
      }
    } catch (error) {
      logger.error("Task polling failed. Will retry on next interval.", {
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message,
      });
    } finally {
      inProgress = false;
    }
  }

  function start() {
    if (timerId) {
      return;
    }

    pollPendingTasks().catch((error) => {
      logger.error("Initial task poll tick failed.", { message: error?.message || String(error) });
    });

    timerId = setInterval(() => {
      pollPendingTasks().catch((error) => {
        logger.error("Task poll tick crashed.", { message: error?.message || String(error) });
      });
    }, config.pollIntervalMs);
  }

  function stop() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  return {
    start,
    stop,
    pollPendingTasks,
  };
}

module.exports = {
  createTaskPoller,
};
