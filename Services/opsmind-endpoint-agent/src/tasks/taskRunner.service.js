const { executeStepHandler } = require("../handlers");

const STEP_STATUS_ALLOWLIST = new Set(["SUCCESS", "FAILED", "SKIPPED"]);

function normalizeStepStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!STEP_STATUS_ALLOWLIST.has(normalized)) {
    return "FAILED";
  }

  return normalized;
}

function normalizeStepOrder(step) {
  const value = Number(step?.step_order ?? step?.stepOrder ?? 0);
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  return Number.MAX_SAFE_INTEGER;
}

function normalizeTaskSteps(task) {
  const steps = Array.isArray(task?.steps) ? task.steps : [];

  return [...steps].sort((left, right) => normalizeStepOrder(left) - normalizeStepOrder(right));
}

function toOutputPayload(result) {
  const payload = {
    message: result?.message || null,
    details: result?.details || null,
  };

  return JSON.stringify(payload);
}

function createTaskRunner({ client, getIdentity, logger }) {
  let isProcessingTask = false;

  async function processTask(task) {
    if (!task?.id) {
      return;
    }

    if (isProcessingTask) {
      logger.debug("Task runner is already busy. Skipping parallel task execution.", {
        incomingTaskId: task.id,
      });
      return;
    }

    const identity = getIdentity();
    if (!identity?.deviceId) {
      logger.warn("Cannot process tasks because no device identity is loaded.");
      return;
    }

    const taskId = String(task.id);
    const deviceId = identity.deviceId;

    let hasStarted = false;
    let hasStepFailure = false;
    let activeStep = null;

    isProcessingTask = true;

    try {
      await client.claimTask(taskId, deviceId);
      logger.info("Task claimed.", { taskId, deviceId });

      const startedTask = await client.startTask(taskId, deviceId);
      hasStarted = true;
      logger.info("Task started.", { taskId, deviceId });

      const steps = normalizeTaskSteps(startedTask || task);

      if (steps.length === 0) {
        logger.warn("Started task has no steps. Completing task with no-op result.", {
          taskId,
          deviceId,
        });
      }

      for (const step of steps) {
        const stepId = String(step?.id || "").trim();
        const actionKey = String(step?.action_key || step?.actionKey || "UNKNOWN_ACTION").trim();

        if (!stepId) {
          logger.warn("Skipping malformed task step with no id.", {
            taskId,
            actionKey,
          });
          continue;
        }

        logger.info("Step started.", {
          taskId,
          stepId,
          actionKey,
        });
        activeStep = {
          stepId,
          actionKey,
          submitted: false,
        };

        let result;
        try {
          result = await executeStepHandler(step, { logger });
        } catch (error) {
          result = {
            status: "FAILED",
            message: `Handler execution failed: ${error?.message || "unknown error"}`,
            details: {
              reason: "HANDLER_EXCEPTION",
            },
          };
        }

        const normalizedStatus = normalizeStepStatus(result?.status);
        if (normalizedStatus === "FAILED") {
          hasStepFailure = true;
        }

        await client.submitTaskStepResult(taskId, stepId, deviceId, {
          status: normalizedStatus,
          output: toOutputPayload(result),
          errorMessage: normalizedStatus === "FAILED" ? String(result?.message || "Step failed.") : null,
        });
        activeStep.submitted = true;

        logger.info("Step submitted.", {
          taskId,
          stepId,
          actionKey,
          status: normalizedStatus,
        });
        activeStep = null;
      }

      const completionBody = hasStepFailure
        ? { failureReason: "One or more steps failed in the MVP endpoint agent." }
        : {};

      await client.completeTask(taskId, deviceId, completionBody);
      logger.info("Task completed.", {
        taskId,
        deviceId,
        outcome: hasStepFailure ? "FAILED" : "COMPLETED",
      });
    } catch (error) {
      logger.error("Task processing failed.", {
        taskId,
        deviceId,
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message,
      });

      if (hasStarted) {
        if (activeStep && activeStep.submitted !== true) {
          try {
            await client.submitTaskStepResult(taskId, activeStep.stepId, deviceId, {
              status: "FAILED",
              output: toOutputPayload({
                message: `Step failed before completion: ${error?.message || "unexpected error"}`,
                details: {
                  reason: "STEP_ABORTED_BY_RUNTIME_ERROR",
                },
              }),
              errorMessage: String(error?.message || "Step failed before completion."),
            });
            hasStepFailure = true;
            logger.warn("Active step was marked as FAILED after runtime error.", {
              taskId,
              stepId: activeStep.stepId,
              actionKey: activeStep.actionKey,
            });
          } catch (submitError) {
            logger.error("Failed to submit FAILED status for active step after runtime error.", {
              taskId,
              stepId: activeStep.stepId,
              actionKey: activeStep.actionKey,
              code: submitError?.code || null,
              status: submitError?.status || null,
              message: submitError?.message,
            });
          }
        }

        if (!hasStepFailure) {
          logger.warn("Task left in backend for retry because no FAILED step could be persisted safely.", {
            taskId,
            deviceId,
          });
          return;
        }

        try {
          await client.completeTask(taskId, deviceId, {
            failureReason: `Endpoint agent processing failed: ${error?.message || "unexpected error"}`,
          });
          logger.warn("Task was force-completed after processing failure.", {
            taskId,
            deviceId,
          });
        } catch (completionError) {
          logger.error("Failed to force-complete task after processing failure.", {
            taskId,
            deviceId,
            code: completionError?.code || null,
            status: completionError?.status || null,
            message: completionError?.message,
          });
        }
      }
    } finally {
      isProcessingTask = false;
    }
  }

  return {
    isProcessingTask() {
      return isProcessingTask;
    },
    processTask,
  };
}

module.exports = {
  createTaskRunner,
};
